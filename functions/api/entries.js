// 条目查询 API:GET /api/entries?date=|?month=|?album=|?limit=|(空=最近 N 条)
// ⚠️ 按专辑取数(?album=)必须在 SQL 里过滤,不能先取一批再在客户端筛:
//    默认条数上限会先把「日期较老」的专辑整批截掉 —— 2026-09-17 用户报
//    「专辑 · 长沙2026 有 27 条却显示『这个专辑还没有条目』」,根因就是全量接口只回最新 200 条
//    (长沙 8-14~8-16、测试 8-12~8-17 恰好排在 200 之外),而专辑计数走 /api/albums 的 SQL 统计。
// 数据源:D1(SQLite,强一致);seed(预置条目)与 D1 合并,按日期排序。
import { SEED } from '../seed.js';
import { verifySession } from '../_lib/auth.js';

function norm(e) {
  let location = null;
  try { location = e.location ? JSON.parse(e.location) : null; } catch { location = null; }
  let photos = [];
  try { photos = JSON.parse(e.photos || '[]'); } catch { photos = []; }
  return {
    date: e.date || '',
    title: e.title || '',
    text: e.text || '',
    album: e.album || null,
    author: e.author || null,
    location,
    ts: e.ts ?? null,
    photos,
    visibility: e.visibility || 'public',
    created_at: e.created_at || null,
  };
}

export async function onRequestGet(context) {
  // 可见性过滤:未登录只见公开(私有条目"像素级不存在");登录见全部
  const user = await verifySession(context.env, context.request);
  const url = new URL(context.request.url);
  const date = url.searchParams.get('date');
  const month = url.searchParams.get('month');
  // album:null=不限;''=未分类(album 为空/NULL);其余=专辑名
  const albumParam = url.searchParams.get('album');
  // 默认 1000:条目 JSON 很轻(199 条 raw 95KB / gzip 22KB,照片只存路径),
  // 首页日历蓝点、管理页专辑下拉都依赖「拿到全部条目」,别为了省这点流量再踩截断
  const limitRaw = parseInt(url.searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 2000) : 1000;

  const kvEntries = [];
  try {
    let stmt;
    let args = [];
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      stmt = 'SELECT * FROM entries WHERE date = ?1 ORDER BY ts ASC';
      args = [date];
    } else if (month && /^\d{4}-\d{2}$/.test(month)) {
      stmt = 'SELECT * FROM entries WHERE date LIKE ?1 ORDER BY date ASC, ts ASC';
      args = [`${month}%`];
    } else if (albumParam !== null) {
      if (albumParam === '') {
        stmt = "SELECT * FROM entries WHERE album IS NULL OR album = '' ORDER BY date ASC, ts ASC";
      } else {
        stmt = 'SELECT * FROM entries WHERE album = ?1 ORDER BY date ASC, ts ASC';
        args = [albumParam];
      }
    } else {
      stmt = 'SELECT * FROM entries ORDER BY date DESC, ts DESC LIMIT ?1';
      args = [limit];
    }
    const res = await context.env.DB.prepare(stmt).bind(...args).all();
    for (const r of res.results || []) kvEntries.push(r);
  } catch {
    // DB 绑定不可用时(未配置/本地未模拟)静默降级,仅返回 seed
  }

  let merged = [...SEED, ...kvEntries];
  if (!user) merged = merged.filter((e) => e.visibility !== 'private'); // 未登录藏私有
  if (date) merged = merged.filter((e) => e.date === date);
  if (month) merged = merged.filter((e) => e.date.startsWith(month));
  // 专辑过滤已由 SQL 完成(SEED 预置条目仍在内存里过一遍,保持语义一致)
  if (albumParam !== null) merged = merged.filter((e) => (e.album || '') === albumParam);

  merged.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!date && !month && albumParam === null) merged.reverse(); // 全量:最近在前

  return Response.json({ entries: merged.slice(0, limit).map(norm) });
}
