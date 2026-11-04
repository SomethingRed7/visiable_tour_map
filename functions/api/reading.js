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
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS reading_reco (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       source TEXT NOT NULL,
       title TEXT NOT NULL,
       author TEXT,
       link TEXT,
       note TEXT,
       sort_order INTEGER NOT NULL DEFAULT 0
     )`
  ).run();
  ensured = true;
}

// 推荐书单:整表替换(书单变化很慢,不做增量)
async function readReco(env) {
  try {
    const { results } = await env.DB
      .prepare('SELECT source, title, author, link, note FROM reading_reco ORDER BY sort_order ASC, id ASC')
      .all();
    return results || [];
  } catch {
    return [];   // 表还没建
  }
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

  return Response.json({ items, reco: await readReco(context.env) });
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

  await ensureTable(context.env);

  // 推送推荐书单:body = { reco: [{source,title,author,link,note}] },整表替换
  if (Array.isArray(body.reco)) {
    const list = body.reco.slice(0, 12);
    await context.env.DB.prepare('DELETE FROM reading_reco').run();
    for (let i = 0; i < list.length; i++) {
      const b = list[i] || {};
      await context.env.DB
        .prepare(
          `INSERT INTO reading_reco (source, title, author, link, note, sort_order)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
        )
        .bind(
          String(b.source || ''),
          String(b.title || ''),
          String(b.author || ''),
          String(b.link || ''),
          String(b.note || ''),
          i
        )
        .run();
    }
    return Response.json({ ok: true, reco: list.length });
  }

  const date = String(body.date || '');
  if (!DATE_RE.test(date)) return Response.json({ error: '日期格式不对' }, { status: 400 });

  const payload = JSON.stringify(body);
  const now = new Date().toISOString();
  await context.env.DB
    .prepare(
      `INSERT INTO reading_daily (date, payload, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(date) DO UPDATE SET payload = ?2, updated_at = ?3`
    )
    .bind(date, payload, now)
    .run();

  return Response.json({ ok: true, date, updated_at: now });
}
