"""
Unified Dynamic Rules Guardrails Engine for SF-DMS (SuccessFactors Data Migration Studio).

Centralized security sandbox, master data preservation, schema integrity,
and dataset invariance guardrails for:
  - Step 4: Harmonization (def transform(value, row): -> str)
  - Step 5: Validation (Single-line Python boolean condition)
  - Step 6: Cleansing (def fix_dynamic_rule(df, issue_rows): -> df)
  - Step 7: Transformation (def transform_data(df): -> df)
"""

from __future__ import annotations

import ast
import re
from typing import Any, Callable, Dict, List, Optional, Set, Tuple
import pandas as pd


# =============================================================================
# 1. Security Blacklists & Sandboxed Builtins
# =============================================================================

FORBIDDEN_CALLS: Set[str] = {
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

FORBIDDEN_METHODS: Set[str] = {
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

FORBIDDEN_MODULES: Set[str] = {
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
    "urllib",
    "urllib3",
}

ALLOWED_IMPORTS: Set[str] = {
    "pandas",
    "numpy",
    "math",
    "re",
    "datetime",
}


def _safe_import(name: str, globals: Any = None, locals: Any = None, fromlist: Any = (), level: int = 0) -> Any:
    """Safe importer allowing only whitelisted data manipulation libraries."""
    root_pkg = name.split(".")[0]
    if root_pkg in ALLOWED_IMPORTS:
        import builtins
        return builtins.__import__(name, globals, locals, fromlist, level)
    raise ImportError(f"Import of module '{name}' is strictly forbidden by guardrails.")


SAFE_DYNAMIC_BUILTINS: Dict[str, Any] = {
    "__import__": _safe_import,
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
    "round": round,
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


# =============================================================================
# 2. Generic AST Static Analysis
# =============================================================================

def validate_ast_security(
    code: str,
    *,
    expected_function_name: Optional[str] = None,
    expected_args: Optional[List[str]] = None,
    requires_return: bool = True,
    allow_multi_function: bool = False,
) -> Tuple[bool, str]:
    """
    Validate Python code using AST parsing without executing it.
    Blocks dangerous imports, system execution, file IO, and unauthorized AST constructs.
    """
    if not code or not code.strip():
        return False, "Code is empty."

    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return False, f"Python syntax error: {exc}"

    # If expecting a specific function contract
    if expected_function_name:
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)]
        if not functions:
            return False, f"Code must define a function named '{expected_function_name}'."
        if not allow_multi_function and len(functions) != 1:
            return False, f"Code must define exactly one function named '{expected_function_name}'."
        
        target_fn = next((fn for fn in functions if fn.name == expected_function_name), None)
        if not target_fn:
            return False, f"Expected function '{expected_function_name}' not found."

        if expected_args is not None:
            arg_names = [arg.arg for arg in target_fn.args.args]
            if arg_names != expected_args:
                return False, f"Function '{expected_function_name}' must accept exactly arguments {expected_args}, got {arg_names}."

        if target_fn.decorator_list:
            return False, "Decorators are not permitted in dynamic rules."

        if requires_return and not any(isinstance(node, ast.Return) for node in ast.walk(target_fn)):
            return False, f"Function '{expected_function_name}' must return a result."

    # Walk all AST nodes to check for forbidden constructs
    for node in ast.walk(tree):
        # 1. Check imports
        if isinstance(node, ast.Import):
            for alias in node.names:
                root_pkg = alias.name.split(".")[0]
                if root_pkg not in ALLOWED_IMPORTS:
                    return False, f"Import of module '{alias.name}' is strictly forbidden by guardrails."
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                root_pkg = node.module.split(".")[0]
                if root_pkg not in ALLOWED_IMPORTS:
                    return False, f"Import from module '{node.module}' is strictly forbidden by guardrails."

        # 2. Block hazardous AST nodes
        if isinstance(node, (ast.AsyncFunctionDef, ast.ClassDef, ast.Global, ast.Nonlocal, ast.Delete, ast.With, ast.AsyncWith)):
            return False, f"Language construct '{type(node).__name__}' is not permitted in dynamic rules."

        # 3. Block forbidden identifier names
        if isinstance(node, ast.Name):
            if node.id.startswith("__") or node.id in FORBIDDEN_MODULES:
                return False, f"Access to forbidden identifier '{node.id}' is blocked by guardrails."

        # 4. Block dunder attributes
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("__"):
                return False, f"Access to private attribute '{node.attr}' is blocked by guardrails."

        # 5. Block forbidden calls and methods
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in FORBIDDEN_CALLS:
                return False, f"Calling forbidden function '{node.func.id}' is blocked by guardrails."
            if isinstance(node.func, ast.Attribute) and node.func.attr in FORBIDDEN_METHODS:
                return False, f"Calling forbidden method '{node.func.attr}' is blocked by guardrails."

    return True, "ok"


# =============================================================================
# 3. Step-Specific AST Validators
# =============================================================================

def validate_harmonization_transform_ast(code: str) -> Tuple[bool, str]:
    """
    Step 4: Harmonization Guardrail.
    Validates: def transform(value, row): -> str
    """
    return validate_ast_security(
        code,
        expected_function_name="transform",
        expected_args=["value", "row"],
        requires_return=True,
    )


def validate_validation_condition_ast(code: str) -> Tuple[bool, str]:
    """
    Step 5: Validation Guardrail.
    Validates single-line boolean expression.
    """
    if not code or not code.strip():
        return False, "Validation condition is empty."

    # Must be parseable as an expression
    try:
        parsed = ast.parse(code.strip(), mode="eval")
    except SyntaxError:
        # If wrapped in standard module mode, check if single expression statement
        try:
            mod = ast.parse(code.strip())
            if len(mod.body) != 1 or not isinstance(mod.body[0], ast.Expr):
                return False, "Validation rule condition must be a single boolean expression."
        except SyntaxError as exc:
            return False, f"Validation condition syntax error: {exc}"

    # General AST walk
    is_valid, msg = validate_ast_security(code, expected_function_name=None, requires_return=False)
    if not is_valid:
        return False, msg

    return True, "ok"


def validate_cleansing_fixer_ast(code: str) -> Tuple[bool, str]:
    """
    Step 6: Cleansing Guardrail.
    Validates: def fix_dynamic_rule(df, issue_rows): -> df
    """
    return validate_ast_security(
        code,
        expected_function_name="fix_dynamic_rule",
        expected_args=["df", "issue_rows"],
        requires_return=True,
    )


def validate_transformation_script_ast(code: str) -> Tuple[bool, str]:
    """
    Step 7: Transformation Guardrail.
    Validates: def transform_data(df): -> df (or def transform(df):)
    """
    has_transform_data = "def transform_data" in code
    expected_name = "transform_data" if has_transform_data else "transform"

    return validate_ast_security(
        code,
        expected_function_name=expected_name,
        expected_args=["df"],
        requires_return=True,
    )


# =============================================================================
# 4. Master Data Preservation & Invariance Checkers
# =============================================================================

def is_master_data_field(field_name: str, master_keys: Set[str]) -> bool:
    """Check if a field is a sensitive master key or organizational code."""
    if not field_name or not master_keys:
        return False
    unqualified = str(field_name).split(".")[-1].strip().upper()
    return unqualified in [k.upper() for k in master_keys]


def check_master_data_preservation(
    field_name: str,
    old_val: Any,
    new_val: Any,
    master_keys: Set[str],
    is_explicit_deletion: bool = False,
) -> Tuple[bool, str]:
    """
    Master Data Preservation Guardrail.
    Returns (allowed, reason). Prevents automated clearing or fabricating of dynamically injected master keys.
    """
    if not is_master_data_field(field_name, master_keys):
        return True, "ok"

    old_s = str(old_val).strip() if old_val is not None else ""
    new_s = str(new_val).strip() if new_val is not None else ""

    # If old value was populated, but new value blanks it out
    if old_s and not new_s and not is_explicit_deletion:
        return False, f"Master data preservation safeguard: Blanking out '{field_name}' (old value: '{old_s}') is prohibited."

    return True, "ok"


def verify_dataset_invariance(
    before_df: pd.DataFrame,
    after_df: pd.DataFrame,
    *,
    allow_drops: bool = False,
    max_explosion_ratio: float = 1.0,
) -> Tuple[bool, str]:
    """
    Dataset Invariance Guardrail.
    Ensures that dynamic rules do not unexpectedly drop records or trigger Cartesian explosions.
    """
    before_count = len(before_df)
    after_count = len(after_df)

    if before_count > 0:
        ratio = after_count / before_count
        if ratio > max_explosion_ratio:
            return False, f"Row explosion detected: dataset surged from {before_count} to {after_count} rows (ratio: {ratio:.2f})."

    if after_count < before_count and not allow_drops:
        dropped = before_count - after_count
        return False, f"Unexpected row deletion: {dropped} record(s) were dropped without explicit deletion command."

    return True, "ok"


def verify_required_columns_intact(
    before_df: pd.DataFrame,
    after_df: pd.DataFrame,
    required_columns: Optional[List[str]] = None,
) -> Tuple[bool, str]:
    """
    Schema Integrity Guardrail.
    Ensures dynamic scripts do not drop or rename required SuccessFactors target columns.
    """
    after_cols = set(after_df.columns)
    
    if required_columns:
        missing = [c for c in required_columns if c not in after_cols]
        if missing:
            return False, f"Required SF column(s) missing after script execution: {missing}."

    return True, "ok"
