import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { CircleMarker, GeoJSON, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { Link } from "react-router-dom";
import { ArrowUp, Camera, CheckCircle, Check, Copy, MapPin, Robot, ShieldCheck, User, Warning } from "@phosphor-icons/react";
import { copyText, fmtDate, STATUS_LABEL } from "./api.js";
import { isClosed } from "./ui.jsx";

export { CATEGORY_ICON, CategoryIcon, isClosed, SevPill, StatusPill, Thumb } from "./ui.jsx";

export const AMD_CENTER = [23.0225, 72.5714];
// Map pins can't read CSS variables, so the severity hexes live here; they match the --sev tokens.
export const PIN_HEX = { critical: "#D63B30", high: "#E08A12", medium: "#D4B21C", low: "#2F8F57", closed: "#8D939B" };


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
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      maxZoom={19}
    />
  );
}

export function WardLayer({ wards, highlight, counts, onWard }) {
  const dark = useDark();
  const max = counts ? Math.max(1, ...Object.values(counts)) : 1;
  const style = f => {
    const no = f.properties.no;
    const n = counts?.[no] || 0;
    const hi = no === highlight;
    return {
      color: hi ? "#E2560E" : dark ? "#6B7078" : "#8D939B",
      weight: hi ? 2.5 : 1,
      opacity: hi ? 1 : 0.7,
      dashArray: hi ? null : "2 5",
      fillColor: "#E2560E",
      fillOpacity: counts ? (n ? 0.06 + 0.34 * (n / max) : 0) : hi ? 0.1 : 0,
    };
  };
  if (!wards) return null;
  return (
    <GeoJSON
      key={`${highlight}-${dark}-${JSON.stringify(counts || {})}`}
      data={wards}
      style={style}
      onEachFeature={(f, layer) => {
        const p = f.properties;
        layer.bindTooltip(`Ward ${p.no} · ${p.name}${counts ? `<br>${counts[p.no] || 0} open` : `<br>${p.zone} Zone`}`, { sticky: true });
        if (onWard) layer.on("click", () => onWard(p));
      }}
    />
  );
}

const pinIcon = L.divIcon({
  className: "",
  html: `<svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true"><path d="M17 43C17 43 3 26.5 3 16a14 14 0 0 1 28 0c0 10.5-14 27-14 27z" fill="#E2560E" stroke="#FFF7F2" stroke-width="2"/><circle cx="17" cy="16" r="5.5" fill="#FFF7F2"/></svg>`,
  iconSize: [34, 44],
  iconAnchor: [17, 43],
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
      pathOptions={{ color: "#FCFCFD", weight: 2, fillOpacity: 0.95, fillColor: isClosed(t) ? PIN_HEX.closed : PIN_HEX[t.severity] }}>
      <Popup>
        <strong>{t.category_label}</strong><br />
        Ward {t.ward_no} {t.ward_name}{t.landmark ? `, ${t.landmark}` : ""}<br />
        <span className="code">{t.code}</span> · {STATUS_LABEL[t.status]}{t.report_count > 1 ? ` · ${t.report_count} reports` : ""}<br />
        <Link to={linkPrefix + t.code}>View complaint</Link>
      </Popup>
    </CircleMarker>
  ));
}

export function Legend() {
  return (
    <div className="legend" aria-hidden="true">
      {["critical", "high", "medium", "low"].map(s => <span key={s} style={{ textTransform: "capitalize" }}><i style={{ background: PIN_HEX[s] }} />{s}</span>)}
      <span><i style={{ background: PIN_HEX.closed }} />Closed</span>
    </div>
  );
}


const EVENT_ICON = { reported: Camera, classified: Robot, routed: MapPin, filed: Check, merged: User, escalated: Warning, resolved: CheckCircle, reopened: ArrowUp };
export function Timeline({ events }) {
  return (
    <ol className="timeline">
      {events.map((e, i) => {
        const I = EVENT_ICON[e.kind] || (e.actor === "citizen" ? User : ShieldCheck);
        const cls = e.kind === "escalated" ? "esc" : e.kind === "resolved" ? "ok" : e.actor === "agent" ? "agent" : e.actor === "citizen" ? "citizen" : "";
        const who = e.actor === "agent" ? "NagarNetra" : e.actor === "citizen" ? "Citizen" : e.actor === "system" || e.actor === "official" ? "AMC" : e.actor;
        return (
          <li key={i}>
            <span className={`ic ${cls}`}><I size={15} weight="bold" /></span>
            <div>
              <time>{fmtDate(e.at)} · {who}</time>
              <p>{e.message}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export const LANG_TITLE = { en: "English", gu: "ગુજરાતી", hi: "हिन्दी" };

export function ComplaintTabs({ en, local, lang }) {
  const tabs = [["en", en], ...(local ? [[lang, local]] : [])];
  const [cur, setCur] = useState(tabs[tabs.length - 1][0]);
  const [copied, setCopied] = useState(false);
  const text = tabs.find(t => t[0] === cur)?.[1] || en;
  if (!en) return null;
  return (
    <div>
      <div className="row between" style={{ alignItems: "flex-end" }}>
        <div className="tabs" role="tablist" style={{ flex: 1, marginBottom: 0 }}>
          {tabs.map(([k]) => <button key={k} role="tab" aria-selected={cur === k} onClick={() => setCur(k)}>{LANG_TITLE[k]}</button>)}
        </div>
        <button className="btn sm ghost" onClick={async () => { setCopied(await copyText(text)); setTimeout(() => setCopied(false), 1800); }}>
          {copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="letter" style={{ marginTop: 14 }} lang={cur}>{text}</div>
    </div>
  );
}

export function useInterval(fn, ms) {
  useEffect(() => { const id = setInterval(fn, ms); return () => clearInterval(id); }, [fn, ms]);
}

export function Stepper({ status }) {
  const order = ["new", "assigned", "in_progress", "resolved"];
  const idx = status === "rejected" ? -1 : order.indexOf(status);
  return (
    <div className="stepper" aria-label="Progress">
      {["Reported", "Assigned", "Work started", "Fixed"].map((l, i) => <div key={l} className={i <= idx ? "on" : ""}>{l}</div>)}
    </div>
  );
}

export function useCategoryMap(config) {
  return useMemo(() => Object.fromEntries((config?.categories || []).map(c => [c.id, c])), [config]);
}

