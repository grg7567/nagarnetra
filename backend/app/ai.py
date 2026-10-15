"""AI client: photo classification, complaint drafting and fix verification.

Two providers behind one interface:
- Google Gemini when GEMINI_API_KEY is set (free tier, no credit card).
- IBM watsonx.ai when WATSONX_APIKEY + WATSONX_PROJECT_ID are set. The vision model is picked
  from watsonx's live catalog (IBM rotates models), preferring Granite Vision. WATSONX_MODEL forces one.
"""
import base64
import json
import logging
import re
import time
from datetime import date

import httpx

from .civic import CATEGORIES, LANGUAGES, SEVERITIES, place_phrase
from .config import settings

log = logging.getLogger("nagarnetra.ai")
API_VERSION = "2024-10-08"
PREFERENCE = ["granite-vision", "llama-4-maverick", "mistral-small", "llama-3-2-90b-vision", "llama-3-2-11b-vision", "pixtral"]


class AIUnavailable(RuntimeError):
    pass


_token: dict = {"value": "", "exp": 0.0}
_model: dict = {"id": "", "at": 0.0}
status: dict = {"model": "", "last_error": "", "last_ok": 0.0}


async def _iam_token(client: httpx.AsyncClient) -> str:
    if _token["value"] and _token["exp"] - 120 > time.time():
        return _token["value"]
    r = await client.post(
        "https://iam.cloud.ibm.com/identity/token",
        data={"grant_type": "urn:ibm:params:oauth:grant-type:apikey", "apikey": settings.watsonx_apikey},
        headers={"Accept": "application/json"},
    )
    if r.status_code != 200:
        raise AIUnavailable(f"IBM Cloud rejected the API key (HTTP {r.status_code}). Check WATSONX_APIKEY.")
    body = r.json()
    _token.update(value=body["access_token"], exp=float(body.get("expiration", time.time() + 3000)))
    return _token["value"]


def _available(spec: dict) -> bool:
    today = date.today().isoformat()
    stages = [s for s in spec.get("lifecycle", []) if s.get("start_date", "0") <= today]
    return not stages or stages[-1].get("id") in ("available", "deprecated")


async def _vision_model(client: httpx.AsyncClient) -> str:
    if settings.watsonx_model:
        return settings.watsonx_model
    if _model["id"] and time.time() - _model["at"] < 6 * 3600:
        return _model["id"]
    r = await client.get(f"{settings.watsonx_url}/ml/v1/foundation_model_specs",
                         params={"version": API_VERSION, "limit": 200})
    r.raise_for_status()
    specs = [m for m in r.json().get("resources", [])
             if any(f.get("id") == "image_chat" for f in m.get("functions", [])) and _available(m)]
    if not specs:
        raise AIUnavailable("No image-capable model is available in this watsonx region.")

    def rank(m):
        mid = m["model_id"]
        return next((i for i, p in enumerate(PREFERENCE) if p in mid), len(PREFERENCE))

    best = min(specs, key=rank)["model_id"]
    _model.update(id=best, at=time.time())
    status["model"] = best
    log.info("watsonx vision model: %s", best)
    return best


PROVIDER_LABEL = {"gemini": "Google Gemini", "watsonx": "IBM watsonx.ai"}
GEMINI_FALLBACK = "gemini-2.5-flash"


async def _chat(content: list | str, max_tokens: int = 900) -> str:
    """content: a prompt string, or [{"type": "text", ...}, {"type": "image_url", ...}] parts."""
    if settings.ai_provider == "gemini":
        return await _chat_gemini(content, max_tokens)
    if settings.ai_provider == "watsonx":
        return await _chat_watsonx(content, max_tokens)
    raise AIUnavailable("No AI provider is configured.")


async def _chat_gemini(content: list | str, max_tokens: int) -> str:
    parts = []
    for p in ([{"type": "text", "text": content}] if isinstance(content, str) else content):
        if p["type"] == "text":
            parts.append({"text": p["text"]})
        else:
            mime, b64 = p["image_url"]["url"][5:].split(";base64,", 1)
            parts.append({"inline_data": {"mime_type": mime, "data": b64}})
    body = {
        "contents": [{"role": "user", "parts": parts}],
        # Thinking tokens count toward the output limit on newer Flash models, so leave headroom.
        "generationConfig": {"temperature": 0, "maxOutputTokens": max_tokens + 3000, "responseMimeType": "application/json"},
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=15)) as client:
            model = settings.gemini_model
            for attempt in (model, GEMINI_FALLBACK):
                r = await client.post(f"https://generativelanguage.googleapis.com/v1beta/models/{attempt}:generateContent",
                                      headers={"x-goog-api-key": settings.gemini_api_key}, json=body)
                if r.status_code != 404 or attempt == GEMINI_FALLBACK:
                    break
            if r.status_code != 200:
                hint = " Check GEMINI_API_KEY." if r.status_code in (400, 401, 403) else ""
                raise AIUnavailable(f"Gemini returned HTTP {r.status_code}.{hint} {r.text[:300]}")
            status["model"] = attempt
            cands = r.json().get("candidates") or []
            text = "".join(p.get("text", "") for p in (cands[0].get("content", {}).get("parts", []) if cands else []))
            if not text:
                raise AIUnavailable("Gemini returned an empty answer (the photo may have been blocked by its safety filter).")
            status.update(last_error="", last_ok=time.time())
            return text
    except AIUnavailable as e:
        status["last_error"] = str(e)
        raise
    except Exception as e:
        status["last_error"] = f"{type(e).__name__}: {e}"
        raise AIUnavailable(status["last_error"]) from e


async def _chat_watsonx(content: list | str, max_tokens: int = 900) -> str:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=15)) as client:
            token = await _iam_token(client)
            model = await _vision_model(client)
            r = await client.post(
                f"{settings.watsonx_url}/ml/v1/text/chat",
                params={"version": API_VERSION},
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"},
                json={
                    "model_id": model,
                    "project_id": settings.watsonx_project_id,
                    "messages": [{"role": "user", "content": content}],
                    "max_tokens": max_tokens,
                    "temperature": 0,
                },
            )
            if r.status_code == 404 and not settings.watsonx_model:
                _model.update(id="", at=0)  # model withdrawn since we cached it
            if r.status_code != 200:
                raise AIUnavailable(f"watsonx returned HTTP {r.status_code}: {r.text[:300]}")
            text = r.json()["choices"][0]["message"]["content"]
            status.update(last_error="", last_ok=time.time())
            return text if isinstance(text, str) else json.dumps(text)
    except AIUnavailable as e:
        status["last_error"] = str(e)
        raise
    except Exception as e:  # network errors, timeouts, bad JSON
        status["last_error"] = f"{type(e).__name__}: {e}"
        raise AIUnavailable(status["last_error"]) from e


def _json(text: str) -> dict:
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    raw = m.group(1) if m else text[text.find("{"): text.rfind("}") + 1]
    try:
        return json.loads(raw)
    except Exception as e:
        raise AIUnavailable("The model's reply was not valid JSON.") from e


def _img(jpeg: bytes) -> dict:
    return {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()}}


def _where(ward: dict, landmark: str) -> str:
    lm, add_near = place_phrase(landmark)
    return f"Ward {ward['no']} ({ward['name']}, {ward['zone']} Zone), Ahmedabad" + (f", {'near ' if add_near else ''}{lm}" if lm else "")


async def analyze(jpeg: bytes, ward: dict, landmark: str, note: str, lang: str) -> dict:
    cats = "; ".join(f'"{k}" = {v["label"]} (handled by {v["dept"]})' for k, v in CATEGORIES.items())
    local = (f',\n "complaint_local": "the same complaint written in {LANGUAGES[lang]} script"' if lang != "en" else "")
    prompt = f"""You are the vision and drafting step of NagarNetra, an AI agent that files civic complaints with the Ahmedabad Municipal Corporation (AMC).
A citizen sent the attached photo from {_where(ward, landmark)}.{f' Their note: "{note}"' if note else ''}

Categories: {cats}.
Severity: "critical" = immediate danger to life (deep pothole on a main road, open manhole, live wire, flooding); "high" = likely to cause accidents or health problems within days; "medium" = a nuisance that will get worse; "low" = cosmetic.

Reply with only this JSON object and nothing else:
{{"is_civic_issue": true or false,
 "category": one of {list(CATEGORIES)},
 "severity": one of {SEVERITIES},
 "confidence": number from 0 to 1,
 "observation": "one factual sentence describing what the photo shows",
 "hazard": "one short sentence on the risk to the public",
 "complaint_en": "a formal complaint of 3-4 sentences to the responsible AMC department, naming the ward and landmark"{local}}}
If the photo does not show a civic infrastructure problem, set is_civic_issue to false and category to "other"."""
    out = _json(await _chat([{"type": "text", "text": prompt}, _img(jpeg)]))
    if out.get("category") not in CATEGORIES:
        out["category"] = "other"
    if out.get("severity") not in SEVERITIES:
        out["severity"] = "medium"
    try:
        out["confidence"] = max(0.0, min(1.0, float(out.get("confidence", 0.7))))
    except (TypeError, ValueError):
        out["confidence"] = 0.7
    out["is_civic_issue"] = bool(out.get("is_civic_issue", True))
    for k in ("observation", "hazard", "complaint_en", "complaint_local"):
        out[k] = str(out.get(k) or "").strip()
    return out


async def draft(category: str, severity: str, ward: dict, landmark: str, note: str, observation: str,
                lang: str, code: str) -> tuple[str, str]:
    c = CATEGORIES[category]
    local = f' and "complaint_local" (the same complaint in {LANGUAGES[lang]} script)' if lang != "en" else ""
    prompt = f"""Write a formal civic complaint for the Ahmedabad Municipal Corporation.
Department: {c['dept']}. Issue: {c['label']} ({severity} severity) at {_where(ward, landmark)}.
What was observed: {observation or 'not provided'}. Citizen's note: {note or 'none'}. Complaint number: {code}.
Reply with only a JSON object with "complaint_en" (3-5 sentences, ending with the complaint number){local}."""
    out = _json(await _chat(prompt, max_tokens=700))
    return str(out.get("complaint_en", "")).strip(), str(out.get("complaint_local", "")).strip()


async def verify_fix(before: bytes, after: bytes, category: str) -> dict:
    prompt = f"""You check repair work for the Ahmedabad Municipal Corporation. The first photo shows a reported problem ({CATEGORIES[category]['label']}). The second photo was uploaded by the field crew after the repair.
Decide whether the second photo shows the same place with the problem fixed.
Reply with only JSON: {{"fixed": true or false, "same_place": true or false, "confidence": number from 0 to 1, "note": "one sentence explaining your decision"}}"""
    out = _json(await _chat([{"type": "text", "text": prompt}, _img(before), _img(after)], max_tokens=300))
    return {"fixed": bool(out.get("fixed")), "same_place": bool(out.get("same_place", True)),
            "confidence": float(out.get("confidence", 0.5) or 0.5), "note": str(out.get("note", "")).strip()}
