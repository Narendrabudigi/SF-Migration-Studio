# SAP Migration Studio – Cleanser Agent

## Overview

The Cleanser Agent is a deterministic, parameterized cleansing engine for the SAP Migration Studio migration pipeline.

It does **not** use an LLM. All behavior is rule-based and driven by explicit validation findings, configured mappings, field metadata, and registered cleanser rules.

The component runs in two sequential phases:

**Phase 1: Validation-directed fixes**

The agent reads the Validation Report and applies fixes only for the reported validation issues when a safe, deterministic correction is available.

**Phase 2: Cleanser-owned normalization**

After validation fixes are complete, the agent runs its internal Cleanser rule registry to further normalize, standardize, truncate, and clean the dataset.

The output is:

- A cleaned CSV file.
- A structured cleaning summary describing fixes, modified rows, applied rules, and warnings requiring manual review.

---

## Architecture

Current integration path:

```text
React
  |
  v
FastAPI Router
  |
  v
cleanser_agent.py
  |
  v
Cleaned CSV + Summary
```

All cleansing business logic lives inside `backend/cleanser_agent.py`.

The FastAPI router is intentionally thin. It only accepts uploads, writes temporary input files, calls `run_cleanser(...)`, reads the cleaned CSV, and returns the response to the frontend.

No cleansing rules, mappings, validation behavior, or business-specific transformations should be duplicated in the router or frontend.

---

## Inputs

### Harmonization CSV

Required.

This is the harmonized dataset produced by the earlier pipeline stages. The Cleanser treats all CSV values as strings to preserve SAP identifiers, leading zeroes, and code-like fields.

### Validation JSON

Optional.

When provided, this report drives Phase 1 validation fixes. The current test schema is:

```json
{
  "version": "1.0",
  "issues": [
    {
      "row": 1,
      "field": "FIELD_NAME",
      "rule_code": "VAL_RULE_ID",
      "severity": "ERROR"
    }
  ]
}
```

Row numbers are 1-based data row numbers, excluding the CSV header.

The schema currently follows the agreed testing contract and can later be adapted during team integration if the Validation component emits additional metadata.

---

## Outputs

The Cleanser produces:

- **Cleaned CSV**: the final normalized CSV content.
- **Cleaning Summary**: structured execution metadata.
- **Warnings**: manual-review items for unsafe or unsupported automatic fixes.
- **Rows Modified**: row numbers changed by validation fixes or cleanser rules.
- **Validation Fixes**: fixes made from Validation Report issues.
- **Cleanser Fixes**: fixes made by Cleanser-owned rules.

The current summary object includes:

```json
{
  "input_csv_path": "...",
  "validation_report_json_path": "...",
  "output_csv_path": "...",
  "rows_loaded": 0,
  "rows_exported": 0,
  "validation_fixes": {
    "count": 0,
    "items": []
  },
  "cleanser_fixes": {
    "count": 0,
    "items": []
  },
  "rows_modified": [],
  "rows_modified_count": 0,
  "rules_applied": [],
  "warnings": []
}
```

---

## Processing Flow

```text
Load CSV
  |
  v
Load Validation Report
  |
  v
Apply Validation Fixes
  |
  v
Run Cleanser Rules
  |
  v
Generate Summary
  |
  v
Export Cleaned CSV
```

Execution order matters. Validation findings are handled first so the Cleanser can then normalize the corrected dataset in a consistent second pass.

---

## Validation Rules Supported

The current Validation fixer registry supports:

- `VAL_REQUIRED_FIELDS`
- `VAL_NUMERIC_IDENTIFIER_FORMAT`
- `VAL_COUNTRY_CODE_FORMAT`
- `VAL_CURRENCY_CODE_FORMAT`
- `VAL_EMAIL_ADDRESS_FORMAT`
- `VAL_DATE_YYYYMMDD_FORMAT`
- `VAL_FIELD_LENGTH`
- `VAL_PAYMENT_TERMS_FORMAT`

If the report contains an unsupported rule code, the agent skips that issue and records a warning.

---

## Cleanser Rules Supported

The current Cleanser rule registry supports:

- `CL_TRIM_WHITESPACE`
- `CL_COUNTRY_TO_ISO`
- `CL_CURRENCY_TO_ISO`
- `CL_PAYMENT_TERMS_TO_SAP`
- `CL_MATERIAL_TYPE_TO_SAP`
- `CL_PAD_NUMERIC_IDENTIFIER`
- `CL_UPPERCASE_CODE_FIELDS`
- `CL_CLEAN_TAX_NUMBER`
- `CL_TRUNCATE_OVERLENGTH`
- `CL_FILL_EMPTY_FIELDS`

Rules run sequentially in registry order.

---

## Design Principles

- **Metadata-driven**: field behavior should come from metadata, configuration, mappings, and rule registries.
- **Rule registry**: validation fixers and cleanser rules are centrally registered and executed by code.
- **Deterministic**: the same inputs produce the same outputs.
- **No hardcoded Customer logic**: the implementation must not depend on Customer-only business behavior.
- **Extensible to future SAP objects**: Vendor, Material, Business Partner, and other objects should be supported through metadata and mappings.
- **Standalone execution**: `run_cleanser(...)` can be called directly without the frontend or API.
- **Integration-ready**: the FastAPI endpoint exposes the standalone agent without moving business logic into API plumbing.
- **No fabricated business master data**: missing identifiers, company codes, account groups, and dates are not invented automatically.

---

## API

### Endpoint

```http
POST /api/sap/cleanser/run
```

### Request

Content type:

```text
multipart/form-data
```

Required field:

- `harmonization_csv`: CSV file from Harmonization output.

Optional field:

- `validation_report_json`: JSON Validation Report.

### Response

```json
{
  "success": true,
  "summary": {
    "rows_loaded": 29,
    "rows_exported": 29,
    "validation_fixes": {
      "count": 0,
      "items": []
    },
    "cleanser_fixes": {
      "count": 155,
      "items": []
    },
    "rows_modified": [1, 2, 3],
    "rows_modified_count": 3,
    "rules_applied": [],
    "warnings": []
  },
  "cleaned_csv": "KUNNR,KTOKD,..."
}
```

`cleaned_csv` is returned inline so the frontend can create a local download without making a second API call.

---

## Testing

Test fixtures are stored in `backend/output/`.

### Dataset A: Cleanser-only

Files:

- `dataset_a_cleanser_only.csv`

Purpose:

Verifies Phase 2 behavior without a Validation Report. It contains Cleanser-owned rule violations and clean regression rows that should pass through unchanged.

### Dataset B: Validation-only

Files:

- `dataset_b_validation.csv`
- `dataset_b_validation_report.json`

Purpose:

Verifies Phase 1 behavior using the Validation Report. Each supported validation rule appears at least once. The dataset also includes clean regression rows.

### Dataset C: Combined

Files:

- `dataset_c_combined.csv`
- `dataset_c_validation_report.json`

Purpose:

Verifies the full two-phase flow. It contains both validation findings and cleanser-only findings, including rows with multiple simultaneous issues and an extreme mixed test row. The JSON report intentionally contains only validation findings.

Recommended verification:

- Run Dataset A without a Validation JSON.
- Run Dataset B with `dataset_b_validation_report.json`.
- Run Dataset C with `dataset_c_validation_report.json`.
- Confirm CSV output loads successfully.
- Confirm summary counts and warnings are returned.
- Confirm clean regression rows remain unchanged except for CSV writer formatting.

---

## Limitations

- Current datasets use the SAP Customer field subset.
- Future versions should support all destination objects and the wider SAP migration schema.
- The Validation JSON schema may evolve during integration with the Validation component.
- No LLM is used.
- Business data is never fabricated automatically.
- Unsafe fixes are skipped and recorded as warnings for manual review.
- Large files are currently handled through normal CSV upload and response flow rather than streaming.

---

## Future Enhancements

Potential next steps:

- Metadata-driven field lengths from the destination schema.
- Additional SAP objects such as Vendor, Material, Business Partner, and Finance master data.
- Database-backed run history and audit records.
- Full pipeline integration with Harmonization, Validation, Transformation, and DMC Export.
- Streaming CSV upload/download for large datasets.
- Rule configuration from project metadata.
- Object-specific mapping dictionaries managed outside code.
- Expanded warning categories for downstream workflow assignment.
