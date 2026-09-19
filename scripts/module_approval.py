#!/usr/bin/env python3
"""Generic tamper-evident approval records for non-Fixed-Monthly modules."""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_QUEUE = ROOT / "data/module_approvals"
AUTHORIZED_RECIPIENT = "jason@jeclogs.com"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def evidence_list(case: dict[str, Any]) -> list[dict[str, Any]]:
    raw = case.get("evidence") or []
    if isinstance(raw, dict):
        raw = [raw]
    return [item for item in raw if isinstance(item, dict)]


def verify_case_evidence(case_path: Path, state: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    case = json.loads(case_path.read_text(encoding="utf-8"))
    verified = []
    for item in evidence_list(case):
        source = item.get("path") or item.get("reconciliation_path")
        expected = item.get("sha256") or item.get("reconciliation_sha256")
        if not source or not expected:
            raise RuntimeError("case evidence lacks path or SHA-256")
        path = Path(source)
        if not path.exists() or sha256(path) != expected:
            raise RuntimeError(f"case evidence is missing or changed: {path}")
        verified.append({"type": item.get("type", "evidence"), "path": str(path.resolve()), "sha256": expected})
    if not verified:
        raise RuntimeError("case has no verifiable evidence")
    if state and sha256(case_path) != state["case"]["sha256"]:
        raise RuntimeError("case document is missing or changed")
    return verified


def identifier(case: dict[str, Any], digest: str) -> str:
    module = re.sub(r"[^A-Z0-9]", "", str(case["module_id"]).upper())[:10]
    key = re.sub(r"[^A-Z0-9]", "", str(case["external_key"]).upper())[-12:]
    return f"{module}-{key}-{digest[:10].upper()}"


def candidate_findings(case: dict[str, Any]) -> list[dict[str, Any]]:
    return [item for item in case.get("findings", []) if item.get("dispute_candidate")]


def render_html(state: dict[str, Any]) -> str:
    rendered_rows = []
    for item in state["candidates"]:
        label = item.get("date") or item.get("claim_id") or item.get("employee_id") or item.get("program_id") or item.get("check") or "Finding"
        direction = item.get("direction") or item.get("status") or "review"
        rendered_rows.append(
            "<tr>"
            f"<td>{html.escape(str(label))}</td>"
            f"<td>{html.escape(str(direction))}</td>"
            f"<td>{html.escape(str(item.get('difference', '—')))}</td>"
            "</tr>"
        )
    rows = "".join(rendered_rows)
    decision = (
        f'<div class="approval"><strong>Approval requested</strong><br>Reply with exactly <strong>YES</strong> in this thread to authorize only this case. Reply <strong>NO</strong> to decline.<br><span class="muted">Approval ID: {html.escape(state["approval_id"])}</span></div>'
        if state["candidates"] else
        '<div class="complete"><strong>Review complete</strong><br>No dispute candidate was identified. No reply is required.</div>'
    )
    findings = (
        f'<h2>Dispute candidates</h2><table><thead><tr><th>Item</th><th>Reason</th><th>Difference</th></tr></thead><tbody>{rows}</tbody></table>'
        if state["candidates"] else ""
    )
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#17212b;line-height:1.45;max-width:760px;margin:auto;padding:20px}}
table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #d9dee3;padding:8px;text-align:left;font-size:13px}}th{{background:#eef2f5}}
.approval{{background:#fff4db;border:1px solid #e6a700;padding:16px;border-radius:8px}}.complete{{background:#e9f7ef;border:1px solid #3a9d5d;padding:16px;border-radius:8px}}.muted{{color:#5f6b76;font-size:13px}}</style></head><body>
<h1>{html.escape(state['module_id'].replace('_',' ').title())} review</h1>
<p><strong>Case:</strong> {html.escape(state['external_key'])}</p>
{decision}{findings}
<p class="muted">Approval is bound to this exact case hash and source evidence. Changed evidence requires a new approval.</p>
</body></html>"""


def prepare(case_path: Path, queue_root: Path = DEFAULT_QUEUE) -> tuple[Path, dict[str, Any]]:
    case_path = case_path.resolve(strict=True)
    case = json.loads(case_path.read_text(encoding="utf-8"))
    candidates = candidate_findings(case)
    if case.get("blocking_evidence"):
        raise RuntimeError("case still has blocking evidence")
    expected_status = "approval_required" if candidates else "closed"
    if case.get("status") != expected_status:
        raise RuntimeError(f"case is not approval-ready: {case.get('status')}")
    verified = verify_case_evidence(case_path)
    case_hash = sha256(case_path)
    approval_id = identifier(case, case_hash)
    state_path = queue_root.resolve() / case["module_id"] / approval_id / "approval.json"
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if state["case"]["sha256"] != case_hash:
            raise RuntimeError("approval ID collision")
        return state_path, state
    state = {
        "version": 1, "approval_id": approval_id, "module_id": case["module_id"],
        "external_key": case["external_key"], "tenant_id": case.get("tenant_id", "jecs"),
        "created_at": now(), "recipient": AUTHORIZED_RECIPIENT,
        "case": {"path": str(case_path), "sha256": case_hash}, "evidence": verified,
        "candidates": candidates, "status": "prepared" if candidates else "prepared_no_dispute",
        "approval_rule": "Exact YES or NO from jason@jeclogs.com in the original email thread; single use.",
        "external_action_authorized": False,
        "events": [{"at": now(), "event": "prepared"}],
    }
    state_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    review_path = state_path.parent / "review.html"
    review_path.write_text(render_html(state), encoding="utf-8")
    os.chmod(review_path, 0o600)
    atomic_json(state_path, state)
    return state_path, state


def verify_immutable_sources(state: dict[str, Any]) -> None:
    case_path = Path(state["case"]["path"])
    if not case_path.exists():
        raise RuntimeError("case document is missing")
    verify_case_evidence(case_path, state)


def apply_decision(state_path: Path, decision: dict[str, Any]) -> dict[str, Any]:
    state = json.loads(state_path.read_text(encoding="utf-8"))
    if state["status"] != "awaiting_approval":
        raise RuntimeError(f"approval is not awaiting a decision: {state['status']}")
    verify_immutable_sources(state)
    normalized = str(decision["decision"]).strip().upper()
    if normalized not in {"YES", "NO"}:
        raise RuntimeError("decision must be exact YES or NO")
    if str(decision["from"]).strip().lower() != AUTHORIZED_RECIPIENT:
        raise RuntimeError("decision sender is not authorized")
    if str(decision["original_message_id"]).strip("<>") != state["sent"]["message_id"].strip("<>"):
        raise RuntimeError("decision is not tied to the sent approval email")
    state["decision"] = {**decision, "decision": normalized}
    state["external_action_authorized"] = normalized == "YES"
    state["status"] = "approved" if normalized == "YES" else "declined"
    state["events"].append({"at": decision["received_at"], "event": state["status"], "reply_message_id": decision["reply_message_id"]})
    atomic_json(state_path, state)
    return state


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("prepare")
    create.add_argument("--case", type=Path, required=True)
    create.add_argument("--queue", type=Path, default=DEFAULT_QUEUE)
    verify = sub.add_parser("verify")
    verify.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "prepare":
        path, state = prepare(args.case, args.queue)
        result = {"state": str(path), "approval_id": state["approval_id"], "status": state["status"]}
    else:
        state = json.loads(args.state.read_text(encoding="utf-8"))
        verify_immutable_sources(state)
        result = {"verified": True, "approval_id": state["approval_id"], "status": state["status"]}
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
