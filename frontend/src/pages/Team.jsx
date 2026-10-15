import { useEffect, useMemo, useState } from "react";
import { useApp } from "../App.jsx";
import { api, fmtDate } from "../api.js";

export default function Team() {
  const { config, user } = useApp();
  const [users, setUsers] = useState([]);
  const [ai, setAi] = useState(null);
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "official", department: "" });
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [confirmDemo, setConfirmDemo] = useState(false);
  const depts = useMemo(() => [...new Set((config?.categories || []).map(c => c.dept))], [config]);

  const load = () => {
    api.get("/api/admin/users").then(setUsers).catch(e => setError(e.message));
    api.get("/api/admin/ai-status").then(setAi).catch(() => {});
  };
  useEffect(load, []);

  async function add(e) {
    e.preventDefault(); setError(""); setMsg("");
    try { await api.post("/api/admin/users", form); setMsg(`Account created for ${form.email}. Share the password with them securely.`); setForm({ email: "", name: "", password: "", role: "official", department: "" }); load(); }
    catch (err) { setError(err.message); }
  }
  async function toggle(u) {
    try { await api.post(`/api/admin/users/${u.id}/active`, { active: !u.active }); load(); } catch (e) { setError(e.message); }
  }
  async function clearDemo() {
    try { const r = await api.del("/api/admin/demo"); setMsg(`Removed ${r.deleted} demo complaints.`); setConfirmDemo(false); } catch (e) { setError(e.message); }
  }

  return (
    <div className="wrap stack" style={{ maxWidth: 980 }}>
      <h1>Team and settings</h1>
      {error && <p className="error">{error}</p>}
      {msg && <p className="ok">{msg}</p>}

      <section className="panel stack" style={{ gap: 12 }}>
        <h2>Accounts</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Department</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>{u.email}</td><td>{u.name}</td><td>{u.role}</td><td>{u.department || "All"}</td><td>{u.active ? "Active" : "Disabled"}</td>
                  <td>{u.id !== user.id && <button className="btn sm" onClick={() => toggle(u)}>{u.active ? "Disable" : "Enable"}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="stack" style={{ gap: 10 }} onSubmit={add}>
          <h3>Add an official</h3>
          <div className="grid2">
            <label className="field"><span>Email</span><input id="new-email" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
            <label className="field"><span>Name</span><input id="new-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field"><span>Temporary password <em>(8+ characters)</em></span><input id="new-password" type="text" minLength={8} required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
            <label className="field"><span>Department</span>
              <select id="new-dept" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>
                <option value="">All departments</option>{depts.map(d => <option key={d}>{d}</option>)}
              </select>
            </label>
            <label className="field"><span>Role</span>
              <select id="new-role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                <option value="official">Official</option><option value="admin">Administrator</option>
              </select>
            </label>
          </div>
          <div><button className="btn teal">Create account</button></div>
        </form>
      </section>

      <section className="panel stack" style={{ gap: 10 }}>
        <h2>AI status</h2>
        {ai && (
          <dl className="kv">
            <dt>watsonx.ai</dt><dd>{ai.configured ? "Connected" : "Not configured. Citizens choose the issue type themselves."}</dd>
            <dt>Region</dt><dd>{ai.region}</dd>
            <dt>Model</dt><dd>{ai.model || "Picked on first use"}</dd>
            <dt>Last success</dt><dd>{ai.last_ok ? fmtDate(new Date(ai.last_ok * 1000).toISOString()) : "None yet"}</dd>
            {ai.last_error && <><dt>Last error</dt><dd style={{ color: "var(--red)" }}>{ai.last_error}</dd></>}
          </dl>
        )}
      </section>

      <section className="panel stack" style={{ gap: 10 }}>
        <h2>Demo data</h2>
        <p className="muted">The app starts with 14 example complaints so the dashboard isn't empty. Remove them before a real pilot.</p>
        {!confirmDemo
          ? <div><button className="btn danger" onClick={() => setConfirmDemo(true)}>Remove demo complaints</button></div>
          : <div className="row"><span>Delete all demo complaints for good?</span><button className="btn danger" onClick={clearDemo}>Yes, delete</button><button className="btn" onClick={() => setConfirmDemo(false)}>Cancel</button></div>}
      </section>
    </div>
  );
}
