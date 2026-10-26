# artimind-web-live

Today-only web KPIs for Artimind (visitors, people per 10-minute slot, `/activate` sub activations,
web purchases, AI-service and activate fail rates), published to GitHub Pages every 10 minutes.

- Data: BigQuery `iip032-artimind.web_live.*`, refreshed every 10 min (at :x4) by a scheduled query
  (SQL lives in the main web repo under `reports/web-live/`).
- `publish.yml` runs every 10 min, 2 min after each refresh. Each run waits for the next :x6 and dispatches the next one (GitHub cron alone is unreliable and is kept only as a backup that restarts the chain). It authenticates to GCP keylessly (Workload Identity Federation,
  pool `github` / provider `web-live`, SA `web-live-gh@iip032-artimind`, read-only on `web_live`),
  runs `build.mjs`, and deploys `site/` to Pages.
- The Pages site only serves **AES-GCM ciphertext** (`data.enc.json`). The page decrypts it in the
  browser with the key in the link's `#k=` fragment (never sent to any server; kept in
  localStorage after the first visit). The key is the `DASHBOARD_KEY` repo secret.

Rotate the key: set a new `DASHBOARD_KEY` secret (32 random bytes, base64url), re-run the
workflow, and share the new `#k=` link. Old links stop working.

If the chain ever stops (e.g. a run was cancelled) the backup cron restarts it, or run the workflow
manually from the Actions tab. GitHub disables the backup cron after 60 days without repo activity; re-enable from the
Actions tab if it pauses.
