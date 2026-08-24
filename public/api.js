// 前端网关:github.io 只读门户托管在 github.io,API/登录/照片全在 Cloudflare(pages.dev)。
// - 相对 /api、/s 路径请求改写为 API_ORIGIN 绝对地址(跨域读取)
// - 登录/写操作不走这里——管理页只跑在 pages.dev,同源 cookie 鉴权原样可用
// - 照片 <img src="/photos/..."> 跨域可直读,但需要绝对地址,故统一补 API_ORIGIN 前缀
(function () {
  window.API_ORIGIN = 'https://gugugaga-viw.pages.dev';

  // 构造绝对 API/分享 URL
  window.apiUrl = function (path) { return window.API_ORIGIN + (String(path).startsWith('/') ? path : '/' + path); };

  // fetch:相对路径 → API_ORIGIN;外部绝对地址(高德等)原样放行
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (input instanceof Request) {
      const url = input.url.startsWith('/') ? window.apiUrl(input.url) : input.url;
      return nativeFetch(url, init);
    }
    if (typeof input === 'string' && input.startsWith('/')) {
      return nativeFetch(window.apiUrl(input), init);
    }
    return nativeFetch(input, init);
  };

  // 照片 URL 补前缀:重写 /photos/ 开头的 <img src> 与 data-full(lightbox 用)
  function fixPhotoUrls(root) {
    if (!root) return;
    if (root.nodeType === 1 && root.matches && root.matches('img[src^="/photos/"], [data-full^="/photos/"]')) {
      if (root.getAttribute('src') && root.getAttribute('src').startsWith('/photos/')) {
        root.setAttribute('src', window.API_ORIGIN + root.getAttribute('src'));
      }
      if (root.getAttribute('data-full') && root.getAttribute('data-full').startsWith('/photos/')) {
        root.setAttribute('data-full', window.API_ORIGIN + root.getAttribute('data-full'));
      }
    }
    const imgs = root.querySelectorAll ? root.querySelectorAll('img[src^="/photos/"], [data-full^="/photos/"]') : [];
    imgs.forEach((el) => {
      if (el.getAttribute('src') && el.getAttribute('src').startsWith('/photos/')) {
        el.setAttribute('src', window.API_ORIGIN + el.getAttribute('src'));
      }
      if (el.getAttribute('data-full') && el.getAttribute('data-full').startsWith('/photos/')) {
        el.setAttribute('data-full', window.API_ORIGIN + el.getAttribute('data-full'));
      }
    });
  }

  if (document.documentElement) {
    fixPhotoUrls(document);
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) fixPhotoUrls(n);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
