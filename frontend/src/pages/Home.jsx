import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Camera, Path, Bell } from "@phosphor-icons/react";
import { ago, api, STATUS_LABEL } from "../api.js";
import { SevPill, Thumb, isClosed } from "../ui.jsx";

const rise = (reduce, delay = 0) => reduce ? {} : {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] },
};

export default function Home() {
  const reduce = useReducedMotion();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState(null);

  useEffect(() => {
    api.get("/api/public/stats").then(setStats).catch(() => setStats(null));
    api.get("/api/public/tickets?days=30").then(r => setRecent(r.slice(0, 10))).catch(() => setRecent([]));
  }, []);

  return (
    <div className="wrap">
      <section className="hero">
        <div>
          <motion.h1 {...rise(reduce)}>Spot a broken street? Report it in a minute.</motion.h1>
          <motion.p className="sub" {...rise(reduce, 0.08)}>
            Snap a photo in Ahmedabad. We find the ward, alert the right AMC department and track it until it's fixed.
          </motion.p>
          <motion.div className="ctas" {...rise(reduce, 0.16)}>
            <Link to="/report" className="btn primary lg"><Camera size={20} weight="bold" />Report an issue</Link>
            <Link to="/track" className="btn lg">Track a complaint</Link>
          </motion.div>
        </div>
        <motion.div className="hero-img" {...(reduce ? {} : { initial: { opacity: 0, scale: 0.98 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.9, ease: [0.16, 1, 0.3, 1] } })}>
          <img src="/img/hero-pol.webp" alt="Carved wooden pol houses in Ahmedabad's old city" fetchpriority="high" />
        </motion.div>
      </section>

      <section className="stats" aria-label="NagarNetra in numbers">
        <div><b>{stats ? stats.total : "–"}</b><span>complaints filed</span></div>
        <div><b>{stats ? stats.open : "–"}</b><span>being worked on</span></div>
        <div><b>{stats ? stats.resolved : "–"}</b><span>fixed</span></div>
        <div><b>48</b><span>AMC wards covered</span></div>
      </section>

      <section className="block">
        <div className="section-h"><h2>How it works</h2></div>
        <div className="bento">
          <motion.div className="b-photo" {...inView(reduce, 0)}>
            <img src="/img/pothole-road.webp" alt="A road full of water-filled potholes" loading="lazy" />
            <div className="txt stack-sm">
              <Camera size={28} weight="duotone" />
              <h3>Snap it</h3>
              <p>Take a photo and allow location. The AI reads the photo, names the problem and judges how dangerous it is.</p>
            </div>
          </motion.div>
          <motion.div className="b-route" {...inView(reduce, 0.06)}>
            <Path size={28} weight="duotone" />
            <h3>We route it</h3>
            <p className="muted" style={{ color: "var(--ink-2)" }}>Your pin is matched to one of 48 AMC wards and sent to the department that fixes it, with a deadline. Repeat reports are merged so the worst problems rise to the top.</p>
          </motion.div>
          <motion.div className="b-track" {...inView(reduce, 0.12)}>
            <Bell size={28} weight="duotone" />
            <h3>Watch it get fixed</h3>
            <p>Follow every step with your complaint number. Missed deadlines are escalated to the Zonal Deputy Commissioner automatically.</p>
          </motion.div>
        </div>
      </section>

      <section className="block">
        <div className="row between" style={{ alignItems: "end", marginBottom: 20 }}>
          <h2>Recently reported</h2>
          <Link to="/map" className="btn sm ghost">All on the map<ArrowRight size={16} /></Link>
        </div>
        {recent === null && (
          <div className="feed" aria-hidden="true">
            {[0, 1, 2, 3].map(i => <div key={i} className="tcard"><div className="thumb" /><div className="body skeleton" style={{ background: "none" }}><i style={{ width: "70%" }} /><i style={{ width: "45%" }} /></div></div>)}
          </div>
        )}
        {recent?.length === 0 && <div className="empty card"><p>No reports yet. Yours could be the first.</p><Link to="/report" className="btn primary">Report an issue</Link></div>}
        {recent?.length > 0 && (
          <div className="feed">
            {recent.map((t, i) => (
              <motion.div key={t.code} {...inView(reduce, Math.min(i, 4) * 0.05)}>
                <Link to={`/track/${t.code}`} className="tcard">
                  <div className="thumb"><Thumb t={t} /></div>
                  <div className="body">
                    <div className="row" style={{ gap: 6 }}>
                      {isClosed(t) ? <span className="pill st-resolved">{STATUS_LABEL[t.status]}</span> : <SevPill s={t.severity} />}
                      {t.report_count > 1 && <span className="pill outline">{t.report_count} reports</span>}
                    </div>
                    <strong>{t.category_label}</strong>
                    <span className="meta">Ward {t.ward_no} {t.ward_name}, {ago(t.created_at)}</span>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      <section className="block">
        <div className="band">
          <img src="/img/city-aerial.webp" alt="" loading="lazy" />
          <div className="txt">
            <h2>Every report, on one city map</h2>
            <p>See what's broken in your ward, what's being fixed and what's overdue.</p>
            <div><Link to="/map" className="btn primary">Open the city map</Link></div>
          </div>
        </div>
      </section>
    </div>
  );
}

// Content stays visible at rest; scrolling in only adds a short lift.
function inView(reduce, delay) {
  return reduce ? {} : {
    initial: { y: 18 },
    whileInView: { y: 0 },
    viewport: { once: true, amount: 0.25 },
    transition: { duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] },
  };
}
