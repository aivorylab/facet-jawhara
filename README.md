# Facet — Jawhara Jewellery Media Buying Command Centre

Self-hosted, auto-refreshing version of the dashboard (15 pages — Google Business Profile is
not included in this build). Once set up, this repo keeps itself live on GitHub Pages with no
manual work required — a scheduled job pulls fresh data from Windsor.ai and publishes the
update automatically.

## What's in this repo

```
index.html              the dashboard shell (loads data.json at runtime)
dashboard.js             all dashboard logic — unchanged from the version you already reviewed
data.json                 the actual numbers — this is the ONLY file that gets overwritten on refresh
scripts/refresh_data.py   pulls fresh data from Windsor.ai and rewrites data.json
.github/workflows/refresh.yml   the scheduled job that runs the script and commits the result
```

The site used to have its data baked directly into index.html. It's now split out into
data.json specifically so that "refreshing the dashboard" means overwriting one small file,
not regenerating the whole site.

## One-time setup (15 minutes)

1. **Create a new GitHub repository** and upload everything in this folder to it (or `git push`
   this folder as the initial commit).

2. **Add your Windsor.ai API key as a GitHub Secret.**
   In your new repo: Settings → Secrets and variables → Actions → New repository secret.
   - Name: `WINDSOR_API_KEY`
   - Value: your Windsor.ai API key (find it in your Windsor.ai account settings)

3. **Enable GitHub Pages.**
   Settings → Pages → Build and deployment → Source → **Deploy from a branch** → Branch:
   `main`, folder `/ (root)` → Save.
   GitHub will give you a URL like `https://<your-username>.github.io/<repo-name>/` —
   that's the live link you can share.

4. **Run the workflow once manually to confirm it works.**
   Go to the Actions tab → "Refresh dashboard data" → Run workflow. Check the log for any
   errors (see Troubleshooting below), then open your Pages URL and confirm the dashboard loads.

That's it — from here, the workflow runs automatically every 6 hours (configurable — see below),
pulls fresh numbers, and pushes them. GitHub Pages picks up the change within a minute or two.
Nothing further needs to be done manually.

## Changing the refresh schedule

Edit the `cron` line in `.github/workflows/refresh.yml`. A few common examples:
- Every 6 hours (default): `0 */6 * * *`
- Once daily at 6am UTC: `0 6 * * *`
- Every hour: `0 * * * *`

You can also trigger a refresh on demand from the Actions tab at any time
("Run workflow" button) — you don't have to wait for the schedule.

## What refreshes automatically vs. what doesn't

Being upfront about scope, since this matters for a live dashboard:

**Refreshes automatically, every scheduled run:**
- Daily performance for Meta, Google, Snapchat, TikTok, GA4 (spend, clicks, impressions,
  purchases, revenue, funnel-stage counts) — this drives every KPI, chart, and date-range
  filter across the whole dashboard

**Does not refresh automatically — should be updated periodically by whoever maintains this
repo, or extended into the script over time:**
- Creative thumbnail images (Meta/TikTok/Google) — these are short-lived signed CDN links
  from each ad platform that expire after roughly a day or two, so even a live pull needs
  re-fetching regularly. The current thumbnails in data.json will eventually stop rendering;
  re-run a creative-specific pull to refresh them.
- Static reference data: campaign/ad-set naming, location details, category groupings — these
  don't change often enough to need automation, but will look stale if a real campaign is
  renamed, paused, or restructured without updating data.json manually.

None of this is fabricated data — everything currently in data.json is real, as pulled during
setup. The point of this section is just to be clear about which parts stay live unattended
and which parts need a human to revisit them occasionally.

## Verifying / extending the field names in refresh_data.py

The field names used in `scripts/refresh_data.py` (e.g. `actions_purchase`,
`action_values_purchase` for Meta) match what was confirmed working during this project.
Windsor.ai's exact field availability can vary by account, platform API version, and
permissions — **before relying on the schedule**, run the script locally once to confirm it
works against your account:

```bash
export WINDSOR_API_KEY=your_key_here
python3 scripts/refresh_data.py
```

If a field comes back empty or the call errors, check your available fields for that
connector in your Windsor.ai dashboard (or ask Windsor.ai support) and adjust the `fields`
list in the relevant `refresh_*` function.

## Troubleshooting

- **Workflow fails with "WINDSOR_API_KEY is not set"** — the secret wasn't added, or is
  misspelled. Re-check step 2 above; the secret name must be exactly `WINDSOR_API_KEY`.
- **Dashboard shows "Could not load dashboard data"** — data.json is missing or GitHub Pages
  isn't serving it yet (can take a minute or two after the first push). Check the repo's file
  list to confirm data.json exists at the root.
- **Some numbers look wrong or stuck** — check the Actions tab for the most recent workflow
  run; if a specific refresh step failed, the log will name which one and why. A partial
  failure still commits whatever succeeded, so the rest of the dashboard keeps working.
