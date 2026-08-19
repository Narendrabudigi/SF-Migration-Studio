import logging
import json
import os
import requests

logger = logging.getLogger(__name__)

def get_env_var(key: str, default: str = "") -> str:
    return os.environ.get(key, default)

def _call_gemini(model: str, system_prompt: str, user_prompt: str) -> str:
    gemini_key = get_env_var("GEMINI_API_KEY")
    if not gemini_key:
        raise ValueError("GEMINI_API_KEY is missing.")
        
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={gemini_key}"
    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"parts": [{"text": user_prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"}
    }
    
    response = requests.post(url, headers={"Content-Type": "application/json"}, json=payload, timeout=120)
    if response.status_code != 200:
        err_msg = response.text
        try:
            err_json = response.json()
            err_msg = err_json.get("error", {}).get("message", response.text)
        except Exception:
            pass
        
        # Auto-fallback if the requested Gemini model is deprecated/not found
        if response.status_code in (404, 400) and model != "gemini-2.5-flash":
            logger.warning(f"Gemini model '{model}' failed (HTTP {response.status_code}: {err_msg}). Auto-falling back to 'gemini-2.5-flash'...")
            return _call_gemini("gemini-2.5-flash", system_prompt, user_prompt)
            
        raise ValueError(f"Gemini API Error (HTTP {response.status_code}): {err_msg}")
    
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
    
    # Retry without json_object response_format if model does not support it
    if response.status_code == 400 and "response_format" in response.text:
        payload.pop("response_format", None)
        response = requests.post(url, headers=headers, json=payload, timeout=120)

    if response.status_code != 200:
        err_msg = response.text
        try:
            err_json = response.json()
            err_msg = err_json.get("error", {}).get("message", response.text)
        except Exception:
            pass
        raise ValueError(f"API Error (HTTP {response.status_code}): {err_msg}")
    
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
        return _call_openai_compatible("https://api.groq.com/openai/v1/chat/completions", get_env_var("GROQ_API_KEY"), model, system_prompt, user_prompt)
    elif "openrouter" in provider_lower:
        return _call_openai_compatible("https://openrouter.ai/api/v1/chat/completions", get_env_var("OPENROUTER_API_KEY"), model, system_prompt, user_prompt)
    else:
        raise ValueError(f"Unknown provider configured: {provider}")


class LLMOrchestrator:
    def _get_chain(self):
        from dotenv import load_dotenv
        load_dotenv(override=True)
        return [
            {"tier": "PRIMARY", "provider": get_env_var("PRIMARY_PROVIDER"), "model": get_env_var("PRIMARY_MODEL")},
            {"tier": "SECONDARY", "provider": get_env_var("SECONDARY_PROVIDER"), "model": get_env_var("SECONDARY_MODEL")},
            {"tier": "THIRD", "provider": get_env_var("THIRD_PROVIDER"), "model": get_env_var("THIRD_MODEL")},
            {"tier": "FOURTH", "provider": get_env_var("FOURTH_PROVIDER"), "model": get_env_var("FOURTH_MODEL")},
        ]

    def execute_json_prompt(self, system_prompt: str, user_prompt: str):
        chain = self._get_chain()

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
        chain = self._get_chain()
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
