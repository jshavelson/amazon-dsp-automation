import pg from 'pg';

const { Pool } = pg;

export class PostgresRepository {
  #pool;

  constructor({ connectionString }) {
    this.#pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: true }
    });
  }

  async close() {
    await this.#pool.end();
  }

  async #transaction({ tenantDbId, subject }, operation) {
    const client = await this.#pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.current_tenant_id', $1, true)", [tenantDbId]);
      await client.query("select set_config('app.current_identity_subject', $1, true)", [subject]);
      const result = await operation(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveContext({ tenantSlug, identity }) {
    const platformAdminLookup = await this.#pool.query(
      'select 1 from app.platform_admins where lower(email) = lower($1) and active = true',
      [identity.email || '']
    );
    const isPlatformAdmin = platformAdminLookup.rowCount === 1;
    const lookup = await this.#pool.query(
      "select id, slug, display_name from app.tenants where slug = $1 and status = 'active'",
      [tenantSlug]
    );
    if (lookup.rowCount !== 1) return null;
    const tenant = lookup.rows[0];
    return this.#transaction({ tenantDbId: tenant.id, subject: identity.subject }, async (client) => {
      let membership = await client.query(
        "select role from app.tenant_memberships where tenant_id = $1 and identity_subject = $2 and status = 'active'",
        [tenant.id, identity.subject]
      );
      if (membership.rowCount !== 1 && identity.email) {
        const invited = await client.query(
          `update app.tenant_memberships
              set identity_subject = $3, status = 'active'
            where tenant_id = $1 and lower(email) = lower($2) and status = 'invited'
          returning role`,
          [tenant.id, identity.email, identity.subject]
        );
        if (invited.rowCount === 1) membership = invited;
      }
      if (membership.rowCount !== 1 && !isPlatformAdmin) return null;
      const entitlements = await client.query(
        "select module_id, status from app.tenant_entitlements where tenant_id = $1 and (ends_at is null or ends_at > now())",
        [tenant.id]
      );
      return Object.freeze({
        principal: Object.freeze({
          userId: identity.subject,
          tenantId: tenant.slug,
          tenantDbId: tenant.id,
          tenantName: tenant.display_name,
          role: isPlatformAdmin ? 'platform_admin' : membership.rows[0].role,
          tenantRole: membership.rowCount === 1 ? membership.rows[0].role : null,
          isPlatformAdmin,
          email: identity.email
        }),
        entitlements: Object.freeze(entitlements.rows.map((row) => Object.freeze({
          tenantId: tenant.slug,
          moduleId: row.module_id,
          status: row.status
        })))
      });
    });
  }

  async listFeatureOverrides(context) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `select feature_id as "featureId", enabled, updated_by as "updatedBy", updated_at as "updatedAt"
           from app.tenant_feature_overrides where tenant_id = $1`,
        [context.principal.tenantDbId]
      );
      return result.rows;
    });
  }

  async setFeatureOverride(context, featureId, enabled) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `insert into app.tenant_feature_overrides (tenant_id, feature_id, enabled, updated_by)
         values ($1,$2,$3,$4)
         on conflict (tenant_id, feature_id) do update set
           enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()
         returning feature_id as "featureId", enabled, updated_by as "updatedBy", updated_at as "updatedAt"`,
        [context.principal.tenantDbId, featureId, enabled, context.principal.userId]
      );
      await client.query(
        `insert into app.audit_events (tenant_id, actor_subject, action, resource_type, resource_id, request_id, metadata)
         values ($1,$2,'feature.override','feature',$3,gen_random_uuid(),jsonb_build_object('enabled',$4))`,
        [context.principal.tenantDbId, context.principal.userId, featureId, enabled]
      );
      return result.rows[0];
    });
  }

  async recordAssistantExchange(context, exchange) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      await client.query(
        `insert into app.ai_conversations (id,tenant_id,user_subject,current_path,model) values ($1,$2,$3,$4,$5)`,
        [exchange.conversationId, context.principal.tenantDbId, context.principal.userId, exchange.path, exchange.model]
      );
      await client.query(
        `insert into app.ai_messages (tenant_id,conversation_id,role,content) values ($1,$2,'user',$3),($1,$2,'assistant',$4)`,
        [context.principal.tenantDbId, exchange.conversationId, exchange.question, exchange.answer]
      );
      await client.query(
        `insert into app.ai_usage_events (tenant_id,conversation_id,provider_request_id,model,input_tokens,output_tokens,latency_ms) values ($1,$2,$3,$4,$5,$6,$7)`,
        [context.principal.tenantDbId, exchange.conversationId, exchange.providerRequestId, exchange.model, exchange.inputTokens || null, exchange.outputTokens || null, exchange.latencyMs]
      );
      await client.query(
        `insert into app.audit_events (tenant_id,actor_subject,action,resource_type,resource_id,request_id,metadata) values ($1,$2,'assistant.response','ai_conversation',$3,$4,$5::jsonb)`,
        [context.principal.tenantDbId, context.principal.userId, exchange.conversationId, exchange.requestId, JSON.stringify({
          model: exchange.model,
          inputTokens: exchange.inputTokens || null,
          outputTokens: exchange.outputTokens || null,
          path: exchange.path,
          instructionVersion: exchange.instructionVersion || null,
          instructionFiles: exchange.instructionFiles || []
        })]
      );
    });
  }

  async listMembers(context) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `select identity_subject as "identitySubject", email, role, status, created_at as "createdAt"
           from app.tenant_memberships where tenant_id = $1 order by lower(email), created_at`,
        [context.principal.tenantDbId]
      );
      return result.rows;
    });
  }

  async inviteMember(context, { email, role }) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `insert into app.tenant_memberships (tenant_id, identity_subject, email, role, status)
         values ($1, 'invited:' || gen_random_uuid()::text, lower($2), $3, 'invited')
         on conflict (tenant_id, identity_subject) do nothing
         returning identity_subject as "identitySubject", email, role, status, created_at as "createdAt"`,
        [context.principal.tenantDbId, email, role]
      );
      if (result.rowCount !== 1) throw new Error('member invitation could not be created');
      await client.query(
        `insert into app.audit_events (tenant_id, actor_subject, action, resource_type, resource_id, request_id, metadata)
         values ($1,$2,'member.invite','membership',$3,gen_random_uuid(),jsonb_build_object('role',$4))`,
        [context.principal.tenantDbId, context.principal.userId, email, role]
      );
      return result.rows[0];
    });
  }

  async updateMember(context, identitySubject, { role, status }) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `update app.tenant_memberships set role = $3, status = $4
          where tenant_id = $1 and identity_subject = $2
          returning identity_subject as "identitySubject", email, role, status, created_at as "createdAt"`,
        [context.principal.tenantDbId, identitySubject, role, status]
      );
      if (result.rowCount === 1) await client.query(
        `insert into app.audit_events (tenant_id, actor_subject, action, resource_type, resource_id, request_id, metadata)
         values ($1,$2,'member.update','membership',$3,gen_random_uuid(),jsonb_build_object('role',$4,'status',$5))`,
        [context.principal.tenantDbId, context.principal.userId, identitySubject, role, status]
      );
      return result.rows[0] || null;
    });
  }

  async auditImpersonation(context, action, target, metadata) {
    const actor = context.principal.impersonation?.actor || context.principal;
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: actor.userId }, async (client) => {
      await client.query(
        `insert into app.audit_events (tenant_id, actor_subject, action, resource_type, resource_id, request_id, metadata)
         values ($1,$2,$3,'user',$4,gen_random_uuid(),$5::jsonb)`,
        [context.principal.tenantDbId, actor.userId, action, target.identitySubject, JSON.stringify({ targetEmail: target.email, targetRole: target.role, ...metadata })]
      );
    });
  }

  async listCases(context, moduleId, limit = 50) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `select id, module_id, external_key, status, estimated_value_cents, summary, created_at, updated_at
           from app.workflow_cases
          where tenant_id = $1 and module_id = $2
          order by created_at desc
          limit $3`,
        [context.principal.tenantDbId, moduleId, Math.min(Math.max(limit, 1), 100)]
      );
      return result.rows;
    });
  }

  async latestDashboardSnapshot(context) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `select period_key, generated_at, metrics, source_fingerprints, stale_sources
           from app.dashboard_snapshots
          where tenant_id = $1
          order by generated_at desc
          limit 1`,
        [context.principal.tenantDbId]
      );
      return result.rows[0] || null;
    });
  }

  async listIntegrationConnections(context) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `select id, integration_type, display_name, secret_reference, config, status,
                auth_kind, schedule, last_checked_at, last_success_at, last_error,
                reauth_required_at, session_expires_at
           from app.integration_connections
          where tenant_id = $1
          order by integration_type, display_name`,
        [context.principal.tenantDbId]
      );
      return result.rows;
    });
  }

  async getIntegrationConnection(context, integrationType) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `select id, integration_type, display_name, secret_reference, config, status,
                auth_kind, schedule, last_checked_at, last_success_at, last_error
           from app.integration_connections
          where tenant_id = $1 and integration_type = $2
          limit 1`,
        [context.principal.tenantDbId, integrationType]
      );
      return result.rows[0] || null;
    });
  }

  async upsertIntegrationConnection(context, connection) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `insert into app.integration_connections
           (tenant_id, integration_type, display_name, secret_reference, config, status, auth_kind, schedule, created_by)
         values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
         on conflict (tenant_id, integration_type, display_name) do update set
           secret_reference = excluded.secret_reference,
           config = excluded.config,
           status = excluded.status,
           auth_kind = excluded.auth_kind,
           schedule = excluded.schedule,
           created_by = excluded.created_by,
           last_error = null,
           last_checked_at = now()
         returning *`,
        [
          context.principal.tenantDbId, connection.integrationType, connection.displayName,
          connection.secretReference, JSON.stringify(connection.config), connection.status,
          connection.authKind, connection.schedule, context.principal.userId
        ]
      );
      return result.rows[0];
    });
  }

  async updateIntegrationConnectionHealth(context, integrationType, health) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `update app.integration_connections
            set status = $3, last_checked_at = now(),
                last_success_at = case when $4 then now() else last_success_at end,
                last_error = $5
          where tenant_id = $1 and integration_type = $2
          returning *`,
        [context.principal.tenantDbId, integrationType, health.status, health.succeeded, health.lastError]
      );
      return result.rows[0] || null;
    });
  }

  // Driver methods
  async listDrivers(context, { limit = 100, skip = 0 } = {}) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `select id, name, status, email, phone, hire_date, termination_date
           from app.drivers
          where tenant_id = $1
          order by name
          limit $2 offset $3`,
        [context.principal.tenantDbId, limit, skip]
      );
      const countResult = await client.query(
        `select count(*) as total from app.drivers where tenant_id = $1`,
        [context.principal.tenantDbId]
      );
      return {
        items: result.rows,
        total: parseInt(countResult.rows[0].total, 10)
      };
    });
  }

  async getDriver(context, driverId) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `select id, name, status, email, phone, hire_date, termination_date
           from app.drivers
          where tenant_id = $1 and id = $2`,
        [context.principal.tenantDbId, driverId]
      );
      return result.rows[0] || null;
    });
  }

  // Van methods
  async listVans(context, { limit = 100, skip = 0 } = {}) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `select id, vin, license_plate as "licensePlate", make, model, year, type, ownership, status, home_station_id as "homeStationId"
           from app.vans
          where tenant_id = $1
          order by vin
          limit $2 offset $3`,
        [context.principal.tenantDbId, limit, skip]
      );
      const countResult = await client.query(
        `select count(*) as total from app.vans where tenant_id = $1`,
        [context.principal.tenantDbId]
      );
      return {
        items: result.rows,
        total: parseInt(countResult.rows[0].total, 10)
      };
    });
  }

  // Timecard methods
  async listTimecards(context, { week, limit = 100, skip = 0 } = {}) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      let query = `
        select id, driver_id as "driverId", week, regular_hours as "regularHours", 
               overtime_hours as "overtimeHours", regular_earnings as "regularEarnings",
               overtime_earnings as "overtimeEarnings", status, submitted_date as "submittedDate",
               approved_date as "approvedDate"
          from app.timecards
         where tenant_id = $1
      `;
      const params = [context.principal.tenantDbId];
      if (week) {
        query += ` and week = $2`;
        params.push(week);
      }
      query += ` order by week desc, driver_id limit $${params.length + 1} offset $${params.length + 2}`;
      params.push(limit, skip);
      
      const result = await client.query(query, params);
      const countQuery = `select count(*) as total from app.timecards where tenant_id = $1${week ? ' and week = $2' : ''}`;
      const countParams = week ? [context.principal.tenantDbId, week] : [context.principal.tenantDbId];
      const countResult = await client.query(countQuery, countParams);
      
      return {
        items: result.rows,
        total: parseInt(countResult.rows[0].total, 10)
      };
    });
  }

  async listAttendanceExceptions(context, { limit = 500 } = {}) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const coverage = await client.query(
        `select min(work_date) as "startDate", max(work_date) as "endDate",
                max(captured_at) as "capturedAt", count(distinct employee_external_id)::int as employees,
                (select count(*)::int from app.daily_route_assignments where tenant_id = $1) as "dailyAssignments"
           from app.attendance_day_entries where tenant_id = $1`,
        [context.principal.tenantDbId]
      );
      const meta = coverage.rows[0];
      const routeCoverage = Number(meta.dailyAssignments) > 0;
      const result = await client.query(
        `select employee_name as employee, work_date::text as date,
                case
                  when duration_hours > 10 then 'Long shift'
                  when duration_hours = 0 and route_code is not null then 'Missed punch'
                  when duration_hours > 0 and route_code is null and $2::boolean then 'Unassigned shift'
                end as "issueType",
                case
                  when duration_hours > 10 then trim(to_char(duration_hours, 'FM999990.00')) || ' hours'
                  when duration_hours = 0 and route_code is not null then 'No ADP time recorded for assigned Amazon route on ' || work_date::text
                  when duration_hours > 0 and route_code is null and $2::boolean then 'ADP time but no Amazon route assignment'
                end as details
           from (
             select a.*, r.route_code
               from app.attendance_day_entries a
               left join app.daily_route_assignments r
                 on r.tenant_id = a.tenant_id
                and r.employee_external_id = a.employee_external_id
                and r.route_date = a.work_date
              where a.tenant_id = $1
           ) reconciled
          where duration_hours > 10
             or (duration_hours = 0 and route_code is not null)
             or (duration_hours > 0 and route_code is null and $2::boolean)
          order by work_date desc, employee_name
          limit $3`,
        [context.principal.tenantDbId, routeCoverage, limit]
      );
      return { items: result.rows, ...meta, routeReconciliationAvailable: routeCoverage };
    });
  }

  // Route methods
  async listLiveRoutes(context, { date, limit = 250 } = {}) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const selected = date || (await client.query(`select max(delivery_date)::text as date from app.live_routes where tenant_id = $1`, [context.principal.tenantDbId])).rows[0]?.date;
      if (!selected) return { items: [], total: 0 };
      const result = await client.query(
        `select route_id as "routeId", route_code as "routeCode", delivery_date::text as "deliveryDate",
                transporter_id as "transporterId", driver_name as "driverName", vin, status, risk,
                planned_departure_at as "plannedDepartureAt", actual_departure_at as "actualDepartureAt",
                projected_completion_at as "projectedCompletionAt", scheduled_end_at as "scheduledEndAt",
                last_event_at as "lastEventAt", total_stops as "totalStops", completed_stops as "completedStops",
                greatest(total_stops - completed_stops, 0) as "remainingStops",
                case when total_stops > 0 then round(completed_stops * 100.0 / total_stops, 1) else 0 end as "completionPct",
                total_packages as "totalPackages", delivered_packages as "deliveredPackages",
                greatest(total_packages - delivered_packages, 0) as "remainingPackages",
                stops_last_hour as "stopsLastHour", late_departure_minutes as "lateDepartureMinutes",
                projected_late_minutes as "projectedLateMinutes", inactive_minutes as "inactiveMinutes",
                on_break as "onBreak", route_paused as "routePaused", rescue_count as "rescueCount",
                associated_routes as "associatedRoutes", is_multi_route as "isMultiRoute", captured_at as "capturedAt"
           from app.live_routes where tenant_id = $1 and delivery_date = $2::date
          order by case risk when 'stalled' then 1 when 'behind' then 2 when 'late_departure' then 3 else 4 end, route_code, transporter_id limit $3`,
        [context.principal.tenantDbId, selected, limit]
      );
      return { items: result.rows, total: result.rows.length };
    });
  }

  async listRoutes(context, { date, limit = 100, skip = 0 } = {}) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      let query = `
        select id, driver_id as "driverId", van_id as "vanId", date, status, 
               start_time as "startTime", end_time as "endTime", 
               total_stops as "totalStops", packages_delivered as "packagesDelivered",
               packages_total as "packagesTotal", miles_driven as "milesDriven"
          from app.routes
         where tenant_id = $1
      `;
      const params = [context.principal.tenantDbId];
      if (date) {
        query += ` and date = $2`;
        params.push(date);
      }
      query += ` order by date desc, start_time desc limit $${params.length + 1} offset $${params.length + 2}`;
      params.push(limit, skip);
      
      const result = await client.query(query, params);
      const countQuery = `select count(*) as total from app.routes where tenant_id = $1${date ? ' and date = $2' : ''}`;
      const countParams = date ? [context.principal.tenantDbId, date] : [context.principal.tenantDbId];
      const countResult = await client.query(countQuery, countParams);
      
      return {
        items: result.rows,
        total: parseInt(countResult.rows[0].total, 10)
      };
    });
  }

  // Scorecard methods
  async getScorecardData(context, week) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `select period_key as week, metrics, generated_at as "generatedAt"
           from app.dashboard_snapshots
          where tenant_id = $1 and period_key = $2
          order by generated_at desc
          limit 1`,
        [context.principal.tenantDbId, week]
      );
      return result.rows[0] || null;
    });
  }
}
