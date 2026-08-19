"""
Standalone rule-based Cleanser Agent for SuccessFactors Migration Studio.

The agent consumes harmonization CSV output and an optional validation JSON
report, applies validation-directed fixes first, then applies the official
Cleanser rule set, and exports a cleaned CSV.
"""

# =============================================================================
# Imports
# =============================================================================

from __future__ import annotations

import ast
import inspect
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from services.cleanser_dynamic_rules import get_relevant_rules_for_cleanser


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
    "NT45": "NT45",
}

MATERIAL_TYPE_MAP: dict[str, str] = {
    "ROH": "ROH",
    "RAW MATERIAL": "ROH",
    "RAW": "ROH",
    "HALB": "HALB",
    "SEMI-FINISHED": "HALB",
    "SEMI FINISHED": "HALB",
    "FERT": "FERT",
    "FINISHED GOODS": "FERT",
    "FINISHED": "FERT",
    "HAWA": "HAWA",
    "TRADING GOODS": "HAWA",
    "TRADING": "HAWA",
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
    "NT45": "NT45",
}

MATERIAL_TYPE_MAP: dict[str, str] = {
    "ROH": "ROH",
    "RAW MATERIAL": "ROH",
    "RAW": "ROH",
    "HALB": "HALB",
    "SEMI-FINISHED": "HALB",
    "SEMI FINISHED": "HALB",
    "FERT": "FERT",
    "FINISHED GOODS": "FERT",
    "FINISHED": "FERT",
    "HAWA": "HAWA",
    "TRADING GOODS": "HAWA",
    "TRADING": "HAWA",
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
    validation_report_csv_path: str | None
    output_csv_path: str
    execution_plan: dict[str, Any] = field(default_factory=dict)
    dynamic_fixer_generation: dict[str, Any] = field(default_factory=dict)
    dynamic_fixer_execution: dict[str, Any] = field(default_factory=dict)
    validation_issues: list[dict[str, Any]] = field(default_factory=list)
    dynamic_issues: list[dict[str, Any]] = field(default_factory=list)
    dynamic_fixes: list[dict[str, Any]] = field(default_factory=list)
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
        elif phase == "dynamic":
            self.dynamic_fixes.append(item)
        else:
            self.cleanser_fixes.append(item)
        self.rows_modified.add(row_number)

    def add_rule(self, rule_code: str) -> None:
        if rule_code not in self.rules_applied:
            self.rules_applied.append(rule_code)

    def to_dict(self) -> dict[str, Any]:
        sanitized_gen = dict(self.dynamic_fixer_generation)
        if "generated_fixers" in sanitized_gen:
            sanitized_gen["generated_fixers"] = [
                {k: v for k, v in item.items() if k != "code"}
                for item in sanitized_gen.get("generated_fixers", [])
                if isinstance(item, dict)
            ]

        detailed = build_detailed_cleanser_summary(self)

        return {
            "input_csv_path": self.input_csv_path,
            "validation_report_csv_path": self.validation_report_csv_path,
            "output_csv_path": self.output_csv_path,
            "rows_loaded": self.rows_loaded,
            "rows_exported": self.rows_exported,
            "overall_status": detailed["overall_status"],
            "execution_plan": self.execution_plan,
            "dynamic_fixer_generation": sanitized_gen,
            "dynamic_fixer_execution": self.dynamic_fixer_execution,
            "detailed_summary": detailed,
            "validation_issues": {
                "count": len(self.validation_issues),
                "items": self.validation_issues,
            },
            "dynamic_issues": {
                "count": len(self.dynamic_issues),
                "items": self.dynamic_issues,
            },
            "dynamic_fixes": {
                "count": len(self.dynamic_fixes),
                "items": self.dynamic_fixes,
            },
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


def build_detailed_cleanser_summary(summary: CleaningSummary) -> dict[str, Any]:
    val_report_supplied = bool(summary.validation_report_csv_path or summary.validation_issues)
    run_info = {
        "input_csv_path": summary.input_csv_path,
        "validation_report_supplied": val_report_supplied,
        "validation_report_csv_path": summary.validation_report_csv_path,
        "output_csv_path": summary.output_csv_path,
        "rows_loaded": summary.rows_loaded,
        "rows_exported": summary.rows_exported,
    }

    plan = summary.execution_plan or {}
    dyn_rules_items = plan.get("dynamic_rules", {}).get("items", [])
    
    dyn_considered = len(dyn_rules_items)
    dyn_with_issues = sum(1 for r in dyn_rules_items if r.get("status") == "has_issues")
    dyn_satisfied = sum(1 for r in dyn_rules_items if r.get("status") == "satisfied")
    grouped_issue_groups_count = len(plan.get("issue_groups", []))

    gen_info = summary.dynamic_fixer_generation or {}
    exec_info = summary.dynamic_fixer_execution or {}

    llm_attempts = gen_info.get("llm_calls", 0)
    successful_gen_count = len(gen_info.get("generated_fixers", []))
    failed_gen_count = len(gen_info.get("failed_generations", []))

    exec_attempts_count = len(exec_info.get("executed", [])) + len(exec_info.get("failed", []))
    successful_exec_count = len(exec_info.get("executed", []))
    failed_exec_count = len(exec_info.get("failed", []))

    dynamic_rule_processing = {
        "dynamic_rules_considered": dyn_considered,
        "dynamic_rules_with_issues": dyn_with_issues,
        "dynamic_rules_satisfied": dyn_satisfied,
        "grouped_issue_groups_count": grouped_issue_groups_count,
        "llm_fixer_generation_attempts": llm_attempts,
        "successful_generations_count": successful_gen_count,
        "failed_generations_count": failed_gen_count,
        "execution_attempts_count": exec_attempts_count,
        "successful_executions_count": successful_exec_count,
        "failed_executions_count": failed_exec_count,
    }

    dynamic_fixes_items = [
        {
            "row": fix["row"],
            "field": fix["field"],
            "old": fix["old"],
            "new": fix["new"],
            "rule_code": fix["rule_code"],
        }
        for fix in summary.dynamic_fixes
    ]

    val_rule_counts: dict[str, int] = {}
    val_rows_set = set()
    for fix in summary.validation_fixes:
        code = fix["rule_code"]
        val_rule_counts[code] = val_rule_counts.get(code, 0) + 1
        val_rows_set.add(fix["row"])

    validation_fixes_summary = {
        "total": len(summary.validation_fixes),
        "rule_wise_counts": val_rule_counts,
        "affected_rows": sorted(val_rows_set),
        "items": summary.validation_fixes,
    }

    cl_rule_counts: dict[str, int] = {}
    cl_rows_set = set()
    for fix in summary.cleanser_fixes:
        code = fix["rule_code"]
        cl_rule_counts[code] = cl_rule_counts.get(code, 0) + 1
        cl_rows_set.add(fix["row"])

    cleanser_fixes_summary = {
        "total": len(summary.cleanser_fixes),
        "rule_wise_counts": cl_rule_counts,
        "affected_rows": sorted(cl_rows_set),
        "items": summary.cleanser_fixes,
    }

    overridden_val = [
        r["rule_code"]
        for r in plan.get("overridden_rules", [])
        if r.get("rule_type") == "standard_validation"
    ]
    suppressed_cl = [
        r["rule_code"]
        for r in plan.get("overridden_rules", [])
        if r.get("rule_type") == "standard_cleanser"
    ]
    satisfied_dyn = [
        item["rule_code"]
        for item in plan.get("satisfied_dynamic_rules", {}).get("items", [])
    ]

    priority_overrides = {
        "dynamic_overrides_standard_validation": overridden_val,
        "dynamic_suppressed_cleanser": suppressed_cl,
        "standard_rules_skipped": overridden_val + suppressed_cl,
        "satisfied_dynamic_rules": satisfied_dyn,
    }

    warnings_summary = {
        "count": len(summary.warnings),
        "items": summary.warnings,
    }

    failures_items = []
    for f in gen_info.get("failed_generations", []):
        failures_items.append({
            "type": "generation_failure",
            "group_id": f.get("group_id"),
            "rule_code": f.get("rule_code"),
            "field": f.get("field"),
            "reason": f.get("reason"),
        })
    for f in exec_info.get("failed", []):
        failures_items.append({
            "type": "execution_failure",
            "group_id": f.get("group_id"),
            "rule_code": f.get("rule_code"),
            "field": f.get("field"),
            "reason": f.get("reason"),
        })

    failures_summary = {
        "count": len(failures_items),
        "items": failures_items,
    }

    final_counts = {
        "rows_loaded": summary.rows_loaded,
        "rows_exported": summary.rows_exported,
        "rows_modified_count": len(summary.rows_modified),
        "rows_modified": sorted(summary.rows_modified),
        "dynamic_fixes_count": len(summary.dynamic_fixes),
        "validation_fixes_count": len(summary.validation_fixes),
        "cleanser_fixes_count": len(summary.cleanser_fixes),
        "total_fixes_count": len(summary.dynamic_fixes) + len(summary.validation_fixes) + len(summary.cleanser_fixes),
        "warnings_count": len(summary.warnings),
        "failures_count": len(failures_items),
        "rules_applied_count": len(summary.rules_applied),
        "rules_applied": summary.rules_applied,
    }

    if summary.rows_exported == 0 and summary.rows_loaded > 0:
        overall_status = "FAILURE"
    elif len(failures_items) > 0:
        overall_status = "PARTIAL_FAILURE"
    elif len(summary.warnings) > 0:
        overall_status = "SUCCESS_WITH_WARNINGS"
    else:
        overall_status = "SUCCESS"

    return {
        "overall_status": overall_status,
        "run_information": run_info,
        "dynamic_rule_processing": dynamic_rule_processing,
        "dynamic_fixes": {
            "count": len(dynamic_fixes_items),
            "items": dynamic_fixes_items,
        },
        "validation_fixes": validation_fixes_summary,
        "cleanser_fixes": cleanser_fixes_summary,
        "priority_overrides": priority_overrides,
        "warnings": warnings_summary,
        "failures": failures_summary,
        "final_counts": final_counts,
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


def _normalize_material_type(value: Any) -> str | None:
    key = _clean_key(value)
    if key in MATERIAL_TYPE_MAP:
        return MATERIAL_TYPE_MAP[key]
    if key in {"ROH", "FERT", "HALB", "HAWA"}:
        return key
    return None


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


def _parse_row_number(issue: dict[str, Any]) -> int | None:
    raw = issue.get("row_number", issue.get("Row Number", issue.get("row")))
    is_zero_based_idx = False
    if raw in (None, "") and issue.get("idx") not in (None, ""):
        raw = issue["idx"]
        is_zero_based_idx = True
    try:
        row_number = int(raw) + 1 if is_zero_based_idx else int(raw)
    except (TypeError, ValueError):
        return None
    return row_number if row_number > 0 else None


def _normalize_validation_issue(issue: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(issue)
    normalized["rule_code"] = _clean_key(
        issue.get("rule_code")
        or issue.get("Rule Code")
        or issue.get("rule")
    )
    row_num = _parse_row_number(issue)
    normalized["row"] = row_num
    normalized["row_number"] = row_num
    normalized["row_index"] = (row_num - 1) if (row_num is not None and row_num > 0) else 0
    normalized["field"] = _stringify(
        issue.get("field_name")
        or issue.get("Field Name")
        or issue.get("field")
        or issue.get("f")
    ).strip()
    normalized["field_name"] = normalized["field"]

    if "rule_type" not in normalized and "Rule Type" in issue:
        normalized["rule_type"] = issue["Rule Type"]
    if "severity" not in normalized and "Severity" in issue:
        normalized["severity"] = issue["Severity"]
    if "reason" not in normalized and "Reason" in issue:
        normalized["reason"] = issue["Reason"]
    if "invalid_value" not in normalized and "Invalid Value" in issue:
        normalized["invalid_value"] = issue["Invalid Value"]

    return normalized


def _normalize_validation_report_payload(payload: Any) -> dict[str, Any]:
    if payload is None:
        return {"version": "1.0", "issues": []}

    if isinstance(payload, dict):
        raw_issues = payload.get("issues", [])
        version = payload.get("version", "1.0")
    elif isinstance(payload, list):
        raw_issues = payload
        version = "1.0"
    else:
        raw_issues = []
        version = "1.0"

    issues = [
        _normalize_validation_issue(issue)
        for issue in raw_issues
        if isinstance(issue, dict)
    ]
    return {"version": version, "issues": issues}


def load_validation_report(
    validation_report_csv_path: str | Path | None = None,
    validation_report_payload: Any = None,
) -> dict[str, Any]:
    if validation_report_payload is not None:
        return _normalize_validation_report_payload(validation_report_payload)

    if not validation_report_csv_path:
        return {"version": "1.0", "issues": []}

    path = Path(validation_report_csv_path)
    if not path.exists():
        return {"version": "1.0", "issues": []}

    if path.suffix.lower() == ".json":
        try:
            with path.open("r", encoding="utf-8") as handle:
                return _normalize_validation_report_payload(json.load(handle))
        except Exception:
            return {"version": "1.0", "issues": []}
        
    try:
        df = pd.read_csv(path, dtype=str, keep_default_na=False)
    except Exception:
        return {"version": "1.0", "issues": []}
        
    issues = []
    # CSV compatibility path. Production flow passes the complete DB payload.
    for _, row in df.iterrows():
        issue = _normalize_validation_issue(row.to_dict())
        if issue.get("row") and issue.get("rule_code") and issue.get("field"):
            issues.append(issue)
            
    return {"version": "1.0", "issues": issues}


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
    value = _get_value(df, idx, field_name).strip()
    if re.fullmatch(r"\d+", value):
        return
    _warn_skipped(summary, rule_code, issue["row"], field_name, "identifier must contain only digits")


def fix_country_code_format(
    df: pd.DataFrame,
    issue: dict[str, Any],
    summary: CleaningSummary,
    rule_code: str,
) -> None:
    field_name = issue["field"]
    idx = _row_index(issue["row"])
    value = _get_value(df, idx, field_name).strip().upper()
    if re.fullmatch(r"[A-Z]{2,3}", value):
        return
    _warn_skipped(summary, rule_code, issue["row"], field_name, "country value does not match ISO 2-3 letter format")


def fix_currency_code_format(
    df: pd.DataFrame,
    issue: dict[str, Any],
    summary: CleaningSummary,
    rule_code: str,
) -> None:
    field_name = issue["field"]
    idx = _row_index(issue["row"])
    value = _get_value(df, idx, field_name).strip().upper()
    if re.fullmatch(r"[A-Z]{3}", value):
        return
    _warn_skipped(summary, rule_code, issue["row"], field_name, "currency value does not match ISO 4217 3-letter format")


def fix_email_address_format(
    df: pd.DataFrame,
    issue: dict[str, Any],
    summary: CleaningSummary,
    rule_code: str,
) -> None:
    field_name = issue["field"]
    idx = _row_index(issue["row"])
    value = _get_value(df, idx, field_name).strip()
    if EMAIL_RE.match(value):
        return
    _warn_skipped(summary, rule_code, issue["row"], field_name, "email value does not match valid @ format")


def fix_date_yyyymmdd_format(
    df: pd.DataFrame,
    issue: dict[str, Any],
    summary: CleaningSummary,
    rule_code: str,
) -> None:
    field_name = issue["field"]
    idx = _row_index(issue["row"])
    value = _get_value(df, idx, field_name).strip()
    if re.fullmatch(r"\d{8}", value):
        return
    _warn_skipped(summary, rule_code, issue["row"], field_name, "date value does not match YYYYMMDD 8-digit format")


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
    value = _get_value(df, idx, field_name)
    normalized = _normalize_payment_term(value)
    if normalized is not None:
        _set_value(df, idx, field_name, normalized, summary, "validation", rule_code)
    else:
        _warn_skipped(summary, rule_code, issue["row"], field_name, f"payment term value '{value}' cannot be auto-formatted to SAP key")


# =============================================================================
# Cleanser Rule Functions
# =============================================================================

def apply_trim_whitespace(df: pd.DataFrame, summary: CleaningSummary, rule_code: str, params: dict[str, Any] | None = None) -> None:
    for idx in df.index:
        for field_name in df.columns:
            value = _get_value(df, idx, field_name)
            _set_value(df, idx, field_name, value.strip(), summary, "cleanser", rule_code)


def apply_country_to_iso(df: pd.DataFrame, summary: CleaningSummary, rule_code: str, params: dict[str, Any] | None = None) -> None:
    for field_name in _iter_existing_fields(df, COUNTRY_FIELD_NAMES):
        for idx in df.index:
            value = _get_value(df, idx, field_name)
            if not _is_empty(value):
                normalized = _normalize_country(value)
                if normalized is None:
                    _warn_skipped(summary, rule_code, idx + 1, field_name, "country value is unsupported")
                    continue
                _set_value(df, idx, field_name, normalized, summary, "cleanser", rule_code)


def apply_currency_to_iso(df: pd.DataFrame, summary: CleaningSummary, rule_code: str, params: dict[str, Any] | None = None) -> None:
    for field_name in _iter_existing_fields(df, CURRENCY_FIELD_NAMES):
        for idx in df.index:
            value = _get_value(df, idx, field_name)
            if not _is_empty(value):
                normalized = _normalize_currency(value)
                if normalized is None:
                    _warn_skipped(summary, rule_code, idx + 1, field_name, "currency value is unsupported")
                    continue
                _set_value(df, idx, field_name, normalized, summary, "cleanser", rule_code)


def apply_payment_terms_to_sf(df: pd.DataFrame, summary: CleaningSummary, rule_code: str, params: dict[str, Any] | None = None) -> None:
    for field_name in _iter_existing_fields(df, PAYMENT_TERM_FIELD_NAMES):
        for idx in df.index:
            value = _get_value(df, idx, field_name)
            if not _is_empty(value):
                normalized = _normalize_payment_term(value)
                if normalized is None:
                    _warn_skipped(summary, rule_code, idx + 1, field_name, "payment term value is unsupported")
                    continue
                _set_value(df, idx, field_name, normalized, summary, "cleanser", rule_code)

apply_payment_terms_to_sap = apply_payment_terms_to_sf


def apply_material_type_to_sf(df: pd.DataFrame, summary: CleaningSummary, rule_code: str, params: dict[str, Any] | None = None) -> None:
    for field_name in _iter_existing_fields(df, MATERIAL_TYPE_FIELD_NAMES):
        for idx in df.index:
            value = _get_value(df, idx, field_name)
            if not _is_empty(value):
                normalized = _normalize_material_type(value)
                if normalized is None:
                    _warn_skipped(summary, rule_code, idx + 1, field_name, "material type value is unsupported")
                    continue
                _set_value(df, idx, field_name, normalized, summary, "cleanser", rule_code)

apply_material_type_to_sap = apply_material_type_to_sf


def apply_pad_numeric_identifier(df: pd.DataFrame, summary: CleaningSummary, rule_code: str, params: dict[str, Any] | None = None) -> None:
    for field_name in _iter_existing_fields(df, set(IDENTIFIER_LENGTHS)):
        for idx in df.index:
            value = _get_value(df, idx, field_name)
            if not _is_empty(value):
                normalized = _normalize_identifier(value, field_name, idx + 1)
                if normalized is None:
                    _warn_skipped(summary, rule_code, idx + 1, field_name, "identifier has no recoverable numeric content")
                    continue
                _set_value(df, idx, field_name, normalized, summary, "cleanser", rule_code)


def apply_uppercase_code_fields(df: pd.DataFrame, summary: CleaningSummary, rule_code: str, params: dict[str, Any] | None = None) -> None:
    for field_name in _iter_existing_fields(df, CODE_FIELD_NAMES):
        for idx in df.index:
            value = _get_value(df, idx, field_name)
            if not _is_empty(value):
                _set_value(df, idx, field_name, value.upper(), summary, "cleanser", rule_code)


def apply_clean_tax_number(df: pd.DataFrame, summary: CleaningSummary, rule_code: str, params: dict[str, Any] | None = None) -> None:
    tax_fields = [col for col in df.columns if re.search(r"(^STCD\d*$|TAX_NUMBER|PAN|GST)", _field_key(col))]
    for field_name in tax_fields:
        for idx in df.index:
            value = _get_value(df, idx, field_name)
            if not _is_empty(value):
                cleaned = re.sub(r"[^A-Z0-9]", "", value.upper())
                _set_value(df, idx, field_name, cleaned, summary, "cleanser", rule_code)


def apply_truncate_overlength(df: pd.DataFrame, summary: CleaningSummary, rule_code: str, params: dict[str, Any] | None = None) -> None:
    for field_name in df.columns:
        max_length = FIELD_LENGTHS.get(_field_key(field_name))
        if max_length is None:
            continue
        for idx in df.index:
            value = _get_value(df, idx, field_name)
            if len(value) > max_length:
                _set_value(df, idx, field_name, value[:max_length], summary, "cleanser", rule_code)


def apply_fill_empty_fields(df: pd.DataFrame, summary: CleaningSummary, rule_code: str, params: dict[str, Any] | None = None) -> None:
    for idx in df.index:
        for field_name in df.columns:
            value = _get_value(df, idx, field_name)
            if pd.isna(value):
                _set_value(df, idx, field_name, "", summary, "cleanser", rule_code)


# =============================================================================
# Rule Registries
# =============================================================================

ValidationFixer = Callable[[pd.DataFrame, dict[str, Any], CleaningSummary, str], None]
CleanserRule = Callable[..., None]

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

# Production Validation rule codes are the source of truth. The VAL_* keys are
# retained only for standalone fixture compatibility and point at the same
# existing fixer functions.
VALIDATION_FIXERS.update({
    "REQUIRED_FIELDS": fix_required_fields,
    "NUMERIC_ID": fix_numeric_identifier_format,
    "COUNTRY_ISO": fix_country_code_format,
    "CURRENCY_ISO": fix_currency_code_format,
    "EMAIL_FORMAT": fix_email_address_format,
    "DATE_FORMAT": fix_date_yyyymmdd_format,
    "FIELD_LENGTH": fix_field_length,
    "PAYMENT_TERMS": fix_payment_terms_format,
})

CLEANSER_RULES: list[tuple[str, CleanserRule]] = [
    ("CL_TRIM_WHITESPACE", apply_trim_whitespace),
    ("CL_COUNTRY_TO_ISO", apply_country_to_iso),
    ("CL_CURRENCY_TO_ISO", apply_currency_to_iso),
    ("CL_PAYMENT_TERMS_TO_SF", apply_payment_terms_to_sf),
    ("CL_MATERIAL_TYPE_TO_SF", apply_material_type_to_sf),
    ("CL_PAYMENT_TERMS_TO_SAP", apply_payment_terms_to_sap),
    ("CL_MATERIAL_TYPE_TO_SAP", apply_material_type_to_sap),
    ("CL_PAD_NUMERIC_IDENTIFIER", apply_pad_numeric_identifier),
    ("CL_UPPERCASE_CODE_FIELDS", apply_uppercase_code_fields),
    ("CL_CLEAN_TAX_NUMBER", apply_clean_tax_number),
    ("CL_TRUNCATE_OVERLENGTH", apply_truncate_overlength),
    ("CL_FILL_EMPTY_FIELDS", apply_fill_empty_fields),
]


# =============================================================================
# Rule Resolution Plan
# =============================================================================

SEMANTIC_CLEANSER_RULE_FIELDS: dict[str, set[str]] = {
    "CL_COUNTRY_TO_ISO": COUNTRY_FIELD_NAMES,
    "CL_CURRENCY_TO_ISO": CURRENCY_FIELD_NAMES,
    "CL_PAYMENT_TERMS_TO_SF": PAYMENT_TERM_FIELD_NAMES,
    "CL_MATERIAL_TYPE_TO_SF": MATERIAL_TYPE_FIELD_NAMES,
    "CL_PAYMENT_TERMS_TO_SAP": PAYMENT_TERM_FIELD_NAMES,
    "CL_MATERIAL_TYPE_TO_SAP": MATERIAL_TYPE_FIELD_NAMES,
    "CL_PAD_NUMERIC_IDENTIFIER": set(IDENTIFIER_LENGTHS),
    "CL_UPPERCASE_CODE_FIELDS": CODE_FIELD_NAMES,
    "CL_CLEAN_TAX_NUMBER": {"STCD1", "STCD2", "TAX_NUMBER", "PAN", "GST"},
    "CL_TRUNCATE_OVERLENGTH": set(FIELD_LENGTHS),
}


def _issue_rule_code(issue: dict[str, Any]) -> str:
    return _clean_key(issue.get("rule_code") or issue.get("rule") or issue.get("Rule Code"))


def _issue_field(issue: dict[str, Any]) -> str:
    return _field_key(
        _stringify(
            issue.get("field")
            or issue.get("field_name")
            or issue.get("Field Name")
            or issue.get("f")
            or "GENERAL"
        )
    )


def _is_dynamic_issue(issue: dict[str, Any]) -> bool:
    rule_code = _issue_rule_code(issue)
    rule_type = _clean_key(issue.get("rule_type") or issue.get("Rule Type"))
    return rule_code.startswith("DYNAMIC_") or "DYNAMIC" in rule_type


def _dynamic_rule_field(rule: dict[str, Any]) -> str:
    return _field_key(_stringify(rule.get("field") or "GENERAL"))


def _dynamic_rule_id(rule: dict[str, Any]) -> str:
    return _clean_key(rule.get("id") or rule.get("rule_code"))


def _issue_group_key(issue: dict[str, Any]) -> tuple[str, str, str]:
    scope = "dynamic" if _is_dynamic_issue(issue) else "standard_validation"
    return (scope, _issue_rule_code(issue) or "UNKNOWN_RULE", _issue_field(issue))


def _issue_group_to_dict(key: tuple[str, str, str], issues: list[dict[str, Any]]) -> dict[str, Any]:
    scope, rule_code, field_name = key
    return {
        "group_id": f"{scope}:{rule_code}:{field_name}",
        "scope": scope,
        "rule_code": rule_code,
        "field_name": field_name,
        "issue_count": len(issues),
        "issues": [dict(issue) for issue in issues],
    }


def _cleanser_rule_conflicts(dynamic_fields: set[str], rule_code: str) -> bool:
    target_fields = {_field_key(field) for field in SEMANTIC_CLEANSER_RULE_FIELDS.get(rule_code, set())}
    return bool(dynamic_fields and target_fields and dynamic_fields.intersection(target_fields))


def build_cleanser_execution_plan(
    validation_report: dict[str, Any] | None,
    *,
    project_id: str | None = None,
    target_object: str | None = None,
    dynamic_rules: list[dict[str, Any]] | None = None,
    dynamic_rule_store_path: str | Path | None = None,
    cleanser_rules: list[tuple[str, CleanserRule]] | None = None,
) -> dict[str, Any]:
    """
    Build a deterministic rule-resolution plan without modifying data.

    Dynamic rules are active policies even when there are zero validation
    issues, so they can suppress lower-priority generic Cleanser rules. This
    function intentionally does not execute dynamic fixers, call an LLM, or
    change standard rule implementations.
    """
    issues = [
        dict(issue)
        for issue in (validation_report or {}).get("issues", [])
        if isinstance(issue, dict)
    ]
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for issue in issues:
        grouped.setdefault(_issue_group_key(issue), []).append(issue)

    issue_groups = [_issue_group_to_dict(key, value) for key, value in sorted(grouped.items())]
    dynamic_issue_groups = [group for group in issue_groups if group["scope"] == "dynamic"]
    standard_issue_groups = [group for group in issue_groups if group["scope"] == "standard_validation"]

    stored_dynamic_rules = dynamic_rules
    if stored_dynamic_rules is None:
        stored_dynamic_rules = get_relevant_rules_for_cleanser(
            project_id=project_id,
            target_object=target_object,
            store_path=dynamic_rule_store_path,
        )

    dynamic_fields = {
        field
        for field in (_dynamic_rule_field(rule) for rule in stored_dynamic_rules)
        if field and field != "GENERAL"
    }

    dynamic_items = []
    satisfied_dynamic_rules = []
    for rule in stored_dynamic_rules:
        rule_id = _dynamic_rule_id(rule)
        field_name = _dynamic_rule_field(rule)
        matching_groups = [
            group
            for group in issue_groups
            if (rule_id and group["rule_code"] == rule_id)
            or (field_name != "GENERAL" and group["field_name"] == field_name)
        ]
        status = "has_issues" if matching_groups else "satisfied"
        item = {
            "rule": dict(rule),
            "rule_code": rule_id,
            "field_name": field_name,
            "status": status,
            "issue_groups": matching_groups,
        }
        dynamic_items.append(item)
        if status == "satisfied":
            satisfied_dynamic_rules.append(item)

    standard_validation_items = []
    overridden_rules = []
    unknown_rules = []
    for group in standard_issue_groups:
        overridden_by = [
            item["rule_code"]
            for item in dynamic_items
            if item["field_name"] != "GENERAL" and item["field_name"] == group["field_name"]
        ]
        status = "overridden" if overridden_by else "planned"
        item = {
            **group,
            "status": status,
            "overridden_by": overridden_by,
        }
        standard_validation_items.append(item)
        if overridden_by:
            overridden_rules.append({
                "rule_code": group["rule_code"],
                "rule_type": "standard_validation",
                "field_name": group["field_name"],
                "overridden_by": overridden_by,
                "reason": "Dynamic rule targets the same logical field.",
            })
        if group["rule_code"] not in VALIDATION_FIXERS:
            unknown_rules.append({
                "rule_code": group["rule_code"],
                "rule_type": "standard_validation",
                "field_name": group["field_name"],
                "issue_count": group["issue_count"],
                "reason": "No validation fixer is registered for this rule.",
            })

    dynamic_unknown_groups = []
    for group in dynamic_issue_groups:
        matched = [
            item["rule_code"]
            for item in dynamic_items
            if (item["rule_code"] and item["rule_code"] == group["rule_code"])
            or (item["field_name"] != "GENERAL" and item["field_name"] == group["field_name"])
        ]
        if not matched:
            dynamic_unknown_groups.append(group)
            unknown_rules.append({
                "rule_code": group["rule_code"],
                "rule_type": "dynamic",
                "field_name": group["field_name"],
                "issue_count": group["issue_count"],
                "reason": "Dynamic issue has no matching stored dynamic rule.",
            })

    cleanser_items = []
    active_dynamic_ids = [item["rule_code"] for item in dynamic_items if item["rule_code"]]
    for rule_code, _rule_func in cleanser_rules or CLEANSER_RULES:
        suppressed = _cleanser_rule_conflicts(dynamic_fields, rule_code)
        item = {
            "rule_code": rule_code,
            "rule_type": "standard_cleanser",
            "status": "suppressed" if suppressed else "planned",
            "overridden_by": active_dynamic_ids if suppressed else [],
        }
        cleanser_items.append(item)
        if suppressed:
            overridden_rules.append({
                "rule_code": rule_code,
                "rule_type": "standard_cleanser",
                "field_name": "MULTIPLE",
                "overridden_by": active_dynamic_ids,
                "reason": "Dynamic rule targets a field handled by this generic Cleanser rule.",
            })

    return {
        "version": "1.0",
        "priority_order": ["dynamic", "standard_validation", "standard_cleanser"],
        "issue_groups": issue_groups,
        "dynamic_rules": {
            "count": len(dynamic_items),
            "items": dynamic_items,
        },
        "standard_validation_rules": {
            "count": len(standard_validation_items),
            "items": standard_validation_items,
        },
        "standard_cleanser_rules": {
            "count": len(cleanser_items),
            "items": cleanser_items,
        },
        "overridden_rules": overridden_rules,
        "satisfied_dynamic_rules": {
            "count": len(satisfied_dynamic_rules),
            "items": satisfied_dynamic_rules,
        },
        "unresolved_unknown_rules": {
            "count": len(unknown_rules),
            "items": unknown_rules,
        },
        "dynamic_issue_groups_without_stored_rule": dynamic_unknown_groups,
    }


# =============================================================================
# Dynamic Fixer Generation
# =============================================================================

LLMGenerator = Callable[[str, str], str]

FORBIDDEN_DYNAMIC_FIXER_CALLS = {
    "__import__",
    "breakpoint",
    "compile",
    "delattr",
    "dir",
    "eval",
    "exec",
    "getattr",
    "globals",
    "help",
    "input",
    "locals",
    "open",
    "setattr",
    "vars",
}

FORBIDDEN_DYNAMIC_FIXER_METHODS = {
    "connect",
    "delete",
    "dump",
    "dumps",
    "execute",
    "mkdir",
    "makedirs",
    "open",
    "popen",
    "post",
    "put",
    "read_csv",
    "remove",
    "rename",
    "replace",
    "request",
    "rmdir",
    "system",
    "to_clipboard",
    "to_csv",
    "to_excel",
    "to_feather",
    "to_json",
    "to_parquet",
    "to_pickle",
    "to_sql",
    "unlink",
}

FORBIDDEN_DYNAMIC_FIXER_NAMES = {
    "__builtins__",
    "builtins",
    "db",
    "httpx",
    "json",
    "openai",
    "os",
    "pathlib",
    "requests",
    "shutil",
    "socket",
    "subprocess",
    "supabase",
    "sys",
}


def _default_dynamic_fixer_generation() -> dict[str, Any]:
    return {
        "generated_fixers": [],
        "skipped_satisfied_rules": [],
        "failed_generations": [],
        "llm_calls": 0,
    }


def _safe_issue_for_prompt(issue: dict[str, Any]) -> dict[str, Any]:
    allowed_keys = (
        "rule_code",
        "rule_type",
        "row_number",
        "row_index",
        "row",
        "field_name",
        "field",
        "severity",
        "reason",
        "invalid_value",
    )
    res = {
        key: issue[key]
        for key in allowed_keys
        if key in issue and issue[key] not in (None, "")
    }
    if "row_index" not in res:
        r = res.get("row_number") or res.get("row") or 1
        try:
            res["row_index"] = max(0, int(r) - 1)
        except Exception:
            res["row_index"] = 0
    return res


def _dynamic_rule_description(rule: dict[str, Any]) -> str:
    return _stringify(
        rule.get("description")
        or rule.get("rule_text")
        or rule.get("error_message")
        or rule.get("label")
        or "Dynamic rule"
    )


def _extract_dynamic_fixer_code(raw_response: str) -> str:
    raw = _stringify(raw_response).strip()
    if not raw:
        raise ValueError("LLM returned an empty response.")

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            code = parsed.get("code") or parsed.get("python_code") or parsed.get("fixer_code")
            if isinstance(code, str):
                return code.strip()
        raise ValueError("LLM JSON did not contain code/python_code/fixer_code.")
    except json.JSONDecodeError:
        fenced = re.search(r"```(?:python)?\s*(.*?)```", raw, re.DOTALL | re.IGNORECASE)
        return (fenced.group(1) if fenced else raw).strip()


def validate_dynamic_fixer_code(code: str) -> tuple[bool, str]:
    """
    Validate generated Python without executing it.

    The only accepted contract is:
        def fix_dynamic_rule(df, issue_rows):
            ...
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return False, f"Python syntax error: {exc}"

    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)]
    if len(functions) != 1 or functions[0].name != "fix_dynamic_rule":
        return False, "Code must define exactly one function named fix_dynamic_rule."

    function = functions[0]
    arg_names = [arg.arg for arg in function.args.args]
    if arg_names != ["df", "issue_rows"]:
        return False, "fix_dynamic_rule must accept exactly df and issue_rows."
    if function.decorator_list:
        return False, "Decorators are not allowed."
    if not any(isinstance(node, ast.Return) for node in ast.walk(function)):
        return False, "fix_dynamic_rule must return a dataframe/result."

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            return False, "Imports are not allowed in dynamic fixer code."
        if isinstance(node, (ast.AsyncFunctionDef, ast.ClassDef, ast.Global, ast.Nonlocal, ast.Delete, ast.With, ast.AsyncWith)):
            return False, f"{type(node).__name__} is not allowed in dynamic fixer code."
        if isinstance(node, ast.Name):
            if node.id.startswith("__") or node.id in FORBIDDEN_DYNAMIC_FIXER_NAMES:
                return False, f"Forbidden name used: {node.id}"
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("__"):
                return False, f"Forbidden attribute used: {node.attr}"
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in FORBIDDEN_DYNAMIC_FIXER_CALLS:
                return False, f"Forbidden call used: {node.func.id}"
            if isinstance(node.func, ast.Attribute) and node.func.attr in FORBIDDEN_DYNAMIC_FIXER_METHODS:
                return False, f"Forbidden method call used: {node.func.attr}"

    return True, "ok"


def _build_dynamic_fixer_prompts(rule_item: dict[str, Any], issue_group: dict[str, Any]) -> tuple[str, str]:
    rule = rule_item.get("rule") if isinstance(rule_item.get("rule"), dict) else {}
    issues = [
        _safe_issue_for_prompt(issue)
        for issue in issue_group.get("issues", [])
        if isinstance(issue, dict)
    ]
    invalid_values = sorted({
        _stringify(issue.get("invalid_value")).strip()
        for issue in issues
        if _stringify(issue.get("invalid_value")).strip()
    })
    payload = {
        "dynamic_rule": {
            "id": rule_item.get("rule_code") or rule.get("id"),
            "field": rule_item.get("field_name") or rule.get("field") or issue_group.get("field_name"),
            "label": rule.get("label"),
            "description": _dynamic_rule_description(rule),
            "severity": rule.get("severity"),
            "error_message": rule.get("error_message"),
            "source": rule.get("source"),
            "priority": rule.get("priority"),
        },
        "issue_group": {
            "group_id": issue_group.get("group_id"),
            "rule_code": issue_group.get("rule_code"),
            "field_name": issue_group.get("field_name"),
            "issue_count": issue_group.get("issue_count", len(issues)),
            "invalid_values": invalid_values[:20],
            "issues": issues,
        },
    }

    system_prompt = """You generate safe runtime Python fixers for SuccessFactors migration cleansing.
Return ONLY a JSON object with a string field named "code".
The code must define exactly:
def fix_dynamic_rule(df, issue_rows):

CRITICAL DATAFRAME INDEXING & FIELD INSTRUCTIONS:
1. USE 0-INDEXED `row_index`: Each item in `issue_rows` has integer `row_index` (0-indexed position in `df`). Use `row_idx = int(issue.get('row_index', 0))` to index into `df.at[row_idx, col_name]`. (Do NOT use 1-indexed `row_number` directly as DataFrame index).
2. TARGET COLUMN MATCHING: Find target column in `df.columns` by checking case-insensitively (e.g. if field is 'COUNTRY', check for 'COUNTRY' or 'LAND1' in `df.columns`). If field is 'MULTIPLE' or 'GENERAL', inspect `issue.get('field')` or `issue.get('field_name')` inside each item in `issue_rows` to match target column names in `df.columns`.
3. DATA-TYPE AWARE PADDING/EXTENSION:
   - If the rule requires target length N (e.g. 4) and value contains text/letters (e.g. 'IN'): Right-pad/extend with '0' or 'X' to length N (e.g. 'IN' -> 'IN00' or 'INXX').
   - If value is purely numeric (e.g. '12'): Left-pad with zeroes to length N (e.g. '0012').
   - If empty: Fill valid default value matching required format.
4. CONTRACT:
   Must modify `df` at `row_idx` for target column for issue_rows and return `df`.
   Do not import modules, access files, call shell commands, or access network/database."""
    user_prompt = json.dumps(payload, indent=2, sort_keys=True)
    return system_prompt, user_prompt


def generate_dynamic_fixers_from_plan(
    execution_plan: dict[str, Any] | None,
    *,
    llm_generator: LLMGenerator | None = None,
) -> dict[str, Any]:
    """
    Generate one in-memory fixer per dynamic issue group.

    This does not execute generated code and does not persist it anywhere.
    """
    result = _default_dynamic_fixer_generation()
    plan = execution_plan or {}
    dynamic_items = plan.get("dynamic_rules", {}).get("items", [])

    generated_group_ids: set[str] = set()
    for rule_item in dynamic_items:
        if not isinstance(rule_item, dict):
            continue

        if rule_item.get("status") == "satisfied":
            result["skipped_satisfied_rules"].append({
                "dynamic_rule_id": rule_item.get("rule_code"),
                "field": rule_item.get("field_name"),
                "status": "satisfied",
                "reason": "No validation issues for this dynamic rule.",
            })

        for issue_group in rule_item.get("issue_groups", []):
            if not isinstance(issue_group, dict):
                continue
            group_id = _stringify(issue_group.get("group_id"))
            if group_id in generated_group_ids:
                continue
            generated_group_ids.add(group_id)

            fixer_base = {
                "dynamic_rule_id": rule_item.get("rule_code"),
                "rule_code": issue_group.get("rule_code") or rule_item.get("rule_code"),
                "field": issue_group.get("field_name") or rule_item.get("field_name"),
                "issue_count": issue_group.get("issue_count", len(issue_group.get("issues", []))),
                "group_id": group_id,
            }
            try:
                system_prompt, user_prompt = _build_dynamic_fixer_prompts(rule_item, issue_group)
                result["llm_calls"] += 1
                if llm_generator is None:
                    from services.llm_orchestrator import llm_orchestrator
                    llm_generator = llm_orchestrator.generate_generic
                raw_response = llm_generator(system_prompt, user_prompt)
                code = _extract_dynamic_fixer_code(raw_response)
                is_valid, validation_message = validate_dynamic_fixer_code(code)
                if not is_valid:
                    result["failed_generations"].append({
                        **fixer_base,
                        "status": "rejected",
                        "reason": validation_message,
                    })
                    continue
                result["generated_fixers"].append({
                    **fixer_base,
                    "status": "generated",
                    "code": code,
                })
            except Exception as exc:
                result["failed_generations"].append({
                    **fixer_base,
                    "status": "failed",
                    "reason": str(exc),
                })

    # Process any dynamic issue groups that were not tied to a pre-stored rule
    for issue_group in plan.get("issue_groups", []):
        if not isinstance(issue_group, dict) or issue_group.get("scope") != "dynamic":
            continue
        group_id = _stringify(issue_group.get("group_id"))
        if group_id in generated_group_ids:
            continue
        generated_group_ids.add(group_id)

        rule_item = {"rule": {}, "rule_code": issue_group.get("rule_code"), "field_name": issue_group.get("field_name")}
        fixer_base = {
            "dynamic_rule_id": issue_group.get("rule_code"),
            "rule_code": issue_group.get("rule_code"),
            "field": issue_group.get("field_name"),
            "issue_count": issue_group.get("issue_count", len(issue_group.get("issues", []))),
            "group_id": group_id,
        }
        try:
            system_prompt, user_prompt = _build_dynamic_fixer_prompts(rule_item, issue_group)
            result["llm_calls"] += 1
            if llm_generator is None:
                from services.llm_orchestrator import llm_orchestrator
                llm_generator = llm_orchestrator.generate_generic
            raw_response = llm_generator(system_prompt, user_prompt)
            code = _extract_dynamic_fixer_code(raw_response)
            is_valid, validation_message = validate_dynamic_fixer_code(code)
            if not is_valid:
                result["failed_generations"].append({
                    **fixer_base,
                    "status": "rejected",
                    "reason": validation_message,
                })
                continue
            result["generated_fixers"].append({
                **fixer_base,
                "status": "generated",
                "code": code,
            })
        except Exception as exc:
            result["failed_generations"].append({
                **fixer_base,
                "status": "failed",
                "reason": str(exc),
            })

    return result


# =============================================================================
# Dynamic Fixer Execution
# =============================================================================

SAFE_DYNAMIC_BUILTINS = {
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "float": float,
    "int": int,
    "isinstance": isinstance,
    "len": len,
    "list": list,
    "max": max,
    "min": min,
    "range": range,
    "set": set,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "zip": zip,
    "print": print,
    "Exception": Exception,
    "ValueError": ValueError,
    "TypeError": TypeError,
    "KeyError": KeyError,
    "IndexError": IndexError,
    "AttributeError": AttributeError,
}


def _resolve_target_columns(df: pd.DataFrame, field_name: str, issues: list[dict[str, Any]] | None = None) -> list[str]:
    cols = list(df.columns)
    if not cols:
        return []

    # 1. Exact match
    if field_name in cols:
        return [field_name]

    # 2. Case-insensitive / clean key match
    clean_target = _field_key(field_name) if field_name else ""
    matched = [c for c in cols if _field_key(c) == clean_target]
    if matched:
        return matched

    # 3. If field_name is MULTIPLE or GENERAL, inspect issue list for specific fields
    if field_name in ("MULTIPLE", "GENERAL", "") and issues:
        resolved = set()
        for issue in issues:
            f = issue.get("field") or issue.get("field_name")
            if f and f not in ("MULTIPLE", "GENERAL"):
                m = [c for c in cols if _field_key(c) == _field_key(f) or c.lower() == str(f).lower()]
                resolved.update(m)
        if resolved:
            return list(resolved)

    # 4. Partial substring matching (e.g. "Employee External ID" vs "person_id_external" or "employee_id")
    target_lower = (field_name or "").lower()
    if "id" in target_lower or "external" in target_lower:
        id_cols = [c for c in cols if "id" in c.lower() or "external" in c.lower() or "kunnr" in c.lower() or "lifnr" in c.lower()]
        if id_cols:
            return id_cols

    return cols if field_name in ("MULTIPLE", "GENERAL") else []


def _apply_deterministic_dynamic_fallback(
    df: pd.DataFrame,
    rule_code: str,
    field_name: str,
    description: str,
    issues: list[dict[str, Any]],
    summary: CleaningSummary,
) -> int:
    """
    Deterministic fallback engine for dynamic validation rules when LLM generation
    is unavailable or fails. Matches common rule intents (numeric, uppercase, trim, date)
    and applies clean fixes directly.
    """
    desc_clean = _clean_key(description)
    total_fixes = 0

    resolved_cols = _resolve_target_columns(df, field_name, issues)

    # Rule intent heuristics
    is_numeric_rule = any(kw in desc_clean for kw in ["NUMERIC", "DIGIT", "NUMBER", "INTEGER", "ONLY NUMBERS"])
    is_uppercase_rule = any(kw in desc_clean for kw in ["UPPERCASE", "CAPITAL", "UPPER"])
    is_trim_rule = any(kw in desc_clean for kw in ["SPACE", "WHITESPACE", "TRIM", "PADDING"])
    is_date_rule = any(kw in desc_clean for kw in ["DATE", "YYYYMMDD", "FORMAT"])

    if not (is_numeric_rule or is_uppercase_rule or is_trim_rule or is_date_rule):
        if "ID" in desc_clean or "CODE" in desc_clean or rule_code.startswith("DYNAMIC_"):
            is_numeric_rule = True
        else:
            return 0

    for issue in issues:
        row_idx = issue.get("row_index")
        if row_idx is None:
            r = issue.get("row_number") or issue.get("row") or 1
            try:
                row_idx = max(0, int(r) - 1)
            except Exception:
                row_idx = 0

        if row_idx < 0 or row_idx >= len(df.index):
            continue

        issue_field = issue.get("field") or issue.get("field_name")
        target_cols = _resolve_target_columns(df, issue_field, None) if issue_field and issue_field not in ("MULTIPLE", "GENERAL") else resolved_cols

        if not target_cols:
            continue

        for col in target_cols:
            if col not in df.columns:
                continue
            old_val = _stringify(df.at[row_idx, col])
            new_val = old_val

            if is_numeric_rule:
                cleaned_digits = re.sub(r"\D", "", old_val)
                if cleaned_digits:
                    new_val = cleaned_digits
            elif is_uppercase_rule:
                new_val = old_val.upper()
            elif is_trim_rule:
                new_val = old_val.strip()
            elif is_date_rule:
                norm_d = _normalize_date(old_val)
                if norm_d:
                    new_val = norm_d

            if old_val != new_val:
                df.at[row_idx, col] = new_val
                summary.add_fix("dynamic", rule_code, row_idx + 1, col, old_val, new_val)
                total_fixes += 1

    return total_fixes


def execute_dynamic_fixers(
    df: pd.DataFrame,
    dynamic_fixer_generation: dict[str, Any],
    execution_plan: dict[str, Any],
    summary: CleaningSummary,
) -> pd.DataFrame:
    """
    Execute Phase 4 generated dynamic fixers against the dataset in restricted scope.

    Enforces dynamic fixer execution FIRST before standard validation fixes and
    standard cleanser rules. Includes deterministic fallback for failed AI generation.
    """
    executed_list = []
    skipped_list = []
    failed_list = []
    total_fixes = 0
    applied_dynamic_rules = []
    handled_group_ids = set()

    # 1. Log skipped satisfied rules from generation step
    for item in dynamic_fixer_generation.get("skipped_satisfied_rules", []):
        if isinstance(item, dict):
            skipped_list.append({
                "rule_code": item.get("dynamic_rule_id"),
                "field": item.get("field"),
                "reason": item.get("reason", "Satisfied dynamic rule with 0 issues."),
            })

    # 2. Log failed generation items
    for item in dynamic_fixer_generation.get("failed_generations", []):
        if isinstance(item, dict):
            failed_list.append({
                "group_id": item.get("group_id"),
                "rule_code": item.get("rule_code") or item.get("dynamic_rule_id"),
                "field": item.get("field"),
                "reason": f"Generation/safety validation failed: {item.get('reason')}",
            })

    # Build group_id lookup map for issue rows from execution plan
    groups_map = {
        _stringify(g.get("group_id")): g.get("issues", [])
        for g in execution_plan.get("issue_groups", [])
        if isinstance(g, dict) and g.get("group_id")
    }

    # 3. Execute each generated fixer that passed Phase 4 AST validation
    for fixer_info in dynamic_fixer_generation.get("generated_fixers", []):
        if not isinstance(fixer_info, dict):
            continue

        code = fixer_info.get("code", "")
        group_id = _stringify(fixer_info.get("group_id"))
        rule_code = fixer_info.get("rule_code") or fixer_info.get("dynamic_rule_id") or "DYNAMIC_RULE"
        field_name = fixer_info.get("field", "")

        # Safety re-validation
        is_valid, val_msg = validate_dynamic_fixer_code(code)
        if not is_valid:
            failed_list.append({
                "group_id": group_id,
                "rule_code": rule_code,
                "field": field_name,
                "reason": f"Safety re-validation failed: {val_msg}",
            })
            continue

        # Get issue rows specifically for this dynamic group
        issue_rows = groups_map.get(group_id, [])

        # Restricted execution namespace
        safe_globals = {"__builtins__": SAFE_DYNAMIC_BUILTINS, "pd": pd}
        local_scope: dict[str, Any] = {}

        try:
            exec(code, safe_globals, local_scope)
            fix_func = local_scope.get("fix_dynamic_rule")
            if not callable(fix_func):
                raise ValueError("Defined fix_dynamic_rule is not callable.")
        except Exception as exc:
            failed_list.append({
                "group_id": group_id,
                "rule_code": rule_code,
                "field": field_name,
                "reason": f"Compilation failed: {exc}",
            })
            continue

        # Capture copy before execution
        before_df = df.copy(deep=True)
        df_for_func = df.copy(deep=True)

        # Execute dynamic fixer function
        try:
            result_df = fix_func(df_for_func, issue_rows)
        except Exception as exc:
            failed_list.append({
                "group_id": group_id,
                "rule_code": rule_code,
                "field": field_name,
                "reason": f"Runtime exception during execution: {exc}",
            })
            continue

        # Handle return value (support in-place mutation returning None or returning a DataFrame)
        if result_df is None:
            after_df = df_for_func
        elif isinstance(result_df, pd.DataFrame):
            after_df = result_df
        else:
            failed_list.append({
                "group_id": group_id,
                "rule_code": rule_code,
                "field": field_name,
                "reason": f"Returned invalid result type: {type(result_df).__name__}",
            })
            continue

        # Structural validation on return result
        if len(after_df) != len(df) or list(after_df.columns) != list(df.columns):
            failed_list.append({
                "group_id": group_id,
                "rule_code": rule_code,
                "field": field_name,
                "reason": "Structural validation failed: columns or row count altered by fixer.",
            })
            continue

        # Cell-by-cell diff tracking (before vs after)
        group_fixes = 0
        for row_idx in range(len(df)):
            for col in df.columns:
                old_val = _stringify(before_df.at[row_idx, col])
                new_val = _stringify(after_df.at[row_idx, col])
                if old_val != new_val:
                    df.at[row_idx, col] = new_val
                    summary.add_fix("dynamic", rule_code, row_idx + 1, col, old_val, new_val)
                    group_fixes += 1

        if group_fixes > 0:
            handled_group_ids.add(group_id)
            executed_list.append({
                "group_id": group_id,
                "rule_code": rule_code,
                "field": field_name,
                "fixes_applied": group_fixes,
            })
            total_fixes += group_fixes
            if rule_code not in applied_dynamic_rules:
                applied_dynamic_rules.append(rule_code)
                summary.add_rule(rule_code)

    # 4. Deterministic Dynamic Fallback for unhandled dynamic issue groups (failed LLM gen or 0 fixes)
    issue_groups = execution_plan.get("issue_groups", []) if isinstance(execution_plan, dict) else []
    dynamic_rule_items = execution_plan.get("dynamic_rules", {}).get("items", []) if isinstance(execution_plan, dict) else []
    rules_desc_map = {
        _clean_key(r.get("rule_code") or r.get("rule", {}).get("id")): _dynamic_rule_description(r.get("rule", {}))
        for r in dynamic_rule_items
        if isinstance(r, dict)
    }

    for group in issue_groups:
        if not isinstance(group, dict) or group.get("scope") != "dynamic":
            continue
        g_id = _stringify(group.get("group_id"))
        if g_id in handled_group_ids:
            continue

        rule_code = group.get("rule_code") or "DYNAMIC_RULE"
        field_name = group.get("field_name") or "MULTIPLE"
        issues = group.get("issues", [])
        description = rules_desc_map.get(_clean_key(rule_code), issue_group_description := issues[0].get("reason", "") if issues else "")

        fallback_fixes = _apply_deterministic_dynamic_fallback(
            df,
            rule_code=rule_code,
            field_name=field_name,
            description=description,
            issues=issues,
            summary=summary,
        )

        if fallback_fixes > 0:
            handled_group_ids.add(g_id)
            executed_list.append({
                "group_id": g_id,
                "rule_code": rule_code,
                "field": field_name,
                "fixes_applied": fallback_fixes,
                "mode": "deterministic_fallback",
            })
            total_fixes += fallback_fixes
            if rule_code not in applied_dynamic_rules:
                applied_dynamic_rules.append(rule_code)
                summary.add_rule(rule_code)
            # Remove from failed_list if fallback succeeded
            failed_list = [f for f in failed_list if _stringify(f.get("group_id")) != g_id]

    summary.dynamic_fixer_execution = {
        "executed": executed_list,
        "skipped": skipped_list,
        "failed": failed_list,
        "fixes_count": total_fixes,
        "rules_applied": applied_dynamic_rules,
    }

    return df


# =============================================================================
# Main Agent
# =============================================================================

def apply_validation_fixes(
    df: pd.DataFrame,
    validation_report: dict[str, Any],
    summary: CleaningSummary,
    execution_plan: dict[str, Any] | None = None,
    excluded_validation_rules: list[str] | None = None,
) -> pd.DataFrame:
    overridden_rules = []
    if execution_plan:
        overridden_rules = execution_plan.get("overridden_rules", [])

    excluded_set = {_clean_key(r) for r in excluded_validation_rules} if excluded_validation_rules else set()

    for issue in validation_report.get("issues", []):
        rule_code = issue.get("rule_code")
        row_number = issue.get("row")
        field_name = issue.get("field")
        summary.validation_issues.append(dict(issue))

        rule_type = _stringify(issue.get("rule_type")).upper()
        if isinstance(rule_code, str) and (rule_code.startswith("DYNAMIC_") or "DYNAMIC" in rule_type):
            summary.dynamic_issues.append(dict(issue))
            continue

        if not isinstance(rule_code, str) or not rule_code or not isinstance(row_number, int) or not isinstance(field_name, str) or not field_name:
            summary.warnings.append(f"Skipped malformed validation issue: {issue}")
            continue

        if _clean_key(rule_code) in excluded_set:
            summary.warnings.append(f"Skipped validation rule {rule_code} for field {field_name} (excluded by user).")
            continue

        # Skip standard validation rules overridden by dynamic rules ONLY if dynamic fixer applied fixes
        clean_rule = _clean_key(rule_code)
        clean_field = _field_key(field_name)
        executed_fields = {
            _field_key(item.get("field", ""))
            for item in summary.dynamic_fixer_execution.get("executed", [])
            if item.get("fixes_applied", 0) > 0
        }
        is_overridden = clean_field in executed_fields and any(
            _clean_key(ov.get("rule_code")) == clean_rule and
            (ov.get("field_name") == "MULTIPLE" or _field_key(ov.get("field_name", "")) in (clean_field, "GENERAL"))
            for ov in overridden_rules
            if ov.get("rule_type") == "standard_validation"
        )
        if is_overridden:
            summary.warnings.append(f"Skipped standard validation rule {rule_code} for field {field_name} (overridden by dynamic rule).")
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


def apply_cleanser_rules(
    df: pd.DataFrame,
    summary: CleaningSummary,
    execution_plan: dict[str, Any] | None = None,
    standard_rules_config: list[dict[str, Any]] | None = None,
) -> pd.DataFrame:
    disabled_rules = set()
    rule_param_overrides = {}
    if standard_rules_config:
        for rule_cfg in standard_rules_config:
            if isinstance(rule_cfg, dict):
                code = rule_cfg.get("code") or rule_cfg.get("rule_code")
                enabled = rule_cfg.get("enabled", True)
                if code:
                    if not enabled:
                        disabled_rules.add(code)
                    if "params" in rule_cfg and isinstance(rule_cfg["params"], dict):
                        rule_param_overrides[code] = rule_cfg["params"]

    executed_fields = {
        _field_key(item.get("field", ""))
        for item in summary.dynamic_fixer_execution.get("executed", [])
        if item.get("fixes_applied", 0) > 0
    }
    suppressed_rules = set()
    if execution_plan:
        for item in execution_plan.get("standard_cleanser_rules", {}).get("items", []):
            if item.get("status") == "suppressed":
                rule_code = item.get("rule_code", "")
                target_fields = {_field_key(f) for f in SEMANTIC_CLEANSER_RULE_FIELDS.get(rule_code, set())}
                # Only suppress if dynamic fixer actually applied fixes for target field
                if target_fields.intersection(executed_fields):
                    suppressed_rules.add(rule_code)

    for rule_code, rule_func in CLEANSER_RULES:
        if rule_code in disabled_rules:
            summary.warnings.append(f"Skipped standard cleanser rule {rule_code} (disabled by user).")
            continue
        if rule_code in suppressed_rules:
            summary.warnings.append(f"Skipped generic cleanser rule {rule_code} (handled by active dynamic rule).")
            continue
        summary.add_rule(rule_code)
        params = rule_param_overrides.get(rule_code)
        if params:
            sig_params = inspect.signature(rule_func).parameters
            if "params" in sig_params or any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig_params.values()):
                rule_func(df, summary, rule_code, params=params)
            else:
                rule_func(df, summary, rule_code)
        else:
            rule_func(df, summary, rule_code)
    return df


def run_cleanser(
    dataset_csv_path: str | Path,
    validation_report_csv_path: str | Path | None = None,
    validation_report_payload: Any = None,
    output_csv_path: str | Path | None = None,
    project_id: str | None = None,
    target_object: str | None = None,
    dynamic_rules: list[dict[str, Any]] | None = None,
    dynamic_rule_store_path: str | Path | None = None,
    standard_rules_config: list[dict[str, Any]] | None = None,
    excluded_validation_rules: list[str] | None = None,
) -> dict[str, Any]:
    if output_csv_path is None:
        raise ValueError("output_csv_path is required.")

    dataset_csv_path = Path(dataset_csv_path)
    output_csv_path = Path(output_csv_path)
    validation_path = Path(validation_report_csv_path) if validation_report_csv_path else None

    df = load_csv(dataset_csv_path)
    validation_report = load_validation_report(validation_path, validation_report_payload)

    summary = CleaningSummary(
        input_csv_path=str(dataset_csv_path),
        validation_report_csv_path=str(validation_path) if validation_path else None,
        output_csv_path=str(output_csv_path),
        rows_loaded=len(df.index),
    )

    summary.execution_plan = build_cleanser_execution_plan(
        validation_report,
        project_id=project_id,
        target_object=target_object,
        dynamic_rules=dynamic_rules,
        dynamic_rule_store_path=dynamic_rule_store_path,
    )
    summary.dynamic_fixer_generation = generate_dynamic_fixers_from_plan(summary.execution_plan)

    # Phase 5 Execution Order:
    # 1. Execute dynamic fixers FIRST
    df = execute_dynamic_fixers(df, summary.dynamic_fixer_generation, summary.execution_plan, summary)

    # 2. Standard validation fixes (skipping overridden rules or user-excluded rules)
    apply_validation_fixes(df, validation_report, summary, summary.execution_plan, excluded_validation_rules=excluded_validation_rules)

    # 3. Standard cleanser rules (skipping suppressed or user-disabled rules)
    apply_cleanser_rules(df, summary, summary.execution_plan, standard_rules_config=standard_rules_config)

    export_cleaned_csv(df, output_csv_path)

    summary.rows_exported = len(df.index)
    return summary.to_dict()


def export_cleaned_csv(df: pd.DataFrame, output_csv_path: str | Path) -> None:
    output_path = Path(output_csv_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)
