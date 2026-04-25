# WorldsCheckIn

WorldsCheckIn is an event-scoped team check-in app for RobotEvents events.

It has:
- a `backend/` service built with Node.js, Express, PostgreSQL, and Docker Compose
- a `frontend/` app built with React and Vite
- a Tampermonkey sync script in `scripts/tampermonkey-checkin-sync.user.js` that downloads the protected RobotEvents checked-in report from your logged-in browser session and uploads it to the backend

## Project Structure

- `backend/`: API, database migrations, Docker deploy script
- `frontend/`: React app, Vite dev server, Docker deploy script
- `scripts/`: shared shell helpers and the Tampermonkey script template

## Requirements

- Git
- Node.js 22+ and npm
- Docker with Docker Compose
- A RobotEvents API key
- A browser with Tampermonkey installed for the checked-in report sync

## Quick Start After Cloning

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd WorldsCheckIn
```

### 2. Deploy the backend

```bash
cd backend
npm run deploy
```

What backend deploy does:
- creates `backend/.env` automatically if it does not exist
- keeps these database settings hardcoded:

```env
PORT=4000
POSTGRES_DB=worldscheckin
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_PORT=5432
DATABASE_URL=postgresql://postgres:postgres@db:5432/worldscheckin
```

- generates `ROBOTEVENTS_SYNC_TOKEN` if missing
- lists your machine’s IPv4 interfaces and asks which frontend IPs should be allowed in `CORS_ALLOWED_ORIGINS`
- always includes `http://localhost:5173` in `CORS_ALLOWED_ORIGINS`
- starts Postgres
- runs migrations
- builds and starts the backend container
- updates the Tampermonkey template with the current sync token

### 3. Add your RobotEvents API key

After backend deploy, open:

[`backend/.env`](backend/.env)

and set:

```env
ROBOTEVENTS_API_KEY=your_real_robot_events_api_key
```

Then redeploy the backend:

```bash
cd backend
npm run deploy
```

### 4. Deploy the frontend

```bash
cd frontend
npm run deploy
```

What frontend deploy does:
- creates `frontend/.env` automatically if it does not exist
- lists your machine’s IPv4 interfaces and asks which backend IP should be used for `VITE_API_BASE_URL`
- builds the frontend Docker image
- starts the Nginx frontend container
- updates the Tampermonkey template with the current backend base URL

### 5. Install the Tampermonkey sync script

Open:

[`scripts/tampermonkey-checkin-sync.user.js`](scripts/tampermonkey-checkin-sync.user.js)

After backend and frontend deploy, that file will have:
- `backendBaseUrl` set automatically
- `syncToken` set automatically

Copy that script into Tampermonkey and enable it.

The script runs on RobotEvents check-in admin pages and:
- downloads the `checkedInReport`
- converts the RobotEvents `.xlsx` workbook to CSV in the browser
- uploads the CSV to the backend

### 6. Use the app

Open the frontend at:

```text
http://localhost:8080
```

or on your server/LAN IP:

```text
http://<your-ip>:8080
```

Then:
1. Import an event by RobotEvents event code
2. Open that event dashboard
3. Use the Tampermonkey script while logged into the matching RobotEvents admin `checkIn` page

## Local Development

### Backend dev

```bash
cd backend
npm install
npm run dev
```

### Frontend dev

```bash
cd frontend
npm install
npm run dev -- --host
```

Notes:
- Vite dev defaults to port `5173`
- `--host` exposes it on your LAN so other devices can reach it
- backend CORS deploy always includes `http://localhost:5173`

## Deploy Scripts

### Backend

```bash
cd backend
npm run deploy
```

### Frontend

```bash
cd frontend
npm run deploy
```

Both deploy scripts:
- detect IPv4 interfaces on macOS and Linux
- prompt you for the IPs they should use
- update their local `.env` files

## Important Runtime Files

- `backend/.env`: real backend configuration
- `frontend/.env`: real frontend configuration
- `scripts/tampermonkey-checkin-sync.user.js`: Tampermonkey template, updated by deploy scripts

## Notes

- `ROBOTEVENTS_API_KEY` is not auto-generated, because it must come from RobotEvents
- the Tampermonkey script must still be re-copied into Tampermonkey after deploy if you want the updated backend URL or sync token
- the frontend dashboard refreshes periodically to pick up new synced team data
