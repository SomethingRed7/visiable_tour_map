// 分享链接名 / 导出文件名:不用随机名,中文转英文拼音 slug
// - 有专辑名 → 专辑名(如 长沙2026 → changsha-2026)
// - 否则     → 起止日期 + 英文标识(如 2026-08-29~2026-09-13-trip)
import { pinyin } from 'pinyin-pro';

export function albumSlug(name) {
  if (!name) return '';
  const arr = pinyin(String(name), { toneType: 'none', type: 'array', nonZh: 'consecutive' });
  return arr
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // 标点/空格 → -
    .replace(/([a-z])([0-9])/g, '$1-$2') // 字母与数字交界加分隔
    .replace(/([0-9])([a-z])/g, '$1-$2')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function shareName(album, from, to) {
  if (album) {
    const s = albumSlug(album);
    if (s) return s;
  }
  if (from && to) return `${from}~${to}-trip`;
  return 'trip';
}
