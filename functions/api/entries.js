// 条目查询 API:GET /api/entries?date=|?month=|?album=|(空=最近)
// seed(预置条目)与 KV 新条目合并,按日期排序。
import { SEED } from '../seed.js';

function norm(e) {
  return {
    date: e.date || '',
    title: e.title || '',
    text: e.text || '',
    album: e.album || null,
    author: e.author || null,
    location: e.location || null,
    ts: e.ts || null,
    photos: e.photos || [],
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
    // 主路径:index:all 强一致(单次 get);缺失时回退 list(旧数据迁移前,最终一致可接受)
    const indexRaw = await context.env.ENTRIES.get('index:all');
    let keys = null;
    if (indexRaw) {
      let all = JSON.parse(indexRaw);
      if (date) all = all.filter((k) => k.startsWith(`${date}:`));
      else if (month) all = all.filter((k) => k.startsWith(month));
      else all = all.slice(-limit);
      keys = all;
    } else {
      let list;
      if (month) list = await context.env.ENTRIES.list({ prefix: `entry:${month}:` });
      else if (date) list = await context.env.ENTRIES.list({ prefix: `entry:${date}:` });
      else list = await context.env.ENTRIES.list({ limit });
      keys = list.keys.map((k) => k.name.replace(/^entry:/, ''));
    }
    for (const k of keys) {
      const raw = await context.env.ENTRIES.get(`entry:${k}`);
      if (raw) kvEntries.push(JSON.parse(raw));
    }
  } catch {
    // KV 绑定不可用时(未配置/本地未模拟)静默降级,仅返回 seed
  }

  let merged = [...SEED, ...kvEntries];
  if (date) merged = merged.filter((e) => e.date === date);
  if (month) merged = merged.filter((e) => e.date.startsWith(month));
  if (album) merged = merged.filter((e) => e.album === album);

  merged.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!date && !month && !album) merged.reverse(); // 全量:最近在前

  return Response.json({ entries: merged.slice(0, limit).map(norm) });
}
