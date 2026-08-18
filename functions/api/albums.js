// 专辑管理 API(全部需登录会话):
//   GET  /api/albums                 → 专辑列表 [{album, count}] + total(条目数)
//   POST /api/albums                 → 操作(JSON body):
//        { action: 'rename', old, new }            改名(同步该专辑下全部条目)
//        { action: 'visibility', album, vis }      一键设置专辑下全部条目公开/私密
// 返回 { ok: true, count }(受影响条目数)
import { verifySession } from '../_lib/auth.js';

function jsonBody(req) {
  return req.json().catch(() => ({}));
}

export async function onRequestGet(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  // 专辑名 + 条目数 + 可见性分布(前端据此决定「全部改公开/全部改私密」按钮方向)
  const { results } = await context.env.DB
    .prepare("SELECT album, COUNT(*) AS cnt, SUM(CASE WHEN visibility = 'private' THEN 1 ELSE 0 END) AS priv FROM entries WHERE album IS NOT NULL AND album != '' GROUP BY album ORDER BY album ASC")
    .all();
  // 未分类:album 为空/NULL 的条目(无专辑),同样支持一键可见性
  const { results: uncat } = await context.env.DB
    .prepare("SELECT COUNT(*) AS c, SUM(CASE WHEN visibility = 'private' THEN 1 ELSE 0 END) AS priv FROM entries WHERE album IS NULL OR album = ''")
    .all();
  const { results: total } = await context.env.DB
    .prepare('SELECT COUNT(*) AS c FROM entries')
    .all();
  return Response.json({
    albums: results.map((r) => ({ album: r.album, count: r.cnt, privateCount: r.priv || 0 })),
    uncategorized: { count: uncat[0]?.c || 0, privateCount: uncat[0]?.priv || 0 },
    total: total[0]?.c || 0,
  });
}

export async function onRequestPost(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const body = await jsonBody(context.request);
  const action = body.action;

  if (action === 'rename') {
    const oldName = String(body.old || '').trim();
    const newName = String(body.new || '').trim();
    if (!oldName || !newName) return Response.json({ error: '专辑名不能为空' }, { status: 400 });
    if (newName.length > 50) return Response.json({ error: '专辑名最多 50 字' }, { status: 400 });
    const res = await context.env.DB
      .prepare('UPDATE entries SET album = ?1 WHERE album = ?2')
      .bind(newName, oldName)
      .run();
    return Response.json({ ok: true, count: (res.meta && res.meta.changes) || 0 });
  }

  if (action === 'visibility') {
    const album = String(body.album || '').trim();
    const vis = body.vis === 'private' ? 'private' : 'public';
    let res;
    if (!album) {
      // 未分类(album 为空/NULL)
      res = await context.env.DB
        .prepare("UPDATE entries SET visibility = ?1 WHERE album IS NULL OR album = ''")
        .bind(vis)
        .run();
    } else {
      res = await context.env.DB
        .prepare('UPDATE entries SET visibility = ?1 WHERE album = ?2')
        .bind(vis, album)
        .run();
    }
    return Response.json({ ok: true, count: (res.meta && res.meta.changes) || 0 });
  }

  return Response.json({ error: '未知操作' }, { status: 400 });
}
