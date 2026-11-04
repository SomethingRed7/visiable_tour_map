// 把 COROS 运动记录推到站点的 /api/activity。
// 用法：node scripts/sync-activity.mjs < data.json
//   data.json = [{ "date":"2026-11-03", "items":[{"name":"跳绳","icon":"🤸","dur":929,"hr":139,"cal":155}] }]
// 也可以直接 node scripts/sync-activity.mjs 让它把 stdin 的数组逐日 POST。
// 密钥从 .dev.vars 的 BRIEF_KEY 读（和 /api/reading 共用一条播报通道）。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = process.env.SITE || 'https://gugugaga-viw.pages.dev';

function readBriefKey() {
  if (process.env.BRIEF_KEY) return process.env.BRIEF_KEY;
  const p = path.join(ROOT, '.dev.vars');
  if (!fs.existsSync(p)) return '';
  const m = fs.readFileSync(p, 'utf8').match(/^BRIEF_KEY\s*=\s*"?([^"\n]+)"?/m);
  return m ? m[1].trim() : '';
}

const key = readBriefKey();
if (!key) {
  console.error('找不到 BRIEF_KEY（.dev.vars 里没有，也没设环境变量）');
  process.exit(1);
}

const raw = fs.readFileSync(0, 'utf8').trim();
if (!raw) {
  console.error('从 stdin 读不到数据');
  process.exit(1);
}
const days = JSON.parse(raw);
if (!Array.isArray(days) || !days.length) {
  console.error('数据要是非空数组');
  process.exit(1);
}

// 近 7 天每天的运动分钟数（每份 payload 都带上，前端画柱状图用）
const minutesByDate = new Map();
for (const d of days) {
  const total = (d.items || []).reduce((s, x) => s + (Number(x.dur) || 0), 0);
  if (total > 0) minutesByDate.set(d.date, Math.round(total / 60));
}
const series = [...minutesByDate.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .slice(-7)
  .map(([d, m]) => ({ d, m }));

let ok = 0;
for (const d of days) {
  const body = { date: d.date, items: d.items || [], days: series };
  const res = await fetch(`${SITE}/api/activity?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  if (res.ok) {
    ok++;
    console.log(`✓ ${d.date}  ${(d.items || []).length} 项`);
  } else {
    console.log(`✗ ${d.date}  HTTP ${res.status} ${txt.slice(0, 120)}`);
  }
}
console.log(`\n完成 ${ok}/${days.length}`);
