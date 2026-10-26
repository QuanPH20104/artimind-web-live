// Reads the web_live KPI tables from BigQuery, encrypts them with AES-GCM and
// writes the static site to ./site. The page decrypts in the browser with the
// key carried in the link's #fragment, so the public Pages URL only serves
// ciphertext.
//
// env: ACCESS_TOKEN  — OAuth token for web-live-gh@iip032-artimind (keyless WIF)
//      DASHBOARD_KEY — 32-byte AES key, base64url
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { webcrypto as crypto } from 'node:crypto';

const PROJECT = 'iip032-artimind';
const { ACCESS_TOKEN, DASHBOARD_KEY } = process.env;
if (!ACCESS_TOKEN || !DASHBOARD_KEY) throw new Error('ACCESS_TOKEN and DASHBOARD_KEY are required');

const api = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}`;
const headers = { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' };

async function query(sql) {
  let res = await fetch(`${api}/queries`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: sql, useLegacySql: false, location: 'US', timeoutMs: 60000 }),
  }).then((r) => r.json());
  while (!res.error && !res.jobComplete) {
    const { jobId, location } = res.jobReference;
    res = await fetch(`${api}/queries/${jobId}?location=${location}&timeoutMs=60000`, { headers }).then((r) => r.json());
  }
  if (res.error) throw new Error(JSON.stringify(res.error));
  const fields = res.schema.fields;
  return (res.rows ?? []).map((row) =>
    Object.fromEntries(
      row.f.map((cell, i) => {
        const { name, type } = fields[i];
        const v = cell.v;
        if (v == null) return [name, null];
        if (type === 'INTEGER' || type === 'INT64') return [name, Number(v)];
        if (type === 'TIMESTAMP') return [name, new Date(Number(v) * 1000).toISOString()];
        return [name, v];
      }),
    ),
  );
}

const daily = await query(`
  SELECT * FROM \`${PROJECT}.web_live.daily_kpis\`
  WHERE event_date = CURRENT_DATE('Asia/Ho_Chi_Minh')`);
const hourly = await query(`
  SELECT event_date, hour_vn, visitors, new_visitors, activate_success_users, web_sub_purchasers
  FROM \`${PROJECT}.web_live.hourly_kpis\`
  WHERE event_date = CURRENT_DATE('Asia/Ho_Chi_Minh')
  ORDER BY hour_vn`);

// Today only (Vietnam calendar day): nothing older is published.
const refreshedAt = daily.reduce((max, d) => (d.refreshed_at > max ? d.refreshed_at : max), '');
const payload = {
  generatedAt: new Date().toISOString(),
  refreshedAt,
  daily: daily.map(({ refreshed_at, ...d }) => d),
  hourly,
};

const key = await crypto.subtle.importKey('raw', Buffer.from(DASHBOARD_KEY, 'base64url'), 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));

await mkdir('site', { recursive: true });
await writeFile(
  'site/data.enc.json',
  JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64'), ct: Buffer.from(ct).toString('base64') }),
);
await copyFile('index.html', 'site/index.html');
await writeFile('site/robots.txt', 'User-agent: *\nDisallow: /\n');
console.log(`daily=${daily.length} hourly=${hourly.length} refreshedAt=${refreshedAt}`);
