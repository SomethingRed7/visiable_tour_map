// 共享上传校验:大小上限 + Content-Type + 魔数嗅探
// 前端(写日记页)统一 canvas 压缩为 JPEG;魔数校验拒绝伪装成图片的任意文件
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 单文件 ≤10MB
export const MAX_PHOTOS = 20; // 单请求 ≤20 张

export function imageError(buf, mimeType, size) {
  if (size > MAX_FILE_BYTES) return '单张照片不能超过 10MB';
  if (!mimeType || !mimeType.startsWith('image/')) return '只接受图片文件';
  const b = new Uint8Array(buf, 0, 12);
  const eq = (prefix) => prefix.every((v, i) => b[i] === v);
  const isWebp = eq([0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP';
  const ok = eq([0xff, 0xd8, 0xff])        // JPEG
    || eq([0x89, 0x50, 0x4e, 0x47])        // PNG
    || isWebp                              // WebP
    || eq([0x47, 0x49, 0x46, 0x38]);       // GIF
  if (!ok) return '文件不是有效的图片(jpg/png/webp/gif)';
  return null;
}
