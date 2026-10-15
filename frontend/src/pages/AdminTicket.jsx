import { useEffect, useState } from "react";
import { MapContainer } from "react-leaflet";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle, NavigationArrow, Sparkle, WarningCircle } from "@phosphor-icons/react";
import { useApp } from "../App.jsx";
import { api, fmtDate, fmtDay } from "../api.js";
import { CategoryIcon, ComplaintTabs, isClosed, SevPill, StatusPill, Stepper, Tiles, TicketMarkers, Timeline } from "../components.jsx";

export default function AdminTicket() {
  const { code } = useParams();
  const { config } = useApp();
  const [t, setT] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [notePublic, setNotePublic] = useState(true);
  const [after, setAfter] = useState(null);
  const [afterNote, setAfterNote] = useState("");
  const [verdict, setVerdict] = useState(null);
  const [cat, setCat] = useState(""), [sev, setSev] = useState("");

  useEffect(() => {
    api.get(`/api/admin/tickets/${code}`).then(x => { setT(x); setCat(x.category); setSev(x.severity); }).catch(e => setError(e.message));
  }, [code]);

  async function act(name, fn) {
    setBusy(name); setError(""); setMsg("");
    try { await fn(); } catch (e) { setError(e.message); }
    setBusy("");
  }
  const status = (s, n = "") => act(s, async () => { setT(await api.post(`/api/admin/tickets/${code}/status`, { status: s, note: n })); setReason(""); });
  const resolve = override => act("resolve", async () => {
    const form = new FormData();
    form.append("photo", after); form.append("note", afterNote); form.append("override", override ? "true" : "false");
    const r = await api.form(`/api/admin/tickets/${code}/resolve`, form);
    setT(r.ticket); setVerdict(r.verdict);
    if (r.resolved) { setAfter(null); setAfterNote(""); setMsg("Marked fixed. The citizen can now see the repair photo."); }
  });

  if (error && !t) return <div className="wrap"><p className="msg error">{error}</p></div>;
  if (!t) return <div className="wrap"><div className="skeleton"><i style={{ width: "30%" }} /><i style={{ width: "60%" }} /></div></div>;
  const open = !isClosed(t);
  const aiLabel = t.ai_source === "manual" ? "Classified by the citizen" : `AI analysis, ${Math.round((t.ai_confidence || 0) * 100)}% confidence`;

  return (
    <div className="wrap stack" style={{ gap: 20 }}>
      <Link to="/admin" className="btn sm ghost" style={{ justifySelf: "start" }}><ArrowLeft size={16} />Dashboard</Link>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
          <CategoryIcon id={t.category} size={32} style={{ color: "var(--accent-ink)", flex: "none", marginTop: 4 }} />
          <div className="stack-sm" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 8 }}><span className="code muted">{t.code}</span><SevPill s={t.severity} /><StatusPill t={t} />{t.is_demo && <span className="pill outline">Demo data</span>}</div>
            <h1 style={{ fontSize: 30 }}>{t.category_label}</h1>
            <p className="muted">Ward {t.ward_no} {t.ward_name}, {t.zone} Zone{t.landmark ? `. ${t.landmark}` : ""}</p>
          </div>
        </div>
        {open && <span className="prio-badge">Priority {t.priority}</span>}
      </div>
      {error && <p className="msg error"><WarningCircle size={18} weight="fill" /><span>{error}</span></p>}
      {msg && <p className="msg ok"><CheckCircle size={18} weight="fill" /><span>{msg}</span></p>}

      <div className="split">
        <div className="stack" style={{ gap: 20 }}>
          <section className="card stack" style={{ gap: 18 }}>
            <Stepper status={t.status} />
            <dl className="facts">
              <div><dt>Department</dt><dd>{t.department}</dd></div>
              <div><dt>Reported</dt><dd>{fmtDate(t.created_at)}</dd></div>
              <div><dt>Deadline</dt><dd style={{ color: t.overdue ? "var(--sev-critical)" : undefined }}>{fmtDay(t.due_at)}{t.overdue ? ", overdue" : ""}</dd></div>
              <div><dt>Reports</dt><dd>{t.report_count}</dd></div>
              {t.escalated_to && <div><dt>Escalated to</dt><dd>{t.escalated_to}</dd></div>}
              <div><dt>Citizen contact</dt><dd>{t.contact || <span className="muted">Not given</span>}</dd></div>
              {t.citizen_note && <div style={{ gridColumn: "1 / -1" }}><dt>Citizen note</dt><dd>{t.citizen_note}</dd></div>}
            </dl>
            {(t.observation || t.hazard) && (
              <div className="ai-result">
                <span className="head"><Sparkle size={16} weight="fill" />{aiLabel}</span>
                {t.observation && <p>{t.observation}</p>}
                {t.hazard && <p className="muted small">{t.hazard}</p>}
              </div>
            )}
            {t.photos.length > 0 && (
              <div className="photos">
                {t.photos.map(p => (
                  <figure key={p.id}>
                    <a href={`/api/photos/${p.id}`} target="_blank" rel="noreferrer"><img src={`/api/photos/${p.id}?size=520`} alt={p.kind === "after" ? "After repair" : "Reported problem"} /></a>
                    <figcaption>{p.kind === "after" ? "After repair" : "Citizen photo"}{p.faces_blurred ? `, ${p.faces_blurred} face(s) blurred` : ""}</figcaption>
                  </figure>
                ))}
              </div>
            )}
            <MapContainer className="map sm" center={[t.lat, t.lng]} zoom={17}>
              <Tiles /><TicketMarkers tickets={[t]} linkPrefix="/admin/t/" />
            </MapContainer>
            <a className="btn sm" style={{ justifySelf: "start" }} href={`https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lng}`} target="_blank" rel="noreferrer"><NavigationArrow size={16} />Directions for the field team</a>
          </section>
          <section className="card stack" style={{ gap: 4 }}>
            <h3>Complaint letter</h3>
            <ComplaintTabs en={t.complaint_en} local={t.complaint_local} lang={t.language} />
          </section>
        </div>

        <div className="stack sticky" style={{ gap: 20 }}>
          <section className="card">
            {open && (
              <div className="action-group">
                <h3>Update status</h3>
                <div className="row">
                  {t.status === "new" && <button className="btn" disabled={!!busy} onClick={() => status("assigned")}>Assign to field team</button>}
                  {t.status !== "in_progress" && <button className="btn" disabled={!!busy} onClick={() => status("in_progress")}>Work started</button>}
                </div>
              </div>
            )}
            {open && (
              <div className="action-group">
                <h3>Mark as fixed</h3>
                <p className="muted small">Upload a photo of the repaired spot.{config?.ai_enabled ? " The AI compares it with the citizen's photo before closing." : ""}</p>
                <input type="file" accept="image/*" capture="environment" aria-label="Repair photo" onChange={e => { setAfter(e.target.files[0] || null); setVerdict(null); }} style={{ height: "auto", padding: 10 }} />
                <input value={afterNote} onChange={e => setAfterNote(e.target.value)} placeholder="Work done, e.g. patched with hot mix" aria-label="Work done" />
                {verdict && !(verdict.fixed && verdict.same_place) && (
                  <div className="msg warn" style={{ display: "grid", gap: 10 }}>
                    <span><strong>{verdict.fixed ? "This may not be the same place." : "The AI isn't convinced this is fixed."}</strong> {verdict.note}</span>
                    <div><button className="btn sm" disabled={!!busy} onClick={() => resolve(true)}>Close anyway (logged)</button></div>
                  </div>
                )}
                <div><button className="btn primary" disabled={!after || !!busy} onClick={() => resolve(false)}>{busy === "resolve" ? "Checking…" : "Mark fixed"}</button></div>
              </div>
            )}
            {open && (
              <div className="action-group">
                <h3>Reject</h3>
                <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason the citizen will see" aria-label="Reason for rejecting" />
                <div><button className="btn danger" disabled={reason.trim().length < 5 || !!busy} onClick={() => status("rejected", reason)}>Reject complaint</button></div>
              </div>
            )}
            <div className="action-group">
              <h3>Re-classify</h3>
              <div className="grid2">
                <select aria-label="Issue type" value={cat} onChange={e => setCat(e.target.value)}>{config?.categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
                <select aria-label="Severity" value={sev} onChange={e => setSev(e.target.value)}>{config?.severities.map(s => <option key={s}>{s}</option>)}</select>
              </div>
              <div><button className="btn" disabled={(cat === t.category && sev === t.severity) || !!busy}
                onClick={() => act("edit", async () => setT(await api.patch(`/api/admin/tickets/${code}`, { category: cat, severity: sev })))}>Save and re-route</button></div>
            </div>
            <div className="action-group">
              <h3>Add a note</h3>
              <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Material ordered, crew scheduled for Thursday" aria-label="Note" />
              <label className="row small"><input type="checkbox" checked={notePublic} onChange={e => setNotePublic(e.target.checked)} style={{ accentColor: "var(--accent)" }} />Show to the citizen</label>
              <div><button className="btn" disabled={!note.trim() || !!busy}
                onClick={() => act("note", async () => { setT(await api.post(`/api/admin/tickets/${code}/note`, { note, public: notePublic })); setNote(""); })}>Add note</button></div>
            </div>
          </section>
          <section className="card">
            <h3 style={{ marginBottom: 16 }}>Timeline</h3>
            <Timeline events={t.events} />
          </section>
        </div>
      </div>
    </div>
  );
}
