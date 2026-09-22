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

  async inviteMember(context, { email, role, identitySubject = null }) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `insert into app.tenant_memberships (tenant_id, identity_subject, email, role, status)
         values ($1, coalesce($4, 'invited:' || gen_random_uuid()::text), lower($2), $3, 'invited')
         on conflict (tenant_id, identity_subject) do nothing
         returning identity_subject as "identitySubject", email, role, status, created_at as "createdAt"`,
        [context.principal.tenantDbId, email, role, identitySubject]
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

  async auditMemberInvitationResent(context, member) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      await client.query(
        `insert into app.audit_events (tenant_id, actor_subject, action, resource_type, resource_id, request_id, metadata)
         values ($1,$2,'member.invitation_resend','membership',$3,gen_random_uuid(),jsonb_build_object('email',$4,'role',$5))`,
        [context.principal.tenantDbId, context.principal.userId, member.identitySubject, member.email, member.role]
      );
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
      const result = await client.query(
        `with selected_day as (
           select coalesce($2::date, max(delivery_date)) as delivery_date
             from app.live_routes
            where tenant_id = $1
         )
         select route_id as "routeId", route_code as "routeCode", delivery_date::text as "deliveryDate",
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
           from app.live_routes
           join selected_day using (delivery_date)
          where tenant_id = $1
          order by case risk when 'stalled' then 1 when 'behind' then 2 when 'late_departure' then 3 else 4 end, route_code, transporter_id limit $3`,
        [context.principal.tenantDbId, date || null, limit]
      );
      return { items: result.rows, total: result.rows.length };
    });
  }

  async listDispatchRouteAssignments(context, deliveryDate) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const result = await client.query(
        `select delivery_date::text as "deliveryDate", route_id as "routeId", transporter_id as "transporterId",
                driver_id as "driverId", driver_name as "driverName", van_id as "vanId",
                van_label as "vanLabel", vin, phone_id as "phoneId", phone_label as "phoneLabel",
                updated_by as "updatedBy", updated_at as "updatedAt"
           from app.dispatch_route_assignments
          where tenant_id = $1 and delivery_date = $2::date`,
        [context.principal.tenantDbId, deliveryDate]
      );
      return result.rows;
    });
  }

  async saveDispatchRouteAssignment(context, assignment) {
    return this.#transaction({ tenantDbId: context.principal.tenantDbId, subject: context.principal.userId }, async (client) => {
      const route = await client.query(
        `select 1 from app.live_routes
          where tenant_id = $1 and delivery_date = $2::date and route_id = $3 and transporter_id = $4`,
        [context.principal.tenantDbId, assignment.deliveryDate, assignment.routeId, assignment.transporterId || '']
      );
      if (route.rowCount !== 1) throw new Error('route is not present in the selected Cortex operating day');
      if (!assignment.driverId && !assignment.vanId && !assignment.phoneId) {
        await client.query(
          `delete from app.dispatch_route_assignments
            where tenant_id = $1 and delivery_date = $2::date and route_id = $3 and transporter_id = $4`,
          [context.principal.tenantDbId, assignment.deliveryDate, assignment.routeId, assignment.transporterId || '']
        );
        return null;
      }
      const result = await client.query(
        `insert into app.dispatch_route_assignments
          (tenant_id, delivery_date, route_id, transporter_id, driver_id, driver_name, van_id, van_label, vin,
           phone_id, phone_label, updated_by)
         values ($1,$2::date,$3,$4,nullif($5,''),nullif($6,''),nullif($7,''),nullif($8,''),nullif($9,''),
                 nullif($10,''),nullif($11,''),$12)
         on conflict (tenant_id, delivery_date, route_id, transporter_id) do update set
           driver_id=excluded.driver_id, driver_name=excluded.driver_name, van_id=excluded.van_id,
           van_label=excluded.van_label, vin=excluded.vin, phone_id=excluded.phone_id,
           phone_label=excluded.phone_label, updated_by=excluded.updated_by, updated_at=now()
         returning delivery_date::text as "deliveryDate", route_id as "routeId", transporter_id as "transporterId",
                   driver_id as "driverId", driver_name as "driverName", van_id as "vanId",
                   van_label as "vanLabel", vin, phone_id as "phoneId", phone_label as "phoneLabel",
                   updated_by as "updatedBy", updated_at as "updatedAt"`,
        [context.principal.tenantDbId, assignment.deliveryDate, assignment.routeId, assignment.transporterId || '',
         assignment.driverId || '', assignment.driverName || '', assignment.vanId || '', assignment.vanLabel || '',
         assignment.vin || '', assignment.phoneId || '', assignment.phoneLabel || '', context.principal.userId]
      );
      return result.rows[0];
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

  // ============================================
  // SUPER-ADMIN TENANT MANAGEMENT
  // ============================================

  /**
   * List all tenants (super-admin only)
   */
  async listAllTenants() {
    const result = await this.#pool.query(
      `select id, slug, display_name as "displayName", status, created_at as "createdAt"
         from app.tenants
        order by display_name, created_at`
    );
    return result.rows;
  }

  /**
   * Get tenant by slug
   */
  async getTenantBySlug(slug) {
    const result = await this.#pool.query(
      `select id, slug, display_name as "displayName", status, created_at as "createdAt"
         from app.tenants
        where slug = $1`,
      [slug]
    );
    return result.rows[0] || null;
  }

  /**
   * Create a new tenant
   */
  async createTenant({ slug, displayName, createdBy }) {
    const result = await this.#pool.query(
      `insert into app.tenants (slug, display_name, created_at)
       values ($1, $2, now())
       on conflict (slug) do nothing
       returning id, slug, display_name as "displayName", status, created_at as "createdAt"`,
      [slug, displayName]
    );
    if (result.rowCount === 0) {
      throw new Error('tenant slug already exists');
    }
    return result.rows[0];
  }

  async provisionTenant({ slug, displayName, ownerEmail, ownerIdentitySubject, moduleIds, actor }) {
    const client = await this.#pool.connect();
    try {
      await client.query('begin');
      const tenantResult = await client.query(
        `insert into app.tenants (slug, display_name)
         values ($1, $2)
         returning id, slug, display_name as "displayName", status,
                   created_at as "createdAt", updated_at as "updatedAt"`,
        [slug, displayName]
      );
      const tenant = tenantResult.rows[0];
      await client.query("select set_config('app.current_tenant_id', $1, true)", [tenant.id]);
      await client.query("select set_config('app.current_identity_subject', $1, true)", [actor.userId]);
      const memberResult = await client.query(
        `insert into app.tenant_memberships (tenant_id, identity_subject, email, role, status)
         values ($1, coalesce($2, 'invited:' || gen_random_uuid()::text), lower($3), 'owner', 'invited')
         returning identity_subject as "identitySubject", email, role, status, created_at as "createdAt"`,
        [tenant.id, ownerIdentitySubject, ownerEmail]
      );
      if (moduleIds.length) await client.query(
        `insert into app.tenant_entitlements (tenant_id, module_id, status)
         select $1, unnest($2::text[]), 'trial'
         on conflict (tenant_id, module_id) do nothing`,
        [tenant.id, moduleIds]
      );
      await client.query(
        `insert into app.platform_audit_events
           (actor_subject, actor_email, action, resource_type, resource_id, metadata)
         values ($1,$2,'tenant.create','tenant',$3,$4::jsonb)`,
        [actor.userId, actor.email || null, slug, JSON.stringify({ displayName, ownerEmail, moduleIds })]
      );
      await client.query('commit');
      return { tenant, owner: memberResult.rows[0] };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get tenant details with member count
   */
  async getTenantDetails(slug) {
    const tenantResult = await this.#pool.query(
      `select id, slug, display_name as "displayName", status, created_at as "createdAt"
         from app.tenants
        where slug = $1`,
      [slug]
    );
    if (tenantResult.rowCount === 0) return null;

    const tenant = tenantResult.rows[0];
    return this.#transaction({ tenantDbId: tenant.id, subject: 'platform-admin' }, async (client) => {
      const counts = await client.query(
        `select
           (select count(*) from app.tenant_memberships where tenant_id = $1) as "memberCount",
           (select count(*) from app.integration_connections where tenant_id = $1) as "connectionCount",
           (select count(*) from app.tenant_entitlements where tenant_id = $1) as "entitlementCount"`,
        [tenant.id]
      );
      return Object.fromEntries(Object.entries({ ...tenant, ...counts.rows[0] }).map(([key, value]) =>
        [key, key.endsWith('Count') ? Number(value) : value]
      ));
    });
  }

  /**
   * Update tenant status
   */
  async updateTenantStatus(slug, status, actor) {
    const result = await this.#pool.query(
      `update app.tenants
         set status = $2, updated_at = now()
        where slug = $1
        returning id, slug, display_name as "displayName", status, created_at as "createdAt", updated_at as "updatedAt"`,
      [slug, status]
    );
    if (result.rowCount === 0) return null;
    await this.auditPlatformEvent(actor, 'tenant.status_change', 'tenant', slug, { status });
    return result.rows[0];
  }

  /**
   * List all members for a tenant (super-admin view)
   */
  async listTenantMembers(tenantSlug) {
    const tenant = await this.getTenantBySlug(tenantSlug);
    if (!tenant) return [];

    return this.#transaction({ tenantDbId: tenant.id, subject: 'platform-admin' }, async (client) => {
      const result = await client.query(
        `select identity_subject as "identitySubject", email, role, status, created_at as "createdAt"
           from app.tenant_memberships
          where tenant_id = $1
          order by lower(email), created_at`,
        [tenant.id]
      );
      return result.rows;
    });
  }

  /**
   * List all members across all tenants (super-admin only)
   */
  async listAllMembers({ tenantSlug, limit = 100, offset = 0 }) {
    const tenants = tenantSlug
      ? [await this.getTenantBySlug(tenantSlug)].filter(Boolean)
      : await this.listAllTenants();
    const memberSets = await Promise.all(tenants.map(async (tenant) =>
      (await this.listTenantMembers(tenant.slug)).map((member) => ({
        tenantSlug: tenant.slug, tenantName: tenant.displayName, ...member
      }))
    ));
    const members = memberSets.flat().sort((a, b) =>
      a.tenantName.localeCompare(b.tenantName) || a.email.localeCompare(b.email)
    );
    return { members: members.slice(offset, offset + limit), total: members.length };
  }

  /**
   * List tenant connections (super-admin view)
   */
  async listTenantConnections(tenantSlug) {
    const tenant = await this.getTenantBySlug(tenantSlug);
    if (!tenant) return [];

    return this.#transaction({ tenantDbId: tenant.id, subject: 'platform-admin' }, async (client) => {
      const result = await client.query(
        `select id, integration_type as "integrationType", display_name as "displayName",
                secret_reference as "secretReference", config, status, auth_kind as "authKind",
                schedule, last_checked_at as "lastCheckedAt", last_success_at as "lastSuccessAt",
                last_error as "lastError", reauth_required_at as "reauthRequiredAt",
                session_expires_at as "sessionExpiresAt", created_at as "createdAt"
           from app.integration_connections
          where tenant_id = $1
          order by integration_type, display_name`,
        [tenant.id]
      );
      return result.rows;
    });
  }

  /**
   * Create a connection for a tenant (super-admin)
   */
  async createTenantConnection(tenantSlug, connection, actor) {
    const tenant = await this.getTenantBySlug(tenantSlug);
    if (!tenant) throw new Error('tenant not found');

    const connectionName = connection.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'connection';
    const result = await this.#transaction({ tenantDbId: tenant.id, subject: actor.userId }, async (client) => client.query(
      `insert into app.integration_connections
         (tenant_id, integration_type, display_name, secret_reference, config, status,
          auth_kind, schedule, created_by, created_at)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,now())
       returning id, integration_type as "integrationType", display_name as "displayName",
                 secret_reference as "secretReference", config, status, auth_kind as "authKind",
                 schedule, created_at as "createdAt"`,
      [tenant.id, connection.integrationType, connection.displayName,
        `secret://${tenant.slug}/platform/${connection.integrationType}/${connectionName}`,
        JSON.stringify(connection.config || {}), connection.status, connection.authKind,
        connection.schedule || null, actor.userId]
    ));
    await this.auditPlatformEvent(actor, 'connection.create', 'connection', String(result.rows[0].id), {
      tenantSlug, integrationType: connection.integrationType
    });
    return result.rows[0];
  }

  /**
   * List tenant feature overrides
   */
  async listTenantFeatures(tenantSlug) {
    const tenant = await this.getTenantBySlug(tenantSlug);
    if (!tenant) return [];

    return this.#transaction({ tenantDbId: tenant.id, subject: 'platform-admin' }, async (client) => {
      const result = await client.query(
        `select feature_id as "featureId", enabled, updated_by as "updatedBy", updated_at as "updatedAt"
           from app.tenant_feature_overrides
          where tenant_id = $1
          order by feature_id`,
        [tenant.id]
      );
      return result.rows;
    });
  }

  /**
   * Set feature override for a tenant
   */
  async setTenantFeatureOverride(tenantSlug, featureId, enabled, actor) {
    const tenant = await this.getTenantBySlug(tenantSlug);
    if (!tenant) return null;

    const result = await this.#transaction({ tenantDbId: tenant.id, subject: actor.userId }, async (client) => client.query(
      `insert into app.tenant_feature_overrides (tenant_id, feature_id, enabled, updated_by, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (tenant_id, feature_id) do update set
         enabled = excluded.enabled,
         updated_by = excluded.updated_by,
         updated_at = now()
       returning feature_id as "featureId", enabled, updated_by as "updatedBy", updated_at as "updatedAt"`,
      [tenant.id, featureId, enabled, actor.userId]
    ));
    await this.auditPlatformEvent(actor, 'feature.override', 'feature', `${tenantSlug}:${featureId}`, { tenantSlug, featureId, enabled });
    return result.rows[0];
  }

  async auditPlatformEvent(actor, action, resourceType, resourceId, metadata = {}) {
    await this.#pool.query(
      `insert into app.platform_audit_events
         (actor_subject, actor_email, action, resource_type, resource_id, metadata)
       values ($1,$2,$3,$4,$5,$6::jsonb)`,
      [actor.userId, actor.email || null, action, resourceType, resourceId, JSON.stringify(metadata)]
    );
  }

  /**
   * Audit tenant creation
   */
  async auditTenantCreation(actor, tenant, details) {
    return this.auditPlatformEvent(actor, 'tenant.create', 'tenant', tenant.slug, { displayName: tenant.displayName, ...details });
  }

  /**
   * Audit tenant status change
   */
  async auditTenantStatusChange(actor, tenantSlug, details) {
    return this.auditPlatformEvent(actor, 'tenant.status_change', 'tenant', tenantSlug, details);
  }

  /**
   * Audit feature override
   */
  async auditFeatureOverride(actor, tenantSlug, featureId, enabled) {
    return this.auditPlatformEvent(actor, 'feature.override', 'feature', `${tenantSlug}:${featureId}`, { tenantSlug, featureId, enabled });
  }

  /**
   * Audit cross-tenant impersonation
   */
  async auditCrossTenantImpersonation(actor, tenantSlug, target, details) {
    return this.auditPlatformEvent(actor, 'impersonation.cross_tenant', 'user', target.identitySubject, {
      tenantSlug, targetEmail: target.email, targetRole: target.role, ...details
    });
  }
}
