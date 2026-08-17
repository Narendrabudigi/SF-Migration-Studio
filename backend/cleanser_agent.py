"""
Standalone rule-based Cleanser Agent for SAP Migration Studio.

The agent consumes harmonization CSV output and an optional validation JSON
report, applies validation-directed fixes first, then applies the official
Cleanser rule set, and exports a cleaned CSV.
"""

# =============================================================================
# Imports
# =============================================================================

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import pandas as pd


# =============================================================================
# Configuration
# =============================================================================

COUNTRY_MAP: dict[str, str] = {
    "INDIA": "IN",
    "IN": "IN",
    "UNITED STATES": "US",
    "USA": "US",
    "US": "US",
    "UNITED KINGDOM": "GB",
    "UK": "GB",
    "GB": "GB",
    "GERMANY": "DE",
    "DE": "DE",
    "FRANCE": "FR",
    "FR": "FR",
    "AUSTRALIA": "AU",
    "AU": "AU",
    "CANADA": "CA",
    "CA": "CA",
    "JAPAN": "JP",
    "JP": "JP",
    "CHINA": "CN",
    "CN": "CN",
    "SINGAPORE": "SG",
    "SG": "SG",
    "UAE": "AE",
    "UNITED ARAB EMIRATES": "AE",
    "AE": "AE",
    "NETHERLANDS": "NL",
    "NL": "NL",
    "SWEDEN": "SE",
    "SE": "SE",
    "SWITZERLAND": "CH",
    "CH": "CH",
    "ITALY": "IT",
    "IT": "IT",
    "SPAIN": "ES",
    "ES": "ES",
    "BRAZIL": "BR",
    "BR": "BR",
    "SOUTH KOREA": "KR",
    "KR": "KR",
}

CURR_MAP: dict[str, str] = {
    "INDIAN RUPEE": "INR",
    "RUPEE": "INR",
    "RUPEES": "INR",
    "RS": "INR",
    "INR": "INR",
    "US DOLLAR": "USD",
    "DOLLAR": "USD",
    "USD": "USD",
    "EURO": "EUR",
    "EUROS": "EUR",
    "EUR": "EUR",
    "POUND": "GBP",
    "STERLING": "GBP",
    "GBP": "GBP",
    "YEN": "JPY",
    "JPY": "JPY",
    "YUAN": "CNY",
    "RMB": "CNY",
    "CNY": "CNY",
    "DIRHAM": "AED",
    "AED": "AED",
    "RIYAL": "SAR",
    "SAR": "SAR",
    "FRANC": "CHF",
    "CHF": "CHF",
    "AUS DOLLAR": "AUD",
    "AUD": "AUD",
    "CANADIAN DOLLAR": "CAD",
    "CAD": "CAD",
    "SGD": "SGD",
}

PAYMENT_TERM_MAP: dict[str, str] = {
    "NT30": "NT30",
    "NET30": "NT30",
    "NET 30": "NT30",
    "30 DAYS": "NT30",
    "30DAYS": "NT30",
    "NT45": "NT45",
    "NET45": "NT45",
    "NET 45": "NT45",
    "45 DAYS": "NT45",
    "NT60": "NT60",
    "NET60": "NT60",
    "NET 60": "NT60",
    "60 DAYS": "NT60",
    "NT15": "NT15",
    "NET15": "NT15",
    "NT07": "NT07",
    "NET7": "NT07",
    "IMMEDIATE": "NT00",
    "CASH": "NT00",
    "COD": "NT00",
    "DUE ON RECEIPT": "NT00",
    "2/10 NET30": "2001",
}

MATERIAL_TYPE_MAP: dict[str, str] = {
    "ROH": "ROH",
    "RAW MATERIAL": "ROH",
    "RAW": "ROH",
    "RM": "ROH",
    "HALB": "HALB",
    "SEMI-FINISHED": "HALB",
    "SEMI FINISHED": "HALB",
    "WIP": "HALB",
    "FERT": "FERT",
    "FINISHED GOODS": "FERT",
    "FINISHED": "FERT",
    "FG": "FERT",
    "HAWA": "HAWA",
    "TRADING GOODS": "HAWA",
    "TRADING": "HAWA",
    "DIEN": "DIEN",
    "SERVICE": "DIEN",
    "HIBE": "HIBE",
    "OPERATING SUPPLIES": "HIBE",
    "CONSUMABLE": "HIBE",
}

FIELD_LENGTHS: dict[str, int] = {
    "KUNNR": 10,
    "LIFNR": 10,
    "KTOKD": 4,
    "KTOKK": 4,
    "NAME1": 35,
    "NAME2": 35,
    "LAND1": 3,
    "ORT01": 35,
    "PSTLZ": 10,
    "REGIO": 3,
    "STRAS": 35,
    "TELF1": 16,
    "SMTP_ADDR": 241,
    "BUKRS": 4,
    "VKORG": 4,
    "EKORG": 4,
    "VTWEG": 2,
    "SPART": 2,
    "WAERS": 5,
    "ZTERM": 4,
    "STCD1": 16,
    "STCD2": 16,
    "TAXKD": 1,
    "ERDAT": 8,
    "MATNR": 40,
    "MBRSH": 1,
    "MTART": 4,
    "MAKTX": 40,
    "MEINS": 3,
    "MATKL": 9,
    "WERKS": 4,
    "LGORT": 4,
    "GEWEI": 3,
    "EKGRP": 3,
    "BKLAS": 4,
}

IDENTIFIER_LENGTHS: dict[str, int] = {
    "KUNNR": 10,
    "LIFNR": 10,
}

FIELD_DEFAULTS: dict[str, str] = {}

COUNTRY_FIELD_NAMES = {"LAND1", "COUNTRY", "COUNTRY_CODE", "BANKS"}
CURRENCY_FIELD_NAMES = {"WAERS", "CURRENCY", "CURRENCY_CODE", "CURR"}
PAYMENT_TERM_FIELD_NAMES = {"ZTERM", "PAYMENT_TERMS", "PAY_TERMS"}
MATERIAL_TYPE_FIELD_NAMES = {"MTART", "MATERIAL_TYPE", "MAT_TYPE"}
CODE_FIELD_NAMES = {
    "KTOKD",
    "KTOKK",
    "LAND1",
    "REGIO",
    "BUKRS",
    "VKORG",
    "EKORG",
    "WERKS",
    "VTWEG",
    "SPART",
    "WAERS",
    "ZTERM",
    "TAXKD",
    "MBRSH",
    "MTART",
    "MEINS",
    "MATKL",
    "LGORT",
    "GEWEI",
    "EKGRP",
    "BKLAS",
}

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
EMAIL_DOMAINS = {
    "gmail": "gmail.com",
    "yahoo": "yahoo.com",
    "outlook": "outlook.com",
    "hotmail": "hotmail.com",
    "icloud": "icloud.com",
    "rediffmail": "rediffmail.com",
}
UNSAFE_DEFAULT_FIELDS = {
    "KUNNR",
    "LIFNR",
    "BUKRS",
    "VKORG",
    "EKORG",
    "WERKS",
    "KTOKD",
    "KTOKK",
    "ERDAT",
    "AEDAT",
}


# =============================================================================
# Cleaning Summary Helpers
# =============================================================================

@dataclass
class CleaningSummary:
    input_csv_path: str
    validation_report_json_path: str | None
    output_csv_path: str
    validation_fixes: list[dict[str, Any]] = field(default_factory=list)
    cleanser_fixes: list[dict[str, Any]] = field(default_factory=list)
    rows_modified: set[int] = field(default_factory=set)
    rules_applied: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    rows_loaded: int = 0
    rows_exported: int = 0

    def add_fix(
        self,
        phase: str,
        rule_code: str,
        row_number: int,
        field_name: str,
        old_value: Any,
        new_value: Any,
    ) -> None:
        item = {
            "rule_code": rule_code,
            "row": row_number,
            "field": field_name,
            "old": _stringify(old_value),
            "new": _stringify(new_value),
        }
        if phase == "validation":
            self.validation_fixes.append(item)
        else:
            self.cleanser_fixes.append(item)
        self.rows_modified.add(row_number)

    def add_rule(self, rule_code: str) -> None:
        if rule_code not in self.rules_applied:
            self.rules_applied.append(rule_code)

    def to_dict(self) -> dict[str, Any]:
        return {
            "input_csv_path": self.input_csv_path,
            "validation_report_json_path": self.validation_report_json_path,
            "output_csv_path": self.output_csv_path,
            "rows_loaded": self.rows_loaded,
            "rows_exported": self.rows_exported,
            "validation_fixes": {
                "count": len(self.validation_fixes),
                "items": self.validation_fixes,
            },
            "cleanser_fixes": {
                "count": len(self.cleanser_fixes),
                "items": self.cleanser_fixes,
            },
            "rows_modified": sorted(self.rows_modified),
            "rows_modified_count": len(self.rows_modified),
            "rules_applied": self.rules_applied,
            "warnings": self.warnings,
        }


def _stringify(value: Any) -> str:
    if pd.isna(value):
        return ""
    return str(value)


def _clean_key(value: str) -> str:
    return re.sub(r"\s+", " ", _stringify(value).strip().upper())


def _is_empty(value: Any) -> bool:
    return _stringify(value).strip() == ""


def _field_key(field_name: str) -> str:
    return field_name.split(".")[-1].strip().upper()


def _has_field(df: pd.DataFrame, field_name: str) -> bool:
    return field_name in df.columns


def _row_index(row_number: int) -> int:
    return row_number - 1


def _get_value(df: pd.DataFrame, row_index: int, field_name: str) -> str:
    return _stringify(df.at[row_index, field_name])


def _set_value(
    df: pd.DataFrame,
    row_index: int,
    field_name: str,
    new_value: Any,
    summary: CleaningSummary,
    phase: str,
    rule_code: str,
) -> bool:
    old_value = _get_value(df, row_index, field_name)
    next_value = _stringify(new_value)
    if old_value == next_value:
        return False
    df.at[row_index, field_name] = next_value
    summary.add_fix(phase, rule_code, row_index + 1, field_name, old_value, next_value)
    return True


def _iter_existing_fields(df: pd.DataFrame, configured_fields: set[str]) -> list[str]:
    configured = {_field_key(field) for field in configured_fields}
    return [col for col in df.columns if _field_key(col) in configured]


def _default_for_field(field_name: str) -> str | None:
    key = _field_key(field_name)
    if key in UNSAFE_DEFAULT_FIELDS or key in IDENTIFIER_LENGTHS:
        return None
    if key in FIELD_DEFAULTS:
        return FIELD_DEFAULTS[key]
    return None


def _normalize_identifier(value: Any, field_name: str, row_number: int) -> str | None:
    key = _field_key(field_name)
    length = IDENTIFIER_LENGTHS.get(key, FIELD_LENGTHS.get(key, 10))
    digits = re.sub(r"\D", "", _stringify(value))
    if not digits:
        return None
    if len(digits) > length:
        digits = digits[-length:]
    return digits.zfill(length)


def _normalize_country(value: Any) -> str | None:
    key = _clean_key(value)
    if key in COUNTRY_MAP:
        return COUNTRY_MAP[key]
    letters = re.sub(r"[^A-Z]", "", key)
    if 2 <= len(letters) <= 3:
        return letters
    return None


def _normalize_currency(value: Any) -> str | None:
    key = _clean_key(value)
    if key in CURR_MAP:
        return CURR_MAP[key]
    letters = re.sub(r"[^A-Z]", "", key)
    if len(letters) == 3:
        return letters
    return None


def _normalize_payment_term(value: Any) -> str | None:
    raw = _stringify(value).strip().upper()
    if not raw:
        return None
    key = _clean_key(raw)
    if key in PAYMENT_TERM_MAP:
        return PAYMENT_TERM_MAP[key]
    
    # 1. Already valid SAP term format e.g. NT30, NT45, NT60, NT90
    if re.fullmatch(r"NT\d{2}", raw):
        return raw

    # 2. NETXX or NXX e.g. NET30, NET 30, N30, NET90, N90
    m_net = re.fullmatch(r"(?:NET|N)\s*(\d{1,2})", raw)
    if m_net:
        days = m_net.group(1).zfill(2)
        return f"NT{days}"

    # 3. Pure digits e.g. "90", "0090", "30", "45", "60"
    digits = re.sub(r"\D", "", raw)
    if digits:
        try:
            val_int = int(digits)
            if 0 <= val_int <= 99:
                return f"NT{str(val_int).zfill(2)}"
        except ValueError:
            pass

    return None


def _normalize_material_type(value: Any) -> str:
    key = _clean_key(value)
    return MATERIAL_TYPE_MAP.get(key, key[:4] if key else "ROH")


def _normalize_date(value: Any) -> str | None:
    raw = _stringify(value).strip()
    if re.fullmatch(r"\d{8}", raw):
        try:
            pd.to_datetime(raw, format="%Y%m%d", errors="raise")
            return raw
        except Exception:
            return None
    parsed = pd.to_datetime(raw, errors="coerce")
    if not pd.isna(parsed):
        return parsed.strftime("%Y%m%d")
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 8:
        return _normalize_date(digits)
    return None


def _recover_email(value: Any) -> str | None:
    raw = _stringify(value).strip()
    candidate = re.sub(r"\s+", "", raw)
    if EMAIL_RE.match(candidate):
        return candidate

    lower = candidate.lower()
    if "@" in lower:
        local, domain = lower.split("@", 1)
        if local and domain in EMAIL_DOMAINS:
            return f"{local}@{EMAIL_DOMAINS[domain]}"
        return None

    for short_domain, full_domain in EMAIL_DOMAINS.items():
        suffix = f"{short_domain}.com"
        if lower.endswith(suffix) and len(lower) > len(suffix):
            local = lower[: -len(suffix)]
            return f"{local}@{full_domain}"
        if lower.endswith(short_domain) and len(lower) > len(short_domain):
            local = lower[: -len(short_domain)]
            return f"{local}@{full_domain}"
    return None


def _warn_skipped(summary: CleaningSummary, rule_code: str, row_number: int, field_name: str, reason: str) -> None:
    detail = f"row {row_number}, field {field_name} requires manual review - {reason}"
    if any(message.endswith(detail) for message in summary.warnings):
        return
    summary.warnings.append(f"{rule_code}: {detail}")


# =============================================================================
# File Loading
# =============================================================================

def load_csv(dataset_csv_path: str | Path) -> pd.DataFrame:
    return pd.read_csv(dataset_csv_path, dtype=str, keep_default_na=False)


def load_validation_report(validation_report_json_path: str | Path | None) -> dict[str, Any]:
    if not validation_report_json_path:
        return {"version": "1.0", "issues": []}
    path = Path(validation_report_json_path)
    if not path.exists():
        return {"version": "1.0", "issues": []}
    with path.open("r", encoding="utf-8") as handle:
        report = json.load(handle)
    if not isinstance(report, dict):
        raise ValueError("Validation report must be a JSON object.")
    issues = report.get("issues", [])
    if not isinstance(issues, list):
        raise ValueError("Validation report field 'issues' must be a list.")
    return report


# =============================================================================
# Validation Fix Functions
# =============================================================================

def fix_required_fields(
    df: pd.DataFrame,
    issue: dict[str, Any],
    summary: CleaningSummary,
    rule_code: str,
) -> None:
    field_name = issue["field"]
    idx = _row_index(issue["row"])
    if _is_empty(_get_value(df, idx, field_name)):
        default_value = _default_for_field(field_name)
        if default_value is None:
            _warn_skipped(summary, rule_code, issue["row"], field_name, "missing required value has no safe configured default")
            return
        _set_value(df, idx, field_name, default_value, summary, "validation", rule_code)


def fix_numeric_identifier_format(
    df: pd.DataFrame,
    issue: dict[str, Any],
    summary: CleaningSummary,
    rule_code: str,
) -> None:
    field_name = issue["field"]
    idx = _row_index(issue["row"])
    value = _normalize_identifier(_get_value(df, idx, field_name), field_name, issue["row"])
    if value is None:
        _warn_skipped(summary, rule_code, issue["row"], field_name, "identifier has no recoverable numeric content")
        return
    _set_value(df, idx, field_name, value, summary, "validation", rule_code)


def fix_country_code_format(
    df: pd.DataFrame,
    issue: dict[str, Any],
    summary: CleaningSummary,
    rule_code: str,
) -> None:
    field_name = issue["field"]
    idx = _row_index(issue["row"])
    value = _normalize_country(_get_value(df, idx, field_name))
    if value is None:
        _warn_skipped(summary, rule_code, issue["row"], field_name, "country value is unsupported")
        return
    _set_value(df, idx, field_name, value, summary, "validation", rule_code)


def fix_currency_code_format(
    df: pd.DataFrame,
    issue: dict[str, Any],
    summary: CleaningSummary,
    rule_code: str,
) -> None:
    field_name = issue["field"]
    idx = _row_index(issue["row"])
    value = _normalize_currency(_get_value(df, idx, field_name))
    if value is None:
        _warn_skipped(summary, rule_code, issue["row"], field_name, "currency value is unsupported")
        return
    _set_value(df, idx, field_name, value, summary, "validation", rule_code)


def fix_email_address_format(
    df: pd.DataFrame,
    issue: dict[str, Any],
    summary: CleaningSummary,
    rule_code: str,
) -> None:
    field_name = issue["field"]
    idx = _row_index(issue["row"])
    value = _get_value(df, idx, field_name).strip()
    if not EMAIL_RE.match(value):
        recovered = _recover_email(value)
        if recovered is None:
            _warn_skipped(summary, rule_code, issue["row"], field_name, "email could not be safely repaired")
            return
        _set_value(df, idx, field_name, recovered, summary, "validation", rule_code)


def fix_date_yyyymmdd_format(
    df: pd.DataFrame,
    issue: dict[str, Any],
    summary: CleaningSummary,
    rule_code: str,
) -> None:
    field_name = issue["field"]
    idx = _row_index(issue["row"])
    value = _normalize_date(_get_value(df, idx, field_name))
    if value is None:
        _warn_skipped(summary, rule_code, issue["row"], field_name, "date could not be safely normalized")
        return
    _set_value(df, idx, field_name, value, summary, "validation", rule_code)


def fix_field_length(
    df: pd.DataFrame,
    issue: dict[str, Any],
    summary: CleaningSummary,
    rule_code: str,
) -> None:
    field_name = issue["field"]
    idx = _row_index(issue["row"])
    max_length = FIELD_LENGTHS.get(_field_key(field_name))
    if max_length is None:
        summary.warnings.append(f"No max length configured for {field_name}; skipped row {issue['row']}.")
        return
    value = _get_value(df, idx, field_name)
    if len(value) > max_length:
        _set_value(df, idx, field_name, value[:max_length], summary, "validation", rule_code)


def fix_payment_terms_format(
    df: pd.DataFrame,
    issue: dict[str, Any],
    summary: CleaningSummary,
    rule_code: str,
) -> None:
    field_name = issue["field"]
    idx = _row_index(issue["row"])
    value = _normalize_payment_term(_get_value(df, idx, field_name))
    if value is None:
        _warn_skipped(summary, rule_code, issue["row"], field_name, "payment term value is unsupported")
        return
    _set_value(df, idx, field_name, value, summary, "validation", rule_code)


# =============================================================================
# Cleanser Rule Functions
# =============================================================================

def apply_trim_whitespace(df: pd.DataFrame, summary: CleaningSummary, rule_code: str) -> None:
    for idx in df.index:
        for field_name in df.columns:
            value = _get_value(df, idx, field_name)
            _set_value(df, idx, field_name, value.strip(), summary, "cleanser", rule_code)


def apply_country_to_iso(df: pd.DataFrame, summary: CleaningSummary, rule_code: str) -> None:
    for field_name in _iter_existing_fields(df, COUNTRY_FIELD_NAMES):
        for idx in df.index:
            value = _get_value(df, idx, field_name)
            if not _is_empty(value):
                normalized = _normalize_country(value)
                if normalized is None:
                    _warn_skipped(summary, rule_code, idx + 1, field_name, "country value is unsupported")
                    continue
                _set_value(df, idx, field_name, normalized, summary, "cleanser", rule_code)


def apply_currency_to_iso(df: pd.DataFrame, summary: CleaningSummary, rule_code: str) -> None:
    for field_name in _iter_existing_fields(df, CURRENCY_FIELD_NAMES):
        for idx in df.index:
            value = _get_value(df, idx, field_name)
            if not _is_empty(value):
                normalized = _normalize_currency(value)
                if normalized is None:
                    _warn_skipped(summary, rule_code, idx + 1, field_name, "currency value is unsupported")
                    continue
                _set_value(df, idx, field_name, normalized, summary, "cleanser", rule_code)


def apply_payment_terms_to_sap(df: pd.DataFrame, summary: CleaningSummary, rule_code: str) -> None:
    for field_name in _iter_existing_fields(df, PAYMENT_TERM_FIELD_NAMES):
        for idx in df.index:
            value = _get_value(df, idx, field_name)
            if not _is_empty(value):
                normalized = _normalize_payment_term(value)
                if normalized is None:
                    _warn_skipped(summary, rule_code, idx + 1, field_name, "payment term value is unsupported")
                    continue
                _set_value(df, idx, field_name, normalized, summary, "cleanser", rule_code)


def apply_material_type_to_sap(df: pd.DataFrame, summary: CleaningSummary, rule_code: str) -> None:
    for field_name in _iter_existing_fields(df, MATERIAL_TYPE_FIELD_NAMES):
        for idx in df.index:
            value = _get_value(df, idx, field_name)
            if not _is_empty(value):
                _set_value(df, idx, field_name, _normalize_material_type(value), summary, "cleanser", rule_code)


def apply_pad_numeric_identifier(df: pd.DataFrame, summary: CleaningSummary, rule_code: str) -> None:
    for field_name in _iter_existing_fields(df, set(IDENTIFIER_LENGTHS)):
        for idx in df.index:
            value = _get_value(df, idx, field_name)
            if not _is_empty(value):
                normalized = _normalize_identifier(value, field_name, idx + 1)
                if normalized is None:
                    _warn_skipped(summary, rule_code, idx + 1, field_name, "identifier has no recoverable numeric content")
                    continue
                _set_value(df, idx, field_name, normalized, summary, "cleanser", rule_code)


def apply_uppercase_code_fields(df: pd.DataFrame, summary: CleaningSummary, rule_code: str) -> None:
    for field_name in _iter_existing_fields(df, CODE_FIELD_NAMES):
        for idx in df.index:
            value = _get_value(df, idx, field_name)
            if not _is_empty(value):
                _set_value(df, idx, field_name, value.upper(), summary, "cleanser", rule_code)


def apply_clean_tax_number(df: pd.DataFrame, summary: CleaningSummary, rule_code: str) -> None:
    tax_fields = [col for col in df.columns if re.search(r"(^STCD\d*$|TAX_NUMBER|PAN|GST)", _field_key(col))]
    for field_name in tax_fields:
        for idx in df.index:
            value = _get_value(df, idx, field_name)
            if not _is_empty(value):
                cleaned = re.sub(r"[^A-Z0-9]", "", value.upper())
                _set_value(df, idx, field_name, cleaned, summary, "cleanser", rule_code)


def apply_truncate_overlength(df: pd.DataFrame, summary: CleaningSummary, rule_code: str) -> None:
    for field_name in df.columns:
        max_length = FIELD_LENGTHS.get(_field_key(field_name))
        if max_length is None:
            continue
        for idx in df.index:
            value = _get_value(df, idx, field_name)
            if len(value) > max_length:
                _set_value(df, idx, field_name, value[:max_length], summary, "cleanser", rule_code)


def apply_fill_empty_fields(df: pd.DataFrame, summary: CleaningSummary, rule_code: str) -> None:
    for idx in df.index:
        for field_name in df.columns:
            value = _get_value(df, idx, field_name)
            if pd.isna(value):
                _set_value(df, idx, field_name, "", summary, "cleanser", rule_code)


# =============================================================================
# Rule Registries
# =============================================================================

ValidationFixer = Callable[[pd.DataFrame, dict[str, Any], CleaningSummary, str], None]
CleanserRule = Callable[[pd.DataFrame, CleaningSummary, str], None]

VALIDATION_FIXERS: dict[str, ValidationFixer] = {
    "VAL_REQUIRED_FIELDS": fix_required_fields,
    "VAL_NUMERIC_IDENTIFIER_FORMAT": fix_numeric_identifier_format,
    "VAL_COUNTRY_CODE_FORMAT": fix_country_code_format,
    "VAL_CURRENCY_CODE_FORMAT": fix_currency_code_format,
    "VAL_EMAIL_ADDRESS_FORMAT": fix_email_address_format,
    "VAL_DATE_YYYYMMDD_FORMAT": fix_date_yyyymmdd_format,
    "VAL_FIELD_LENGTH": fix_field_length,
    "VAL_PAYMENT_TERMS_FORMAT": fix_payment_terms_format,
}

CLEANSER_RULES: list[tuple[str, CleanserRule]] = [
    ("CL_TRIM_WHITESPACE", apply_trim_whitespace),
    ("CL_COUNTRY_TO_ISO", apply_country_to_iso),
    ("CL_CURRENCY_TO_ISO", apply_currency_to_iso),
    ("CL_PAYMENT_TERMS_TO_SAP", apply_payment_terms_to_sap),
    ("CL_MATERIAL_TYPE_TO_SAP", apply_material_type_to_sap),
    ("CL_PAD_NUMERIC_IDENTIFIER", apply_pad_numeric_identifier),
    ("CL_UPPERCASE_CODE_FIELDS", apply_uppercase_code_fields),
    ("CL_CLEAN_TAX_NUMBER", apply_clean_tax_number),
    ("CL_TRUNCATE_OVERLENGTH", apply_truncate_overlength),
    ("CL_FILL_EMPTY_FIELDS", apply_fill_empty_fields),
]


# =============================================================================
# Main Agent
# =============================================================================

def apply_validation_fixes(
    df: pd.DataFrame,
    validation_report: dict[str, Any],
    summary: CleaningSummary,
) -> pd.DataFrame:
    for issue in validation_report.get("issues", []):
        rule_code = issue.get("rule_code")
        row_number = issue.get("row")
        field_name = issue.get("field")
        if not isinstance(rule_code, str) or not isinstance(row_number, int) or not isinstance(field_name, str):
            summary.warnings.append(f"Skipped malformed validation issue: {issue}")
            continue
        if row_number < 1 or row_number > len(df.index):
            summary.warnings.append(f"Skipped issue for out-of-range row {row_number}: {issue}")
            continue
        if not _has_field(df, field_name):
            summary.warnings.append(f"Skipped issue for missing field {field_name}: {issue}")
            continue
        fixer = VALIDATION_FIXERS.get(rule_code)
        if fixer is None:
            summary.warnings.append(f"No validation fixer registered for {rule_code}; skipped row {row_number}.")
            continue
        summary.add_rule(rule_code)
        fixer(df, issue, summary, rule_code)
    return df


def apply_cleanser_rules(df: pd.DataFrame, summary: CleaningSummary) -> pd.DataFrame:
    for rule_code, rule_func in CLEANSER_RULES:
        summary.add_rule(rule_code)
        rule_func(df, summary, rule_code)
    return df


def run_cleanser(
    dataset_csv_path: str | Path,
    validation_report_json_path: str | Path | None = None,
    output_csv_path: str | Path | None = None,
) -> dict[str, Any]:
    if output_csv_path is None:
        raise ValueError("output_csv_path is required.")

    dataset_csv_path = Path(dataset_csv_path)
    output_csv_path = Path(output_csv_path)
    validation_path = Path(validation_report_json_path) if validation_report_json_path else None

    df = load_csv(dataset_csv_path)
    validation_report = load_validation_report(validation_path)

    summary = CleaningSummary(
        input_csv_path=str(dataset_csv_path),
        validation_report_json_path=str(validation_path) if validation_path else None,
        output_csv_path=str(output_csv_path),
        rows_loaded=len(df.index),
    )

    apply_validation_fixes(df, validation_report, summary)
    apply_cleanser_rules(df, summary)
    export_cleaned_csv(df, output_csv_path)

    summary.rows_exported = len(df.index)
    return summary.to_dict()


# =============================================================================
# CSV Export
# =============================================================================

def export_cleaned_csv(df: pd.DataFrame, output_csv_path: str | Path) -> None:
    output_path = Path(output_csv_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)
