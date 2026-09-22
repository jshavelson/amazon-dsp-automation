"""Bounded tenant operations exposed to the application AI assistant.

The model never receives filesystem or shell access.  It can only call the
strict functions declared here.  Workflow tools use the canonical evaluator
and never submit disputes or perform other external actions.
"""
from __future__ import annotations

import csv
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCORECARD_ROOT = ROOT / "data" / "scorecard_data"
WEEK_RE = re.compile(r"^20\d{2}-wk(?:0[1-9]|[1-4]\d|5[0-3])$")
READABLE_SUFFIXES = {".csv", ".json", ".md", ".txt"}
MAX_FILE_BYTES = 64_000
MAX_ROWS = 200


TOOLS = [
    {
        "type": "function", "name": "list_scorecard_weeks",
        "description": "List available Amazon DSP scorecard weeks and whether summary/dispute outputs exist.",
        "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
        "strict": True,
    },
    {
        "type": "function", "name": "list_week_files",
        "description": "List source and output files available for one scorecard week.",
        "parameters": {
            "type": "object", "properties": {"week": {"type": "string", "description": "YYYY-wkNN"}},
            "required": ["week"], "additionalProperties": False,
        }, "strict": True,
    },
    {
        "type": "function", "name": "read_week_file",
        "description": "Read a bounded CSV, JSON, Markdown, or text file from one scorecard week. Use list_week_files first.",
        "parameters": {
            "type": "object", "properties": {
                "week": {"type": "string", "description": "YYYY-wkNN"},
                "file": {"type": "string", "description": "Exact relative filename returned by list_week_files"},
            }, "required": ["week", "file"], "additionalProperties": False,
        }, "strict": True,
    },
    {
        "type": "function", "name": "run_week_evaluation",
        "description": "Run the canonical local weekly evaluation from frozen source exports. Generates summary, disputes, PDFs, and review evidence; never submits a dispute.",
        "parameters": {
            "type": "object", "properties": {"week": {"type": "string", "description": "YYYY-wkNN"}},
            "required": ["week"], "additionalProperties": False,
        }, "strict": True,
    },
]


def _week_folder(week: str) -> Path:
    value = str(week or "").strip().lower()
    if not WEEK_RE.fullmatch(value):
        raise ValueError("week must use YYYY-wkNN format")
    folder = SCORECARD_ROOT / value
    if not folder.is_dir():
        raise FileNotFoundError(f"scorecard week is unavailable: {value}")
    return folder


def _safe_week_file(week: str, relative_name: str) -> Path:
    folder = _week_folder(week).resolve()
    name = str(relative_name or "").strip()
    candidate = (folder / name).resolve()
    if candidate == folder or folder not in candidate.parents:
        raise ValueError("file must remain inside the requested week")
    if not candidate.is_file() or candidate.suffix.lower() not in READABLE_SUFFIXES:
        raise FileNotFoundError("requested readable week file is unavailable")
    return candidate


def _list_weeks() -> dict:
    weeks = []
    for folder in sorted(SCORECARD_ROOT.glob("20??-wk??"), reverse=True):
        if not folder.is_dir() or not WEEK_RE.fullmatch(folder.name):
            continue
        number = folder.name[-2:]
        files = {item.name for item in folder.iterdir() if item.is_file()}
        weeks.append({
            "week": folder.name,
            "summary": f"week{number}-summary.md" in files,
            "disputes": f"week{number}-disputes.md" in files,
            "snapshotMetadata": "snapshot-metadata.json" in files,
            "fileCount": len(files),
        })
    return {"weeks": weeks}


def _list_files(week: str) -> dict:
    folder = _week_folder(week)
    files = []
    for item in sorted(folder.rglob("*")):
        if not item.is_file() or item.suffix.lower() not in READABLE_SUFFIXES:
            continue
        files.append({"file": str(item.relative_to(folder)), "bytes": item.stat().st_size})
    return {"week": folder.name, "files": files}


def _read_file(week: str, relative_name: str) -> dict:
    path = _safe_week_file(week, relative_name)
    raw = path.read_bytes()[:MAX_FILE_BYTES]
    truncated = path.stat().st_size > len(raw)
    if path.suffix.lower() == ".csv":
        text = raw.decode("utf-8-sig", "replace")
        rows = list(csv.DictReader(text.splitlines()))[:MAX_ROWS]
        content = {"columns": list(rows[0]) if rows else [], "rows": rows}
        truncated = truncated or len(rows) >= MAX_ROWS
    elif path.suffix.lower() == ".json":
        text = raw.decode("utf-8", "replace")
        try:
            content = json.loads(text)
        except json.JSONDecodeError:
            content = text
    else:
        content = raw.decode("utf-8", "replace")
    return {"week": week, "file": relative_name, "content": content, "truncated": truncated}


def _run_evaluation(week: str) -> dict:
    folder = _week_folder(week)
    command = [
        sys.executable, str(ROOT / "scripts" / "evaluate_week_request.py"), folder.name,
        "--refresh-source", "false", "--render-pdf", "true",
        "--include-dispute-review", "true", "--include-monitor", "true",
        "--include-business-closed-timing", "true", "--include-pickup-evidence", "true",
    ]
    completed = subprocess.run(
        command, cwd=ROOT, capture_output=True, text=True, timeout=300, check=False,
    )
    output = (completed.stdout + "\n" + completed.stderr).strip()[-12_000:]
    if completed.returncode:
        raise RuntimeError(f"weekly evaluation failed (exit {completed.returncode}): {output}")
    number = folder.name[-2:]
    expected = [folder / f"week{number}-summary.md", folder / f"week{number}-disputes.md"]
    return {
        "week": folder.name, "status": "completed", "submitted": False,
        "outputs": [str(path.relative_to(ROOT)) for path in expected if path.exists()],
        "log": output,
    }


def execute(name: str, arguments: dict, *, allow_workflows: bool) -> dict:
    if name == "list_scorecard_weeks":
        return _list_weeks()
    if name == "list_week_files":
        return _list_files(arguments.get("week"))
    if name == "read_week_file":
        return _read_file(arguments.get("week"), arguments.get("file"))
    if name == "run_week_evaluation":
        if not allow_workflows:
            raise PermissionError("your role cannot run weekly evaluation workflows")
        return _run_evaluation(arguments.get("week"))
    raise ValueError(f"unknown assistant tool: {name}")
