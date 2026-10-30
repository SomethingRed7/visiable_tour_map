// 把 android-app/assets 下的源图铺进 Android res/(覆盖 Capacitor 模板的默认机器人图标)
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const RES = path.join(__dirname, '../android-app/android/app/src/main/res');
const SRC = path.join(__dirname, '../android-app/assets');

const BG = '#F7B84B';
const CREAM = '#FDF8F3';

const DUCK = `
  <g>
    <ellipse cx="46" cy="63" rx="25" ry="16.5" fill="#FFFFFF"/>
    <ellipse cx="43" cy="63" rx="10" ry="6.5" fill="none" stroke="#F0E4D4" stroke-width="2.2"/>
    <circle cx="60" cy="44" r="14" fill="#FFFFFF"/>
    <path d="M72 40.5 L87 46 L72 51 Z" fill="#F07E2E"/>
    <circle cx="64" cy="39.5" r="2.3" fill="#4A3B2C"/>
  </g>`;

const duckSvg = (size, { bg, scale }) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  ${bg ? `<rect width="100" height="100" fill="${bg}"/>` : ''}
  <g transform="translate(50,50) scale(${scale}) translate(-50,-50)"><g transform="translate(-6.5,1.5)">${DUCK}</g></g>
</svg>`;

const DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];

// 启动图各分辨率（竖屏 / 横屏）
const SPLASH = {
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1280, 1920],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280],
};

// 圆角方块 logo（用于启动图）
async function logoPng(size) {
  const inner = await sharp(Buffer.from(duckSvg(size, { bg: BG, scale: 0.7 })))
    .resize(size, size)
    .png()
    .toBuffer();
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="#fff"/></svg>`
  );
  return sharp(inner).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

(async () => {
  // 1. 传统图标 + 圆形图标 + 自适应前景
  for (const [dp, k] of DENSITIES) {
    const dir = path.join(RES, `mipmap-${dp}`);
    fs.mkdirSync(dir, { recursive: true });

    const legacy = Math.round(48 * k);
    await sharp(Buffer.from(duckSvg(legacy, { bg: BG, scale: 0.78 }))).png().toFile(path.join(dir, 'ic_launcher.png'));

    const roundMask = `<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}" fill="#fff"/></svg>`;
    await sharp(Buffer.from(duckSvg(legacy, { bg: BG, scale: 0.66 })))
      .composite([{ input: Buffer.from(roundMask), blend: 'dest-in' }])
      .png()
      .toFile(path.join(dir, 'ic_launcher_round.png'));

    const fg = Math.round(108 * k);
    await sharp(Buffer.from(duckSvg(fg, { bg: null, scale: 0.5 }))).png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }

  // 2. 自适应图标背景色
  fs.writeFileSync(
    path.join(RES, 'values/ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`
  );

  // 3. 启动图
  for (const [dirName, [w, h]] of Object.entries(SPLASH)) {
    const dir = path.join(RES, dirName);
    fs.mkdirSync(dir, { recursive: true });
    const logoSize = Math.round(Math.min(w, h) * 0.56);
    const logo = await logoPng(logoSize);
    await sharp({ create: { width: w, height: h, channels: 4, background: CREAM } })
      .composite([{ input: logo, top: Math.round((h - logoSize) / 2), left: Math.round((w - logoSize) / 2) }])
      .png()
      .toFile(path.join(dir, 'splash.png'));
  }
  // 兜底 drawable/splash.png
  const fallbackLogo = await logoPng(400);
  await sharp({ create: { width: 960, height: 1600, channels: 4, background: CREAM } })
    .composite([{ input: fallbackLogo, top: 600, left: 280 }])
    .png()
    .toFile(path.join(RES, 'drawable/splash.png'));

  // 清理模板遗留的矢量机器人前景（adaptive icon 已改用 png）
  const stale = path.join(RES, 'drawable-v24/ic_launcher_foreground.xml');
  if (fs.existsSync(stale)) fs.unlinkSync(stale);

  console.log('android res generated');
})();
