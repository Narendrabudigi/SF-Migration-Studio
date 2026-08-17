import json
import logging
from services.llm_orchestrator import llm_orchestrator

logger = logging.getLogger(__name__)

class AIMappingAgent:
    def map_source_to_target(self, source_system: str, target_object: str, known_source_fields: list, target_fields: list):
        if known_source_fields:
            # Source Fields provided -> Map to Target Dictionary
            system_prompt = f"""You are an expert HR & ERP Data Migration Architect with deep knowledge of {source_system} and SuccessFactors.
You need to accurately map a specific list of Source Fields from {source_system} to a provided dictionary of SuccessFactors target fields for the object {target_object}.

CRITICAL REQUIREMENT: You MUST ONLY map a source field if there is a logical semantic match in the `target_fields` dictionary.
The target fields dictionary contains objects with 'sap_field' (the technical target field name) and 'description' (the human-readable description). 
You MUST heavily rely on the 'description' to deeply understand the true semantic meaning of the SuccessFactors target field before matching it to a Source Field.
If a source field has NO logical matching target field based on the descriptions, DO NOT map it. Do NOT hallucinate target fields like "None", "N/A", or "null". Simply omit that source field from the output array entirely.
Do NOT map fields that are not in the `known_source_fields` list. 

EXTREMELY CRITICAL INSTRUCTIONS FOR ACCURACY:
1. DO NOT map multiple source fields to the SAME target field. Ensure a 1-to-1 mapping. Choose the single best source field for each target field.
2. Prioritize mapping to target fields that are MANDATORY. Look closely at the field descriptions.
3. COMMON SEMANTIC MATCHES: 
   - Person ID / National ID -> `person-id-external` or `personIdExternal`
   - User ID / Employee ID -> `user-id` or `userId`
   - First Name / Given Name -> `first-name` or `firstName`
   - Last Name / Family Name / Surname -> `last-name` or `lastName`
   - Hire Date / Start Date -> `hire-date` or `start-date`
   - Phone / Mobile -> `phone-number` or `TELF1`
   - Email -> `email-address` or `SMTP_ADDR`
   - Postal Code / ZIP -> `zip-code` or `PSTLZ`
   Use these hints to maximize mapping accuracy.

Output MUST be a JSON array of objects with the following keys for ONLY the fields you successfully mapped:
- source_field: The EXACT field name from the `known_source_fields` array.
- target_field: The EXACT target field name from the `target_fields` dictionary (the "sap_field" key).
- transform_rule: Choose from [None, Trim, Pad->10 digits, Country->ISO, Currency->ISO].
- confidence: An integer between 0 and 100 based on how confident you are in the semantic match.
"""
            user_prompt = f"Target Fields Dictionary: {json.dumps(target_fields)}\nSource Fields to Map: {json.dumps(known_source_fields)}\nGenerate the mapping JSON array."
        else:
            # Source Fields list empty -> Loop over Target Fields
            system_prompt = f"""You are an expert HR & ERP Data Migration Architect with deep knowledge of {source_system} and SuccessFactors.
You need to accurately map fields from {source_system} to SuccessFactors target object {target_object}.
You are given a STRICT list of MANDATORY target fields in SuccessFactors formatted as {{"sap_field": "STRUCTURE.FIELD_NAME", "description": "Human readable description"}}. 
CRITICAL REQUIREMENT: You MUST provide EXACTLY ONE mapping for EVERY SINGLE field in the target list. Do NOT omit any fields. If there are duplicate field names, you must map each one individually because they belong to different structures. Do NOT summarize or truncate.
Because the known source fields list is empty, you MUST act as a Senior Architect and perform a deep internal knowledge search to find the EXACT standard database table and column names in {source_system} that correspond to each target field.

EXTREMELY CRITICAL INSTRUCTION FOR SOURCE FIELD NAMES:
You MUST output EXACT, accurate, and short technical field names ONLY for the `source_field`. 
ABSOLUTELY NO sentences, explanations, or text like "Derivation based on...". It MUST be a valid technical column name.

Output MUST be a JSON array of objects with the following keys:
- source_field: The EXACT technical name of the field in {source_system}. No explanations allowed.
- target_field: The EXACT target field formatted as STRUCTURE.FIELD_NAME. You MUST include the structure prefix.
- transform_rule: Choose from [None, Trim, Pad->10 digits, Country->ISO, Currency->ISO].
- confidence: An integer between 0 and 100.
"""
            user_prompt = f"Mandatory Target Fields: {json.dumps(target_fields)}\nGenerate the mapping JSON array."

        # Pass the prompts to the generic orchestrator
        return llm_orchestrator.execute_json_prompt(system_prompt, user_prompt)

ai_mapping_agent = AIMappingAgent()
