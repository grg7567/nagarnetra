import { useEffect, useState } from "react";
import { MapContainer } from "react-leaflet";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowCounterClockwise, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { api, fmtDate, fmtDay } from "../api.js";
import { CategoryIcon, ComplaintTabs, SevPill, StatusPill, Stepper, Tiles, TicketMarkers, Timeline } from "../components.jsx";

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
    <div className="wrap stack" style={{ gap: 24, maxWidth: 1080 }}>
      <div className="stack" style={{ gap: 14 }}>
        <h1>Track a complaint</h1>
        <form className="row" onSubmit={e => { e.preventDefault(); if (input.trim()) nav(`/track/${input.trim().toUpperCase()}`); }}>
          <label className="sr-only" htmlFor="code">Complaint number</label>
          <input id="code" value={input} onChange={e => setInput(e.target.value)} placeholder="Complaint number, e.g. AMD-10023" style={{ maxWidth: 340 }} />
          <button className="btn dark" type="submit"><MagnifyingGlass size={18} />Find</button>
        </form>
      </div>
      {error && <p className="msg error"><WarningCircle size={18} weight="fill" /><span>{error}</span></p>}
      {code && !t && !error && <div className="skeleton"><i style={{ width: "40%" }} /><i style={{ width: "70%" }} /><i style={{ width: "55%" }} /></div>}
      {t && (
        <div className="split">
          <div className="stack" style={{ gap: 20 }}>
            <section className="card stack" style={{ gap: 18 }}>
              <div className="row between">
                <span className="row" style={{ gap: 8 }}><span className="code muted">{t.code}</span>{t.is_demo && <span className="pill outline">Demo data</span>}</span>
                <span className="row" style={{ gap: 6 }}><SevPill s={t.severity} /><StatusPill t={t} /></span>
              </div>
              <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
                <CategoryIcon id={t.category} size={30} style={{ color: "var(--accent-ink)", flex: "none", marginTop: 2 }} />
                <div className="stack-sm" style={{ gap: 4 }}>
                  <h2>{t.category_label}</h2>
                  <p className="muted">Ward {t.ward_no} {t.ward_name}, {t.zone} Zone{t.landmark ? `. ${t.landmark}` : ""}</p>
                </div>
              </div>
              <Stepper status={t.status} />
              {t.status === "rejected" && <p className="msg info">This complaint was closed without action. The reason is in the timeline.</p>}
              <dl className="facts">
                <div><dt>Department</dt><dd>{t.department}</dd></div>
                <div><dt>Reported</dt><dd>{fmtDate(t.created_at)}</dd></div>
                <div><dt>Deadline</dt><dd style={{ color: t.overdue ? "var(--sev-critical)" : undefined }}>{fmtDay(t.due_at)}{t.overdue ? ", overdue" : ""}</dd></div>
                <div><dt>Reports</dt><dd>{t.report_count} citizen{t.report_count > 1 ? "s" : ""}</dd></div>
                {t.escalated_to && <div><dt>Escalated to</dt><dd>{t.escalated_to}</dd></div>}
                {t.resolved_at && <div><dt>Fixed</dt><dd>{fmtDate(t.resolved_at)}{t.fix_verified === "ai_yes" ? ", repair photo verified" : ""}</dd></div>}
              </dl>
              {t.photos.length > 0 && (
                <div className="photos">
                  {t.photos.map(p => (
                    <figure key={p.id}>
                      <a href={`/api/photos/${p.id}`} target="_blank" rel="noreferrer"><img src={`/api/photos/${p.id}?size=520`} alt={p.kind === "after" ? "After repair" : "Reported problem"} loading="lazy" /></a>
                      <figcaption>{p.kind === "after" ? "After repair" : "Reported"}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </section>
            <section className="card stack" style={{ gap: 4 }}>
              <h3>Complaint letter</h3>
              <ComplaintTabs en={t.complaint_en} local={t.complaint_local} lang={t.language} />
            </section>
          </div>

          <div className="stack sticky" style={{ gap: 20 }}>
            <MapContainer className="map sm" center={[t.lat, t.lng]} zoom={16} scrollWheelZoom={false}>
              <Tiles /><TicketMarkers tickets={[t]} />
            </MapContainer>
            <section className="card">
              <h3 style={{ marginBottom: 16 }}>Timeline</h3>
              <Timeline events={t.events} />
            </section>
            {t.status === "resolved" && (
              <section className="card stack" style={{ gap: 12 }}>
                <h3>Not actually fixed?</h3>
                <p className="muted small">Reopen it within 14 days. It goes back to the department with a 2-day deadline.</p>
                <label className="sr-only" htmlFor="reason">What is still wrong?</label>
                <textarea id="reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="What is still wrong?" maxLength={500} />
                <div><button className="btn danger" disabled={reason.trim().length < 3 || busy} onClick={reopen}><ArrowCounterClockwise size={17} />Reopen complaint</button></div>
              </section>
            )}
          </div>
        </div>
      )}
      {!code && (
        <div className="empty card">
          <MagnifyingGlass size={32} />
          <p>Enter the number you got when you filed, like AMD-10023.</p>
        </div>
      )}
    </div>
  );
}
