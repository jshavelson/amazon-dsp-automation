# Managed Amazon connector

## Production contract

Amazon does not use a password form or a shared application cookie. Each tenant
owns one isolated managed-browser profile and completes Amazon MFA directly in a
short-lived interactive session.

The web application is the control plane only:

1. `POST /api/connections/amazon/reconnect` creates an expiring
   `connector_sessions` row and an idempotent `connector_jobs` row.
2. A credential-free FIFO message is grouped by tenant so two jobs cannot mutate
   the same profile concurrently.
3. A connector worker in the private connector subnets mounts the encrypted EFS
   profile volume and uses the fixed NAT egress address.
4. A separate connector ECS service opens the tenant's persistent Playwright context and exposes only Cognito-protected screenshot and input endpoints under `/connector/api/`.
5. The tenant owner completes Amazon sign-in and MFA. Amazon credentials and MFA
   codes never enter the DSP application, database, queue, logs, or audit data.
6. The worker validates Logistics, Payments, and Fleet Portal independently
   before marking the connection healthy. Feed-specific collection jobs must
   additionally validate their own report endpoint before accepting data.
7. Raw artifacts use
   `tenants/{tenant}/amazon/{sha12}-{filename}` in the private connector artifact
   bucket. Normalized records are written under tenant RLS.

## Isolation requirements

- One validated EFS profile directory per tenant: `/profiles/{tenant}/amazon`.
- FIFO `MessageGroupId` equals the tenant slug.
- Every database row contains `tenant_id` and is protected by RLS.
- Every browser launch URL is single-use, Cognito-bound, and expires in at most
  15 minutes.
- Browser frames and inputs are routed to the connector target group and require
  the same Cognito identity plus explicit tenant header as the application.
- Session cookies are never returned by an API or stored in PostgreSQL.
- Connector artifacts are encrypted, private, versioned, and tenant-prefixed.

## Safe rollout state

The CloudFormation parameter defaults off so direct stack updates fail closed.
The canonical deployment command explicitly enables it after the connector
security and browser gates pass. An emergency deployment may set
`ENABLE_MANAGED_CONNECTOR=false` without deleting the retained profile store.

## Implementation boundary

The control plane, tenant-isolated interactive authentication broker, persistent
profile store, health checks, queue, and artifact store are implemented. The
existing Amazon report parsers still need to be moved behind `sync` jobs before
AWS becomes the system that refreshes every normalized feed. Until that port is
complete, a healthy managed browser proves authentication only; it does not
claim that every report has been ingested.

## Worker/broker acceptance criteria

The managed connector may be enabled only after all of these checks pass:

- two test tenants cannot see or mount each other's profile or artifacts;
- concurrent jobs for one tenant serialize while different tenants run in parallel;
- expired launch URLs fail closed;
- reconnect captures no password, MFA value, or cookie in logs or database rows;
- Logistics, Cortex, Payments, and Fleet health probes all pass independently;
- a revoked session changes status to `needs_reauth` and queues no endless retries;
- normalized data reaches PostgreSQL without rebuilding or redeploying the app.
