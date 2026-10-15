# NagarNetra: AI civic-issue agent for Ahmedabad

Citizens photograph a pothole, dead streetlight, garbage dump, leak or overflowing drain. NagarNetra's agent:

1. **Understands the photo** with IBM watsonx.ai (issue type, severity, observation, risk).
2. **Locates it** in one of the 48 Ahmedabad Municipal Corporation (AMC) wards and its zone.
3. **De-duplicates**: reports of the same issue within 50 m are merged, raising priority.
4. **Routes** it to the right AMC department with a deadline set by issue type and severity.
5. **Drafts the complaint** in English plus Gujarati or Hindi.
6. **Tracks and escalates**: a public tracking page, then automatic escalation to the Zonal Deputy Commissioner and the Deputy Municipal Commissioner when deadlines slip.
7. **Verifies the fix**: officials close a ticket with an "after" photo, which the AI compares with the original. Citizens can reopen a ticket within 14 days.

Faces are blurred and EXIF metadata is stripped from every photo before it is stored.

## What's in the box

| Part | Path | Tech |
|---|---|---|
| API, agent workflow, escalation job | `backend/app` | Python 3.12, FastAPI, SQLAlchemy |
| AI | `backend/app/ai.py` | IBM watsonx.ai chat API. The vision model is auto-picked from IBM's live catalog (Granite Vision if offered, otherwise Llama 4 Maverick) |
| Ward lookup | `backend/app/civic.py`, `backend/app/data/wards.geojson` | Shapely, DataMeet AMC ward boundaries |
| Privacy | `backend/app/images.py` | OpenCV face detection, Pillow |
| Web app (citizens + officials) | `frontend/` | React, Vite, Leaflet, OpenStreetMap |
| Tests | `backend/tests`, `tools/e2e_smoke.py` | pytest, Playwright |
| Deploy | `Dockerfile`, `render.yaml` | Render (app) + Supabase (Postgres) |

**Pages:** `/` report · `/track/AMD-10001` tracking · `/map` public map · `/admin` officials' dashboard · `/admin/team` accounts, AI status and demo data.

## Run it locally

```bash
python -m venv .venv
.venv/Scripts/pip install -r backend/requirements.txt      # macOS/Linux: .venv/bin/pip
cd frontend && npm install && npm run build && cd ..
cd backend
STATIC_DIR=../frontend/dist ../.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

Open http://localhost:8000. Officials sign in at `/admin` as `admin@nagarnetra.app` with password `nagarnetra-demo`. Without `DATABASE_URL` a local SQLite file is used. Without watsonx keys the app still works, and citizens choose the issue type themselves.

For frontend development with hot reload, run `npm run dev` in `frontend/`. It proxies `/api` to port 8000.

Tests: `cd backend && ../.venv/Scripts/python -m pytest -q`. To run the browser test against a running server: `.venv/Scripts/python tools/e2e_smoke.py http://localhost:8000 nagarnetra-demo`.

## Deploy (about 30 minutes, free tiers)

### 1. Database: Supabase
1. Create a free project at https://supabase.com and pick the **Mumbai (ap-south-1)** region.
2. Open **Connect** and copy the **Session pooler** connection string (port **5432**). Replace `[YOUR-PASSWORD]` with your database password. Use the session pooler: Render can't reach Supabase's direct IPv6 address, and the transaction pooler (port 6543) doesn't support the prepared statements this app uses.

The app creates its tables on first start.

### 2. AI: IBM watsonx.ai
1. Sign up at https://cloud.ibm.com and create a **watsonx.ai** service on the free **Lite** plan, in **Dallas (us-south)**.
2. Open watsonx.ai, create a **project**, and associate the watsonx.ai Runtime service with it (Project > Manage > Services and integrations).
3. Copy the **Project ID** from Project > Manage > General.
4. Create an API key at IBM Cloud > Manage > Access (IAM) > **API keys**.

If you use a region other than Dallas, set `WATSONX_URL` to match, for example `https://eu-de.ml.cloud.ibm.com`.

### 3. App: Render
1. Push this folder to a GitHub repository.
2. In Render, choose **New > Blueprint** and select the repository. Render reads `render.yaml`.
3. Paste `DATABASE_URL`, `WATSONX_APIKEY` and `WATSONX_PROJECT_ID` when asked.
4. Sign in at `https://<your-app>.onrender.com/admin` with the demo login shown on that page.
5. Check **Team > AI status**. It should show watsonx connected; the model name appears after the first photo is analysed.

The free Render plan sleeps after 15 minutes idle, and the first visit after that takes about a minute. **The app keeps itself awake.** Every 10 minutes it pings its own public address, which Render provides as `RENDER_EXTERNAL_URL`. Set `KEEPALIVE=false` to turn this off. One always-on service fits inside Render's 750 free hours a month, so don't run a second free service on the same Render account. For a backup and email alerts if the site goes down, add a free [UptimeRobot](https://uptimerobot.com) HTTP monitor on `https://<your-app>.onrender.com/api/health` every 5 minutes. `/api/health` doesn't query the database, so a serverless database like Neon can still sleep between real visits. Escalations run hourly, and also whenever an official opens the dashboard.

## Configuration

| Variable | Needed | Purpose |
|---|---|---|
| `DATABASE_URL` | In production | Postgres URL. SQLite is used if empty |
| `GEMINI_API_KEY` | For AI (option 1) | Google Gemini key from https://aistudio.google.com/apikey (free, no card). Used instead of watsonx when set |
| `GEMINI_MODEL` | No | Default `gemini-flash-latest`, falling back to `gemini-2.5-flash` |
| `WATSONX_APIKEY`, `WATSONX_PROJECT_ID` | For AI (option 2) | IBM Cloud API key and watsonx project |
| `WATSONX_URL` | No | Region endpoint (default Dallas) |
| `WATSONX_MODEL` | No | Force a model ID instead of auto-picking |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | No | First administrator account. Without a password the demo login `admin@nagarnetra.app` / `nagarnetra-demo` is used and shown on the sign-in page. It only takes effect when the database has no accounts yet |
| `SECRET_KEY` | No | Signs login sessions. Derived from `DATABASE_URL` if not set |
| `KEEPALIVE`, `KEEPALIVE_URL` | No | Self-ping to stop free hosting from sleeping. On by default; uses Render's `RENDER_EXTERNAL_URL` unless `KEEPALIVE_URL` is set |
| `SEED_DEMO` | No | `true` loads 14 example complaints on an empty database. Remove them from Team > Demo data |

## Data and limits
- **Ward boundaries** come from [DataMeet Municipal Spatial Data](https://github.com/datameet/Municipal_Spatial_Data/tree/master/Ahmedabad) (CC BY-SA 2.5 IN), originally from AMC's public map. They follow the 48-ward delimitation and contain small errors at some edges. Regenerate them with `tools/prepare_wards.py`.
- **Ward-to-zone mapping** (`ZONES` in `tools/prepare_wards.py`) is a best-effort list. Check it against the current AMC zone list before relying on zone-level escalation.
- **Departments and deadlines** are in `CATEGORIES` in `backend/app/civic.py`.
- NagarNetra is **not connected to AMC's own grievance system**. Complaints are routed to department accounts inside NagarNetra, and the drafted complaint text can be copied into official channels.
- Photos are stored in the database (about 150–300 KB each). The free Supabase tier holds a few thousand.
