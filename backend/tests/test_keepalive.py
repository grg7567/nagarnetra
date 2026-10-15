import asyncio

import httpx
import pytest

from app import main


def test_keepalive_pings_health(monkeypatch):
    hits = []

    def handler(req):
        hits.append(str(req.url))
        return httpx.Response(200, json={"ok": True})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **k: real_client(transport=httpx.MockTransport(handler), **k))
    sleeps = []

    async def fake_sleep(s):
        sleeps.append(s)
        if len(sleeps) > 2:
            raise asyncio.CancelledError

    monkeypatch.setattr(main.asyncio, "sleep", fake_sleep)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(main._keepalive_loop("https://nagarnetra.onrender.com"))
    assert hits == ["https://nagarnetra.onrender.com/api/health"] * 2
    assert sleeps[0] == 600
