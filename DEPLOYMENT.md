# Fairway Tracker — Railway Deployment Guide

## Architecture

The app runs as two separate Railway services from the same monorepo:

- **Backend** — Flask API served by Gunicorn (root directory: `/backend`)
- **Frontend** — React static build served by Caddy (root directory: `/frontend`)

## Environment Variables

### Backend Service

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key for Claude AI features |
| `GOLF_COURSE_API_KEY` | No | Your GolfCourseAPI.com key for course search/details |
| `FRONTEND_URL` | Yes | Full URL of your frontend service (e.g. `https://your-frontend.up.railway.app`) |
| `PORT` | Auto | Automatically set by Railway |
| `DATA_DIR` | No | Path to persistent data directory (set to `/data` if using a volume, otherwise defaults to `backend/data/`) |

### Frontend Service

| Variable | Required | Description |
|----------|----------|-------------|
| `REACT_APP_API_URL` | Yes | Full URL of your backend API (e.g. `https://your-backend.up.railway.app/api`) |
| `PORT` | Auto | Automatically set by Railway |

## Persistent Data

Session data, course cache, and custom tees are stored as JSON files. On Railway, the filesystem resets on each deploy.

**Recommended:** Use Railway's persistent volumes to keep data between deploys.

1. In your backend service, go to Settings > Volumes
2. Add a volume mounted at `/data`
3. Set `DATA_DIR=/data` in your backend environment variables

All JSON data files (`sessions.json`, `course_cache.json`, `custom_tees.json`) will be saved to the persistent volume.

**Future option:** Migrate to a database (SQLite or PostgreSQL) for more robust storage. The `DATA_DIR` environment variable makes this transition easier — the current file-based storage works well to start.

## Deployment Steps

1. Go to [railway.app](https://railway.app) and create a new project
2. Select "Deploy from GitHub repo" and choose your fairway-tracker repo

3. Create **two services** from the same repo:

   **Backend Service:**
   - Set root directory to `/backend`
   - Add environment variables: `ANTHROPIC_API_KEY`, `GOLF_COURSE_API_KEY`, `FRONTEND_URL`
   - In Settings > Networking, click "Generate Domain"
   - (Optional) Add a persistent volume mounted at `/data` and set `DATA_DIR=/data`

   **Frontend Service:**
   - Set root directory to `/frontend`
   - Add environment variable: `REACT_APP_API_URL=https://your-backend-domain.up.railway.app/api`
   - In Settings > Networking, click "Generate Domain"

4. After both services have domains:
   - Go back to the backend service and set `FRONTEND_URL` to the frontend's domain
   - Redeploy both services

5. Visit your frontend domain — Fairway Tracker should be live!

## Auto-Deploy

Railway automatically redeploys when you push to GitHub. So when Claude Code pushes updates, your live app updates automatically.
