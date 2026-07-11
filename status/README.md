# Status page

An independent uptime/status page for the radio station, hosted on **GitHub
Pages** and checked by **GitHub Actions** — deliberately *not* on Render, so it
stays up (and reports the outage) when the backend is down.

## How it works

- `check.mjs` pings the public endpoints (`/stream`, `/health`, `/station`) and
  writes `data/status.json` (current) + `data/history.json` (90-day buckets).
- `.github/workflows/status.yml` runs it every ~10 min and publishes `status/`
  to GitHub Pages. It writes **no git commits** — history persists by reading
  the last-published `history.json` — so it never triggers a Render redeploy.
- `index.html` renders the dashboard from those JSON files (no build step).

## One-time setup

1. Push these files to `main`.
2. GitHub → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. GitHub → **Actions** → run **Status page** once (Run workflow), or wait for
   the schedule. The page appears at `https://<user>.github.io/<repo>/`.

## Configuring

- Components/endpoints: edit `COMPONENTS` in `check.mjs`.
- Add the **Player** component: set `STATUS_FRONTEND_URL` in
  `.github/workflows/status.yml` to the deployed frontend URL.
- Backend URL: `STATUS_BACKEND_URL` in the same workflow.

## Local preview

```bash
node status/check.mjs                     # generate data/ from the live backend
python3 -m http.server 4100 --directory status
# open http://localhost:4100
```
