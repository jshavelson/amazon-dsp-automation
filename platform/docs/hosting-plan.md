# Production hosting plan

## Recommended topology

- **Web/API:** containerized Node service behind an AWS Application Load Balancer and WAF.
- **Workers:** separate ECS/Fargate service for Playwright, Amazon, ADP, email, and report jobs. Browser automation never runs in the public web container.
- **Database:** private Amazon RDS PostgreSQL with row-level security, automated backups, point-in-time recovery, and separate migration/application roles.
- **Secrets:** AWS Secrets Manager encrypted with KMS. Workers use IAM task roles; no static AWS credentials.
- **Artifacts:** private S3 bucket with tenant prefixes, KMS encryption, lifecycle rules, malware scanning, and short-lived signed downloads.
- **Queue:** SQS with tenant/module/idempotency metadata and dead-letter queues.
- **Identity:** OIDC provider with MFA and organization support. Auth0 or WorkOS is preferred for fast multi-tenant onboarding; Amazon Cognito is viable if AWS consolidation matters more than administration UX.
- **Billing:** Stripe products map one-to-one to module billing SKUs. A webhook changes `tenant_entitlements`; it does not approve external actions.
- **Observability:** CloudWatch logs/metrics, immutable application audit events, alarms for failed jobs, secret access anomalies, stale integrations, and cross-tenant authorization failures.

## Environments

Use separate AWS accounts for development, staging, and production. Each environment has independent databases, KMS keys, secret paths, buckets, queues, identity clients, and domains. Production credentials and tenant data never enter development or staging.

## Deployment gates

1. Provision infrastructure as code and private networking.
2. Apply database migrations with the migration role; verify RLS using two seeded test tenants.
3. Configure OIDC and require MFA for owner/admin/reviewer roles.
4. Configure Secrets Manager paths and IAM policies scoped by worker and environment.
5. Deploy API and workers with read-only root filesystems, non-root users, health checks, and outbound-network controls.
6. Run cross-tenant, IDOR, CSRF, SSRF, path traversal, upload, rate-limit, and approval-replay tests.
7. Complete backup restore, secret rotation, incident response, and tenant offboarding drills.
8. Import JECS as the pilot tenant only after staging passes every gate.

## Current production-pilot state

The JECS pilot is deployed in AWS `us-east-2` with Cognito PKCE authentication, required software-token MFA, CloudFront HTTPS, an origin-verification header, ECS/Fargate, private encrypted RDS PostgreSQL, seven-day automated backups, Secrets Manager database credentials, module entitlements, row-level security, and a seeded owner membership.

The public application container does not contain Amazon, ADP, email, payroll, or browser-session credentials. External integration workers, private artifact storage, WAF, queues, alarms, and billing automation remain separate production-hardening work and are not implied by the web pilot.

## Deployment package

- `platform/Dockerfile` runs the API as a non-root user with a health check.
- `platform/compose.yaml` is a hardened single-service staging launcher. It
  binds only to loopback and requires the database and OIDC settings at start.
- `platform/deployment.env.example` documents required configuration without
  containing usable credentials.
- `scripts/platform_deployment_preflight.py` rejects placeholders, non-TLS
  database URLs, non-HTTPS identity endpoints, missing migration assets, and a
  populated production dotenv accidentally placed in the repository.

The deployment intentionally does not bundle PostgreSQL, an identity provider,
or a secrets vault. Those are independent trust boundaries and must be created
in the selected cloud account. The application container accepts only a
least-privilege runtime database URL and validated OIDC configuration.
