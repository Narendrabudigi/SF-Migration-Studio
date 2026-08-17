import logging
import json
import os
import requests

logger = logging.getLogger(__name__)

# Fetch API Keys from Environment
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")

# Fallback Configuration
PRIMARY_PROVIDER = os.environ.get("PRIMARY_PROVIDER")
PRIMARY_MODEL = os.environ.get("PRIMARY_MODEL")
SECONDARY_PROVIDER = os.environ.get("SECONDARY_PROVIDER")
SECONDARY_MODEL = os.environ.get("SECONDARY_MODEL")
THIRD_PROVIDER = os.environ.get("THIRD_PROVIDER")
THIRD_MODEL = os.environ.get("THIRD_MODEL")
FOURTH_PROVIDER = os.environ.get("FOURTH_PROVIDER")
FOURTH_MODEL = os.environ.get("FOURTH_MODEL")


def _call_gemini(model: str, system_prompt: str, user_prompt: str) -> str:
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY is missing.")
        
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"parts": [{"text": user_prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"}
    }
    
    response = requests.post(url, headers={"Content-Type": "application/json"}, json=payload, timeout=120)
    response.raise_for_status()
    
    data = response.json()
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError) as e:
        raise ValueError(f"Unexpected response format from Gemini: {data}") from e


def _call_openai_compatible(url: str, api_key: str, model: str, system_prompt: str, user_prompt: str) -> str:
    if not api_key:
        raise ValueError("API Key is missing for this provider.")
        
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "response_format": {"type": "json_object"}
    }
    
    response = requests.post(url, headers=headers, json=payload, timeout=120)
    response.raise_for_status()
    
    data = response.json()
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        raise ValueError(f"Unexpected response format: {data}") from e


def _route_provider(provider: str, model: str, system_prompt: str, user_prompt: str) -> str:
    provider_lower = provider.lower()
    if "gemini" in provider_lower:
        return _call_gemini(model, system_prompt, user_prompt)
    elif "groq" in provider_lower:
        return _call_openai_compatible("https://api.groq.com/openai/v1/chat/completions", GROQ_API_KEY, model, system_prompt, user_prompt)
    elif "openrouter" in provider_lower:
        return _call_openai_compatible("https://openrouter.ai/api/v1/chat/completions", OPENROUTER_API_KEY, model, system_prompt, user_prompt)
    else:
        raise ValueError(f"Unknown provider configured: {provider}")


class LLMOrchestrator:
    def execute_json_prompt(self, system_prompt: str, user_prompt: str):
        chain = [
            {"tier": "PRIMARY", "provider": PRIMARY_PROVIDER, "model": PRIMARY_MODEL},
            {"tier": "SECONDARY", "provider": SECONDARY_PROVIDER, "model": SECONDARY_MODEL},
            {"tier": "THIRD", "provider": THIRD_PROVIDER, "model": THIRD_MODEL},
            {"tier": "FOURTH", "provider": FOURTH_PROVIDER, "model": FOURTH_MODEL},
        ]

        for step in chain:
            provider = step["provider"]
            model = step["model"]
            if not provider or not model:
                continue
            
            print(f"\n🚀 [LLM ENGINE] LLM triggered -> Routing Request to {step['tier']} Tier -> Provider: {provider.upper()} | Model: {model}\n")
            logger.info(f"Attempting {step['tier']} LLM: {provider.upper()} (Model: {model})")
            try:
                result = _route_provider(provider, model, system_prompt, user_prompt)
                
                # Clean markdown formatting if present
                clean_result = result.replace("```json", "").replace("```", "").strip()
                
                try:
                    return json.loads(clean_result)
                except json.JSONDecodeError:
                    # Fallback to regex extraction if there's surrounding text
                    import re
                    # Try to match object or array
                    json_match = re.search(r'(\{.*\}|\[.*\])', clean_result, re.DOTALL)
                    if json_match:
                        return json.loads(json_match.group(1))
                    raise
            except Exception as e:
                logger.warning(f"Failed using {provider.upper()} ({model}). Reason: {e}")
                
        logger.error("ALL LLM PROVIDERS IN THE FALLBACK CHAIN FAILED.")
        return []

    def generate_generic(self, system_prompt: str, user_prompt: str) -> str:
        chain = [
            {"tier": "PRIMARY", "provider": PRIMARY_PROVIDER, "model": PRIMARY_MODEL},
            {"tier": "SECONDARY", "provider": SECONDARY_PROVIDER, "model": SECONDARY_MODEL},
            {"tier": "THIRD", "provider": THIRD_PROVIDER, "model": THIRD_MODEL},
            {"tier": "FOURTH", "provider": FOURTH_PROVIDER, "model": FOURTH_MODEL},
        ]
        for step in chain:
            provider = step["provider"]
            model = step["model"]
            if not provider or not model:
                continue
            
            print(f"\n🚀 [LLM ENGINE] LLM triggered -> Routing Request to {step['tier']} Tier -> Provider: {provider.upper()} | Model: {model}\n")
            logger.info(f"Attempting {step['tier']} LLM for generic prompt: {provider.upper()}")
            try:
                result = _route_provider(provider, model, system_prompt, user_prompt)
                return result
            except Exception as e:
                logger.warning(f"Failed using {provider.upper()} ({model}). Reason: {e}")
                
        return '{"error": "All LLM providers failed"}'

llm_orchestrator = LLMOrchestrator()
