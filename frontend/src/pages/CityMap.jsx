import { useEffect, useMemo, useState } from "react";
import { MapContainer } from "react-leaflet";
import { useApp } from "../App.jsx";
import { api } from "../api.js";
import { AMD_CENTER, isClosed, Legend, Tiles, TicketMarkers, WardLayer } from "../components.jsx";

export default function CityMap() {
  const { config, wards, user } = useApp();
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState("");
  const [cat, setCat] = useState("");
  const [show, setShow] = useState("open");

  useEffect(() => { api.get("/api/public/tickets").then(setTickets).catch(e => setError(e.message)); }, []);

  const list = useMemo(() => (tickets || []).filter(t =>
    (!cat || t.category === cat) &&
    (show === "all" || (show === "open" ? !isClosed(t) : t.status === "resolved"))
  ), [tickets, cat, show]);
  const open = (tickets || []).filter(t => !isClosed(t)).length;
  const fixed = (tickets || []).filter(t => t.status === "resolved").length;

  return (
    <div className="fullmap">
      <MapContainer className="map" center={AMD_CENTER} zoom={12} zoomControl={false}>
        <Tiles />
        <WardLayer wards={wards} />
        <TicketMarkers tickets={list} linkPrefix={user ? "/admin/t/" : "/track/"} />
      </MapContainer>
      <div className="float-panel">
        <div className="stack-sm" style={{ gap: 4 }}>
          <h2 style={{ fontSize: 20 }}>Ahmedabad city map</h2>
          <p className="muted small">{tickets ? <><strong style={{ color: "var(--ink)" }}>{open}</strong> open, <strong style={{ color: "var(--ink)" }}>{fixed}</strong> fixed in the last 60 days</> : "Loading complaints…"}</p>
        </div>
        <div className="seg" role="group" aria-label="Status" style={{ justifySelf: "start" }}>
          {[["open", "Open"], ["fixed", "Fixed"], ["all", "All"]].map(([k, l]) => <button key={k} aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>)}
        </div>
        <label className="sr-only" htmlFor="cat">Issue type</label>
        <select id="cat" value={cat} onChange={e => setCat(e.target.value)} style={{ height: 40 }}>
          <option value="">All issue types</option>
          {config?.categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        {error && <p className="msg error">{error}</p>}
      </div>
      <div className="float-legend"><Legend /></div>
    </div>
  );
}
