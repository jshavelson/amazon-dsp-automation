# Service transition readiness

The incumbent reconciliation service should remain active until the platform demonstrates operational replacement, not merely feature presence.

## Required capabilities

1. Pull every required Amazon, payroll, fleet, email, and operations source on the expected schedule.
2. Preserve immutable pre-change and post-change source snapshots with hashes and timestamps.
3. Reconcile Fixed Monthly, Weekly Payments, Capacity and Reliability, FIF, Fifth-Day Overtime, Next Mile Tuition, and Program Adjustments as independently licensed modules.
4. Detect both open underpayments and recoveries already reflected in a later invoice or work summary.
5. Deliver evidence-backed review emails with a clear value estimate and same-thread YES/NO approval.
6. Submit only through a module-specific, tested adapter after evidence-bound owner approval.
7. Capture portal confirmation, case identifiers, disposition, and recovered dollars.
8. Alert on stale sources, missed deadlines, failed pulls, uncertain submission state, and unreconciled source drift.
9. Maintain tenant isolation, MFA, least-privilege secrets, immutable audit history, and recoverable backups.

## Cutover gate

Retirement is permitted only after at least four consecutive side-by-side cycles meet all of these conditions:

- no missed eligible recovery or dispute;
- no duplicate or unauthorized submission;
- all source pulls complete within the required review window;
- recovered-dollar totals reconcile to final Amazon payment evidence;
- every exception has traceable evidence and an audit record;
- owner review confirms the platform output is at least as detailed and timely as the incumbent output.

Any missed recovery, stale-source publication, unexplained variance, or submission ambiguity resets the consecutive-cycle count.
