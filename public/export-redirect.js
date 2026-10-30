/* 咕咕嘎嘎 - 旧导出页跳转脚本(/export → 管理页「导出」tab)
 *
 * 为什么单独一个文件:站点 CSP 是 script-src 'self'(没有 'unsafe-inline'),
 * 内联 <script> 会被浏览器直接拦掉 —— 跳转脚本必须是同源外链文件才会执行(2026-10-30 实测)。
 */
(function () {
  var q = location.search.replace(/^\?/, '');
  location.replace('/write.html?tab=export' + (q ? '&' + q : ''));
})();
