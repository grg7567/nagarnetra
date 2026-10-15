import asyncio
import json
import logging
import secrets
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import ai, civic, images, seed, service
from .auth import check_pw, clear_session, current_user, get_db, hash_pw, require_admin, set_session
from .civic import CATEGORIES, LANGUAGES, OPEN_STATUSES, SEVERITIES, STATUSES
from .config import settings
from .db import Event, Photo, SessionLocal, Ticket, User, as_utc, init_db, utcnow

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("nagarnetra")


async def _escalation_loop():
    while True:
        try:
            with SessionLocal() as db:
                service.run_escalations(db)
                # Drop photo uploads that were analysed but never filed.
                stale = utcnow() - timedelta(hours=6)
                db.query(Photo).filter(Photo.ticket_id.is_(None), Photo.created_at < stale).delete()
                db.commit()
        except Exception:
            log.exception("escalation loop failed")
        await asyncio.sleep(3600)  # deadlines are in days; hourly keeps a serverless database mostly asleep


async def _keepalive_loop(url: str):
    """Free Render instances sleep after 15 idle minutes; a request to our own public URL counts as traffic."""
    import httpx
    log.info("keep-alive pings to %s every 10 minutes", url)
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            await asyncio.sleep(600)
            try:
                r = await client.get(url + "/api/health")
                if r.status_code != 200:
                    log.warning("keep-alive ping returned HTTP %s", r.status_code)
            except Exception as e:
                log.warning("keep-alive ping failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as db:
        seed.ensure_admin(db)
        if settings.seed_demo:
            seed.seed_demo(db)
    tasks = [asyncio.create_task(_escalation_loop())]
    if settings.keepalive and settings.keepalive_url:
        tasks.append(asyncio.create_task(_keepalive_loop(settings.keepalive_url)))
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="NagarNetra", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")

# ---------- tiny per-IP rate limiter ----------
_hits: dict[str, deque] = defaultdict(deque)


def limit(request: Request, bucket: str, n: int, per_s: int) -> None:
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
    q = _hits[f"{bucket}:{ip}"]
    now = time.time()
    while q and now - q[0] > per_s:
        q.popleft()
    if len(q) >= n:
        raise HTTPException(429, "Too many requests from this device. Wait a few minutes and try again.")
    q.append(now)


def _ward_or_422(lat: float, lng: float) -> dict:
    ward = civic.find_ward(lat, lng)
    if not ward:
        raise HTTPException(422, "This location is outside Ahmedabad Municipal Corporation limits.")
    return ward


# ---------- public ----------
@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/config")
def config():
    return {
        "city": "Ahmedabad",
        "ai_enabled": settings.ai_configured,
        "ai_model": ai.status["model"] or settings.watsonx_model,
        "categories": [{"id": k, "label": v["label"], "dept": v["dept"]} for k, v in CATEGORIES.items()],
        "severities": SEVERITIES,
        "languages": [{"id": k, "label": v} for k, v in LANGUAGES.items()],
        "bounds": civic.bounds(),
    }


@app.get("/api/wards")
def wards():
    return JSONResponse(civic.wards_geojson(), headers={"Cache-Control": "public, max-age=86400"})


@app.post("/api/analyze")
async def analyze(request: Request, photo: UploadFile = File(...), lat: float | None = Form(None), lng: float | None = Form(None),
                  landmark: str = Form(""), note: str = Form(""), lang: str = Form("en"), db: Session = Depends(get_db)):
    limit(request, "analyze", 12, 600)
    lang = lang if lang in LANGUAGES else "en"
    raw = await photo.read()
    try:
        img = await asyncio.to_thread(images.process, raw)
    except images.BadImage as e:
        raise HTTPException(422, str(e))
    source = "device"
    if lat is None or lng is None:
        if not img["gps"]:
            raise HTTPException(422, "We need the location. Allow location access or tap the map where the issue is.")
        lat, lng = img["gps"]
        source = "photo"
    ward = _ward_or_422(lat, lng)

    result, ai_error = None, ""
    if settings.ai_configured:
        try:
            result = await ai.analyze(img["jpeg"], ward, landmark[:200], note[:500], lang)
        except ai.AIUnavailable as e:
            ai_error = "The AI could not analyse this photo right now. Choose the issue type yourself."
            log.warning("analyze failed: %s", e)

    token = secrets.token_urlsafe(24)
    p = Photo(upload_token=token, kind="report", data=img["jpeg"], faces_blurred=img["faces"],
              analysis=json.dumps(result or {}))
    db.add(p)
    db.commit()

    category = (result or {}).get("category")
    dups = service.find_duplicates(db, lat, lng, category) if category else []
    return {
        "upload_token": token,
        "photo_id": p.id,
        "faces_blurred": img["faces"],
        "lat": lat, "lng": lng, "location_source": source,
        "ward": ward,
        "ai": result,
        "ai_error": ai_error,
        "ai_model": ai.status["model"],
        "duplicates": [{**service.ticket_dict(t), "distance_m": round(d)} for t, d in dups],
    }


@app.get("/api/duplicates")
def duplicates(lat: float, lng: float, category: str, db: Session = Depends(get_db)):
    if category not in CATEGORIES:
        raise HTTPException(422, "Unknown category.")
    return [{**service.ticket_dict(t), "distance_m": round(d)} for t, d in service.find_duplicates(db, lat, lng, category)]


@app.get("/api/uploads/{token}/photo")
def upload_photo(token: str, db: Session = Depends(get_db)):
    p = db.scalar(select(Photo).where(Photo.upload_token == token, Photo.ticket_id.is_(None)))
    if not p or not token:
        raise HTTPException(404, "Upload not found.")
    return Response(images.thumb(p.data, 900), media_type="image/jpeg")


class ReportIn(BaseModel):
    upload_token: str
    lat: float
    lng: float
    category: str
    severity: str
    landmark: str = Field("", max_length=200)
    note: str = Field("", max_length=1000)
    lang: str = "en"
    contact: str = Field("", max_length=120)
    merge_into: str = ""


@app.post("/api/reports")
async def file_report(body: ReportIn, request: Request, db: Session = Depends(get_db)):
    limit(request, "report", 6, 600)
    if body.category not in CATEGORIES or body.severity not in SEVERITIES:
        raise HTTPException(422, "Choose a valid issue type and severity.")
    photo = db.scalar(select(Photo).where(Photo.upload_token == body.upload_token, Photo.ticket_id.is_(None)))
    if not photo or not body.upload_token:
        raise HTTPException(410, "This photo upload has expired. Start the report again.")
    ward = _ward_or_422(body.lat, body.lng)
    lang = body.lang if body.lang in LANGUAGES else "en"
    analysis = json.loads(photo.analysis or "{}")

    # Merge into an existing ticket: one the citizen picked, or an automatic match.
    target = None
    if body.merge_into:
        target = db.scalar(select(Ticket).where(Ticket.code == body.merge_into, Ticket.status.in_(OPEN_STATUSES)))
    if not target:
        dups = service.find_duplicates(db, body.lat, body.lng, body.category, limit=1)
        target = dups[0][0] if dups and dups[0][1] <= 25 else None
    if target:
        service.merge_report(db, target, photo, body.severity, body.note)
        db.commit()
        return {"code": target.code, "merged": True, "ticket": service.ticket_detail(target)}

    now = utcnow()
    t = Ticket(code="TMP-" + secrets.token_hex(6), category=body.category, severity=body.severity, status="new", lat=body.lat, lng=body.lng,
               ward_no=ward["no"], ward_name=ward["name"], zone=ward["zone"], department=CATEGORIES[body.category]["dept"],
               landmark=body.landmark.strip(), citizen_note=body.note.strip(), language=lang, contact=body.contact.strip(),
               due_at=civic.due_date(body.category, body.severity, now), created_at=now)
    ai_used = bool(analysis) and analysis.get("category") == body.category
    if analysis:
        t.ai_source = "watsonx"
        t.ai_confidence = analysis.get("confidence")
        t.ai_observation = analysis.get("observation", "")
        t.ai_hazard = analysis.get("hazard", "")
    db.add(t)
    db.flush()
    t.code = f"AMD-{t.id + 10000}"
    photo.ticket_id = t.id
    photo.upload_token = ""

    en, local = "", ""
    if ai_used and analysis.get("complaint_en"):
        en = analysis["complaint_en"] + f"\n\nComplaint no.: {t.code}"
        local = analysis.get("complaint_local", "") if lang != "en" else ""
        if local:
            local += f"\n\n{t.code}"
    elif settings.ai_configured and analysis:
        try:
            en, local = await ai.draft(t.category, t.severity, ward, t.landmark, t.citizen_note, t.ai_observation, lang, t.code)
        except ai.AIUnavailable:
            en = ""
    if not en:
        en, local = civic.template_complaint(t.category, t.severity, ward, t.landmark, t.citizen_note, t.ai_observation, lang, t.code)
    t.complaint_en, t.complaint_local = en, (local if lang != "en" else "")

    service.add_event(db, t, "citizen", "reported", "Report received with photo and location.")
    if analysis:
        changed = "" if ai_used else f" The citizen changed the type to {CATEGORIES[t.category]['label'].lower()}."
        service.add_event(db, t, "agent", "classified",
                          f"AI identified {CATEGORIES[analysis['category']]['label'].lower()} ({analysis.get('severity')} severity, "
                          f"{round((analysis.get('confidence') or 0) * 100)}% confidence).{changed}")
    if photo.faces_blurred:
        service.add_event(db, t, "agent", "privacy", f"Blurred {photo.faces_blurred} face(s) in the photo.", public=False)
    service.add_event(db, t, "agent", "routed",
                      f"Routed to {t.department}, Ward {t.ward_no} {t.ward_name} ({t.zone} Zone). Deadline {service.fmt(t.due_at)}.")
    service.add_event(db, t, "agent", "filed", f"Complaint {t.code} filed.")
    db.commit()
    return {"code": t.code, "merged": False, "ticket": service.ticket_detail(t)}


def _get_ticket(db: Session, code: str) -> Ticket:
    t = db.scalar(select(Ticket).where(Ticket.code == code.strip().upper()))
    if not t:
        raise HTTPException(404, "No complaint with that number.")
    return t


@app.get("/api/tickets/{code}")
def track(code: str, db: Session = Depends(get_db)):
    return service.ticket_detail(_get_ticket(db, code))


class ReopenIn(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


@app.post("/api/tickets/{code}/reopen")
def reopen(code: str, body: ReopenIn, request: Request, db: Session = Depends(get_db)):
    limit(request, "reopen", 3, 3600)
    t = _get_ticket(db, code)
    if t.status != "resolved":
        raise HTTPException(409, "Only resolved complaints can be reopened.")
    if as_utc(t.resolved_at) < utcnow() - timedelta(days=14):
        raise HTTPException(409, "This complaint was closed more than 14 days ago. File a new report instead.")
    t.status = "in_progress"
    t.resolved_at = None
    t.fix_verified = ""
    t.due_at = utcnow() + timedelta(days=2)
    service.add_event(db, t, "citizen", "reopened", f"Citizen says it is not fixed: {body.reason.strip()}")
    db.commit()
    return service.ticket_detail(t)


@app.get("/api/public/tickets")
def public_tickets(db: Session = Depends(get_db), days: int = Query(60, le=365)):
    since = utcnow() - timedelta(days=days)
    rows = db.scalars(select(Ticket).where(Ticket.created_at >= since).order_by(Ticket.id.desc()).limit(1500)).all()
    return [service.ticket_dict(t) for t in rows]


@app.get("/api/public/stats")
def public_stats(db: Session = Depends(get_db)):
    total = db.scalar(select(func.count(Ticket.id))) or 0
    resolved = db.scalar(select(func.count(Ticket.id)).where(Ticket.status == "resolved")) or 0
    open_ = db.scalar(select(func.count(Ticket.id)).where(Ticket.status.in_(OPEN_STATUSES))) or 0
    return {"total": total, "resolved": resolved, "open": open_}


@app.get("/api/photos/{pid}")
def photo(pid: int, size: int = Query(0, ge=0, le=1600), db: Session = Depends(get_db)):
    p = db.get(Photo, pid)
    if not p or p.ticket_id is None:
        raise HTTPException(404, "Photo not found.")
    data = images.thumb(p.data, size) if size else p.data
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=604800"})


# ---------- officials ----------
class LoginIn(BaseModel):
    email: str
    password: str


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    limit(request, "login", 10, 600)
    u = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if not u or not u.active or not check_pw(body.password, u.password_hash):
        raise HTTPException(401, "Email or password is incorrect.")
    set_session(response, request, u)
    return _user(u)


@app.post("/api/auth/logout")
def logout(response: Response):
    clear_session(response)
    return {"ok": True}


def _user(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "department": u.department, "active": u.active}


@app.get("/api/auth/me")
def me(user: User = Depends(current_user)):
    return _user(user)


_last_esc = {"t": 0.0}


def _scope(q, user: User):
    return q.where(Ticket.department == user.department) if user.department else q


@app.get("/api/admin/tickets")
def admin_tickets(status: str = "open", department: str = "", zone: str = "", ward: int = 0, category: str = "",
                  q: str = "", user: User = Depends(current_user), db: Session = Depends(get_db)):
    if time.time() - _last_esc["t"] > 120:  # free hosting sleeps; catch up on escalations when someone looks
        _last_esc["t"] = time.time()
        service.run_escalations(db)
    stmt = _scope(select(Ticket), user)
    if status == "open":
        stmt = stmt.where(Ticket.status.in_(OPEN_STATUSES))
    elif status == "overdue":
        stmt = stmt.where(Ticket.status.in_(OPEN_STATUSES), Ticket.due_at < utcnow())
    elif status in STATUSES:
        stmt = stmt.where(Ticket.status == status)
    if department:
        stmt = stmt.where(Ticket.department == department)
    if zone:
        stmt = stmt.where(Ticket.zone == zone)
    if ward:
        stmt = stmt.where(Ticket.ward_no == ward)
    if category:
        stmt = stmt.where(Ticket.category == category)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(Ticket.code.ilike(like) | Ticket.landmark.ilike(like) | Ticket.ward_name.ilike(like))
    rows = db.scalars(stmt.order_by(Ticket.id.desc()).limit(1000)).all()
    out = [service.ticket_dict(t, admin=True) for t in rows]
    out.sort(key=lambda d: (-d["priority"], d["created_at"]))
    return out


@app.get("/api/admin/tickets/{code}")
def admin_ticket(code: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = _get_ticket(db, code)
    if user.department and t.department != user.department:
        raise HTTPException(403, "This complaint belongs to another department.")
    return service.ticket_detail(t, admin=True)


class StatusIn(BaseModel):
    status: str
    note: str = Field("", max_length=1000)


@app.post("/api/admin/tickets/{code}/status")
def set_status(code: str, body: StatusIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = _get_ticket(db, code)
    if user.department and t.department != user.department:
        raise HTTPException(403, "This complaint belongs to another department.")
    if body.status not in ("assigned", "in_progress", "rejected", "new"):
        raise HTTPException(422, "Use the resolve action with an 'after' photo to close a complaint.")
    if body.status == "rejected" and len(body.note.strip()) < 5:
        raise HTTPException(422, "Give the citizen a reason when rejecting a complaint.")
    label = {"new": "Moved back to new", "assigned": "Assigned to a field team", "in_progress": "Work started on site",
             "rejected": "Rejected"}[body.status]
    t.status = body.status
    service.add_event(db, t, user.email, body.status, label + (f": {body.note.strip()}" if body.note.strip() else "."))
    db.commit()
    return service.ticket_detail(t, admin=True)


class NoteIn(BaseModel):
    note: str = Field(..., min_length=1, max_length=1000)
    public: bool = False


@app.post("/api/admin/tickets/{code}/note")
def add_note(code: str, body: NoteIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = _get_ticket(db, code)
    service.add_event(db, t, user.email, "note", body.note.strip(), public=body.public)
    db.commit()
    return service.ticket_detail(t, admin=True)


class EditIn(BaseModel):
    category: str
    severity: str


@app.patch("/api/admin/tickets/{code}")
def reclassify(code: str, body: EditIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = _get_ticket(db, code)
    if body.category not in CATEGORIES or body.severity not in SEVERITIES:
        raise HTTPException(422, "Choose a valid issue type and severity.")
    if user.department and t.department != user.department:
        raise HTTPException(403, "This complaint belongs to another department.")
    changes = []
    if body.category != t.category:
        changes.append(f"type changed to {CATEGORIES[body.category]['label'].lower()}, re-routed to {CATEGORIES[body.category]['dept']}")
        t.category = body.category
        t.department = CATEGORIES[body.category]["dept"]
    if body.severity != t.severity:
        changes.append(f"severity changed to {body.severity}")
        t.severity = body.severity
    if changes:
        t.due_at = civic.due_date(t.category, t.severity, as_utc(t.created_at))
        service.add_event(db, t, user.email, "reclassified", "Official review: " + "; ".join(changes) + f". Deadline {service.fmt(t.due_at)}.")
        db.commit()
    return service.ticket_detail(t, admin=True)


@app.post("/api/admin/tickets/{code}/resolve")
async def resolve(code: str, photo: UploadFile = File(...), note: str = Form(""), override: bool = Form(False),
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = _get_ticket(db, code)
    if user.department and t.department != user.department:
        raise HTTPException(403, "This complaint belongs to another department.")
    if t.status not in OPEN_STATUSES:
        raise HTTPException(409, "This complaint is already closed.")
    try:
        img = await asyncio.to_thread(images.process, await photo.read())
    except images.BadImage as e:
        raise HTTPException(422, str(e))
    before = next((p for p in t.photos if p.kind == "report"), None)
    verdict = None
    if settings.ai_configured and before and not override:
        try:
            verdict = await ai.verify_fix(before.data, img["jpeg"], t.category)
        except ai.AIUnavailable as e:
            log.warning("verify failed: %s", e)
        if verdict and not (verdict["fixed"] and verdict["same_place"]):
            return {"resolved": False, "verdict": verdict, "ticket": service.ticket_detail(t, admin=True)}
    t.photos.append(Photo(kind="after", data=img["jpeg"], faces_blurred=img["faces"]))
    t.status = "resolved"
    t.resolved_at = utcnow()
    t.fix_verified = "override" if override else ("ai_yes" if verdict else "")
    check = (" AI check: " + verdict["note"]) if verdict else (" Closed by official override of the AI check." if override else "")
    service.add_event(db, t, user.email, "resolved", "Marked fixed with an 'after' photo." + (f" {note.strip()}" if note.strip() else "") + check)
    db.commit()
    return {"resolved": True, "verdict": verdict, "ticket": service.ticket_detail(t, admin=True)}


@app.get("/api/admin/stats")
def admin_stats(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(_scope(select(Ticket), user)).all()
    now = utcnow()
    open_ = [t for t in rows if t.status in OPEN_STATUSES]
    resolved = [t for t in rows if t.status == "resolved" and t.resolved_at]
    hours = [(as_utc(t.resolved_at) - as_utc(t.created_at)).total_seconds() / 3600 for t in resolved]
    by_ward, by_dept, by_cat = defaultdict(int), defaultdict(lambda: {"open": 0, "overdue": 0}), defaultdict(int)
    for t in open_:
        by_ward[t.ward_no] += 1
        by_dept[t.department]["open"] += 1
        by_cat[t.category] += 1
        if now > as_utc(t.due_at):
            by_dept[t.department]["overdue"] += 1
    days = []
    for i in range(13, -1, -1):
        d0 = (now - timedelta(days=i)).date()
        days.append({"date": d0.isoformat(),
                     "reported": sum(1 for t in rows if as_utc(t.created_at).date() == d0),
                     "resolved": sum(1 for t in resolved if as_utc(t.resolved_at).date() == d0)})
    on_time = [t for t in resolved if as_utc(t.resolved_at) <= as_utc(t.due_at)]
    return {
        "open": len(open_),
        "overdue": sum(1 for t in open_ if now > as_utc(t.due_at)),
        "critical_open": sum(1 for t in open_ if t.severity == "critical"),
        "resolved": len(resolved),
        "median_hours": sorted(hours)[len(hours) // 2] if hours else None,
        "on_time_rate": (len(on_time) / len(resolved)) if resolved else None,
        "merged_reports": sum(t.report_count - 1 for t in rows),
        "by_ward": by_ward, "by_department": by_dept, "by_category": by_cat, "daily": days,
    }


class UserIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=120)
    name: str = Field("", max_length=80)
    password: str = Field(..., min_length=8, max_length=100)
    role: str = "official"
    department: str = ""


@app.get("/api/admin/users")
def list_users(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    return [_user(u) for u in db.scalars(select(User).order_by(User.id)).all()]


@app.post("/api/admin/users")
def create_user(body: UserIn, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists.")
    if body.role not in ("admin", "official"):
        raise HTTPException(422, "Role must be admin or official.")
    if body.department and body.department not in {c["dept"] for c in CATEGORIES.values()}:
        raise HTTPException(422, "Unknown department.")
    u = User(email=email, name=body.name.strip(), password_hash=hash_pw(body.password), role=body.role, department=body.department)
    db.add(u)
    db.commit()
    return _user(u)


class ActiveIn(BaseModel):
    active: bool


@app.post("/api/admin/users/{uid}/active")
def set_active(uid: int, body: ActiveIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "User not found.")
    if u.id == admin.id:
        raise HTTPException(409, "You cannot disable your own account.")
    u.active = body.active
    db.commit()
    return _user(u)


@app.delete("/api/admin/demo")
def clear_demo(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    ids = db.scalars(select(Ticket.id).where(Ticket.is_demo.is_(True))).all()
    if ids:
        db.query(Event).filter(Event.ticket_id.in_(ids)).delete(synchronize_session=False)
        db.query(Photo).filter(Photo.ticket_id.in_(ids)).delete(synchronize_session=False)
        db.query(Ticket).filter(Ticket.id.in_(ids)).delete(synchronize_session=False)
        db.commit()
    return {"deleted": len(ids)}


@app.get("/api/admin/ai-status")
def ai_status(_: User = Depends(current_user)):
    return {"configured": settings.ai_configured, "region": settings.watsonx_url, **ai.status}


# ---------- single-page app ----------
if settings.static_dir.exists():
    app.mount("/assets", StaticFiles(directory=settings.static_dir / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Not found.")
        f = settings.static_dir / path
        if path and f.is_file() and settings.static_dir in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(settings.static_dir / "index.html")
