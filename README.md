# 咕咕嘎嘎 (gugugaga)

通用旅行日记 portal:日历 + 每日动态 + 专辑聚合 + 公开上传。纯静态前端 + Cloudflare Pages Functions(R2 存照片,KV 存条目),上传即时可见、零重建。

## 线上地址

https://gugugaga-viw.pages.dev/ (二维码:qr-gugugaga.png)

## 架构

- `public/` — 静态前端(index.html portal / upload.html 写日记)
- `functions/` — serverless:
  - `GET /api/entries?date=|month=|album=` — seed(预置条目)+ KV 合并查询
  - `POST /api/upload` — multipart(前端已压缩 1600+480 两版),照片→R2,条目→KV
  - `GET /photos/<key>` — R2 直出,长缓存
- `functions/seed.js` — 预置条目(新西兰蜜月 2026,16 条),只读
- `wrangler.toml` — KV `ENTRIES` + R2 `PHOTOS` 绑定

## 本地开发

```bash
npm install
npm run dev        # wrangler pages dev public(本地模拟 KV/R2,无需账号)
```

## 部署

```bash
npx wrangler login                                  # 首次授权
npx wrangler r2 bucket create gugugaga-photos       # 首次(需 dashboard 启用 R2)
npx wrangler kv namespace create ENTRIES            # 首次,id 写入 wrangler.toml
npm run deploy                                      # wrangler pages deploy public
```

## 数据流

写日记(手机浏览器)→ 前端 canvas 压缩(1600 大图 + 480 缩略图,兼容微信浏览器)→ POST /api/upload → 照片入 R2、条目入 KV → 首页日历即时可见。

## 注意

- 仓库 private;部署面仅 `public/` + `functions/`(scripts/data 不暴露)
- 完全公开上传,无鉴权(v1 决策);无删除 UI,错传需清 KV/R2
- 上传照片带 immutable 长缓存,删除对象后边缘缓存仍可服务至 TTL(无条目引用则不可见)
