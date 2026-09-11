/* ==========================================================================
   OpenOS · apps/openbrow.js — OpenBrow 1.0
   OpenOS'un kendi tarayıcısı. Sekmeler, akıllı adres çubuğu, yer imleri,
   geçmiş, indirilenler, gizli gezinti, sayfa içinde arama, yakınlaştırma ve
   kendi bağlam menüleri. Sayfalar kendilerini OpenBrow'da görür: proxy motoru
   navigator kimliğini OpenOS olarak yeniden yazar.
   ========================================================================== */

import { h, clear, add, on, uid, debounce, escapeHtml, fmtBytes, relTime } from '../core/util.js';
import { icon, hasIcon } from '../core/icons.js';
import { menu, contextMenu } from '../ui/menu.js';
import { markdown } from './texteditor.js';
import settings from '../core/settings.js';
import registry from '../core/registry.js';
import notify from '../core/notify.js';
import vfs, { VFS } from '../core/vfs.js';

export const OPENBROW_VERSION = '1.0';
export const OPENBROW_UA =
  'Mozilla/5.0 (OpenOS 1.0; Meridian; rv:1.0) AppleWebKit/605.1.15 (KHTML, like Gecko) OpenBrow/1.0 Safari/605.1.15';

const ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  google:     { name: 'Google',     url: q => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  bing:       { name: 'Bing',       url: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  brave:      { name: 'Brave',      url: q => `https://search.brave.com/search?q=${encodeURIComponent(q)}` },
  wikipedia:  { name: 'Wikipedia',  url: q => `https://tr.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}` },
};

const DEFAULT_FAVORITES = [
  { title: 'OpenBrow Başlangıç', url: 'openos://start', glyph: 'home' },
  { title: 'OpenOS Hakkında', url: 'openos://about', glyph: 'logo' },
  { title: 'OpenSharp Belgeleri', url: 'openos://docs', glyph: 'code' },
  { title: 'Ajanlar için', url: 'openos://agents', glyph: 'robot' },
  { title: 'Wikipedia', url: 'https://tr.wikipedia.org', glyph: 'globe' },
  { title: 'Hacker News', url: 'https://news.ycombinator.com', glyph: 'list' },
  { title: 'MDN', url: 'https://developer.mozilla.org', glyph: 'fileCode' },
  { title: 'GitHub', url: 'https://github.com', glyph: 'package' },
];

export default {
  id: 'browser', name: 'OpenBrow', glyph: 'compass', tint: ['#4aa8ff', '#1b56d6'],
  category: 'internet', width: 1040, height: 680, minWidth: 520, minHeight: 340, singleton: false,
  keywords: ['web', 'tarayıcı', 'internet', 'openbrow', 'browser'],
  about: `OpenBrow ${OPENBROW_VERSION} — OpenOS'un kendi tarayıcısı.`,
  mount(ctx) {
    const b = new OpenBrow(ctx);
    ctx.win.onArgs = a => b.handleArgs(a);
    ctx.win.onClosed = () => b.destroy();
    return { el: b.el, menus: b.menus() };
  },
};

/* ====================================================================== */
class OpenBrow {
  constructor(ctx) {
    this.ctx = ctx;
    this.tabs = [];
    this.active = null;
    this.dir = VFS.join(vfs.home, '.openbrow');
    vfs.mkdir(this.dir);
    this.history = vfs.readJSON(VFS.join(this.dir, 'history.json'), []) || [];
    this.bookmarks = vfs.readJSON(VFS.join(this.dir, 'bookmarks.json'), null)
      || DEFAULT_FAVORITES.map(f => ({ ...f, added: Date.now() }));
    this.downloads = vfs.readJSON(VFS.join(this.dir, 'downloads.json'), []) || [];

    this.build();
    this.bindMessages();
    const a = ctx.args || {};
    this.newTab(a.url || (a.query ? this.searchUrl(a.query) : settings.get('browser.homepage')), { focus: true });
  }

  handleArgs(a = {}) {
    if (a.url) this.newTab(a.url, { focus: true });
    else if (a.query) this.newTab(this.searchUrl(a.query), { focus: true });
  }

  /* ================== chrome ================== */
  build() {
    /* --- sekme şeridi: pencerenin kendi başlık çubuğunda yaşar --- */
    this.tabstrip = h('div.ob-tabs.no-drag');
    this.newTabBtn = h('button.ob-newtab.no-drag', { html: icon('plus', 14), title: 'Yeni sekme (⌘T)',
      onclick: () => this.newTab(settings.get('browser.homepage'), { focus: true }) });
    const win = this.ctx.win;
    win.el.classList.add('tabbed');
    win.bar.classList.add('tall');
    win.titleEl.style.display = 'none';          /* başlık metni yok, sekmeler var */
    win.bar.insertBefore(this.tabstrip, win.trail);
    win.bar.insertBefore(this.newTabBtn, win.trail);
    this.enableTabReorder();

    /* --- toolbar --- */
    const nav = (g, title, fn, cls = '') => h('button.ob-btn' + cls, { html: icon(g, 16), title, onclick: fn });
    this.backB = nav('chevronL', 'Geri (⌘[)', () => this.back());
    this.fwdB = nav('chevronR', 'İleri (⌘])', () => this.forward());
    this.reloadB = nav('refresh', 'Yenile (⌘R)', () => this.reload());
    this.sideB = nav('sidebarIc', 'Kenar çubuğu', () => this.toggleSidebar());

    this.lock = h('span.ob-lock', { html: icon('lock', 12) });
    this.addr = h('input.ob-addr', { spellcheck: false, autocomplete: 'off',
      placeholder: 'Ara ya da adres gir' });
    this.suggest = h('div.ob-suggest');
    this.field = h('div.ob-field', this.lock, this.addr,
      h('button.ob-btn.small', { html: icon('star', 14), title: 'Yer imlerine ekle',
        onclick: () => this.toggleBookmark() }), this.suggest);

    this.toolbar = h('div.ob-toolbar',
      this.sideB, h('span.ob-sep'), this.backB, this.fwdB, this.reloadB,
      this.field,
      nav('download', 'İndirilenler', e => this.showPanel('downloads', e.currentTarget)),
      nav('grid', 'Sekme Genel Bakış', () => this.tabOverview()),
    );

    /* --- sidebar --- */
    this.sidebar = h('div.ob-side');
    this.sidebar.style.display = 'none';

    /* --- stack of tab panes --- */
    this.stack = h('div.ob-stack');
    this.progress = h('div.ob-progress', h('i'));
    this.statusbar = h('div.ob-status');

    this.el = h('div.ob',
      this.toolbar, this.progress,
      h('div.ob-main', this.sidebar, this.stack),
      this.statusbar);

    this.bindAddressBar();
    contextMenu(this.stack, e => e.target.closest('iframe') ? null : this.pageMenu(e));
    this.renderSidebar();
  }

  menus() {
    return [
      { title: 'Dosya', items: () => [
        { label: 'Yeni Sekme', key: '⌘T', glyph: 'plus', run: () => this.newTab(settings.get('browser.homepage'), { focus: true }) },
        { label: 'Yeni Gizli Sekme', key: '⇧⌘N', glyph: 'eye', run: () => this.newTab('openos://start', { focus: true, private: true }) },
        { label: 'Sekmeyi Kapat', key: '⌘W', glyph: 'x', run: () => this.closeTab(this.active) },
        '-',
        { label: 'Sayfayı Kaydet', glyph: 'save', run: () => this.savePage() },
      ] },
      { title: 'Geçmiş', items: () => [
        { label: 'Geri', key: '⌘[', disabled: !this.canBack(), run: () => this.back() },
        { label: 'İleri', key: '⌘]', disabled: !this.canForward(), run: () => this.forward() },
        '-',
        ...(this.history.slice(0, 10).map(hh => ({
          label: hh.title || hh.url, glyph: 'clock', run: () => this.go(hh.url) })) ||
          [{ label: 'Boş', disabled: true }]),
        '-',
        { label: 'Tüm Geçmiş', glyph: 'list', run: () => this.go('openos://history') },
        { label: 'Geçmişi Temizle…', glyph: 'trash', danger: true, run: () => this.clearHistory() },
      ] },
      { title: 'Yer İmleri', items: () => [
        { label: 'Bu Sayfayı Ekle', key: '⌘D', glyph: 'star', run: () => this.toggleBookmark() },
        '-',
        ...this.bookmarks.slice(0, 12).map(b => ({ label: b.title, glyph: b.glyph || 'globe', run: () => this.go(b.url) })),
        '-',
        { label: 'Tümünü Göster', glyph: 'list', run: () => this.go('openos://bookmarks') },
      ] },
      { title: 'Görünüm', items: () => [
        { label: 'Yakınlaştır', key: '⌘+', glyph: 'plus', run: () => this.zoom(10) },
        { label: 'Uzaklaştır', key: '⌘-', glyph: 'minus', run: () => this.zoom(-10) },
        { label: 'Gerçek Boyut', key: '⌘0', run: () => this.zoom(0, true) },
        '-',
        { label: 'Sayfada Bul…', key: '⌘F', glyph: 'search', run: () => this.openFind() },
        { label: 'Kaynağı Göster', glyph: 'code', run: () => this.viewSource() },
        '-',
        { label: 'Kenar Çubuğu', glyph: 'sidebarIc', run: () => this.toggleSidebar() },
      ] },
      { title: 'OpenBrow', items: () => [
        { label: `OpenBrow ${OPENBROW_VERSION} Hakkında`, glyph: 'compass', run: () => this.go('openos://openbrow') },
        { label: 'Tarayıcı Ayarları', glyph: 'settings', run: () => this.go('openos://browser-settings') },
        '-',
        { label: `Motor: ${this.engineLabel()}`, disabled: true },
      ] },
    ];
  }

  /* ================== tabs ================== */
  newTab(url, { focus = true, private: priv = false } = {}) {
    const tab = {
      id: uid('tab'), url: '', title: 'Yeni Sekme', history: [], hi: -1,
      private: priv, loading: false, favicon: '', engine: 'internal',
      pane: h('div.ob-pane'),
    };
    this.tabs.push(tab);
    this.stack.appendChild(tab.pane);
    this.renderTabs();
    if (focus) this.selectTab(tab);
    if (url) this.go(url, { tab });
    return tab;
  }

  closeTab(tab) {
    if (!tab) return;
    const i = this.tabs.indexOf(tab);
    tab.pane.remove();
    this.tabs.splice(i, 1);
    if (!this.tabs.length) { this.ctx.close(); return; }
    if (this.active === tab) this.selectTab(this.tabs[Math.min(i, this.tabs.length - 1)]);
    this.renderTabs();
  }

  selectTab(tab) {
    this.active = tab;
    this.tabs.forEach(t => t.pane.classList.toggle('on', t === tab));
    this.renderTabs();
    this.syncChrome();
  }

  renderTabs() {
    clear(this.tabstrip);
    this.el.classList.toggle('single', this.tabs.length <= 1);
    this.tabs.forEach(t => {
      const el = h('div.ob-tab', {
        class: [t === this.active ? 'on' : '', t.private ? 'priv' : ''].filter(Boolean).join(' '),
        onauxclick: e => { if (e.button === 1) this.closeTab(t); },
      },
        t.loading
          ? h('span.ob-spin')
          : h('span.ob-fav', { html: t.favicon
              ? `<img src="${escapeHtml(t.favicon)}" alt="">`
              : icon(t.private ? 'eye' : (t.url.startsWith('openos://') ? 'logo' : 'globe'), 12) }),
        h('span.ob-tab-title', { text: t.title || 'Yeni Sekme' }),
        h('button.ob-close', { html: icon('x', 11), onclick: e => { e.stopPropagation(); this.closeTab(t); } }));
      contextMenu(el, () => this.tabMenu(t));
      this.tabstrip.appendChild(el);
    });
  }

  /** Sekmeler imleçle yer değiştirebilir. */
  enableTabReorder() {
    let dragTab = null, startX = 0, moved = false;
    on(this.tabstrip, 'pointerdown', e => {
      const el = e.target.closest('.ob-tab');
      if (!el || e.target.closest('.ob-close')) return;
      dragTab = this.tabs[[...this.tabstrip.children].indexOf(el)];
      startX = e.clientX; moved = false;
      el.setPointerCapture?.(e.pointerId);
    });
    on(this.tabstrip, 'pointermove', e => {
      if (!dragTab) return;
      if (!moved && Math.abs(e.clientX - startX) < 6) return;
      moved = true;
      this.tabstrip.classList.add('reordering');
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.ob-tab');
      if (!over) return;
      const toIdx = [...this.tabstrip.children].indexOf(over);
      const fromIdx = this.tabs.indexOf(dragTab);
      if (toIdx < 0 || toIdx === fromIdx) return;
      this.tabs.splice(fromIdx, 1);
      this.tabs.splice(toIdx, 0, dragTab);
      this.renderTabs();
    });
    const done = () => {
      if (dragTab && !moved) this.selectTab(dragTab);
      dragTab = null; moved = false;
      this.tabstrip.classList.remove('reordering');
    };
    on(this.tabstrip, 'pointerup', done);
    on(this.tabstrip, 'pointercancel', done);
  }

  tabMenu(t) {
    return [
      { label: 'Yenile', glyph: 'refresh', run: () => { this.selectTab(t); this.reload(); } },
      { label: 'Çoğalt', glyph: 'copy', run: () => this.newTab(t.url, { focus: true }) },
      '-',
      { label: 'Kapat', glyph: 'x', run: () => this.closeTab(t) },
      { label: 'Diğerlerini Kapat', glyph: 'trash',
        run: () => this.tabs.filter(x => x !== t).slice().forEach(x => this.closeTab(x)) },
      '-',
      { label: 'Adresi Kopyala', glyph: 'link', run: () => navigator.clipboard?.writeText(t.url) },
    ];
  }

  tabOverview() {
    menu([
      { header: `${this.tabs.length} sekme` },
      ...this.tabs.map(t => ({
        label: t.title || t.url, glyph: t.private ? 'eye' : 'window',
        checked: t === this.active, run: () => this.selectTab(t),
      })),
      '-',
      { label: 'Yeni Sekme', glyph: 'plus', run: () => this.newTab(settings.get('browser.homepage'), { focus: true }) },
      { label: 'Yeni Gizli Sekme', glyph: 'eye', run: () => this.newTab('openos://start', { focus: true, private: true }) },
    ], { anchor: this.toolbar.lastChild });
  }

  /* ================== navigation ================== */
  normalise(input) {
    let u = String(input || '').trim();
    if (!u) return '';
    if (/^openos:\/\//i.test(u)) return u;
    if (/^[a-z]+:\/\//i.test(u)) return u;
    if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(u)) return 'http://' + u;
    if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(u)) return 'https://' + u;
    if (INTERNAL[u]) return 'openos://' + u;
    return this.searchUrl(u);
  }
  searchUrl(q) {
    const e = ENGINES[settings.get('browser.search')] || ENGINES.duckduckgo;
    return e.url(q);
  }
  engineLabel() {
    const mode = settings.get('browser.engine');
    const proxy = settings.get('browser.proxy');
    if (mode === 'direct') return 'doğrudan çerçeve';
    if (proxy) return `OpenBrow Proxy (${new URL(proxy).host})`;
    return 'doğrudan çerçeve — proxy tanımlı değil';
  }
  proxied(url) {
    const mode = settings.get('browser.engine');
    const proxy = (settings.get('browser.proxy') || '').replace(/\/+$/, '');
    if (mode === 'direct' || !proxy) return null;
    return `${proxy}/?url=${encodeURIComponent(url)}`;
  }

  go(input, { tab = this.active, push = true } = {}) {
    if (!tab) return this.newTab(input, { focus: true });
    const url = this.normalise(input);
    if (!url) return;
    tab.url = url;
    if (push) {
      tab.history = tab.history.slice(0, tab.hi + 1);
      tab.history.push(url);
      tab.hi = tab.history.length - 1;
    }
    this.render(tab);
    this.syncChrome();
  }

  render(tab) {
    clear(tab.pane);
    const url = tab.url;
    tab.loading = true;
    this.setProgress(12);

    if (/^openos:\/\//i.test(url)) {
      tab.engine = 'internal';
      const page = this.renderInternal(tab, url);
      tab.pane.appendChild(page);
      tab.loading = false;
      this.setProgress(100);
      this.recordHistory(tab);
      this.renderTabs();
      this.syncChrome();
      return;
    }

    const proxyUrl = this.proxied(url);
    tab.engine = proxyUrl ? 'proxy' : 'direct';
    const frame = h('iframe.ob-frame', {
      src: proxyUrl || url,
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads',
      referrerpolicy: 'no-referrer',
      allow: 'clipboard-write; fullscreen',
    });
    tab.frame = frame;
    frame.style.zoom = (settings.get('browser.zoom') || 100) / 100;

    const veil = h('div.ob-loading', h('div.ob-spin.big'), h('div', { text: hostOf(url) }));
    tab.pane.append(frame, veil);
    this.setProgress(45);

    let settled = false;
    const settle = (ok) => {
      if (settled) return;
      settled = true;
      tab.loading = false;
      veil.remove();
      this.setProgress(100);
      if (tab.engine === 'direct' && ok) tab.title = hostOf(url);
      this.renderTabs();
      if (!ok) tab.pane.appendChild(this.blockedNotice(tab, url));
      else { this.recordHistory(tab); }
      this.syncChrome();
    };
    on(frame, 'load', () => settle(true));
    on(frame, 'error', () => settle(false));
    /* A frame refused by X-Frame-Options never fires load in most engines. */
    tab.timer = setTimeout(() => {
      if (!settled && tab.engine === 'direct') settle(false);
      else settle(true);
    }, 6500);

    if (!tab.title || tab.title === 'Yeni Sekme') tab.title = hostOf(url);
    this.renderTabs();
  }

  blockedNotice(tab, url) {
    const proxy = settings.get('browser.proxy');
    return h('div.ob-blocked',
      h('div.ob-blocked-card',
        h('div.ob-blocked-glyph', { html: icon('shield', 30) }),
        h('div.k-text.t-title2', { text: 'Bu site çerçevelenmeyi reddediyor' }),
        h('div.k-text.t-callout', { style: { maxWidth: '420px' },
          text: `${hostOf(url)} sunucusu X-Frame-Options / CSP başlıklarıyla gömülmeyi engelliyor. ` +
                (proxy ? 'OpenBrow Proxy etkin ama yanıt vermedi.'
                       : 'OpenBrow Proxy tanımlarsanız OpenBrow sayfayı kendi motoruyla açar, ' +
                         'site de kendisini OpenOS üzerinde çalışan OpenBrow’da sanır.') }),
        h('div.k-hstack', { style: { gap: '8px', marginTop: '14px', justifyContent: 'center' } },
          proxy
            ? h('button.k-btn.v-primary.s-sm', { text: 'Proxy ile tekrar dene',
                onclick: () => { settings.set('browser.engine', 'auto'); this.reload(); } })
            : h('button.k-btn.v-primary.s-sm', { text: 'Proxy ayarla',
                onclick: () => this.go('openos://browser-settings') }),
          h('button.k-btn.s-sm', { text: 'Adresi kopyala',
            onclick: () => { navigator.clipboard?.writeText(url); notify.toast('Kopyalandı', { glyph: '📋' }); } }))));
  }

  back() { const t = this.active; if (t && t.hi > 0) { t.hi--; t.url = t.history[t.hi]; this.render(t); this.syncChrome(); } }
  forward() { const t = this.active; if (t && t.hi < t.history.length - 1) { t.hi++; t.url = t.history[t.hi]; this.render(t); this.syncChrome(); } }
  canBack() { return !!this.active && this.active.hi > 0; }
  canForward() { return !!this.active && this.active.hi < this.active.history.length - 1; }
  reload() { if (this.active) this.render(this.active); }

  /* ================== chrome sync ================== */
  syncChrome() {
    const t = this.active;
    if (!t) return;
    this.backB.disabled = !this.canBack();
    this.fwdB.disabled = !this.canForward();
    if (document.activeElement !== this.addr) this.addr.value = pretty(t.url);
    const internal = t.url.startsWith('openos://');
    this.lock.innerHTML = icon(internal ? 'logo' : (t.url.startsWith('https') ? 'lock' : 'unlock'), 12);
    this.lock.className = 'ob-lock ' + (internal ? 'sys' : (t.url.startsWith('https') ? 'safe' : 'warn'));
    this.el.classList.toggle('private', !!t.private);
    /* Pencere başlığı gizli; yine de Mission Control ve Dock için güncel tut. */
    this.ctx.win.title = `${t.title || 'OpenBrow'}${t.private ? ' — Gizli' : ''}`;
    this.ctx.win.wm.bus.emit('title', this.ctx.win);
    const marked = this.bookmarks.some(b => b.url === t.url);
    this.field.querySelector('.ob-btn.small').innerHTML = icon('star', 14);
    this.field.querySelector('.ob-btn.small').classList.toggle('on', marked);
    this.statusbar.textContent =
      `${t.engine === 'proxy' ? 'OpenBrow motoru (proxy)' : t.engine === 'internal' ? 'OpenOS dahili sayfa' : 'Doğrudan çerçeve'} · ` +
      `${this.tabs.length} sekme · ${settings.get('browser.zoom')}%`;
  }

  setProgress(pct) {
    const bar = this.progress.firstChild;
    this.progress.classList.toggle('done', pct >= 100);
    bar.style.width = pct + '%';
    if (pct >= 100) setTimeout(() => { bar.style.width = '0%'; }, 380);
  }

  /* ================== address bar ================== */
  bindAddressBar() {
    let sel = -1;
    const close = () => { this.suggest.classList.remove('on'); sel = -1; };

    const paint = () => {
      const q = this.addr.value.trim();
      clear(this.suggest);
      if (!q) return close();
      const items = this.suggestions(q);
      if (!items.length) return close();
      items.forEach((it, i) => {
        this.suggest.appendChild(h('div.ob-sug', { class: i === sel ? 'on' : '', onclick: () => { close(); this.go(it.url); } },
          h('span.g', { html: icon(it.glyph, 14) }),
          h('span.t', { text: it.title }),
          h('span.u', { text: pretty(it.url) })));
      });
      this.suggest.classList.add('on');
    };

    on(this.addr, 'input', paint);
    on(this.addr, 'focus', () => { this.addr.select(); paint(); });
    on(this.addr, 'blur', () => setTimeout(close, 160));
    on(this.addr, 'keydown', e => {
      const rows = [...this.suggest.children];
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(rows.length - 1, sel + 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(-1, sel - 1); paint(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const items = this.suggestions(this.addr.value.trim());
        close();
        this.go(sel >= 0 && items[sel] ? items[sel].url : this.addr.value);
        this.addr.blur();
      } else if (e.key === 'Escape') { close(); this.addr.value = pretty(this.active?.url || ''); this.addr.blur(); }
    });
  }

  suggestions(q) {
    const s = q.toLowerCase();
    const out = [];
    if (/^[a-z]+:\/\//i.test(q) || /^[\w-]+(\.[\w-]+)+/.test(q))
      out.push({ title: 'Adrese git', url: this.normalise(q), glyph: 'arrowR' });
    out.push({ title: `${(ENGINES[settings.get('browser.search')] || ENGINES.duckduckgo).name}’da ara: ${q}`,
      url: this.searchUrl(q), glyph: 'search' });
    for (const [k, p] of Object.entries(INTERNAL))
      if (k.includes(s) || p.title.toLowerCase().includes(s))
        out.push({ title: p.title, url: 'openos://' + k, glyph: p.glyph || 'logo' });
    this.bookmarks.filter(b => (b.title + b.url).toLowerCase().includes(s)).slice(0, 4)
      .forEach(b => out.push({ title: b.title, url: b.url, glyph: 'star' }));
    this.history.filter(hh => (hh.title + hh.url).toLowerCase().includes(s)).slice(0, 4)
      .forEach(hh => out.push({ title: hh.title || hh.url, url: hh.url, glyph: 'clock' }));
    return dedupe(out).slice(0, 9);
  }

  /* ================== data ================== */
  recordHistory(tab) {
    if (tab.private) return;
    const entry = { url: tab.url, title: tab.title, at: Date.now() };
    this.history = [entry, ...this.history.filter(hh => hh.url !== tab.url)].slice(0, 400);
    this.saveSoon();
  }
  saveSoon = debounce(() => {
    vfs.writeJSON(VFS.join(this.dir, 'history.json'), this.history);
    vfs.writeJSON(VFS.join(this.dir, 'bookmarks.json'), this.bookmarks);
    vfs.writeJSON(VFS.join(this.dir, 'downloads.json'), this.downloads);
  }, 400);

  toggleBookmark() {
    const t = this.active;
    if (!t) return;
    const i = this.bookmarks.findIndex(b => b.url === t.url);
    if (i >= 0) { this.bookmarks.splice(i, 1); notify.toast('Yer imi kaldırıldı', { glyph: '☆' }); }
    else { this.bookmarks.unshift({ title: t.title || hostOf(t.url), url: t.url, added: Date.now() });
           notify.toast('Yer imlerine eklendi', { glyph: '★' }); }
    this.saveSoon(); this.syncChrome(); this.renderSidebar();
  }

  async clearHistory() {
    if (!(await notify.confirm('Tüm gezinme geçmişi silinsin mi?', { title: 'Geçmişi Temizle', danger: true, ok: 'Sil' }))) return;
    this.history = [];
    this.saveSoon(); this.renderSidebar();
    if (this.active?.url === 'openos://history') this.reload();
  }

  savePage() {
    const t = this.active;
    if (!t) return;
    const dir = VFS.join(vfs.home, 'İndirilenler');
    vfs.mkdir(dir);
    const name = (t.title || hostOf(t.url)).replace(/[^\w .-]/g, '_') + '.url';
    const p = vfs.unique(VFS.join(dir, name));
    vfs.write(p, `[OpenBrow]\nURL=${t.url}\nTitle=${t.title}\nSaved=${new Date().toISOString()}\n`);
    this.downloads.unshift({ name: VFS.basename(p), path: p, url: t.url, at: Date.now(), size: vfs.stat(p).size });
    this.saveSoon();
    notify.post({ title: 'Kaydedildi', body: VFS.basename(p), glyph: 'download', tint: ['#4aa8ff', '#1b56d6'] });
  }

  viewSource() {
    const t = this.active;
    if (!t) return;
    if (t.url.startsWith('openos://')) {
      const key = t.url.replace('openos://', '').split('?')[0];
      const page = INTERNAL[key];
      notify.alert(page ? `Dahili sayfa: ${page.title}\nOpenBrow tarafından OpenOS bileşenleriyle çizildi — HTML kaynağı yok.`
                        : 'Kaynak yok', { title: 'Kaynağı Göster', glyph: '📄' });
      return;
    }
    const proxy = this.proxied(t.url);
    if (!proxy) { notify.toast('Kaynak görüntüleme proxy gerektirir', { glyph: '⚠️' }); return; }
    fetch(proxy.replace('/?url=', '/raw?url=')).then(r => r.text()).then(src => {
      const dir = VFS.join(vfs.home, 'İndirilenler'); vfs.mkdir(dir);
      const p = vfs.unique(VFS.join(dir, hostOf(t.url) + '.html'));
      vfs.write(p, src);
      this.ctx.openApp('texteditor', { path: p });
    }).catch(e => notify.toast('Kaynak alınamadı: ' + e.message, { glyph: '⚠️' }));
  }

  zoom(delta, reset) {
    const cur = settings.get('browser.zoom') || 100;
    const v = reset ? 100 : Math.max(50, Math.min(200, cur + delta));
    settings.set('browser.zoom', v);
    this.tabs.forEach(t => { if (t.frame) t.frame.style.zoom = v / 100; });
    this.tabs.forEach(t => { const p = t.pane.querySelector('.ob-page'); if (p) p.style.zoom = v / 100; });
    this.syncChrome();
  }

  openFind() {
    if (this.findBar) { this.findBar.querySelector('input').focus(); return; }
    const input = h('input', { placeholder: 'Sayfada bul' });
    const count = h('span.k-text.t-caption');
    const close = () => { this.clearFind(); this.findBar.remove(); this.findBar = null; };
    this.findBar = h('div.ob-find', h('span', { html: icon('search', 13) }), input, count,
      h('button.ob-btn.small', { html: icon('x', 13), onclick: close }));
    this.el.appendChild(this.findBar);
    on(input, 'input', () => { count.textContent = this.runFind(input.value) + ' sonuç'; });
    on(input, 'keydown', e => { if (e.key === 'Escape') close(); });
    input.focus();
  }
  clearFind() {
    const page = this.active?.pane.querySelector('.ob-page');
    page?.querySelectorAll('mark.ob-hit').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
  }
  runFind(q) {
    this.clearFind();
    const page = this.active?.pane.querySelector('.ob-page');
    if (!page || !q.trim()) return 0;
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let n = 0;
    const walk = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walk.nextNode()) if (rx.test(walk.currentNode.nodeValue)) hits.push(walk.currentNode);
    hits.forEach(node => {
      const frag = document.createDocumentFragment();
      node.nodeValue.split(rx).forEach((part, i, arr) => {
        frag.appendChild(document.createTextNode(part));
        if (i < arr.length - 1) {
          const m = h('mark.ob-hit', { text: node.nodeValue.match(rx)?.[n] || q });
          frag.appendChild(m); n++;
        }
      });
      node.replaceWith(frag);
    });
    page.querySelector('mark.ob-hit')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return n;
  }

  /* ================== sidebar & panels ================== */
  toggleSidebar() {
    const on0 = this.sidebar.style.display !== 'none';
    this.sidebar.style.display = on0 ? 'none' : '';
    this.sideB.classList.toggle('on', !on0);
    if (!on0) this.renderSidebar();
  }
  renderSidebar() {
    if (this.sidebar.style.display === 'none') return;
    clear(this.sidebar);
    this.sidebar.append(
      h('div.sb-title', { text: 'Yer İmleri' }),
      ...this.bookmarks.map(b => {
        const row = h('div.sb-item', { onclick: () => this.go(b.url) },
          h('span.ic', { html: icon(b.glyph || 'star', 13) }), h('span.ellipsis', { text: b.title }));
        contextMenu(row, () => [
          { label: 'Aç', run: () => this.go(b.url) },
          { label: 'Yeni sekmede aç', run: () => this.newTab(b.url, { focus: true }) },
          '-',
          { label: 'Kaldır', danger: true, run: () => {
            this.bookmarks = this.bookmarks.filter(x => x !== b); this.saveSoon(); this.renderSidebar(); } },
        ]);
        return row;
      }),
      h('div.sb-title', { text: 'Geçmiş' }),
      ...this.history.slice(0, 14).map(hh => h('div.sb-item', { onclick: () => this.go(hh.url) },
        h('span.ic', { html: icon('clock', 13) }), h('span.ellipsis', { text: hh.title || hostOf(hh.url) }))),
    );
  }

  showPanel(which, anchor) {
    if (which === 'downloads') {
      menu([
        { header: `İndirilenler · ${this.downloads.length}` },
        ...(this.downloads.length
          ? this.downloads.slice(0, 10).map(d => ({
              label: d.name, glyph: 'file', run: () => this.ctx.openPath(d.path) }))
          : [{ label: 'Henüz indirme yok', disabled: true }]),
        '-',
        { label: 'İndirilenler klasörü', glyph: 'folder',
          run: () => this.ctx.openApp('finder', { path: VFS.join(vfs.home, 'İndirilenler') }) },
      ], { anchor });
    }
  }

  /* ================== context menus ================== */
  pageMenu(e) {
    const t = this.active;
    const sel = String(window.getSelection() || '');
    return [
      { label: 'Geri', glyph: 'chevronL', disabled: !this.canBack(), run: () => this.back() },
      { label: 'İleri', glyph: 'chevronR', disabled: !this.canForward(), run: () => this.forward() },
      { label: 'Yenile', glyph: 'refresh', run: () => this.reload() },
      '-',
      ...(sel.trim() ? [
        { label: 'Kopyala', glyph: 'copy', run: () => navigator.clipboard?.writeText(sel) },
        { label: `Ara: “${sel.slice(0, 20)}”`, glyph: 'search', run: () => this.newTab(this.searchUrl(sel), { focus: true }) },
        '-',
      ] : []),
      { label: 'Adresi kopyala', glyph: 'link', run: () => navigator.clipboard?.writeText(t?.url || '') },
      { label: 'Yer imlerine ekle', glyph: 'star', run: () => this.toggleBookmark() },
      { label: 'Sayfayı kaydet', glyph: 'save', run: () => this.savePage() },
      '-',
      { label: 'Sayfada bul…', glyph: 'search', key: '⌘F', run: () => this.openFind() },
      { label: 'Kaynağı göster', glyph: 'code', run: () => this.viewSource() },
      { label: 'Tarayıcı ayarları', glyph: 'settings', run: () => this.go('openos://browser-settings') },
    ];
  }

  linkMenu(url, x, y) {
    menu([
      { header: pretty(url) },
      { label: 'Aç', glyph: 'arrowR', run: () => this.go(url) },
      { label: 'Yeni sekmede aç', glyph: 'plus', run: () => this.newTab(url, { focus: true }) },
      { label: 'Gizli sekmede aç', glyph: 'eye', run: () => this.newTab(url, { focus: true, private: true }) },
      '-',
      { label: 'Bağlantıyı kopyala', glyph: 'link', run: () => navigator.clipboard?.writeText(url) },
      { label: 'Yer imlerine ekle', glyph: 'star', run: () => {
        this.bookmarks.unshift({ title: hostOf(url), url, added: Date.now() }); this.saveSoon(); this.renderSidebar(); } },
    ], { x, y });
  }

  /* ================== proxy bridge ================== */
  bindMessages() {
    this.onMessage = (e) => {
      const d = e.data;
      if (!d || !d.__openbrow) return;
      const tab = this.tabs.find(t => t.frame && t.frame.contentWindow === e.source);
      if (!tab) return;
      if (d.type === 'ready') {
        tab.title = d.title || hostOf(tab.url);
        tab.favicon = d.icon || '';
        tab.loading = false;
        this.renderTabs();
        if (tab === this.active) { this.recordHistory(tab); this.syncChrome(); }
      } else if (d.type === 'navigate') {
        if (d.newTab) this.newTab(d.url, { focus: true, private: tab.private });
        else { this.selectTab(tab); this.go(d.url, { tab }); }
      } else if (d.type === 'contextmenu') {
        const r = tab.frame.getBoundingClientRect();
        const x = r.left + (d.x || 0), y = r.top + (d.y || 0);
        if (d.link) this.linkMenu(d.link, x, y);
        else menu(this.pageMenu(), { x, y });
      }
    };
    window.addEventListener('message', this.onMessage);
  }

  destroy() {
    const win = this.ctx.win;
    win.el.classList.remove('tabbed');
    win.bar.classList.remove('tall');
    if (win.titleEl) win.titleEl.style.display = '';
    this.tabstrip?.remove();
    this.newTabBtn?.remove();
    window.removeEventListener('message', this.onMessage);
    this.tabs.forEach(t => clearTimeout(t.timer));
    this.saveSoon();
  }

  /* ================== internal pages ================== */
  renderInternal(tab, url) {
    const u = new URL(url.replace(/^openos:\/\//i, 'https://'));
    const key = u.hostname;
    const page = INTERNAL[key];
    const host = h('div.ob-page.selectable');
    if (!page) {
      tab.title = 'Sayfa bulunamadı';
      host.appendChild(h('div.k-empty', { style: { paddingTop: '80px' } },
        h('div.glyph', { text: '🧭' }),
        h('div.k-text.t-title2', { text: 'Sayfa bulunamadı' }),
        h('div.k-text.t-callout', { text: url })));
      return host;
    }
    tab.title = page.title;
    tab.favicon = '';
    host.style.zoom = (settings.get('browser.zoom') || 100) / 100;
    host.appendChild(page.render(this, u));
    return host;
  }
}

/* ====================================================================== */
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u); } };
const pretty = u => String(u || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const dedupe = list => {
  const seen = new Set();
  return list.filter(i => (seen.has(i.url) ? false : (seen.add(i.url), true)));
};

/* ---------------------------------------------------------------- pages */
const hero = (title, sub, glyph) => h('div.br-hero',
  h('div.br-hero-glyph', { html: icon(glyph, 40) }),
  h('div.k-text.t-largetitle', { text: title }),
  h('div.k-text.t-callout', { text: sub }));

const INTERNAL = {
  start: {
    title: 'Başlangıç', glyph: 'home',
    render(br) {
      const input = h('input', { placeholder: 'Ara ya da adres gir', style: { fontSize: '15px' } });
      on(input, 'keydown', e => { if (e.key === 'Enter') br.go(input.value); });
      const tiles = br.bookmarks.slice(0, 12).map(b =>
        h('div.ob-tile', { onclick: () => br.go(b.url) },
          h('div.g', { html: icon(b.glyph || 'globe', 20) }),
          h('div.t.ellipsis', { text: b.title }),
          h('div.u.ellipsis', { text: pretty(b.url) })));
      const recents = br.history.slice(0, 8).map(hh =>
        h('div.k-row.tappable', { onclick: () => br.go(hh.url) },
          h('div.lead', { style: { background: 'var(--gray)' }, html: icon('clock', 14) }),
          h('div.k-vstack', { style: { flex: 1, minWidth: 0 } },
            h('div.k-text.ellipsis', { text: hh.title || hostOf(hh.url) }),
            h('div.k-text.t-caption.ellipsis', { text: pretty(hh.url) })),
          h('div.k-text.t-caption', { text: relTime(hh.at, 'tr') })));

      return h('div.ob-start',
        h('div.ob-start-head',
          h('div.br-hero-glyph', { html: icon('compass', 34) }),
          h('div.k-text.t-largetitle', { text: 'OpenBrow' }),
          h('div.k-text.t-callout', { text: `OpenOS'un kendi tarayıcısı · sürüm ${OPENBROW_VERSION}` })),
        h('div.k-field', { style: { maxWidth: '560px', margin: '0 auto', height: '42px' } },
          h('span', { html: icon('search', 16), style: { color: 'var(--text-3)' } }), input),
        h('div.k-sectitle', { text: 'Favoriler', style: { marginTop: '22px' } }),
        h('div.ob-tiles', ...tiles),
        recents.length ? h('div.k-sectitle', { text: 'Son ziyaret edilenler', style: { marginTop: '18px' } }) : null,
        recents.length ? h('div.k-group', ...recents) : null);
    },
  },

  openbrow: {
    title: 'OpenBrow Hakkında', glyph: 'compass',
    render(br) {
      const rows = [
        ['Sürüm', `OpenBrow ${OPENBROW_VERSION}`],
        ['Motor', br.engineLabel()],
        ['Kullanıcı aracısı', OPENBROW_UA],
        ['İşletim sistemi', `OpenOS ${br.ctx.version} “${br.ctx.codename}”`],
        ['Arama motoru', (ENGINES[settings.get('browser.search')] || ENGINES.duckduckgo).name],
        ['Yer imleri', String(br.bookmarks.length)],
        ['Geçmiş', `${br.history.length} kayıt`],
      ];
      return h('div.br-wrap',
        hero('OpenBrow', 'OpenOS için yazılmış tarayıcı', 'compass'),
        h('div.k-group', ...rows.map(([k, v]) => h('div.k-row',
          h('div.k-text.t-secondary', { text: k, style: { width: '150px', flex: '0 0 auto' } }),
          h('div.k-text.t-mono', { text: v, style: { flex: 1, wordBreak: 'break-all', fontSize: '11.5px' } })))),
        h('div.br-doc', { html: markdown(OPENBROW_MD) }));
    },
  },

  'browser-settings': {
    title: 'Tarayıcı Ayarları', glyph: 'settings',
    render(br) {
      const wrap = h('div.br-wrap');
      const group = (title, ...rows) => wrap.append(
        h('div.k-sectitle', { text: title, style: { marginTop: '16px' } }), h('div.k-group', ...rows));

      const proxyInput = h('input', { value: settings.get('browser.proxy'), placeholder: 'https://openbrow-proxy.<hesap>.workers.dev' });
      on(proxyInput, 'change', () => { settings.set('browser.proxy', proxyInput.value.trim()); br.syncChrome(); });

      const homeInput = h('input', { value: settings.get('browser.homepage') });
      on(homeInput, 'change', () => settings.set('browser.homepage', homeInput.value.trim()));

      const seg = (opts, val, fn) => {
        const n = h('div.k-seg');
        opts.forEach(([v, l]) => {
          const b = h('button', { text: l, 'aria-selected': String(v === val) });
          b.addEventListener('click', () => {
            n.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', 'false'));
            b.setAttribute('aria-selected', 'true'); fn(v); br.syncChrome();
          });
          n.appendChild(b);
        });
        return n;
      };
      const row = (glyph, tint, title, sub, control) => h('div.k-row',
        h('div.lead', { style: { background: tint }, html: icon(glyph, 15) }),
        h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '1px' } },
          h('div.k-text', { text: title, style: { fontWeight: 520 } }),
          sub ? h('div.k-text.t-caption', { text: sub }) : null), control);
      const toggle = (path) => {
        const t = h('div.k-toggle', { dataset: { on: settings.get(path) ? '1' : '0' } });
        t.addEventListener('click', () => { const v = !settings.get(path); settings.set(path, v); t.dataset.on = v ? '1' : '0'; });
        return t;
      };

      wrap.appendChild(hero('Tarayıcı Ayarları', 'OpenBrow motoru ve gizlilik', 'settings'));
      group('Motor',
        row('bolt', 'var(--blue)', 'Sayfa motoru', 'Proxy, siteleri OpenOS kimliğiyle açar ve çerçeveleme engellerini kaldırır',
          seg([['auto', 'Otomatik'], ['proxy', 'Proxy'], ['direct', 'Doğrudan']],
            settings.get('browser.engine'), v => settings.set('browser.engine', v))),
        row('cloud', 'var(--indigo)', 'OpenBrow Proxy', 'Cloudflare Worker adresi',
          h('div.k-field', { style: { width: '300px' } }, proxyInput)),
        row('robot', 'var(--purple)', 'OpenOS kimliği gönder', 'navigator.userAgent → OpenBrow', toggle('browser.spoofUA')),
      );
      group('Gezinme',
        row('search', 'var(--green)', 'Arama motoru', null,
          seg(Object.entries(ENGINES).map(([k, v]) => [k, v.name]),
            settings.get('browser.search'), v => settings.set('browser.search', v))),
        row('home', 'var(--orange)', 'Başlangıç sayfası', null,
          h('div.k-field', { style: { width: '260px' } }, homeInput)),
        row('shield', 'var(--red)', 'İzleyicileri engelle', 'Bilinen izleme alan adlarını reddet', toggle('browser.blockTrackers')),
      );
      group('Veri',
        row('clock', 'var(--gray)', 'Geçmiş', `${br.history.length} kayıt`,
          h('button.k-btn.s-sm', { text: 'Temizle', onclick: () => br.clearHistory() })),
        row('star', 'var(--yellow)', 'Yer imleri', `${br.bookmarks.length} kayıt`,
          h('button.k-btn.s-sm', { text: 'Göster', onclick: () => br.go('openos://bookmarks') })),
      );
      wrap.appendChild(h('div.br-doc', { html: markdown(PROXY_MD) }));
      return wrap;
    },
  },

  history: {
    title: 'Geçmiş', glyph: 'clock',
    render(br) {
      const wrap = h('div.br-wrap', hero('Geçmiş', `${br.history.length} kayıt`, 'clock'));
      if (!br.history.length) { wrap.appendChild(h('div.k-empty', h('div.glyph', { text: '🕘' }),
        h('div.k-text.t-callout', { text: 'Geçmiş boş' }))); return wrap; }
      const g = h('div.k-group');
      br.history.forEach(hh => g.appendChild(h('div.k-row.tappable', { onclick: () => br.go(hh.url) },
        h('div.lead', { style: { background: 'var(--gray)' }, html: icon('globe', 14) }),
        h('div.k-vstack', { style: { flex: 1, minWidth: 0 } },
          h('div.k-text.ellipsis', { text: hh.title || hostOf(hh.url) }),
          h('div.k-text.t-caption.ellipsis', { text: pretty(hh.url) })),
        h('div.k-text.t-caption', { text: relTime(hh.at, 'tr') }))));
      wrap.append(g, h('button.k-btn.v-danger.s-sm', { text: 'Geçmişi temizle',
        style: { marginTop: '14px' }, onclick: () => br.clearHistory() }));
      return wrap;
    },
  },

  bookmarks: {
    title: 'Yer İmleri', glyph: 'star',
    render(br) {
      const wrap = h('div.br-wrap', hero('Yer İmleri', `${br.bookmarks.length} kayıt`, 'star'));
      const g = h('div.k-group');
      br.bookmarks.forEach(b => g.appendChild(h('div.k-row.tappable', { onclick: () => br.go(b.url) },
        h('div.lead', { style: { background: 'var(--yellow)' }, html: icon(b.glyph || 'star', 14) }),
        h('div.k-vstack', { style: { flex: 1, minWidth: 0 } },
          h('div.k-text.ellipsis', { text: b.title }),
          h('div.k-text.t-caption.ellipsis', { text: pretty(b.url) })),
        h('button.k-btn.v-ghost.icon.s-sm', { html: icon('trash', 13), onclick: e => {
          e.stopPropagation();
          br.bookmarks = br.bookmarks.filter(x => x !== b); br.saveSoon(); br.reload(); } }))));
      wrap.appendChild(g);
      return wrap;
    },
  },

  about: {
    title: 'OpenOS Hakkında', glyph: 'logo',
    render(br) {
      return h('div.br-wrap',
        hero('OpenOS', 'Tarayıcıda çalışan sanal işletim sistemi', 'logo'),
        h('div.br-doc', { html: markdown(ABOUT_MD) }),
        h('div.k-hstack', { style: { gap: '8px', marginTop: '18px' } },
          h('button.k-btn.v-primary', { text: 'Ajan API’si', onclick: () => br.ctx.openApp('agenthub') }),
          h('button.k-btn', { text: 'Sistem ayarları', onclick: () => br.ctx.openApp('settings') })));
    },
  },

  docs: {
    title: 'OpenSharp Belgeleri', glyph: 'code',
    render(br) {
      return h('div.br-wrap',
        hero('OpenSharp', 'OpenOS uygulama dili', 'code'),
        h('div.br-doc', { html: markdown(DOCS_MD) }),
        h('button.k-btn.v-primary', { text: 'Studio’da aç', style: { marginTop: '16px' },
          onclick: () => br.ctx.openApp('studio', { doc: true }) }));
    },
  },

  agents: {
    title: 'Ajanlar için OpenOS', glyph: 'robot',
    render(br) {
      return h('div.br-wrap',
        hero('Ajanlar için', 'Makine dostu bir masaüstü', 'robot'),
        h('div.br-doc', { html: markdown(AGENT_MD) }),
        h('button.k-btn.v-primary', { text: 'Ajan Merkezi’ni aç', style: { marginTop: '14px' },
          onclick: () => br.ctx.openApp('agenthub') }));
    },
  },

  search: {
    title: 'Arama', glyph: 'search',
    render(br, u) {
      const q = u.searchParams.get('q') || '';
      const apps = registry.search(q);
      const files = vfs.search(q, { limit: 12 });
      const sec = (title, items) => items.length ? h('div', { style: { marginBottom: '20px' } },
        h('div.k-sectitle', { text: title }), h('div.k-group', ...items)) : null;
      return h('div.br-wrap',
        h('div.k-text.t-title', { text: `“${q}” için sonuçlar` }),
        sec('Uygulamalar', apps.map(a => h('div.k-row.tappable', { onclick: () => br.ctx.openApp(a.id) },
          h('div.lead', { style: { background: `linear-gradient(150deg,${a.tint[0]},${a.tint[1]})` }, html: icon(a.glyph, 15) }),
          h('div.k-vstack', { style: { flex: 1 } }, h('div.k-text', { text: a.name }),
            h('div.k-text.t-caption', { text: 'Uygulama · ' + a.category }))))),
        sec('Dosyalar', files.map(f => h('div.k-row.tappable', { onclick: () => br.ctx.openPath(f.path) },
          h('div.lead', { style: { background: 'var(--gray)' }, html: icon('file', 15) }),
          h('div.k-vstack', { style: { flex: 1 } }, h('div.k-text', { text: f.name }),
            h('div.k-text.t-caption', { text: f.path }))))),
        h('button.k-btn.v-primary', { text: `Web’de ara: ${q}`, onclick: () => br.go(br.searchUrl(q)) }));
    },
  },
};

/* ------------------------------------------------------------ copy ---- */
const OPENBROW_MD = `
## Motor nasıl çalışıyor

OpenBrow'un iki çizim yolu var:

1. **Dahili sayfalar** (\`openos://\`) — OpenOS'un kendi arayüz bileşenleriyle
   çizilir. HTML yok, iframe yok; başlangıç sayfası, geçmiş, yer imleri ve
   ayarlar bu şekilde oluşturulur.
2. **Web sayfaları** — **OpenBrow Proxy** üzerinden alınır. Proxy sayfayı
   OpenOS kimliğiyle indirir, çerçeveleme engellerini (\`X-Frame-Options\`,
   \`CSP frame-ancestors\`) kaldırır ve sayfaya bir kimlik katmanı enjekte eder.

Enjekte edilen katman sayfanın gördüğü tarayıcıyı yeniden yazar:

\`\`\`
navigator.userAgent  → Mozilla/5.0 (OpenOS 1.0; Meridian) … OpenBrow/1.0
navigator.platform   → OpenOS
navigator.appName    → OpenBrow
navigator.oscpu      → OpenOS 1.0 Meridian
window.OpenBrow      → { version, os, proxied, page }
\`\`\`

Yani sayfa, bir tarayıcının içindeki tarayıcıda değil, **OpenOS üzerinde
çalışan OpenBrow'da** olduğunu düşünür. Bağlantı tıklamaları, form gönderimleri
ve sağ tık, sayfadan OpenBrow'un kendi arayüzüne geri iletilir.

Proxy tanımlı değilse OpenBrow doğrudan çerçeveleme yapar; bu durumda çoğu
büyük site kendini göstermeyi reddeder ve OpenBrow bunu açıkça bildirir.
`;

const PROXY_MD = `
### Proxy'yi kurmak

Depodaki \`cloud/openbrow-proxy.js\` dosyası tek dosyalık bir Cloudflare
Worker'ıdır:

\`\`\`
npx wrangler deploy cloud/openbrow-proxy.js --name openbrow-proxy \\
    --compatibility-date 2026-01-01
\`\`\`

Çıkan adresi yukarıdaki **OpenBrow Proxy** alanına yapıştırın. Ücretsiz planda
günde 100.000 istek yeterlidir. Proxy yalnızca sayfaları getirir; hiçbir veri
saklamaz.
`;

const ABOUT_MD = `
OpenOS; pencere yöneticisi, dosya sistemi, uygulama kaydı ve kendi programlama
dili olan, tamamen istemci tarafında çalışan bir masaüstü ortamıdır.

- **Sunucu yok.** Her şey tarayıcınızda; veriler yerel depolamada.
- **Kendi dili var.** OpenSharp ile yazdığınız uygulama Dock'a kurulabilir.
- **Kendi tarayıcısı var.** OpenBrow, dahili sayfaları kendi çizer.
- **Ajan dostu.** \`window.OpenOS\` altındaki API belgelenmiştir.
`;

const DOCS_MD = `
## Hızlı bakış

\`\`\`
app { name: "Merhaba" icon: "star" }

state ad = "dünya"

view {
  VStack(spacing: 12, padding: 20) {
    Label("Merhaba " + ad, style: "title")
    TextField(ad, placeholder: "adınız", bind: "ad")
  }
}
\`\`\`

- \`state\` ile tanımlanan değişken değişince arayüz kendiliğinden yenilenir.
- Büyük harfle başlayan çağrılar birer arayüz bileşenidir.
- \`fn\` hem tanım hem de anonim fonksiyon üretir.
`;

const AGENT_MD = `
\`\`\`
await OpenOS.describe()
OpenOS.openApp("terminal")
OpenOS.fs.write("~/Masaüstü/a.txt", "selam")
await OpenOS.runScript(kaynak)
OpenOS.snapshot()
\`\`\`

Her çağrı izinlerle sınırlıdır ve Ajan Merkezi'nde günlüklenir.
`;
