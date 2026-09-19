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
    const lookup = await this.#pool.query(
      "select id, slug, display_name from app.tenants where slug = $1 and status = 'active'",
      [tenantSlug]
    );
    if (lookup.rowCount !== 1) return null;
    const tenant = lookup.rows[0];
    return this.#transaction({ tenantDbId: tenant.id, subject: identity.subject }, async (client) => {
      const membership = await client.query(
        "select role from app.tenant_memberships where tenant_id = $1 and identity_subject = $2 and status = 'active'",
        [tenant.id, identity.subject]
      );
      if (membership.rowCount !== 1) return null;
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
          role: membership.rows[0].role,
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
        `select id, integration_type, display_name, status, last_checked_at
           from app.integration_connections
          where tenant_id = $1
          order by integration_type, display_name`,
        [context.principal.tenantDbId]
      );
      return result.rows;
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

  // Route methods
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
