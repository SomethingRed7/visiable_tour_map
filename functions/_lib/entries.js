// 条目共享管道:地点解析 / 照片校验去重 / R2 存储 / 条目增删
// upload.js(日记)、toggle.js(打卡)共用,保证行为一致
import { imageError } from './images.js';

export const MAX_TITLE = 200;
export const MAX_TEXT = 5000;

// 地点:已有坐标直存;否则地名 geocode(Nominatim,失败仅存地名)
export async function resolveLocation(locationName, latRaw, lngRaw) {
  if (!locationName) return null;
  if (Number.isFinite(latRaw) && Number.isFinite(lngRaw)) {
    return { name: locationName, lat: latRaw, lng: lngRaw, display: locationName };
  }
  try {
    const q = encodeURIComponent(locationName);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=zh-CN&q=${q}`, {
      headers: { 'User-Agent': 'gugugaga-travel-diary/1.0 (personal use)' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const arr = await res.json();
      if (arr.length > 0) {
        return {
          name: locationName,
          lat: parseFloat(arr[0].lat),
          lng: parseFloat(arr[0].lon),
          display: (arr[0].display_name || locationName).slice(0, 80),
        };
      }
    }
  } catch { /* 忽略 */ }
  return { name: locationName, lat: null, lng: null, display: locationName };
}

// 照片校验(大小/魔数)+ 同日 SHA-256 去重;返回 [{file, hash}];超限抛 {message}
export async function validatePhotos(env, date, fulls, maxPhotos) {
  if (fulls.length > maxPhotos) throw { message: `一次最多 ${maxPhotos} 张照片` };
  const existingHashes = new Set();
  try {
    const rows = await env.DB.prepare('SELECT photo_hashes FROM entries WHERE date = ?1')
      .bind(date)
      .all();
    for (const r of rows.results || []) {
      for (const h of JSON.parse(r.photo_hashes || '[]')) existingHashes.add(h);
    }
  } catch { /* DB 不可用则跳过去重 */ }
  const out = [];
  for (const f of fulls) {
    const buf = await f.arrayBuffer();
    const err = imageError(buf, f.type, f.size);
    if (err) throw { message: err };
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (existingHashes.has(hash)) throw { message: '这张照片今天已经传过啦,换一张或去掉重复' };
    out.push({ file: f, hash });
  }
  return out;
}

// R2 存储(大图 + 缩略图),返回条目内显示路径列表
export async function storePhotos(env, date, ts, fulls, thumbs) {
  const photoPaths = [];
  for (let i = 0; i < fulls.length; i++) {
    // R2 key 不带 photos/ 前缀;条目里的显示路径带 /photos/ 前缀
    const base = `${date}/${ts}-${i}`;
    await env.PHOTOS.put(`${base}.jpg`, fulls[i].stream(), {
      httpMetadata: { contentType: 'image/jpeg' },
    });
    if (thumbs[i]) {
      await env.PHOTOS.put(`${base}-thumb.jpg`, thumbs[i].stream(), {
        httpMetadata: { contentType: 'image/jpeg' },
      });
    }
    photoPaths.push(`/photos/${base}.jpg`);
  }
  return photoPaths;
}

// 条目插入(D1,强一致)
export async function insertEntry(env, entry) {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO entries (date, ts, title, text, album, author, location, photos, photo_hashes, visibility, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)'
  )
    .bind(
      entry.date, entry.ts, entry.title, entry.text, entry.album, entry.author,
      JSON.stringify(entry.location), JSON.stringify(entry.photos), JSON.stringify(entry.photo_hashes),
      entry.visibility, entry.created_at
    )
    .run();
}

// 条目 + 照片删除(R2 大图+缩略图);返回是否删到
export async function deleteEntryWithPhotos(env, date, ts) {
  const row = await env.DB.prepare('SELECT photos FROM entries WHERE date = ?1 AND ts = ?2')
    .bind(date, Number(ts))
    .first();
  if (!row) return false;
  try {
    const photos = JSON.parse(row.photos || '[]');
    for (const p of photos) {
      const k = p.replace(/^\/photos\//, '');
      if (!k) continue;
      await env.PHOTOS.delete(k);
      await env.PHOTOS.delete(k.replace(/\.(jpg|jpeg|png)$/i, '-thumb.$1'));
    }
  } catch { /* R2 清理失败不阻断条目删除 */ }
  await env.DB.prepare('DELETE FROM entries WHERE date = ?1 AND ts = ?2')
    .bind(date, Number(ts))
    .run();
  return true;
}
