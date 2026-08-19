"""
Temporary local storage for dynamic validation/cleansing rule intent.

Dynamic rules are separate from validation issues: a rule must exist even when
it has zero failures, while a validation report stores only failures found in a
specific run. This JSON-backed store is intentionally small and replaceable by
Supabase later, without changing Cleanser business logic.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_STORE_PATH = Path(__file__).resolve().parents[1] / "output" / "cleanser_dynamic_rules.json"

CODE_FIELDS = {
    "python_code",
    "code",
    "executable_code",
    "fixer_code",
    "fixer_python_code",
    "generated_python",
    "generated_python_code",
}

KNOWN_RULE_FIELDS = {
    "id",
    "project_id",
    "target_object",
    "field",
    "label",
    "description",
    "source",
    "priority",
    "created_at",
    "severity",
    "error_message",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _store_path(store_path: str | Path | None = None) -> Path:
    return Path(store_path) if store_path else DEFAULT_STORE_PATH


def _clean_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    text = str(value).strip()
    return text if text else default


def _rule_id(rule: dict[str, Any]) -> str:
    existing = _clean_text(rule.get("id") or rule.get("rule_code"))
    if existing and existing not in ("DYNAMIC_1", "DYNAMIC_RULE_1", "DYNAMIC_DEFAULT"):
        return existing

    # Stable unique fallback based on rule content
    basis = "|".join(
        [
            _clean_text(rule.get("project_id")),
            _clean_text(rule.get("target_object")).upper(),
            _clean_text(rule.get("field"), "GENERAL").upper(),
            _clean_text(rule.get("label")),
            _clean_text(rule.get("description")),
            _clean_text(rule.get("python_code")),
            _clean_text(rule.get("error_message")),
        ]
    )
    digest = hashlib.sha256(basis.encode("utf-8")).hexdigest()[:8]
    return f"DYNAMIC_{digest}"


def _dedupe_key(rule: dict[str, Any]) -> tuple[str, str, str]:
    return (
        _clean_text(rule.get("project_id")),
        _clean_text(rule.get("target_object")).upper(),
        _clean_text(rule.get("id")),
    )


def normalize_dynamic_rule(
    rule: dict[str, Any],
    *,
    project_id: str | None = None,
    target_object: str | None = None,
    source: str = "validation_dynamic_rule",
    priority: int = 100,
    created_at: str | None = None,
) -> dict[str, Any]:
    """
    Convert a Validation runtime dynamic rule into persisted intent metadata.
    Preserves python_code so compiled rules remain executable across pipeline stages.
    """
    normalized = {
        "id": _rule_id(rule),
        "project_id": project_id or rule.get("project_id"),
        "target_object": target_object or rule.get("target_object"),
        "field": _clean_text(rule.get("field"), "GENERAL"),
        "label": _clean_text(rule.get("label") or rule.get("id"), "Dynamic Rule"),
        "description": _clean_text(rule.get("description") or rule.get("error_message")),
        "source": _clean_text(rule.get("source"), source),
        "priority": int(rule.get("priority", priority)),
        "created_at": _clean_text(rule.get("created_at"), created_at or _now_iso()),
        "python_code": rule.get("python_code") or rule.get("code") or rule.get("executable_code"),
    }

    for key in ("severity", "error_message", "python_code", "code", "executable_code"):
        if key in rule:
            normalized[key] = rule[key]

    return {key: value for key, value in normalized.items() if value is not None}


def load_rules(store_path: str | Path | None = None) -> list[dict[str, Any]]:
    path = _store_path(store_path)
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if isinstance(data, dict):
        rules = data.get("rules", [])
    elif isinstance(data, list):
        rules = data
    else:
        rules = []
    return [rule for rule in rules if isinstance(rule, dict)]


def save_rules(rules: list[dict[str, Any]], store_path: str | Path | None = None) -> None:
    path = _store_path(store_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": "1.0",
        "rules": [normalize_dynamic_rule(rule) for rule in rules],
    }
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    tmp_path.replace(path)


def upsert_rules(
    rules: list[dict[str, Any]],
    *,
    project_id: str | None = None,
    target_object: str | None = None,
    store_path: str | Path | None = None,
    source: str = "validation_dynamic_rule",
    priority: int = 100,
) -> list[dict[str, Any]]:
    existing_rules = load_rules(store_path)
    by_key = {_dedupe_key(rule): rule for rule in existing_rules}

    for rule in rules:
        normalized = normalize_dynamic_rule(
            rule,
            project_id=project_id,
            target_object=target_object,
            source=source,
            priority=priority,
        )
        key = _dedupe_key(normalized)
        prior = by_key.get(key)
        if prior:
            normalized["created_at"] = prior.get("created_at", normalized["created_at"])
        by_key[key] = normalized

    merged = sorted(by_key.values(), key=lambda item: (str(item.get("created_at", "")), str(item.get("id", ""))))
    save_rules(merged, store_path)
    return merged


def replace_rules_for_object(
    rules: list[dict[str, Any]],
    *,
    project_id: str | None = None,
    target_object: str | None = None,
    store_path: str | Path | None = None,
    source: str = "validation_dynamic_rule",
    priority: int = 100,
) -> list[dict[str, Any]]:
    existing_rules = load_rules(store_path)
    pid_clean = (project_id or "").strip()
    obj_clean = (target_object or "").strip().upper()

    kept_rules = []
    for r in existing_rules:
        r_pid = str(r.get("project_id", "")).strip()
        r_obj = str(r.get("target_object", "")).strip().upper()
        if pid_clean and obj_clean and r_pid == pid_clean and r_obj == obj_clean:
            continue
        kept_rules.append(r)

    for rule in rules:
        normalized = normalize_dynamic_rule(
            rule,
            project_id=project_id,
            target_object=target_object,
            source=source,
            priority=priority,
        )
        kept_rules.append(normalized)

    save_rules(kept_rules, store_path)
    return kept_rules


def get_rules(
    *,
    project_id: str | None = None,
    target_object: str | None = None,
    store_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    rules = load_rules(store_path)
    if project_id is not None:
        rules = [rule for rule in rules if rule.get("project_id") == project_id]
    if target_object is not None:
        obj = target_object.upper()
        rules = [rule for rule in rules if _clean_text(rule.get("target_object")).upper() == obj]
    return rules


def get_relevant_rules_for_cleanser(
    *,
    project_id: str | None = None,
    target_object: str | None = None,
    store_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    rules = load_rules(store_path)
    obj = target_object.upper() if target_object else None

    def matches(rule: dict[str, Any]) -> bool:
        rule_project = rule.get("project_id")
        rule_object = _clean_text(rule.get("target_object")).upper()
        project_match = project_id is None or rule_project in (None, "", project_id)
        object_match = obj is None or rule_object in ("", obj)
        return project_match and object_match

    return [rule for rule in rules if matches(rule)]
