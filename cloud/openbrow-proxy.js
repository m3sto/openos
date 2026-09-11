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

/* Sayfanın JS'ten gördüğü kimlik — shim bunu enjekte eder. */
const OPENBROW_UA =
  'Mozilla/5.0 (OpenOS 1.0; Meridian; rv:1.0) AppleWebKit/605.1.15 (KHTML, like Gecko) OpenBrow/1.0 Safari/605.1.15';

/* Yukarı akışa gönderilen kimlik. Bilinmeyen bir UA ile istek yapmak pek çok
   sitede 403/404 ile karşılanır (GitHub bunlardan biri), o yüzden ağda sıradan
   bir tarayıcı gibi görünürüz; OpenOS kimliği sayfaya istemci tarafında
   enjekte edilir ve sayfanın okuduğu değer yine OpenBrow olur.
   ?ua=openbrow ile ağ kimliği de zorlanabilir. */
const UPSTREAM_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* Enjekte edilen betiğin sürümü. Değişince istemci eski kopyayı ayırt eder. */
const SHIM_SURUM = '3';

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

    /* İndirme yolu: içerik gövdesi olduğu gibi, indirme başlığıyla geçer. */
    const indirme = here.pathname.startsWith('/download');

    let url;
    try { url = new URL(target); } catch { return new Response('geçersiz adres', { status: 400 }); }
    if (!/^https?:$/.test(url.protocol)) return new Response('yalnızca http/https', { status: 400 });

    const forceOpenBrowUA = here.searchParams.get('ua') === 'openbrow';
    let upstream;
    try {
      upstream = await getir();
    } catch (e) {
      /* Ağ katmanındaki hata istemciye tanınabilir bir biçimde ulaşmalı:
         OpenBrow buna bakarak doğru hata sayfasını çizer. */
      return new Response(JSON.stringify({
        openbrowError: true,
        kod: /name not resolved|getaddrinfo|dns/i.test(String(e.message)) ? 'dns' : 'unreachable',
        ileti: String(e.message || e),
        url: url.toString(),
      }), { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });
    }

    function getir() { return fetch(url.toString(), {
      method: request.method === 'POST' ? 'POST' : 'GET',
      body: request.method === 'POST' ? request.body : undefined,
      headers: {
        'User-Agent': forceOpenBrowUA ? OPENBROW_UA : UPSTREAM_UA,
        'Accept': request.headers.get('accept') || 'text/html,application/xhtml+xml,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': request.headers.get('accept-language') || 'tr-TR,tr;q=0.9,en;q=0.6',
        'Upgrade-Insecure-Requests': '1',
        /* Pek çok site yalnızca UA'ya değil, bir tarayıcının gönderdiği
           bütün başlık kümesine bakar; eksik `Sec-Fetch-*` başlıkları
           istekleri bot gibi gösteriyordu. */
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        ...(forceOpenBrowUA ? { 'Sec-CH-UA-Platform': '"OpenOS"' } : {}),
      },
      redirect: 'follow',
    }); }

    /* Cloudflare, çözülemeyen alan adı ve ulaşılamayan sunucu için `fetch`i
       reddetmek yerine 5xx bir yanıt döndürüyor. İstemcinin doğru hata
       sayfasını çizebilmesi için bunlar da yapılandırılmış hataya çevrilir. */
    if (upstream.status === 530 || upstream.status === 523 || upstream.status === 522) {
      return new Response(JSON.stringify({
        openbrowError: true,
        kod: upstream.status === 530 ? 'dns' : 'unreachable',
        ileti: `Sunucuya ulaşılamadı (${upstream.status})`,
        url: url.toString(),
      }), { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });
    }

    const headers = new Headers(upstream.headers);
    STRIP_HEADERS.forEach(h => headers.delete(h));
    Object.entries(CORS).forEach(([k, v]) => headers.set(k, v));
    headers.set('X-OpenBrow-Origin', url.origin);
    headers.set('X-OpenBrow-Final', upstream.url || url.toString());

    const type = headers.get('content-type') || '';
    if (indirme) {
      headers.set('X-OpenBrow-Length', headers.get('content-length') || '');
      headers.set('X-OpenBrow-Type', type);
      return new Response(upstream.body, { status: upstream.status, headers });
    }
    const passthrough = here.pathname.startsWith('/raw') || !type.includes('text/html');
    if (passthrough) return new Response(upstream.body, { status: upstream.status, headers });

    /* HTML yanıtı önbelleğe alınmamalı. İçine sürümlü bir betik enjekte
       ediliyor; tarayıcı sayfayı önbellekten verdiğinde eski betik çalışmaya
       devam ediyor ve motorda yapılan düzeltme hiç görünmüyor. Alt kaynaklar
       (görsel, stil) bu yoldan geçmediği için hız kaybı olmuyor. */
    headers.set('Cache-Control', 'no-store, must-revalidate');
    headers.delete('etag');
    headers.delete('last-modified');
    headers.set('X-OpenBrow-Shim', SHIM_SURUM);

    const proxyBase = `${here.origin}${here.pathname}?url=`;
    const finalUrl = new URL(upstream.url || url.toString());

    return new HTMLRewriter()
      .on('meta', new CspStripper())
      .on('head', new HeadInjector(finalUrl, proxyBase))
      .on('html', new HtmlFallbackInjector(finalUrl, proxyBase))
      .on('form', new FormMarker(finalUrl))
      .transform(new Response(upstream.body, { status: upstream.status, headers }));
  },
};

/**
 * Sayfa içi CSP. Yanıt başlıklarındaki CSP siliniyordu ama belgenin kendi
 * `<meta http-equiv="Content-Security-Policy">` etiketi kalıyordu. O etiket
 * satır içi betikleri yasakladığı için enjekte ettiğimiz shim hiç
 * çalışmıyordu: bağlantılar yakalanmıyor, sağ tuş menüsü engellenmiyor ve
 * sayfa ana tarayıcının menüsünü gösteriyordu. Etiket burada kaldırılıyor.
 */
class CspStripper {
  element(el) {
    const he = (el.getAttribute('http-equiv') || '').toLowerCase();
    if (he === 'content-security-policy' || he === 'content-security-policy-report-only') {
      el.remove();
    }
  }
}

/**
 * `<head>` etiketi olmayan belgeler de var (eski sayfalar, kırpılmış HTML).
 * Böyle bir belgede HeadInjector hiç tetiklenmez; bu yedek `<html>` açılışına
 * yazar ve yalnızca HeadInjector çalışmadıysa devreye girer.
 */
class HtmlFallbackInjector {
  constructor(url, proxyBase) { this.url = url; this.proxyBase = proxyBase; }
  element(el) {
    el.onEndTag(() => {});
    el.prepend(
      `<base href="${escapeAttr(this.url.origin + this.url.pathname)}">` +
      `<script>if(!window.OpenBrow){${shim(this.url.toString(), this.proxyBase)}}</script>`,
      { html: true });
  }
}

class HeadInjector {
  constructor(url, proxyBase) { this.url = url; this.proxyBase = proxyBase; this.done = false; }
  element(el) {
    if (this.done) return;
    this.done = true;
    el.prepend(`<base href="${escapeAttr(this.url.origin + this.url.pathname)}">`, { html: true });
    el.append(`<script>${shim(this.url.toString(), this.proxyBase)}</script>`, { html: true });
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

  /* İndirilebilir görünen bağlantılar gezinme değil indirme başlatır:
     download özniteliği olanlar ve gezilemeyecek uzantılar.
     (Bu blok bir şablon dizesinin içinde; ters tırnak kullanılamaz.) */
  /* Uzantı denetimi bilerek düzenli ifadesiz: bu blok bir şablon dizesinin
     içinde yazılıyor ve ters eğik çizgi üç katman arasında (Python → JS
     kaynağı → şablon dizesi) sessizce kayboluyor. Kaybolduğunda desen
     geçersiz oluyor, betik ilk satırda çöküyor ve sayfa hiçbir OpenBrow
     davranışı göstermiyordu: bağlantılar yakalanmıyor, sağ tuş menüsü
     engellenmiyor, başlık bildirilmiyordu. Dizi karşılaştırması kırılmaz. */
  var INDIR_UZANTILARI = ['zip','7z','rar','tar','gz','tgz','bz2','xz','exe','msi','dmg','pkg',
    'deb','rpm','apk','iso','img','bin','jar','pdf','doc','docx','xls','xlsx','ppt','pptx',
    'odt','ods','epub','mobi','mp3','wav','flac','ogg','m4a','mp4','mkv','avi','mov','webm',
    'psd','ai','ttf','otf','woff','woff2'];

  function indirilebilirMi(href) {
    try {
      var yol = new URL(href, location.href).pathname;
      var son = yol.split('/').pop() || '';
      var n = son.lastIndexOf('.');
      if (n < 0) return false;
      return INDIR_UZANTILARI.indexOf(son.slice(n + 1).toLowerCase()) !== -1;
    } catch (e) { return false; }
  }

  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest && e.target.closest('a');
    if (!a) return;
    var href = a.href;   /* tarayıcı <base>'e göre zaten mutlaklaştırdı */
    if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) return;
    e.preventDefault();
    if (a.hasAttribute('download') || indirilebilirMi(href)) {
      post({ type: 'download', url: href, name: a.getAttribute('download') || '' });
      return;
    }
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

  /* Üst çerçeveye yönlendirme zaten sandbox ile engelli. location üzerine
     yazmak sayfanın kendi betiklerini bozduğu için bilerek yapılmıyor;
     yalnızca _top/_parent hedefli bağlantılar OpenBrow'a çevriliyor. */
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest && e.target.closest('a[target="_top"], a[target="_parent"]');
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    post({ type: 'navigate', url: a.href });
  }, true);
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
