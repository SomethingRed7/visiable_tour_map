// 勾选/取消打卡:POST /api/todos/toggle(multipart)
// 字段:id(必填);打卡内容可选:note, location, lat, lng, photo_full[]/photo_thumb[](≤9)
// 行为:
//  未完成→完成:若带打卡内容(备注/照片/定位任一项)→ 生成私有条目(标题「打卡:<待办文本>」,正文=备注)
//    并回写 checkin_ts;留空则仅翻转 done,不生成记录
//  完成→未完成:若有关联打卡条目 → 删除该条目(含 R2 照片)并清空 checkin_ts;无关联仅翻转
// 需登录;照片校验/去重/存储与上传共用 _lib/entries.js
import { verifySession, rateLimitUpload } from '../../_lib/auth.js';
import { MAX_FILE_BYTES } from '../../_lib/images.js';
import { MAX_TEXT, resolveLocation, validatePhotos, storePhotos, insertEntry, deleteEntryWithPhotos } from '../../_lib/entries.js';

const MAX_CHECKIN_PHOTOS = 9;

export async function onRequestPost(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const form = await context.request.formData();
  const id = Number(form.get('id'));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'id 不对' }, { status: 400 });

  const row = await context.env.DB
    .prepare('SELECT id, date, text, done, sort_order, checkin_ts FROM todos WHERE id = ?1')
    .bind(id).first();
  if (!row) return Response.json({ error: '待办不存在' }, { status: 404 });

  const note = (form.get('note') || '').trim();
  const album = (form.get('album') || '').trim().slice(0, 50);
  const visibility = form.get('visibility') === 'private' ? 'private' : 'public';
  const locationName = (form.get('location') || '').trim();
  const latRaw = parseFloat(form.get('lat'));
  const lngRaw = parseFloat(form.get('lng'));
  const fulls = form.getAll('photo_full').filter((f) => typeof f !== 'string');
  const thumbs = form.getAll('photo_thumb').filter((f) => typeof f !== 'string');
  const hasCheckin = Boolean(note || locationName || fulls.length > 0);

  if (row.done === 0) {
    // ---- 标记完成 ----
    if (hasCheckin) {
      if (note.length > MAX_TEXT) return Response.json({ error: `备注最多 ${MAX_TEXT} 字` }, { status: 400 });
      for (const t of thumbs) {
        if (t.size > MAX_FILE_BYTES) return Response.json({ error: '单张照片不能超过 10MB' }, { status: 400 });
      }
      const rl = await rateLimitUpload(context.env, user);
      if (!rl.allowed) {
        return Response.json({ error: '上传太频繁了,休息 15 分钟再试' }, { status: 429 });
      }

      // 幂等:原子抢占 done(WHERE done=0 保证并发时只有一个请求能成功),
      // 抢到后再生成条目;照片存储失败则回滚抢占
      const ts = Date.now();
      const claim = await context.env.DB
        .prepare('UPDATE todos SET done = 1, checkin_ts = ?1 WHERE id = ?2 AND done = 0')
        .bind(ts, id).run();
      if (!claim.meta || claim.meta.changes === 0) {
        return Response.json({ error: '已打卡过了' }, { status: 409 });
      }

      let photoHashes = [];
      try {
        const vp = await validatePhotos(context.env, row.date, fulls, MAX_CHECKIN_PHOTOS);
        photoHashes = vp.map((p) => p.hash);
      } catch (e) {
        await context.env.DB.prepare('UPDATE todos SET done = 0, checkin_ts = NULL WHERE id = ?1').bind(id).run();
        return Response.json({ error: e.message }, { status: 400 });
      }

      const location = await resolveLocation(locationName, latRaw, lngRaw);
      const photoPaths = await storePhotos(context.env, row.date, ts, fulls, thumbs);
      const entry = {
        date: row.date,
        ts,
        title: `打卡:${row.text}`,
        text: note,
        album: album || null,
        author: user,
        location,
        photos: photoPaths,
        photo_hashes: photoHashes,
        visibility,
        created_at: new Date().toISOString(),
      };
      try {
        await insertEntry(context.env, entry);
      } catch (e) {
        // 条目插入失败 → 回滚抢占 + 删已传照片
        await context.env.DB.prepare('UPDATE todos SET done = 0, checkin_ts = NULL WHERE id = ?1').bind(id).run();
        throw e;
      }
      const todo = await context.env.DB
        .prepare('SELECT id, date, text, done, sort_order, checkin_ts FROM todos WHERE id = ?1')
        .bind(id).first();
      return Response.json({ ok: true, todo, entry });
    } else {
      await context.env.DB.prepare('UPDATE todos SET done = 1 WHERE id = ?1').bind(id).run();
    }
  } else {
    // ---- 取消勾选 ----
    if (row.checkin_ts) {
      await deleteEntryWithPhotos(context.env, row.date, row.checkin_ts);
    }
    await context.env.DB.prepare('UPDATE todos SET done = 0, checkin_ts = NULL WHERE id = ?1').bind(id).run();
  }

  const todo = await context.env.DB
    .prepare('SELECT id, date, text, done, sort_order, checkin_ts FROM todos WHERE id = ?1')
    .bind(id).first();
  return Response.json({ ok: true, todo });
}
