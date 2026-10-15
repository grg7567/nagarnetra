import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { api } from "./api.js";
import Report from "./pages/Report.jsx";
import Track from "./pages/Track.jsx";
import CityMap from "./pages/CityMap.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import AdminTicket from "./pages/AdminTicket.jsx";
import Team from "./pages/Team.jsx";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export default function App() {
  const [config, setConfig] = useState(null);
  const [wards, setWards] = useState(null);
  const [user, setUser] = useState(undefined); // undefined = still checking
  const nav = useNavigate();

  useEffect(() => {
    api.get("/api/config").then(setConfig).catch(() => setConfig({ ai_enabled: false, categories: [], severities: [], languages: [] }));
    api.get("/api/wards").then(setWards).catch(() => {});
    api.get("/api/auth/me").then(setUser).catch(() => setUser(null));
  }, []);

  const signOut = useCallback(async () => {
    await api.post("/api/auth/logout").catch(() => {});
    setUser(null);
    nav("/");
  }, [nav]);

  return (
    <Ctx.Provider value={{ config, wards, user, setUser }}>
      <header className="band">
        <div className="wrap">
          <NavLink to="/" className="brand">
            <img src="/favicon.svg" alt="" />
            <span><b>NagarNetra</b><small>Ahmedabad · AMC civic issues</small></span>
          </NavLink>
          <nav className="nav" aria-label="Main">
            {user ? (
              <>
                <NavLink to="/admin" end>Dashboard</NavLink>
                <NavLink to="/map">City map</NavLink>
                {user.role === "admin" && <NavLink to="/admin/team">Team</NavLink>}
                <button onClick={signOut}>Sign out</button>
              </>
            ) : (
              <>
                <NavLink to="/" end className="cta">Report</NavLink>
                <NavLink to="/track">Track</NavLink>
                <NavLink to="/map">City map</NavLink>
                <NavLink to="/admin">Officials</NavLink>
              </>
            )}
          </nav>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Report />} />
          <Route path="/track" element={<Track />} />
          <Route path="/track/:code" element={<Track />} />
          <Route path="/map" element={<CityMap />} />
          <Route path="/admin/login" element={<Login />} />
          <Route path="/admin" element={<Guard><Dashboard /></Guard>} />
          <Route path="/admin/t/:code" element={<Guard><AdminTicket /></Guard>} />
          <Route path="/admin/team" element={<Guard admin><Team /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="wrap">
        <p>NagarNetra is an independent civic-tech project built for IBM SkillsBuild. It is not an official Ahmedabad Municipal Corporation service; complaints are routed to AMC departments inside this system.</p>
        <p>Ward boundaries: DataMeet Municipal Spatial Data (CC BY-SA 2.5 IN). Map data © OpenStreetMap contributors.{config?.ai_provider ? ` Photo analysis by ${config.ai_provider}.` : ""}</p>
      </footer>
    </Ctx.Provider>
  );
}

function Guard({ children, admin }) {
  const { user } = useApp();
  if (user === undefined) return <div className="wrap muted">Loading…</div>;
  if (!user) return <Navigate to="/admin/login" replace />;
  if (admin && user.role !== "admin") return <Navigate to="/admin" replace />;
  return children;
}
