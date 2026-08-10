# 旅行地图集 (visiable_tour_map)

数据驱动的可视化旅行网站:每个行程一个 JSON,地图 + 每日时间线 + 照片 + 报平安播报。飞书文档为唯一权威数据源,Hermes 按需同步。

## 线上地址

https://somethingred7.github.io/visiable_tour_map/ (二维码:qr-website.png)

## 本地预览

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 目录结构

```
data/trips/index.json   行程列表(决定头部切换器)
data/trips/<id>.json    每个行程的完整数据(meta + days + routes)
photos/<tripId>/dayNN/  照片(压缩后)
scripts/                工具脚本(照片压缩、数据校验)
```

## 新行程接入

1. 复制 `data/trips/nz2026.json` 为 `data/trips/<新id>.json`,填入行程数据
2. 在 `data/trips/index.json` 的数组里加一项 `{id, title, subtitle, departure, return, updated_at}`
3. 照片放 `photos/<新id>/dayNN/`,在 days 的 `photos` 数组里引用
4. **push 前必跑**数据契约校验(日期连续/坐标/隐私残留/照片引用):

   ```bash
   python3 scripts/validate_trips.py
   ```

5. `git push`,网站自动出现行程切换

详见 spec:https://github.com/SomethingRed7/visiable_tour_map/issues/1

## 备注

- `logs/`(MCP 运行日志)与 `.hermes/`(本地计划文档)不在仓库维护范围,已 gitignore
