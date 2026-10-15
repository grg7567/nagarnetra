import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Key, WarningCircle } from "@phosphor-icons/react";
import { useApp } from "../App.jsx";
import { api } from "../api.js";

export default function Login() {
  const { user, setUser, config } = useApp();
  const demo = config?.demo_login;
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/admin" replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try { setUser(await api.post("/api/auth/login", { email, password })); nav("/admin"); }
    catch (err) { setError(err.message); }
    setBusy(false);
  }

  return (
    <div className="wrap" style={{ maxWidth: 440, paddingTop: 24 }}>
      <form className="card pad-lg stack" style={{ gap: 18 }} onSubmit={submit}>
        <div className="stack-sm">
          <h1 style={{ fontSize: 30 }}>Officials sign in</h1>
          <p className="muted">For AMC ward offices, departments and administrators.</p>
        </div>
        {demo && (
          <div className="msg info" style={{ display: "grid", gap: 10 }}>
            <span className="row" style={{ gap: 8, fontWeight: 600, color: "var(--ink)" }}><Key size={18} />Demo access</span>
            <span className="code">{demo.email}<br />{demo.password}</span>
            <div><button type="button" className="btn sm" onClick={() => { setEmail(demo.email); setPassword(demo.password); }}>Fill in demo login</button></div>
          </div>
        )}
        <label className="field"><span className="label">Email</span><input id="email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label className="field"><span className="label">Password</span><input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {error && <p className="msg error"><WarningCircle size={18} weight="fill" /><span>{error}</span></p>}
        <button className="btn primary lg" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
