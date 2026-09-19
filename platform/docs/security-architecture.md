# Security architecture

## Trust boundaries

1. The browser receives only tenant-scoped API responses and short-lived identity sessions.
2. The application verifies an external OIDC identity, resolves one tenant membership, and opens a database transaction with `app.current_tenant_id` and `app.current_identity_subject` set locally.
3. PostgreSQL row-level security independently rejects rows outside that tenant.
4. The application database stores only integration metadata and opaque secret references.
5. A managed secrets provider stores passwords, API keys, OAuth refresh tokens, client certificates, and Amazon session material under a tenant-specific path.
6. Workers resolve a secret only for the duration of one connector operation. Secret values are never returned to the browser, written to artifacts, included in logs, or stored in audit metadata.

The first production adapter targets AWS Secrets Manager. It derives the vault path as `dsp-platform/<tenant>/<integration>/<name>`, requests only `AWSCURRENT`, and requires an audit writer before every read. Authentication uses the worker's IAM task role; static AWS access keys are not application configuration.

## Required production controls

- OIDC with MFA support; no locally implemented password database.
- Secure, HTTP-only, SameSite cookies with CSRF protection for browser sessions.
- PostgreSQL TLS, row-level security, least-privilege application and migration roles, encrypted backups, and point-in-time recovery.
- Managed secrets vault with KMS encryption, tenant-specific access policies, rotation, access logging, and versioning.
- Private worker network for Amazon, ADP, email, and WhatsApp connector execution.
- Object storage with tenant prefixes, server-side encryption, short-lived signed downloads, malware scanning, and retention policies.
- Append-only audit events for authentication, configuration, secret access purpose, workflow execution, approval, and external submission.
- Rate limiting, request-size limits, strict input validation, CSP, HSTS, dependency scanning, and centralized security alerts.
- Separate development, staging, and production accounts. Production data and credentials never enter development.

## Secret reference format

`secret://<tenant-slug>/<provider>/<integration>/<name>`

Example: `secret://jec-logistics/aws/adp/client-certificate`

The tenant in the authenticated context must exactly match the tenant in the reference. Database configuration JSON rejects common plaintext secret keys.

## External actions

Every module keeps its own approval policy. An entitlement permits access to a feature; it never authorizes an external submission. Approval is bound to the tenant, module, case, evidence hash, approver identity, and one submission claim.
