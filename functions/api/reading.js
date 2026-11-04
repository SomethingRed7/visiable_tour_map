// 每日读书总结(微信读书推送用):
//   GET  /api/reading?days=14            公开只读,按日期倒序返回最近 N 天
//   POST /api/reading?key=<BRIEF_KEY>    播报脚本写入/覆盖当天快照(body=当天 payload)
// 鉴权沿用播报通道的 BRIEF_KEY,不额外建账号(wrangler.toml 里 USERS 只管登录用户)。
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 首次写入时自建表:CLI 的 D1 权限受限时也能跑通(运行时 binding 有完整权限)
let ensured = false;
async function ensureTable(env) {
  if (ensured) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS reading_daily (
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

  let results = [];
  try {
    const r = await context.env.DB
      .prepare('SELECT date, payload, updated_at FROM reading_daily ORDER BY date DESC LIMIT ?1')
      .bind(days)
      .all();
    results = r.results || [];
  } catch {
    results = [];   // 表还没建:当作暂无数据
  }

  const items = (results || [])
    .map((r) => {
      try {
        const p = JSON.parse(r.payload);
        p.updated_at = r.updated_at;
        return p;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return Response.json({ items });
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
  const date = String(body.date || '');
  if (!DATE_RE.test(date)) return Response.json({ error: '日期格式不对' }, { status: 400 });

  const payload = JSON.stringify(body);
  const now = new Date().toISOString();
  await ensureTable(context.env);
  await context.env.DB
    .prepare(
      `INSERT INTO reading_daily (date, payload, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(date) DO UPDATE SET payload = ?2, updated_at = ?3`
    )
    .bind(date, payload, now)
    .run();

  return Response.json({ ok: true, date, updated_at: now });
}
