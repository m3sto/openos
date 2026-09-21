/* ==========================================================================
   OpenOS · apps/studio.js — OpenSharp Studio
   Proje gezgini, çok sekmeli düzenleyici, tamamlama, canlı önizleme, sorun
   listesi, anahat, bul/değiştir, komut paleti ve tek tıkla kurulum/yayınlama.
   ========================================================================== */

import { h, clear, add, on, debounce, escapeHtml, clamp } from '../core/util.js';
import KILAVUZ_METNI from '../../docs/OPENSHARP.md?raw';
import { icon, hasIcon } from '../core/icons.js';
import { menu, contextMenu } from '../ui/menu.js';
import vfs, { VFS } from '../core/vfs.js';
import notify from '../core/notify.js';
import settings from '../core/settings.js';
import { OshApp } from '../lang/oshapp.js';
import { STDLIB_DOCS } from '../lang/stdlib.js';
import { COMPONENT_NAMES } from '../lang/runtime.js';
import { EXAMPLES } from '../core/seed.js';
import { KEYWORDS } from '../lang/lexer.js';
import { parse } from '../lang/parser.js';
import { paketYaz, paketOku, manifestiDenetle, kimlikYap, PAKET_UZANTISI } from '../lang/package.js';
import { textField } from '../ui/textfield.js';

export default {
  id: 'studio', name: 'OpenSharp Studio', glyph: 'code', tint: ['#7b5cff', '#4a2fd0'],
  category: 'dev', width: 1180, height: 720, minWidth: 720, minHeight: 420,
  keywords: ['kod', 'ide', 'opensharp', 'geliştirme', 'editor'],
  about: 'OpenSharp uygulamaları yazın, canlı önizleyin, kurun ve yayınlayın.',
  mount(ctx) {
    const s = new Studio(ctx);
    ctx.win.onArgs = a => s.handleArgs(a);
    ctx.win.onClosed = () => s.destroy();
    return { el: s.el, menus: s.menus() };
  },
};

/* ------------------------------------------------------------------ */
const SNIPPETS = [
  ['app', 'app {\n  name: "$1"\n  icon: "sparkles"\n  tint: ["#5e5ce6", "#bf5af2"]\n}', 'Uygulama başlığı'],
  ['view', 'view {\n  VStack(spacing: 12, padding: 20) {\n    $1\n  }\n}', 'Görünüm bloğu'],
  ['fn', 'fn isim() {\n  $1\n}', 'Fonksiyon'],
  ['state', 'state isim = 0', 'Tepkili değişken'],
  ['for', 'for item in liste {\n  $1\n}', 'Döngü'],
  ['ifelse', 'if kosul {\n  $1\n} else {\n  \n}', 'Koşul'],
  ['button', 'Button("Metin", variant: "primary", onClick: fn() {\n  $1\n})', 'Düğme'],
  ['list', 'List {\n  for it in items {\n    ListItem(it.title, subtitle: it.sub, glyph: "file")\n  }\n}', 'Liste'],
  ['card', 'Card("Başlık") {\n  $1\n}', 'Kart'],
  ['timer', 'state t = nil\nt = every(1000, fn() {\n  $1\n  refresh()\n})', 'Zamanlayıcı'],
];

const STDLIB_NAMES = STDLIB_DOCS.flatMap(([, fns]) => fns.map(f => f.split('(')[0]));
const PROP_HINTS = ['spacing', 'padding', 'align', 'justify', 'grow', 'variant', 'size', 'onClick',
  'onChange', 'onSubmit', 'bind', 'value', 'placeholder', 'style', 'tint', 'background', 'radius',
  'width', 'height', 'icon', 'glyph', 'title', 'subtitle', 'options', 'min', 'max', 'step', 'rows',
  'columns', 'gap', 'full', 'disabled', 'color', 'font', 'weight', 'wrap', 'scroll'];

/* ================================================================== */
class Studio {
  constructor(ctx) {
    this.ctx = ctx;
    this.tabs = [];            /* { path|null, name, text, dirty, sel } */
    this.active = null;
    this.problems = [];
    this.build();
    this.handleArgs(ctx.args || {});
  }

  handleArgs(a = {}) {
    if (a.path && vfs.exists(a.path)) this.openFile(a.path);
    else if (a.doc) { this.showPane('docs'); if (!this.tabs.length) this.openScratch(); }
    else if (a.create) this.newFile();
    else if (!this.tabs.length) this.openScratch();
  }

  /* ============================ chrome ============================ */
  /*
   * Düzen, yerleşik bir IDE'nin düzenidir:
   *
   *   ┌──┬──────────┬──────────────────────┬──────────────┐
   *   │Et│  Panel   │  sekmeler            │   Önizleme   │
   *   │ki│ (gezgin/ │  ekmek kırıntısı     │              │
   *   │nl│  arama/  │  düzenleyici+minimap │              │
   *   │ik│  paket)  ├──────────────────────┤              │
   *   │  │          │  konsol / sorunlar   │              │
   *   └──┴──────────┴──────────────────────┴──────────────┘
   *                    durum çubuğu
   */
  build() {
    this.kurEtkinlikCubugu();
    this.kurPanel();
    this.kurDuzenleyici();
    this.kurAltPanel();
    this.kurOnizleme();
    this.kurAracCubugu();

    this.status = h('div.ide-status');

    this.merkez = h('div.ide-center',
      this.tabstrip,
      this.ekmek,
      this.editor,
      h('div.ide-hdrag'),
      this.altPanel);

    const orta = h('div.content',
      this.toolbar,
      h('div.st-split', this.merkez, h('div.st-drag'), this.rail),
      this.status);

    this.el = h('div.app-shell.ide', this.etkinlik, this.sidebar, orta);
    this.setupSplit();
    this.renderExplorer();
    this.paneliGoster('explorer');
  }

  /* ---- sol kenardaki simge rayı ---- */
  kurEtkinlikCubugu() {
    const dugme = (kod, glyph, baslik) => {
      const b = h('button.ide-act', { html: icon(glyph, 19), title: baslik,
        dataset: { panel: kod }, onclick: () => this.paneliGoster(kod) });
      return b;
    };
    this.etkinlik = h('div.ide-activity',
      dugme('explorer', 'files', 'Gezgin (⇧⌘E)'),
      dugme('search', 'search', 'Projede ara (⇧⌘F)'),
      dugme('problems', 'alert', 'Sorunlar (⇧⌘M)'),
      dugme('package', 'package', 'Paket ve yayın'),
      h('div.k-spacer'),
      h('button.ide-act', { html: icon('bolt', 19), title: 'Komut paleti (⌘K)',
        onclick: () => this.palette() }),
      h('button.ide-act', { html: icon('question', 19), title: 'Dil kılavuzu',
        onclick: () => this.showPane('docs') }),
    );
  }

  /* ---- etkinlik çubuğunun açtığı panel ---- */
  kurPanel() {
    this.explorer = h('div.ide-explorer');
    this.outline = h('div.ide-outline');

    this.panelBaslik = h('span.ide-panel-title', { text: 'GEZGİN' });
    this.panelEylem = h('div.ide-panel-acts');

    this.panelGezgin = h('div.ide-panel',
      this.explorer,
      h('div.ide-side-head', h('span', { text: 'ANAHAT' })),
      this.outline);

    this.aramaAlani = h('input', { placeholder: 'Projede ara', spellcheck: false });
    this.aramaSonuc = h('div.ide-search-results');
    this.panelArama = h('div.ide-panel',
      h('div.ide-search-box', h('div.k-field.plain', this.aramaAlani)),
      this.aramaSonuc);
    on(this.aramaAlani, 'input', debounce(() => this.projedeAra(), 220));
    on(this.aramaAlani, 'keydown', e => { if (e.key === 'Escape') { this.aramaAlani.value = ''; this.projedeAra(); } });

    this.panelSorun = h('div.ide-panel', this.problemsPane = h('div.ide-problems'));
    this.panelPaket = h('div.ide-panel.ide-pkg');

    this.sidebar = h('div.ide-side',
      h('div.ide-side-head.ana', this.panelBaslik, h('div.k-spacer'), this.panelEylem),
      this.panelGezgin, this.panelArama, this.panelSorun, this.panelPaket);
  }

  paneliGoster(kod) {
    this.panel = kod;
    const adlar = { explorer: 'GEZGİN', search: 'ARAMA', problems: 'SORUNLAR', package: 'PAKET' };
    this.panelBaslik.textContent = adlar[kod] || '';
    this.etkinlik.querySelectorAll('.ide-act[data-panel]').forEach(b =>
      b.classList.toggle('on', b.dataset.panel === kod));
    const eslesme = { explorer: this.panelGezgin, search: this.panelArama,
                      problems: this.panelSorun, package: this.panelPaket };
    for (const [k, el] of Object.entries(eslesme)) el.hidden = k !== kod;

    clear(this.panelEylem);
    if (kod === 'explorer') {
      this.panelEylem.append(
        h('button.ide-side-btn', { html: icon('plus', 13), title: 'Yeni dosya', onclick: () => this.newFile() }),
        h('button.ide-side-btn', { html: icon('refresh', 13), title: 'Yenile', onclick: () => this.renderExplorer() }));
      this.renderExplorer();
    } else if (kod === 'search') {
      setTimeout(() => this.aramaAlani.focus(), 40);
      this.projedeAra();
    } else if (kod === 'problems') {
      this.renderProblems();
    } else if (kod === 'package') {
      this.renderPaket();
    }
  }

  /* ---- düzenleyici ---- */
  kurDuzenleyici() {
    this.tabstrip = h('div.ide-tabs');
    this.ekmek = h('div.ide-breadcrumb');
    this.gutter = h('div.ed-gutter');
    this.hl = h('pre.ed-hl');
    this.ta = h('textarea.ed-ta', { spellcheck: false, autocapitalize: 'off', autocomplete: 'off', wrap: 'off' });
    this.complete = h('div.ide-complete');
    this.satirVurgu = h('div.ed-activeline');
    this.minimap = h('canvas.ed-minimap', { width: 78 });
    this.minimapGorus = h('div.ed-minimap-view');

    this.edScroll = h('div.ed-scroll', this.satirVurgu, this.hl, this.ta, this.complete);
    this.editor = h('div.ed',
      this.gutter, this.edScroll,
      h('div.ed-minimap-wrap', this.minimap, this.minimapGorus));

    on(this.ta, 'input', () => this.onInput());
    on(this.ta, 'scroll', () => {
      this.hl.scrollTop = this.ta.scrollTop; this.hl.scrollLeft = this.ta.scrollLeft;
      this.gutter.scrollTop = this.ta.scrollTop;
      this.satirVurguyuTasi();
      this.minimapGorusuTasi();
      this.hideComplete();
    }, { passive: true });
    on(this.ta, 'keydown', e => this.editorKeys(e));
    on(this.ta, 'click', () => { this.hideComplete(); this.updateStatus(); this.satirVurguyuTasi(); });
    on(this.ta, 'keyup', e => { if (!['ArrowUp', 'ArrowDown'].includes(e.key)) this.updateStatus(); this.satirVurguyuTasi(); });
    on(this.ta, 'blur', () => { setTimeout(() => this.hideComplete(), 160); this.satirVurgu.style.opacity = '0'; });
    on(this.ta, 'focus', () => { this.satirVurgu.style.opacity = ''; this.satirVurguyuTasi(); });
    contextMenu(this.editor, () => this.editorMenu());

    /* Minimapte bir yere tıklamak oraya götürür. */
    on(this.minimap, 'pointerdown', e => {
      const r = this.minimap.getBoundingClientRect();
      const oran = (e.clientY - r.top) / r.height;
      const toplam = this.ta.scrollHeight - this.ta.clientHeight;
      this.ta.scrollTop = clamp(oran * this.ta.scrollHeight - this.ta.clientHeight / 2, 0, toplam);
    });
  }

  /* ---- konsol ve sorunların durduğu alt panel ---- */
  kurAltPanel() {
    this.console = h('div.st-console');
    this.altSorun = h('div.ide-problems.k-scroll');
    this.altSorun.hidden = true;

    this.altSekme = (ad, kod) => h('button', { text: ad, dataset: { alt: kod },
      'aria-selected': String(kod === 'console'), onclick: () => this.altGoster(kod) });

    this.altPanel = h('div.ide-bottom',
      h('div.ide-bottom-bar',
        this.altSekme('Konsol', 'console'),
        this.altSorunSekme = this.altSekme('Sorunlar', 'problems'),
        h('div.k-spacer'),
        h('button.ide-side-btn', { html: icon('trash', 13), title: 'Konsolu temizle',
          onclick: () => clear(this.console) }),
        h('button.ide-side-btn', { html: icon('chevronD', 13), title: 'Paneli gizle',
          onclick: () => this.altPaneliDondur() })),
      this.console, this.altSorun);
  }

  altGoster(kod) {
    this.altPanel.classList.remove('kapali');
    this.altPanel.querySelectorAll('.ide-bottom-bar button[data-alt]').forEach(b =>
      b.setAttribute('aria-selected', String(b.dataset.alt === kod)));
    this.console.hidden = kod !== 'console';
    this.altSorun.hidden = kod !== 'problems';
    if (kod === 'problems') this.renderProblems();
  }

  altPaneliDondur() { this.altPanel.classList.toggle('kapali'); }

  /* ---- sağdaki canlı önizleme ---- */
  kurOnizleme() {
    this.previewHost = h('div.st-preview-host');
    this.preview = h('div.st-preview', this.previewHost);
    this.docs = h('div.st-docs.k-scroll');
    this.docs.hidden = true;

    this.rail = h('div.st-right',
      h('div.st-tabbar',
        this.tabBtn('Önizleme', 'preview', true),
        this.tabBtn('Belgeler', 'docs'),
        h('div.k-spacer'),
        h('button.ide-side-btn', { html: icon('refresh', 13), title: 'Yeniden çalıştır',
          onclick: () => this.run() })),
      this.preview, this.docs);
  }

  /* ---- üst araç çubuğu ---- */
  kurAracCubugu() {
    this.calisBtn = h('button.k-btn.v-primary.s-sm', { html: icon('play', 13), text: ' Çalıştır',
      title: 'Çalıştır (⌘↩)', onclick: () => this.run() });
    this.fileLabel = h('div.k-text.t-caption.ellipsis', { style: { flex: 1, textAlign: 'center' } });

    this.toolbar = h('div.toolbar.ide-toolbar',
      this.calisBtn,
      h('button.k-btn.v-ghost.icon.s-sm', { html: icon('save', 14), title: 'Kaydet (⌘S)',
        onclick: () => this.save() }),
      h('div.tb-sep'),
      h('button.k-btn.s-sm', { html: icon('package', 13), text: ' Paketle',
        title: 'Uygulama paketi oluştur', onclick: () => this.paketle() }),
      h('button.k-btn.s-sm', { html: icon('upload', 13), text: ' Yayınla', onclick: () => this.publish() }),
      this.fileLabel,
      h('button.k-btn.v-ghost.s-sm', { html: icon('sparkles', 13), text: ' Örnekler',
        onclick: e => this.exampleMenu(e) }),
      h('button.k-btn.v-ghost.icon.s-sm', { html: icon('search', 14), title: 'Bul (⌘F)',
        onclick: () => this.openFind() }));
  }

  /* ------------------------------------------------ düzenleyici süsleri */
  get satirYuksekligi() {
    if (!this._sy) this._sy = parseFloat(getComputedStyle(this.ta).lineHeight) || 19.4;
    return this._sy;
  }

  /** İmlecin bulunduğu satırı vurgular. */
  satirVurguyuTasi() {
    const oncesi = this.ta.value.slice(0, this.ta.selectionStart);
    const satir = oncesi.split('\n').length - 1;
    this.satirVurgu.style.transform =
      `translateY(${satir * this.satirYuksekligi - this.ta.scrollTop}px)`;
    this.satirVurgu.style.height = this.satirYuksekligi + 'px';
  }

  /** Minimap: her satır, girintisi ve uzunluğu kadar bir çizgi. */
  minimapCiz() {
    const c = this.minimap, ctx = c.getContext('2d');
    const satirlar = this.ta.value.split('\n');
    const olcek = 2;                      /* satır başına piksel */
    c.height = Math.max(1, Math.min(satirlar.length * olcek, 4000));
    ctx.clearRect(0, 0, c.width, c.height);
    const koyu = settings.isDark;
    satirlar.forEach((l, i) => {
      const bosluk = l.length - l.trimStart().length;
      const uzunluk = Math.min(l.trimEnd().length, 74 - Math.min(bosluk, 20));
      if (uzunluk <= 0) return;
      ctx.fillStyle = /^\s*#/.test(l) ? (koyu ? '#4d5a46' : '#c9d6c2')
                    : /^\s*(app|view|fn|state)\b/.test(l.trim()) ? (koyu ? '#8f7ce8' : '#9b8cf0')
                    : (koyu ? '#5a6070' : '#c3c7d2');
      ctx.fillRect(Math.min(bosluk, 20), i * olcek, uzunluk, 1);
    });
    this.minimapGorusuTasi();
  }

  minimapGorusuTasi() {
    const toplam = this.ta.scrollHeight || 1;
    const g = this.minimapGorus.style;
    const h0 = (this.ta.clientHeight / toplam) * 100;
    g.height = Math.min(100, h0) + '%';
    g.top = (this.ta.scrollTop / toplam) * 100 + '%';
  }

  /** Dosya › simge yolu. Uzun dosyada nerede olduğunu tek bakışta söyler. */
  ekmekCiz() {
    clear(this.ekmek);
    const t = this.active;
    if (!t) return;
    const parcalar = (t.path || t.name).replace(vfs.home, '~').split('/').filter(Boolean);
    parcalar.forEach((p, i) => {
      if (i) this.ekmek.appendChild(h('span.sep', { html: icon('chevronR', 9) }));
      this.ekmek.appendChild(h('span', { text: p, class: i === parcalar.length - 1 ? 'son' : '' }));
    });
    /* İmlecin içinde bulunduğu en yakın üst simge. */
    const simge = this.kapsayanSimge();
    if (simge) {
      this.ekmek.appendChild(h('span.sep', { html: icon('chevronR', 9) }));
      this.ekmek.appendChild(h('span.simge', { html: icon(simge.g, 11) }));
      this.ekmek.appendChild(h('span.son', { text: simge.n }));
    }
  }

  kapsayanSimge() {
    const satir = this.ta.value.slice(0, this.ta.selectionStart).split('\n').length;
    const src = this.ta.value.split('\n');
    for (let i = satir - 1; i >= 0; i--) {
      const l = src[i] || '';
      if (/^\s*app\s*\{/.test(l)) return { n: 'app', g: 'package' };
      if (/^\s*view\s*\{/.test(l)) return { n: 'view', g: 'window' };
      const f = l.match(/^\s*fn\s+(\w+)/);
      if (f) return { n: f[1] + '()', g: 'code' };
    }
    return null;
  }

  /* -------------------------------------------------- projede arama */
  projedeAra() {
    clear(this.aramaSonuc);
    const q = this.aramaAlani.value.trim();
    if (q.length < 2) {
      this.aramaSonuc.appendChild(h('div.ide-tree-empty',
        { text: q ? 'en az iki karakter' : 'aramak için yazın' }));
      return;
    }
    const kokler = [VFS.join(vfs.home, 'Projeler'), '/Applications'];
    const kucuk = q.toLowerCase();
    let dosyaSayisi = 0, eslesmeSayisi = 0;

    /* Alt klasörlere de inilir: paketlerin (.osapp) içindeki kaynak da
       projenin parçası ve aranabilir olmalı. */
    const metinDosyalari = kok => {
      const bulunan = [];
      const gez = (yol, derinlik) => {
        if (derinlik > 3) return;
        let ogeler = [];
        try { ogeler = vfs.list(yol); } catch { return; }
        for (const o of ogeler) {
          if (o.name.startsWith('.')) continue;
          if (o.type === 'dir') gez(o.path, derinlik + 1);
          else if (['osh', 'json', 'md', 'txt'].includes(o.ext)) bulunan.push(o);
        }
      };
      gez(kok, 0);
      return bulunan;
    };

    for (const kok of kokler) {
      if (!vfs.exists(kok)) continue;
      const dosyalar = metinDosyalari(kok);
      for (const f of dosyalar) {
        let metin;
        try { metin = vfs.read(f.path); } catch { continue; }
        const satirlar = metin.split('\n');
        const vurus = [];
        satirlar.forEach((l, i) => {
          if (l.toLowerCase().includes(kucuk)) vurus.push({ no: i + 1, metin: l.trim().slice(0, 90) });
        });
        if (!vurus.length) continue;
        dosyaSayisi++; eslesmeSayisi += vurus.length;

        const grup = h('div.ide-search-file');
        grup.appendChild(h('div.ide-search-head',
          { onclick: () => grup.classList.toggle('kapali') },
          h('span.g', { html: icon('fileCode', 12) }),
          h('span.ellipsis', { text: f.name }),
          h('span.yer', { text: VFS.basename(VFS.dirname(f.path)) }),
          h('span.sayi', { text: String(vurus.length) })));
        vurus.slice(0, 40).forEach(v => grup.appendChild(h('div.ide-search-hit',
          { onclick: () => { this.openFile(f.path); setTimeout(() => this.jumpTo(v.no), 60); } },
          h('span.ln', { text: String(v.no) }),
          h('span.ellipsis', { html: this.vurgula(v.metin, q) }))));
        this.aramaSonuc.appendChild(grup);
      }
    }
    if (!dosyaSayisi) {
      this.aramaSonuc.appendChild(h('div.ide-tree-empty', { text: 'eşleşme yok' }));
    } else {
      this.aramaSonuc.prepend(h('div.ide-search-summary',
        { text: `${dosyaSayisi} dosyada ${eslesmeSayisi} eşleşme` }));
    }
  }

  vurgula(metin, q) {
    const kacis = escapeHtml(metin);
    const i = kacis.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return kacis;
    return kacis.slice(0, i) + '<mark>' + kacis.slice(i, i + q.length) + '</mark>' + kacis.slice(i + q.length);
  }

  tabBtn(label, key, on0) {
    const b = h('button', { text: label, dataset: { pane: key }, 'aria-selected': String(!!on0),
      onclick: () => this.showPane(key) });
    return b;
  }
  showPane(which) {
    this.rail.querySelectorAll('.st-tabbar button[data-pane]').forEach(b =>
      b.setAttribute('aria-selected', String(b.dataset.pane === which)));
    this.preview.hidden = which !== 'preview';
    this.docs.hidden = which !== 'docs';
    if (which === 'docs' && !this.docs.childElementCount) this.renderDocs();
  }

  setupSplit() {
    /* Alt panelin yüksekliği: tutamağı sürükleyince değişir. */
    const yatay = this.el.querySelector('.ide-hdrag');
    on(yatay, 'pointerdown', e => {
      e.preventDefault();
      const bas = e.clientY;
      const ilk = this.altPanel.offsetHeight;
      const tasi = ev => {
        const y = clamp(ilk - (ev.clientY - bas), 34, this.merkez.offsetHeight - 120);
        this.altPanel.style.height = y + 'px';
        this.altPanel.classList.toggle('kapali', y <= 36);
      };
      const birak = () => {
        window.removeEventListener('pointermove', tasi);
        window.removeEventListener('pointerup', birak);
      };
      window.addEventListener('pointermove', tasi);
      window.addEventListener('pointerup', birak);
    });

    const bar = this.el.querySelector('.st-drag');
    on(bar, 'pointerdown', e => {
      e.preventDefault();
      const split = this.el.querySelector('.st-split');
      const move = ev => {
        const r = split.getBoundingClientRect();
        const pct = clamp(((ev.clientX - r.left) / r.width) * 100, 24, 82);
        split.style.gridTemplateColumns = `${pct}% 5px 1fr`;
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
  }

  menus() {
    return [
      { title: 'Dosya', items: () => [
        { label: 'Yeni Dosya', key: '⌘N', glyph: 'plus', run: () => this.newFile() },
        { label: 'Aç…', glyph: 'folder', run: e => this.openMenu(e) },
        '-',
        { label: 'Kaydet', key: '⌘S', glyph: 'save', run: () => this.save() },
        { label: 'Farklı Kaydet…', key: '⇧⌘S', glyph: 'save', run: () => this.saveAs() },
        { label: 'Sekmeyi Kapat', key: '⌘W', glyph: 'x', run: () => this.closeTab(this.active) },
        '-',
        { label: 'Paketle ve Kur…', glyph: 'package', run: () => this.paketle() },
        { label: 'Tek dosya olarak kur', glyph: 'filePlus', run: () => this.install() },
        { label: 'Mağazada yayınla', glyph: 'upload', run: () => this.publish() },
      ] },
      { title: 'Düzen', items: () => [
        { label: 'Bul ve Değiştir', key: '⌘F', glyph: 'search', run: () => this.openFind() },
        { label: 'Satıra Git', key: '⌃G', glyph: 'arrowR', run: () => this.gotoLine() },
        '-',
        { label: 'Girintiyi Düzenle', glyph: 'list', run: () => this.format() },
        { label: 'Satırı Çoğalt', key: '⇧⌘D', run: () => this.duplicateLine() },
        { label: 'Yorum Aç/Kapat', key: '⌘/', run: () => this.toggleComment() },
      ] },
      { title: 'Görünüm', items: () => [
        { label: 'Gezgin', key: '⇧⌘E', glyph: 'files', run: () => this.paneliGoster('explorer') },
        { label: 'Projede Ara', key: '⇧⌘F', glyph: 'search', run: () => this.paneliGoster('search') },
        { label: 'Sorunlar', key: '⇧⌘M', glyph: 'alert', run: () => this.altGoster('problems') },
        { label: 'Paket', glyph: 'package', run: () => this.paneliGoster('package') },
        '-',
        { label: 'Kenar Çubuğu', key: '⌘B', glyph: 'layers', run: () => this.sidebar.classList.toggle('gizli') },
        { label: 'Alt Panel', key: '⌘J', glyph: 'terminal', run: () => this.altPaneliDondur() },
      ] },
      { title: 'Çalıştır', items: () => [
        { label: 'Çalıştır', key: '⌘↩', glyph: 'play', run: () => this.run() },
        { label: 'Konsolu temizle', glyph: 'trash', run: () => clear(this.console) },
        { label: 'Sorunları göster', glyph: 'alert', run: () => this.altGoster('problems') },
      ] },
      { title: 'Yardım', items: () => [
        { label: 'OpenSharp kılavuzu', glyph: 'question', run: () => this.showPane('docs') },
        { label: 'Komut paleti', key: '⌘K', glyph: 'bolt', run: () => this.palette() },
      ] },
    ];
  }

  /* ============================ tabs ============================ */
  openScratch() { this.openTab({ path: null, name: 'başlangıç.osh', text: EXAMPLES['Sayaç.osh'] }); }

  openFile(path) {
    const existing = this.tabs.find(t => t.path === path);
    if (existing) return this.selectTab(existing);
    this.openTab({ path, name: VFS.basename(path), text: vfs.read(path) });
  }

  openTab(tab) {
    tab.dirty = false;
    tab.sel = tab.sel || 0;
    this.tabs.push(tab);
    this.selectTab(tab);
    this.renderTabs();
  }

  selectTab(tab) {
    if (this.active) { this.active.text = this.ta.value; this.active.sel = this.ta.selectionStart; }
    this.active = tab;
    this.ta.value = tab.text;
    this.ta.selectionStart = this.ta.selectionEnd = tab.sel || 0;
    this.fileLabel.textContent = tab.path || 'kaydedilmemiş';
    this.ctx.setTitle(tab.name + (tab.dirty ? ' •' : ''));
    this.paint();
    this.renderTabs();
    this.renderOutline();
    this.ekmekCiz();
    this.run();
  }

  closeTab(tab) {
    if (!tab) return;
    const i = this.tabs.indexOf(tab);
    if (tab.dirty && tab.path) vfs.write(tab.path, tab.text);
    this.tabs.splice(i, 1);
    if (!this.tabs.length) { this.openScratch(); return; }
    if (this.active === tab) this.selectTab(this.tabs[Math.min(i, this.tabs.length - 1)]);
    this.renderTabs();
  }

  renderTabs() {
    clear(this.tabstrip);
    this.tabs.forEach(t => {
      const el = h('div.ide-tab', { class: t === this.active ? 'on' : '', onclick: () => this.selectTab(t) },
        h('span.g', { html: icon('fileCode', 12) }),
        h('span.n', { text: t.name }),
        t.dirty ? h('span.dot') : null,
        h('button.ob-close', { html: icon('x', 11), onclick: e => { e.stopPropagation(); this.closeTab(t); } }));
      contextMenu(el, () => [
        { label: 'Kaydet', run: () => { this.selectTab(t); this.save(); } },
        { label: 'Kapat', run: () => this.closeTab(t) },
        { label: 'Diğerlerini kapat', run: () => this.tabs.filter(x => x !== t).slice().forEach(x => this.closeTab(x)) },
        ...(t.path ? ['-', { label: 'Finder’da göster', run: () => this.ctx.openApp('finder', { path: VFS.dirname(t.path) }) }] : []),
      ]);
      this.tabstrip.appendChild(el);
    });
  }

  /* ========================== explorer ========================== */
  renderExplorer() {
    clear(this.explorer);
    const roots = [
      ['Projeler', VFS.join(vfs.home, 'Projeler')],
      ['Uygulamalar', '/Applications'],
    ];
    for (const [label, dir] of roots) {
      if (!vfs.exists(dir)) continue;
      this.explorer.appendChild(h('div.ide-tree-root', { text: label }));
      let files = [];
      try { files = vfs.list(dir); } catch {}
      if (!files.length) this.explorer.appendChild(h('div.ide-tree-empty', { text: 'boş' }));
      files.forEach(f => {
        const row = h('div.ide-tree-item', {
          class: this.active?.path === f.path ? 'on' : '',
          onclick: () => f.type === 'dir' ? this.ctx.openApp('finder', { path: f.path }) : this.openFile(f.path),
        }, h('span.g', { html: icon(f.type === 'dir' ? 'folder' : (f.ext === 'osh' ? 'fileCode' : 'file'), 13) }),
           h('span.ellipsis', { text: f.name }));
        contextMenu(row, () => [
          { label: 'Aç', run: () => this.openFile(f.path) },
          { label: 'Çoğalt', run: () => { vfs.copy(f.path, vfs.unique(f.path)); this.renderExplorer(); } },
          { label: 'Yeniden adlandır', run: async () => {
            const n = await notify.prompt('Yeni ad:', { value: f.name, title: 'Yeniden adlandır' });
            if (n) { vfs.move(f.path, VFS.join(VFS.dirname(f.path), n)); this.renderExplorer(); } } },
          '-',
          { label: 'Sil', danger: true, run: async () => {
            if (await notify.confirm(`${f.name} silinsin mi?`, { title: 'Sil', danger: true, ok: 'Sil' })) {
              this.ctx.os.trash(f.path); this.renderExplorer();
            } } },
        ]);
        this.explorer.appendChild(row);
      });
    }
  }

  renderOutline() {
    clear(this.outline);
    const src = this.ta.value;
    const syms = [];
    src.split('\n').forEach((line, i) => {
      let m;
      if ((m = line.match(/^\s*app\s*\{/))) syms.push({ k: 'app', n: 'app', line: i + 1, g: 'package' });
      else if ((m = line.match(/^\s*view\s*\{/))) syms.push({ k: 'view', n: 'view', line: i + 1, g: 'window' });
      else if ((m = line.match(/^\s*fn\s+(\w+)/))) syms.push({ k: 'fn', n: m[1] + '()', line: i + 1, g: 'code' });
      else if ((m = line.match(/^\s*state\s+(\w+)/))) syms.push({ k: 'state', n: m[1], line: i + 1, g: 'bolt' });
      else if ((m = line.match(/^\s*(?:let|const)\s+(\w+)/))) syms.push({ k: 'let', n: m[1], line: i + 1, g: 'file' });
    });
    if (!syms.length) { this.outline.appendChild(h('div.ide-tree-empty', { text: 'simge yok' })); return; }
    syms.forEach(s => this.outline.appendChild(h('div.ide-tree-item', {
      onclick: () => this.jumpTo(s.line),
    }, h('span.g', { html: icon(s.g, 12) }), h('span.ellipsis', { text: s.n }),
       h('span.ln', { text: String(s.line) }))));
  }

  /* =========================== editing =========================== */
  onInput() {
    const t = this.active;
    if (t) { t.text = this.ta.value; if (!t.dirty) { t.dirty = true; this.renderTabs(); this.ctx.setTitle(t.name + ' •'); } }
    this.paint();
    this.updateStatus();
    this.checkSyntax();
    this.maybeComplete();
    this.scheduleRun();
    this.scheduleOutline();
  }
  scheduleOutline = debounce(() => this.renderOutline(), 500);
  scheduleRun = debounce(() => this.run(), 600);

  editorKeys(e) {
    const ta = this.ta;
    const mod = e.metaKey || e.ctrlKey;

    if (this.completeOpen) {
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'Escape') return this.hideComplete();
        if (e.key === 'ArrowDown') return this.moveComplete(1);
        if (e.key === 'ArrowUp') return this.moveComplete(-1);
        return this.acceptComplete();
      }
    }

    /* Panel kısayolları — VS Code'daki karşılıklarıyla aynı tuşlar. */
    if (mod && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); return this.paneliGoster('explorer'); }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); return this.paneliGoster('search'); }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); return this.altGoster('problems'); }
    if (mod && e.key === 'b') { e.preventDefault(); return this.sidebar.classList.toggle('gizli'); }
    if (mod && e.key === 'j') { e.preventDefault(); return this.altPaneliDondur(); }

    if (mod && e.key === 's') { e.preventDefault(); return this.save(); }
    if (mod && e.key === 'Enter') { e.preventDefault(); return this.run(); }
    if (mod && e.key === 'k') { e.preventDefault(); return this.palette(); }
    if (mod && e.key === 'f') { e.preventDefault(); return this.openFind(); }
    if (mod && e.key === 'n') { e.preventDefault(); return this.newFile(); }
    if (mod && e.key === '/') { e.preventDefault(); return this.toggleComment(); }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); return this.duplicateLine(); }
    if (e.ctrlKey && e.key === ' ') { e.preventDefault(); return this.maybeComplete(true); }

    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      if (s !== en) return this.indentSelection(e.shiftKey ? -1 : 1);
      this.insert('  ');
      return;
    }

    /* auto-close pairs */
    const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
    if (pairs[e.key] && ta.selectionStart === ta.selectionEnd) {
      const next = ta.value[ta.selectionStart] || '';
      if (!/[\w"']/.test(next) || e.key === '{' || e.key === '(') {
        e.preventDefault();
        const s = ta.selectionStart;
        ta.value = ta.value.slice(0, s) + e.key + pairs[e.key] + ta.value.slice(s);
        ta.selectionStart = ta.selectionEnd = s + 1;
        this.onInput();
        return;
      }
    }
    if ([')', ']', '}', '"', "'"].includes(e.key) && ta.value[ta.selectionStart] === e.key) {
      e.preventDefault(); ta.selectionStart = ta.selectionEnd = ta.selectionStart + 1; return;
    }

    if (e.key === 'Enter') {
      const s = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
      const line = ta.value.slice(lineStart, s);
      const indent = (line.match(/^\s*/) || [''])[0];
      const opens = /[{[(]\s*$/.test(line);
      const closesNext = /^\s*[}\])]/.test(ta.value.slice(s));
      e.preventDefault();
      if (opens && closesNext) {
        const body = '\n' + indent + '  ';
        const tail = '\n' + indent;
        ta.value = ta.value.slice(0, s) + body + tail + ta.value.slice(ta.selectionEnd);
        ta.selectionStart = ta.selectionEnd = s + body.length;
      } else {
        const ins = '\n' + indent + (opens ? '  ' : '');
        ta.value = ta.value.slice(0, s) + ins + ta.value.slice(ta.selectionEnd);
        ta.selectionStart = ta.selectionEnd = s + ins.length;
      }
      this.onInput();
      return;
    }

    if (e.key === 'Backspace' && ta.selectionStart === ta.selectionEnd) {
      const s = ta.selectionStart;
      const before = ta.value.slice(s - 1, s), after = ta.value.slice(s, s + 1);
      if (pairs[before] === after) {
        e.preventDefault();
        ta.value = ta.value.slice(0, s - 1) + ta.value.slice(s + 1);
        ta.selectionStart = ta.selectionEnd = s - 1;
        this.onInput();
      }
    }
  }

  insert(text) {
    const ta = this.ta, s = ta.selectionStart;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(ta.selectionEnd);
    ta.selectionStart = ta.selectionEnd = s + text.length;
    this.onInput();
  }

  indentSelection(dir) {
    const ta = this.ta;
    const s = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    const e = ta.selectionEnd;
    const block = ta.value.slice(s, e);
    const out = block.split('\n').map(l => dir > 0 ? '  ' + l : l.replace(/^ {1,2}/, '')).join('\n');
    ta.value = ta.value.slice(0, s) + out + ta.value.slice(e);
    ta.selectionStart = s; ta.selectionEnd = s + out.length;
    this.onInput();
  }

  toggleComment() {
    const ta = this.ta;
    const s = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    const e = Math.max(ta.selectionEnd, ta.selectionStart);
    const endLine = ta.value.indexOf('\n', e) === -1 ? ta.value.length : ta.value.indexOf('\n', e);
    const block = ta.value.slice(s, endLine);
    const allCommented = block.split('\n').every(l => !l.trim() || /^\s*#/.test(l));
    const out = block.split('\n').map(l => allCommented ? l.replace(/^(\s*)#\s?/, '$1') : (l.trim() ? l.replace(/^(\s*)/, '$1# ') : l)).join('\n');
    ta.value = ta.value.slice(0, s) + out + ta.value.slice(endLine);
    ta.selectionStart = s; ta.selectionEnd = s + out.length;
    this.onInput();
  }

  duplicateLine() {
    const ta = this.ta, s = ta.selectionStart;
    const start = ta.value.lastIndexOf('\n', s - 1) + 1;
    let end = ta.value.indexOf('\n', s);
    if (end === -1) end = ta.value.length;
    const line = ta.value.slice(start, end);
    ta.value = ta.value.slice(0, end) + '\n' + line + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = end + 1 + line.length;
    this.onInput();
  }

  format() {
    const lines = this.ta.value.split('\n');
    let depth = 0;
    const out = lines.map(raw => {
      const l = raw.trim();
      if (!l) return '';
      if (/^[}\])]/.test(l)) depth = Math.max(0, depth - 1);
      const res = '  '.repeat(depth) + l;
      const opens = (l.match(/[{[(]/g) || []).length;
      const closes = (l.match(/[}\])]/g) || []).length;
      depth += Math.max(0, opens - closes - (/^[}\])]/.test(l) ? 0 : 0));
      return res;
    });
    this.ta.value = out.join('\n');
    this.onInput();
    notify.toast('Girintiler düzenlendi', { glyph: '🧹' });
  }

  jumpTo(line) {
    const lines = this.ta.value.split('\n');
    let pos = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    this.ta.focus();
    this.ta.selectionStart = this.ta.selectionEnd = pos;
    const lh = 19.4;
    this.ta.scrollTop = Math.max(0, (line - 6) * lh);
    this.updateStatus();
  }

  async gotoLine() {
    const n = await notify.prompt('Satır numarası:', { title: 'Satıra Git', value: '1' });
    if (n) this.jumpTo(parseInt(n, 10) || 1);
  }

  /* ========================= completion ========================= */
  wordBefore() {
    const s = this.ta.selectionStart;
    const upto = this.ta.value.slice(0, s);
    const m = upto.match(/[A-Za-z_$][\w$]*$/);
    return { word: m ? m[0] : '', start: m ? s - m[0].length : s, before: upto };
  }

  candidates(word, before) {
    const out = [];
    const push = (label, kind, detail, insert) => out.push({ label, kind, detail, insert: insert ?? label });
    const src = this.ta.value;

    /* named argument position → property hints */
    const inCall = /\(([^()]*)$/.test(before.slice(-160));
    if (inCall) PROP_HINTS.filter(p => p.startsWith(word)).forEach(p => push(p, 'prop', 'özellik', p + ': '));

    COMPONENT_NAMES.filter(c => c.toLowerCase().startsWith(word.toLowerCase()))
      .forEach(c => push(c, 'component', 'bileşen', c + '('));
    STDLIB_NAMES.filter(f => f.startsWith(word)).forEach(f => push(f, 'fn', 'stdlib', f + '('));
    [...KEYWORDS].filter(k => k.startsWith(word)).forEach(k => push(k, 'kw', 'anahtar sözcük'));

    /* symbols from this file */
    const local = new Set();
    src.replace(/\b(?:fn)\s+(\w+)/g, (_, n) => (local.add(n + '|fn'), ''));
    src.replace(/\b(?:state|let|const)\s+(\w+)/g, (_, n) => (local.add(n + '|var'), ''));
    [...local].forEach(entry => {
      const [n, k] = entry.split('|');
      if (n.startsWith(word) && n !== word) push(n, k === 'fn' ? 'local-fn' : 'local', k === 'fn' ? 'bu dosya' : 'değişken', k === 'fn' ? n + '(' : n);
    });

    SNIPPETS.filter(([k]) => k.startsWith(word)).forEach(([k, body, desc]) =>
      push(k, 'snippet', desc, body));

    const seen = new Set();
    return out.filter(c => (seen.has(c.label + c.kind) ? false : (seen.add(c.label + c.kind), true))).slice(0, 12);
  }

  maybeComplete(force) {
    const { word, before } = this.wordBefore();
    if (!force && word.length < 2) return this.hideComplete();
    const list = this.candidates(word, before);
    if (!list.length) return this.hideComplete();
    this.completions = list;
    this.completeIndex = 0;
    this.renderComplete();
  }

  renderComplete() {
    clear(this.complete);
    this.completions.forEach((c, i) => {
      this.complete.appendChild(h('div.ide-cmp', { class: i === this.completeIndex ? 'on' : '',
        onmousedown: e => { e.preventDefault(); this.completeIndex = i; this.acceptComplete(); } },
        h('span.k', { text: KIND_GLYPH[c.kind] || '•' }),
        h('span.l', { text: c.label }),
        h('span.d', { text: c.detail })));
    });
    const pos = this.caretCoords();
    this.complete.style.left = clamp(pos.x, 0, this.editor.clientWidth - 260) + 'px';
    this.complete.style.top = (pos.y + 20) + 'px';
    this.complete.classList.add('on');
    this.completeOpen = true;
  }

  moveComplete(d) {
    this.completeIndex = clamp(this.completeIndex + d, 0, this.completions.length - 1);
    this.renderComplete();
  }

  acceptComplete() {
    const c = this.completions[this.completeIndex];
    this.hideComplete();
    if (!c) return;
    const { start } = this.wordBefore();
    const ta = this.ta;
    let body = c.insert;
    const caretOffset = body.indexOf('$1');
    if (caretOffset >= 0) body = body.replace('$1', '');
    ta.value = ta.value.slice(0, start) + body + ta.value.slice(ta.selectionStart);
    const pos = start + (caretOffset >= 0 ? caretOffset : body.length);
    ta.selectionStart = ta.selectionEnd = pos;
    ta.focus();
    this.onInput();
  }

  hideComplete() { this.complete.classList.remove('on'); this.completeOpen = false; }

  /** Caret position in editor-local pixels, via a mirror element. */
  caretCoords() {
    const ta = this.ta;
    const upto = ta.value.slice(0, ta.selectionStart);
    const lines = upto.split('\n');
    const line = lines.length - 1;
    const col = lines[lines.length - 1].length;
    const charW = 7.22, lineH = 19.4;
    return { x: 14 + col * charW - ta.scrollLeft + 44, y: 12 + line * lineH - ta.scrollTop };
  }

  /* ========================== diagnostics ========================== */
  checkSyntax = debounce(() => {
    const src = this.ta.value;
    this.problems = [];
    try { parse(src); }
    catch (e) { this.problems.push({ line: e.line || 1, col: e.col || 1, message: e.message, severity: 'error' }); }
    /* light lint */
    src.split('\n').forEach((l, i) => {
      if (/\bprint\s*\(/.test(l) && !/#/.test(l.split('print')[0]))
        this.problems.push({ line: i + 1, message: 'print() yalnızca konsola yazar — kullanıcıya göstermek için toast() ya da notify()', severity: 'hint' });
    });
    this.paintProblems();
    this.updateStatus();
    const hata = this.problems.filter(p => p.severity === 'error').length;
    if (this.altSorunSekme) this.altSorunSekme.textContent = hata ? `Sorunlar (${hata})` : 'Sorunlar';
    const rozet = this.etkinlik?.querySelector('.ide-act[data-panel="problems"]');
    if (rozet) rozet.dataset.rozet = hata ? String(hata) : '';
    if (this.panel === 'problems' || !this.altSorun?.hidden) this.renderProblems();
  }, 320);

  paintProblems() {
    this.gutter.querySelectorAll('i.err').forEach(i => i.classList.remove('err'));
    this.problems.filter(p => p.severity === 'error').forEach(p => {
      const el = this.gutter.children[p.line - 1];
      if (el) el.classList.add('err');
    });
    if (this.problemsPane.style.display !== 'none') this.renderProblems();
  }

  renderProblems() {
    /* Aynı liste iki yerde görünür: yan paneldeki Sorunlar sekmesinde ve alt
       paneldekinde. İkisi de aynı kaynaktan çizilir. */
    for (const hedef of [this.problemsPane, this.altSorun]) {
      if (!hedef) continue;
      clear(hedef);
      if (!this.problems.length) {
        hedef.appendChild(h('div.k-empty',
          h('div.glyph', { html: icon('check', 26) }),
          h('div.k-text.t-callout', { text: 'Sorun yok' })));
        continue;
      }
      this.problems.forEach(p => hedef.appendChild(h('div.ide-problem', {
        class: p.severity, onclick: () => this.jumpTo(p.line) },
        h('span.g', { html: icon(p.severity === 'error' ? 'x' : 'info', 13) }),
        h('span.m', { text: p.message }),
        h('span.l', { text: 'satır ' + p.line }))));
    }
  }

  updateStatus() {
    const ta = this.ta;
    const upto = ta.value.slice(0, ta.selectionStart).split('\n');
    const sec = (ta.selectionEnd ?? 0) - (ta.selectionStart ?? 0);
    const hata = this.problems.filter(p => p.severity === 'error').length;
    const uyari = this.problems.filter(p => p.severity !== 'error').length;

    clear(this.status);
    const oge = (metin, sinif, glyph, calistir) => h('span.ide-st' + (sinif ? '.' + sinif : ''),
      { onclick: calistir || null, class: calistir ? 'tiklanir' : '' },
      ...(glyph ? [h('span.g', { html: icon(glyph, 11) })] : []),
      h('span', { text: metin }));

    this.status.append(...[
      oge(this.active?.path ? this.active.path.replace(vfs.home, '~') : 'kaydedilmemiş', '', 'fileCode'),
      this.active?.dirty ? oge('değiştirildi', 'dirty') : null,
      h('span.k-spacer'),
      hata || uyari
        ? oge(`${hata} hata · ${uyari} uyarı`, hata ? 'err' : 'warn', 'alert', () => this.altGoster('problems'))
        : oge('sorun yok', 'ok', 'check', () => this.altGoster('problems')),
      oge(`Satır ${upto.length}, Sütun ${upto[upto.length - 1].length + 1}` + (sec ? ` (${sec})` : ''),
          '', '', () => this.gotoLine()),
      oge(`${ta.value.split('\n').length} satır`),
      oge('2 boşluk'),
      oge('OpenSharp 1.0', '', 'code'),
    ].filter(Boolean));
  }

  /* ============================ find ============================ */
  openFind() {
    if (this.findBar) { this.findBar.querySelector('input').focus(); return; }
    const q = h('input', { placeholder: 'Bul' });
    const r = h('input', { placeholder: 'Değiştir' });
    const info = h('span.k-text.t-caption');
    const close = () => { this.findBar.remove(); this.findBar = null; this.ta.focus(); };
    const find = (from = this.ta.selectionEnd) => {
      const idx = this.ta.value.indexOf(q.value, from);
      const at = idx === -1 ? this.ta.value.indexOf(q.value) : idx;
      if (at === -1 || !q.value) { info.textContent = 'yok'; return; }
      this.ta.focus();
      this.ta.setSelectionRange(at, at + q.value.length);
      const line = this.ta.value.slice(0, at).split('\n').length;
      this.ta.scrollTop = Math.max(0, (line - 6) * 19.4);
      const total = this.ta.value.split(q.value).length - 1;
      info.textContent = `${total} eşleşme`;
    };
    this.findBar = h('div.ide-find',
      h('span', { html: icon('search', 13) }), q, r,
      h('button.k-btn.s-sm', { text: 'Bul', onclick: () => find() }),
      h('button.k-btn.s-sm', { text: 'Değiştir', onclick: () => {
        if (!q.value) return;
        const s = this.ta.selectionStart, e = this.ta.selectionEnd;
        if (this.ta.value.slice(s, e) === q.value) {
          this.ta.value = this.ta.value.slice(0, s) + r.value + this.ta.value.slice(e);
          this.onInput();
        }
        find();
      } }),
      h('button.k-btn.s-sm', { text: 'Tümü', onclick: () => {
        if (!q.value) return;
        const n = this.ta.value.split(q.value).length - 1;
        this.ta.value = this.ta.value.split(q.value).join(r.value);
        this.onInput();
        info.textContent = `${n} değiştirildi`;
      } }),
      info,
      h('button.ob-btn.small', { html: icon('x', 13), onclick: close }));
    this.el.appendChild(this.findBar);
    on(q, 'keydown', e => { if (e.key === 'Enter') find(); if (e.key === 'Escape') close(); });
    q.focus();
  }

  /* ======================= command palette ======================= */
  palette() {
    const commands = [
      ['Çalıştır', 'play', () => this.run()],
      ['Kaydet', 'save', () => this.save()],
      ['Farklı kaydet', 'save', () => this.saveAs()],
      ['Uygulama olarak kur', 'package', () => this.install()],
      ['Mağazada yayınla', 'upload', () => this.publish()],
      ['Yeni dosya', 'plus', () => this.newFile()],
      ['Bul ve değiştir', 'search', () => this.openFind()],
      ['Satıra git', 'arrowR', () => this.gotoLine()],
      ['Girintileri düzenle', 'list', () => this.format()],
      ['Yorum aç/kapat', 'note', () => this.toggleComment()],
      ['Konsolu temizle', 'trash', () => clear(this.console)],
      ['Sorunları göster', 'info', () => this.showPane('problems')],
      ['Belgeleri aç', 'question', () => this.showPane('docs')],
      ['Örnek: Sayaç', 'sparkles', () => this.openTab({ path: null, name: 'Sayaç.osh', text: EXAMPLES['Sayaç.osh'] })],
      ['Örnek: Yapılacaklar', 'sparkles', () => this.openTab({ path: null, name: 'Yapılacaklar.osh', text: EXAMPLES['Yapılacaklar.osh'] })],
      ...SNIPPETS.map(([k, body, desc]) => [`Parça: ${k} — ${desc}`, 'code', () => this.insert(body.replace('$1', ''))]),
    ];
    const input = h('input', { placeholder: 'Komut ara…' });
    const list = h('div.ide-pal-list');
    const box = h('div.ide-pal', h('div.ide-pal-in', h('span', { html: icon('bolt', 16) }), input), list);
    const scrim = h('div.k-scrim', { style: { alignItems: 'flex-start', paddingTop: '12%' } }, box);
    let sel = 0, view = commands;
    const paint = () => {
      const q = input.value.toLowerCase();
      view = commands.filter(c => c[0].toLowerCase().includes(q));
      clear(list);
      view.forEach((c, i) => list.appendChild(h('div.ide-pal-row', { class: i === sel ? 'on' : '',
        onclick: () => { scrim.remove(); c[2](); } },
        h('span.g', { html: icon(c[1], 14) }), h('span', { text: c[0] }))));
    };
    on(input, 'input', () => { sel = 0; paint(); });
    on(input, 'keydown', e => {
      if (e.key === 'Escape') scrim.remove();
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = clamp(sel + 1, 0, view.length - 1); paint(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); sel = clamp(sel - 1, 0, view.length - 1); paint(); }
      if (e.key === 'Enter') { e.preventDefault(); scrim.remove(); view[sel]?.[2](); }
    });
    on(scrim, 'pointerdown', e => { if (e.target === scrim) scrim.remove(); });
    paint();
    this.el.appendChild(scrim);
    input.focus();
  }

  editorMenu() {
    const sel = this.ta.value.slice(this.ta.selectionStart, this.ta.selectionEnd);
    return [
      { label: 'Çalıştır', glyph: 'play', key: '⌘↩', run: () => this.run() },
      { label: 'Kaydet', glyph: 'save', key: '⌘S', run: () => this.save() },
      '-',
      { label: 'Kes', disabled: !sel, run: () => { navigator.clipboard?.writeText(sel); this.insert(''); } },
      { label: 'Kopyala', disabled: !sel, run: () => navigator.clipboard?.writeText(sel) },
      { label: 'Yapıştır', run: async () => {
        try { this.insert(await navigator.clipboard.readText()); } catch { notify.toast('Pano erişimi yok'); } } },
      '-',
      { label: 'Yorum aç/kapat', key: '⌘/', run: () => this.toggleComment() },
      { label: 'Girintileri düzenle', run: () => this.format() },
      { label: 'Tamamlama', key: '⌃Space', run: () => this.maybeComplete(true) },
      '-',
      { label: 'Komut paleti', key: '⌘K', glyph: 'bolt', run: () => this.palette() },
    ];
  }

  /* ============================ files ============================ */
  newFile() {
    this.openTab({ path: null, name: 'yeni.osh', text: STARTER });
  }

  openMenu(e) {
    const dir = VFS.join(vfs.home, 'Projeler');
    let items = [];
    try { items = vfs.list(dir).filter(s => s.ext === 'osh'); } catch {}
    menu([
      { header: 'Projeler' },
      ...(items.length ? items.map(s => ({ label: s.name, glyph: 'fileCode', run: () => this.openFile(s.path) }))
                       : [{ label: 'Boş', disabled: true }]),
      '-',
      { label: 'Finder’da bul…', glyph: 'folder', run: () => this.ctx.openApp('finder', { path: dir }) },
    ], e?.clientX ? { x: e.clientX, y: e.clientY } : { anchor: this.el.querySelector('.toolbar') });
  }

  exampleMenu(e) {
    menu([
      { header: 'Örnek uygulamalar' },
      ...Object.keys(EXAMPLES).map(k => ({ label: k, glyph: 'sparkles',
        run: () => this.openTab({ path: null, name: k, text: EXAMPLES[k] }) })),
      '-',
      { header: 'Kod parçaları' },
      ...SNIPPETS.map(([k, body, desc]) => ({ label: `${k} — ${desc}`, glyph: 'code',
        run: () => this.insert(body.replace('$1', '')) })),
    ], { x: e.clientX, y: e.clientY });
  }

  async save() {
    const t = this.active;
    if (!t) return;
    if (!t.path) return this.saveAs();
    vfs.write(t.path, this.ta.value);
    t.text = this.ta.value; t.dirty = false;
    this.renderTabs(); this.renderExplorer();
    this.ctx.setTitle(t.name);
    notify.toast('Kaydedildi', { glyph: '💾' });
  }

  async saveAs() {
    const t = this.active;
    const name = await notify.prompt('Dosya adı:', { value: t?.name || 'uygulama.osh', title: 'Farklı Kaydet' });
    if (!name) return;
    const p = VFS.join(vfs.home, 'Projeler', name.endsWith('.osh') ? name : name + '.osh');
    vfs.write(p, this.ta.value);
    t.path = p; t.name = VFS.basename(p); t.dirty = false;
    this.fileLabel.textContent = p;
    this.renderTabs(); this.renderExplorer();
    this.ctx.setTitle(t.name);
    notify.toast('Kaydedildi', { glyph: '💾' });
  }

  /* ============================ paket ============================ */
  /**
   * Kaynağın `app { … }` başlığından manifest türetir. Kullanıcının panelde
   * elle yazdıkları kazanır: başlık yeniden okununca girdiği ad silinmesin.
   */
  manifestTahmini() {
    const src = this.ta.value;
    const basli = {};
    const m = src.match(/app\s*\{([\s\S]*?)\}/);
    if (m) {
      const re = /(\w+)\s*:\s*(".*?"|\[.*?\]|[-\d.]+|true|false)/g;
      let r;
      while ((r = re.exec(m[1]))) {
        let v = r[2];
        if (v.startsWith('"')) v = v.slice(1, -1);
        else if (v.startsWith('[')) { try { v = JSON.parse(v.replace(/'/g, '"')); } catch { v = undefined; } }
        else if (v === 'true' || v === 'false') v = v === 'true';
        else v = parseFloat(v);
        if (v !== undefined) basli[r[1]] = v;
      }
    }
    const ad = basli.name || (this.active?.name || 'Adsız').replace(/\.osh$/, '');
    return {
      name: ad,
      id: kimlikYap(ad),
      version: '1.0.0',
      icon: basli.icon || 'sparkles',
      tint: basli.tint || ['#5e5ce6', '#bf5af2'],
      width: basli.width || 480,
      height: basli.height || 420,
      author: settings.get('user.name') || '',
      about: basli.about || '',
      ...(this.manifest || {}),
    };
  }

  renderPaket() {
    this.manifest = this.manifestTahmini();
    clear(this.panelPaket);

    const alan = (anahtar, etiket, opts = {}) => {
      const f = textField({
        label: etiket, value: String(this.manifest[anahtar] ?? ''), clearable: false, ...opts,
        onInput: v => { this.manifest[anahtar] = opts.sayi ? Number(v) : v; this.paketDenetle(); },
      });
      f.dataset.alan = anahtar;
      return f;
    };

    /* Simge: paketin içine gömülen görsel ya da yerleşik glif. */
    this.simgeOnizleme = h('div.ide-pkg-icon');
    this.simgeCiz();

    const simgeSec = h('div.ide-pkg-iconrow',
      this.simgeOnizleme,
      h('div.k-vstack', { style: { gap: '6px', flex: '1' } },
        h('button.k-btn.s-sm.full', { html: icon('image', 13), text: ' Görsel seç…',
          onclick: () => this.simgeSec() }),
        h('button.k-btn.v-ghost.s-sm.full', { html: icon('sparkles', 13), text: ' Yerleşik simge',
          onclick: e => this.glifSec(e) }),
        this.manifest.iconData
          ? h('button.k-btn.v-plain.s-sm.full', { text: 'Görseli kaldır',
              onclick: () => { this.manifest.iconData = null; this.renderPaket(); } })
          : null));

    this.paketSorunlar = h('div.ide-pkg-issues');

    this.panelPaket.append(
      h('div.ide-pkg-sec', { text: 'KİMLİK' }),
      alan('name', 'Uygulama adı'),
      alan('id', 'Paket kimliği', { help: 'Sistemde benzersiz olmalı.' }),
      alan('version', 'Sürüm'),
      alan('author', 'Yazar'),
      h('div.ide-pkg-sec', { text: 'SİMGE' }),
      simgeSec,
      h('div.ide-pkg-sec', { text: 'PENCERE' }),
      h('div.k-hstack', { style: { gap: '8px' } },
        alan('width', 'Genişlik', { type: 'number', sayi: true }),
        alan('height', 'Yükseklik', { type: 'number', sayi: true })),
      h('div.ide-pkg-sec', { text: 'AÇIKLAMA' }),
      alan('about', '', { multiline: true, autogrow: true, rows: 3,
                          placeholder: 'Uygulama ne yapıyor?' }),
      this.paketSorunlar,
      h('div.ide-pkg-actions',
        h('button.k-btn.v-primary.s-lg.full', { html: icon('package', 14), text: ' Paketle ve Kur',
          onclick: () => this.paketle() }),
        h('button.k-btn.v-ghost.s-sm.full', { html: icon('folder', 13), text: ' Paketi Finder’da göster',
          disabled: !this.sonPaket, onclick: () => this.ctx.openApp('finder', { path: this.sonPaket }) })),
    );
    this.paketDenetle();
  }

  simgeCiz() {
    clear(this.simgeOnizleme);
    if (this.manifest.iconData) {
      this.simgeOnizleme.appendChild(h('img', { src: this.manifest.iconData,
        style: { width: '100%', height: '100%', objectFit: 'contain', borderRadius: '14px' } }));
    } else {
      const [a, b] = this.manifest.tint || ['#5e5ce6', '#bf5af2'];
      this.simgeOnizleme.style.background = `linear-gradient(160deg, ${a}, ${b})`;
      this.simgeOnizleme.innerHTML = icon(hasIcon(this.manifest.icon) ? this.manifest.icon : 'sparkles', 30, 1.7);
    }
  }

  /** Dosya sisteminden bir görsel seçtirip pakete gömer. */
  async simgeSec() {
    const yol = await this.ctx.openFile({
      title: 'Uygulama simgesi seç',
      path: VFS.join(vfs.home, 'Resimler'),
      filters: [{ ad: 'Görseller', uzantilar: ['png', 'webp', 'jpg', 'jpeg', 'svg'] }],
    });
    if (!yol) return;
    let veri;
    try { veri = vfs.read(yol); } catch { notify.toast('Görsel okunamadı', { glyph: '⚠️' }); return; }
    if (!/^data:image\//.test(veri)) {
      /* SVG metni de kabul edilir; veri URL'ine çevrilir. */
      if (/^\s*<svg/i.test(veri)) veri = 'data:image/svg+xml;utf8,' + encodeURIComponent(veri);
      else { notify.toast('Bu dosya görsel değil', { glyph: '⚠️' }); return; }
    }
    this.manifest.iconData = veri;
    this.renderPaket();
  }

  glifSec(e) {
    const adaylar = ['sparkles', 'code', 'package', 'bolt', 'grid', 'clock', 'calendar', 'music',
      'image', 'globe', 'terminal', 'calculator', 'heart', 'star', 'flag', 'camera'];
    menu(adaylar.filter(hasIcon).map(g => ({
      label: g, glyph: g, run: () => { this.manifest.icon = g; this.manifest.iconData = null; this.renderPaket(); },
    })), { anchor: e?.currentTarget });
  }

  paketDenetle() {
    if (!this.paketSorunlar) return;
    const sorunlar = manifestiDenetle(this.manifest);
    clear(this.paketSorunlar);
    this.panelPaket.querySelectorAll('.k-textfield').forEach(f => f.setError?.(null));
    sorunlar.forEach(s0 => {
      const f = this.panelPaket.querySelector(`.k-textfield[data-alan="${s0.alan}"]`);
      if (f?.setError) f.setError(s0.ileti);
      else this.paketSorunlar.appendChild(h('div.ide-pkg-issue', { text: s0.ileti }));
    });
    const btn = this.panelPaket.querySelector('.ide-pkg-actions .v-primary');
    if (btn) btn.disabled = sorunlar.length > 0;
    return sorunlar;
  }

  /**
   * Paketi derler: manifest + kaynak + simge dosya sistemine yazılır,
   * ardından uygulama kaydedilip Dock'a iliştirilir.
   */
  async paketle() {
    if (this.panel !== 'package') { this.paneliGoster('package'); return; }
    const sorunlar = this.paketDenetle();
    if (sorunlar.length) {
      notify.toast('Paket bilgilerinde eksik var', { glyph: '⚠️' });
      return;
    }
    /* Kaynağı önce kaydet — pakete yazılan ile düzenleyicideki aynı olsun. */
    if (this.active?.dirty && this.active.path) { vfs.write(this.active.path, this.ta.value); this.active.dirty = false; }

    const m = this.manifest;
    const dizin = VFS.join('/Applications', `${m.name}.${PAKET_UZANTISI}`);
    const eski = paketOku(dizin);
    if (eski && eski.manifest.id !== m.id) {
      const ok = await notify.confirm(
        `“${m.name}” adında başka kimlikte bir paket var (${eski.manifest.id}). Üzerine yazılsın mı?`,
        { title: 'Paketin üzerine yaz', ok: 'Üzerine Yaz', danger: true, root: this.el });
      if (!ok) return;
    }

    try {
      paketYaz({
        dizin,
        kaynak: this.ta.value,
        simge: m.iconData || null,
        benioku: m.about ? `# ${m.name}\n\n${m.about}\n` : null,
        manifest: {
          id: m.id, name: m.name, version: m.version, author: m.author,
          icon: m.icon, tint: m.tint, width: Number(m.width), height: Number(m.height),
          about: m.about, osSurumu: this.ctx.version,
        },
      });
    } catch (e) {
      notify.toast('Paket yazılamadı: ' + e.message, { glyph: '⚠️' });
      return;
    }

    this.sonPaket = dizin;
    const app = this.ctx.os.installApp(dizin);
    const pinned = settings.get('pinned');
    if (!pinned.includes(app.id)) settings.set('pinned', [...pinned, app.id]);

    notify.post({ title: 'Paket kuruldu', body: `${m.name} ${m.version} · ${dizin}`,
      glyph: 'package', tint: m.tint });
    this.log(`✓ ${dizin} paketlendi ve kuruldu`, 'ok');
    this.renderExplorer();
    this.renderPaket();
  }

  async install() {
    if (!this.active?.path) await this.saveAs();
    if (!this.active?.path) return;
    const appsPath = VFS.join('/Applications', VFS.basename(this.active.path));
    vfs.write(appsPath, this.ta.value);
    const app = this.ctx.os.installApp(appsPath);
    const pinned = settings.get('pinned');
    if (!pinned.includes(app.id)) settings.set('pinned', [...pinned, app.id]);
    this.renderExplorer();
  }

  async publish() {
    if (!this.active?.path) await this.saveAs();
    if (!this.active?.path) return;
    vfs.write(this.active.path, this.ta.value);
    this.ctx.openApp('appstore', { pane: 'publish' });
  }

  /* ============================= run ============================= */
  run() {
    this.runner?.destroy();
    clear(this.previewHost);
    clear(this.console);
    this.runner = new OshApp({
      container: this.previewHost,
      appId: 'studio_preview', name: 'Önizleme',
      cwd: this.active?.path ? VFS.dirname(this.active.path) : vfs.home,
      osVersion: this.ctx.version,
      setTitle: () => {},
      close: () => {},
      openApp: (id, a) => this.ctx.openApp(id, a),
      onPrint: s => this.log(s),
      onError: e => this.log('⚠︎ ' + (e.line ? `satır ${e.line}: ` : '') + e.message, 'err'),
      onReady: meta => this.log(`▶ ${meta.name || 'uygulama'} çalışıyor`, 'ok'),
    });
    this.runner.start(this.ta.value);
  }

  log(text, cls = '') {
    this.console.appendChild(h('div.st-log', { class: cls },
      h('span.ts', { text: new Date().toLocaleTimeString() + '  ' }),
      h('span', { text })));
    this.console.scrollTop = this.console.scrollHeight;
    if (cls === 'err') this.rail.querySelector('.st-tabbar button[data-pane="console"]')?.click();
  }

  /* ========================= highlighting ========================= */
  paint() {
    const src = this.ta.value;
    this.hl.innerHTML = highlight(src) + '\n';
    const lines = src.split('\n').length;
    this.gutter.innerHTML = Array.from({ length: lines }, (_, i) => `<i>${i + 1}</i>`).join('');
    this.paintProblems();
    this.minimapCiz();
    this.ekmekCiz();
    this.satirVurguyuTasi();
    this.updateStatus();
  }

  /* ============================ docs ============================ */
  /** Kılavuzu metin düzenleyicide, Markdown önizlemesiyle açar. */
  async kilavuzuAc() {
    const yol = '/Applications/docs/OPENSHARP.md';
    if (!vfs.exists(yol)) {
      try {
        vfs.mkdir('/Applications/docs');
        vfs.write(yol, KILAVUZ_METNI);
      } catch (e) {
        notify.toast('Kılavuz bulunamadı: ' + e.message, { glyph: '⚠️' });
        return;
      }
    }
    this.ctx.openApp('texteditor', { path: yol });
  }

  renderDocs() {
    clear(this.docs);
    const sec = (title, body) => h('div', { style: { marginBottom: '18px' } },
      h('div.k-sectitle', { text: title }), body);
    this.docs.append(
      h('div.k-text.t-title2', { text: 'OpenSharp' }),
      h('div.k-text.t-callout', { style: { margin: '4px 0 12px' },
        text: 'Durum (state), tepki veren bir görünüm (view) ve OS ile konuşan bir standart kütüphane.' }),
      /* Buradaki özet hızlı bakmak için; dilin tamamı ayrı bir kılavuzda. */
      h('button.k-btn.v-tinted.s-sm.full', { html: icon('fileText', 13), text: ' Tam dil kılavuzunu aç',
        style: { marginBottom: '16px' },
        onclick: () => this.kilavuzuAc() }),
      sec('Temeller', h('pre.st-code', { html: highlight(
`# yorum satırı
let ad = "Dünya"        # sabit değer
state sayac = 0         # değiştiğinde arayüz yenilenir

fn selamla(kime) {
  return "Merhaba " + kime
}

if sayac > 3 and ad != "" {
  print(selamla(ad))
} else {
  print("henüz değil")
}

for i in range(0, 5) { print(i) }
for anahtar, deger in { a: 1, b: 2 } { print(anahtar, deger) }`) })),
      sec('Uygulama başlığı', h('pre.st-code', { html: highlight(
`app {
  name: "Uygulamam"
  icon: "sparkles"
  tint: ["#5e5ce6", "#bf5af2"]
  width: 480
  height: 420
}`) })),
      sec('Görünüm', h('pre.st-code', { html: highlight(
`view {
  VStack(spacing: 12, padding: 20) {
    Label("Başlık", style: "title")
    Button("Tıkla", variant: "primary", onClick: fn() {
      sayac = sayac + 1
    })
    if sayac > 0 {
      Label("Tıklama: " + sayac)
    }
  }
}`) })),
      sec('Bileşenler', h('div.k-text.t-mono', { style: { lineHeight: 1.9, fontSize: '11.5px' },
        html: COMPONENT_NAMES.map(n => `<span class="st-chip">${n}</span>`).join(' ') })),
      sec('Standart kütüphane', h('div', {},
        ...STDLIB_DOCS.map(([group, fns]) => h('div', { style: { marginBottom: '9px' } },
          h('div.k-text.t-caption', { text: group, style: { fontWeight: 700 } }),
          h('div.k-text.t-mono', { style: { fontSize: '11.5px', lineHeight: 1.9 },
            html: fns.map(f => `<span class="st-chip">${escapeHtml(f)}</span>`).join(' ') }))))),
      sec('Kısayollar', h('div.k-text.t-callout', { html:
        '<b>⌘S</b> kaydet · <b>⌘↩</b> çalıştır · <b>⌘K</b> komut paleti · <b>⌘F</b> bul · ' +
        '<b>⌘/</b> yorum · <b>⌃Space</b> tamamlama' })),
    );
  }

  destroy() { this.runner?.destroy(); }
}

const KIND_GLYPH = {
  component: '⬚', fn: 'ƒ', kw: 'K', prop: ':', snippet: '✦', local: 'v', 'local-fn': 'ƒ',
};

const STARTER = `app {
  name: "Yeni Uygulama"
  icon: "sparkles"
  tint: ["#5e5ce6", "#bf5af2"]
}

state message = "Merhaba OpenSharp"

view {
  VStack(spacing: 14, padding: 24, align: "center", justify: "center", grow: true) {
    Label(message, style: "title")
    Button("Tıkla", variant: "primary", onClick: fn() {
      message = "Çalışıyor! " + time_str()
    })
  }
}
`;

/* ==================== syntax highlighting ==================== */
const KW = [...KEYWORDS].join('|');
const BUILTINS = ['print', 'notify', 'alert', 'toast', 'ask', 'confirm', 'refresh', 'len', 'str', 'num',
  'range', 'push', 'map', 'filter', 'each', 'store_get', 'store_set', 'fs_read', 'fs_write', 'fs_list',
  'os_open', 'os_theme', 'os_accent', 'os_info', 'every', 'after', 'cancel', 'random', 'round', 'floor'];

export function highlight(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const push = (cls, text) => out.push(cls ? `<span class="${cls}">${escapeHtml(text)}</span>` : escapeHtml(text));

  while (i < n) {
    const c = src[i];
    if (c === '#' || (c === '/' && src[i + 1] === '/')) {
      const j = src.indexOf('\n', i); const end = j === -1 ? n : j;
      push('c-cm', src.slice(i, end)); i = end; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      push('c-s', src.slice(i, Math.min(j + 1, n))); i = j + 1; continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i; while (j < n && /[0-9._]/.test(src[j])) j++;
      push('c-n', src.slice(i, j)); i = j; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const w = src.slice(i, j);
      const after = src.slice(j).match(/^\s*[({]/);
      let cls = '';
      if (new RegExp(`^(${KW})$`).test(w)) cls = 'c-k';
      else if (/^[A-Z]/.test(w) && after) cls = 'c-t';
      else if (BUILTINS.includes(w)) cls = 'c-f';
      else if (after && after[0].trim() === '(') cls = 'c-fn';
      else if (src.slice(j).match(/^\s*:/)) cls = 'c-pr';
      push(cls, w); i = j; continue;
    }
    if (/[{}()[\],;.]/.test(c)) { push('c-pn', c); i++; continue; }
    if (/[+\-*/%<>=!&|?:]/.test(c)) { push('c-op', c); i++; continue; }
    push('', c); i++;
  }
  return out.join('');
}
