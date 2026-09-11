/* ==========================================================================
   OpenOS · apps/finder.js — the file manager
   ========================================================================== */

import { h, clear, add, on, fmtBytes, debounce, relTime } from '../core/util.js';
import { icon } from '../core/icons.js';
import { menu, contextMenu } from '../ui/menu.js';
import vfs, { VFS } from '../core/vfs.js';
import notify from '../core/notify.js';
import { glyphFor } from '../ui/desktop.js';

export default {
  id: 'finder', name: 'Finder', glyph: 'folder', tint: ['#4aa8ff', '#0a6ede'],
  category: 'system', width: 880, height: 560, minWidth: 520, minHeight: 320,
  keywords: ['dosya', 'klasör', 'files'],
  about: 'Sanal dosya sistemini gezin, düzenleyin ve uygulamalarla açın.',
  mount(ctx) {
    const F = new Finder(ctx);
    ctx.win.onArgs = (a) => { if (a?.path) F.goto(a.path); };
    return F.el;
  },
};

class Finder {
  constructor(ctx) {
    this.ctx = ctx;
    this.mode = 'grid';
    this.history = [];
    this.hi = -1;
    this.sel = new Set();
    this.clipboard = null;
    this.build();
    this.goto(ctx.args?.path || vfs.home);
    this.off = vfs.bus.on('change', debounce(() => this.refresh(), 90));
    ctx.win.onClosed = () => this.off?.();
  }

  build() {
    this.sidebar = h('div.sidebar');
    this.pathbar = h('div.row', { style: { gap: '3px', flex: 1, overflow: 'hidden' } });
    this.grid = h('div.fx-grid.k-scroll');
    this.status = h('div.statusbar');

    const navBtn = (g, t, fn) => h('button.k-btn.v-ghost.icon.s-sm', { html: icon(g, 15), title: t, onclick: fn });
    this.backBtn = navBtn('chevronL', 'Geri', () => this.back());
    this.fwdBtn = navBtn('chevronR', 'İleri', () => this.forward());

    const search = h('input', { placeholder: 'Ara', style: { width: '120px' } });
    on(search, 'input', debounce(() => this.search(search.value), 180));

    this.toolbar = h('div.toolbar',
      this.backBtn, this.fwdBtn,
      navBtn('arrowUp', 'Üst klasör', () => this.goto(VFS.dirname(this.path))),
      h('div.k-divider', { style: { width: '.5px', height: '18px', margin: '0 4px' } }),
      this.pathbar,
      h('div.k-seg',
        h('button', { html: icon('grid', 13), title: 'Izgara', 'aria-selected': 'true',
          onclick: e => this.setMode('grid', e.target.closest('button')) }),
        h('button', { html: icon('list', 13), title: 'Liste', 'aria-selected': 'false',
          onclick: e => this.setMode('list', e.target.closest('button')) })),
      h('div.k-field.plain', { style: { width: 'auto', height: '24px' } },
        h('span', { html: icon('search', 13), style: { color: 'var(--text-3)' } }), search),
      navBtn('plus', 'Yeni', e => this.newMenu(e)),
    );

    const content = h('div.content', this.toolbar, this.grid, this.status);
    this.el = h('div.app-shell', this.sidebar, content);
    this.renderSidebar();
    contextMenu(this.grid, e => e.target.closest('.fx-item') ? null : this.bgMenu());
    on(this.grid, 'pointerdown', e => { if (e.target === this.grid) this.clearSel(); });
  }

  setMode(m, btn) {
    this.mode = m;
    this.toolbar.querySelectorAll('.k-seg button').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
    this.refresh();
  }

  renderSidebar() {
    clear(this.sidebar);
    const home = vfs.home;
    const places = [
      ['Favoriler', [
        ['home', 'Ana Klasör', home], ['file', 'Masaüstü', home + '/Masaüstü'],
        ['fileText', 'Belgeler', home + '/Belgeler'], ['download', 'İndirilenler', home + '/İndirilenler'],
        ['image', 'Resimler', home + '/Resimler'], ['code', 'Projeler', home + '/Projeler'],
      ]],
      ['Sistem', [
        ['package', 'Uygulamalar', '/Applications'], ['cpu', 'Sistem', '/System'],
        ['database', 'Kök', '/'], ['trash', 'Çöp Kutusu', home + '/.Trash'],
      ]],
    ];
    for (const [title, items] of places) {
      this.sidebar.appendChild(h('div.sb-title', { text: title }));
      for (const [g, label, path] of items) {
        const it = h('div.sb-item', { dataset: { path },
          onclick: () => this.goto(path) },
          h('span.ic', { html: icon(g, 14) }), h('span.ellipsis', { text: label }));
        this.sidebar.appendChild(it);
      }
    }
  }

  goto(path, noHistory) {
    if (!vfs.exists(path)) { notify.toast('Klasör bulunamadı', { glyph: '⚠️' }); return; }
    if (!vfs.isDir(path)) return this.ctx.openPath(path);
    this.path = VFS.norm(path);
    if (!noHistory) { this.history = this.history.slice(0, this.hi + 1); this.history.push(this.path); this.hi++; }
    this.sel.clear();
    this.ctx.setTitle(VFS.basename(this.path) === '/' ? 'Kök' : VFS.basename(this.path));
    this.refresh();
  }
  back() { if (this.hi > 0) { this.hi--; this.goto(this.history[this.hi], true); } }
  forward() { if (this.hi < this.history.length - 1) { this.hi++; this.goto(this.history[this.hi], true); } }

  get copteMi() { return this.path === vfs.trashDir; }

  refresh() {
    this.backBtn.disabled = this.hi <= 0;
    this.fwdBtn.disabled = this.hi >= this.history.length - 1;
    this.sidebar.querySelectorAll('.sb-item').forEach(i => i.classList.toggle('on', i.dataset.path === this.path));
    this.renderPath();
    /* Çöp kutusu ham klasör içeriği olarak gösterilemez: dosyalar orada
       çarpıtılmış adlarla duruyor ve asıl bilgi — nereden geldikleri —
       dizinde. Bu klasör kendi görünümünü alır. */
    if (this.copteMi) { this.copuCiz(); return; }
    this.copBar?.remove(); this.copBar = null;
    let items = [];
    try { items = vfs.list(this.path); } catch { items = []; }
    this.renderItems(items);
  }

  /** Çöp kutusu görünümü: nereden geldiği, ne zaman atıldığı, geri yükle. */
  copuCiz() {
    const kayitlar = vfs.trashList();

    if (!this.copBar) {
      this.copBar = h('div.fx-trashbar');
      this.grid.parentElement.insertBefore(this.copBar, this.grid);
    }
    clear(this.copBar);
    const { bayt } = vfs.trashUsage();
    this.copBar.append(
      h('span', { html: icon('trash', 14) }),
      h('span.k-text.t-caption', { text: kayitlar.length
        ? `${kayitlar.length} öğe · ${fmtBytes(bayt)}`
        : 'Çöp kutusu boş' }),
      h('div.k-spacer'),
      kayitlar.length ? h('button.k-btn.s-sm', { text: 'Tümünü Geri Yükle',
        onclick: () => {
          let n = 0;
          for (const k of vfs.trashList()) { try { vfs.restore(k.id); n++; } catch {} }
          notify.toast(`${n} öğe geri yüklendi`, { glyph: '↩️' });
          this.refresh();
        } }) : null,
      kayitlar.length ? h('button.k-btn.v-danger.s-sm', { text: 'Boşalt',
        onclick: async () => { if (await this.ctx.os.emptyTrash()) this.refresh(); } }) : null,
    );

    clear(this.grid);
    this.grid.className = 'k-scroll fx-list';
    if (!kayitlar.length) {
      this.grid.appendChild(h('div.k-empty',
        h('div.glyph', { html: icon('trash', 28), style: { color: 'var(--text-3)' } }),
        h('div.k-text.t-callout', { text: 'Çöp kutusu boş' })));
      this.status.textContent = '0 öğe';
      return;
    }

    for (const k of kayitlar) {
      const satir = h('div.fx-item.fx-trash-item',
        h('div.ic', { html: icon(k.tur === 'dir' ? 'folder' : 'file', 18) }),
        h('div.nm', { text: k.ad }),
        h('div.fx-trash-from.ellipsis', { text: VFS.dirname(k.eskiYol).replace(vfs.home, '~') }),
        h('div.fx-trash-when', { text: relTime(k.atildi) }),
        h('button.k-btn.v-ghost.s-sm', { html: icon('undo', 13), title: 'Geri yükle',
          onclick: e => {
            e.stopPropagation();
            try {
              const yer = vfs.restore(k.id);
              notify.toast(`Geri yüklendi: ${VFS.basename(yer)}`, { glyph: '↩️' });
            } catch (err) { notify.toast(err.message, { glyph: '⚠️' }); }
            this.refresh();
          } }),
      );
      contextMenu(satir, () => [
        { header: k.ad },
        { label: 'Geri Yükle', glyph: 'undo', run: () => { try { vfs.restore(k.id); } catch {} this.refresh(); } },
        { label: 'Eski yerini aç', glyph: 'folder',
          run: () => this.goto(VFS.dirname(k.eskiYol)) },
        '-',
        { label: 'Kalıcı Olarak Sil', glyph: 'x', danger: true, run: async () => {
          const ok = await notify.confirm(`“${k.ad}” kalıcı olarak silinsin mi?`,
            { title: 'Kalıcı sil', ok: 'Sil', danger: true });
          if (ok) { vfs.trashPurge(k.id); this.refresh(); }
        } },
      ]);
      this.grid.appendChild(satir);
    }
    this.status.textContent = `${kayitlar.length} öğe · ${fmtBytes(bayt)}`;
  }

  renderPath() {
    clear(this.pathbar);
    const segs = this.path === '/' ? [''] : this.path.split('/');
    segs.forEach((s, i) => {
      const p = i === 0 ? '/' : segs.slice(0, i + 1).join('/');
      if (i > 0) this.pathbar.appendChild(h('span', { html: icon('chevronR', 11), style: { opacity: .35 } }));
      this.pathbar.appendChild(h('button.k-btn.v-ghost.s-sm', {
        text: i === 0 ? 'Kök' : s, onclick: () => this.goto(p),
        style: { fontWeight: i === segs.length - 1 ? 600 : 400 },
      }));
    });
  }

  renderItems(items) {
    clear(this.grid);
    this.grid.className = 'k-scroll ' + (this.mode === 'grid' ? 'fx-grid' : 'fx-list');
    if (!items.length) {
      this.grid.appendChild(h('div.k-empty', h('div.glyph', { text: '📂' }),
        h('div.k-text.t-callout', { text: 'Bu klasör boş' })));
    }
    for (const s of items) this.grid.appendChild(this.makeItem(s));
    this.status.textContent = `${items.length} öğe · ${fmtBytes(items.reduce((a, b) => a + (b.type === 'file' ? b.size : 0), 0))}`;
  }

  makeItem(s) {
    const el = this.mode === 'grid'
      ? h('div.fx-item', { dataset: { path: s.path } },
          h('div.g', { text: glyphFor(s) }), h('div.n', { text: s.name }))
      : h('div.fx-item', { dataset: { path: s.path } },
          h('div.g', { text: glyphFor(s) }),
          h('div.n', { text: s.name }),
          h('div.meta', { text: s.type === 'dir' ? '—' : fmtBytes(s.size) }),
          h('div.meta', { text: new Date(s.modified).toLocaleDateString() }));

    el.addEventListener('click', e => {
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) this.clearSel();
      this.sel.add(s.path); el.classList.add('sel');
      this.status.textContent = `${s.name} · ${s.type === 'dir' ? 'klasör' : fmtBytes(s.size)}`;
    });
    el.addEventListener('dblclick', () => s.type === 'dir' ? this.goto(s.path) : this.ctx.openPath(s.path));
    contextMenu(el, () => this.itemMenu(s));
    el.draggable = true;
    on(el, 'dragstart', e => e.dataTransfer.setData('text/openos-path', s.path));
    if (s.type === 'dir') {
      on(el, 'dragover', e => { e.preventDefault(); el.classList.add('drop'); });
      on(el, 'dragleave', () => el.classList.remove('drop'));
      on(el, 'drop', e => {
        e.preventDefault(); el.classList.remove('drop');
        const from = e.dataTransfer.getData('text/openos-path');
        if (from && from !== s.path) { try { vfs.move(from, s.path); } catch (err) { notify.toast(err.message); } }
      });
    }
    return el;
  }

  clearSel() { this.sel.clear(); this.grid.querySelectorAll('.sel').forEach(e => e.classList.remove('sel')); }

  itemMenu(s) {
    return [
      { label: 'Aç', glyph: 'folderOpen', run: () => s.type === 'dir' ? this.goto(s.path) : this.ctx.openPath(s.path) },
      ...(s.ext === 'osh' ? [
        { label: 'Studio’da Aç', glyph: 'code', run: () => this.ctx.openApp('studio', { path: s.path }) },
        { label: 'Uygulama Olarak Kur', glyph: 'package', run: () => this.ctx.os.installApp(s.path) },
      ] : []),
      '-',
      { label: 'Yeniden Adlandır', glyph: 'note', run: async () => {
        const n = await notify.prompt('Yeni ad:', { value: s.name, title: 'Yeniden Adlandır' });
        if (n && n !== s.name) { try { vfs.move(s.path, VFS.join(this.path, n)); } catch (e) { notify.toast(e.message); } }
      } },
      { label: 'Çoğalt', glyph: 'copy', run: () => vfs.copy(s.path, vfs.unique(s.path)) },
      { label: 'Kopyala', glyph: 'copy', run: () => { this.clipboard = { op: 'copy', path: s.path }; notify.toast('Kopyalandı'); } },
      { label: 'Kes', glyph: 'send', run: () => { this.clipboard = { op: 'cut', path: s.path }; notify.toast('Kesildi'); } },
      '-',
      { label: 'Bilgi Al', glyph: 'info', run: () => notify.alert(
        `Yol: ${s.path}\nTür: ${s.type === 'dir' ? 'Klasör' : s.ext || 'dosya'}\nBoyut: ${fmtBytes(s.size)}\n` +
        `Oluşturma: ${new Date(s.created).toLocaleString()}\nDeğiştirme: ${new Date(s.modified).toLocaleString()}`,
        { title: s.name, glyph: glyphFor(s) }) },
      '-',
      { label: 'Çöp Kutusuna At', glyph: 'trash', danger: true, run: () => this.ctx.os.trash(s.path) },
    ];
  }

  bgMenu() {
    return [
      { label: 'Yeni Klasör', glyph: 'folder', run: () => this.create('dir') },
      { label: 'Yeni Metin Dosyası', glyph: 'fileText', run: () => this.create('txt') },
      { label: 'Yeni OpenSharp Uygulaması', glyph: 'sparkles', run: () => this.create('osh') },
      '-',
      ...(this.clipboard ? [{ label: 'Yapıştır', glyph: 'copy', run: () => {
        const c = this.clipboard;
        const dest = vfs.unique(VFS.join(this.path, VFS.basename(c.path)));
        if (c.op === 'copy') vfs.copy(c.path, dest); else { vfs.move(c.path, dest); this.clipboard = null; }
      } }, '-'] : []),
      { label: 'Yenile', glyph: 'refresh', run: () => this.refresh() },
      { label: 'Terminal’de Aç', glyph: 'terminal', run: () => this.ctx.openApp('terminal', { cwd: this.path }) },
    ];
  }

  newMenu(e) {
    menu([
      { label: 'Klasör', glyph: 'folder', run: () => this.create('dir') },
      { label: 'Metin dosyası', glyph: 'fileText', run: () => this.create('txt') },
      { label: 'OpenSharp uygulaması', glyph: 'sparkles', run: () => this.create('osh') },
    ], { x: e.clientX, y: e.clientY });
  }

  async create(kind) {
    const defaults = { dir: 'Yeni Klasör', txt: 'belge.txt', osh: 'uygulama.osh' };
    const name = await notify.prompt('Ad:', { value: defaults[kind], title: 'Yeni' });
    if (!name) return;
    const p = vfs.unique(VFS.join(this.path, name));
    if (kind === 'dir') vfs.mkdir(p);
    else if (kind === 'osh') vfs.write(p, STARTER);
    else vfs.write(p, '');
    if (kind === 'osh') this.ctx.openApp('studio', { path: p });
  }

  search(q) {
    if (!q.trim()) return this.refresh();
    const res = vfs.search(q, { root: this.path });
    this.renderItems(res);
    this.status.textContent = `“${q}” için ${res.length} sonuç`;
  }
}

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
