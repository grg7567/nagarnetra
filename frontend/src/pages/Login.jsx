import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useApp } from "../App.jsx";
import { api } from "../api.js";

export default function Login() {
  const { user, setUser } = useApp();
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
    <div className="wrap" style={{ maxWidth: 440 }}>
      <form className="panel stack" onSubmit={submit}>
        <div className="stack" style={{ gap: 6 }}>
          <p className="eyebrow">AMC officials</p>
          <h1>Sign in</h1>
          <p className="muted">For ward offices, department teams and administrators.</p>
        </div>
        <label className="field"><span>Email</span><input id="email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label className="field"><span>Password</span><input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
