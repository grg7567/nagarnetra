"""Ticket lifecycle: create or merge reports, route, escalate, resolve, serialise."""
import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import civic
from .civic import CATEGORIES, ESCALATION, OPEN_STATUSES, SEV_WEIGHT
from .db import Event, Photo, Ticket, as_utc, utcnow

log = logging.getLogger("nagarnetra")


def add_event(db: Session, t: Ticket, actor: str, kind: str, message: str, public: bool = True) -> None:
    db.add(Event(ticket_id=t.id, actor=actor, kind=kind, message=message, public=public))


def find_duplicates(db: Session, lat: float, lng: float, category: str, limit: int = 3) -> list[tuple[Ticket, float]]:
    since = utcnow() - timedelta(days=civic.DUPLICATE_WINDOW_DAYS)
    d_lat = civic.DUPLICATE_RADIUS_M / 111_000 * 1.5
    d_lng = d_lat / 0.92  # cos(23 degrees) for Ahmedabad
    rows = db.scalars(select(Ticket).where(
        Ticket.category == category, Ticket.status.in_(OPEN_STATUSES),
        Ticket.lat.between(lat - d_lat, lat + d_lat), Ticket.lng.between(lng - d_lng, lng + d_lng),
    )).all()
    hits = []
    for t in rows:
        if as_utc(t.created_at) < since:
            continue
        d = civic.haversine_m(lat, lng, t.lat, t.lng)
        if d <= civic.DUPLICATE_RADIUS_M:
            hits.append((t, d))
    return sorted(hits, key=lambda x: x[1])[:limit]


def merge_report(db: Session, t: Ticket, photo: Photo | None, severity: str, note: str) -> Ticket:
    t.report_count += 1
    if photo:
        photo.ticket_id = t.id
        photo.upload_token = ""
    msg = f"Another citizen reported this issue. {t.report_count} reports so far."
    if SEV_WEIGHT[severity] > SEV_WEIGHT[t.severity]:
        t.severity = severity
        new_due = civic.due_date(t.category, severity, as_utc(t.created_at))
        if new_due < as_utc(t.due_at):
            t.due_at = new_due
        msg += f" Severity raised to {severity}; deadline is now {fmt(t.due_at)}."
    add_event(db, t, "agent", "merged", msg)
    if note:
        add_event(db, t, "citizen", "note", f"Additional report note: {note}", public=False)
    return t


def fmt(dt) -> str:
    dt = as_utc(dt)
    # Display in IST
    return (dt + timedelta(hours=5, minutes=30)).strftime("%d %b %Y, %I:%M %p IST")


def run_escalations(db: Session) -> int:
    now = utcnow()
    changed = 0
    for t in db.scalars(select(Ticket).where(Ticket.status.in_(OPEN_STATUSES), Ticket.escalation_level < 2)).all():
        due = as_utc(t.due_at)
        sla = timedelta(days=CATEGORIES[t.category]["sla"][t.severity])
        level = 2 if now > due + sla else 1 if now > due else 0
        if level > t.escalation_level:
            t.escalation_level = level
            who = ESCALATION[level] + (f", {t.zone} Zone" if level == 1 else "")
            add_event(db, t, "agent", "escalated", f"Deadline missed. Escalated to the {who}.")
            changed += 1
    if changed:
        db.commit()
        log.info("escalated %d tickets", changed)
    return changed


def ticket_dict(t: Ticket, admin: bool = False) -> dict:
    now = utcnow()
    open_ = t.status in OPEN_STATUSES
    due = as_utc(t.due_at)
    d = {
        "code": t.code,
        "category": t.category,
        "category_label": CATEGORIES[t.category]["label"],
        "severity": t.severity,
        "status": t.status,
        "lat": t.lat, "lng": t.lng,
        "ward_no": t.ward_no, "ward_name": t.ward_name, "zone": t.zone,
        "landmark": t.landmark,
        "department": t.department,
        "report_count": t.report_count,
        "escalation_level": t.escalation_level,
        "escalated_to": (ESCALATION[t.escalation_level] + (f", {t.zone} Zone" if t.escalation_level == 1 else "")) if t.escalation_level else "",
        "due_at": due.isoformat(),
        "overdue": open_ and now > due,
        "created_at": as_utc(t.created_at).isoformat(),
        "resolved_at": as_utc(t.resolved_at).isoformat() if t.resolved_at else None,
        "fix_verified": t.fix_verified,
        "observation": t.ai_observation,
        "photo_id": next((p.id for p in t.photos if p.kind == "report"), None),
        "priority": civic.priority(t, now),
        "is_demo": t.is_demo,
    }
    return d


def ticket_detail(t: Ticket, admin: bool = False) -> dict:
    d = ticket_dict(t, admin)
    d["photos"] = [{"id": p.id, "kind": p.kind, "faces_blurred": p.faces_blurred} for p in t.photos]
    d["events"] = [{"at": as_utc(e.at).isoformat(), "actor": e.actor if admin else ("official" if "@" in e.actor else e.actor),
                    "kind": e.kind, "message": e.message} for e in t.events if admin or e.public]
    d["hazard"] = t.ai_hazard
    d["complaint_en"] = t.complaint_en
    d["complaint_local"] = t.complaint_local
    d["language"] = t.language
    if admin:
        d.update(contact=t.contact, citizen_note=t.citizen_note, ai_source=t.ai_source, ai_confidence=t.ai_confidence)
    return d
