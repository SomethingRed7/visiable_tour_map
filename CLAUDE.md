# CLAUDE.md

This file provides guidance to coding agents when working in this repository.

## Project overview

通用旅行日记 portal「咕咕嘎嘎」:纯静态前端 + Cloudflare Pages Functions(R2 存照片、D1 存条目),上传即时可见零重建。用户自行网页上传,公开查看,家人随时可看。仓库 `SomethingRed7/visiable_tour_map`(**private**)。线上 https://gugugaga-viw.pages.dev/。

- 架构/运维/数据维护:见 skill `tour-map-site`(权威);Cloudflare 平台细节见 skill `cloudflare-pages`
- 本仓库实现:前端 `public/`(index.html 门户 / write-6e1645f2.html 写日记页 / export.html 导出分享页)+ `functions/`(API)+ `wrangler.toml`(D1/R2 绑定 + `[vars] DELETE_PASS`)+ `schema.sql`(D1 建表)
- 数据模型:{date, ts, title, text, album, author(球|小红), location{name,lat,lng,display}, photos[], photo_hashes[], created_at};照片存 R2(路径不带 photos/ 前缀),条目存 D1(强一致)
- 权限:上传无口令(隐秘 URL 保护);编辑/删除需 4 位 PIN(2026,wrangler.toml [vars])

## 开发循环

```bash
npm run dev        # wrangler pages dev public(本地 miniflare 模拟 D1/R2,免费无账号)
npm run deploy     # wrangler pages deploy public --project-name gugugaga
npx wrangler d1 execute gugugaga-db --remote --file schema.sql   # 建表/迁移
```

测试接缝 = API 契约:`wrangler pages dev` + curl(上传→立即查询、同日照片去重 400、错误 PIN 401、update 删图 404、route 折线)。前端浏览器冒烟。**部署后等 ~60s 传播期**再验收(新旧 bundle 混跑会假故障)。

## 关键经验(详见 skills)

- 条目存储用 D1 不用 KV:KV 最终一致(最长 60s)导致上传后查不到/去重穿透,无强一致读选项(`type:'strong'` 是响应类型,会抛错)
- 删除/编辑接口按条目内嵌 `ts` 定位,勿从 created_at 推导(差几毫秒→条目不存在)
- 国内网络:OSM 瓦片/Nominatim/OSRM 浏览器直连不可达 → 全部走 CF 边缘代理(geocode/route 已在 functions 内实现,失败回退)
- 照片删除不可逆:delete API 同步删 R2 大图+缩略图;误删 D1 行可从遗留 KV 备份恢复,照片无法恢复
- 上传/删除/编辑全链路细节、部署传播、边缘缓存 7 天、wrangler CLI 坑:见 `cloudflare-pages` skill

## 约束

- 不 commit/push 除非用户要求;github.com 间歇被墙 → push 失败用后台循环重试
- 用户数据(真实日记)勿删;测试条目用完即清
- 用户沟通极简;grill 一次一题带推荐项;歧义(如"去掉删除")先问清是指标题文字还是按钮
