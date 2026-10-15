export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(path, { method = "GET", body, form } = {}) {
  const opts = { method, credentials: "same-origin", headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["Content-Type"] = "application/json"; }
  let res;
  try { res = await fetch(path, opts); }
  catch { throw new ApiError("Can't reach the server. Check your internet connection and try again.", 0); }
  const isJson = res.headers.get("content-type")?.includes("json");
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    let msg = data?.detail;
    if (Array.isArray(msg)) msg = msg.map(d => d.msg).join(". ");
    throw new ApiError(msg || `Something went wrong (error ${res.status}).`, res.status);
  }
  return data;
}

export const api = {
  get: p => request(p),
  post: (p, body) => request(p, { method: "POST", body }),
  patch: (p, body) => request(p, { method: "PATCH", body }),
  del: p => request(p, { method: "DELETE" }),
  form: (p, form) => request(p, { method: "POST", form }),
};

// ---------- formatting ----------
const IST = { timeZone: "Asia/Kolkata" };
export const fmtDate = iso => new Date(iso).toLocaleString("en-IN", { ...IST, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const fmtDay = iso => new Date(iso).toLocaleDateString("en-IN", { ...IST, day: "numeric", month: "short", year: "numeric" });
export function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export const STATUS_LABEL = { new: "New", assigned: "Assigned", in_progress: "Work started", resolved: "Fixed", rejected: "Rejected" };
export const SEV_COLOR = { critical: "var(--red)", high: "var(--orange)", medium: "var(--amber)", low: "var(--teal)" };

// ---------- geometry ----------
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function wardAt(wards, lat, lng) {
  if (!wards) return null;
  for (const f of wards.features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const p of polys) {
      if (inRing(lng, lat, p[0]) && !p.slice(1).some(h => inRing(lng, lat, h))) return f.properties;
    }
  }
  return null;
}

// ---------- photos ----------
// Downscale big photos before upload. Only when we already have a location: re-encoding drops EXIF GPS.
export async function shrinkPhoto(file, maxSide = 2000) {
  if (file.size < 1.5e6) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const r = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, "image/jpeg", 0.86));
    return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
