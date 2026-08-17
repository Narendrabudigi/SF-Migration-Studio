"""
Phase 5 Comprehensive Unit Test Suite
=====================================
Tests dynamic fixer execution, AST safety, priority overrides, cleanser suppression,
diff tracking, error isolation, and regression behavior across Datasets A/B/C.
"""

import sys
from pathlib import Path
import tempfile
import json
import pandas as pd

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from agents.cleanser_agent import (
    run_cleanser,
    validate_dynamic_fixer_code,
    build_cleanser_execution_plan,
    generate_dynamic_fixers_from_plan,
    execute_dynamic_fixers,
    CleaningSummary,
    load_csv,
)

def run_all_tests():
    print("=" * 60)
    print("RUNNING PHASE 5 TEST SUITE")
    print("=" * 60)

    test_1_dynamic_rule_with_issues()
    test_2_multiple_issues_single_group()
    test_3_multiple_dynamic_rules()
    test_4_zero_issues_no_execution()
    test_5_override_standard_validation()
    test_6_suppress_conflicting_cleanser_rule()
    test_7_unrelated_cleanser_rule_runs()
    test_8_multi_field_diff_tracking()
    test_9_in_place_mutation_returns_none()
    test_10_returns_valid_dataframe()
    test_11_invalid_structure_rejected()
    test_12_exception_handling_isolation()
    test_13_forbidden_code_safety_check()
    test_14_datasets_a_b_c_regression()

    print("\n" + "=" * 60)
    print("ALL 14 PHASE 5 TESTS PASSED SUCCESSFULLY!")
    print("=" * 60)

def _mock_llm(responses: dict):
    def generator(system_prompt, user_prompt):
        parsed = json.loads(user_prompt)
        rule_id = parsed.get("dynamic_rule", {}).get("id")
        if rule_id in responses:
            return json.dumps({"code": responses[rule_id]})
        return json.dumps({"code": "def fix_dynamic_rule(df, issue_rows):\n    return df\n"})
    return generator

def test_1_dynamic_rule_with_issues():
    print("\n[Test 1] Dynamic rule with issues -> fixer executes -> affected records change")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "in.csv"
        out_path = tmp_path / "out.csv"
        
        df = pd.DataFrame([{"KUNNR": "123", "ZTERM": "NET30"}, {"KUNNR": "456", "ZTERM": "NET30"}])
        df.to_csv(csv_path, index=False)
        
        val_report = {
            "version": "1.0",
            "issues": [
                {"row": 1, "field": "ZTERM", "rule_code": "DYNAMIC_ZTERM", "rule_type": "DYNAMIC", "invalid_value": "NET30"}
            ]
        }
        
        mock_code = {
            "DYNAMIC_ZTERM": "def fix_dynamic_rule(df, issue_rows):\n    for issue in issue_rows:\n        row_idx = issue['row'] - 1\n        df.at[row_idx, 'ZTERM'] = 'NT45'\n    return df\n"
        }
        
        summary = CleaningSummary(str(csv_path), None, str(out_path))
        summary.execution_plan = build_cleanser_execution_plan(val_report)
        summary.dynamic_fixer_generation = generate_dynamic_fixers_from_plan(summary.execution_plan, llm_generator=_mock_llm(mock_code))
        
        cleaned_df = execute_dynamic_fixers(df, summary.dynamic_fixer_generation, summary.execution_plan, summary)
        
        assert cleaned_df.at[0, "ZTERM"] == "NT45", "Row 1 ZTERM should be updated to NT45"
        assert cleaned_df.at[1, "ZTERM"] == "NET30", "Row 2 ZTERM should remain unchanged"
        assert summary.dynamic_fixer_execution["fixes_count"] == 1, "Fixes count should be 1"
        print("  -> PASSED")

def test_2_multiple_issues_single_group():
    print("\n[Test 2] Multiple issues for one dynamic rule -> one fixer execution for that group")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "in.csv"
        out_path = tmp_path / "out.csv"
        
        df = pd.DataFrame([{"KUNNR": "1", "ZTERM": "A"}, {"KUNNR": "2", "ZTERM": "B"}])
        df.to_csv(csv_path, index=False)
        
        val_report = {
            "version": "1.0",
            "issues": [
                {"row": 1, "field": "ZTERM", "rule_code": "DYNAMIC_ZTERM", "rule_type": "DYNAMIC"},
                {"row": 2, "field": "ZTERM", "rule_code": "DYNAMIC_ZTERM", "rule_type": "DYNAMIC"}
            ]
        }
        
        mock_code = {
            "DYNAMIC_ZTERM": "def fix_dynamic_rule(df, issue_rows):\n    for issue in issue_rows:\n        df.at[issue['row'] - 1, 'ZTERM'] = 'NT45'\n    return df\n"
        }
        
        summary = CleaningSummary(str(csv_path), None, str(out_path))
        summary.execution_plan = build_cleanser_execution_plan(val_report)
        summary.dynamic_fixer_generation = generate_dynamic_fixers_from_plan(summary.execution_plan, llm_generator=_mock_llm(mock_code))
        
        assert summary.dynamic_fixer_generation["llm_calls"] == 1, "LLM should be called exactly once for group"
        cleaned_df = execute_dynamic_fixers(df, summary.dynamic_fixer_generation, summary.execution_plan, summary)
        
        assert len(summary.dynamic_fixer_execution["executed"]) == 1, "Exactly one group execution recorded"
        assert summary.dynamic_fixer_execution["fixes_count"] == 2, "2 cell fixes performed"
        print("  -> PASSED")

def test_3_multiple_dynamic_rules():
    print("\n[Test 3] Multiple dynamic rules -> each applicable fixer executes independently")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "in.csv"
        out_path = tmp_path / "out.csv"
        
        df = pd.DataFrame([{"ZTERM": "NET30", "LAND1": "India"}])
        df.to_csv(csv_path, index=False)
        
        val_report = {
            "version": "1.0",
            "issues": [
                {"row": 1, "field": "ZTERM", "rule_code": "DYNAMIC_ZTERM", "rule_type": "DYNAMIC"},
                {"row": 1, "field": "LAND1", "rule_code": "DYNAMIC_LAND1", "rule_type": "DYNAMIC"}
            ]
        }
        
        mock_code = {
            "DYNAMIC_ZTERM": "def fix_dynamic_rule(df, issue_rows):\n    df.at[0, 'ZTERM'] = 'NT45'\n    return df\n",
            "DYNAMIC_LAND1": "def fix_dynamic_rule(df, issue_rows):\n    df.at[0, 'LAND1'] = 'IN'\n    return df\n"
        }
        
        summary = CleaningSummary(str(csv_path), None, str(out_path))
        summary.execution_plan = build_cleanser_execution_plan(val_report)
        summary.dynamic_fixer_generation = generate_dynamic_fixers_from_plan(summary.execution_plan, llm_generator=_mock_llm(mock_code))
        
        cleaned_df = execute_dynamic_fixers(df, summary.dynamic_fixer_generation, summary.execution_plan, summary)
        
        assert cleaned_df.at[0, "ZTERM"] == "NT45"
        assert cleaned_df.at[0, "LAND1"] == "IN"
        assert len(summary.dynamic_fixer_execution["executed"]) == 2
        print("  -> PASSED")

def test_4_zero_issues_no_execution():
    print("\n[Test 4] Dynamic rule with zero issues -> no fixer execution -> no data modification")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "in.csv"
        out_path = tmp_path / "out.csv"
        rule_store_path = tmp_path / "rules.json"
        
        # Save a dynamic rule in the store
        rule_payload = {
            "version": "1.0",
            "rules": [
                {"id": "DYNAMIC_SATISFIED", "target_object": "CUSTOMER", "field": "ZTERM", "label": "ZTERM MUST BE NT45"}
            ]
        }
        rule_store_path.write_text(json.dumps(rule_payload), encoding="utf-8")
        
        df = pd.DataFrame([{"ZTERM": "NT45"}])
        df.to_csv(csv_path, index=False)
        
        val_report = {"version": "1.0", "issues": []}
        
        summary = CleaningSummary(str(csv_path), None, str(out_path))
        summary.execution_plan = build_cleanser_execution_plan(val_report, dynamic_rule_store_path=rule_store_path)
        summary.dynamic_fixer_generation = generate_dynamic_fixers_from_plan(summary.execution_plan)
        
        assert summary.dynamic_fixer_generation["llm_calls"] == 0, "0 LLM calls for satisfied rules"
        cleaned_df = execute_dynamic_fixers(df, summary.dynamic_fixer_generation, summary.execution_plan, summary)
        
        assert len(summary.dynamic_fixer_execution["executed"]) == 0
        assert len(summary.dynamic_fixer_execution["skipped"]) == 1
        assert cleaned_df.at[0, "ZTERM"] == "NT45"
        print("  -> PASSED")

def test_5_override_standard_validation():
    print("\n[Test 5] Dynamic rule overrides standard validation -> dynamic fixer runs -> standard validation skipped")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "in.csv"
        out_path = tmp_path / "out.csv"
        rule_store_path = tmp_path / "rules.json"
        
        rule_payload = {
            "version": "1.0",
            "rules": [{"id": "DYNAMIC_ZTERM", "field": "ZTERM"}]
        }
        rule_store_path.write_text(json.dumps(rule_payload), encoding="utf-8")
        
        df = pd.DataFrame([{"ZTERM": "INVALID_TERM"}])
        df.to_csv(csv_path, index=False)
        
        val_report = {
            "version": "1.0",
            "issues": [
                {"row": 1, "field": "ZTERM", "rule_code": "DYNAMIC_ZTERM", "rule_type": "DYNAMIC"},
                {"row": 1, "field": "ZTERM", "rule_code": "VAL_PAYMENT_TERMS_FORMAT", "rule_type": "STANDARD_VALIDATION"}
            ]
        }
        
        mock_code = {
            "DYNAMIC_ZTERM": "def fix_dynamic_rule(df, issue_rows):\n    df.at[0, 'ZTERM'] = 'CUSTOM_OK'\n    return df\n"
        }
        
        # Override LLM generator in run_cleanser by doing manual pipeline run or patching
        summary = CleaningSummary(str(csv_path), None, str(out_path))
        summary.execution_plan = build_cleanser_execution_plan(val_report, dynamic_rule_store_path=rule_store_path)
        summary.dynamic_fixer_generation = generate_dynamic_fixers_from_plan(summary.execution_plan, llm_generator=_mock_llm(mock_code))
        
        cleaned_df = execute_dynamic_fixers(df, summary.dynamic_fixer_generation, summary.execution_plan, summary)
        
        from agents.cleanser_agent import apply_validation_fixes, apply_cleanser_rules
        apply_validation_fixes(cleaned_df, val_report, summary, summary.execution_plan)
        apply_cleanser_rules(cleaned_df, summary, summary.execution_plan)
        
        assert cleaned_df.at[0, "ZTERM"] == "CUSTOM_OK", "Dynamic fixer result should prevail"
        warns = summary.warnings
        assert any("overridden by dynamic rule" in w for w in warns), "Warning logged for skipped standard validation rule"
        print("  -> PASSED")

def test_6_suppress_conflicting_cleanser_rule():
    print("\n[Test 6] Dynamic rule suppresses conflicting cleanser rule -> generic cleanser logic skipped")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "in.csv"
        out_path = tmp_path / "out.csv"
        rule_store_path = tmp_path / "rules.json"
        
        rule_payload = {
            "version": "1.0",
            "rules": [{"id": "DYNAMIC_ZTERM", "field": "ZTERM", "label": "CUSTOM ZTERM"}]
        }
        rule_store_path.write_text(json.dumps(rule_payload), encoding="utf-8")
        
        df = pd.DataFrame([{"ZTERM": "SPECIAL_TERM"}])
        df.to_csv(csv_path, index=False)
        
        val_report = {
            "version": "1.0",
            "issues": [
                {"row": 1, "field": "ZTERM", "rule_code": "DYNAMIC_ZTERM", "rule_type": "DYNAMIC"}
            ]
        }
        
        summary = CleaningSummary(str(csv_path), None, str(out_path))
        summary.execution_plan = build_cleanser_execution_plan(val_report, dynamic_rule_store_path=rule_store_path)
        
        # Check plan
        cleanser_items = summary.execution_plan["standard_cleanser_rules"]["items"]
        payterms_item = next(item for item in cleanser_items if item["rule_code"] == "CL_PAYMENT_TERMS_TO_SAP")
        assert payterms_item["status"] == "suppressed", "CL_PAYMENT_TERMS_TO_SAP must be suppressed"
        print("  -> PASSED")

def test_7_unrelated_cleanser_rule_runs():
    print("\n[Test 7] Dynamic rule does NOT conflict with unrelated cleanser rule -> unrelated cleanser rule still executes")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "in.csv"
        out_path = tmp_path / "out.csv"
        rule_store_path = tmp_path / "rules.json"
        
        rule_payload = {
            "version": "1.0",
            "rules": [{"id": "DYNAMIC_ZTERM", "field": "ZTERM"}]
        }
        rule_store_path.write_text(json.dumps(rule_payload), encoding="utf-8")
        
        # LAND1 has leading/trailing space & lower case
        df = pd.DataFrame([{"ZTERM": "NT45", "LAND1": "  India  "}])
        df.to_csv(csv_path, index=False)
        
        val_report = {"version": "1.0", "issues": []}
        
        summary = CleaningSummary(str(csv_path), None, str(out_path))
        summary.execution_plan = build_cleanser_execution_plan(val_report, dynamic_rule_store_path=rule_store_path)
        summary.dynamic_fixer_generation = generate_dynamic_fixers_from_plan(summary.execution_plan)
        
        cleaned_df = execute_dynamic_fixers(df, summary.dynamic_fixer_generation, summary.execution_plan, summary)
        
        from agents.cleanser_agent import apply_cleanser_rules
        apply_cleanser_rules(cleaned_df, summary, summary.execution_plan)
        
        assert cleaned_df.at[0, "LAND1"] == "IN", "Unrelated CL_COUNTRY_TO_ISO must still execute"
        print("  -> PASSED")

def test_8_multi_field_diff_tracking():
    print("\n[Test 8] Dynamic fixer modifies multiple fields -> all changes captured in diff/audit summary")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "in.csv"
        out_path = tmp_path / "out.csv"
        
        df = pd.DataFrame([{"NAME1": "ACME", "ORT01": "ny"}])
        df.to_csv(csv_path, index=False)
        
        val_report = {
            "version": "1.0",
            "issues": [{"row": 1, "field": "NAME1", "rule_code": "DYNAMIC_MULTI", "rule_type": "DYNAMIC"}]
        }
        
        mock_code = {
            "DYNAMIC_MULTI": "def fix_dynamic_rule(df, issue_rows):\n    df.at[0, 'NAME1'] = 'ACME CORP'\n    df.at[0, 'ORT01'] = 'New York'\n    return df\n"
        }
        
        summary = CleaningSummary(str(csv_path), None, str(out_path))
        summary.execution_plan = build_cleanser_execution_plan(val_report)
        summary.dynamic_fixer_generation = generate_dynamic_fixers_from_plan(summary.execution_plan, llm_generator=_mock_llm(mock_code))
        
        cleaned_df = execute_dynamic_fixers(df, summary.dynamic_fixer_generation, summary.execution_plan, summary)
        
        assert summary.dynamic_fixer_execution["fixes_count"] == 2, "Should capture 2 cell fixes"
        assert len(summary.dynamic_fixes) == 2, "Dynamic fixes list should have 2 items"
        print("  -> PASSED")

def test_9_in_place_mutation_returns_none():
    print("\n[Test 9] Dynamic fixer returns None after in-place mutation -> accepted")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "in.csv"
        out_path = tmp_path / "out.csv"
        
        df = pd.DataFrame([{"CITY": "london"}])
        df.to_csv(csv_path, index=False)
        
        val_report = {
            "version": "1.0",
            "issues": [{"row": 1, "field": "CITY", "rule_code": "DYNAMIC_INPLACE", "rule_type": "DYNAMIC"}]
        }
        
        # Code returns None implicitly
        mock_code = {
            "DYNAMIC_INPLACE": "def fix_dynamic_rule(df, issue_rows):\n    df.at[0, 'CITY'] = 'London'\n    return None\n"
        }
        
        summary = CleaningSummary(str(csv_path), None, str(out_path))
        summary.execution_plan = build_cleanser_execution_plan(val_report)
        summary.dynamic_fixer_generation = generate_dynamic_fixers_from_plan(summary.execution_plan, llm_generator=_mock_llm(mock_code))
        
        cleaned_df = execute_dynamic_fixers(df, summary.dynamic_fixer_generation, summary.execution_plan, summary)
        
        assert cleaned_df.at[0, "CITY"] == "London"
        assert summary.dynamic_fixer_execution["fixes_count"] == 1
        print("  -> PASSED")

def test_10_returns_valid_dataframe():
    print("\n[Test 10] Dynamic fixer returns a valid DataFrame -> accepted")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "in.csv"
        out_path = tmp_path / "out.csv"
        
        df = pd.DataFrame([{"CITY": "paris"}])
        df.to_csv(csv_path, index=False)
        
        val_report = {
            "version": "1.0",
            "issues": [{"row": 1, "field": "CITY", "rule_code": "DYNAMIC_DF", "rule_type": "DYNAMIC"}]
        }
        
        mock_code = {
            "DYNAMIC_DF": "def fix_dynamic_rule(df, issue_rows):\n    df2 = df.copy()\n    df2.at[0, 'CITY'] = 'Paris'\n    return df2\n"
        }
        
        summary = CleaningSummary(str(csv_path), None, str(out_path))
        summary.execution_plan = build_cleanser_execution_plan(val_report)
        summary.dynamic_fixer_generation = generate_dynamic_fixers_from_plan(summary.execution_plan, llm_generator=_mock_llm(mock_code))
        
        cleaned_df = execute_dynamic_fixers(df, summary.dynamic_fixer_generation, summary.execution_plan, summary)
        
        assert cleaned_df.at[0, "CITY"] == "Paris"
        assert summary.dynamic_fixer_execution["fixes_count"] == 1
        print("  -> PASSED")

def test_11_invalid_structure_rejected():
    print("\n[Test 11] Dynamic fixer returns invalid structure -> reject/fail safely")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "in.csv"
        out_path = tmp_path / "out.csv"
        
        df = pd.DataFrame([{"A": "1", "B": "2"}])
        df.to_csv(csv_path, index=False)
        
        val_report = {
            "version": "1.0",
            "issues": [{"row": 1, "field": "A", "rule_code": "DYNAMIC_BAD_STRUCT", "rule_type": "DYNAMIC"}]
        }
        
        # Code alters column structure
        mock_code = {
            "DYNAMIC_BAD_STRUCT": "def fix_dynamic_rule(df, issue_rows):\n    df['EXTRA_COL'] = 'X'\n    return df\n"
        }
        
        summary = CleaningSummary(str(csv_path), None, str(out_path))
        summary.execution_plan = build_cleanser_execution_plan(val_report)
        summary.dynamic_fixer_generation = generate_dynamic_fixers_from_plan(summary.execution_plan, llm_generator=_mock_llm(mock_code))
        
        cleaned_df = execute_dynamic_fixers(df, summary.dynamic_fixer_generation, summary.execution_plan, summary)
        
        assert "EXTRA_COL" not in cleaned_df.columns, "Altered structure must be rejected"
        assert len(summary.dynamic_fixer_execution["failed"]) == 1, "1 failed execution recorded"
        assert "Structural validation failed" in summary.dynamic_fixer_execution["failed"][0]["reason"]
        print("  -> PASSED")

def test_12_exception_handling_isolation():
    print("\n[Test 12] Dynamic fixer raises an exception -> failure recorded -> other dynamic fixers continue")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "in.csv"
        out_path = tmp_path / "out.csv"
        
        df = pd.DataFrame([{"F1": "A", "F2": "B"}])
        df.to_csv(csv_path, index=False)
        
        val_report = {
            "version": "1.0",
            "issues": [
                {"row": 1, "field": "F1", "rule_code": "DYNAMIC_ERR", "rule_type": "DYNAMIC"},
                {"row": 1, "field": "F2", "rule_code": "DYNAMIC_OK", "rule_type": "DYNAMIC"}
            ]
        }
        
        mock_code = {
            "DYNAMIC_ERR": "def fix_dynamic_rule(df, issue_rows):\n    raise ValueError('Boom!')\n    return df\n",
            "DYNAMIC_OK": "def fix_dynamic_rule(df, issue_rows):\n    df.at[0, 'F2'] = 'FIXED'\n    return df\n"
        }
        
        summary = CleaningSummary(str(csv_path), None, str(out_path))
        summary.execution_plan = build_cleanser_execution_plan(val_report)
        summary.dynamic_fixer_generation = generate_dynamic_fixers_from_plan(summary.execution_plan, llm_generator=_mock_llm(mock_code))
        
        cleaned_df = execute_dynamic_fixers(df, summary.dynamic_fixer_generation, summary.execution_plan, summary)
        
        assert cleaned_df.at[0, "F2"] == "FIXED", "Independent valid fixer should still execute"
        assert len(summary.dynamic_fixer_execution["failed"]) == 1, "Failed fixer recorded"
        assert len(summary.dynamic_fixer_execution["executed"]) == 1, "Executed fixer recorded"
        print("  -> PASSED")

def test_13_forbidden_code_safety_check():
    print("\n[Test 13] Generated code attempts forbidden behavior -> Phase 4 safety validation rejects it -> Phase 5 never executes it")
    
    forbidden_codes = [
        "def fix_dynamic_rule(df, issue_rows):\n    import os\n    return df\n",
        "def fix_dynamic_rule(df, issue_rows):\n    open('/tmp/test', 'w').write('x')\n    return df\n",
        "def fix_dynamic_rule(df, issue_rows):\n    df.to_csv('hack.csv')\n    return df\n",
        "def fix_dynamic_rule(df, issue_rows):\n    eval('1+1')\n    return df\n"
    ]
    
    for code in forbidden_codes:
        is_valid, msg = validate_dynamic_fixer_code(code)
        assert not is_valid, f"Code should be rejected by safety validator: {code}"
    print("  -> PASSED")

def test_14_datasets_a_b_c_regression():
    print("\n[Test 14] Datasets A/B/C regression -> existing behavior remains unchanged when there are no dynamic rules")
    
    output_dir = backend_dir / "output"
    
    # Dataset A (Cleanser only)
    dataset_a_csv = output_dir / "dataset_a_cleanser_only.csv"
    if dataset_a_csv.exists():
        with tempfile.TemporaryDirectory() as tmp_dir:
            out_a = Path(tmp_dir) / "out_a.csv"
            res_a = run_cleanser(dataset_csv_path=dataset_a_csv, output_csv_path=out_a)
            assert res_a["rows_loaded"] > 0
            assert res_a["cleanser_fixes"]["count"] > 0
            assert res_a["dynamic_fixes"]["count"] == 0
            
    # Dataset B (Validation report)
    dataset_b_csv = output_dir / "dataset_b_validation.csv"
    dataset_b_json = output_dir / "dataset_b_validation_report.json"
    if dataset_b_csv.exists() and dataset_b_json.exists():
        with tempfile.TemporaryDirectory() as tmp_dir:
            out_b = Path(tmp_dir) / "out_b.csv"
            res_b = run_cleanser(
                dataset_csv_path=dataset_b_csv,
                validation_report_csv_path=dataset_b_json,
                output_csv_path=out_b
            )
            assert res_b["rows_loaded"] > 0
            assert res_b["validation_fixes"]["count"] > 0
            assert res_b["dynamic_fixes"]["count"] == 0

    # Dataset C (Combined)
    dataset_c_csv = output_dir / "dataset_c_combined.csv"
    dataset_c_json = output_dir / "dataset_c_validation_report.json"
    if dataset_c_csv.exists() and dataset_c_json.exists():
        with tempfile.TemporaryDirectory() as tmp_dir:
            out_c = Path(tmp_dir) / "out_c.csv"
            res_c = run_cleanser(
                dataset_csv_path=dataset_c_csv,
                validation_report_csv_path=dataset_c_json,
                output_csv_path=out_c
            )
            assert res_c["rows_loaded"] > 0
            assert res_c["validation_fixes"]["count"] > 0
            assert res_c["cleanser_fixes"]["count"] > 0
            assert res_c["detailed_summary"]["overall_status"] in ["SUCCESS", "SUCCESS_WITH_WARNINGS", "PARTIAL_FAILURE", "FAILURE"]
            assert "run_information" in res_c["detailed_summary"]
            assert "dynamic_rule_processing" in res_c["detailed_summary"]
            assert "dynamic_fixes" in res_c["detailed_summary"]
            assert "validation_fixes" in res_c["detailed_summary"]
            assert "cleanser_fixes" in res_c["detailed_summary"]
            assert "priority_overrides" in res_c["detailed_summary"]
            assert "warnings" in res_c["detailed_summary"]
            assert "failures" in res_c["detailed_summary"]
            assert "final_counts" in res_c["detailed_summary"]

    print("  -> PASSED")

def test_15_detailed_summary_structure():
    print("\n[Test 15] Detailed summary structure -> verify all 10 required sections are present")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "in.csv"
        out_path = tmp_path / "out.csv"
        
        df = pd.DataFrame([{"KUNNR": "123", "ZTERM": "NET30"}])
        df.to_csv(csv_path, index=False)
        
        res = run_cleanser(dataset_csv_path=csv_path, output_csv_path=out_path)
        
        assert "detailed_summary" in res, "detailed_summary must be in cleanser result"
        ds = res["detailed_summary"]
        
        assert ds["overall_status"] in ["SUCCESS", "SUCCESS_WITH_WARNINGS", "PARTIAL_FAILURE", "FAILURE"]
        assert "run_information" in ds
        assert "dynamic_rule_processing" in ds
        assert "dynamic_fixes" in ds
        assert "validation_fixes" in ds
        assert "cleanser_fixes" in ds
        assert "priority_overrides" in ds
        assert "warnings" in ds
        assert "failures" in ds
        assert "final_counts" in ds
        print("  -> PASSED")

def test_16_end_to_end_dynamic_rule():
    print("\n[Test 16] End-to-end dynamic rule -> grouped issues, single LLM call, targeted record execution")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "in.csv"
        out_path = tmp_path / "out.csv"
        rule_store_path = tmp_path / "rules.json"
        
        rule_payload = {
            "version": "1.0",
            "rules": [
                {"id": "DYNAMIC_ZTERM", "target_object": "CUSTOMER", "field": "ZTERM", "label": "ZTERM MUST BE NT45"}
            ]
        }
        rule_store_path.write_text(json.dumps(rule_payload), encoding="utf-8")
        
        # 5 rows total
        df = pd.DataFrame([
            {"KUNNR": "1", "ZTERM": "NET30"},
            {"KUNNR": "2", "ZTERM": "NET30"},
            {"KUNNR": "3", "ZTERM": "NT45"},
            {"KUNNR": "4", "ZTERM": "INVALID"},
            {"KUNNR": "5", "ZTERM": "NT45"},
        ])
        df.to_csv(csv_path, index=False)
        
        val_report = {
            "version": "1.0",
            "issues": [
                {"row": 1, "field": "ZTERM", "rule_code": "DYNAMIC_ZTERM", "rule_type": "DYNAMIC", "invalid_value": "NET30"},
                {"row": 2, "field": "ZTERM", "rule_code": "DYNAMIC_ZTERM", "rule_type": "DYNAMIC", "invalid_value": "NET30"},
                {"row": 4, "field": "ZTERM", "rule_code": "DYNAMIC_ZTERM", "rule_type": "DYNAMIC", "invalid_value": "INVALID"},
            ]
        }
        
        mock_code = {
            "DYNAMIC_ZTERM": "def fix_dynamic_rule(df, issue_rows):\n    for issue in issue_rows:\n        row_idx = issue['row'] - 1\n        df.at[row_idx, 'ZTERM'] = 'NT45'\n    return df\n"
        }
        
        summary = CleaningSummary(str(csv_path), str(tmp_path / "val.json"), str(out_path))
        summary.rows_loaded = len(df)
        summary.execution_plan = build_cleanser_execution_plan(val_report, dynamic_rule_store_path=rule_store_path)
        summary.dynamic_fixer_generation = generate_dynamic_fixers_from_plan(summary.execution_plan, llm_generator=_mock_llm(mock_code))
        
        # Verify exactly 1 LLM generation request was made
        assert summary.dynamic_fixer_generation["llm_calls"] == 1, "Must make exactly 1 LLM generation request for grouped issues"
        
        cleaned_df = execute_dynamic_fixers(df, summary.dynamic_fixer_generation, summary.execution_plan, summary)
        
        from agents.cleanser_agent import apply_validation_fixes, apply_cleanser_rules, export_cleaned_csv
        apply_validation_fixes(cleaned_df, val_report, summary, summary.execution_plan)
        apply_cleanser_rules(cleaned_df, summary, summary.execution_plan)
        export_cleaned_csv(cleaned_df, out_path)
        summary.rows_exported = len(cleaned_df)
        
        # Verify affected rows (1, 2, 4) became NT45
        out_df = pd.read_csv(out_path, dtype=str)
        assert out_df.at[0, "ZTERM"] == "NT45"
        assert out_df.at[1, "ZTERM"] == "NT45"
        assert out_df.at[3, "ZTERM"] == "NT45"
        
        # Verify unaffected rows (3, 5) were untouched
        assert out_df.at[2, "ZTERM"] == "NT45"
        assert out_df.at[4, "ZTERM"] == "NT45"
        
        res = summary.to_dict()
        assert "detailed_summary" in res
        assert res["detailed_summary"]["overall_status"] in ["SUCCESS", "SUCCESS_WITH_WARNINGS"]
        print("  -> PASSED")

def test_17_zero_issue_dynamic_policy():
    print("\n[Test 17] Zero-issue dynamic policy -> no LLM generation, no data modification, policy suppression active")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        csv_path = tmp_path / "in.csv"
        out_path = tmp_path / "out.csv"
        rule_store_path = tmp_path / "rules.json"
        
        rule_payload = {
            "version": "1.0",
            "rules": [
                {"id": "DYNAMIC_ZTERM", "target_object": "CUSTOMER", "field": "ZTERM", "label": "ZTERM MUST BE NT45"}
            ]
        }
        rule_store_path.write_text(json.dumps(rule_payload), encoding="utf-8")
        
        df = pd.DataFrame([
            {"KUNNR": "1", "ZTERM": "NT45"},
            {"KUNNR": "2", "ZTERM": "NT45"},
        ])
        df.to_csv(csv_path, index=False)
        
        val_report = {"version": "1.0", "issues": []}
        
        summary = CleaningSummary(str(csv_path), None, str(out_path))
        summary.rows_loaded = len(df)
        summary.execution_plan = build_cleanser_execution_plan(val_report, dynamic_rule_store_path=rule_store_path)
        summary.dynamic_fixer_generation = generate_dynamic_fixers_from_plan(summary.execution_plan)
        
        # Verify 0 LLM generation attempts
        assert summary.dynamic_fixer_generation["llm_calls"] == 0
        
        cleaned_df = execute_dynamic_fixers(df, summary.dynamic_fixer_generation, summary.execution_plan, summary)
        
        from agents.cleanser_agent import apply_cleanser_rules
        apply_cleanser_rules(cleaned_df, summary, summary.execution_plan)
        
        # Verify zero data modification
        assert summary.dynamic_fixer_execution["fixes_count"] == 0
        assert len(summary.dynamic_fixes) == 0
        assert cleaned_df.at[0, "ZTERM"] == "NT45"
        assert cleaned_df.at[1, "ZTERM"] == "NT45"
        
        # Verify generic cleanser ZTERM rule was suppressed by active policy
        cleanser_items = summary.execution_plan["standard_cleanser_rules"]["items"]
        payterms_item = next(i for i in cleanser_items if i["rule_code"] == "CL_PAYMENT_TERMS_TO_SAP")
        assert payterms_item["status"] == "suppressed"
        print("  -> PASSED")


def test_18_dynamic_1_numeric_fallback():
    print("\n[Test 18] Dynamic rule DYNAMIC_1 with field MULTIPLE cleans non-numeric chars via deterministic fallback")
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        csv_path = tmp_path / "dataset.csv"
        out_path = tmp_path / "cleaned.csv"

        df = pd.DataFrame([
            {"person_id_external": "EMP-1001", "first_name": "John"},
            {"person_id_external": "EMP-1002", "first_name": "Jane"},
        ])
        df.to_csv(csv_path, index=False)

        val_report = {
            "version": "1.0",
            "issues": [
                {
                    "rule_code": "DYNAMIC_1",
                    "rule_type": "dynamic",
                    "field": "MULTIPLE",
                    "row": 1,
                    "invalid_value": "EMP-1001",
                    "reason": "Employee External ID must contain only numeric characters",
                },
                {
                    "rule_code": "DYNAMIC_1",
                    "rule_type": "dynamic",
                    "field": "MULTIPLE",
                    "row": 2,
                    "invalid_value": "EMP-1002",
                    "reason": "Employee External ID must contain only numeric characters",
                },
            ]
        }

        stored_rules = [
            {
                "id": "DYNAMIC_1",
                "field": "MULTIPLE",
                "description": "Employee External ID must contain only numeric characters",
                "label": "DYNAMIC_1",
            }
        ]

        summary = CleaningSummary(str(csv_path), None, str(out_path))
        summary.rows_loaded = len(df)
        summary.execution_plan = build_cleanser_execution_plan(val_report, dynamic_rules=stored_rules)

        # Simulate LLM generation failure to force fallback engine
        summary.dynamic_fixer_generation = {
            "generated_fixers": [],
            "skipped_satisfied_rules": [],
            "failed_generations": [{"group_id": "dynamic:DYNAMIC_1:MULTIPLE", "reason": "Simulated LLM key missing"}],
            "llm_calls": 1,
        }

        cleaned_df = execute_dynamic_fixers(df, summary.dynamic_fixer_generation, summary.execution_plan, summary)

        assert cleaned_df.at[0, "person_id_external"] == "1001", f"Expected 1001, got {cleaned_df.at[0, 'person_id_external']}"
        assert cleaned_df.at[1, "person_id_external"] == "1002", f"Expected 1002, got {cleaned_df.at[1, 'person_id_external']}"
        assert summary.dynamic_fixer_execution["fixes_count"] == 2
        print("  -> PASSED")


if __name__ == "__main__":
    run_all_tests()
    test_15_detailed_summary_structure()
    test_16_end_to_end_dynamic_rule()
    test_17_zero_issue_dynamic_policy()
    test_18_dynamic_1_numeric_fallback()
