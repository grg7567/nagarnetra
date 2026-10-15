import { useEffect, useState } from "react";
import { MapContainer } from "react-leaflet";
import { useNavigate, useParams } from "react-router-dom";
import { api, fmtDate, fmtDay } from "../api.js";
import { ComplaintBox, LANG_TITLE, SevPill, StatusPill, Stepper, Tiles, TicketMarkers, Timeline } from "../components.jsx";

export default function Track() {
  const { code } = useParams();
  const nav = useNavigate();
  const [input, setInput] = useState(code || "");
  const [t, setT] = useState(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setT(null); setError("");
    if (!code) return;
    setInput(code);
    api.get(`/api/tickets/${encodeURIComponent(code)}`).then(setT).catch(e => setError(e.message));
  }, [code]);

  async function reopen() {
    setBusy(true); setError("");
    try { setT(await api.post(`/api/tickets/${t.code}/reopen`, { reason })); setReason(""); }
    catch (e) { setError(e.message); }
    setBusy(false);
  }

  return (
    <div className="wrap narrow stack">
      <h1>Track a complaint</h1>
      <form className="row" onSubmit={e => { e.preventDefault(); if (input.trim()) nav(`/track/${input.trim().toUpperCase()}`); }}>
        <input aria-label="Complaint number" value={input} onChange={e => setInput(e.target.value)} placeholder="AMD-10023" style={{ maxWidth: 260 }} />
        <button className="btn teal" type="submit">Find</button>
      </form>
      {error && <p className="error">{error}</p>}
      {code && !t && !error && <p className="muted">Loading…</p>}
      {t && (
        <>
          <section className="panel stack" style={{ gap: 14 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="code">{t.code}</span>
              <span className="row" style={{ gap: 6 }}><SevPill s={t.severity} /><StatusPill t={t} />{t.is_demo && <span className="pill demo">Demo data</span>}</span>
            </div>
            <h2>{t.category_label}</h2>
            <p className="muted">Ward {t.ward_no} · {t.ward_name} ({t.zone} Zone){t.landmark ? ` · ${t.landmark}` : ""}</p>
            <Stepper status={t.status} />
            {t.status === "rejected" && <p className="notice">This complaint was rejected. See the reason in the timeline below.</p>}
            <dl className="kv">
              <dt>Department</dt><dd>{t.department}, AMC</dd>
              <dt>Reported</dt><dd>{fmtDate(t.created_at)}</dd>
              <dt>Deadline</dt><dd>{fmtDay(t.due_at)}{t.overdue && <strong style={{ color: "var(--red)" }}> · overdue</strong>}</dd>
              {t.escalated_to && <><dt>Escalated to</dt><dd>{t.escalated_to}</dd></>}
              <dt>Reports</dt><dd>{t.report_count} citizen{t.report_count > 1 ? "s" : ""}</dd>
              {t.resolved_at && <><dt>Fixed</dt><dd>{fmtDate(t.resolved_at)}{t.fix_verified === "ai_yes" ? " · repair photo checked by AI" : ""}</dd></>}
            </dl>
            {t.photos.length > 0 && (
              <div className="photos">
                {t.photos.map(p => (
                  <figure key={p.id}>
                    <a href={`/api/photos/${p.id}`} target="_blank" rel="noreferrer"><img src={`/api/photos/${p.id}?size=480`} alt={p.kind === "after" ? "After repair" : "Reported problem"} loading="lazy" /></a>
                    <figcaption>{p.kind === "after" ? "After repair" : "Reported"}</figcaption>
                  </figure>
                ))}
              </div>
            )}
            <MapContainer className="map" center={[t.lat, t.lng]} zoom={16} scrollWheelZoom={false} style={{ height: 220 }}>
              <Tiles />
              <TicketMarkers tickets={[t]} />
            </MapContainer>
          </section>

          {t.status === "resolved" && (
            <section className="panel stack" style={{ gap: 10 }}>
              <h2>Not actually fixed?</h2>
              <p className="muted">Reopen it within 14 days and it goes back to the department with a 2-day deadline.</p>
              <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="What is still wrong?" maxLength={500} />
              <div><button className="btn danger" disabled={reason.trim().length < 3 || busy} onClick={reopen}>Reopen complaint</button></div>
            </section>
          )}

          <section className="panel">
            <h2 style={{ marginBottom: 12 }}>What happened</h2>
            <Timeline events={t.events} />
          </section>

          <section className="panel stack" style={{ gap: 14 }}>
            <h2>Complaint text</h2>
            <ComplaintBox title="English" text={t.complaint_en} />
            {t.complaint_local && <ComplaintBox title={LANG_TITLE[t.language]} text={t.complaint_local} />}
          </section>
        </>
      )}
    </div>
  );
}
