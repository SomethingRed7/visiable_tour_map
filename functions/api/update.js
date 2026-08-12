// 更新 API:POST /api/update(multipart)
// 字段:date, ts(定位条目), title, text, album, location, lat, lng,
//      photos_to_remove(JSON 数组:要删除的照片路径), photo_full[]/photo_thumb[](新增照片)
// 权限:需登录会话;author 不随编辑变更(保留原署名);新增照片同上传加固
import { verifySession } from '../_lib/auth.js';
import { imageError, MAX_PHOTOS, MAX_FILE_BYTES } from '../_lib/images.js';

export async function onRequestPost(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const form = await context.request.formData();
  const date = (form.get('date') || '').trim();
  const ts = (form.get('ts') || '').trim();

  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !/^[0-9]{13}$/.test(ts)) {
    return Response.json({ error: '参数不对' }, { status: 400 });
  }

  const row = await context.env.DB.prepare('SELECT * FROM entries WHERE date = ?1 AND ts = ?2')
    .bind(date, Number(ts))
    .first();
  if (!row) return Response.json({ error: '条目不存在' }, { status: 404 });

  let photos = [];
  let photoHashes = [];
  try { photos = JSON.parse(row.photos || '[]'); } catch { photos = []; }
  try { photoHashes = JSON.parse(row.photo_hashes || '[]'); } catch { photoHashes = []; }

  // 文字字段(未提交的保留原值)
  const title = form.get('title') != null ? form.get('title').trim() : row.title;
  const text = form.get('text') != null ? form.get('text').trim() : row.text;
  const albumRaw = form.get('album');
  const album = albumRaw != null ? (albumRaw.trim() || null) : row.album;
  // author 不随编辑变更:保留原署名(登录身份只决定"谁在操作",不重写历史)
  const author = row.author;
  const locationNameRaw = form.get('location');

  // 地点:提交了 location 字段才更新
  let location = null;
  if (locationNameRaw != null) {
    const locationName = locationNameRaw.trim();
    if (locationName) {
      const latRaw = parseFloat(form.get('lat'));
      const lngRaw = parseFloat(form.get('lng'));
      if (Number.isFinite(latRaw) && Number.isFinite(lngRaw)) {
        location = { name: locationName, lat: latRaw, lng: lngRaw, display: locationName };
      } else {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=zh-CN&q=${encodeURIComponent(locationName)}`,
            { headers: { 'User-Agent': 'gugugaga-travel-diary/1.0 (personal use)' }, signal: AbortSignal.timeout(8000) }
          );
          if (res.ok) {
            const arr = await res.json();
            if (arr.length > 0) {
              location = {
                name: locationName,
                lat: parseFloat(arr[0].lat),
                lng: parseFloat(arr[0].lon),
                display: (arr[0].display_name || locationName).slice(0, 80),
              };
            }
          }
        } catch { /* 忽略 */ }
      }
      if (!location) location = { name: locationName, lat: null, lng: null, display: locationName };
    }
  } else {
    try { location = row.location ? JSON.parse(row.location) : null; } catch { location = null; }
  }

  // 删除指定照片:按路径定位索引,同步移除 R2/列表/哈希
  const toRemoveRaw = form.get('photos_to_remove');
  let maxIdx = -1; // 现有+已删照片的最大编号(新照片必须大于它,防止路径复用)
  if (toRemoveRaw) {
    try {
      const toRemove = new Set(JSON.parse(toRemoveRaw));
      photos.forEach((p) => {
        const m = p.match(/-(\d+)\.jpg$/);
        if (m) maxIdx = Math.max(maxIdx, parseInt(m[1], 10));
      });
      const idxs = photos.map((p, i) => (toRemove.has(p) ? i : -1)).filter((i) => i >= 0).sort((a, b) => b - a);
      for (const idx of idxs) {
        const k = photos[idx].replace(/^\/photos\//, '');
        if (k) {
          await context.env.PHOTOS.delete(k);
          await context.env.PHOTOS.delete(k.replace(/\.(jpg|jpeg|png)$/i, '-thumb.$1'));
        }
        photos.splice(idx, 1);
        if (idx < photoHashes.length) photoHashes.splice(idx, 1);
      }
    } catch { /* 忽略解析错误 */ }
  }

  // 新增照片(前端已压缩);去重只针对本条剩余照片(编辑时允许跨条目复用照片——
  // 用户整理/移动照片到别的同日条目是正常操作;防重复只适用于新上传,见 upload.js)
  // 加固同上传:≤20 张、≤10MB、image/* + 魔数
  const fulls = form.getAll('photo_full').filter((f) => typeof f !== 'string');
  const thumbs = form.getAll('photo_thumb').filter((f) => typeof f !== 'string');
  if (fulls.length > MAX_PHOTOS) {
    return Response.json({ error: `一次最多 ${MAX_PHOTOS} 张照片` }, { status: 400 });
  }
  for (const t of thumbs) {
    if (t.size > MAX_FILE_BYTES) return Response.json({ error: '单张照片不能超过 10MB' }, { status: 400 });
  }
  if (fulls.length > 0) {
    const ownHashes = new Set(photoHashes);
    // 新照片编号:必须大于 现有+已删 的最大编号(路径复用会被 photos 路由的
    // immutable 1yr 边缘缓存掩盖——URL 相同则旧图仍被缓存,表现为"替换没生效")
    let nextIdx = maxIdx + 1;
    for (let i = 0; i < fulls.length; i++) {
      const f = fulls[i];
      const buf = await f.arrayBuffer();
      const err = imageError(buf, f.type, f.size);
      if (err) return Response.json({ error: err }, { status: 400 });
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (ownHashes.has(hash)) {
        return Response.json({ error: '这张照片在这条日记里已经有一张了,换一张或去掉重复' }, { status: 400 });
      }
      const base = `${date}/${ts}-${nextIdx + i}`;
      await context.env.PHOTOS.put(`${base}.jpg`, f.stream(), { httpMetadata: { contentType: 'image/jpeg' } });
      if (thumbs[i]) {
        await context.env.PHOTOS.put(`${base}-thumb.jpg`, thumbs[i].stream(), { httpMetadata: { contentType: 'image/jpeg' } });
      }
      photos.push(`/photos/${base}.jpg`);
      photoHashes.push(hash);
    }
  }

  await context.env.DB.prepare(
    'INSERT OR REPLACE INTO entries (date, ts, title, text, album, author, location, photos, photo_hashes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)'
  )
    .bind(date, Number(ts), title, text, album, author, JSON.stringify(location), JSON.stringify(photos), JSON.stringify(photoHashes), row.created_at)
    .run();

  const entry = { date, title, text, album, author, location, ts: Number(ts), photos, created_at: row.created_at };
  return Response.json({ ok: true, entry });
}
