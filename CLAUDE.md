# CLAUDE.md

This file provides guidance to Claude Code (and other coding agents) when working in this repository.

## Project overview

可视化旅行网站(static site):飞书文档为唯一权威行程数据源,Hermes 按需同步生成 `data/trips/<id>.json`,GitHub Pages 部署。核心场景=给家人报平安;多行程可拓展。当前行程:新西兰蜜月 2026-08-29 ~ 09-13(nz2026)。

- 实施计划:`.hermes/plans/2026-08-10_143657-tour-map-website.md`
- Spec issue:https://github.com/SomethingRed7/visiable_tour_map/issues/1

## Agent skills

### Issue tracker

Issues live in GitHub Issues (repo `SomethingRed7/visiable_tour_map`)。注意:本机无 `gh` CLI,用 curl + `~/.git-credentials` 的 token 操作。See `docs/agents/issue-tracker.md`.

### Triage labels

默认 triage 词汇表,五个角色标签即标签名:`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`。See `docs/agents/triage-labels.md`.

### Domain docs

Single-context 布局(根目录 `CONTEXT.md` + `docs/adr/`,均尚不存在,按需惰性创建)。领域词汇(行程/播报/计划行程/报平安)见 `docs/agents/domain.md`。
