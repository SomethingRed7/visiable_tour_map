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

  // 专辑名 + 条目数(全部条目,含私有;管理场景需要看到全量)
  const { results } = await context.env.DB
    .prepare("SELECT album, COUNT(*) AS cnt FROM entries WHERE album IS NOT NULL AND album != '' GROUP BY album ORDER BY album ASC")
    .all();
  const { results: total } = await context.env.DB
    .prepare('SELECT COUNT(*) AS c FROM entries')
    .all();
  return Response.json({
    albums: results.map((r) => ({ album: r.album, count: r.cnt })),
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
    if (!album) return Response.json({ error: '专辑名不能为空' }, { status: 400 });
    const res = await context.env.DB
      .prepare('UPDATE entries SET visibility = ?1 WHERE album = ?2')
      .bind(vis, album)
      .run();
    return Response.json({ ok: true, count: (res.meta && res.meta.changes) || 0 });
  }

  return Response.json({ error: '未知操作' }, { status: 400 });
}
