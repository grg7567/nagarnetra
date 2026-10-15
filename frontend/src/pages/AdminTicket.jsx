import { useEffect, useState } from "react";
import { MapContainer } from "react-leaflet";
import { Link, useParams } from "react-router-dom";
import { useApp } from "../App.jsx";
import { api, fmtDate, fmtDay } from "../api.js";
import { ComplaintBox, LANG_TITLE, SevPill, StatusPill, Stepper, Tiles, TicketMarkers, Timeline } from "../components.jsx";

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
    if (r.resolved) { setAfter(null); setAfterNote(""); setMsg("Marked fixed. The citizen can see the 'after' photo."); }
  });

  if (error && !t) return <div className="wrap"><p className="error">{error}</p></div>;
  if (!t) return <div className="wrap muted">Loading…</div>;
  const open = ["new", "assigned", "in_progress"].includes(t.status);

  return (
    <div className="wrap stack">
      <p><Link to="/admin">← Back to dashboard</Link></p>
      <div className="panel-h" style={{ marginBottom: 0 }}>
        <div className="stack" style={{ gap: 6 }}>
          <p className="row" style={{ gap: 8 }}><span className="code">{t.code}</span><SevPill s={t.severity} /><StatusPill t={t} />{t.is_demo && <span className="pill demo">Demo data</span>}</p>
          <h1>{t.category_label}</h1>
          <p className="muted">Ward {t.ward_no} · {t.ward_name} ({t.zone} Zone){t.landmark ? ` · ${t.landmark}` : ""}</p>
        </div>
        <div className="prio" title="Priority score">Priority {t.priority}</div>
      </div>
      {error && <p className="error">{error}</p>}
      {msg && <p className="ok">{msg}</p>}

      <div className="two">
        <div className="stack">
          <section className="panel stack" style={{ gap: 12 }}>
            <Stepper status={t.status} />
            <dl className="kv">
              <dt>Department</dt><dd>{t.department}</dd>
              <dt>Reported</dt><dd>{fmtDate(t.created_at)}</dd>
              <dt>Deadline</dt><dd style={{ color: t.overdue ? "var(--red)" : undefined }}>{fmtDay(t.due_at)}{t.overdue ? " · overdue" : ""}</dd>
              {t.escalated_to && <><dt>Escalated to</dt><dd>{t.escalated_to}</dd></>}
              <dt>Reports</dt><dd>{t.report_count}</dd>
              <dt>Citizen contact</dt><dd>{t.contact || <span className="muted">Not given</span>}</dd>
              {t.citizen_note && <><dt>Citizen note</dt><dd>{t.citizen_note}</dd></>}
              <dt>AI analysis</dt><dd>{t.ai_source === "watsonx" ? `watsonx.ai · ${Math.round((t.ai_confidence || 0) * 100)}% confidence` : "Classified by the citizen"}</dd>
              {t.observation && <><dt>Observed</dt><dd>{t.observation}</dd></>}
              {t.hazard && <><dt>Risk</dt><dd>{t.hazard}</dd></>}
            </dl>
            {t.photos.length > 0 && (
              <div className="photos">
                {t.photos.map(p => (
                  <figure key={p.id}>
                    <a href={`/api/photos/${p.id}`} target="_blank" rel="noreferrer"><img src={`/api/photos/${p.id}?size=480`} alt={p.kind === "after" ? "After repair" : "Reported problem"} /></a>
                    <figcaption>{p.kind === "after" ? "After repair" : "Citizen photo"}{p.faces_blurred ? ` · ${p.faces_blurred} face(s) blurred` : ""}</figcaption>
                  </figure>
                ))}
              </div>
            )}
            <MapContainer className="map" center={[t.lat, t.lng]} zoom={17} style={{ height: 240 }}>
              <Tiles /><TicketMarkers tickets={[t]} linkPrefix="/admin/t/" />
            </MapContainer>
            <p className="small"><a href={`https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lng}`} target="_blank" rel="noreferrer">Directions for the field team (Google Maps)</a></p>
          </section>

          <section className="panel stack" style={{ gap: 14 }}>
            <h2>Complaint</h2>
            <ComplaintBox title="English" text={t.complaint_en} />
            {t.complaint_local && <ComplaintBox title={LANG_TITLE[t.language]} text={t.complaint_local} />}
          </section>
        </div>

        <div className="stack">
          {open && (
            <section className="panel stack" style={{ gap: 12 }}>
              <h2>Update status</h2>
              <div className="row">
                {t.status === "new" && <button className="btn" disabled={!!busy} onClick={() => status("assigned")}>Assign to field team</button>}
                {t.status !== "in_progress" && <button className="btn" disabled={!!busy} onClick={() => status("in_progress")}>Work started</button>}
              </div>
              <div className="field">
                <span>Reject <em>(the citizen sees this reason)</em></span>
                <div className="row">
                  <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Private property, not AMC's responsibility" style={{ flex: 1, minWidth: 200 }} />
                  <button className="btn danger" disabled={reason.trim().length < 5 || !!busy} onClick={() => status("rejected", reason)}>Reject</button>
                </div>
              </div>
            </section>
          )}

          {open && (
            <section className="panel stack" style={{ gap: 12 }}>
              <h2>Mark as fixed</h2>
              <p className="muted small">Upload a photo of the repaired spot. {config?.ai_enabled ? "The AI compares it with the citizen's photo before closing." : ""}</p>
              <input type="file" accept="image/*" capture="environment" onChange={e => { setAfter(e.target.files[0] || null); setVerdict(null); }} />
              <input value={afterNote} onChange={e => setAfterNote(e.target.value)} placeholder="Work done (optional), e.g. Patched with hot mix" />
              {verdict && !verdict.fixed && (
                <div className="notice stack" style={{ gap: 8 }}>
                  <p><strong>The AI isn't convinced this is fixed.</strong> {verdict.note}</p>
                  <div><button className="btn" disabled={!!busy} onClick={() => resolve(true)}>Close anyway (logged as override)</button></div>
                </div>
              )}
              {verdict && verdict.fixed && !verdict.same_place && (
                <div className="notice stack" style={{ gap: 8 }}>
                  <p><strong>This may not be the same place.</strong> {verdict.note}</p>
                  <div><button className="btn" disabled={!!busy} onClick={() => resolve(true)}>Close anyway (logged as override)</button></div>
                </div>
              )}
              <div><button className="btn teal" disabled={!after || !!busy} onClick={() => resolve(false)}>{busy === "resolve" ? "Checking…" : "Mark fixed"}</button></div>
            </section>
          )}

          <section className="panel stack" style={{ gap: 12 }}>
            <h2>Re-classify</h2>
            <div className="grid2">
              <select aria-label="Issue type" value={cat} onChange={e => setCat(e.target.value)}>{config?.categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
              <select aria-label="Severity" value={sev} onChange={e => setSev(e.target.value)}>{config?.severities.map(s => <option key={s}>{s}</option>)}</select>
            </div>
            <div><button className="btn" disabled={(cat === t.category && sev === t.severity) || !!busy}
              onClick={() => act("edit", async () => setT(await api.patch(`/api/admin/tickets/${code}`, { category: cat, severity: sev })))}>Save and re-route</button></div>
          </section>

          <section className="panel stack" style={{ gap: 12 }}>
            <h2>Add a note</h2>
            <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Material ordered, crew scheduled for Thursday" />
            <label className="row small"><input type="checkbox" checked={notePublic} onChange={e => setNotePublic(e.target.checked)} /> Show to the citizen</label>
            <div><button className="btn" disabled={!note.trim() || !!busy}
              onClick={() => act("note", async () => { setT(await api.post(`/api/admin/tickets/${code}/note`, { note, public: notePublic })); setNote(""); })}>Add note</button></div>
          </section>

          <section className="panel">
            <h2 style={{ marginBottom: 12 }}>Timeline</h2>
            <Timeline events={t.events} />
          </section>
        </div>
      </div>
    </div>
  );
}
