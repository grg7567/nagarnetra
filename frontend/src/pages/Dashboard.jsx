import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer } from "react-leaflet";
import { useNavigate } from "react-router-dom";
import { ArrowClockwise, MagnifyingGlass } from "@phosphor-icons/react";
import { useApp } from "../App.jsx";
import { ago, api, fmtDay } from "../api.js";
import { AMD_CENTER, CategoryIcon, Legend, SevPill, StatusPill, Tiles, TicketMarkers, useInterval, WardLayer } from "../components.jsx";

const ZONES = ["Central", "East", "North", "North West", "South", "South West", "West"];

export default function Dashboard() {
  const { config, wards, user } = useApp();
  const nav = useNavigate();
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [f, setF] = useState({ status: "open", department: "", zone: "", ward: 0, q: "" });

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
    <div className="wrap stack" style={{ gap: 20 }}>
      <div className="row between">
        <div className="stack-sm" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 32 }}>Complaints</h1>
          <p className="muted">{user.department || "All departments"}, Ahmedabad Municipal Corporation</p>
        </div>
        <button className="btn sm" onClick={load}><ArrowClockwise size={16} />Refresh</button>
      </div>
      {error && <p className="msg error">{error}</p>}

      <div className="kpis">
        <Kpi v={stats?.open} k="Open" />
        <Kpi v={stats?.overdue} k="Overdue" alert={stats?.overdue > 0} />
        <Kpi v={stats?.critical_open} k="Critical open" alert={stats?.critical_open > 0} />
        <Kpi v={stats?.resolved} k="Fixed" />
        <Kpi v={hrs == null ? "–" : hrs < 48 ? `${Math.round(hrs)}h` : `${(hrs / 24).toFixed(1)}d`} k="Median time to fix" />
        <Kpi v={stats?.on_time_rate == null ? "–" : `${Math.round(stats.on_time_rate * 100)}%`} k="Fixed on time" />
      </div>

      <div className="dash">
        <section className="card stack" style={{ gap: 14 }}>
          <div className="row between"><h3>Open complaints by ward</h3><span className="muted xs">Click a ward to filter</span></div>
          <MapContainer className="map tall" center={AMD_CENTER} zoom={12} style={{ height: 480 }}>
            <Tiles />
            <WardLayer wards={wards} counts={stats?.by_ward} onWard={w => set("ward", w.no)} />
            {rows && <TicketMarkers tickets={rows} linkPrefix="/admin/t/" />}
          </MapContainer>
          <Legend />
        </section>
        <div className="stack" style={{ gap: 20 }}>
          {stats && <Daily days={stats.daily} />}
          {stats && (
            <section className="card">
              <h3 style={{ marginBottom: 10 }}>By department</h3>
              <div className="dept-row head"><span>Department</span><span>Open</span><span>Overdue</span></div>
              {Object.entries(stats.by_department).sort((a, b) => b[1].open - a[1].open).map(([d, v]) => (
                <button key={d} className="dept-row" onClick={() => set("department", d)} style={{ cursor: "pointer" }}>
                  <span>{d}</span><span>{v.open}</span><span style={{ color: v.overdue ? "var(--sev-critical)" : undefined }}>{v.overdue}</span>
                </button>
              ))}
              {!Object.keys(stats.by_department).length && <p className="muted small">No open complaints.</p>}
            </section>
          )}
        </div>
      </div>

      <section className="card stack" style={{ gap: 14 }}>
        <div className="row between"><h3>Work queue</h3><span className="muted xs">Ranked by severity, number of reports and days overdue</span></div>
        <div className="filters">
          <div style={{ position: "relative" }}>
            <MagnifyingGlass size={17} style={{ position: "absolute", left: 13, top: 12, color: "var(--muted)" }} />
            <input aria-label="Search" type="search" placeholder="Number, landmark or ward" value={f.q} onChange={e => set("q", e.target.value)} style={{ paddingLeft: 38 }} />
          </div>
          <select aria-label="Status" value={f.status} onChange={e => set("status", e.target.value)}>
            <option value="open">Open</option><option value="overdue">Overdue</option><option value="new">New</option>
            <option value="assigned">Assigned</option><option value="in_progress">Work started</option>
            <option value="resolved">Fixed</option><option value="rejected">Rejected</option><option value="all">All</option>
          </select>
          {user.department ? <span /> : (
            <select aria-label="Department" value={f.department} onChange={e => set("department", e.target.value)}>
              <option value="">All departments</option>{depts.map(d => <option key={d}>{d}</option>)}
            </select>
          )}
          <select aria-label="Zone" value={f.zone} onChange={e => set("zone", e.target.value)}>
            <option value="">All zones</option>{ZONES.map(z => <option key={z}>{z}</option>)}
          </select>
          <select aria-label="Ward" value={f.ward} onChange={e => set("ward", Number(e.target.value))}>
            <option value={0}>All wards</option>{wardList.map(w => <option key={w.no} value={w.no}>{w.no} {w.name}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Complaint</th><th>Location</th><th>Status</th><th>Deadline</th><th style={{ textAlign: "right" }}>Reports</th><th style={{ textAlign: "right" }}>Priority</th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={6}><div className="skeleton" style={{ background: "none", padding: 0 }}><i /><i style={{ width: "70%" }} /></div></td></tr>}
              {rows?.map(t => (
                <tr key={t.code} className="click" onClick={() => nav(`/admin/t/${t.code}`)}>
                  <td>
                    <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
                      <CategoryIcon id={t.category} size={20} style={{ color: "var(--muted)", flex: "none" }} />
                      <div><div className="row" style={{ gap: 8 }}><strong>{t.category_label}</strong><SevPill s={t.severity} /></div>
                        <div className="sub"><span className="code">{t.code}</span>, {ago(t.created_at)}{t.is_demo ? ", demo" : ""}</div></div>
                    </div>
                  </td>
                  <td>Ward {t.ward_no} {t.ward_name}<div className="sub">{t.landmark || `${t.zone} Zone`}</div></td>
                  <td><StatusPill t={t} />{t.escalated_to && <div className="sub">{t.escalated_to}</div>}</td>
                  <td style={{ color: t.overdue ? "var(--sev-critical)" : undefined, whiteSpace: "nowrap" }}>{fmtDay(t.due_at)}</td>
                  <td className="num" style={{ textAlign: "right" }}>{t.report_count}</td>
                  <td className="num" style={{ textAlign: "right" }}>{t.priority || "–"}</td>
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
  return <div className={alert ? "alert" : ""}><b>{v ?? "–"}</b><span>{k}</span></div>;
}

function Daily({ days }) {
  const max = Math.max(1, ...days.map(d => Math.max(d.reported, d.resolved)));
  const rep = days.reduce((a, d) => a + d.reported, 0), res = days.reduce((a, d) => a + d.resolved, 0);
  return (
    <section className="card stack" style={{ gap: 14 }}>
      <div className="row between">
        <h3>Last 14 days</h3>
        <span className="legend"><span><i style={{ background: "var(--accent)" }} />Reported {rep}</span><span><i style={{ background: "var(--ok)" }} />Fixed {res}</span></span>
      </div>
      <div className="bars" role="img" aria-label={`${rep} complaints reported and ${res} fixed in the last 14 days.`}>
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
