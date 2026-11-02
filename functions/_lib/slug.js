// 分享链接名 / 导出文件名:不用随机名,中文转英文拼音 slug
// - 有专辑名 → 专辑名(如 长沙2026 → changsha-2026)
// - 否则     → 起止日期 + 英文标识(如 2026-08-29~2026-09-13-trip)
import pinyin from 'tiny-pinyin';

export function albumSlug(name) {
  if (!name) return '';
  const py = pinyin.convertToPinyin(String(name), '', true); // 长沙2026 → changsha2026;NZ 原样保留
  return py
    .replace(/([A-Z]+)/g, '-$1') // 连续大写字母前加分隔(新西兰NZ → xinxilan-NZ)
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

/* 分享 token 的随机后缀。
 * 原来 token 就是专辑名拼音(changsha-2026)或日期区间,纯可枚举 —— 猜几个常见专辑名
 * 就能撞到别人分享过的快照,而静态页没有任何防枚举。加一段随机后,不拿到链接进不来。
 * 用 crypto 而不是 Math.random:后者在 Worker 里同实例内可预测。 */
export function randomSuffix(len = 4) {
  const AB = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += AB[b % AB.length];
  return s;
}
