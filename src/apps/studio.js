/* ==========================================================================
   OpenOS · apps/studio.js — OpenSharp Studio
   Proje gezgini, çok sekmeli düzenleyici, tamamlama, canlı önizleme, sorun
   listesi, anahat, bul/değiştir, komut paleti ve tek tıkla kurulum/yayınlama.
   ========================================================================== */

import { h, clear, add, on, debounce, escapeHtml, clamp } from '../core/util.js';
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
  build() {
    /* ---- explorer ---- */
    this.explorer = h('div.ide-explorer');
    this.outline = h('div.ide-outline');
    this.sidebar = h('div.ide-side',
      h('div.ide-side-head',
        h('span', { text: 'PROJE' }),
        h('button.ob-btn.small', { html: icon('plus', 13), title: 'Yeni dosya', onclick: () => this.newFile() }),
        h('button.ob-btn.small', { html: icon('refresh', 13), title: 'Yenile', onclick: () => this.renderExplorer() })),
      this.explorer,
      h('div.ide-side-head', h('span', { text: 'ANAHAT' })),
      this.outline);

    /* ---- editor ---- */
    this.tabstrip = h('div.ide-tabs');
    this.gutter = h('div.ed-gutter');
    this.hl = h('pre.ed-hl');
    this.ta = h('textarea.ed-ta', { spellcheck: false, autocapitalize: 'off', autocomplete: 'off', wrap: 'off' });
    this.complete = h('div.ide-complete');
    this.editor = h('div.ed', this.gutter, h('div.ed-scroll', this.hl, this.ta, this.complete));

    on(this.ta, 'input', () => this.onInput());
    on(this.ta, 'scroll', () => {
      this.hl.scrollTop = this.ta.scrollTop; this.hl.scrollLeft = this.ta.scrollLeft;
      this.gutter.scrollTop = this.ta.scrollTop;
      this.hideComplete();
    });
    on(this.ta, 'keydown', e => this.editorKeys(e));
    on(this.ta, 'click', () => { this.hideComplete(); this.updateStatus(); });
    on(this.ta, 'keyup', e => { if (!['ArrowUp', 'ArrowDown'].includes(e.key)) this.updateStatus(); });
    on(this.ta, 'blur', () => setTimeout(() => this.hideComplete(), 160));
    contextMenu(this.editor, () => this.editorMenu());

    /* ---- right rail ---- */
    this.previewHost = h('div.st-preview-host');
    this.preview = h('div.st-preview', this.previewHost);
    this.console = h('div.st-console');
    this.docs = h('div.st-docs.k-scroll');
    this.problemsPane = h('div.ide-problems.k-scroll');
    [this.console, this.docs, this.problemsPane].forEach(p => { p.style.display = 'none'; });

    this.rail = h('div.st-right',
      h('div.st-tabbar',
        this.tabBtn('Önizleme', 'preview', true),
        this.tabBtn('Konsol', 'console'),
        this.tabBtn('Sorunlar', 'problems'),
        this.tabBtn('Belgeler', 'docs'),
        h('div.k-spacer'),
        h('button.ob-btn.small', { html: icon('refresh', 13), title: 'Yeniden çalıştır', onclick: () => this.run() })),
      this.preview, this.console, this.problemsPane, this.docs);

    /* ---- toolbar ---- */
    this.fileLabel = h('div.k-text.t-caption.ellipsis', { style: { flex: 1 } });
    const toolbar = h('div.toolbar',
      h('button.k-btn.v-primary.s-sm', { html: icon('play', 13), text: ' Çalıştır', title: '⌘↩',
        onclick: () => this.run() }),
      h('button.k-btn.s-sm', { html: icon('save', 13), text: ' Kaydet', title: '⌘S', onclick: () => this.save() }),
      h('button.k-btn.s-sm', { html: icon('package', 13), text: ' Kur', onclick: () => this.install() }),
      h('button.k-btn.s-sm', { html: icon('upload', 13), text: ' Yayınla', onclick: () => this.publish() }),
      h('div.k-divider', { style: { width: '.5px', height: '18px', margin: '0 3px' } }),
      h('button.k-btn.v-ghost.s-sm', { html: icon('search', 13), text: ' Bul', title: '⌘F',
        onclick: () => this.openFind() }),
      h('button.k-btn.v-ghost.s-sm', { html: icon('sparkles', 13), text: ' Örnekler',
        onclick: e => this.exampleMenu(e) }),
      this.fileLabel,
      h('button.k-btn.v-ghost.icon.s-sm', { html: icon('bolt', 14), title: 'Komut paleti (⌘K)',
        onclick: () => this.palette() }),
      h('button.k-btn.v-ghost.icon.s-sm', { html: icon('question', 14), title: 'Dil kılavuzu',
        onclick: () => this.showPane('docs') }));

    this.status = h('div.ide-status');
    const center = h('div.content',
      toolbar, this.tabstrip,
      h('div.st-split', this.editor, h('div.st-drag'), this.rail),
      this.status);

    this.el = h('div.app-shell', this.sidebar, center);
    this.setupSplit();
    this.renderExplorer();
  }

  tabBtn(label, key, on0) {
    const b = h('button', { text: label, dataset: { pane: key }, 'aria-selected': String(!!on0),
      onclick: () => this.showPane(key) });
    return b;
  }
  showPane(which) {
    this.rail.querySelectorAll('.st-tabbar button[data-pane]').forEach(b =>
      b.setAttribute('aria-selected', String(b.dataset.pane === which)));
    this.preview.style.display = which === 'preview' ? '' : 'none';
    this.console.style.display = which === 'console' ? '' : 'none';
    this.problemsPane.style.display = which === 'problems' ? '' : 'none';
    this.docs.style.display = which === 'docs' ? '' : 'none';
    if (which === 'docs' && !this.docs.childElementCount) this.renderDocs();
    if (which === 'problems') this.renderProblems();
  }

  setupSplit() {
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
        { label: 'Uygulama olarak kur', glyph: 'package', run: () => this.install() },
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
      { title: 'Çalıştır', items: () => [
        { label: 'Çalıştır', key: '⌘↩', glyph: 'play', run: () => this.run() },
        { label: 'Konsolu temizle', glyph: 'trash', run: () => clear(this.console) },
        { label: 'Sorunları göster', glyph: 'info', run: () => this.showPane('problems') },
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
              vfs.remove(f.path); this.renderExplorer();
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
    const tab = this.rail.querySelector('.st-tabbar button[data-pane="problems"]');
    if (tab) tab.textContent = this.problems.some(p => p.severity === 'error')
      ? `Sorunlar (${this.problems.filter(p => p.severity === 'error').length})` : 'Sorunlar';
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
    clear(this.problemsPane);
    if (!this.problems.length) {
      this.problemsPane.appendChild(h('div.k-empty', h('div.glyph', { text: '✅' }),
        h('div.k-text.t-callout', { text: 'Sorun yok' })));
      return;
    }
    this.problems.forEach(p => this.problemsPane.appendChild(h('div.ide-problem', {
      class: p.severity, onclick: () => this.jumpTo(p.line) },
      h('span.g', { html: icon(p.severity === 'error' ? 'x' : 'info', 13) }),
      h('span.m', { text: p.message }),
      h('span.l', { text: 'satır ' + p.line }))));
  }

  updateStatus() {
    const ta = this.ta;
    const upto = ta.value.slice(0, ta.selectionStart).split('\n');
    const errs = this.problems.filter(p => p.severity === 'error').length;
    clear(this.status);
    this.status.append(
      h('span', { text: `Satır ${upto.length}, Sütun ${upto[upto.length - 1].length + 1}` }),
      h('span', { text: `${ta.value.split('\n').length} satır` }),
      h('span', { text: `${ta.value.length} karakter` }),
      h('span.k-spacer'),
      errs ? h('span.err', { text: `${errs} hata` }) : h('span.ok', { text: 'temiz' }),
      h('span', { text: 'OpenSharp 1.0' }),
      h('span', { text: this.active?.path ? this.active.path.replace(vfs.home, '~') : 'kaydedilmemiş' }));
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
  }

  /* ============================ docs ============================ */
  renderDocs() {
    clear(this.docs);
    const sec = (title, body) => h('div', { style: { marginBottom: '18px' } },
      h('div.k-sectitle', { text: title }), body);
    this.docs.append(
      h('div.k-text.t-title2', { text: 'OpenSharp' }),
      h('div.k-text.t-callout', { style: { margin: '4px 0 16px' },
        text: 'Durum (state), tepki veren bir görünüm (view) ve OS ile konuşan bir standart kütüphane.' }),
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
