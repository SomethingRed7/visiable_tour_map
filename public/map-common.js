/* 咕咕嘎嘎 共享地图/条目组件
 * —— 主页专辑地图、分享页地图、导出页地图、地图打卡点预览全部复用这一个文件
 * 加载方式:<script src="map-common.js"> 先于 app.js/share-view.js/export.js
 * 暴露全局 window.MapCommon.*,同时把常用函数挂到 window(esc/ggPinSvg/...),
 * 以便旧代码无需改名即可使用。所有"打卡点地图 + 文字+图片详情预览"走这里。
 */
(function () {
  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function shortLoc(name) {
    const s = String(name || '').split(/[,，]/)[0].trim();
    return (s || String(name || '')).slice(0, 30);
  }
  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function thumbUrl(p) { return p.replace(/\.(jpg|jpeg|png)$/i, '-thumb.$1'); }
  function ggPinSvg() {
    return '<svg viewBox="0 0 24 24" width="28" height="28" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">'
      + '<path d="M12 1.8C7.4 1.8 3.7 5.5 3.7 10.1c0 5.6 6.8 12.6 7.4 13.3.5.5 1.3.5 1.8 0 .6-.7 7.4-7.7 7.4-13.3C20.3 5.5 16.6 1.8 12 1.8z" fill="#e11d48"/>'
      + '<circle cx="12" cy="10" r="3.1" fill="#fff"/></svg>';
  }
  function loadLeaflet() {
    return new Promise((resolve, reject) => {
      if (window.L) return resolve();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js';
      s.onload = () => {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(l);
        resolve();
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  /* 条目时间戳:优先 ts,退化从照片路径提取(与原 app.js entryTs 一致) */
  function entryTs(e) {
    if (e.ts) return String(e.ts);
    if (e.photos && e.photos[0]) {
      const m = e.photos[0].match(/([0-9]{13})-[0-9]+\.jpg$/);
      if (m) return m[1];
    }
    return '0';
  }
  function photoGridHtml(photos, altPrefix) {
    if (!photos || photos.length === 0) return '';
    const imgs = photos
      .map((p, i) => `<img src="${thumbUrl(p)}" data-full="${p}" alt="${altPrefix} ${i + 1}" loading="lazy">`)
      .join('');
    return `<div class="photo-grid">${imgs}</div>`;
  }
  /* 列表卡片(紧凑,地点短名) */
  function entryCard(e, opts) {
    const authorTag = e.author
      ? `<span class="author-tag${e.author === '小红' ? ' rose' : ''}">${esc(e.author)}</span>`
      : '';
    const locTag = e.location && e.location.name
      ? `<span class="loc-tag">📍 ${esc(shortLoc(e.location.name))}</span>`
      : '';
    const timeTag = e.ts ? `<span class="time-tag">${fmtTime(e.ts)}</span>` : '';
    const visTag = e.visibility === 'private' ? '<span class="vis-tag">私有</span>' : '';
    const editBtn = opts && opts.editBtn
      ? `<button type="button" class="entry-edit" data-date="${esc(e.date)}" data-ts="${esc(e.ts)}" title="编辑" aria-label="编辑"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>`
      : '';
    return `<article class="entry">
    <div class="entry-meta">${timeTag}${authorTag}${visTag}${e.album ? `<span class="album-tag">${esc(e.album)}</span>` : ''}${locTag}${editBtn}</div>
    ${e.title ? `<h3 class="entry-title">${esc(e.title)}</h3>` : ''}
    ${e.text ? `<div class="entry-text">${esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}
    ${photoGridHtml(e.photos, e.date)}
  </article>`;
  }
  /* 详情卡片(弹层用,地点用**完整地址**——保留文字版详情) */
  function detailCard(e) {
    const authorTag = e.author
      ? `<span class="author-tag${e.author === '小红' ? ' rose' : ''}">${esc(e.author)}</span>`
      : '';
    const locName = e.location ? shortLoc(e.location.display || e.location.name || '') : '';
    const locTag = locName ? `<span class="loc-tag">📍 ${esc(locName)}</span>` : '';
    const timeTag = e.ts ? `<span class="time-tag">${fmtTime(e.ts)}</span>` : '';
    const visTag = e.visibility === 'private' ? '<span class="vis-tag">私有</span>' : '';
    return `<article class="entry">
    <div class="entry-meta">${timeTag}${authorTag}${visTag}${e.album ? `<span class="album-tag">${esc(e.album)}</span>` : ''}${locTag}</div>
    ${e.title ? `<h3 class="entry-title">${esc(e.title)}</h3>` : ''}
    ${e.text ? `<div class="entry-text">${esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}
    ${photoGridHtml(e.photos, e.date)}
  </article>`;
  }
  /* 照片兜底:缩略图 404 → 回退全图;全图也挂 → 隐藏(CSP 禁内联 onerror,必须 addEventListener) */
  function bindPhotoGridFallback(container) {
    container.querySelectorAll('.photo-grid img').forEach((img) => {
      const fb = () => {
        if (img.src !== img.dataset.full) img.src = img.dataset.full;
        else img.style.display = 'none';
      };
      img.addEventListener('error', fb);
      if (img.complete && img.naturalWidth === 0) fb();
      const mark = () => {
        if (img.naturalWidth > img.naturalHeight) {
          img.classList.add('landscape');
          const grid = img.closest('.photo-grid');
          if (grid) {
            const firstPortrait = grid.querySelector('img:not(.landscape)');
            if (firstPortrait) firstPortrait.before(img);
            else grid.appendChild(img);
          }
        }
      };
      if (img.complete) mark();
      else img.addEventListener('load', mark);
    });
  }
  /* 打开详情弹层(全屏大图:有 #lightbox 用 lightbox,否则新窗口;文本/图片一应俱全) */
  function openEntryCard(e) {
    const modal = document.getElementById('preview-modal');
    const body = document.getElementById('preview-body');
    if (!modal || !body) {
      // 兜底:无 preview-modal(如旧分享页)→ 新窗口打开
      if (e && e.photos && e.photos[0]) window.open(e.photos[0], '_blank');
      return;
    }
    body.innerHTML = `<div class="preview-date">${esc(e.date)}</div>` + detailCard(e);
    modal.hidden = false;
    bindPhotoGridFallback(body);
    // 照片点击:有 lightbox 走 lightbox(与主页当日动态一致,不跳转),否则新窗口
    const lb = document.getElementById('lightbox');
    body.querySelectorAll('.photo-grid img').forEach((img) => {
      img.addEventListener('click', () => {
        if (lb) {
          lb.querySelector('img').src = img.dataset.full || img.src;
          lb.classList.add('open');
        } else {
          window.open(img.dataset.full || img.src, '_blank');
        }
      });
    });
  }
  /* 详情弹层关闭(关闭按钮 + 点遮罩),所有页面共用 */
  function bindPreviewModal() {
    const modal = document.getElementById('preview-modal');
    if (!modal) return;
    const close = () => { modal.hidden = true; };
    const btn = document.getElementById('btn-preview-close');
    if (btn) btn.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  }
  /* 地图打卡点「展开详情」:紧凑面板贴在地图容器右上方,不遮整张地图、可一键关闭、可上下滚动看全部图片。
   * 面板挂在 document.body(fixed),不在 Leaflet 容器内 —— Leaflet 容器 touch-action:none 会吞掉子元素滚动;
   * 全屏时 box 铺满视口,面板自动跟到页面最上方。 */
  function openMapDetail(e, container) {
    if (!e || !container) return;
    let panel = document.getElementById('map-detail-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'map-detail-panel';
      panel.className = 'map-detail-panel';
      panel.style.cssText = 'position:fixed;z-index:10000;width:min(320px,calc(100vw - 24px));max-height:72vh;overflow:auto;background:#fff;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.25);padding:10px 12px;font-size:.9rem;color:#1f2937;border:1px solid #e5e7eb;display:none;';
      document.body.appendChild(panel);
      const reposition = () => {
        if (panel.style.display === 'none' || !panel._anchor) return;
        const r = panel._anchor.getBoundingClientRect();
        const w = panel.offsetWidth || 320;
        panel.style.top = Math.max(8, r.top + 10) + 'px';
        panel.style.left = Math.max(8, r.left + Math.max(0, r.width - w - 10)) + 'px';
      };
      panel._reposition = reposition;
      window.addEventListener('scroll', reposition, { passive: true });
      window.addEventListener('resize', reposition);
      // 全屏切换/地图重排:box 尺寸变化 → 重新对齐
      if (window.ResizeObserver) {
        panel._ro = new ResizeObserver(() => reposition());
      }
      // 点非弹窗处 → 关闭弹窗
      document.addEventListener('click', (ev) => {
        if (panel.style.display === 'none') return;
        if (!panel.contains(ev.target)) {
          panel.style.display = 'none';
          if (panel._ro) panel._ro.disconnect();
        }
      });
    }
    // 锚定当前地图容器并跟随其位置变化
    if (panel._ro) panel._ro.observe(container);
    panel._anchor = container;
    const meta = [];
    if (e.ts) meta.push(fmtTime(e.ts));
    if (e.author) meta.push(esc(e.author));
    if (e.visibility === 'private') meta.push('私有');
    if (e.album) meta.push(esc(e.album));
    const locName = e.location ? shortLoc(e.location.display || e.location.name || '') : '';
    if (locName) meta.push(`📍 ${esc(locName)}`);
    const photos = e.photos || [];
    panel.innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">` +
        `<b style="font-size:1rem">${esc(e.date)}</b>` +
        `<button type="button" class="map-detail-close" style="border:none;background:none;font-size:1.15rem;cursor:pointer;color:#9ca3af;padding:0 4px;line-height:1" aria-label="关闭">✕</button>` +
      `</div>` +
      (meta.length ? `<div style="color:#6b7280;font-size:.78rem;margin:4px 0 6px">${meta.join(' · ')}</div>` : '') +
      (e.title ? `<div style="font-weight:600;margin-bottom:4px">${esc(e.title)}</div>` : '') +
      (e.text ? `<div style="color:#374151;white-space:pre-wrap;margin-bottom:6px">${esc(e.text)}</div>` : '') +
      (photos.length ? `<div class="photo-grid">${photos.map((p) => `<img src="${thumbUrl(p)}" data-full="${p}" alt="照片" loading="lazy">`).join('')}</div>` : '');
    const closeBtn = panel.querySelector('.map-detail-close');
    if (closeBtn) closeBtn.addEventListener('click', () => {
      panel.style.display = 'none';
      if (panel._ro) panel._ro.disconnect();
    });
    bindPhotoGridFallback(panel);
    const lb = document.getElementById('lightbox');
    panel.querySelectorAll('.photo-grid img').forEach((img) => {
      img.addEventListener('click', () => {
        if (lb) { lb.querySelector('img').src = img.dataset.full || img.src; lb.classList.add('open'); }
        else window.open(img.dataset.full || img.src, '_blank');
      });
    });
    panel.style.display = 'block';
    panel._reposition();
  }
  /* ---- GCJ-02/WGS-84 坐标(仅中国境内 GCJ 有偏移;海外点位本就是 WGS-84,不能转) ---- */
  function inChina(lat, lng) {
    return lng > 73 && lng < 136 && lat > 3 && lat < 55;
  }
  function wgs2gcj(lat, lng) {
    const a = 6378245.0, ee = 0.00669342162296594323;
    const tLat = (x, y) => {
      let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
      r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
      r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
      r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
      return r;
    };
    const tLng = (x, y) => {
      let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
      r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
      r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
      r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
      return r;
    };
    const dLat = tLat(lng - 105, lat - 35);
    const dLng = tLng(lng - 105, lat - 35);
    const rad = lat / 180 * Math.PI;
    let magic = Math.sin(rad);
    magic = 1 - ee * magic * magic;
    const s = Math.sqrt(magic);
    return {
      lat: lat + dLat * 180 / ((a * (1 - ee)) / (magic * s) * Math.PI),
      lng: lng + dLng * 180 / (a / s * Math.cos(rad) * Math.PI),
    };
  }
  function toWgs(lat, lng) {
    if (!inChina(lat, lng)) return { lat, lng };
    const g = wgs2gcj(lat, lng);
    return { lat: lat * 2 - g.lat, lng: lng * 2 - g.lng };
  }
  /* 打卡点地图:主页/分享/导出页全用这个
   * opts: { onMarkerClick(entry), scrollWheelZoom=true, containerId, showRoute=true, fitPadding=[30,30], fullscreen=true } */
  async function renderCheckinMap(box, entries, opts) {
    opts = opts || {};
    const containerId = opts.containerId || (box && box.id);
    if (!box || !containerId) return;
    const withLoc = (entries || []).filter((e) => e.location && e.location.lat != null && e.location.lng != null);
    if (!withLoc.length) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    try {
      await loadLeaflet();
    } catch {
      box.style.display = 'none';
      return;
    }
    // 同容器重复渲染 → 移除旧 map(避免僵尸瓦片)
    if (box._ggMap) { try { box._ggMap.remove(); } catch {} ; box._ggMap = null; }
    const map = L.map(containerId, {
      scrollWheelZoom: opts.scrollWheelZoom !== false,
      zoomControl: opts.zoomControl !== false,
    });
    box._ggMap = map;
    setTimeout(() => map.invalidateSize(), 120);
    setTimeout(() => map.invalidateSize(), 400);

    // 瓦片:高德(国内)为主;加载失败(海外/部分国产浏览器 CDN 不可达)→ 自动切 OSM 并做坐标投影
    const markers = [];
    let osmOn = false;
    let tileErrors = 0;
    let amapLayer = null;
    let routeLayer = null;
    let routeLine = null;
    const project = (lat, lng) => { const p = toWgs(lat, lng); return [p.lat, p.lng]; };
    function applyOsm() {
      if (osmOn) return;
      osmOn = true;
      if (amapLayer) { map.removeLayer(amapLayer); amapLayer = null; }
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);
      for (const mk of markers) {
        const e = mk._entry;
        mk.setLatLng(project(e.location.lat, e.location.lng));
      }
      if (routeLayer && routeLine) routeLayer.setLatLngs(routeLine.map(([la, ln]) => project(la, ln)));
      if (markers.length === 1) {
        map.setView(project(markers[0]._entry.location.lat, markers[0]._entry.location.lng), 12);
      } else if (markers.length > 1) {
        map.fitBounds(markers.map((mk) => mk.getLatLng()), { padding: opts.fitPadding || [30, 30] });
      }
    }
    amapLayer = L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      maxZoom: 18,
      subdomains: ['1', '2', '3', '4'],
      attribution: '&copy; 高德地图',
    });
    amapLayer.on('tileerror', () => { applyOsm(); });
    amapLayer.addTo(map);
    // 主动探针:在 Leaflet 请求瓦片前,独立 Image 测一张高德瓦片。
    // 不少代理/移动网络返回 HTML 200(假成功)让 tileerror 不触发——这里用 onerror + 5s 超时兜底。
    {
      const probe = new Image();
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; applyOsm(); } }, 5000);
      probe.onload = () => { done = true; clearTimeout(t); };
      probe.onerror = () => { done = true; clearTimeout(t); applyOsm(); };
      probe.src = 'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=0&y=0&z=0';
    }

    if (opts.fullscreen !== false && window.LocPicker) {
      LocPicker.lpMapFullscreen(map, box);
    }
    const onClick = opts.onMarkerClick || ((e) => openMapDetail(e, box));
    const bounds = [];
    for (let i = 0; i < withLoc.length; i++) {
      const e = withLoc[i];
      const pos = osmOn ? project(e.location.lat, e.location.lng) : [e.location.lat, e.location.lng];
      const mk = L.marker(pos, {
        icon: L.divIcon({ className: 'gg-marker', html: ggPinSvg(), iconSize: [28, 28], iconAnchor: [14, 27] }),
      }).addTo(map);
      mk._entry = e;
      markers.push(mk);
      // 原样式文字版详情弹窗 + 「展开详情」按钮(按钮打开紧凑详情面板,不遮地图)
      // 地点名精简:地图上已有明确点位,完整行政地址过长影响观看
      const name = e.location ? shortLoc(e.location.display || e.location.name || '') : '';
      mk.bindPopup(
        `<b>${esc(e.date)} ${fmtTime(e.ts)}</b> ${esc(e.title || '')}<br>${esc(name)}` +
        `<br><button type="button" class="popup-detail-btn" style="margin-top:6px;padding:4px 12px;border:1px solid #e5e7eb;border-radius:999px;background:#fff;color:#e11d48;cursor:pointer;font-size:.8rem" data-i="${i}">展开详情</button>`
      );
      bounds.push(pos);
    }
    // 弹窗内「展开详情」按钮 → 紧凑详情面板(文字+部分图片);CSP 禁内联 onclick,须 addEventListener
    map.on('popupopen', (ev) => {
      const el = ev.popup && ev.popup.getElement();
      const btn = el ? el.querySelector('.popup-detail-btn') : null;
      if (btn && !btn.dataset.bound) {
        btn.dataset.bound = '1';
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation(); // 阻止冒泡到 document,否则刚打开的面板会被「点非弹窗处关闭」立即关掉
          map.closePopup();
          const e = withLoc[Number(btn.dataset.i)];
          if (e) onClick(e);
        });
      }
    });
    if (opts.showRoute !== false && withLoc.length > 1 && window.getRouteLine) {
      const ordered = withLoc.slice().sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return Number(entryTs(a)) - Number(entryTs(b));
      });
      const line = await getRouteLine(ordered);
      routeLine = line;
      routeLayer = L.polyline(line.map(([la, ln]) => (osmOn ? project(la, ln) : [la, ln])), {
        color: '#e11d48', weight: 4, opacity: 0.9,
      }).addTo(map);
      map.fitBounds(routeLayer.getBounds(), { padding: opts.fitPadding || [30, 30] });
    } else if (withLoc.length === 1) {
      map.setView(bounds[0], 12);
    } else {
      map.fitBounds(bounds, { padding: opts.fitPadding || [30, 30] });
    }
  }

  const M = { esc, shortLoc, fmtTime, thumbUrl, ggPinSvg, loadLeaflet, entryTs, photoGridHtml, entryCard, detailCard, bindPhotoGridFallback, openEntryCard, openMapDetail, renderCheckinMap, bindPreviewModal };
  window.MapCommon = M;
  // 同时把常用函数挂到 window,旧代码(ggPinSvg/loadLeaflet/...等)无需改名
  window.esc = esc; window.shortLoc = shortLoc; window.fmtTime = fmtTime; window.thumbUrl = thumbUrl;
  window.ggPinSvg = ggPinSvg; window.loadLeaflet = loadLeaflet; window.entryTs = entryTs;
  window.photoGridHtml = photoGridHtml; window.entryCard = entryCard; window.detailCard = detailCard;
  window.bindPhotoGridFallback = bindPhotoGridFallback; window.openEntryCard = openEntryCard;
  window.openMapDetail = openMapDetail; window.renderCheckinMap = renderCheckinMap; window.bindPreviewModal = bindPreviewModal;
})();
