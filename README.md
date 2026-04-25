# WorldsCheckIn

WorldsCheckIn is a deployment-first check-in system for RobotEvents events.

This repo contains:
- `backend/`: Node.js API, PostgreSQL migrations, Docker deployment
- `frontend/`: React app served by Nginx
- `scripts/tampermonkey-checkin-sync.user.js`: browser-side RobotEvents sync script

## What You Need

- Git
- Node.js 22+
- npm
- Docker with Docker Compose
- A RobotEvents API key
- A browser with Tampermonkey installed

## Deployment Flow

After pulling from GitHub, the normal order is:

1. deploy the backend
2. deploy the frontend
3. install the Tampermonkey script
4. import an event
5. run sync from the RobotEvents admin `checkIn` page

## Start Here

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd WorldsCheckIn
```

### 2. Choose your deployment branch

- macOS or Linux: continue to [Standard Deployment](#standard-deployment)
- Windows with WSL and local-network access required: do [Windows / WSL Setup](#windows--wsl-setup) first, then continue to [Standard Deployment](#standard-deployment)
- Windows without WSL: not recommended for this repo

## Standard Deployment

### 1. Deploy the backend

```bash
cd backend
npm run deploy
```

What backend deploy does:
- creates `backend/.env` if it is missing
- keeps these values fixed:

```env
PORT=4000
POSTGRES_DB=worldscheckin
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_PORT=5432
DATABASE_URL=postgresql://postgres:postgres@db:5432/worldscheckin
```

- prompts for `ROBOTEVENTS_API_KEY` if missing
- generates `ROBOTEVENTS_SYNC_TOKEN` if missing
- asks which outward-facing frontend IPs to allow in `CORS_ALLOWED_ORIGINS`
- always includes `http://localhost:5173`
- starts PostgreSQL
- runs migrations
- builds and starts the backend container
- updates the Tampermonkey template `syncToken`

Expected backend URLs:

```text
http://localhost:4000
http://YOUR_IP:4000
```

### 2. Deploy the frontend

```bash
cd ../frontend
npm run deploy
```

What frontend deploy does:
- creates `frontend/.env` if it is missing
- asks which backend IP to use for `VITE_API_BASE_URL`
- installs frontend dependencies on the host
- builds the frontend on the host
- builds a lightweight Nginx image that serves `dist/`
- starts the frontend container
- updates the Tampermonkey template `backendBaseUrl`

Expected frontend URLs:

```text
http://localhost:8080
http://YOUR_IP:8080
```

### 3. Install the Tampermonkey script

Open:

[`scripts/tampermonkey-checkin-sync.user.js`](scripts/tampermonkey-checkin-sync.user.js)

The deploy scripts automatically stamp this file with:
- `backendBaseUrl`
- `syncToken`

To install it:
1. open Tampermonkey
2. create a new script
3. paste in the contents of `scripts/tampermonkey-checkin-sync.user.js`
4. save and enable it

### 4. Use the app

1. open the frontend
2. import an event by RobotEvents event code
3. open that event dashboard
4. open the matching RobotEvents admin `checkIn` page in the same browser
5. let the Tampermonkey script upload the checked-in report

## Windows / WSL Setup

Use this branch only if you are deploying from Windows and want the app reachable from other devices on your local network.

### 1. Enable mirrored networking

Run in Windows PowerShell as Administrator:

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

### 3. Open Windows Firewall for app ports

```powershell
New-NetFirewallRule -DisplayName "VexWorldsOperations 4000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4000
New-NetFirewallRule -DisplayName "VexWorldsOperations 8080" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080
```

### 4. Only if inbound traffic is still blocked, allow Hyper-V mirrored traffic

```powershell
Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow
```

### 5. Start WSL again

```powershell
wsl
```

### 6. Run standard deployment inside WSL

```bash
cd ~/WorldsCheckIn/backend
npm run deploy

cd ../frontend
npm run deploy
```

### 7. Verify from another LAN device

Use the Windows machine's LAN IP:

```text
http://YOUR_WINDOWS_LAN_IP:4000
http://YOUR_WINDOWS_LAN_IP:8080
```

## Interface Selection Notes

The deploy scripts ask for outward-facing IPs because the app needs them for:
- `CORS_ALLOWED_ORIGINS`
- `VITE_API_BASE_URL`

Environment behavior:
- macOS: uses Mac interfaces
- Linux: uses Linux interfaces
- WSL: uses Windows host outward-facing interfaces, not the WSL private NAT IP

## Runtime Files

- `backend/.env`: real backend config
- `frontend/.env`: real frontend config
- `scripts/tampermonkey-checkin-sync.user.js`: Tampermonkey template updated by deploy

## Important Notes

- `ROBOTEVENTS_API_KEY` must be entered manually
- `ROBOTEVENTS_SYNC_TOKEN` is generated automatically if missing
- if you rerun deploy and the Tampermonkey values change, update the script in Tampermonkey again
- the frontend dashboard refreshes periodically so synced data appears without a manual page reload
