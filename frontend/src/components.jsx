import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { CircleMarker, GeoJSON, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { Link } from "react-router-dom";
import { copyText, fmtDate, STATUS_LABEL } from "./api.js";

export const AMD_CENTER = [23.0225, 72.5714];
const PIN_HEX = { critical: "#D9483B", high: "#E07B1F", medium: "#F2A900", low: "#1F8A70" };

function useDark() {
  const q = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const [dark, setDark] = useState(!!q?.matches);
  useEffect(() => {
    if (!q) return;
    const f = e => setDark(e.matches);
    q.addEventListener("change", f);
    return () => q.removeEventListener("change", f);
  }, [q]);
  return dark;
}

export function Tiles() {
  const dark = useDark();
  return (
    <TileLayer
      className={dark ? "tiles-dark" : ""}
      url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      maxZoom={19}
    />
  );
}

export function WardLayer({ wards, highlight, counts, onWard }) {
  const max = counts ? Math.max(1, ...Object.values(counts)) : 1;
  const style = f => {
    const no = f.properties.no;
    const n = counts?.[no] || 0;
    return {
      color: no === highlight ? "#F2A900" : "#8A8F96",
      weight: no === highlight ? 3 : 1,
      dashArray: no === highlight ? null : "3 4",
      fillColor: "#F2A900",
      fillOpacity: counts ? (n ? 0.08 + 0.42 * (n / max) : 0) : no === highlight ? 0.12 : 0,
    };
  };
  if (!wards) return null;
  return (
    <GeoJSON
      key={`${highlight}-${JSON.stringify(counts || {})}`}
      data={wards}
      style={style}
      onEachFeature={(f, layer) => {
        const p = f.properties;
        layer.bindTooltip(`Ward ${p.no} · ${p.name}<br>${p.zone} Zone${counts ? `<br>${counts[p.no] || 0} open` : ""}`, { sticky: true });
        if (onWard) layer.on("click", () => onWard(p));
      }}
    />
  );
}

const pinIcon = L.divIcon({
  className: "",
  html: `<svg class="pin-icon" viewBox="0 0 30 40"><path d="M15 39 C15 39 2 23 2 14 a13 13 0 0 1 26 0 c0 9 -13 25 -13 25z" fill="#1F2328" stroke="#F2A900" stroke-width="2"/><circle cx="15" cy="14" r="5" fill="#F2A900"/></svg>`,
  iconSize: [30, 40],
  iconAnchor: [15, 39],
});

function ClickToSet({ onPick }) {
  useMapEvents({ click: e => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}
function FlyTo({ pos, zoom = 17 }) {
  const map = useMap();
  useEffect(() => { if (pos) map.flyTo(pos, Math.max(map.getZoom(), zoom), { duration: 0.6 }); }, [pos?.[0], pos?.[1]]);
  return null;
}

export function PinPicker({ wards, value, onChange, highlight }) {
  const pos = value ? [value.lat, value.lng] : null;
  return (
    <MapContainer className="map" center={pos || AMD_CENTER} zoom={pos ? 17 : 12} scrollWheelZoom={false}>
      <Tiles />
      <WardLayer wards={wards} highlight={highlight} />
      <ClickToSet onPick={(lat, lng) => onChange({ lat, lng, source: "map" })} />
      {pos && (
        <Marker position={pos} icon={pinIcon} draggable eventHandlers={{
          dragend: e => { const p = e.target.getLatLng(); onChange({ lat: p.lat, lng: p.lng, source: "map" }); },
        }} />
      )}
      <FlyTo pos={value?.source === "device" || value?.source === "photo" ? pos : null} />
    </MapContainer>
  );
}

export function TicketMarkers({ tickets, linkPrefix = "/track/" }) {
  return tickets.map(t => (
    <CircleMarker key={t.code} center={[t.lat, t.lng]} radius={t.report_count > 1 ? 9 : 7}
      pathOptions={{ color: "#fff", weight: 1.5, fillOpacity: 0.95, fillColor: ["resolved", "rejected"].includes(t.status) ? "#8A8F96" : PIN_HEX[t.severity] }}>
      <Popup>
        <strong>{t.category_label}</strong><br />
        <span className="code">{t.code}</span> · {STATUS_LABEL[t.status]}<br />
        Ward {t.ward_no} {t.ward_name}{t.landmark ? ` · ${t.landmark}` : ""}<br />
        {t.report_count > 1 && <>{t.report_count} reports<br /></>}
        <Link to={linkPrefix + t.code}>Open</Link>
      </Popup>
    </CircleMarker>
  ));
}

export function Legend() {
  return (
    <div className="legend" aria-hidden="true">
      <span><i style={{ background: PIN_HEX.critical }} />Critical</span>
      <span><i style={{ background: PIN_HEX.high }} />High</span>
      <span><i style={{ background: PIN_HEX.medium }} />Medium</span>
      <span><i style={{ background: PIN_HEX.low }} />Low</span>
      <span><i style={{ background: "#8A8F96" }} />Fixed</span>
    </div>
  );
}

export function SevPill({ s }) { return <span className={`pill sev-${s}`}>{s}</span>; }
export function StatusPill({ t }) {
  if (t.escalation_level && !["resolved", "rejected"].includes(t.status)) return <span className="pill esc">Escalated</span>;
  return <span className={`pill st-${t.status}`}>{STATUS_LABEL[t.status]}</span>;
}

export function Timeline({ events }) {
  return (
    <ol className="timeline">
      {events.map((e, i) => (
        <li key={i}>
          <span className={`dot ${e.kind === "escalated" ? "esc" : e.kind === "resolved" ? "resolved" : e.actor === "agent" ? "agent" : e.actor === "citizen" ? "citizen" : ""}`} />
          <div>
            <time>{fmtDate(e.at)} · {e.actor === "agent" ? "NagarNetra agent" : e.actor === "citizen" ? "Citizen" : e.actor === "system" ? "AMC" : e.actor === "official" ? "AMC official" : e.actor}</time>
            <p>{e.message}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ComplaintBox({ title, text }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <div>
      <div className="complaint-h">
        <span className="eyebrow">{title}</span>
        <button className="btn sm" onClick={async () => { setCopied(await copyText(text)); setTimeout(() => setCopied(false), 1800); }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="complaint" lang={title.includes("Gujarati") ? "gu" : title.includes("Hindi") ? "hi" : "en"}>{text}</div>
    </div>
  );
}

export function useInterval(fn, ms) {
  useEffect(() => { const id = setInterval(fn, ms); return () => clearInterval(id); }, [fn, ms]);
}

export function Stepper({ status }) {
  const order = ["new", "assigned", "in_progress", "resolved"];
  const idx = status === "rejected" ? -1 : order.indexOf(status);
  const labels = ["Reported", "Assigned", "Work started", "Fixed"];
  return (
    <div className="stepper" aria-label="Progress">
      {labels.map((l, i) => <div key={l} className={i <= idx ? "on" : ""}>{l}</div>)}
    </div>
  );
}

export const LANG_TITLE = { en: "English", gu: "Gujarati (ગુજરાતી)", hi: "Hindi (हिन्दी)" };
export function useCategoryMap(config) {
  return useMemo(() => Object.fromEntries((config?.categories || []).map(c => [c.id, c])), [config]);
}
