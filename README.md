# artimind-web-live

Live web KPIs for Artimind (visitors, `/activate` sub activations, web purchases), published to
GitHub Pages every 15 minutes.

- Data: BigQuery `iip032-artimind.web_live.*`, refreshed every 15 min by a scheduled query
  (SQL lives in the main web repo under `reports/web-live/`).
- `publish.yml` runs every 15 min: it authenticates to GCP keylessly (Workload Identity Federation,
  pool `github` / provider `web-live`, SA `web-live-gh@iip032-artimind`, read-only on `web_live`),
  runs `build.mjs`, and deploys `site/` to Pages.
- The Pages site only serves **AES-GCM ciphertext** (`data.enc.json`). The page decrypts it in the
  browser with the key in the link's `#k=` fragment (never sent to any server; kept in
  localStorage after the first visit). The key is the `DASHBOARD_KEY` repo secret.

Rotate the key: set a new `DASHBOARD_KEY` secret (32 random bytes, base64url), re-run the
workflow, and share the new `#k=` link. Old links stop working.

Note: GitHub disables scheduled workflows after 60 days without repo activity; re-enable from the
Actions tab if it pauses.
