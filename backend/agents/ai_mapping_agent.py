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

CRITICAL REQUIREMENT: Try to map EVERY source field in `known_source_fields` to its best semantic target field in `target_fields`.
Analyze both the target technical field names (e.g. `first-name`, `last-name`, `date-of-birth`, `country-of-birth`, `gender`, `marital-status`, `nationality`, `person-id-external`) and human-readable field descriptions.

COMMON SEMANTIC MATCHES TO APPLY:
- "Given Name" / "First Name" -> `first-name` or `firstName`
- "Family Name" / "Last Name" / "Surname" -> `last-name` or `lastName`
- "Birth Date" / "DOB" -> `date-of-birth` or `dateOfBirth`
- "Birth Country" / "Country of Birth" -> `country-of-birth` or `countryOfBirth`
- "Gender Description" / "Gender" / "Sex" -> `gender`
- "Citizenship" / "Nationality" -> `nationality`
- "Marital Status" -> `marital-status` or `maritalStatus`
- "Person ID" / "Employee ID" / "PERNR" -> `person-id-external` or `user-id`
- "Hire Date" / "Start Date" -> `hire-date` or `start-date`
- "Phone" / "Mobile" -> `phone-number`
- "Email" -> `email-address`
- "Zip" / "Postal Code" -> `zip-code`

Output MUST be a JSON array of objects with the following keys for all successfully mapped fields:
- source_field: The EXACT field name from the `known_source_fields` array.
- target_field: The EXACT target field name from the `target_fields` dictionary (the "sap_field" key).
- transform_rule: Choose from [None, Trim, Pad->10 digits, Country->ISO, Currency->ISO].
- confidence: An integer between 80 and 100 based on your confidence in the semantic match.
"""
            user_prompt = f"Target Fields Dictionary: {json.dumps(target_fields)}\nSource Fields to Map: {json.dumps(known_source_fields)}\nGenerate the mapping JSON array."
        else:
            # Source Fields list empty -> Loop over Target Fields
            system_prompt = f"""You are an expert HR & ERP Data Migration Architect with deep knowledge of {source_system} and SuccessFactors.
You need to accurately map fields from {source_system} to SuccessFactors target object {target_object}.
You are given a STRICT list of MANDATORY target fields in SuccessFactors formatted as {{"sf_field": "STRUCTURE.FIELD_NAME", "description": "Human readable description"}}. 
CRITICAL REQUIREMENT: You MUST provide EXACTLY ONE mapping for EVERY SINGLE field in the target list. Do NOT omit any fields.

Output MUST be a JSON array of objects with the following keys:
- source_field: The EXACT technical name of the field in {source_system}.
- target_field: The EXACT target field formatted as STRUCTURE.FIELD_NAME.
- transform_rule: Choose from [None, Trim, Pad->10 digits, Country->ISO, Currency->ISO].
- confidence: An integer between 80 and 100.
"""
            user_prompt = f"Mandatory Target Fields: {json.dumps(target_fields)}\nGenerate the mapping JSON array."

        # Pass the prompts to the generic orchestrator
        return llm_orchestrator.execute_json_prompt(system_prompt, user_prompt)

ai_mapping_agent = AIMappingAgent()
