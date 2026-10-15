import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../App.jsx";
import { api, shrinkPhoto, wardAt } from "../api.js";
import { ComplaintBox, LANG_TITLE, PinPicker, SevPill, StatusPill } from "../components.jsx";

const SEV_HELP = {
  low: "Cosmetic, no risk",
  medium: "Nuisance, getting worse",
  high: "Could cause accidents or illness soon",
  critical: "Immediate danger to life",
};

export default function Report() {
  const { config, wards } = useApp();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [loc, setLoc] = useState(null);
  const [gps, setGps] = useState("idle");
  const [landmark, setLandmark] = useState("");
  const [note, setNote] = useState("");
  const [lang, setLang] = useState("gu");
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [dups, setDups] = useState([]);
  const [merge, setMerge] = useState(null); // null = undecided, "" = new ticket, code = merge
  const [contact, setContact] = useState("");
  const [filed, setFiled] = useState(null);
  const camRef = useRef(), galRef = useRef(), reviewRef = useRef();

  const ward = loc ? wardAt(wards, loc.lat, loc.lng) : null;
  const aiOn = !!config?.ai_enabled;

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  function reset() {
    setFile(null); setPreview(""); setLoc(null); setGps("idle"); setLandmark(""); setNote("");
    setAnalysis(null); setCategory(""); setSeverity("medium"); setDups([]); setMerge(null); setContact(""); setFiled(null); setError("");
    window.scrollTo({ top: 0 });
  }

  function pickFile(f) {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setAnalysis(null); setMerge(null); setError("");
    if (!loc) locate();
  }

  function locate() {
    if (!navigator.geolocation) { setGps("error"); return; }
    setGps("asking");
    navigator.geolocation.getCurrentPosition(
      p => { setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, source: "device", accuracy: p.coords.accuracy }); setGps("ok"); setAnalysis(null); },
      e => setGps(e.code === 1 ? "denied" : "error"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }

  function moveLoc(v) { setLoc(v); setAnalysis(null); setMerge(null); }

  async function analyze() {
    setBusy("analyze"); setError("");
    try {
      const form = new FormData();
      form.append("photo", loc ? await shrinkPhoto(file) : file);
      if (loc) { form.append("lat", loc.lat); form.append("lng", loc.lng); }
      form.append("landmark", landmark); form.append("note", note); form.append("lang", lang);
      const a = await api.form("/api/analyze", form);
      setAnalysis(a);
      if (!loc || a.location_source === "photo") setLoc({ lat: a.lat, lng: a.lng, source: "photo" });
      setCategory(a.ai?.is_civic_issue === false ? "" : a.ai?.category || "");
      setSeverity(a.ai?.severity || "medium");
      setDups(a.duplicates || []);
      setMerge(a.duplicates?.length ? null : "");
      setTimeout(() => reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) { setError(e.message); }
    setBusy("");
  }

  async function chooseCategory(c) {
    setCategory(c);
    if (!analysis) return;
    try {
      const d = await api.get(`/api/duplicates?lat=${analysis.lat}&lng=${analysis.lng}&category=${c}`);
      setDups(d); setMerge(d.length ? null : "");
    } catch { setDups([]); setMerge(""); }
  }

  async function submit() {
    setBusy("submit"); setError("");
    try {
      const r = await api.post("/api/reports", {
        upload_token: analysis.upload_token, lat: analysis.lat, lng: analysis.lng, category, severity,
        landmark, note, lang, contact, merge_into: merge || "",
      });
      setFiled(r);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { setError(e.message); }
    setBusy("");
  }

  if (filed) return <Filed r={filed} onAgain={reset} />;

  const ready = file && (loc ? ward : true);
  const ai = analysis?.ai;

  return (
    <div className="wrap narrow stack">
      <div className="stack" style={{ gap: 8 }}>
        <h1>Report a civic issue in Ahmedabad</h1>
        <p className="lead">Potholes, dead streetlights, garbage, leaks, overflowing drains. Send one photo. NagarNetra identifies it, finds your ward, routes it to the right AMC department and follows up until it's fixed.</p>
      </div>

      <section className="panel" aria-labelledby="s1">
        <div className="step-h"><span className={`step-n ${file ? "done" : ""}`}>1</span><h2 id="s1">Photo</h2></div>
        {preview ? (
          <div className="photo-prev">
            <img src={preview} alt="Your photo" />
            <button className="btn sm" onClick={() => galRef.current.click()}>Change photo</button>
          </div>
        ) : (
          <div className="photo-pick">
            <button className="btn primary block" onClick={() => camRef.current.click()}>Take photo</button>
            <button className="btn block" onClick={() => galRef.current.click()}>Choose from gallery</button>
          </div>
        )}
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { pickFile(e.target.files[0]); e.target.value = ""; }} />
        <input ref={galRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden onChange={e => { pickFile(e.target.files[0]); e.target.value = ""; }} />
        <p className="muted small" style={{ marginTop: 10 }}>Faces in photos are blurred automatically before anything is stored.</p>
      </section>

      <section className="panel" aria-labelledby="s2">
        <div className="step-h"><span className={`step-n ${ward ? "done" : ""}`}>2</span><h2 id="s2">Location</h2></div>
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn" onClick={locate} disabled={gps === "asking"}>
            {gps === "asking" ? <><span className="spinner" /> Finding you…</> : "Use my current location"}
          </button>
          <span className="muted small">or tap the map where the problem is. Drag the pin to adjust.</span>
        </div>
        {gps === "denied" && <p className="notice small" style={{ marginBottom: 10 }}>Location access is blocked. Tap the map to place the pin, or allow location in your browser settings.</p>}
        {gps === "error" && <p className="notice small" style={{ marginBottom: 10 }}>Couldn't get your location. Tap the map to place the pin.</p>}
        <PinPicker wards={wards} value={loc} onChange={moveLoc} highlight={ward?.no} />
        <p style={{ marginTop: 10 }}>
          {loc && ward && <><strong>Ward {ward.no} · {ward.name}</strong> <span className="muted">({ward.zone} Zone)</span>{loc.accuracy > 60 && <span className="muted small"> · GPS accuracy about {Math.round(loc.accuracy)} m, check the pin</span>}</>}
          {loc && !ward && wards && <span className="error" style={{ display: "inline-block" }}>This spot is outside AMC limits. Move the pin inside Ahmedabad.</span>}
          {!loc && <span className="muted">No location yet. If your photo has GPS data, we can use that.</span>}
        </p>
        <div className="field" style={{ marginTop: 10 }}>
          <span>Nearby landmark <em>(optional)</em></span>
          <input value={landmark} maxLength={200} onChange={e => setLandmark(e.target.value)} placeholder="e.g. opposite Iscon Mall, near Gate 2" />
        </div>
      </section>

      <section className="panel" aria-labelledby="s3">
        <div className="step-h"><span className={`step-n ${analysis ? "done" : ""}`}>3</span><h2 id="s3">Details</h2></div>
        <div className="stack" style={{ gap: 12 }}>
          <label className="field">
            <span>Anything to add? <em>(optional)</em></span>
            <textarea value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder="e.g. Two scooters slipped here this week" />
          </label>
          <label className="field">
            <span>Complaint language</span>
            <select value={lang} onChange={e => { setLang(e.target.value); setAnalysis(null); }}>
              <option value="gu">English + ગુજરાતી</option>
              <option value="hi">English + हिन्दी</option>
              <option value="en">English only</option>
            </select>
          </label>
          {!analysis && (
            <button className="btn primary" disabled={!ready || busy === "analyze"} onClick={analyze}>
              {busy === "analyze" ? <><span className="spinner" /> {aiOn ? "AI is looking at your photo…" : "Uploading…"}</> : aiOn ? "Analyse photo" : "Continue"}
            </button>
          )}
          {!ready && !analysis && <p className="muted small">{!file ? "Add a photo first." : "Move the pin inside AMC limits."}</p>}
          {error && !analysis && <p className="error">{error}</p>}
        </div>
      </section>

      {analysis && (
        <section className="panel" aria-labelledby="s4" ref={reviewRef}>
          <div className="step-h"><span className="step-n">4</span><h2 id="s4">Check and file</h2></div>
          <div className="stack" style={{ gap: 14 }}>
            {ai && ai.is_civic_issue !== false && (
              <div className="ai-card">
                <span className="tag">{analysis.ai_provider || "AI"} · {analysis.ai_model || "vision model"}</span>
                <p><strong>{config.categories.find(c => c.id === ai.category)?.label}</strong> · <SevPill s={ai.severity} /> · {Math.round(ai.confidence * 100)}% sure</p>
                {ai.observation && <p>{ai.observation}</p>}
                {ai.hazard && <p className="muted">{ai.hazard}</p>}
              </div>
            )}
            {ai && ai.is_civic_issue === false && (
              <p className="notice">The AI doesn't see a civic problem in this photo{ai.observation ? `: ${ai.observation}` : "."} If it is one, choose the type below.</p>
            )}
            {analysis.ai_error && <p className="notice small">{analysis.ai_error}</p>}
            {!aiOn && <p className="muted small">Choose what the problem is.</p>}
            {analysis.faces_blurred > 0 && <p className="muted small">Blurred {analysis.faces_blurred} face{analysis.faces_blurred > 1 ? "s" : ""} in your photo.</p>}

            <div className="field">
              <span>What is it?</span>
              <div className="chips" role="group" aria-label="Issue type">
                {config.categories.map(c => (
                  <button key={c.id} className="chip" aria-pressed={category === c.id} onClick={() => chooseCategory(c.id)}>{c.label}</button>
                ))}
              </div>
              {category && <em>Goes to {config.categories.find(c => c.id === category)?.dept}, AMC</em>}
            </div>
            <div className="field">
              <span>How serious?</span>
              <div className="chips" role="group" aria-label="Severity">
                {config.severities.map(s => (
                  <button key={s} className="chip" aria-pressed={severity === s} onClick={() => setSeverity(s)} title={SEV_HELP[s]}>{s}</button>
                ))}
              </div>
              <em>{SEV_HELP[severity]}</em>
            </div>

            {dups.length > 0 && (
              <div className="notice stack" style={{ gap: 10 }}>
                <p><strong>This may already be reported nearby.</strong> Adding your report to it raises its priority.</p>
                {dups.map(d => (
                  <label key={d.code} className="row" style={{ alignItems: "flex-start" }}>
                    <input type="radio" name="merge" checked={merge === d.code} onChange={() => setMerge(d.code)} />
                    <span><span className="code">{d.code}</span> · {d.category_label} · {d.distance_m} m away · {d.report_count} report{d.report_count > 1 ? "s" : ""} · <StatusPill t={d} /></span>
                  </label>
                ))}
                <label className="row">
                  <input type="radio" name="merge" checked={merge === ""} onChange={() => setMerge("")} />
                  <span>No, mine is a different problem</span>
                </label>
              </div>
            )}

            <label className="field">
              <span>Phone or email <em>(optional, only AMC officials see it)</em></span>
              <input value={contact} maxLength={120} onChange={e => setContact(e.target.value)} placeholder="So the field team can reach you if needed" />
            </label>

            {error && <p className="error">{error}</p>}
            <button className="btn primary" disabled={!category || merge === null || busy === "submit"} onClick={submit}>
              {busy === "submit" ? <><span className="spinner" /> Filing…</> : merge ? `Add my report to ${merge}` : "File complaint"}
            </button>
            {!category && <p className="muted small">Choose the issue type.</p>}
            {category && merge === null && <p className="muted small">Tell us whether this is the same problem.</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function Filed({ r, onAgain }) {
  const t = r.ticket;
  return (
    <div className="wrap narrow stack">
      <section className="panel stack" style={{ gap: 14 }}>
        <p className="eyebrow">{r.merged ? "Added to an existing complaint" : "Complaint filed"}</p>
        <div className="big-code">{t.code}</div>
        <p>{r.merged
          ? `Thanks. This problem was already reported. Your report brings it to ${t.report_count} reports and moves it up the queue.`
          : `Sent to ${t.department}, Ward ${t.ward_no} ${t.ward_name}. Deadline: ${new Date(t.due_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}. If it's late, NagarNetra escalates it automatically.`}</p>
        <p className="muted small">Save this number to track progress. Anyone with the number can see the status.</p>
        <div className="row">
          <Link className="btn teal" to={`/track/${t.code}`}>Track this complaint</Link>
          <button className="btn" onClick={onAgain}>Report another issue</button>
        </div>
      </section>
      {!r.merged && (
        <section className="panel stack" style={{ gap: 14 }}>
          <h2>Your complaint</h2>
          <ComplaintBox title="English" text={t.complaint_en} />
          {t.complaint_local && <ComplaintBox title={LANG_TITLE[t.language]} text={t.complaint_local} />}
        </section>
      )}
    </div>
  );
}
