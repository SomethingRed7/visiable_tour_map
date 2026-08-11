# CLAUDE.md

This file provides guidance to Claude Code (and other coding agents) when working in this repository.


## 约束
- github.com 间歇被墙 → push 失败用后台循环重试
- 用户数据(真实日记)勿删;测试条目用完即清


## grill 使用规范
- **一次仅问一个问题**
- 歧义问题必须问清楚
- grill会话完成以后，提示用户调用 /to-spec 归档

## Project overview

通用旅行日记 portal「咕咕嘎嘎」:纯静态前端 + Cloudflare Pages Functions(R2 存照片、D1 存条目),上传即时可见零重建。用户自行网页上传,公开查看,家人随时可看。仓库 `SomethingRed7/visiable_tour_map`(**private**)。线上 https://gugugaga-viw.pages.dev/。

- 架构/运维/数据维护:见 skill `tour-map-site`(权威);Cloudflare 平台细节见 skill `cloudflare-pages`
- 本仓库实现:前端 `public/`(index.html 门户 / write-6e1645f2.html 写日记页 / export.html 导出分享页)+ `functions/`(API)+ `wrangler.toml`(D1/R2 绑定 + `[vars] DELETE_PASS`)+ `schema.sql`(D1 建表)
- 数据模型:{date, ts, title, text, album, author(球|小红), location{name,lat,lng,display}, photos[], photo_hashes[], created_at};照片存 R2(路径不带 photos/ 前缀),条目存 D1(强一致)
- 权限:上传无口令(隐秘 URL 保护);编辑/删除需 4 位 PIN(2026,wrangler.toml [vars])
- 开发循环:`npm run dev`(wrangler pages dev public,本地 miniflare 模拟 D1/R2)/ `npm run deploy`;测试接缝=API 契约(curl),部署后等 ~60s 传播期再验收
- 关键经验:条目存储用 D1 不用 KV(最终一致性);删除/编辑按条目内嵌 ts 定位;国内网络 OSM/Nominatim/OSRM 直连不可达 → 走 CF 边缘代理(functions 内已实现,失败回退);照片删除不可逆,误删 D1 行可从遗留 KV 备份恢复;github.com 间歇被墙 → push 失败用后台循环重试

## Agent skills

### Issue tracker

Issues live in GitHub Issues (repo `SomethingRed7/visiable_tour_map`)。注意:本机无 `gh` CLI,用 curl + `~/.git-credentials` 的 token 操作。See `docs/agents/issue-tracker.md`.

### Triage labels

默认 triage 词汇表,五个角色标签即标签名:`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`。See `docs/agents/triage-labels.md`.

### Domain docs

Single-context 布局(根目录 `CONTEXT.md` + `docs/adr/`,均尚不存在,按需惰性创建)。领域词汇(行程/播报/计划行程/报平安)见 `docs/agents/domain.md`。
