# 调试记录 · 踩过的坑

> 只记「现象和根因离得远、下次八成还会再踩」的那类问题。
> 每条写清四件事：**现象 → 根因 → 修法 → 怎么早点发现**。
> 按类型分组，不按时间。

---

## 一、坐标系

### 1. GCJ-02 / WGS-84 混用，点位东南偏 550 米

**现象**：地图上的点和实际位置差几百米，反查地址认成隔壁小区。

**根因**：前端存的是 GCJ-02，却直接拿去查 OSM 系接口（Nominatim / Photon / Overpass / BigDataCloud），没转 WGS-84。

**修法**：
- 发给 OSM 系接口前先 `gcj2wgs`，拿回来再 `fromWgs`
- **高德系（瓦片 / regeo / place / around / Geolocation / Geocoder）本身就是 GCJ-02，绝不能转**
- 海外点位本就是 WGS-84，转换函数内部要按 `inChina(lat,lng)` 跳过

**早点发现**：只要「坐标系」出现在代码里，就先问清楚这条链路两头各是什么系。写死在函数注释里。

### 2. 国产浏览器返回的坐标已经是 GCJ-02

**现象**：按标准逻辑转换后反而偏了固定方向。

**根因**：夸克 / UC / QQ / 小米 / 华为等国产浏览器自带偏移适配，`navigator.geolocation` 直接给 GCJ-02。

**修法**：UA 白名单判断，命中就不转（`lpLooksGcjNative`）。

---

## 二、定位

### 3. IP 兜底"预发起"，等轮到它时早就超时了

**现象**：三层兜底全挂，界面只显示「定位失败」，但每一层单看都「应该能用」。

**根因**：

```js
const ipPromise = lpIpLocate();   // 链一开始就发起，它内部 8s abort
```

而链路预算是 native 9s + 高德 11s = **20s**，等真正降级到 IP 时，那个 promise 早已 reject。

**修法**：到点再发起，不预跑。

**早点发现**：给每一层算预算，**任何"预发起"的超时都必须大于整条链最坏耗时**，否则就是白做。

### 4. WebView 里的 geolocation 在国内基本是残的

**现象**：同一个页面，浏览器里能定位，装进 app 就永远失败。

**根因**：Android WebView 的 `navigator.geolocation` 底层走 Google 服务，国内机型没有 GMS。

**修法**：接原生定位 SDK（高德 `AMapLocationClient`），走系统定位 + 基站/WiFi。

**早点发现**：任何依赖 `navigator.geolocation` 的功能，都要在 WebView 里单独验一遍，别用浏览器代替。

### 5. 高德 SDK 不声明隐私合规 = 静默失败（最坑的一个）

**现象**：Key 是对的、权限也给了、依赖也在、编译通过，定位就是不工作，一路降级到 IP 城市级。

**根因**：2021 年后高德 SDK 要求**先声明隐私合规再定位**，否则 `startLocation()` 直接失败——**而且不报错、不回调**。

```java
AMapLocationClient.updatePrivacyShow(ctx, true, true);
AMapLocationClient.updatePrivacyAgree(ctx, true);
```

**修法**：在任何定位调用之前执行，且只执行一次。

**早点发现**：高德接入选型是**三件套**——依赖、Key（绑包名 + SHA1）、隐私合规声明。前两个缺会报错，第三个缺是静默失败。接完必须真机跑通一次才算完，不能以"编译通过"收工。

### 6. 服务端 catch 把真实原因吞了

**现象**：`/api/locate` 只回「IP 定位服务不可用」，无从下手。

**根因**：`catch { return Response.json({error:'xxx 不可用'}) }` 把 exception 丢了。

**修法**：至少在响应体里带上 `String(e.message)`。

**早点发现**：凡是「用户反馈某功能不可用、但界面只有一句笼统提示」的接口，先去看它的 catch 块。

---

## 三、缓存

### 7. Cloudflare Pages 的 `_headers` 是**拼接**不是覆盖

**现象**：给 `/sw.js` 写了 `no-cache`，但实际响应是

```
cache-control: public, max-age=2592000, immutable, public, max-age=0, must-revalidate
```

30 天那个排在最前面 → Service Worker 被缓存一个月 → **以后再也更新不了 SW**。

**根因**：多条规则命中同一路径时，同名 header 被追加而非替换。

**修法**：需要精确控制响应头的资源，交给 Functions 下发（本项目 SW 入口改成 `/swjs`），不跟静态规则打架。

**早点发现**：`curl -D-` 看完整头，**别用 `curl -I`**——HEAD 请求可能走 SPA fallback，看到的是假头。

### 8. Service Worker 自身的更新通道

SW 脚本一旦被长缓存，改了什么都不会生效。除了上面的头问题，注意：
- 静态资源的 `assetStaleWhileRevalidate` 靠 URL 里的 `?v=` 换版，但 **sw.js 自己的 URL 必须保持稳定**（否则注册会多份）
- 改 SW 逻辑要 bump 内部 `VERSION` 常量，激活时清旧缓存

### 9. localStorage 缓存也要版本号

**现象**：后端修了数据，手机上还是错的旧值。

**根因**：前端把反查结果缓存进 localStorage，key 没变。

**修法**：加 `_ggGeoCacheVer` 之类的版本号，后端修正时 bump。

---

## 四、构建与打包

### 10. 构建脚本整文件覆盖了配置，Key 静默变空

**现象**：APK 打出来了，构建日志全是 SUCCESS，装上定位不工作。

**根因**：

```bash
printf "sdk.dir=%s\n" "$ANDROID_HOME" > android/local.properties   # > 是整文件覆盖
```

把 `local.properties` 里刚写进去的 `AMAP_ANDROID_KEY` 冲成了空。Manifest 里 `value=""`，**构建不报任何错**。

**修法**：只更新目标行，保留其它键（过滤旧行再追加）。

**早点发现**：**注入式参数打完包必须验真的进了 APK**：

```bash
aapt2 dump xmltree --file AndroidManifest.xml app.apk | grep -A1 "你要的 meta-data key"
```

### 11. AGP 8 默认不生成 `BuildConfig`

**现象**：`BuildConfig.VERSION_CODE` 编译报 cannot find symbol。

**修法**：`buildFeatures { buildConfig true }`，或者改用 `PackageManager.getPackageInfo().getLongVersionCode()` 运行时读（本项目选了后者，不依赖 gradle 配置）。

### 12. `cap sync` 的 update 阶段会批量删上千个文件

**现象**：在受限环境里报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，构建中断。

**根因**：Capacitor 同步时会删除旧的 cordova 插件原生文件（本项目 1288 个）。

**修法**：容错——`assets` 的复制发生在 update **之前**，此时已是最新，失败不阻断构建。

---

## 五、应用内更新

### 13. 固定下载文件名 + 从不清理 = 更新完还是旧版本

**现象**：app 内点更新，装完版本号没变；系统安装器提示「已安装相同版本 1.4」。

**根因**：下载目标写死 `gugugaga-update.apk`，旧包一直留在目录里：
1. 再次下载到同名路径，DownloadManager 报 1008（文件已存在）直接失败
2. 通知栏里上一条「下载完成」还能点开，打开的就是旧包

**修法**：
- 下载前删掉残留包，删不掉就中止（不要带病继续）
- 装之前用 `PackageManager.getPackageArchiveInfo()` 读 **apk 文件自身**的 versionCode，与期望版本比对，不符就删包 + 提示重下

### 14. 自更新要求签名一致

新包和旧包的证书不同时，系统直接拒绝覆盖安装（提示「应用未签名」/「签名不一致」）。

**修法**：尽早固定 keystore，debug/release 都用同一套。⚠️ keystore 丢了 = 老用户再也收不到覆盖更新，只能卸载重装。

### 15. 服务端没法"推送"升级

**现象**：用户问「推送升级呀」。

**根因**：这套更新是 **app 拉**（启动时查清单），服务端无法反向唤醒客户端。真正的远程推送要 FCM，国内不可用。

**修法**：把「启动时查」的节流放宽松（本项目从 24 小时改成每次冷启动都查），至少做到"发版后打开就能看到"。

---

## 六、调试手法

### 16. headless 截图宽度 ≠ 页面 innerWidth

**现象**：截图里右边的按钮"消失了"、卡片右侧被裁，以为改出了横向溢出。

**根因**：`--window-size=430` 设了，但页面里 `window.innerWidth` 实际是 **500**，截图按 430 裁掉了一截。**布局完全正常**。

**修法（诊断姿势）**：在页面里打印出来看，一秒定位：

```js
document.documentElement.scrollWidth
element.getBoundingClientRect()   // left/right 有没有超出 innerWidth
```

截图实际尺寸用 PNG 头读，别信 `--window-size`。

### 17. 验证"东西真的进包了"，靠拆包而不是构建日志

```bash
aapt2 dump badging app.apk            # 版本号、权限、label
aapt2 dump xmltree --file AndroidManifest.xml app.apk   # meta-data 的值
unzip -p app.apk classes.dex | strings | grep "你的类名"  # 类/方法是否编进去
```

### 18. 验证服务端接口要带随机参数

`?cb=$RANDOM` —— 区分「边缘缓存」和「源站」。排查"改了没生效"时，先确认到底是不是缓存。

### 19. `BUILD SUCCESSFUL` 不代表功能正确

今天两个最隐蔽的 bug（Key 变空、隐私合规缺失）都是 **构建全绿、功能全废**。凡是"配置注入"和"第三方 SDK 初始化"，都要有一条**运行时**的验证路径，不能只看构建结果。
