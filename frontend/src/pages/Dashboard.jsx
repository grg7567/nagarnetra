import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer } from "react-leaflet";
import { useNavigate } from "react-router-dom";
import { useApp } from "../App.jsx";
import { ago, api, fmtDay } from "../api.js";
import { AMD_CENTER, Legend, SevPill, StatusPill, Tiles, TicketMarkers, useInterval, WardLayer } from "../components.jsx";

const ZONES = ["Central", "East", "North", "North West", "South", "South West", "West"];

export default function Dashboard() {
  const { config, wards, user } = useApp();
  const nav = useNavigate();
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [f, setF] = useState({ status: "open", department: "", zone: "", ward: 0, category: "", q: "" });

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v).map(([k, v]) => [k, String(v)]));
      const [s, r] = await Promise.all([api.get("/api/admin/stats"), api.get(`/api/admin/tickets?${qs}`)]);
      setStats(s); setRows(r); setError("");
    } catch (e) { setError(e.message); }
  }, [f]);
  useEffect(() => { load(); }, [load]);
  useInterval(load, 60000);

  const depts = useMemo(() => [...new Set((config?.categories || []).map(c => c.dept))], [config]);
  const wardList = useMemo(() => (wards?.features || []).map(w => w.properties), [wards]);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const hrs = stats?.median_hours;

  return (
    <div className="wrap stack">
      <div className="panel-h" style={{ marginBottom: 0 }}>
        <div className="stack" style={{ gap: 4 }}>
          <p className="eyebrow">{user.department || "All departments"}</p>
          <h1>Complaint dashboard</h1>
        </div>
        <button className="btn sm" onClick={load}>Refresh</button>
      </div>
      {error && <p className="error">{error}</p>}

      {stats && (
        <div className="kpis">
          <Kpi v={stats.open} k="Open complaints" />
          <Kpi v={stats.overdue} k="Overdue, escalated" alert={stats.overdue > 0} />
          <Kpi v={stats.critical_open} k="Critical open" alert={stats.critical_open > 0} />
          <Kpi v={stats.resolved} k="Fixed" />
          <Kpi v={hrs == null ? "–" : hrs < 48 ? `${Math.round(hrs)}h` : `${(hrs / 24).toFixed(1)}d`} k="Median time to fix" />
          <Kpi v={stats.on_time_rate == null ? "–" : `${Math.round(stats.on_time_rate * 100)}%`} k="Fixed on time" />
        </div>
      )}

      <div className="dash">
        <section className="panel">
          <div className="panel-h"><h2>Where the problems are</h2><span className="muted small">Shading = open complaints per ward</span></div>
          <MapContainer className="map tall" center={AMD_CENTER} zoom={12}>
            <Tiles />
            <WardLayer wards={wards} counts={stats?.by_ward} onWard={w => set("ward", w.no)} />
            {rows && <TicketMarkers tickets={rows} linkPrefix="/admin/t/" />}
          </MapContainer>
          <Legend />
        </section>
        <div className="stack">
          {stats && <Daily days={stats.daily} />}
          {stats && (
            <section className="panel">
              <h2 style={{ marginBottom: 8 }}>By department</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Department</th><th>Open</th><th>Overdue</th></tr></thead>
                  <tbody>
                    {Object.entries(stats.by_department).sort((a, b) => b[1].open - a[1].open).map(([d, v]) => (
                      <tr key={d} className="click" onClick={() => set("department", d)}>
                        <td>{d}</td><td className="prio">{v.open}</td><td className="prio" style={{ color: v.overdue ? "var(--red)" : undefined }}>{v.overdue}</td>
                      </tr>
                    ))}
                    {!Object.keys(stats.by_department).length && <tr><td colSpan={3} className="muted">No open complaints.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>

      <section className="panel stack" style={{ gap: 12 }}>
        <div className="panel-h" style={{ marginBottom: 0 }}>
          <h2>Work queue</h2>
          <span className="muted small">Sorted by priority: severity, number of reports, days overdue</span>
        </div>
        <div className="filters">
          <select aria-label="Status" value={f.status} onChange={e => set("status", e.target.value)}>
            <option value="open">Open</option><option value="overdue">Overdue</option><option value="new">New</option>
            <option value="assigned">Assigned</option><option value="in_progress">Work started</option>
            <option value="resolved">Fixed</option><option value="rejected">Rejected</option><option value="all">All</option>
          </select>
          {!user.department && (
            <select aria-label="Department" value={f.department} onChange={e => set("department", e.target.value)}>
              <option value="">All departments</option>{depts.map(d => <option key={d}>{d}</option>)}
            </select>
          )}
          <select aria-label="Zone" value={f.zone} onChange={e => set("zone", e.target.value)}>
            <option value="">All zones</option>{ZONES.map(z => <option key={z}>{z}</option>)}
          </select>
          <select aria-label="Ward" value={f.ward} onChange={e => set("ward", Number(e.target.value))}>
            <option value={0}>All wards</option>{wardList.map(w => <option key={w.no} value={w.no}>{w.no} · {w.name}</option>)}
          </select>
          <input aria-label="Search" placeholder="Search number, landmark, ward" value={f.q} onChange={e => set("q", e.target.value)} />
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Priority</th><th>Complaint</th><th>Location</th><th>Status</th><th>Deadline</th><th>Reports</th></tr></thead>
            <tbody>
              {rows?.map(t => (
                <tr key={t.code} className="click" onClick={() => nav(`/admin/t/${t.code}`)}>
                  <td className="prio">{t.priority || "–"}</td>
                  <td><strong>{t.category_label}</strong> <SevPill s={t.severity} /><div className="sub"><span className="code">{t.code}</span> · {ago(t.created_at)}{t.is_demo ? " · demo" : ""}</div></td>
                  <td>Ward {t.ward_no} {t.ward_name}<div className="sub">{t.landmark || t.zone + " Zone"}</div></td>
                  <td><StatusPill t={t} />{t.escalated_to && <div className="sub">{t.escalated_to}</div>}</td>
                  <td style={{ color: t.overdue ? "var(--red)" : undefined }}>{fmtDay(t.due_at)}</td>
                  <td className="prio">{t.report_count}</td>
                </tr>
              ))}
              {rows && !rows.length && <tr><td colSpan={6} className="muted">Nothing matches these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Kpi({ v, k, alert }) {
  return <div className={`kpi ${alert ? "alert" : ""}`}><div className="v">{v}</div><div className="k">{k}</div></div>;
}

function Daily({ days }) {
  const max = Math.max(1, ...days.map(d => Math.max(d.reported, d.resolved)));
  return (
    <section className="panel">
      <div className="panel-h"><h2>Last 14 days</h2>
        <span className="legend" style={{ marginTop: 0 }}><span><i style={{ background: "var(--amber)" }} />Reported</span><span><i style={{ background: "var(--teal)" }} />Fixed</span></span>
      </div>
      <div className="bars" role="img" aria-label={`Reported and fixed complaints per day. Total reported ${days.reduce((a, d) => a + d.reported, 0)}, fixed ${days.reduce((a, d) => a + d.resolved, 0)}.`}>
        {days.map(d => (
          <div className="b" key={d.date} title={`${d.date}: ${d.reported} reported, ${d.resolved} fixed`}>
            <div className="col">
              <span className="rep" style={{ height: `${(d.reported / max) * 100}%` }} />
              <span className="res" style={{ height: `${(d.resolved / max) * 100}%` }} />
            </div>
            <small>{new Date(d.date).getDate()}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
