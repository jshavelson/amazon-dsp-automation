"""Tenant-scoped AI assistant gateway used by the local development API.

The browser never receives the platform OpenAI key.  The caller supplies a
bounded, read-only operational snapshot and this module sends only that
snapshot plus recent conversation turns to the Responses API.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

try:
    from scripts.secret_store import get_secret, has_secret
except ModuleNotFoundError:  # Direct execution from scripts/jecs_api_server.py
    from secret_store import get_secret, has_secret

ROOT = Path(__file__).resolve().parents[1]
MAX_MESSAGE = 4_000
MAX_HISTORY_TURNS = 10
MAX_CONTEXT_BYTES = 48_000


def _api_key(tenant: str) -> str | None:
    value = os.environ.get("OPENAI_API_KEY", "").strip()
    if value:
        return value
    if has_secret(tenant, "openai", "api-key"):
        return get_secret(tenant, "openai", "api-key")
    return None


def status(tenant: str) -> dict:
    return {
        "configured": bool(_api_key(tenant)),
        "model": os.environ.get("OPENAI_ASSISTANT_MODEL", "gpt-5-mini"),
        "voiceMode": "browser",
        "readOnly": True,
        "tenant": tenant,
    }


def _clean_history(history) -> list[dict]:
    if not isinstance(history, list):
        return []
    cleaned = []
    for item in history[-MAX_HISTORY_TURNS:]:
        if not isinstance(item, dict) or item.get("role") not in ("user", "assistant"):
            continue
        content = str(item.get("content") or "").strip()[:MAX_MESSAGE]
        if content:
            cleaned.append({"role": item["role"], "content": content})
    return cleaned


def _audit(tenant: str, actor: str, event: dict) -> None:
    directory = ROOT / "data" / "tenants" / tenant / "assistant"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "audit.jsonl"
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tenant": tenant,
        "actor": actor,
        **event,
    }
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(descriptor, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, separators=(",", ":"), default=str) + "\n")
    os.chmod(path, 0o600)


def ask(*, tenant: str, actor: str, message: str, history, page: dict, snapshot: dict) -> dict:
    question = str(message or "").strip()
    if not question or len(question) > MAX_MESSAGE:
        raise ValueError(f"message must contain 1-{MAX_MESSAGE} characters")
    key = _api_key(tenant)
    if not key:
        raise RuntimeError("AI assistant is not configured. A platform administrator must configure the OpenAI API key.")

    model = os.environ.get("OPENAI_ASSISTANT_MODEL", "gpt-5-mini")
    conversation_id = str(uuid.uuid4())
    context_text = json.dumps(snapshot, separators=(",", ":"), default=str)
    if len(context_text.encode("utf-8")) > MAX_CONTEXT_BYTES:
        context_text = context_text.encode("utf-8")[:MAX_CONTEXT_BYTES].decode("utf-8", "ignore")
    current_path = str((page or {}).get("path") or "/dashboard")[:160]
    safety_id = hashlib.sha256(f"{tenant}:{actor}".encode()).hexdigest()
    instructions = (
        "You are the read-only operations analyst inside a multi-tenant Amazon DSP platform. "
        "Use only the supplied tenant snapshot; never claim access to another tenant or to data not present. "
        "Do not invent metrics. If evidence is missing or stale, say so. Give concise, actionable operational advice. "
        "Never submit disputes, change payroll, message people, or perform external actions. "
        "Cite factual claims inline using the supplied source IDs exactly, for example [fleet-compliance]."
    )
    input_items = [{"role": "developer", "content": instructions}]
    input_items.extend(_clean_history(history))
    input_items.append({
        "role": "user",
        "content": f"Current application path: {current_path}\nTenant snapshot:\n{context_text}\n\nQuestion: {question}",
    })
    body = json.dumps({
        "model": model,
        "input": input_items,
        "max_output_tokens": 900,
        "safety_identifier": safety_id,
    }).encode("utf-8")
    started = time.monotonic()
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = json.loads(response.read())
    except urllib.error.HTTPError as error:
        # Never expose provider response bodies because they can include request details.
        raise RuntimeError(f"AI provider request failed ({error.code})") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError("AI provider is temporarily unavailable") from error

    answer = str(payload.get("output_text") or "").strip()
    if not answer:
        for item in payload.get("output") or []:
            for content in item.get("content") or []:
                if content.get("type") == "output_text":
                    answer += content.get("text") or ""
    answer = answer.strip() or "I could not produce an answer from the available tenant data."
    usage = payload.get("usage") or {}
    elapsed_ms = round((time.monotonic() - started) * 1000)
    citations = snapshot.get("citations") or []
    _audit(tenant, actor, {
        "action": "assistant.response",
        "conversationId": conversation_id,
        "requestId": payload.get("id"),
        "model": model,
        "path": current_path,
        "messageSha256": hashlib.sha256(question.encode()).hexdigest(),
        "inputTokens": usage.get("input_tokens"),
        "outputTokens": usage.get("output_tokens"),
        "latencyMs": elapsed_ms,
    })
    return {
        "conversationId": conversation_id,
        "message": answer,
        "citations": citations,
        "model": model,
        "usage": {"inputTokens": usage.get("input_tokens"), "outputTokens": usage.get("output_tokens")},
        "readOnly": True,
    }
