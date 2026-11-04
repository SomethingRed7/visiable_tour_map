// 一键清缓存页（reset.html 用的）。
// 为什么需要：Service Worker 的 HTML 是 network-first + 超时回退缓存，国内到 pages.dev
// 跨境经常超时，于是长期拿到旧 HTML，导致「代码改了但看不到」。SW 本身有 skipWaiting，
// 但用户设备上未必能及时换上新版本 —— 这里给一个确定的手动出口。
//
// 做三件事：注销所有 SW → 删掉所有 Cache Storage → 清 sessionStorage → 带随机参数重开。
// 注意 CSP 不允许内联脚本，所以必须放在外部 .js 里（否则会被静默拦掉）。
(async function () {
  const st = document.getElementById('reset-status');
  const say = (m) => { if (st) st.textContent = m; };

  const steps = [];

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      say('找到 ' + regs.length + ' 个 Service Worker，正在注销…');
      for (const r of regs) {
        try { await r.unregister(); } catch { /* 单个失败不影响其他 */ }
      }
      steps.push('SW 已注销');
    } else {
      steps.push('此环境没有 SW');
    }

    if (window.caches) {
      const keys = await caches.keys();
      say('清掉 ' + keys.length + ' 份离线缓存…');
      for (const k of keys) {
        try { await caches.delete(k); } catch { /* 忽略 */ }
      }
      steps.push('缓存已清');
    }

    try { sessionStorage.clear(); } catch { /* 隐私模式 */ }
    steps.push('会话标记已清');

    say(steps.join(' · ') + '\n正在重新打开…');
    // 带随机参数是一次性保险；真正生效靠上面清掉的 SW 和 cache
    setTimeout(() => location.replace('/?fresh=' + Date.now()), 1600);
  } catch (err) {
    say('清理时出错：' + (err && err.message ? err.message : err) + '\n可以手动在浏览器设置里清除本网站数据。');
  }
})();
