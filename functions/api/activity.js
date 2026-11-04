// 每日运动(「当日运动」tab 用):
//   GET  /api/activity?days=14          公开只读,按日期倒序返回最近 N 天
//   POST /api/activity?key=<BRIEF_KEY>  外部脚本写入/覆盖当天快照(body=当天 payload)
// 鉴权沿用播报通道的 BRIEF_KEY,和 /api/reading 一致,不额外建账号。
//
// payload 约定(写入方按这个结构给,前端才好渲染):
// {
//   date: "2026-11-04",
//   items: [{ name:"跑步", icon:"🏃", dur:1920(秒), dist:5200(米), pace:369(秒/km), hr:148, cal:320 }],
//   days:  [{ d:"2026-11-04", m:32 }]   // 近 7 天每天的运动分钟数，用于小柱状图
// }
// 字段都可以缺：dur/dist/pace/hr/cal 缺了就不显示那一项，items 为空表示这天没运动。
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let ensured = false;
async function ensureTable(env) {
  if (ensured) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS activity_daily (
       date TEXT PRIMARY KEY,
       payload TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`
  ).run();
  ensured = true;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  let days = parseInt(url.searchParams.get('days') || '14', 10);
  if (!Number.isFinite(days)) days = 14;
  days = Math.min(90, Math.max(1, days));

  let rows = [];
  try {
    const r = await context.env.DB
      .prepare('SELECT date, payload, updated_at FROM activity_daily ORDER BY date DESC LIMIT ?1')
      .bind(days)
      .all();
    rows = r.results || [];
  } catch {
    rows = [];   // 表还没建:当作暂无数据
  }

  const items = rows.map((r) => {
    try {
      const p = JSON.parse(r.payload);
      p.updated_at = r.updated_at;
      return p;
    } catch {
      return null;
    }
  }).filter(Boolean);

  return Response.json(
    { items },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function onRequestPost(context) {
  const url = new URL(context.request.url);
  const key = url.searchParams.get('key') || '';
  if (!context.env.BRIEF_KEY || key !== context.env.BRIEF_KEY) {
    return Response.json({ error: 'key 不对' }, { status: 401 });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'body 不是 JSON' }, { status: 400 });
  }

  const date = String(body.date || '').slice(0, 10);
  if (!DATE_RE.test(date)) return Response.json({ error: 'date 要是 YYYY-MM-DD' }, { status: 400 });

  await ensureTable(context.env);

  const payload = {
    date,
    items: Array.isArray(body.items) ? body.items.slice(0, 12) : [],
    days: Array.isArray(body.days) ? body.days.slice(-30) : [],
  };
  const now = new Date().toISOString();
  await context.env.DB
    .prepare('INSERT INTO activity_daily (date, payload, updated_at) VALUES (?1, ?2, ?3) ' +
      'ON CONFLICT(date) DO UPDATE SET payload = ?2, updated_at = ?3')
    .bind(date, JSON.stringify(payload), now)
    .run();

  return Response.json({ ok: true, date, count: payload.items.length });
}
