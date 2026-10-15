import { useEffect, useMemo, useState } from "react";
import { MapContainer } from "react-leaflet";
import { useApp } from "../App.jsx";
import { api } from "../api.js";
import { AMD_CENTER, Legend, Tiles, TicketMarkers, WardLayer } from "../components.jsx";

export default function CityMap() {
  const { config, wards, user } = useApp();
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState("");
  const [cat, setCat] = useState("");
  const [show, setShow] = useState("open");

  useEffect(() => { api.get("/api/public/tickets").then(setTickets).catch(e => setError(e.message)); }, []);

  const list = useMemo(() => (tickets || []).filter(t =>
    (!cat || t.category === cat) &&
    (show === "all" || (show === "open" ? !["resolved", "rejected"].includes(t.status) : t.status === "resolved"))
  ), [tickets, cat, show]);
  const open = (tickets || []).filter(t => !["resolved", "rejected"].includes(t.status)).length;
  const fixed = (tickets || []).filter(t => t.status === "resolved").length;

  return (
    <div className="wrap stack">
      <div className="panel-h" style={{ marginBottom: 0 }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1>Ahmedabad civic issues map</h1>
          <p className="muted">Every complaint filed through NagarNetra in the last 60 days, across all 48 AMC wards.</p>
        </div>
        {tickets && <p className="muted"><strong style={{ color: "var(--ink)" }}>{open}</strong> open · <strong style={{ color: "var(--ink)" }}>{fixed}</strong> fixed</p>}
      </div>
      <div className="row">
        <select aria-label="Issue type" value={cat} onChange={e => setCat(e.target.value)} style={{ maxWidth: 260 }}>
          <option value="">All issue types</option>
          {config?.categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <div className="chips" role="group" aria-label="Status">
          {[["open", "Open"], ["fixed", "Fixed"], ["all", "All"]].map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div>
        <MapContainer className="map tall" center={AMD_CENTER} zoom={12}>
          <Tiles />
          <WardLayer wards={wards} />
          <TicketMarkers tickets={list} linkPrefix={user ? "/admin/t/" : "/track/"} />
        </MapContainer>
        <Legend />
      </div>
    </div>
  );
}
