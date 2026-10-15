import { Drop, Lightbulb, Pipe, Question, RoadHorizon, Trash, Tree } from "@phosphor-icons/react";
import { STATUS_LABEL } from "./api.js";

// Light UI pieces with no map dependency, so the landing page doesn't load Leaflet.
export const CATEGORY_ICON = {
  pothole: RoadHorizon, streetlight: Lightbulb, garbage: Trash, water_leak: Drop, drainage: Pipe, fallen_tree: Tree, other: Question,
};
export function CategoryIcon({ id, size = 22, ...rest }) {
  const I = CATEGORY_ICON[id] || Question;
  return <I size={size} weight="duotone" {...rest} />;
}
export const isClosed = t => ["resolved", "rejected"].includes(t.status);
export function SevPill({ s }) { return <span className={`pill sev-${s}`}>{s}</span>; }
export function StatusPill({ t }) {
  if (t.escalation_level && !isClosed(t)) return <span className="pill st-esc">Escalated</span>;
  return <span className={`pill st-${t.status}`}>{STATUS_LABEL[t.status]}</span>;
}
export function Thumb({ t, size = 480 }) {
  return t.photo_id
    ? <img src={`/api/photos/${t.photo_id}?size=${size}`} alt="" loading="lazy" />
    : <CategoryIcon id={t.category} size={34} />;
}
