# Cleanser Test Datasets

These files are generated test fixtures for the SAP Migration Studio Cleanser component. They are intentionally compact and rule-focused, not random exports.

## Folder Contents

- `dataset_a_cleanser_only.csv`: Harmonization-style customer CSV containing Cleanser-owned rule violations plus clean regression rows. No validation report is provided or required.
- `dataset_b_validation.csv`: Customer CSV containing Validation-owned rule violations plus clean regression rows.
- `dataset_b_validation_report.json`: Validation report for Dataset B.
- `dataset_c_combined.csv`: Customer CSV containing both Validation-owned and Cleanser-owned violations, rows with multiple simultaneous issues, one extreme mixed row, and clean regression rows.
- `dataset_c_validation_report.json`: Validation report for Dataset C. It intentionally contains only validation findings, not cleanser findings.
- `README.md`: This documentation.

## Common CSV Shape

All CSV files currently use the same SAP Customer-oriented field subset:

`KUNNR, KTOKD, NAME1, NAME2, LAND1, ORT01, PSTLZ, REGIO, STRAS, TELF1, SMTP_ADDR, BUKRS, VKORG, VTWEG, SPART, WAERS, ZTERM, STCD1, TAXKD, ERDAT`

Row numbers in JSON reports are 1-based data row numbers, excluding the header row.

## Dataset A: Cleanser Rules Only

Purpose: verifies Phase 2 of the Cleanser, where no validation report is needed and the component applies its own deterministic rules.

Covered Cleanser rules:

- `CL_TRIM_WHITESPACE`: trim leading/trailing whitespace in character fields.
- `CL_COUNTRY_TO_ISO`: convert country names and aliases such as `India`, `United States`, `UK`, and `UAE` to SAP/ISO-style country codes.
- `CL_CURRENCY_TO_ISO`: convert currency names and aliases such as `Rupee`, `Dollar`, `Euro`, `Pound`, `Yen`, and `Dirham` to ISO currency codes.
- `CL_PAYMENT_TERMS_TO_SAP`: convert payment text such as `NET30`, `Net 45`, `30 DAYS`, `Immediate`, and `2/10 NET30` to SAP payment term keys.
- `CL_PAD_NUMERIC_IDENTIFIER`: left-pad numeric identifiers to the target SAP length, such as 10 digits for `KUNNR`.
- `CL_UPPERCASE_CODE_FIELDS`: uppercase SAP code fields such as `KTOKD`, `LAND1`, `REGIO`, `WAERS`, `VTWEG`, `SPART`, and `TAXKD`.
- `CL_CLEAN_TAX_NUMBER`: remove punctuation from tax numbers and uppercase them.
- `CL_TRUNCATE_OVERLENGTH`: truncate values that exceed configured SAP metadata lengths.
- `CL_FILL_EMPTY_FIELDS`: normalize blank optional fields such as `NAME2` to the configured empty-field representation.

Not directly exercised by the current Customer subset:

- `CL_MATERIAL_TYPE_TO_SAP`: applies to material object fields such as `MTART`.

Clean regression rows:

- Rows 26-28 are intentionally clean and should pass through unchanged.

## Dataset B: Validation Rules Only

Purpose: verifies Phase 1 of the Cleanser, where the Cleanser reads the Validation JSON and fixes exactly the reported validation issues.

Covered Validation rules:

- `VAL_REQUIRED_FIELDS`: required SAP fields must not be empty.
- `VAL_NUMERIC_IDENTIFIER_FORMAT`: numeric identifiers must contain only digits and fit configured SAP length limits.
- `VAL_COUNTRY_CODE_FORMAT`: country fields must use a 2-3 character alphabetic country code.
- `VAL_CURRENCY_CODE_FORMAT`: currency fields must use a 3-character alphabetic currency code.
- `VAL_EMAIL_ADDRESS_FORMAT`: email fields must be syntactically valid.
- `VAL_DATE_YYYYMMDD_FORMAT`: date fields must use an 8-digit `YYYYMMDD` value.
- `VAL_FIELD_LENGTH`: field values must not exceed SAP metadata length limits.
- `VAL_PAYMENT_TERMS_FORMAT`: payment terms must be accepted SAP-style payment term keys.

Dataset B avoids additional hidden Cleanser-only findings where possible. Its intentional defects are represented in `dataset_b_validation_report.json`.

Clean regression rows:

- Rows 23-25 are intentionally clean and should pass through unchanged.

## Dataset C: Combined Validation and Cleanser Rules

Purpose: verifies full Cleanser behavior across both phases:

1. Read the Validation JSON and fix validation findings.
2. Run Cleanser-owned rules and fix additional issues not present in the JSON report.

Dataset C uses different combinations than Dataset B and includes rows with multiple simultaneous issues. Examples:

- Row 1 has a missing identifier validation issue plus cleanser-only whitespace, country, currency, payment term, region, and tax cleanup issues.
- Row 11 has multiple validation issues on one row: invalid identifier, invalid email, and invalid date, plus cleanser-only casing/normalization issues.
- Row 26 is the extreme mixed row. It contains validation findings for missing required fields, field length, invalid email, and invalid date, plus cleanser-only country, currency, payment term, casing, whitespace, and tax cleanup issues.
- Rows 16-22 are cleanser-only rows within the combined dataset and therefore do not appear in the JSON report.

The JSON report intentionally excludes cleanser findings.

Clean regression rows:

- Rows 23-25 are intentionally clean and should pass through unchanged.

## Official Cleanser Rules

The official Cleanser rule set represented by these fixtures is:

- Trim Whitespace
- Country to ISO
- Currency to ISO
- Payment Terms to SAP
- Material Type to SAP
- Pad Numeric IDs
- Uppercase Code Fields
- Clean Tax Numbers
- Truncate Overlength
- Fill Empty Fields

## Future Schema Expansion

These datasets currently use the SAP Customer field subset for compact fixture coverage. The future project may expand to all destination fields, including the larger schema imported from `SAP.xlsx` with roughly 484 fields.

The Cleanser implementation must remain metadata-driven. It must never hardcode Customer-specific field names, identifiers, lengths, or object behavior. Object-specific behavior should come from field metadata, configured rule parameters, and lookup dictionaries.

These datasets are test fixtures only. They are not intended to restrict future SAP objects such as Vendor, Material, Business Partner, or future full-schema expansion.

## Assumptions

- The Cleanser is rule-based only. No LLM behavior is assumed.
- JSON reports use only the requested schema: `version` and `issues`.
- `ERROR` means migration-blocking validation failure. `WARNING` means a validation issue that should be corrected or reviewed.
- The required-field examples use the Customer subset fields `KUNNR`, `KTOKD`, `NAME1`, `LAND1`, `BUKRS`, `VKORG`, `VTWEG`, and `SPART`, but the rule names are generic and metadata-driven.
- `ERDAT` is included as a customer-style creation date field to exercise date validation.
- Clean regression rows are expected to remain byte-for-byte or value-for-value unchanged after a future Cleanser run, aside from any non-data formatting chosen by the CSV writer.
