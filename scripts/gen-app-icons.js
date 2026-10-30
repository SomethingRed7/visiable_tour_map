// 生成 android-app/assets 下的图标与启动图
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '../android-app/assets');
fs.mkdirSync(OUT, { recursive: true });

const BG = '#F7B84B';
const CREAM = '#FDF8F3';
const BEAK = '#F07E2E';
const INK = '#4A3B2C';

// 100x100 视窗里的鸭子
const DUCK = `
  <g>
    <ellipse cx="46" cy="63" rx="25" ry="16.5" fill="#FFFFFF"/>
    <ellipse cx="43" cy="63" rx="10" ry="6.5" fill="none" stroke="#F0E4D4" stroke-width="2.2"/>
    <circle cx="60" cy="44" r="14" fill="#FFFFFF"/>
    <path d="M72 40.5 L87 46 L72 51 Z" fill="${BEAK}"/>
    <circle cx="64" cy="39.5" r="2.3" fill="${INK}"/>
  </g>`;

function svg({ bg, duckScale = 0.86, duckOnly = false }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 100 100">
    ${bg ? `<rect width="100" height="100" fill="${bg}"/>` : ''}
    <g transform="translate(50,50) scale(${duckScale}) translate(-50,-50)"><g transform="translate(-6.5,1.5)">${DUCK}</g></g>
  </svg>`;
}

(async () => {
  // 1. 传统方形图标（带底色，系统会自己裁圆角）
  await sharp(Buffer.from(svg({ bg: BG, duckScale: 0.78 })))
    .png().resize(1024, 1024)
    .toFile(path.join(OUT, 'icon-only.png'));
  await sharp(Buffer.from(svg({ bg: BG, duckScale: 0.78 })))
    .png().resize(512, 512)
    .toFile(path.join(OUT, 'icon.png'));

  // 2. 自适应图标：前景（透明+鸭子，缩到安全区）/ 背景（纯色）
  await sharp(Buffer.from(svg({ bg: null, duckScale: 0.56 })))
    .png().resize(1024, 1024)
    .toFile(path.join(OUT, 'icon-foreground.png'));
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: BG } })
    .png()
    .toFile(path.join(OUT, 'icon-background.png'));

  // 3. 启动图：奶油底 + 居中圆角方块 logo（CENTER_CROP 会被裁，故留足边距）
  const logoLayer = await sharp(Buffer.from(svg({ bg: BG, duckScale: 0.7 })))
    .png().resize(560, 560)
    .composite([{ input: Buffer.from(`<svg width="560" height="560"><rect width="560" height="560" rx="128" fill="none"/></svg>`), blend: 'dest-in' }])
    .png().toBuffer();

  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: CREAM } })
    .composite([{ input: logoLayer, top: Math.round((2732 - 560) / 2), left: Math.round((2732 - 560) / 2) }])
    .png()
    .toFile(path.join(OUT, 'splash.png'));

  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: CREAM } })
    .composite([{ input: logoLayer, top: Math.round((2732 - 560) / 2), left: Math.round((2732 - 560) / 2) }])
    .png()
    .toFile(path.join(OUT, 'splash-dark.png'));

  for (const f of fs.readdirSync(OUT)) {
    const s = fs.statSync(path.join(OUT, f));
    console.log(f, (s.size / 1024).toFixed(1) + 'KB');
  }
})();
