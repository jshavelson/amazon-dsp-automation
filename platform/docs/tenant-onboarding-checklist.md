# Amazon DSP Platform — Tenant Onboarding Checklist

**Version:** 2.0
**Updated:** September 22, 2026

Use this checklist to collect business configuration and source ownership. Do not place passwords, tokens, private keys, browser sessions, MFA seeds, or certificate contents in this document.

> **Credential rule:** Configure secret values only through the tenant vault or the product's secure reconnect flow. Store only `secret://...` references in application records.

## 1. Company and tenant

- [ ] Legal company name and DBA
- [ ] Tenant display name and approved URL slug
- [ ] Business address, timezone, currency, and reporting-week start
- [ ] Primary operations contact and backup contact
- [ ] Billing contact and billing reference
- [ ] Data-retention and account-closure contacts

## 2. Amazon DSP operation

- [ ] DSP company ID and short code
- [ ] Station code, station name, address, and timezone
- [ ] Additional operating stations
- [ ] Normal route count and peak route count
- [ ] Typical daily package volume
- [ ] Amazon business coach and station contacts
- [ ] Scorecard reporting cadence and first historical week

## 3. Initial users and access

- [ ] Tenant owner name and verified email
- [ ] Additional administrators, reviewers, analysts, and viewers
- [ ] Software-token MFA communicated to every user
- [ ] Minimum required role confirmed for each user
- [ ] Approval contacts for disputes, payroll, and reimbursements
- [ ] Support impersonation policy acknowledged

## 4. Driver data

- [ ] Active and inactive driver roster
- [ ] Transporter IDs and payroll employee IDs
- [ ] Employment status, hire date, termination date, and home station
- [ ] Pay type, overtime policy, and payroll frequency
- [ ] Training, licensing, and document-expiration fields
- [ ] Historical roster effective dates

## 5. Fleet data

- [ ] VIN, van number, license plate, year, make, and model
- [ ] Ownership class and rental vendor
- [ ] Registration and insurance expiration dates
- [ ] Preventive-maintenance intervals and latest service
- [ ] DVIC readiness and out-of-service status
- [ ] PAVE / Wear & Tear evidence source
- [ ] EFR, LMR, rental, lease, and Amazon-owned classifications

## 6. Amazon connection

- [ ] Connection owner identified
- [ ] Secure browser-session handoff scheduled
- [ ] MFA recovery contact identified
- [ ] Company ID and station ID verified
- [ ] Required feeds confirmed: scorecards, supplementary reports, Delivery Execution, payments
- [ ] Reauthentication procedure and fallback email reports confirmed
- [ ] Expected refresh schedule and freshness thresholds approved

## 7. Payroll connection

- [ ] Provider and company code recorded
- [ ] API availability confirmed
- [ ] Client certificate ownership and expiration recorded
- [ ] Required secret names created in the tenant vault
- [ ] Pay-period boundaries and overtime rules confirmed
- [ ] Manual payroll-register fallback tested
- [ ] Employee identifier mapping validated

## 8. Accounting and reimbursement evidence

- [ ] Source selected: Digits, QuickBooks, API, or manual CSV/XLSX
- [ ] Included expense categories confirmed
- [ ] Never-reimbursable categories confirmed
- [ ] Vendor-to-Amazon-coverage rules reviewed
- [ ] Posting period and invoice basis documented
- [ ] Upload preview, vendor mapping, and confirmation owner assigned
- [ ] Known period totals selected for reconciliation testing

## 9. Optional vendor connections

For each rental, maintenance, fuel, insurance, telematics, or compliance provider:

- [ ] Provider and connection display name
- [ ] Authentication kind: API, browser session, IMAP, or manual upload
- [ ] Schedule and screens fed
- [ ] Secret reference names required (values excluded)
- [ ] Last-success and `needs_reauth` escalation contacts
- [ ] Manual fallback and export format

## 10. Product modules and feature access

- [ ] Executive dashboard
- [ ] Secure data integrations
- [ ] Fixed monthly fleet reconciliation
- [ ] Weekly payments and incentives
- [ ] Capacity and reliability review
- [ ] FIF reimbursements
- [ ] Fifth-day overtime support
- [ ] Next Mile tuition
- [ ] Program adjustments
- [ ] Tenant-specific disabled features recorded

## 11. Historical import and acceptance

- [ ] Historical date range approved
- [ ] Scorecard and payroll periods labeled independently
- [ ] Files malware-scanned and stored under the tenant prefix
- [ ] Row counts and source fingerprints recorded
- [ ] Known totals reproduced exactly
- [ ] Cross-tenant isolation test passed
- [ ] Empty/new-tenant screens verified without shared fallback data

## 12. Launch approval

- [ ] Tenant owner validates users, modules, and connections
- [ ] Dashboard freshness indicators reviewed
- [ ] Evaluation and dispute-preparation workflow tested
- [ ] External submissions remain approval-gated
- [ ] Audit trail reviewed
- [ ] Recovery contacts and support process delivered
- [ ] Production launch approved by tenant owner and platform administrator

## Secure connection inventory

| Source | Auth kind | Secret reference created | Schedule | Last-success owner | Reconnect owner |
|---|---|---|---|---|---|
| Amazon | Browser session / email fallback | [ ] | | | |
| ADP | API certificate / register upload | [ ] | | | |
| Accounting | API / manual upload | [ ] | | | |
| PAVE | API / portal | [ ] | | | |
| Other | | [ ] | | | |

## Sign-off

| Role | Name | Date | Approval |
|---|---|---|---|
| Tenant owner | | | [ ] |
| Platform administrator | | | [ ] |
| Data connection owner | | | [ ] |
