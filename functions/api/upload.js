// 上传 API:POST /api/upload(multipart)
// 字段:date, title, text, album, location, lat, lng, photo_full[] / photo_thumb[]
// 权限:需登录会话(author 一律取自登录身份,不接受客户端指定)
// 照片 → R2 photos/<date>/<ts>-<n>.jpg(+ -thumb),条目 → D1(强一致)
// 防重复:同一天同照片内容(SHA-256)拒绝;地点已带坐标则直存,否则服务端 Nominatim 编码
// 加固:单文件 ≤10MB、单请求 ≤20 张、Content-Type image/* + 魔数嗅探(见 _lib/images.js)
import { verifySession, rateLimitUpload } from '../_lib/auth.js';
import { MAX_PHOTOS, MAX_FILE_BYTES } from '../_lib/images.js';
import { MAX_TITLE, MAX_TEXT, resolveLocation, validatePhotos, storePhotos, insertEntry } from '../_lib/entries.js';

export async function onRequestPost(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const rl = await rateLimitUpload(context.env, user);
  if (!rl.allowed) {
    return Response.json({ error: '上传太频繁了,休息 15 分钟再试' }, { status: 429 });
  }

  const form = await context.request.formData();
  const date = (form.get('date') || '').trim();
  const title = (form.get('title') || '').trim();
  const text = (form.get('text') || '').trim();
  const album = (form.get('album') || '').trim() || null;
  const locationName = (form.get('location') || '').trim() || null;
  const latRaw = parseFloat(form.get('lat'));
  const lngRaw = parseFloat(form.get('lng'));

  if (title.length > MAX_TITLE) return Response.json({ error: `标题最多 ${MAX_TITLE} 字` }, { status: 400 });
  if (text.length > MAX_TEXT) return Response.json({ error: `正文最多 ${MAX_TEXT} 字` }, { status: 400 });
  // 可见性:公开(默认)/私有(仅登录可见);非法值一律按公开
  const visibility = form.get('visibility') === 'private' ? 'private' : 'public';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: '日期格式不对,应为 YYYY-MM-DD' }, { status: 400 });
  }

  const fulls = form.getAll('photo_full').filter((f) => typeof f !== 'string');
  const thumbs = form.getAll('photo_thumb').filter((f) => typeof f !== 'string');
  if (!title && !text && fulls.length === 0) {
    return Response.json({ error: '内容为空:至少填标题/文字/照片之一' }, { status: 400 });
  }
  for (const t of thumbs) {
    if (t.size > MAX_FILE_BYTES) return Response.json({ error: '单张照片不能超过 10MB' }, { status: 400 });
  }

  // 照片校验 + 同日 SHA-256 去重
  let photoHashes = [];
  try {
    const vp = await validatePhotos(context.env, date, fulls, MAX_PHOTOS);
    photoHashes = vp.map((p) => p.hash);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }

  // 地点:已有坐标直存;否则地名 geocode(失败仅存地名)
  const location = await resolveLocation(locationName, latRaw, lngRaw);

  const ts = Date.now();
  const photoPaths = await storePhotos(context.env, date, ts, fulls, thumbs);

  const entry = {
    date, title, text, album, author: user, location,
    ts,
    photos: photoPaths,
    photo_hashes: photoHashes,
    visibility,
    created_at: new Date().toISOString(),
  };
  await insertEntry(context.env, entry);
  return Response.json({ ok: true, entry });
}
