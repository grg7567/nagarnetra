import io
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from shapely.geometry import shape

from app import civic, db as dbm
from app.main import app

# A point inside Maninagar ward, taken from the ward polygon itself.

_w37 = next(f for f in civic.wards_geojson()["features"] if f["properties"]["no"] == 37)
P = shape(_w37["geometry"]).representative_point()
LAT, LNG = round(P.y, 6), round(P.x, 6)


def jpeg():
    b = io.BytesIO()
    Image.new("RGB", (800, 600), (90, 90, 95)).save(b, "JPEG")
    return b.getvalue()


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def analyze(client, lat=LAT, lng=LNG):
    r = client.post("/api/analyze", data={"lat": lat, "lng": lng, "lang": "gu"},
                    files={"photo": ("p.jpg", jpeg(), "image/jpeg")})
    return r


def test_ward_lookup():
    w = civic.find_ward(LAT, LNG)
    assert w["no"] == 37 and w["zone"] == "South"
    assert civic.find_ward(19.07, 72.87) is None  # Mumbai


def test_place_phrase():
    assert civic.place_phrase("Near Swastik Cross Road") == ("Swastik Cross Road", True)
    assert civic.place_phrase("opposite Iscon Mall") == ("opposite Iscon Mall", False)
    assert civic.place_phrase("") == ("", False)


def test_config(client):
    c = client.get("/api/config").json()
    assert c["city"] == "Ahmedabad" and c["ai_enabled"] is False
    assert len(client.get("/api/wards").json()["features"]) == 48


def test_outside_city_rejected(client):
    r = analyze(client, 19.07, 72.87)
    assert r.status_code == 422 and "outside" in r.json()["detail"]


def test_bad_image_rejected(client):
    r = client.post("/api/analyze", data={"lat": LAT, "lng": LNG}, files={"photo": ("x.jpg", b"not an image", "image/jpeg")})
    assert r.status_code == 422


def test_full_flow(client):
    a = analyze(client).json()
    assert a["ward"]["no"] == 37 and a["ai"] is None and a["upload_token"]
    r = client.post("/api/reports", json={"upload_token": a["upload_token"], "lat": LAT, "lng": LNG, "category": "pothole",
                                           "severity": "high", "landmark": "Maninagar Railway Station", "lang": "gu"})
    assert r.status_code == 200, r.text
    t = r.json()
    code = t["code"]
    assert code.startswith("AMD-") and not t["merged"]
    assert t["ticket"]["department"] == "Engineering Dept. (Roads)"
    assert "વોર્ડ 37" in t["ticket"]["complaint_local"] and code in t["ticket"]["complaint_en"]

    # Upload token is single-use.
    again = client.post("/api/reports", json={"upload_token": a["upload_token"], "lat": LAT, "lng": LNG,
                                               "category": "pothole", "severity": "high"})
    assert again.status_code == 410

    # Second report 10 m away merges.
    b = analyze(client, LAT + 0.00009, LNG).json()
    m = client.post("/api/reports", json={"upload_token": b["upload_token"], "lat": LAT + 0.00009, "lng": LNG,
                                           "category": "pothole", "severity": "critical"}).json()
    assert m["merged"] and m["code"] == code and m["ticket"]["report_count"] == 2 and m["ticket"]["severity"] == "critical"
    assert client.get("/api/duplicates", params={"lat": LAT, "lng": LNG, "category": "pothole"}).json()[0]["code"] == code

    # Citizen says "mine is different": no auto-merge even at the same spot.
    fn = analyze(client).json()
    sep = client.post("/api/reports", json={"upload_token": fn["upload_token"], "lat": LAT, "lng": LNG,
                                             "category": "pothole", "severity": "low", "force_new": True}).json()
    assert not sep["merged"] and sep["code"] != code

    # Different category at the same spot does not merge.
    c = analyze(client).json()
    n = client.post("/api/reports", json={"upload_token": c["upload_token"], "lat": LAT, "lng": LNG,
                                           "category": "streetlight", "severity": "low", "lang": "en"}).json()
    assert not n["merged"] and n["ticket"]["complaint_local"] == ""

    # Public tracking hides internal fields.
    pub = client.get(f"/api/tickets/{code}").json()
    assert "contact" not in pub and len(pub["photos"]) == 2
    assert client.get(f"/api/photos/{pub['photos'][0]['id']}?size=200").status_code == 200

    # Officials.
    assert client.get("/api/admin/tickets").status_code == 401
    assert client.post("/api/auth/login", json={"email": "admin@test.in", "password": "nope"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "admin@test.in", "password": "test-password-1"}).status_code == 200
    queue = client.get("/api/admin/tickets").json()
    assert queue[0]["code"] == code  # critical with 2 reports ranks first
    assert client.post(f"/api/admin/tickets/{code}/status", json={"status": "rejected", "note": ""}).status_code == 422
    assert client.post(f"/api/admin/tickets/{code}/status", json={"status": "assigned"}).json()["status"] == "assigned"
    r = client.patch(f"/api/admin/tickets/{n['code']}", json={"category": "drainage", "severity": "medium"}).json()
    assert r["department"] == "Drainage Dept."
    res = client.post(f"/api/admin/tickets/{code}/resolve", data={"note": "Patched"},
                      files={"photo": ("a.jpg", jpeg(), "image/jpeg")}).json()
    assert res["resolved"] and res["ticket"]["status"] == "resolved"
    assert [p["kind"] for p in res["ticket"]["photos"]][-1] == "after"

    # Citizen reopens.
    ro = client.post(f"/api/tickets/{code}/reopen", json={"reason": "Still broken"}).json()
    assert ro["status"] == "in_progress"

    st = client.get("/api/admin/stats").json()
    assert st["open"] >= 3 and st["merged_reports"] == 1

    # Department official only sees their department.
    client.post("/api/admin/users", json={"email": "roads@test.in", "password": "roadsroads1", "department": "Engineering Dept. (Roads)"})
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"email": "roads@test.in", "password": "roadsroads1"})
    codes = {t["code"] for t in client.get("/api/admin/tickets?status=all").json()}
    assert code in codes and n["code"] not in codes
    assert client.get("/api/admin/users").status_code == 403


def test_escalation(client):
    from app import service
    with dbm.SessionLocal() as s:
        t = s.query(dbm.Ticket).filter(dbm.Ticket.category == "drainage").first()
        t.due_at = dbm.utcnow() - timedelta(days=10)
        s.commit()
        assert service.run_escalations(s) == 1
        s.refresh(t)
        assert t.escalation_level == 2
        assert any(e.kind == "escalated" for e in t.events)
