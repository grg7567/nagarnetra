import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Camera, Check, CircleNotch, GpsFix, Image as ImageIcon, MapPin, Sparkle, WarningCircle } from "@phosphor-icons/react";
import { useApp } from "../App.jsx";
import { api, copyText, shrinkPhoto, wardAt } from "../api.js";
import { CategoryIcon, ComplaintTabs, PinPicker, SevPill, StatusPill } from "../components.jsx";

const STEPS = ["Photo", "Location", "Details", "Review"];
const SEV_HELP = {
  low: "Cosmetic, no risk to anyone",
  medium: "A nuisance that will get worse",
  high: "Could cause accidents or illness soon",
  critical: "Immediate danger to life",
};

export default function Report() {
  const { config, wards } = useApp();
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [loc, setLoc] = useState(null);
  const [gps, setGps] = useState("idle");
  const [landmark, setLandmark] = useState("");
  const [note, setNote] = useState("");
  const [lang, setLang] = useState("gu");
  const [contact, setContact] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [dups, setDups] = useState([]);
  const [merge, setMerge] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [filed, setFiled] = useState(null);
  const camRef = useRef(), galRef = useRef(), topRef = useRef();

  const ward = loc ? wardAt(wards, loc.lat, loc.lng) : null;
  const aiOn = !!config?.ai_enabled;

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);
  useEffect(() => { if (step === 1 && !loc && gps === "idle") locate(); }, [step]);
  useEffect(() => { topRef.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" }); }, [step, filed]);

  function pickFile(f) {
    if (!f) return;
    setFile(f); setPreview(URL.createObjectURL(f)); setAnalysis(null); setError("");
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
  function moveLoc(v) { setLoc(v); setAnalysis(null); }

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
      setStep(3);
    } catch (e) { setError(e.message); }
    setBusy("");
  }

  async function chooseCategory(c) {
    setCategory(c);
    try {
      const d = await api.get(`/api/duplicates?lat=${analysis.lat}&lng=${analysis.lng}&category=${c}`);
      setDups(d); setMerge(d.length ? null : "");
    } catch { setDups([]); setMerge(""); }
  }

  async function submit() {
    setBusy("submit"); setError("");
    try {
      setFiled(await api.post("/api/reports", {
        upload_token: analysis.upload_token, lat: analysis.lat, lng: analysis.lng, category, severity,
        landmark, note, lang, contact, merge_into: merge || "", force_new: dups.length > 0 && merge === "",
      }));
    } catch (e) { setError(e.message); }
    setBusy("");
  }

  function reset() {
    setStep(0); setFile(null); setPreview(""); setLoc(null); setGps("idle"); setLandmark(""); setNote(""); setContact("");
    setAnalysis(null); setCategory(""); setSeverity("medium"); setDups([]); setMerge(null); setFiled(null); setError("");
  }

  if (filed) return <div className="wrap narrow" ref={topRef}><Filed r={filed} onAgain={reset} /></div>;

  const canNext = [!!file, !!loc && !!ward, true, !!category && merge !== null][step];
  const next = () => (step === 2 && !analysis ? analyze() : setStep(s => s + 1));
  const ai = analysis?.ai;
  const anim = reduce ? {} : { initial: { opacity: 0, x: 24 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -24 }, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } };

  return (
    <div className="wrap narrow wizard" ref={topRef} style={{ scrollMarginTop: 90 }}>
      <div className="progress" aria-label={`Step ${step + 1} of 4`}>
        {STEPS.map((s, i) => <div key={s} className={i <= step ? "on" : ""}>{s}</div>)}
      </div>

      <AnimatePresence mode="wait">
        <motion.section key={step} className="stack" style={{ gap: 20 }} {...anim}>
          {step === 0 && <>
            <div className="step-title"><h1>What's the problem?</h1><p className="muted">A clear photo of the issue is all we need to start.</p></div>
            {preview ? (
              <div className="photo-prev">
                <img src={preview} alt="Your photo" />
                <button className="btn sm" onClick={() => galRef.current.click()}><ImageIcon size={16} />Change</button>
              </div>
            ) : (
              <div className="drop">
                <span className="ring"><Camera size={30} weight="duotone" /></span>
                <div className="stack-sm">
                  <button className="btn primary lg" onClick={() => camRef.current.click()}><Camera size={20} weight="bold" />Take a photo</button>
                  <button className="btn ghost" onClick={() => galRef.current.click()}>or upload from gallery</button>
                </div>
              </div>
            )}
            <p className="muted xs">Faces are blurred and location data is removed from the photo before it is stored.</p>
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { pickFile(e.target.files[0]); e.target.value = ""; }} />
            <input ref={galRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden onChange={e => { pickFile(e.target.files[0]); e.target.value = ""; }} />
          </>}

          {step === 1 && <>
            <div className="step-title"><h1>Where is it?</h1><p className="muted">Tap the map or drag the pin to the exact spot.</p></div>
            <div className="row">
              <button className="btn" onClick={locate} disabled={gps === "asking"}>
                {gps === "asking" ? <CircleNotch size={18} className="spin" /> : <GpsFix size={18} />}
                {gps === "asking" ? "Finding you…" : "Use my location"}
              </button>
              {loc && ward && <span className="ward-tag"><MapPin size={17} weight="fill" />Ward {ward.no}, {ward.name}</span>}
            </div>
            {gps === "denied" && <Msg kind="warn">Location access is blocked. Tap the map to place the pin.</Msg>}
            {gps === "error" && <Msg kind="warn">Couldn't get your location. Tap the map to place the pin.</Msg>}
            {loc && !ward && wards && <Msg kind="error">That spot is outside AMC limits. Move the pin inside Ahmedabad.</Msg>}
            <PinPicker wards={wards} value={loc} onChange={moveLoc} highlight={ward?.no} />
            {loc?.accuracy > 60 && <p className="muted xs">GPS is accurate to about {Math.round(loc.accuracy)} m. Check the pin is on the right spot.</p>}
            <label className="field">
              <span className="label">Nearby landmark <em>(optional)</em></span>
              <input value={landmark} maxLength={200} onChange={e => setLandmark(e.target.value)} placeholder="e.g. opposite Iscon Mall" />
            </label>
          </>}

          {step === 2 && <>
            <div className="step-title"><h1>A few details</h1><p className="muted">All optional. They help the field team.</p></div>
            <label className="field">
              <span className="label">Anything to add?</span>
              <textarea value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder="e.g. Two scooters slipped here this week" />
            </label>
            <div className="field">
              <span className="label">Complaint language</span>
              <div className="seg" role="group" aria-label="Complaint language">
                {[["gu", "English + ગુજરાતી"], ["hi", "English + हिन्दी"], ["en", "English"]].map(([k, l]) => (
                  <button key={k} aria-pressed={lang === k} onClick={() => { setLang(k); setAnalysis(null); }}>{l}</button>
                ))}
              </div>
            </div>
            <label className="field">
              <span className="label">Phone or email</span>
              <input value={contact} maxLength={120} onChange={e => setContact(e.target.value)} placeholder="Only AMC officials can see this" />
              <span className="help">So the field team can reach you if they can't find the spot.</span>
            </label>
            {busy === "analyze" && (
              <div className="skeleton" aria-live="polite">
                <p className="row" style={{ gap: 8, fontWeight: 600 }}><Sparkle size={18} weight="fill" style={{ color: "var(--accent)" }} />{aiOn ? "Reading your photo…" : "Uploading…"}</p>
                <i style={{ width: "80%" }} /><i style={{ width: "55%" }} />
              </div>
            )}
          </>}

          {step === 3 && analysis && <>
            <div className="step-title"><h1>Check and send</h1><p className="muted">Fix anything the AI got wrong, then send it.</p></div>
            {ai && ai.is_civic_issue !== false && (
              <div className="ai-result">
                <span className="head"><Sparkle size={16} weight="fill" />AI analysis</span>
                <span className="title">{config.categories.find(c => c.id === ai.category)?.label}</span>
                <div className="row" style={{ gap: 8 }}><SevPill s={ai.severity} /><span className="muted small">{Math.round(ai.confidence * 100)}% sure</span></div>
                {ai.observation && <p>{ai.observation}</p>}
                {ai.hazard && <p className="muted small">{ai.hazard}</p>}
              </div>
            )}
            {ai && ai.is_civic_issue === false && <Msg kind="warn">The AI doesn't see a civic problem in this photo{ai.observation ? `: ${ai.observation}` : "."} If it is one, pick the type below.</Msg>}
            {analysis.ai_error && <Msg kind="info">{analysis.ai_error}</Msg>}

            <div className="field">
              <span className="label">What is it?</span>
              <div className="choice-grid" role="group" aria-label="Issue type">
                {config.categories.map(c => (
                  <button key={c.id} className="choice" aria-pressed={category === c.id} onClick={() => chooseCategory(c.id)}>
                    <CategoryIcon id={c.id} size={24} />{c.label}
                  </button>
                ))}
              </div>
              {category && <span className="help">Goes to the {config.categories.find(c => c.id === category)?.dept}, AMC</span>}
            </div>
            <div className="field">
              <span className="label">How serious?</span>
              <div className="seg" role="group" aria-label="Severity">
                {config.severities.map(s => <button key={s} aria-pressed={severity === s} onClick={() => setSeverity(s)} style={{ textTransform: "capitalize" }}>{s}</button>)}
              </div>
              <span className="help">{SEV_HELP[severity]}</span>
            </div>

            {dups.length > 0 && (
              <div className="dup">
                <p><strong>Someone may have reported this already.</strong> <span className="muted">Adding yours moves it up the queue.</span></p>
                {dups.map(d => (
                  <label key={d.code}>
                    <input type="radio" name="merge" checked={merge === d.code} onChange={() => setMerge(d.code)} />
                    <span className="stack-sm" style={{ gap: 2 }}>
                      <span><strong>{d.category_label}</strong>, {d.distance_m} m away</span>
                      <span className="row muted xs" style={{ gap: 6 }}><span className="code">{d.code}</span><StatusPill t={d} />{d.report_count} report{d.report_count > 1 ? "s" : ""}</span>
                    </span>
                  </label>
                ))}
                <label>
                  <input type="radio" name="merge" checked={merge === ""} onChange={() => setMerge("")} />
                  <span>No, mine is a different problem</span>
                </label>
              </div>
            )}
          </>}

          {error && <Msg kind="error">{error}</Msg>}
        </motion.section>
      </AnimatePresence>

      <div className="actions">
        {step > 0 && step < 3 && <button className="btn ghost" onClick={() => setStep(s => s - 1)} disabled={!!busy}><ArrowLeft size={18} />Back</button>}
        {step === 3 && <button className="btn ghost" onClick={() => { setStep(2); setAnalysis(null); }} disabled={!!busy}><ArrowLeft size={18} />Back</button>}
        {step < 3 && (
          <button className="btn primary lg" disabled={!canNext || !!busy} onClick={next}>
            {busy === "analyze" ? <CircleNotch size={18} className="spin" /> : null}
            {step === 2 ? (busy ? "Analysing" : aiOn ? "Analyse photo" : "Continue") : "Continue"}
            {!busy && <ArrowRight size={18} />}
          </button>
        )}
        {step === 3 && (
          <button className="btn primary lg" disabled={!canNext || !!busy} onClick={submit}>
            {busy === "submit" ? <CircleNotch size={18} className="spin" /> : <Check size={18} weight="bold" />}
            {merge ? `Add to ${merge}` : "Send complaint"}
          </button>
        )}
      </div>
    </div>
  );
}

function Msg({ kind, children }) {
  return <p className={`msg ${kind}`}><WarningCircle size={18} weight="fill" /><span>{children}</span></p>;
}

function Filed({ r, onAgain }) {
  const t = r.ticket;
  const [copied, setCopied] = useState(false);
  const due = new Date(t.due_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", timeZone: "Asia/Kolkata" });
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="stack" style={{ gap: 14 }}>
        <span className="success-ring"><Check size={28} weight="bold" /></span>
        <h1>{r.merged ? "Added to an existing complaint" : "Complaint sent"}</h1>
        <p className="muted" style={{ maxWidth: "52ch" }}>{r.merged
          ? `This problem was already reported. Yours makes ${t.report_count} reports, which moves it up the queue.`
          : `It's with the ${t.department}, Ward ${t.ward_no} ${t.ward_name}. The deadline is ${due}. If it's missed, NagarNetra escalates it.`}</p>
      </div>
      <div className="card stack" style={{ gap: 12 }}>
        <span className="muted small">Your complaint number</span>
        <div className="row between">
          <span className="done-code">{t.code}</span>
          <button className="btn sm" onClick={async () => { setCopied(await copyText(t.code)); setTimeout(() => setCopied(false), 1800); }}>{copied ? "Copied" : "Copy number"}</button>
        </div>
        <p className="muted xs">Anyone with this number can see progress, so you can share it with neighbours.</p>
      </div>
      <div className="row">
        <Link className="btn primary lg" to={`/track/${t.code}`}>Track progress<ArrowRight size={18} /></Link>
        <button className="btn lg" onClick={onAgain}>Report another</button>
      </div>
      {!r.merged && t.complaint_en && (
        <div className="card stack" style={{ gap: 4 }}>
          <h3>The complaint we filed</h3>
          <ComplaintTabs en={t.complaint_en} local={t.complaint_local} lang={t.language} />
        </div>
      )}
    </div>
  );
}
