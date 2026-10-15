"""watsonx client against a fake IBM endpoint: token, model catalog, chat with image, JSON parsing."""
import asyncio
import json

import httpx

from app import ai
from app.config import settings

CATALOG = {"resources": [
    {"model_id": "meta-llama/llama-3-3-70b-instruct", "functions": [{"id": "text_chat"}], "lifecycle": [{"id": "available", "start_date": "2024-01-01"}]},
    {"model_id": "mistralai/mistral-medium-2505", "functions": [{"id": "image_chat"}], "lifecycle": [{"id": "available", "start_date": "2024-01-01"}, {"id": "withdrawn", "start_date": "2025-01-01"}]},
    {"model_id": "mistralai/mistral-small-3-1-24b-instruct-2503", "functions": [{"id": "image_chat"}], "lifecycle": [{"id": "available", "start_date": "2024-01-01"}]},
    {"model_id": "meta-llama/llama-4-maverick-17b-128e-instruct-fp8", "functions": [{"id": "image_chat"}], "lifecycle": [{"id": "available", "start_date": "2024-01-01"}]},
]}
seen = {}


def handler(req: httpx.Request) -> httpx.Response:
    if req.url.host == "iam.cloud.ibm.com":
        assert b"apikey=test-key" in req.content
        return httpx.Response(200, json={"access_token": "tok", "expiration": 9999999999})
    if req.url.path.endswith("/foundation_model_specs"):
        return httpx.Response(200, json=CATALOG)
    if req.url.path.endswith("/text/chat"):
        body = json.loads(req.content)
        seen["body"] = body
        assert req.headers["authorization"] == "Bearer tok"
        reply = {"is_civic_issue": True, "category": "drainage", "severity": "critical", "confidence": 0.88,
                 "observation": "An open manhole with sewage flowing onto the road.", "hazard": "Pedestrians can fall in.",
                 "complaint_en": "Respected Sir, there is an open manhole in Ward 37.", "complaint_local": "આદરણીય સાહેબ, ખુલ્લું મેનહોલ છે."}
        return httpx.Response(200, json={"choices": [{"message": {"content": "Here you go:\n```json\n" + json.dumps(reply, ensure_ascii=False) + "\n```"}}]})
    return httpx.Response(404)


class FakeClient(httpx.AsyncClient):
    def __init__(self, *a, **k):
        k.pop("transport", None)
        super().__init__(*a, transport=httpx.MockTransport(handler), **k)


def test_analyze_with_watsonx(monkeypatch):
    monkeypatch.setattr(settings, "watsonx_apikey", "test-key")
    monkeypatch.setattr(settings, "watsonx_project_id", "proj-1")
    monkeypatch.setattr(settings, "watsonx_model", "")
    monkeypatch.setattr(ai.httpx, "AsyncClient", FakeClient)
    ai._token.update(value="", exp=0)
    ai._model.update(id="", at=0)

    ward = {"no": 37, "name": "Maninagar", "zone": "South"}
    out = asyncio.run(ai.analyze(b"\xff\xd8fakejpeg", ward, "Near Maninagar Station", "", "gu"))
    assert out["category"] == "drainage" and out["severity"] == "critical" and out["confidence"] == 0.88
    assert out["complaint_local"].startswith("આદરણીય")
    body = seen["body"]
    assert body["model_id"] == "meta-llama/llama-4-maverick-17b-128e-instruct-fp8"  # withdrawn + text-only models skipped
    assert body["project_id"] == "proj-1"
    parts = body["messages"][0]["content"]
    assert parts[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert "near Maninagar Station" in parts[0]["text"] and "Gujarati" in parts[0]["text"]


def test_analyze_with_gemini(monkeypatch):
    calls = []

    def gemini(req: httpx.Request) -> httpx.Response:
        calls.append(req.url.path)
        assert req.headers["x-goog-api-key"] == "g-key"
        if "gemini-flash-latest" in req.url.path:
            return httpx.Response(404, json={"error": "not found"})  # alias missing -> fallback model
        body = json.loads(req.content)
        parts = body["contents"][0]["parts"]
        assert "text" in parts[0] and parts[1]["inline_data"]["mime_type"] == "image/jpeg"
        reply = {"is_civic_issue": True, "category": "pothole", "severity": "high", "confidence": 0.9,
                 "observation": "Pothole.", "hazard": "Skids.", "complaint_en": "Sir, pothole.", "complaint_local": "ખાડો."}
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(reply, ensure_ascii=False)}]}}]})

    class GeminiClient(httpx.AsyncClient):
        def __init__(self, *a, **k):
            super().__init__(*a, transport=httpx.MockTransport(gemini), **k)

    monkeypatch.setattr(settings, "gemini_api_key", "g-key")
    monkeypatch.setattr(ai.httpx, "AsyncClient", GeminiClient)
    out = asyncio.run(ai.analyze(b"\xff\xd8x", {"no": 1, "name": "Gota", "zone": "North West"}, "", "", "gu"))
    assert out["category"] == "pothole" and out["complaint_local"] == "ખાડો."
    assert calls[-1].endswith("gemini-2.5-flash:generateContent") and ai.status["model"] == "gemini-2.5-flash"


def test_bad_json_raises():
    try:
        ai._json("no json here")
    except ai.AIUnavailable:
        return
    raise AssertionError("expected AIUnavailable")
