// 播报专用接口(每日播报脚本用,不暴露登录密码):
//   GET /api/brief?date=YYYY-MM-DD&key=<BRIEF_KEY>
// 返回:当天公开动态(家人视角,不含私有)+ 当天全部待办(含完成状态)
// 鉴权:key 必须等于 wrangler.toml [vars] 的 BRIEF_KEY(播报脚本持有;key 泄漏=待办泄露,勿公开此接口)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normEntry(e) {
  let location = null;
  try { location = e.location ? JSON.parse(e.location) : null; } catch { location = null; }
  let photos = [];
  try { photos = JSON.parse(e.photos || '[]'); } catch { photos = []; }
  return {
    date: e.date || '', title: e.title || '', text: e.text || '', album: e.album || null,
    author: e.author || null, location, ts: e.ts ?? null, photos,
    visibility: e.visibility || 'public',
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const key = url.searchParams.get('key') || '';
  const date = url.searchParams.get('date') || '';
  if (!context.env.BRIEF_KEY || key !== context.env.BRIEF_KEY) {
    return Response.json({ error: 'key 不对' }, { status: 401 });
  }
  if (!DATE_RE.test(date)) return Response.json({ error: '日期格式不对' }, { status: 400 });

  // 公开动态(家人视角:私有条目不推)
  const { results: entryRows } = await context.env.DB
    .prepare('SELECT * FROM entries WHERE date = ?1 AND visibility = ?2 ORDER BY ts ASC')
    .bind(date, 'public').all();
  const entries = (entryRows || []).map(normEntry);

  // 全部待办(播报脚本推送,用户明确要求含待办)
  const { results: todoRows } = await context.env.DB
    .prepare('SELECT id, date, text, done, sort_order, checkin_ts FROM todos WHERE date = ?1 ORDER BY sort_order ASC, id ASC')
    .bind(date).all();

  return Response.json({ date, entries, todos: todoRows || [] });
}
