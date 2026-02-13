# Deploying Pi-Queue to Fly.io

## Prerequisites

- [Fly.io account](https://fly.io) — sign up and install the [`flyctl` CLI](https://fly.io/docs/flyctl/install/)
- Authenticate: `flyctl auth login`
- A git repo URL the agent will work on (for initial clone during first boot)

## Quick Deploy

The deploy script reads from `.env` automatically. Copy the example and fill in your values:

```bash
cp .env.example .env
# Edit .env with at least the required values (see below)
./scripts/deploy.sh              # defaults: app=pi-queue, region=ord
./scripts/deploy.sh myapp iad    # custom app name and region
```

The script will:
1. Create the Fly app (if it doesn't exist)
2. Create a 10GB persistent volume for the database and repo
3. Set required deployment secrets and optional `ANTHROPIC_API_KEY` (you can use `pi /login` instead)
4. Deploy the app with Fly

Your app will be live at `https://<app-name>.fly.dev`.

### Required `.env` variables

| Variable | Description |
|---|---|
| `GIT_REPO_URL` | Repo the agent clones on first boot. For private repos, use a PAT URL (see below) |
| `WEBHOOK_SECRET` | Bearer token for the `POST /api/tasks` endpoint. Generate one: `openssl rand -hex 32` |
| `API_ACCESS_TOKEN` | Bearer token for all non-webhook `/api/*` endpoints. Generate one: `openssl rand -hex 32` |
| `DASHBOARD_USER` | Username for basic auth on the dashboard (required) |
| `DASHBOARD_PASSWORD` | Password for basic auth on the dashboard (required) |

### Optional `.env` variables

| Variable | Description |
|---|---|
| `PUBLIC_ORIGIN` | Canonical public origin. Optional on Fly default domains (auto-derived from `FLY_APP_NAME`), recommended for custom domains |
| `ANTHROPIC_API_KEY` | Anthropic API key. Not needed if using `pi` -> `/login` (see below) |
| `TASK_TIMEOUT_MS` | Max time per task in ms (default: 600000 / 10 min) |
| `API_MAX_PAGE_SIZE` | Max page size for `GET /api/tasks` (default: 100) |
| `API_MAX_OFFSET` | Max offset for `GET /api/tasks` (default: 10000) |
| `API_MAX_TITLE_LENGTH` | Max task title length (default: 200) |
| `API_MAX_PROMPT_LENGTH` | Max task prompt length (default: 20000) |
| `API_MAX_SOURCE_LENGTH` | Max task source length (default: 64) |
| `API_MAX_EXTERNAL_ID_LENGTH` | Max external ID length (default: 128) |
| `API_MAX_REJECT_REASON_LENGTH` | Max reject reason length (default: 1000) |
| `API_MAX_METADATA_BYTES` | Max serialized metadata size in bytes (default: 16384) |

### Private repos

Use a GitHub fine-grained Personal Access Token in the URL:

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Scope it to the specific repo with **Contents: Read and write** permission
3. Set `GIT_REPO_URL=https://<PAT>@github.com/your-org/your-project.git`

This allows it to clone and push code to the repo without having to login with your account / keys on the remote machine. You can one click kill the PAT to revoke access if needed.

## Pi Agent Authentication

You have two options for authenticating the `pi` agent:

### Option A: API key

Set `ANTHROPIC_API_KEY` in your `.env` before deploying. You will be charged API prices

### Option B: Use your existing subscription (Claude Code Max, etc.)

After deploying, SSH into the machine and log in interactively:

```bash
flyctl ssh console --app pi-queue
pi 
/login    # Select your provider once inside `pi`
```

Credentials are stored on the persistent volume (`/data`) and survive redeployments.

## Manual Step-by-Step

```bash
# Create the app
flyctl apps create pi-queue

# Create a persistent volume (10GB)
flyctl volumes create pi_queue_data --app pi-queue --region ord --size 10

# Set secrets
flyctl secrets set \
  WEBHOOK_SECRET="$(openssl rand -hex 32)" \
  API_ACCESS_TOKEN="$(openssl rand -hex 32)" \
  GIT_REPO_URL="https://github.com/your-org/your-project.git" \
  DASHBOARD_USER="admin" \
  DASHBOARD_PASSWORD="a-strong-password" \
  --app pi-queue

# Deploy
flyctl deploy --app pi-queue
```

## Verify

**Dashboard (requires basic auth):**

```bash
open https://pi-queue.fly.dev/
```

**Submit a task via webhook:**

```bash
curl -X POST https://pi-queue.fly.dev/api/tasks \
  -H "Authorization: Bearer YOUR_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test task","prompt":"List all files in the repo"}'
```

Should return `201` with `{"id":"...","status":"pending"}`.

## Maintenance

**View logs:**
```bash
flyctl logs --app pi-queue
```

**Redeploy after code changes:**
```bash
flyctl deploy --app pi-queue
```

**SSH into the machine:**
```bash
flyctl ssh console --app pi-queue
```

**Update secrets:**
```bash
flyctl secrets set KEY=value --app pi-queue
```

**Restart the machine:**
```bash
flyctl machine restart <machine-id> --app pi-queue
```

**Backup the database:**
```bash
flyctl ssh sftp get /data/pi-queue.db ./pi-queue-backup.db --app pi-queue
```

## Local Development

Use Docker Compose for local development:

```bash
cp .env.example .env
# Edit .env with your values (WEBHOOK_SECRET, API_ACCESS_TOKEN, DASHBOARD_USER, and DASHBOARD_PASSWORD are required)
docker compose up --build
```

The dashboard will be at `http://localhost:3000`.
