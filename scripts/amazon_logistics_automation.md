# Amazon Logistics Download Automation

This uses **Option A**: save a logged-in browser session once, then reuse that session for future download runs.

## What this setup does
- opens Amazon Logistics in a real browser for a one-time manual login
- saves Playwright `storageState` locally
- reopens Amazon Logistics later with that saved session
- writes weekly report downloads into `data/scorecard_data/YYYY-wkNN/`

## Files
- `scripts/amazon_logistics.config.json`
- `scripts/amazon_logistics_login.mjs`
- `scripts/amazon_logistics_download.mjs`
- `package.json`

## Command reference

For the full command list covering download, full evaluation, and the modular summary / disputes / dispute-review / monitor scripts, see:

- `data/manuals/evaluation-cli-commands.md`

## Required config for scripted exports
Set these in `scripts/amazon_logistics.config.json`:
- `stationCode` (example: `DFH7`)
- `dspCode` (example: `JECS`)
- `companyId` (DSP UUID from the performance portal)
- optional but included now: `performancePortalUrl`, `performanceApiBaseUrl`, `program`

## One-time install
From repo root:

```bash
npm install
npx playwright install chromium
```

## One-time login / session capture
```bash
npm run amazon:login
```

What happens:
- a visible Chromium browser opens
- you log into `https://logistics.amazon.com/`
- complete MFA if prompted
- once fully inside Logistics, return to terminal and press Enter
- session state is saved to:
  - `.openclaw/amazon-logistics-storage-state.json`

## Weekly download run
Example:

```bash
mkdir -p data/scorecard_data/2026-wk18
npm run amazon:download -- --week-folder data/scorecard_data/2026-wk18
```

What happens:
- browser opens already logged in using saved session state
- the script auto-generates the core weekly CSV analysis files through the Amazon Logistics performance API
- it downloads only the files required for weekly analysis/report generation
- the downloader validates that all required analysis files are present before finishing
- a `download-manifest.json` file is written into the week folder showing matched and missing reports
- a `run-status.json` checkpoint file is written into the week folder so interrupted runs can resume cleanly
- terminal prints the saved files and a summary

## Persistent session health

The saved Amazon authentication cookies currently persist across browser and
machine restarts. Check and refresh the reusable state without opening a login
window:

```bash
npm run amazon:session-check
```

Successful Amazon download and WST snapshot runs also write refreshed session
state back to disk. The state file is restricted to the local user (`0600`).
This removes daily login work, but it cannot bypass an Amazon server-side
revocation, password change, or MFA challenge; those require one new interactive
`amazon:login` run.

## Current mode
This is now a **hybrid downloader** on top of a saved session.

That means:
- login is reused automatically
- the script auto-generates the core weekly CSV analysis files through the Amazon Logistics performance API
- the script auto-downloads only the supplementary files actually needed for weekly analysis (Capacity, Compliance, Sentiment, DVIC, tenure, and escalations)
- manual navigation is now opt-in only for recovery cases not exposed through those feeds yet
- downloads themselves are captured automatically into the correct week folder
- the run stops if a required analysis file is missing unless you explicitly allow missing files

## Why this is the right first step
Amazon Logistics flows can change often, and auth/MFA can be touchy. This gives you:
- reliable session reuse
- no credential storage in scripts
- low risk of brittle login automation
- a clean path to later fully automate specific report pages once selectors are mapped

## Notes
- Required analysis files are configured in `scripts/amazon_logistics.config.json`.
- The downloader is non-interactive by default, so it will not hang waiting for manual confirmation after the automated exports.
- The downloader now defaults to **headless mode** unless you explicitly enable manual assist, and it applies hard request/navigation/overall timeouts so stalled Amazon pages fail fast instead of sitting forever.
- The downloader now checkpoints each phase and skips files already present, so re-running the same week resumes from the partial state instead of starting from scratch.
- If a prior run failed and you only want to retry the failed API/source steps from `run-status.json`, use:

```bash
npm run amazon:download -- --week-folder data/scorecard_data/2026-wk18 --retry-failures-only true
```
- Use manual assist only if you intentionally want to recover missing files in the browser:

```bash
npm run amazon:download -- --week-folder data/scorecard_data/2026-wk18 --manual-assist true
```

- You can validate an existing week folder without opening the browser:

```bash
npm run amazon:download -- --week-folder data/scorecard_data/2026-wk18 --validate-only true
```

- You can run only the API-backed exports:

```bash
npm run amazon:download -- --week-folder data/scorecard_data/2026-wk18 --auto-export-only true
```

- You can skip the API-backed exports and use the old manual-only flow:

```bash
npm run amazon:download -- --week-folder data/scorecard_data/2026-wk18 --skip-auto-export true --manual-assist true
```

- To generate the required weekly deliverables from an already-downloaded folder:

```bash
npm run amazon:analyze -- data/scorecard_data/2026-wk18 --force true --render-pdf true
```

- To handle an `evaluate week xx` style request with a faster preflight that resolves the folder, avoids unnecessary full downloads, and then analyzes:

```bash
npm run amazon:evaluate-week -- 22
```

By default this reuses an existing week snapshot instead of redownloading it. To refresh source files on an existing week, pass `--refresh-source true`.

You can also pass the full label and dispute caps:

```bash
npm run amazon:evaluate-week -- 2026-wk22 --refresh-source true --max-dispute-candidates 5 --max-dispute-review-candidates 5
```

- Weekly PDFs now render through the lightweight local renderer in `scripts/render_markdown_to_pdf.py` for faster end-to-end analysis runs.

- To run download + evaluation end-to-end for a future week:

```bash
npm run amazon:weekly -- data/scorecard_data/2026-wk19
```

- If you intentionally want to finish a run with missing files, pass:

```bash
npm run amazon:download -- --week-folder data/scorecard_data/2026-wk18 --allow-missing true
```

- If Amazon is slow and you want to tune the fail-fast limits, you can override them per run:

```bash
npm run amazon:download -- --week-folder data/scorecard_data/2026-wk18 --request-timeout-ms 90000 --navigation-timeout-ms 90000 --overall-timeout-ms 1800000
```

## Next upgrade
The biggest remaining gaps are report types that are not surfaced by the supplementary/documents feeds yet, such as any still-manual dashboard exports you want beyond the current required set.

## Scheduling
Once this flow is stable, you can schedule a reminder or job to run it on publish day. I have not scheduled it yet.
