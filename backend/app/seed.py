import logging
from datetime import timedelta

from shapely.geometry import shape
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import civic, service
from .auth import hash_pw
from .config import settings
from .db import Ticket, User, utcnow

log = logging.getLogger("nagarnetra")


def ensure_admin(db: Session) -> None:
    if db.scalar(select(func.count(User.id))):
        return
    db.add(User(email=settings.admin_email, name="Administrator", password_hash=hash_pw(settings.admin_password), role="admin"))
    db.commit()
    log.info("Created admin account %s%s.", settings.admin_email, " with the demo password" if settings.demo_login else "")


# (ward no, landmark, category, severity, days ago, status, report count, observation)
DEMO = [
    (1, "Gota Cross Road", "pothole", "critical", 3, "assigned", 4, "Deep pothole across the left lane of the service road, filled with water."),
    (18, "CG Road, near Municipal Market", "streetlight", "high", 1, "new", 2, "Three consecutive streetlights are off along the footpath."),
    (37, "Maninagar Railway Station east gate", "garbage", "medium", 1, "in_progress", 3, "Overflowing garbage spilling from the community bin onto the road."),
    (24, "Nikol Gam Road", "water_leak", "high", 1, "assigned", 1, "Burst water line spraying onto the road beside a society gate."),
    (41, "Vastral Gam", "drainage", "critical", 2, "new", 5, "Sewer overflowing from an open manhole in the middle of the road."),
    (45, "Isanpur Cross Road", "pothole", "medium", 6, "resolved", 2, "Cluster of shallow potholes near the bus stop."),
    (33, "Sarkhej Roza Road", "garbage", "high", 0, "new", 1, "Construction debris and household waste dumped on a vacant plot."),
    (12, "Naroda Patiya", "streetlight", "medium", 2, "in_progress", 1, "Streetlight flickering and switching off at night."),
    (3, "ONGC Circle, Chandkheda", "fallen_tree", "high", 0, "new", 2, "Large branch fallen across half the carriageway after strong wind."),
    (26, "Bapunagar Cross Road", "drainage", "medium", 1, "assigned", 1, "Storm drain blocked; water pooling at the junction."),
    (30, "Paldi Cross Road", "pothole", "low", 9, "resolved", 1, "Small pothole near the median opening."),
    (19, "Judges Bungalow Road", "streetlight", "low", 2, "new", 1, "One streetlight off near the park entrance."),
    (29, "Jamalpur Darwaja", "garbage", "critical", 2, "new", 6, "Very large garbage heap blocking the footpath next to the vegetable market."),
    (40, "Odhav GIDC Road", "water_leak", "medium", 2, "in_progress", 1, "Slow leak from a valve chamber, road surface softening."),
]


def seed_demo(db: Session) -> None:
    if db.scalar(select(func.count(Ticket.id))):
        return
    fc = civic.wards_geojson()
    by_no = {f["properties"]["no"]: f for f in fc["features"]}
    now = utcnow()
    for i, (no, landmark, cat, sev, ago, status, reports, obs) in enumerate(DEMO):
        f = by_no[no]
        pt = shape(f["geometry"]).representative_point()
        ward = f["properties"]
        created = now - timedelta(days=ago, hours=3 + i)
        t = Ticket(code=f"TMP-{i}", category=cat, severity=sev, status=status, lat=round(pt.y, 6), lng=round(pt.x, 6),
                   ward_no=no, ward_name=ward["name"], zone=ward["zone"], department=civic.CATEGORIES[cat]["dept"],
                   landmark=landmark, language="gu", report_count=reports, ai_source="demo", ai_confidence=0.9,
                   ai_observation=obs, ai_hazard="", due_at=civic.due_date(cat, sev, created), created_at=created, is_demo=True)
        db.add(t)
        db.flush()
        t.code = f"AMD-{t.id + 10000}"
        t.complaint_en, t.complaint_local = civic.template_complaint(cat, sev, ward, landmark, "", obs, "gu", t.code)
        service.add_event(db, t, "citizen", "reported", "Report received with photo and location.")
        service.add_event(db, t, "agent", "routed", f"Routed to {t.department}, Ward {no} {ward['name']} ({ward['zone']} Zone).")
        if reports > 1:
            service.add_event(db, t, "agent", "merged", f"{reports} citizens reported this issue.")
        if status in ("assigned", "in_progress", "resolved"):
            service.add_event(db, t, "system", "assigned", "Assigned to a field team.")
        if status in ("in_progress", "resolved"):
            service.add_event(db, t, "system", "in_progress", "Work started on site.")
        if status == "resolved":
            t.resolved_at = created + timedelta(days=max(1, ago - 2))
            service.add_event(db, t, "system", "resolved", "Marked fixed with an 'after' photo.")
    db.commit()
    service.run_escalations(db)
    log.info("Seeded %d demo complaints.", len(DEMO))
