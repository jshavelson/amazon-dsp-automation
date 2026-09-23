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

  async complete(tenantSlug, { jobId, sessionId, integrationType, profileKey, feeds }) {
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
        `update app.integration_connections set status='healthy', last_checked_at=now(),
                last_auth_success_at=now(), consecutive_failures=0,
                last_error=null, reauth_required_at=null,
                config=coalesce(config,'{}'::jsonb) || jsonb_build_object('authorizationMode','managed_tenant_browser','profileKey',$2)
          where integration_type=$3`,
        [sessionId, profileKey, integrationType]
      );
    });
  }

  async fail(tenantSlug, { jobId, sessionId, integrationType = 'amazon', code, message, needsReauth = true }) {
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
                consecutive_failures=consecutive_failures+1, reauth_required_at=now() where integration_type=$2`,
        [message, integrationType]
      );
    });
  }

  async listHealthCandidates() {
    const tenants = await this.#pool.query("select slug from app.tenants where status='active' order by slug");
    const candidates = [];
    for (const { slug } of tenants.rows) {
      const rows = await this.#tenant(slug, async (client) => {
        const result = await client.query(
          `select integration_type as "integrationType", last_data_at as "lastDataAt"
             from app.integration_connections
            where auth_kind='browser_session' and status <> 'disabled'
              and integration_type in ('amazon','pave')
              and nullif(config->>'profileKey','') is not null
            order by integration_type`
        );
        return result.rows;
      });
      rows.forEach((row) => candidates.push({ tenantId: slug, ...row }));
    }
    return candidates;
  }

  async recordHealth(tenantSlug, integrationType, { healthy, needsReauth = false, message = null }) {
    return this.#tenant(tenantSlug, async (client) => {
      await client.query(
        `update app.integration_connections
            set status=$2, last_checked_at=now(),
                last_auth_success_at=case when $3 then now() else last_auth_success_at end,
                consecutive_failures=case when $3 then 0 else consecutive_failures+1 end,
                last_error=$4,
                reauth_required_at=case when $5 then coalesce(reauth_required_at,now()) else null end
          where integration_type=$1`,
        [integrationType, healthy ? 'healthy' : needsReauth ? 'needs_reauth' : 'degraded', healthy, message, needsReauth]
      );
    });
  }

  async recordPaveSnapshot(tenantSlug, artifact) {
    return this.#tenant(tenantSlug, async (client, tenantId) => {
      const inserted = await client.query(
        `insert into app.connector_artifacts
          (tenant_id,integration_type,job_id,feed,reporting_period,storage_key,content_sha256,captured_at,metadata)
         values ($1,'pave',null,'pave_assessments',$2,$3,$4,$5,$6::jsonb)
         on conflict (tenant_id,integration_type,content_sha256) do update set captured_at=excluded.captured_at
         returning id`,
        [tenantId, artifact.capturedAt.slice(0, 10), artifact.key, artifact.sha256, artifact.capturedAt,
          JSON.stringify({ contentType: artifact.contentType, byteLength: artifact.byteLength, rows: artifact.rows.length })]
      );
      const artifactId = inserted.rows[0].id;
      for (const row of artifact.rows) {
        await client.query(
          `insert into app.pave_assessments
            (tenant_id,vin,license_plate,vehicle_description,assessment_status,grade,grade_label,condition_score,
             has_new_damage,grounding_risk,station,external_session_key,assessed_at,artifact_id,raw)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
           on conflict (tenant_id,external_session_key) do update set
             vin=excluded.vin, license_plate=excluded.license_plate, vehicle_description=excluded.vehicle_description,
             assessment_status=excluded.assessment_status, grade=excluded.grade, grade_label=excluded.grade_label,
             condition_score=excluded.condition_score, has_new_damage=excluded.has_new_damage,
             grounding_risk=excluded.grounding_risk, station=excluded.station, assessed_at=excluded.assessed_at,
             artifact_id=excluded.artifact_id, raw=excluded.raw`,
          [tenantId, row.vin, row.licensePlate, row.vehicleDescription, row.status, row.grade, row.gradeLabel,
            row.conditionScore, row.hasNewDamage, row.groundingRisk, row.station, row.sessionKey, row.assessedAt,
            artifactId, JSON.stringify(row)]
        );
      }
      await client.query(
        `update app.integration_connections
            set status='healthy', last_checked_at=now(), last_success_at=now(), last_data_at=now(),
                last_auth_success_at=now(), consecutive_failures=0, last_error=null, reauth_required_at=null
          where integration_type='pave'`
      );
      return { artifactId, rows: artifact.rows.length };
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
      const artifactResult = await client.query(
        `insert into app.connector_artifacts
          (tenant_id,integration_type,job_id,feed,reporting_period,storage_key,content_sha256,captured_at,metadata)
         values ($1,'amazon',$2,$3,$4,$5,$6,$7,$8::jsonb)
         on conflict (tenant_id,integration_type,content_sha256) do update set captured_at=excluded.captured_at
         returning id`,
        [tenantId, jobId, feedGroup, `${periodStart}/${periodEnd}`, artifact.key, artifact.sha256,
          artifact.capturedAt, JSON.stringify({ contentType: artifact.contentType, byteLength: artifact.byteLength })]
      );
      if (feedGroup === 'fleet_condition' && artifact.normalized?.report) {
        const report = artifact.normalized.report;
        const saved = await client.query(
          `insert into app.fleet_condition_reports
            (tenant_id,artifact_id,captured_at,previous_quarter_fca_percent,previous_quarter_wear_tear_percent,
             current_quarter_fca_percent,current_quarter_wear_tear_percent,eligible_vehicle_count,
             compliant_vehicle_count,wear_tear_passing_count)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           on conflict (tenant_id,artifact_id) do update set captured_at=excluded.captured_at
           returning id`,
          [tenantId, artifactResult.rows[0].id, report.capturedAt, report.previousQuarterFcaPercent,
            report.previousQuarterWearTearPercent, report.currentQuarterFcaPercent,
            report.currentQuarterWearTearPercent, report.eligibleVehicleCount,
            report.compliantVehicleCount, report.wearTearPassingCount]
        );
        for (const vehicle of artifact.normalized.vehicles || []) await client.query(
          `insert into app.fleet_condition_vehicles
            (report_id,tenant_id,vin,make,model,year,due_date,last_pave_at,wear_tear_grade,fca_status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           on conflict (report_id,vin) do update set make=excluded.make,model=excluded.model,year=excluded.year,
             due_date=excluded.due_date,last_pave_at=excluded.last_pave_at,wear_tear_grade=excluded.wear_tear_grade,fca_status=excluded.fca_status`,
          [saved.rows[0].id, tenantId, vehicle.vin, vehicle.make, vehicle.model, vehicle.year,
            vehicle.dueDate, vehicle.lastPaveAt, vehicle.wearTearGrade, vehicle.fcaStatus]
        );
      }
      await client.query(
        `update app.connector_jobs set status='completed', finished_at=now(), result=$2::jsonb where id=$1`,
        [jobId, JSON.stringify({ feedGroup, periodStart, periodEnd, artifactKey: artifact.key })]
      );
      await client.query(
        `update app.tenant_onboarding_backfills
            set status='completed', completed_sources='["amazon"]'::jsonb, last_error=null, updated_at=now()
          where feed_group=$1 and period_start=$2 and period_end=$3`, [feedGroup, periodStart, periodEnd]
      );
      await client.query(
        `update app.integration_connections
            set status='healthy', last_checked_at=now(), last_success_at=now(), last_data_at=now(),
                last_auth_success_at=now(), consecutive_failures=0, last_error=null, reauth_required_at=null
          where integration_type='amazon'`
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
