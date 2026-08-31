// 专辑管理 API(全部需登录会话):
//   GET  /api/albums                 → 专辑列表 [{album, count}] + total(条目数)
//   POST /api/albums                 → 操作(JSON body):
//        { action: 'rename', old, new }            改名(同步该专辑下全部条目)
//        { action: 'visibility', album, vis }      一键设置专辑下全部条目公开/私密
//        { action: 'set_album', album, items }     管理条目批量归专辑(items=[{date,ts}],album=''=未分类)
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

  if (action === 'set_album') {
    // 管理条目批量归专辑:items = [{date, ts}, ...],album='' 表示移入未分类(album 置 NULL)
    const album = body.album != null ? String(body.album).trim().slice(0, 50) : '';
    const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
    if (!items.length) return Response.json({ error: '没有要处理的条目' }, { status: 400 });
    let changes = 0;
    for (const it of items) {
      const date = String(it.date || '');
      const ts = String(it.ts || '');
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !/^[0-9]{13}$/.test(ts)) continue;
      const res = await context.env.DB
        .prepare('UPDATE entries SET album = ?1 WHERE date = ?2 AND ts = ?3')
        .bind(album || null, date, Number(ts))
        .run();
      changes += (res.meta && res.meta.changes) || 0;
    }
    return Response.json({ ok: true, count: changes });
  }

  return Response.json({ error: '未知操作' }, { status: 400 });
}
