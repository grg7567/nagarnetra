import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Camera, List, MagnifyingGlass, MapTrifold, ShieldCheck, SignOut, SquaresFour, Users, X } from "@phosphor-icons/react";
import { api } from "./api.js";
import Home from "./pages/Home.jsx";
// Everything except the landing page loads on demand, so the first visit stays light.
const Report = lazy(() => import("./pages/Report.jsx"));
const Track = lazy(() => import("./pages/Track.jsx"));
const CityMap = lazy(() => import("./pages/CityMap.jsx"));
const Login = lazy(() => import("./pages/Login.jsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const AdminTicket = lazy(() => import("./pages/AdminTicket.jsx"));
const Team = lazy(() => import("./pages/Team.jsx"));

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export default function App() {
  const [config, setConfig] = useState(null);
  const [wards, setWards] = useState(null);
  const [user, setUser] = useState(undefined); // undefined = still checking
  const [menu, setMenu] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    api.get("/api/config").then(setConfig).catch(() => setConfig({ ai_enabled: false, categories: [], severities: [], languages: [] }));
    api.get("/api/wards").then(setWards).catch(() => {});
    api.get("/api/auth/me").then(setUser).catch(() => setUser(null));
  }, []);
  useEffect(() => { setMenu(false); window.scrollTo({ top: 0 }); }, [loc.pathname]);

  const signOut = useCallback(async () => {
    await api.post("/api/auth/logout").catch(() => {});
    setUser(null);
    nav("/");
  }, [nav]);

  const links = user
    ? [["/admin", "Dashboard", SquaresFour], ["/map", "City map", MapTrifold], ...(user.role === "admin" ? [["/admin/team", "Team", Users]] : [])]
    : [["/track", "Track", MagnifyingGlass], ["/map", "City map", MapTrifold], ["/admin", "Officials", ShieldCheck]];
  const fullBleed = loc.pathname === "/map";

  return (
    <Ctx.Provider value={{ config, wards, user, setUser }}>
      <header className="topbar">
        <div className="wrap">
          <Link to={user ? "/admin" : "/"} className="brand" aria-label="NagarNetra home">
            <img src="/favicon.svg" alt="" />
            <b>NagarNetra</b><span>Ahmedabad</span>
          </Link>
          <nav className="nav" aria-label="Main">
            {links.map(([to, label]) => <NavLink key={to} to={to} end className="hide-sm">{label}</NavLink>)}
            {user
              ? <button className="link hide-sm" onClick={signOut}>Sign out</button>
              : <Link to="/report" className="btn primary sm" style={{ marginLeft: 8 }}><Camera size={17} weight="bold" />Report</Link>}
            <button className="btn ghost icon-btn menu-btn" aria-label={menu ? "Close menu" : "Open menu"} aria-expanded={menu} onClick={() => setMenu(m => !m)}>
              {menu ? <X size={22} /> : <List size={22} />}
            </button>
          </nav>
        </div>
      </header>
      {menu && (
        <div className="sheet" role="menu">
          {links.map(([to, label, Icon]) => <Link key={to} to={to} role="menuitem"><Icon size={20} />{label}</Link>)}
          {user && <button role="menuitem" onClick={signOut}><SignOut size={20} />Sign out</button>}
        </div>
      )}
      <main className={fullBleed ? "flush" : ""}>
        <Suspense fallback={<div className="wrap"><div className="skeleton"><i style={{ width: "35%" }} /><i style={{ width: "65%" }} /></div></div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/report" element={<Report />} />
          <Route path="/track" element={<Track />} />
          <Route path="/track/:code" element={<Track />} />
          <Route path="/map" element={<CityMap />} />
          <Route path="/admin/login" element={<Login />} />
          <Route path="/admin" element={<Guard><Dashboard /></Guard>} />
          <Route path="/admin/t/:code" element={<Guard><AdminTicket /></Guard>} />
          <Route path="/admin/team" element={<Guard admin><Team /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>
      {!fullBleed && (
        <footer className="site">
          <div className="wrap">
            <p>NagarNetra is a civic-tech project built for IBM SkillsBuild. It is not an official Ahmedabad Municipal Corporation service.</p>
            <p>Ward boundaries: <a href="https://github.com/datameet/Municipal_Spatial_Data" target="_blank" rel="noreferrer">DataMeet</a> (CC BY-SA 2.5 IN). Map © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors. Photos via Wikimedia Commons: Ninara (CC BY 2.0), KEmel49 (CC BY-SA 4.0), Sgmanna (CC BY-SA 4.0).</p>
          </div>
        </footer>
      )}
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
