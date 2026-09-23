import pg from 'pg';

const { Pool } = pg;

export class ConnectorWorkerStore {
  #pool;

  constructor({ connectionString }) {
    this.#pool = new Pool({
      connectionString,
      max: 6,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: true }
    });
  }

  async close() { await this.#pool.end(); }

  async #tenant(tenantSlug, operation) {
    const client = await this.#pool.connect();
    try {
      await client.query('begin');
      const tenant = await client.query("select id from app.tenants where slug = $1 and status = 'active'", [tenantSlug]);
      if (tenant.rowCount !== 1) throw new Error('connector tenant not found');
      const tenantId = tenant.rows[0].id;
      await client.query("select set_config('app.current_tenant_id', $1, true)", [tenantId]);
      await client.query("select set_config('app.current_identity_subject', 'connector-worker', true)");
      const result = await operation(client, tenantId);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async start(tenantSlug, { jobId, sessionId }) {
    return this.#tenant(tenantSlug, async (client, tenantId) => {
      const job = await client.query(
        `update app.connector_jobs set status='running', started_at=coalesce(started_at,now()), attempt_count=attempt_count+1
          where id=$1 and session_id=$2 and status in ('queued','running') returning id`,
        [jobId, sessionId]
      );
      if (job.rowCount !== 1) throw new Error('connector job is unavailable');
      const session = await client.query(
        `update app.connector_sessions set status='starting', error_code=null, error_message=null
          where id=$1 and status in ('queued','starting') and expires_at>now()
          returning id, expires_at as "expiresAt"`,
        [sessionId]
      );
      if (session.rowCount !== 1) throw new Error('connector session is unavailable or expired');
      return session.rows[0];
    });
  }

  async ready(tenantSlug, sessionId, launchUrl) {
    return this.#tenant(tenantSlug, async (client) => {
      await client.query(
        `update app.connector_sessions set status='waiting_for_user', launch_url=$2 where id=$1 and expires_at>now()`,
        [sessionId, launchUrl]
      );
    });
  }

  async session(tenantSlug, sessionId) {
    return this.#tenant(tenantSlug, async (client) => {
      const result = await client.query(
        `select id, integration_type as "integrationType", status, expires_at as "expiresAt"
           from app.connector_sessions where id=$1`,
        [sessionId]
      );
      return result.rows[0] || null;
    });
  }

  async complete(tenantSlug, { jobId, sessionId, profileKey, feeds }) {
    return this.#tenant(tenantSlug, async (client) => {
      await client.query(
        `update app.connector_sessions set status='completed', completed_at=now(), launch_url=null where id=$1`,
        [sessionId]
      );
      await client.query(
        `update app.connector_jobs set status='completed', finished_at=now(), result=$2::jsonb where id=$1`,
        [jobId, JSON.stringify({ feeds })]
      );
      await client.query(
        `update app.integration_connections set status='healthy', last_checked_at=now(), last_success_at=now(),
                last_error=null, reauth_required_at=null,
                config=coalesce(config,'{}'::jsonb) || jsonb_build_object('authorizationMode','managed_tenant_browser','profileKey',$2)
          where integration_type='amazon'`,
        [sessionId, profileKey]
      );
    });
  }

  async fail(tenantSlug, { jobId, sessionId, code, message, needsReauth = true }) {
    return this.#tenant(tenantSlug, async (client) => {
      await client.query(
        `update app.connector_sessions set status='failed', completed_at=now(), launch_url=null,
                error_code=$2, error_message=$3 where id=$1`,
        [sessionId, code, message]
      );
      await client.query(
        `update app.connector_jobs set status='failed', finished_at=now(), last_error=$2 where id=$1`,
        [jobId, message]
      );
      if (needsReauth) await client.query(
        `update app.integration_connections set status='needs_reauth', last_checked_at=now(), last_error=$1,
                reauth_required_at=now() where integration_type='amazon'`,
        [message]
      );
    });
  }

  async startSync(tenantSlug, { jobId, feedGroup, periodStart, periodEnd }) {
    return this.#tenant(tenantSlug, async (client) => {
      const job = await client.query(
        `update app.connector_jobs set status='running', started_at=coalesce(started_at,now()), attempt_count=attempt_count+1
          where id=$1 and job_type='sync' and status in ('queued','running')
          returning id`, [jobId]
      );
      if (job.rowCount !== 1) throw new Error('connector sync job is unavailable');
      const plan = await client.query(
        `update app.tenant_onboarding_backfills set status='running', last_error=null, updated_at=now()
          where feed_group=$1 and period_start=$2 and period_end=$3
          returning id`, [feedGroup, periodStart, periodEnd]
      );
      if (plan.rowCount !== 1) throw new Error('tenant backfill plan is unavailable');
    });
  }

  async completeSync(tenantSlug, { jobId, feedGroup, artifact, periodStart, periodEnd }) {
    return this.#tenant(tenantSlug, async (client, tenantId) => {
      await client.query(
        `insert into app.connector_artifacts
          (tenant_id,integration_type,job_id,feed,reporting_period,storage_key,content_sha256,captured_at,metadata)
         values ($1,'amazon',$2,$3,$4,$5,$6,$7,$8::jsonb)
         on conflict (tenant_id,integration_type,content_sha256) do nothing`,
        [tenantId, jobId, feedGroup, `${periodStart}/${periodEnd}`, artifact.key, artifact.sha256,
          artifact.capturedAt, JSON.stringify({ contentType: artifact.contentType, byteLength: artifact.byteLength })]
      );
      await client.query(
        `update app.connector_jobs set status='completed', finished_at=now(), result=$2::jsonb where id=$1`,
        [jobId, JSON.stringify({ feedGroup, periodStart, periodEnd, artifactKey: artifact.key })]
      );
      await client.query(
        `update app.tenant_onboarding_backfills
            set status='completed', completed_sources='["amazon"]'::jsonb, last_error=null, updated_at=now()
          where feed_group=$1 and period_start=$2 and period_end=$3`, [feedGroup, periodStart, periodEnd]
      );
    });
  }

  async failSync(tenantSlug, { jobId, feedGroup, message, needsReauth = false }) {
    return this.#tenant(tenantSlug, async (client) => {
      await client.query(`update app.connector_jobs set status='failed', finished_at=now(), last_error=$2 where id=$1`, [jobId, message]);
      await client.query(
        `update app.tenant_onboarding_backfills set status=$2, last_error=$3, updated_at=now() where feed_group=$1`,
        [feedGroup, needsReauth ? 'waiting_for_connection' : 'failed', message]
      );
      if (needsReauth) await client.query(
        `update app.integration_connections set status='needs_reauth', last_checked_at=now(), last_error=$1, reauth_required_at=now()
          where integration_type='amazon'`, [message]
      );
    });
  }
}
