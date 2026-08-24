# 咕咕嘎嘎 (gugugaga)

通用旅行日记 portal:日历 + 每日动态 + 专辑聚合 + 公开上传。**双宿主架构**:

- **门户(只读)**:https://somethingred7.github.io/visiable_tour_map/ —— 静态托管于 GitHub Pages,公开浏览
- **登录/写日记/管理/API**:https://gugugaga-viw.pages.dev/ —— Cloudflare Pages Functions(R2 存照片、D1 存条目),同源 cookie 登录
- 门户跨域读取 API 由 `functions/_middleware.js` 放开 CORS;登录后在 pages.dev 操作,无需 token 鉴权

## 线上地址

- 门户(二维码:qr-gugugaga.png → 建议改指向 github.io):https://somethingred7.github.io/visiable_tour_map/
- 管理入口:https://gugugaga-viw.pages.dev/edit.html(门户底部有「管理」链接)

## 架构

- `public/` — 静态前端:
  - 发布到 github.io:index.html 门户 + app.js/loc-picker.js/entry-modal.js/api.js/style.css(只读)
  - 保留在 Cloudflare:write.html/edit.html/export.html(登录、写日记、导出,同源 cookie 鉴权)
- `functions/` — serverless(Cloudflare):
  - `_middleware.js` — CORS(github.io 门户读取 API)
  - `GET /api/entries?date=|month=|album=` — seed(预置条目)+ D1 合并查询,未登录只返回公开
  - `POST /api/upload` — multipart(前端已压缩 1600+480 两版),照片→R2,条目→D1
  - `GET /photos/<key>` — R2 直出,长缓存
- `functions/seed.js` — 预置条目(新西兰蜜月 2026,16 条),只读
- `wrangler.toml` — KV `ENTRIES` + R2 `PHOTOS` + D1 `DB` 绑定;`[vars]` 仅 USERS(密钥在 `.dev.vars`/CF Secrets)

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
