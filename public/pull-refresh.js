/* 下拉刷新 —— 首页和管理页共用。
 *
 * WebView 和浏览器都没有能用的原生下拉刷新（Chrome 那个是整页重载，会丢状态、要重新登录），
 * 所以自己实现：页面在顶部时下拉，超过阈值松手就调 onRefresh()。
 *
 * ⚠️ 为什么抽成单独文件而不是各页抄一份：
 *    「让路」逻辑（地图拖动、横滑、已经滚下去）和手势接管很容易漏，
 *    抄第二份时少一个判断就会出现「地图拖不动」或「日历划不动」这类问题。
 *
 * 用法：
 *   PullRefresh.init({
 *     onRefresh: async () => { ...; return { ok: true, count: 12 }; }  // ok=false 显示失败
 *   });
 *
 * 依赖 style.css 里的 .pull-refresh 三态样式（默认 / is-ready / is-busy）。
 */
(function () {
  const THRESHOLD = 72;   // 松手时位移超过它才触发
  const MAX_PULL = 110;   // 视觉上限，给手感一个"到底"的停顿
  const DAMP = 0.52;      // 阻尼：手指走 1px，指示器只走 0.52px
  const H = 56;           // 指示器高度，与 .pull-refresh 一致

  window.PullRefresh = {
    init(opts) {
      const onRefresh = (opts && opts.onRefresh) || null;
      if (!onRefresh) return;

      const el = document.createElement('div');
      el.className = 'pull-refresh';
      el.innerHTML = '<span class="pr-pill"><span class="pull-refresh-icon" aria-hidden="true">↓</span><span class="pull-refresh-text">下拉刷新</span></span>';
      document.body.appendChild(el);

      const icon = el.querySelector('.pull-refresh-icon');
      const textEl = el.querySelector('.pull-refresh-text');

      let startY = 0;
      let startX = 0;
      let dist = 0;
      let active = false;    // 这次触摸是否由我们接管
      let decided = false;   // 是否已判定方向
      let busy = false;      // 刷新进行中

      function place(d, animate) {
        dist = Math.max(0, Math.min(d, MAX_PULL));
        el.style.transition = animate ? 'transform .26s cubic-bezier(.2,.8,.3,1)' : 'none';
        el.style.transform = `translateY(${dist - H}px)`;
      }

      function idle(animate) {
        el.classList.remove('is-ready');
        textEl.textContent = '下拉刷新';
        icon.textContent = '↓';
        place(0, animate);
      }

      document.addEventListener('touchstart', (e) => {
        if (busy || e.touches.length !== 1) return;
        if (window.scrollY > 0) return;                                             // 已经滚下去了
        if (e.target.closest('.leaflet-container, input, textarea, select')) return; // 地图拖动/输入控件
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
        active = true;
        decided = false;
      }, { passive: true });

      document.addEventListener('touchmove', (e) => {
        if (!active || busy) return;
        const dy = e.touches[0].clientY - startY;
        const dx = e.touches[0].clientX - startX;

        if (!decided) {
          // 横滑（日历横滑、tab 横滑）或上滑（正常滚动）—— 都不是下拉，直接退出
          if (Math.abs(dx) > Math.abs(dy) || dy <= 0) { active = false; return; }
          decided = true;
        }
        if (dy <= 0) { idle(true); return; }

        e.preventDefault();        // 接管手势，别让页面跟着做橡皮筋
        place(dy * DAMP, false);

        const ready = dist >= THRESHOLD;
        if (ready !== el.classList.contains('is-ready')) {
          el.classList.toggle('is-ready', ready);
          textEl.textContent = ready ? '松手刷新' : '下拉刷新';
          icon.textContent = ready ? '↻' : '↓';
        }
      }, { passive: false });

      document.addEventListener('touchend', () => {
        if (!active) return;
        active = false;
        if (el.classList.contains('is-ready')) refresh();
        else idle(true);
      }, { passive: true });

      document.addEventListener('touchcancel', () => {
        if (!active) return;
        active = false;
        idle(true);
      }, { passive: true });

      async function refresh() {
        busy = true;
        el.classList.add('is-busy');
        el.classList.remove('is-ready');
        textEl.textContent = '刷新中…';
        icon.textContent = '↻';
        place(H, true);            // 停在完全露出的位置

        const t0 = Date.now();
        let result;
        try { result = await onRefresh(); } catch { result = { ok: false }; }
        // 收得太快会闪一下，兜一个最短展示时间
        const wait = Math.max(0, 520 - (Date.now() - t0));
        if (wait) await new Promise((r) => setTimeout(r, wait));

        // 明确给出结果：原来无论成败都静默收起，用户分不清「没有新内容」和「刷新失败」
        if (result && result.ok) {
          textEl.textContent = result.count >= 0 ? `已更新 · ${result.count} 条` : '已更新';
          icon.textContent = '✓';
        } else {
          textEl.textContent = '刷新失败，检查网络';
          icon.textContent = '⚠';
        }

        el.classList.remove('is-busy');
        place(0, true);
        setTimeout(() => idle(false), 900);
        busy = false;
      }
    },
  };
})();
