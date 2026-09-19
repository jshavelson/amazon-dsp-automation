# DSP Operations Platform

This directory is the multi-tenant product boundary around the existing JECS automations. Existing scripts remain the single-tenant reference implementation while adapters are migrated module by module.

## Independently billable modules

- Executive Operations Dashboard
- Secure Data Integrations
- Fixed Monthly Fleet Reconciliation
- Weekly Variable and Incentive Review
- Capacity and Reliability Review
- FIF Reimbursement Review
- Fifth-Day Overtime Support
- Next Mile Tuition Reconciliation
- Meals, Awards, and Adjustments

Each module owns a manifest and billing SKU under `platform/modules/`. Tenant access requires both a membership role and an active/trial entitlement. External actions still require a separate evidence-bound approval.

## Current implementation stage

- Module catalog and SKU separation: implemented.
- Tenant roles and module authorization: implemented as a tested domain layer.
- PostgreSQL tenant schema, migration ledger, row-level security, and least-privilege runtime role: deployed to the JECS production pilot.
- Managed-secret references and tenant validation: implemented; AWS Secrets Manager is the production vault target.
- AWS Secrets Manager provider: implemented with tenant-prefixed paths and mandatory metadata-only access auditing.
- Protected web UI and Cognito PKCE session handling: deployed behind CloudFront with required TOTP MFA.
- Fixed Monthly adapter: existing production workflow is operational; tenant-scoped adapter is next.
- Other module runners: remain in development or evidence-blocked as declared in each manifest.

## AWS production pilot

JECS owner URL: `https://dpgr55hwybqff.cloudfront.net/`

The first owner login requires the temporary password from the Cognito invitation email, a permanent password, and TOTP enrollment. The dashboard and protected APIs remain inaccessible until authentication and tenant entitlement checks succeed.

Verified controls include a private encrypted PostgreSQL database with seven-day backups, Secrets Manager database credentials, required software-token MFA, CloudFront HTTPS, a direct-origin 403 response, a read-only non-root application container, and explicit tenant/module authorization.

## Local checks

```bash
npm run platform:test
```

## Private pilot preview

Publish the no-credentials website shell into the existing tailnet-only dashboard host:

```bash
npm run platform:publish-preview
```

Owner URL: `https://oc-agents-mac-mini-1.tailee63c6.ts.net:8443/platform/`

This preview requires Tailscale and remains useful for local development. It is separate from the AWS production pilot above.

Do not copy `.openclaw` session files, API keys, passwords, certificates, payroll files, or tenant artifacts into this directory or a deployment bundle.

See [security architecture](docs/security-architecture.md) and [production hosting plan](docs/hosting-plan.md).
See [service transition readiness](docs/service-transition-readiness.md) before retiring any incumbent process.
## Payment and reimbursement reconciliation modules

Nine separately licensed modules are registered under `platform/modules/`.
Fixed Monthly, Weekly Payments, and Capacity & Reliability are active against
JECS source data. FIF, Fifth-Day Overtime, Next Mile Tuition, and Program
Adjustments are import-ready and intentionally report missing source evidence
instead of assuming a zero. The Executive Dashboard and Data Integrations are
separate platform SKUs.

Every reconciliation case is evidence-hashed and defaults to
`external_action_authorized: false`. Fixed Monthly is the only module currently
wired through the complete owner-email approval and guarded Amazon submission
flow. All other modules now share the same tamper-evident email approval,
same-thread YES/NO monitor, and single-use submission guard. They stop before
Amazon submission until an adapter is implemented and verified for that
specific portal workflow; a generic final-click adapter is intentionally
prohibited.
