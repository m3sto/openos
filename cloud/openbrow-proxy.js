/**
 * OpenBrow Proxy — OpenOS'un tarayıcı motoru için içerik köprüsü
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Neden gerek var: bir <iframe> çapraz-kaynak sayfaya hiçbir şey enjekte edemez,
 * ve pek çok site X-Frame-Options/CSP ile çerçevelenmeyi reddeder. Bu Worker
 * sayfayı sunucu tarafında alır, çerçeveleme engellerini kaldırır ve içine
 * OpenBrow kimliğini yerleştiren bir "shim" enjekte eder — böylece sayfa
 * kendisini bir tarayıcının içinde değil, OpenOS üzerinde çalışan OpenBrow'da
 * sanır: navigator.userAgent, platform, appName, oscpu hepsi OpenOS der.
 *
 *   GET /?url=https%3A%2F%2Fexample.com
 *   GET /raw?url=...      (enjeksiyonsuz, alt kaynaklar için)
 *
 * Dağıtım:  wrangler deploy --name openbrow-proxy --compatibility-date 2026-01-01
 * Ardından OpenOS → Ayarlar → Tarayıcı → Proxy alanına Worker adresini yazın.
 */

const OPENBROW_UA =
  'Mozilla/5.0 (OpenOS 1.0; Meridian; rv:1.0) AppleWebKit/605.1.15 (KHTML, like Gecko) OpenBrow/1.0 Safari/605.1.15';

const STRIP_HEADERS = [
  'content-security-policy', 'content-security-policy-report-only',
  'x-frame-options', 'cross-origin-opener-policy', 'cross-origin-embedder-policy',
  'permissions-policy', 'report-to', 'nel',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

export default {
  async fetch(request) {
    const here = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const target = here.searchParams.get('url');
    if (!target) return info(here);

    let url;
    try { url = new URL(target); } catch { return new Response('geçersiz adres', { status: 400 }); }
    if (!/^https?:$/.test(url.protocol)) return new Response('yalnızca http/https', { status: 400 });

    const upstream = await fetch(url.toString(), {
      method: request.method === 'POST' ? 'POST' : 'GET',
      body: request.method === 'POST' ? request.body : undefined,
      headers: {
        'User-Agent': OPENBROW_UA,
        'Accept': request.headers.get('accept') || 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': request.headers.get('accept-language') || 'tr-TR,tr;q=0.9,en;q=0.6',
        'Sec-CH-UA-Platform': '"OpenOS"',
      },
      redirect: 'follow',
    });

    const headers = new Headers(upstream.headers);
    STRIP_HEADERS.forEach(h => headers.delete(h));
    Object.entries(CORS).forEach(([k, v]) => headers.set(k, v));
    headers.set('X-OpenBrow-Origin', url.origin);
    headers.set('X-OpenBrow-Final', upstream.url || url.toString());

    const type = headers.get('content-type') || '';
    const passthrough = here.pathname.startsWith('/raw') || !type.includes('text/html');
    if (passthrough) return new Response(upstream.body, { status: upstream.status, headers });

    const proxyBase = `${here.origin}${here.pathname}?url=`;
    const finalUrl = new URL(upstream.url || url.toString());

    return new HTMLRewriter()
      .on('head', new HeadInjector(finalUrl, proxyBase))
      .on('a[href]', new LinkRewriter(finalUrl))
      .on('form', new FormMarker(finalUrl))
      .transform(new Response(upstream.body, { status: upstream.status, headers }));
  },
};

class HeadInjector {
  constructor(url, proxyBase) { this.url = url; this.proxyBase = proxyBase; this.done = false; }
  element(el) {
    if (this.done) return;
    this.done = true;
    el.prepend(`<base href="${escapeAttr(this.url.origin + this.url.pathname)}">`, { html: true });
    el.append(`<script>${shim(this.url.toString(), this.proxyBase)}</script>`, { html: true });
  }
}

class LinkRewriter {
  constructor(url) { this.url = url; }
  element(el) {
    const href = el.getAttribute('href') || '';
    if (/^(javascript:|mailto:|tel:|#)/i.test(href)) return;
    try { el.setAttribute('data-openbrow-href', new URL(href, this.url).toString()); } catch {}
    el.setAttribute('target', '_self');
  }
}

class FormMarker {
  constructor(url) { this.url = url; }
  element(el) {
    const action = el.getAttribute('action') || '';
    try { el.setAttribute('data-openbrow-action', new URL(action || this.url, this.url).toString()); } catch {}
  }
}

const escapeAttr = s => String(s).replace(/"/g, '&quot;');

/* The shim runs inside the page. It rewrites the browser identity the page
   sees and hands navigation back to OpenBrow's own chrome. */
function shim(pageUrl, proxyBase) {
  return `(function(){
  var UA = ${JSON.stringify(OPENBROW_UA)};
  function def(o, k, v){ try { Object.defineProperty(o, k, { get: function(){ return v; }, configurable: true }); } catch(e){} }
  def(navigator, 'userAgent', UA);
  def(navigator, 'appVersion', '5.0 (OpenOS 1.0)');
  def(navigator, 'appName', 'OpenBrow');
  def(navigator, 'appCodeName', 'OpenBrow');
  def(navigator, 'product', 'OpenOS');
  def(navigator, 'productSub', '20260101');
  def(navigator, 'vendor', 'OpenOS Project');
  def(navigator, 'platform', 'OpenOS');
  def(navigator, 'oscpu', 'OpenOS 1.0 Meridian');
  def(navigator, 'language', 'tr-TR');
  def(navigator, 'languages', ['tr-TR','tr','en-US']);
  def(navigator, 'webdriver', false);
  if (navigator.userAgentData) {
    def(navigator, 'userAgentData', {
      brands: [{ brand: 'OpenBrow', version: '1' }, { brand: 'OpenOS', version: '1' }],
      mobile: false, platform: 'OpenOS',
      getHighEntropyValues: function(){ return Promise.resolve({ platform: 'OpenOS', platformVersion: '1.0',
        uaFullVersion: '1.0.0', architecture: 'wasm', model: 'OpenOS Virtual Machine' }); }
    });
  }
  window.OpenBrow = { version: '1.0', os: 'OpenOS 1.0 "Meridian"', proxied: true, page: ${JSON.stringify(pageUrl)} };

  function post(msg){ try { parent.postMessage(Object.assign({ __openbrow: true }, msg), '*'); } catch(e){} }

  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest && e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('data-openbrow-href') || a.href;
    if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) return;
    e.preventDefault();
    post({ type: 'navigate', url: href, newTab: e.metaKey || e.ctrlKey || a.target === '_blank' });
  }, true);

  document.addEventListener('submit', function(e){
    var f = e.target;
    if (!f || (f.method || 'get').toLowerCase() !== 'get') return;
    var action = f.getAttribute('data-openbrow-action') || f.action;
    if (!action) return;
    e.preventDefault();
    var q = new URLSearchParams(new FormData(f)).toString();
    post({ type: 'navigate', url: action + (action.indexOf('?') > -1 ? '&' : '?') + q });
  }, true);

  function announce(){
    post({ type: 'ready', title: document.title, url: ${JSON.stringify(pageUrl)},
           icon: (document.querySelector('link[rel~="icon"]')||{}).href || '',
           theme: (document.querySelector('meta[name="theme-color"]')||{}).content || '' });
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') announce();
  else document.addEventListener('DOMContentLoaded', announce);
  window.addEventListener('load', announce);
  document.addEventListener('contextmenu', function(e){
    e.preventDefault();
    var a = e.target.closest && e.target.closest('a');
    var img = e.target.tagName === 'IMG' ? e.target.src : '';
    post({ type: 'contextmenu', x: e.clientX, y: e.clientY,
           link: a ? (a.getAttribute('data-openbrow-href') || a.href) : '',
           image: img, text: String(getSelection() || '') });
  }, true);
  window.open = function(u){ post({ type: 'navigate', url: String(u), newTab: true }); return null; };
  var PB = ${JSON.stringify(proxyBase)};
  window.__openbrowProxy = PB;
})();`;
}

function info(here) {
  return new Response(`OpenBrow Proxy · OpenOS

Kullanım:
  ${here.origin}/?url=https%3A%2F%2Fexample.com

Bu uç nokta sayfaları OpenOS kimliğiyle alır, çerçeveleme engellerini kaldırır
ve sayfaya OpenBrow kimliğini enjekte eder. OpenOS → Ayarlar → Tarayıcı
bölümünden proxy adresi olarak tanımlayın.
`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS } });
}
