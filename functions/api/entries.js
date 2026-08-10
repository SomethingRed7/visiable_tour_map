// 条目查询 API:GET /api/entries?date=|?month=|?album=|(空=最近)
// 数据源:D1(SQLite,强一致);seed(预置条目)与 D1 合并,按日期排序。
import { SEED } from '../seed.js';

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
    created_at: e.created_at || null,
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const date = url.searchParams.get('date');
  const month = url.searchParams.get('month');
  const album = url.searchParams.get('album');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), 500);

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
  if (date) merged = merged.filter((e) => e.date === date);
  if (month) merged = merged.filter((e) => e.date.startsWith(month));
  if (album) merged = merged.filter((e) => e.album === album);

  merged.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!date && !month && !album) merged.reverse(); // 全量:最近在前

  return Response.json({ entries: merged.slice(0, limit).map(norm) });
}
