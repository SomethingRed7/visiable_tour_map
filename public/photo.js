/* 图片压缩(全站共用):等比缩放到 maxLen 内的 JPEG 字节流。
 *
 * 为什么单独一份 + 为什么要超时(用户 2026-09-15 反馈「经常卡在发布页面」):
 * 1) 原来 entry-modal / app.js / edit.js 各有一份几乎相同的实现,每张照片 full 和 thumb
 *    各解码一次大图(app.js 还是 Promise.all 并行解两次)。6 张照片就要解 12 次 12MP 大图,
 *    手机上又慢又容易在内存压力下卡住。
 * 2) 原实现只有 onerror 没有超时:解码或 canvas.toBlob 在移动端偶发"不回调",
 *    Promise 永不 settle → 界面永久停在「压缩照片 6/6...」。
 *
 * 现在的策略:
 * - 每张照片只解码一次,复用同一张解码图出 full + thumb
 * - 解码 / 编码都带超时,失败一律**退回原图**上传 —— 宁可文件大一点(超过 10MB 服务端会明确报错),
 *   也不能让整次发布永久挂住
 */
(function () {
  const FULL_LEN = 1600;
  const FULL_Q = 0.85;
  const THUMB_LEN = 480;
  const THUMB_Q = 0.75;
  const DECODE_MS = 20000; // 大图解码在慢机型上可能要好几秒,给足;超过就认为卡住
  const ENCODE_MS = 15000; // canvas.toBlob 正常是毫秒级

  function loadImage(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      let settled = false;
      const done = (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        resolve(v);
      };
      const timer = setTimeout(() => done(null), DECODE_MS);
      const img = new Image();
      img.onload = () => done(img);
      img.onerror = () => done(null); // 解码失败 / HEIC 等
      img.src = url;
    });
  }

  function encode(img, maxLen, quality) {
    return new Promise((resolve) => {
      try {
        const scale = Math.min(1, maxLen / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(null);
        }, ENCODE_MS);
        canvas.toBlob((blob) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(blob);
        }, 'image/jpeg', quality);
      } catch { resolve(null); }
    });
  }

  /* 压缩一张照片 → { full, thumb };任一步失败用原文件兜底(调用方直接 append 即可) */
  async function ggCompressPhoto(file) {
    const img = await loadImage(file);
    if (!img) return { full: file, thumb: file };
    const full = await encode(img, FULL_LEN, FULL_Q);
    const thumb = await encode(img, THUMB_LEN, THUMB_Q);
    return { full: full || file, thumb: thumb || file };
  }

  window.ggCompressPhoto = ggCompressPhoto;
})();
