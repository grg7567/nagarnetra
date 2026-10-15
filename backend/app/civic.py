"""AMC-specific reference data: categories, departments, deadlines, wards and complaint templates."""
import json
import math
import re
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

CATEGORIES = {
    "pothole":     {"label": "Pothole / damaged road", "dept": "Engineering Dept. (Roads)",  "sla": {"critical": 2, "high": 4, "medium": 7, "low": 14}},
    "streetlight": {"label": "Streetlight not working", "dept": "Light Dept.",               "sla": {"critical": 1, "high": 2, "medium": 3, "low": 5}},
    "garbage":     {"label": "Garbage / waste dumping", "dept": "Solid Waste Management Dept.", "sla": {"critical": 1, "high": 1, "medium": 2, "low": 3}},
    "water_leak":  {"label": "Water pipeline leak",     "dept": "Water Supply Dept.",        "sla": {"critical": 1, "high": 2, "medium": 3, "low": 5}},
    "drainage":    {"label": "Drain overflow / open manhole", "dept": "Drainage Dept.",      "sla": {"critical": 1, "high": 2, "medium": 3, "low": 5}},
    "fallen_tree": {"label": "Fallen tree / branch",    "dept": "Garden Dept.",              "sla": {"critical": 1, "high": 1, "medium": 2, "low": 4}},
    "other":       {"label": "Other civic issue",       "dept": "Ward Office",               "sla": {"critical": 2, "high": 3, "medium": 5, "low": 10}},
}
SEVERITIES = ["low", "medium", "high", "critical"]
SEV_WEIGHT = {"low": 1, "medium": 2, "high": 3, "critical": 4}
STATUSES = ["new", "assigned", "in_progress", "resolved", "rejected"]
OPEN_STATUSES = ("new", "assigned", "in_progress")
LANGUAGES = {"en": "English", "gu": "Gujarati", "hi": "Hindi"}
ESCALATION = {
    0: "Ward Office",
    1: "Zonal Deputy Commissioner",
    2: "Deputy Municipal Commissioner",
}
DUPLICATE_RADIUS_M = 50
DUPLICATE_WINDOW_DAYS = 30

DATA = Path(__file__).resolve().parent / "data"


@lru_cache
def ward_index():
    fc = json.load(open(DATA / "wards.geojson", encoding="utf8"))
    geoms = [shape(f["geometry"]) for f in fc["features"]]
    props = [f["properties"] for f in fc["features"]]
    return fc, geoms, props, STRtree(geoms)


def wards_geojson() -> dict:
    return ward_index()[0]


def find_ward(lat: float, lng: float) -> dict | None:
    """Return {no, name, zone} for the AMC ward containing the point, or the nearest ward within ~300 m."""
    _, geoms, props, tree = ward_index()
    p = Point(lng, lat)
    hits = [i for i in tree.query(p) if geoms[i].contains(p)]
    if hits:
        # Source polygons overlap slightly in places; prefer the smallest containing ward.
        return props[min(hits, key=lambda i: geoms[i].area)]
    i = tree.nearest(p)
    if geoms[i].distance(p) < 0.003:  # roughly 300 m
        return props[i]
    return None


def bounds() -> list[float]:
    _, geoms, _, _ = ward_index()
    xs = [g.bounds for g in geoms]
    return [min(b[1] for b in xs), min(b[0] for b in xs), max(b[3] for b in xs), max(b[2] for b in xs)]


def haversine_m(lat1, lng1, lat2, lng2) -> float:
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def due_date(category: str, severity: str, start: datetime) -> datetime:
    return start + timedelta(days=CATEGORIES[category]["sla"][severity])


def priority(t, now: datetime) -> int:
    if t.status not in OPEN_STATUSES:
        return 0
    due = t.due_at if t.due_at.tzinfo else t.due_at.replace(tzinfo=now.tzinfo)
    overdue_days = max(0.0, (now - due).total_seconds() / 86400)
    return int(SEV_WEIGHT[t.severity] * 25 + min(t.report_count, 10) * 5 + min(overdue_days, 10) * 5 + t.escalation_level * 10)


# ---------- complaint templates (used when AI is off, or after a citizen changes the category) ----------
CAT_GU = {
    "pothole": "રસ્તા પર ખાડો / તૂટેલો રસ્તો",
    "streetlight": "બંધ સ્ટ્રીટલાઇટ",
    "garbage": "કચરાનો ઢગલો",
    "water_leak": "પાણીની પાઇપલાઇનમાં લીકેજ",
    "drainage": "ગટર ઊભરાવાની / ખુલ્લા મેનહોલની સમસ્યા",
    "fallen_tree": "પડી ગયેલું વૃક્ષ / ડાળી",
    "other": "નાગરિક સમસ્યા",
}
CAT_HI = {
    "pothole": "सड़क पर गड्ढा / टूटी सड़क",
    "streetlight": "बंद स्ट्रीटलाइट",
    "garbage": "कचरे का ढेर",
    "water_leak": "पानी की पाइपलाइन में रिसाव",
    "drainage": "गटर ओवरफ्लो / खुला मैनहोल",
    "fallen_tree": "गिरा हुआ पेड़ / डाली",
    "other": "नागरिक समस्या",
}
SEV_GU = {"low": "ઓછી", "medium": "મધ્યમ", "high": "ઊંચી", "critical": "અતિ ગંભીર"}
SEV_HI = {"low": "कम", "medium": "मध्यम", "high": "ऊँची", "critical": "अति गंभीर"}


_NEAR = re.compile(r"^(near|nr\.?)\s+", re.I)
_RELATIVE = re.compile(r"^(opp\.?|opposite|behind|beside|next to|in front of|outside|inside|at)\b", re.I)


def place_phrase(landmark: str) -> tuple[str, bool]:
    """Return (landmark without a leading 'near', whether 'near' should be added)."""
    lm = _NEAR.sub("", landmark.strip())
    return lm, bool(lm) and not _RELATIVE.match(lm)


def template_complaint(category: str, severity: str, ward: dict, landmark: str, note: str,
                       observation: str, lang: str, code: str = "") -> tuple[str, str]:
    c = CATEGORIES[category]
    landmark, add_near = place_phrase(landmark)
    where = f"Ward {ward['no']} ({ward['name']}, {ward['zone']} Zone)" + (f", {'near ' if add_near else ''}{landmark}" if landmark else "")
    lines = [
        f"To: {c['dept']}, Ahmedabad Municipal Corporation",
        f"Subject: Complaint regarding {c['label'].lower()} in {where}",
        "",
        f"This is to bring to your notice a {c['label'].lower()} in {where}.",
    ]
    if observation:
        lines.append(observation.strip())
    if note:
        lines.append(f"Citizen's note: {note.strip()}")
    lines += [
        f"The issue has been assessed as {severity} severity. Kindly take action at the earliest.",
        "",
        f"Complaint no.: {code or '(assigned on filing)'}",
        "Submitted via NagarNetra.",
    ]
    en = "\n".join(lines)
    local = ""
    near_gu = (f", {landmark} પાસે" if add_near else f", {landmark}") if landmark else ""
    near_hi = (f", {landmark} के पास" if add_near else f", {landmark}") if landmark else ""
    if lang == "gu":
        local = "\n".join([
            f"પ્રતિ: {c['dept']}, અમદાવાદ મ્યુનિસિપલ કોર્પોરેશન",
            f"વિષય: વોર્ડ {ward['no']} ({ward['name']}){near_gu} માં {CAT_GU[category]} અંગે ફરિયાદ",
            "",
            f"આપના ધ્યાન પર લાવવાનું કે વોર્ડ {ward['no']} ({ward['name']}){near_gu} માં {CAT_GU[category]} છે.",
            *( [f"નાગરિકની નોંધ: {note.strip()}"] if note else [] ),
            f"આ સમસ્યાની ગંભીરતા {SEV_GU[severity]} છે અને તેનાથી નાગરિકોની સલામતી તથા સુવિધા પર અસર થાય છે. કૃપા કરીને વહેલી તકે યોગ્ય કાર્યવાહી કરશો.",
            "",
            f"ફરિયાદ નંબર: {code or '(નોંધણી વખતે આપવામાં આવશે)'}",
            "NagarNetra દ્વારા મોકલેલ.",
        ])
    elif lang == "hi":
        local = "\n".join([
            f"सेवा में: {c['dept']}, अहमदाबाद नगर निगम",
            f"विषय: वार्ड {ward['no']} ({ward['name']}){near_hi} में {CAT_HI[category]} के संबंध में शिकायत",
            "",
            f"आपके ध्यान में लाना है कि वार्ड {ward['no']} ({ward['name']}){near_hi} में {CAT_HI[category]} है।",
            *( [f"नागरिक की टिप्पणी: {note.strip()}"] if note else [] ),
            f"इस समस्या की गंभीरता {SEV_HI[severity]} है और इससे नागरिकों की सुरक्षा व सुविधा प्रभावित होती है। कृपया जल्द से जल्द उचित कार्रवाई करें।",
            "",
            f"शिकायत संख्या: {code or '(दर्ज होने पर दी जाएगी)'}",
            "NagarNetra द्वारा भेजा गया।",
        ])
    return en, local
