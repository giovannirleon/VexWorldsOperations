# WorldsCheckIn

WorldsCheckIn is an event-scoped team check-in system for RobotEvents events.

This repo contains:
- `backend/`: Node.js + Express API, PostgreSQL migrations, Docker deploy flow
- `frontend/`: React app, Docker deploy flow
- `scripts/tampermonkey-checkin-sync.user.js`: browser-side Tampermonkey sync script for RobotEvents checked-in report uploads

## Deployment Overview

After pulling from GitHub, the normal deployment order is:

1. deploy the backend
2. deploy the frontend
3. install/update the Tampermonkey script
4. import an event in the app
5. run the Tampermonkey sync while logged into RobotEvents

The deploy scripts are designed to:
- create missing `.env` files automatically
- prompt for interface/IP selection
- update the Tampermonkey template with the correct backend URL and sync token

## Requirements

- Git
- Node.js 22+
- npm
- Docker with Docker Compose
- A RobotEvents API key
- A browser with Tampermonkey installed

## Standard Deployment Flow

This is the default path for macOS and Linux, and also for Windows if you are working inside WSL.

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
- creates `backend/.env` if it does not exist
- keeps these database settings hardcoded:

```env
PORT=4000
POSTGRES_DB=worldscheckin
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_PORT=5432
DATABASE_URL=postgresql://postgres:postgres@db:5432/worldscheckin
```

- prompts for `ROBOTEVENTS_API_KEY` if it is missing
- generates `ROBOTEVENTS_SYNC_TOKEN` if it is missing
- asks which outward-facing frontend IPs should be allowed in `CORS_ALLOWED_ORIGINS`
- always includes `http://localhost:5173` in `CORS_ALLOWED_ORIGINS`
- starts PostgreSQL
- runs migrations
- builds and starts the backend container
- updates the Tampermonkey template with the current `syncToken`

After deploy, backend should be reachable at:

```text
http://localhost:4000
```

or on the selected LAN-facing IP:

```text
http://YOUR_IP:4000
```

### 3. Deploy the frontend

```bash
cd frontend
npm run deploy
```

What frontend deploy does:
- creates `frontend/.env` if it does not exist
- asks which backend IP should be used for `VITE_API_BASE_URL`
- installs dependencies on the host
- builds the frontend on the host
- builds a lightweight Nginx image that serves the generated `dist/`
- starts the frontend container
- updates the Tampermonkey template with the current `backendBaseUrl`

After deploy, frontend should be reachable at:

```text
http://localhost:8080
```

or on the selected LAN-facing IP:

```text
http://YOUR_IP:8080
```

### 4. Install the Tampermonkey script

Open this file:

[`scripts/tampermonkey-checkin-sync.user.js`](scripts/tampermonkey-checkin-sync.user.js)

That file is the Tampermonkey template. The deploy scripts automatically populate:
- `backendBaseUrl`
- `syncToken`

To install it:
1. open Tampermonkey
2. create a new script
3. paste the contents of `scripts/tampermonkey-checkin-sync.user.js`
4. save and enable it

### 5. Use the app

1. Open the frontend
2. Import an event by RobotEvents event code
3. Open that event dashboard
4. In your browser, go to the matching RobotEvents admin `checkIn` page
5. Let the Tampermonkey script upload the checked-in report to the backend

## Windows Deployment Branch

If you are deploying from Windows and the app must be visible to other devices on the local network, use **WSL mirrored networking**.

Run these commands in **Windows PowerShell as Administrator** before running the normal deployment flow inside WSL.

### 1. Enable mirrored mode for WSL

```powershell
@"
[wsl2]
networkingMode=mirrored
"@ | Set-Content "$env:USERPROFILE\.wslconfig"
```

### 2. Restart WSL

```powershell
wsl --shutdown
```

### 3. Open Windows Firewall for ports 4000 and 8080

```powershell
New-NetFirewallRule -DisplayName "VexWorldsOperations 4000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4000
New-NetFirewallRule -DisplayName "VexWorldsOperations 8080" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080
```

### 4. If LAN traffic is still blocked, allow inbound Hyper-V mirrored traffic

This is not always required. Use it only if mirrored mode plus normal firewall rules still do not allow inbound access.

```powershell
Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow
```

### 5. Start WSL again

```powershell
wsl
```

### 6. Run the normal deployment flow inside WSL

From your WSL shell:

```bash
cd ~/WorldsCheckIn/backend
npm run deploy

cd ../frontend
npm run deploy
```

### 7. Verify from another LAN device

Use the Windows machine’s LAN IP:

```text
http://YOUR_WINDOWS_LAN_IP:4000
http://YOUR_WINDOWS_LAN_IP:8080
```

## How Interface Selection Works

The deploy scripts ask which IPs to use because the app needs outward-facing addresses for:
- `VITE_API_BASE_URL`
- `CORS_ALLOWED_ORIGINS`

Behavior by environment:
- macOS: uses macOS interfaces
- Linux: uses Linux interfaces
- WSL: uses Windows host outward-facing interfaces, not the private WSL NAT address

## Important Runtime Files

- `backend/.env`: real backend configuration
- `frontend/.env`: real frontend configuration
- `scripts/tampermonkey-checkin-sync.user.js`: Tampermonkey template updated by deploy scripts

## Notes

- `ROBOTEVENTS_API_KEY` is not auto-generated, because it must come from RobotEvents
- `ROBOTEVENTS_SYNC_TOKEN` is generated automatically if missing
- if you rerun deploy and the values change, re-copy the Tampermonkey script into Tampermonkey
- the frontend dashboard refreshes periodically so new synced data appears without a manual reload

## Optional Local Development

If you are doing development instead of deployment:

### Backend

```bash
cd backend
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev -- --host
```

Vite dev normally runs on:

```text
http://localhost:5173
```
