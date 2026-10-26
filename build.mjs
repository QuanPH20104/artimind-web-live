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

// One Vietnam calendar day: 0 = today, 1 = yesterday.
async function day(offset) {
  const d = `DATE_SUB(CURRENT_DATE('Asia/Ho_Chi_Minh'), INTERVAL ${offset} DAY)`;
  const [daily, hourly, slots, services] = await Promise.all([
    query(`
      SELECT * FROM \`${PROJECT}.web_live.daily_kpis\`
      WHERE event_date = ${d}`),
    query(`
      SELECT event_date, hour_vn, visitors, new_visitors, activate_success_users, web_sub_purchasers
      FROM \`${PROJECT}.web_live.hourly_kpis\`
      WHERE event_date = ${d}
      ORDER BY hour_vn`),
    query(`
      SELECT FORMAT_DATETIME('%Y-%m-%dT%H:%M', slot_vn) AS slot_vn, active_users, new_today_users,
        first_visit_users, activate_success_users, activate_error_users, gen_success_events, gen_error_events
      FROM \`${PROJECT}.web_live.slot_kpis\`
      WHERE event_date = ${d}
      ORDER BY slot_vn`),
    query(`
      SELECT service, success_events, error_events, error_users, top_errors
      FROM \`${PROJECT}.web_live.service_kpis\`
      WHERE event_date = ${d}
      ORDER BY service`),
  ]);
  return { daily, hourly, slots, services };
}

// Today (Vietnam calendar day) plus yesterday, so the previous day stays viewable after midnight.
const [today, yesterday] = await Promise.all([day(0), day(1)]);
const strip = ({ daily, ...rest }) => ({ daily: daily.map(({ refreshed_at, ...d }) => d), ...rest });
const refreshedAt = [...today.daily, ...yesterday.daily].reduce((max, d) => (d.refreshed_at > max ? d.refreshed_at : max), '');
const payload = {
  generatedAt: new Date().toISOString(),
  refreshedAt,
  ...strip(today),
  yesterday: strip(yesterday),
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
for (const [name, d] of [['today', today], ['yesterday', yesterday]]) {
  console.log(`${name}: daily=${d.daily.length} hourly=${d.hourly.length} slots=${d.slots.length} services=${d.services.length}`);
}
console.log(`refreshedAt=${refreshedAt}`);
