/* ==========================================================================
   OpenOS · apps/appstore.js — App Store
   Katalog üç kaynaktan gelir: OpenOS Cloud API'si, GitHub deposu ve sistemle
   gelen yerleşik uygulamalar. Gezinmek ve kurmak hesap gerektirmez; yalnızca
   yayınlamak için OpenOS Cloud hesabı ya da GitHub belirteci gerekir.
   ========================================================================== */

import { h, clear, add, on, fmtBytes, relTime, debounce, escapeHtml } from '../core/util.js';
import { icon, hasIcon } from '../core/icons.js';
import { appIcon } from '../ui/appicon.js';
import { menu, contextMenu } from '../ui/menu.js';
import vfs, { VFS } from '../core/vfs.js';
import registry from '../core/registry.js';
import settings from '../core/settings.js';
import notify from '../core/notify.js';
import cloud from '../core/cloud.js';
import { GitHub } from '../core/github.js';
import { parseAppHeader, slug } from '../core/kernel.js';
import { BUILTIN_CATALOG } from './store-catalog.js';
import { paketOku, paketMi } from '../lang/package.js';

export default {
  id: 'appstore', name: 'App Store', glyph: 'package', tint: ['#0a84ff', '#5e5ce6'],
  category: 'system', width: 980, height: 660, minWidth: 560, minHeight: 400,
  keywords: ['mağaza', 'uygulama', 'kur', 'store', 'bulut', 'yayınla'],
  about: 'OpenSharp uygulamalarını keşfedin, kurun ve kendi uygulamanızı yayınlayın.',
  mount(ctx) {
    const s = new Store(ctx);
    ctx.win.onArgs = a => { if (a?.pane) s.select(a.pane); };
    return s.el;
  },
};

const PANES = [
  ['discover', 'Keşfet', 'sparkles', '#0a84ff'],
  ['categories', 'Kategoriler', 'grid', '#bf5af2'],
  ['installed', 'Kurulu', 'check', '#30d158'],
  ['mine', 'Uygulamalarım', 'user', '#ff9f0a'],
  ['publish', 'Yayınla', 'upload', '#ff375f'],
  ['cloud', 'OpenOS Cloud', 'cloud', '#64d2ff'],
];

class Store {
  constructor(ctx) {
    this.ctx = ctx;
    this.pane = ctx.args?.pane || 'discover';
    this.query = '';
    this.category = null;
    this.remote = [];
    this.loading = false;

    this.sidebar = h('div.sidebar', { style: { width: '190px' } });
    this.body = h('div.content.k-scroll', { style: { padding: '18px 22px', gap: '16px' } });
    this.el = h('div.app-shell', this.sidebar, this.body);

    this.renderSidebar();
    this.render();
    this.refreshCatalog();
    this.off = cloud.bus.on('auth', () => { this.renderSidebar(); this.render(); });
    this.agiIzle();
    ctx.win.onClosed = () => {
      this.off?.();
      window.removeEventListener('online', this.agDinleyici);
      window.removeEventListener('offline', this.agDinleyici);
    };
  }

  /* ---------------- data ---------------- */
  /**
   * Kataloğu çevrimiçi tazeler. Üç sonuç ayrı ayrı ele alınır: ağ yok,
   * ağ var ama sunucu yanıt vermedi, ve ağ yavaş. Üçünü "yerleşik katalog"
   * diye tek bir sessiz duruma toplamak, kullanıcıya neyin yanlış
   * gittiğini söylemiyordu.
   */
  async refreshCatalog() {
    this.loading = true;
    this.agHatasi = null;
    this.render();

    if (navigator.onLine === false) {
      this.remote = [];
      this.agHatasi = { tur: 'offline' };
      this.loading = false;
      this.render();
      return;
    }

    const basladi = performance.now();
    try {
      const cat = await cloud.loadCatalog({ force: true });
      this.remote = cat?.apps || [];
      if (!cat) this.agHatasi = { tur: 'sunucu', ileti: cloud.lastError };
      this.yavasMi(performance.now() - basladi);
    } catch (e) {
      this.remote = [];
      this.agHatasi = { tur: 'sunucu', ileti: e.message };
    }
    this.loading = false;
    this.render();
  }

  /**
   * Bağlantı yavaşsa kullanıcıya bir kez haber verilir. Her yenilemede
   * yinelemek sinir bozucu olur; oturumda bir kez ve yalnızca üst üste
   * yavaş ölçüm alındığında gösterilir.
   */
  yavasMi(sure) {
    this.yavasSayac = sure > 3500 ? (this.yavasSayac || 0) + 1 : 0;
    if (this.yavasSayac >= 2 && !this.yavasUyarildi) {
      this.yavasUyarildi = true;
      notify.post({
        title: 'Bağlantınız yavaş',
        body: 'Mağaza geç yanıt veriyor. Kurulumlar uzun sürebilir.',
        glyph: 'wifi', timeout: 7000,
      });
    }
  }

  /** Ağ durumu değişince mağaza kendini tazeler — elle yenilemeye gerek yok. */
  agiIzle() {
    this.agDinleyici = () => {
      if (navigator.onLine) { notify.toast('Bağlantı geri geldi', { glyph: '📶' }); this.refreshCatalog(); }
      else { this.agHatasi = { tur: 'offline' }; this.render(); }
    };
    window.addEventListener('online', this.agDinleyici);
    window.addEventListener('offline', this.agDinleyici);
  }

  /** Ağ yokken ya da sunucu yanıt vermezken gösterilen sayfa. */
  cevrimdisiSayfasi() {
    const offline = this.agHatasi?.tur === 'offline';
    const yerlesik = BUILTIN_CATALOG.length;
    return h('div.as-offline',
      h('div.as-offline-glyph', { html: icon(offline ? 'wifiOff' : 'cloud', 32) }),
      h('div.k-text.t-title2', { text: offline ? 'Çevrimdışısınız' : 'Mağazaya ulaşılamadı' }),
      h('div.k-text.t-callout.as-offline-body', {
        text: offline
          ? 'OpenOS ağa ulaşamıyor. Bağlantınız geri geldiğinde mağaza kendiliğinden tazelenir.'
          : `Sunucu yanıt vermedi${this.agHatasi?.ileti ? ` (${this.agHatasi.ileti})` : ''}. Birkaç dakika sonra yeniden deneyin.` }),
      h('div.as-offline-note',
        h('span', { html: icon('package', 14) }),
        h('span', { text: `Sistemle gelen ${yerlesik} uygulama çevrimdışı da kurulabilir.` })),
      h('div.k-hstack.as-offline-acts',
        h('button.k-btn.v-primary.s-sm', { html: icon('refresh', 13), text: ' Yeniden dene',
          onclick: () => this.refreshCatalog() }),
        h('button.k-btn.s-sm', { html: icon('package', 13), text: ' Yerleşik uygulamalar',
          onclick: () => { this.agHatasi = null; this.render(); } })));
  }

  /** Built-in entries plus whatever the cloud/GitHub catalogue returned. */
  get catalog() {
    const builtin = BUILTIN_CATALOG.map(c => ({ ...c, builtin: true, author: 'OpenOS', version: '1.0.0' }));
    const seen = new Set(this.remote.map(a => a.id));
    return [...this.remote, ...builtin.filter(b => !seen.has(b.id))];
  }

  filtered() {
    const q = this.query.toLowerCase().trim();
    return this.catalog.filter(a => {
      if (this.category && a.category !== this.category) return false;
      if (!q) return true;
      return (a.name + ' ' + (a.summary || '') + ' ' + (a.author || '')).toLowerCase().includes(q);
    });
  }

  installedFor(entry) {
    return registry.all().find(a => a.kind === 'opensharp' &&
      (a.storeId === entry.id || a.name === entry.name));
  }

  /* ---------------- chrome ---------------- */
  renderSidebar() {
    clear(this.sidebar);
    this.sidebar.appendChild(h('div.sb-title', { text: 'App Store' }));
    for (const [id, label, glyph, color] of PANES) {
      this.sidebar.appendChild(h('div.sb-item', {
        dataset: { id }, class: id === this.pane ? 'on' : '', onclick: () => this.select(id),
      }, h('span.ic', { html: icon(glyph, 14), style: { color } }), h('span', { text: label })));
    }
    this.sidebar.appendChild(h('div.k-spacer'));
    const st = cloud.status();
    this.sidebar.appendChild(h('div.as-cloudchip', { onclick: () => this.select('cloud') },
      h('span.dot', { class: st.signedIn ? 'on' : (st.mode !== 'offline' ? 'half' : '') }),
      h('span.ellipsis', { text: st.signedIn ? '@' + st.user.handle
        : st.mode === 'github' ? 'GitHub kataloğu'
        : st.mode === 'cloud' ? 'Cloud bağlı' : 'Çevrimdışı' })));
  }

  select(id) {
    this.pane = id;
    this.category = null;
    this.sidebar.querySelectorAll('.sb-item').forEach(i => i.classList.toggle('on', i.dataset.id === id));
    this.render();
  }

  render() {
    clear(this.body);
    const fn = this['p_' + this.pane];
    if (fn) fn.call(this);
    this.body.scrollTop = 0;
  }

  searchBar() {
    const input = h('input', { placeholder: 'Uygulama ara', value: this.query });
    on(input, 'input', debounce(() => { this.query = input.value; this.renderGrid(); }, 160));
    return h('div.k-field', { style: { maxWidth: '320px' } },
      h('span', { html: icon('search', 14), style: { color: 'var(--text-3)' } }), input);
  }

  /* ---------------- panes ---------------- */
  p_discover() {
    /* Ağ sorunu varsa önce onu söyle; yerleşik kataloğu görmek isteyen
       düğmeye basar. Sessizce eksik liste göstermek yanıltıcıydı. */
    if (this.agHatasi) { this.body.appendChild(this.cevrimdisiSayfasi()); return; }
    const st = cloud.status();
    this.body.append(
      h('div.as-hero',
        h('div.k-text.t-largetitle', { text: 'OpenSharp uygulamaları' }),
        h('div.k-text.t-callout', { text: 'Hepsi kaynak kodlu, hepsi düzenlenebilir. Kurulum bir dosya yazmaktan ibaret.' }),
        h('div.k-hstack', { style: { gap: '8px', marginTop: '12px' } },
          h('span.as-pill', { html: icon(st.mode === 'offline' ? 'package' : 'cloud', 12),
            text: ' ' + ({ cloud: 'OpenOS Cloud', github: 'GitHub kataloğu', offline: 'Yerleşik katalog' })[st.mode] }),
          h('span.as-pill', { text: `${this.catalog.length} uygulama` }),
          this.loading ? h('span.as-pill', { text: 'yükleniyor…' }) : null)),
      h('div.k-hstack', { style: { gap: '10px' } }, this.searchBar(), h('div.k-spacer'),
        h('button.k-btn.s-sm', { html: icon('refresh', 13), text: ' Yenile', onclick: () => this.refreshCatalog() })),
    );
    this.grid = h('div.as-grid');
    this.body.appendChild(this.grid);
    this.renderGrid();
  }

  p_categories() {
    const cats = [...new Set(this.catalog.map(a => a.category))].sort();
    this.body.append(h('div.k-text.t-title', { text: 'Kategoriler' }));
    const wrap = h('div.k-grid', { style: { gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))' } });
    cats.forEach(c => {
      const n = this.catalog.filter(a => a.category === c).length;
      wrap.appendChild(h('div.as-cat', { onclick: () => { this.category = c; this.pane = 'discover'; this.render(); } },
        h('div.g', { html: icon('grid', 20) }),
        h('div.k-text', { text: c, style: { fontWeight: 600 } }),
        h('div.k-text.t-caption', { text: `${n} uygulama` })));
    });
    this.body.appendChild(wrap);
  }

  p_installed() {
    const apps = registry.all().filter(a => a.kind === 'opensharp');
    this.body.append(h('div.k-text.t-title', { text: 'Kurulu uygulamalar' }),
      h('div.k-text.t-caption', { text: `${apps.length} OpenSharp uygulaması` }));
    if (!apps.length) {
      this.body.appendChild(h('div.k-empty', h('div.glyph', { text: '📦' }),
        h('div.k-text.t-callout', { text: 'Henüz kurulu uygulama yok' })));
      return;
    }
    const g = h('div.k-group');
    apps.forEach(a => g.appendChild(h('div.k-row',
      appIcon(a, 32),
      h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '1px' } },
        h('div.k-text', { text: a.name, style: { fontWeight: 520 } }),
        h('div.k-text.t-caption.ellipsis', { text: a.source })),
      h('div.k-hstack', { style: { gap: '6px' } },
        h('button.k-btn.s-sm', { text: 'Aç', onclick: () => this.ctx.openApp(a.id) }),
        h('button.k-btn.s-sm', { text: 'Düzenle', onclick: () => this.ctx.openApp('studio', { path: a.source }) }),
        h('button.k-btn.s-sm.v-danger', { text: 'Kaldır', onclick: () => this.ctx.os.uninstallApp(a.id) })))));
    this.body.appendChild(g);
  }

  async p_mine() {
    const st = cloud.status();
    this.body.append(h('div.k-text.t-title', { text: 'Uygulamalarım' }));
    if (!st.signedIn && !st.github) {
      this.body.appendChild(this.signInPrompt('Yayınladığınız uygulamaları görmek için bağlanın.'));
      return;
    }
    const box = h('div', h('div.k-text.t-caption', { text: 'Yükleniyor…' }));
    this.body.appendChild(box);
    let mine = [];
    try { mine = await cloud.myApps(); } catch (e) { clear(box); box.appendChild(errorCard(e.message)); return; }
    clear(box);
    if (!mine.length) {
      box.appendChild(h('div.k-empty', h('div.glyph', { text: '🚀' }),
        h('div.k-text.t-callout', { text: 'Henüz yayınlanmış uygulamanız yok' }),
        h('button.k-btn.v-primary.s-sm', { text: 'İlk uygulamanı yayınla', onclick: () => this.select('publish') })));
      return;
    }
    const g = h('div.k-group');
    mine.forEach(a => g.appendChild(h('div.k-row',
      appIcon({ id: a.id, glyph: a.icon, tint: a.tint }, 32),
      h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '1px' } },
        h('div.k-text', { text: a.name, style: { fontWeight: 520 } }),
        h('div.k-text.t-caption', { text: `v${a.version} · ${fmtBytes(a.size || 0)}` +
          (a.downloads ? ` · ${a.downloads} indirme` : '') })),
      h('div.k-hstack', { style: { gap: '6px' } },
        h('button.k-btn.s-sm', { text: 'Güncelle', onclick: () => this.select('publish') }),
        h('button.k-btn.s-sm.v-danger', { text: 'Kaldır', onclick: async () => {
          if (!(await notify.confirm(`${a.name} mağazadan kaldırılsın mı?`, { title: 'Yayından kaldır', danger: true, ok: 'Kaldır' }))) return;
          try { await cloud.unpublish(a.id, a.name); notify.toast('Kaldırıldı'); this.render(); }
          catch (e) { notify.alert(e.message, { title: 'Kaldırılamadı', glyph: '⚠️' }); }
        } })))));
    box.appendChild(g);
  }

  /**
   * Kurulu bütün OpenSharp uygulamalarını tek işlemde yayınlar. Tek tek
   * formu doldurmak, beş uygulaması olan biri için beş kez aynı işi yapmak
   * demekti; manifest zaten her paketin içinde duruyor.
   */
  topluYayinlaBolumu() {
    const st = cloud.status();
    const kurulu = registry.all().filter(a => a.kind === 'opensharp' && a.packagePath);
    if (!kurulu.length) return null;

    const secim = new Set(kurulu.map(a => a.id));
    const durum = h('div.k-text.t-caption');
    const dugme = h('button.k-btn.v-primary.s-sm', {
      html: icon('upload', 13), text: ` ${secim.size} uygulamayı yayınla` });

    const satirlar = kurulu.map(a => {
      const kutu = h('div.k-toggle', { dataset: { on: '1' } });
      on(kutu, 'click', () => {
        const acik = kutu.dataset.on !== '1';
        kutu.dataset.on = acik ? '1' : '0';
        if (acik) secim.add(a.id); else secim.delete(a.id);
        dugme.textContent = ` ${secim.size} uygulamayı yayınla`;
        dugme.prepend(h('span', { html: icon('upload', 13) }));
        dugme.disabled = secim.size === 0;
      });
      return h('div.k-row',
        h('span.ic', { style: { background: `linear-gradient(150deg, ${a.tint[0]}, ${a.tint[1]})`,
                                color: '#fff' }, html: icon(a.glyph, 14) }),
        h('div', { style: { flex: 1 } },
          h('div.k-text', { text: a.name }),
          h('div.k-text.t-caption', { text: `${a.id} · ${a.version || '1.0.0'}` })),
        kutu);
    });

    on(dugme, 'click', async () => {
      if (!st.signedIn && !st.github) {
        notify.alert('Yayınlamak için önce OpenOS Cloud hesabınıza girin.',
          { title: 'Oturum gerekli', glyph: '🔒' });
        return;
      }
      dugme.disabled = true;
      const hedefler = kurulu.filter(a => secim.has(a.id));
      let basarili = 0;
      const hatalar = [];

      for (const a of hedefler) {
        durum.textContent = `${a.name} yayınlanıyor… (${basarili + hatalar.length + 1}/${hedefler.length})`;
        try {
          const paket = paketOku(a.packagePath);
          if (!paket) throw new Error('paket okunamadı');
          await cloud.publish({
            id: paket.manifest.id || a.id,
            name: paket.manifest.name || a.name,
            source: paket.kaynak,
            manifest: {
              summary: paket.manifest.about || '',
              category: paket.manifest.category || 'Araç',
              version: paket.manifest.version || '1.0.0',
              icon: paket.manifest.icon || 'sparkles',
              tint: paket.manifest.tint || a.tint,
              author: st.signedIn ? st.user.handle : paket.manifest.author,
              engine: 'opensharp-1', os: this.ctx.version,
            },
          });
          basarili++;
        } catch (e) {
          hatalar.push(`${a.name}: ${e.message}`);
        }
      }

      durum.textContent = hatalar.length
        ? `${basarili} yayınlandı, ${hatalar.length} başarısız`
        : `${basarili} uygulama yayınlandı`;
      if (hatalar.length) {
        notify.alert(hatalar.join('\n'), { title: 'Bazıları yayınlanamadı', glyph: '⚠️' });
      } else {
        notify.post({ title: 'Yayınlandı', body: `${basarili} uygulama mağazada`,
                      glyph: 'package', tint: ['#0a84ff', '#5e5ce6'] });
      }
      await this.refreshCatalog();
      dugme.disabled = false;
    });

    return h('div', { style: { marginTop: '8px' } },
      h('div.k-sectitle', { text: 'Kurulu uygulamaları topluca yayınla' }),
      h('div.k-group', ...satirlar),
      h('div.k-hstack', { style: { gap: '10px', marginTop: '10px', alignItems: 'center' } },
        dugme, durum));
  }

  p_publish() {
    const st = cloud.status();
    this.body.append(
      h('div.k-text.t-title', { text: 'Uygulama Yayınla' }),
      h('div.k-text.t-callout', { style: { maxWidth: '560px' },
        text: 'Projeler klasörünüzdeki bir OpenSharp dosyasını mağazaya gönderin. ' +
              'OpenOS Cloud hesabınız varsa oraya, yoksa GitHub deponuza yazılır.' }));

    if (!st.signedIn && !st.github) {
      this.body.appendChild(this.signInPrompt('Yayınlamak için bir hedef bağlayın.'));
      const onizleme = this.topluYayinlaBolumu();
      if (onizleme) this.body.appendChild(onizleme);
      return;
    }

    const toplu = this.topluYayinlaBolumu();
    if (toplu) this.body.appendChild(toplu);

    /* --- source picker --- */
    /* Kaynak yalnızca tek dosyalık `.osh` değil: paketlenmiş uygulamalar da
       yayınlanabilmeli, yoksa Studio'da paketleyen kullanıcı mağazaya
       gönderemiyor. Paketin giriş dosyası listeye girer. */
    let files = [];
    const paketGirisleri = dizin => {
      const cikti = [];
      let ogeler = [];
      try { ogeler = vfs.list(dizin); } catch { return cikti; }
      for (const o of ogeler) {
        if (o.type === 'file' && o.ext === 'osh') { cikti.push(o); continue; }
        if (o.type === 'dir' && paketMi(o.path)) {
          const p2 = paketOku(o.path);
          if (p2) cikti.push({ ...vfs.stat(p2.girisYolu), paketYolu: o.path, manifest: p2.manifest });
        }
      }
      return cikti;
    };
    files = [...paketGirisleri(VFS.join(vfs.home, 'Projeler')), ...paketGirisleri('/Applications')];
    if (!files.length) {
      this.body.appendChild(h('div.k-empty', h('div.glyph', { text: '📝' }),
        h('div.k-text.t-callout', { text: 'Projeler klasörünüzde .osh dosyası yok' }),
        h('button.k-btn.v-primary.s-sm', { text: 'Studio’yu aç', onclick: () => this.ctx.openApp('studio') })));
      return;
    }

    const form = {
      path: files[0].path, id: '', name: '', summary: '', category: 'Araç',
      version: '1.0.0', icon: 'sparkles', tint: ['#5e5ce6', '#bf5af2'],
    };
    const applyHeader = () => {
      const secilen = files.find(f => f.path === form.path);
      const src = vfs.read(form.path);
      /* Paketin manifesti kaynağın başlığından daha güvenilir: kullanıcı
         Studio'da orada düzenlemiş oluyor. */
      const meta = { ...parseAppHeader(src), ...(secilen?.manifest || {}) };
      form.name = meta.name || VFS.basename(form.path).replace(/\.osh$/, '');
      form.id = meta.id || slug(form.name);
      form.icon = meta.icon || 'sparkles';
      form.summary = meta.about || form.summary || '';
      if (meta.version) form.version = meta.version;
      if (Array.isArray(meta.tint)) form.tint = meta.tint;
      nameF.value = form.name; idF.value = form.id;
      sumF.value = form.summary;
      verF.value = form.version || '1.0.0';
      preview.replaceChildren(previewCard(form));
    };

    const select = h('select.k-select', { style: { width: '100%' } },
      ...files.map(f => h('option', { value: f.path, text: f.path.replace(vfs.home, '~') })));
    on(select, 'change', () => { form.path = select.value; applyHeader(); });

    const nameF = h('input');
    const idF = h('input', { placeholder: 'benzersiz-kimlik' });
    const sumF = h('input', { placeholder: 'Tek cümlelik açıklama' });
    const verF = h('input', { value: '1.0.0' });
    const catF = h('select.k-select',
      ...['Verimlilik', 'Araç', 'Eğlence', 'Sistem', 'Geliştirme', 'Örnek', 'Medya']
        .map(c => h('option', { value: c, text: c })));
    on(nameF, 'input', () => { form.name = nameF.value; preview.replaceChildren(previewCard(form)); });
    on(idF, 'input', () => { form.id = slug(idF.value); });
    on(sumF, 'input', () => { form.summary = sumF.value; preview.replaceChildren(previewCard(form)); });

    const preview = h('div');
    const row = (label, control) => h('div.k-row',
      h('div.k-text.t-secondary', { text: label, style: { width: '120px', flex: '0 0 auto' } }), control);

    const target = st.signedIn ? `OpenOS Cloud (@${st.user.handle})` : 'GitHub hesabınız';
    const status = h('div.k-text.t-caption');
    const go = h('button.k-btn.v-primary.s-lg', { html: icon('upload', 14), text: ' Yayınla' });

    on(go, 'click', async () => {
      if (!form.id || !/^[a-z0-9_-]{2,48}$/.test(form.id)) {
        notify.alert('Kimlik yalnızca küçük harf, rakam, - ve _ içerebilir.', { title: 'Geçersiz kimlik', glyph: '⚠️' });
        return;
      }
      go.disabled = true;
      status.textContent = 'Yayınlanıyor…';
      try {
        const source = vfs.read(form.path);
        const res = await cloud.publish({
          id: form.id, name: form.name, source,
          manifest: {
            summary: form.summary, category: catF.value, version: verF.value,
            icon: form.icon, tint: form.tint,
            author: st.signedIn ? st.user.handle : (await new GitHub({ token: cloud.token, repo: cloud.repo }).whoami()).login,
            engine: 'opensharp-1', os: this.ctx.version,
          },
        });
        status.textContent = `Yayınlandı → ${res.where === 'cloud' ? 'OpenOS Cloud' : 'GitHub'}`;
        notify.post({ title: 'Yayınlandı', body: `${form.name} mağazada`, glyph: 'package', tint: ['#0a84ff', '#5e5ce6'] });
        await this.refreshCatalog();
      } catch (e) {
        status.textContent = '';
        notify.alert(e.message, { title: 'Yayınlanamadı', glyph: '⚠️' });
      } finally { go.disabled = false; }
    });

    this.body.append(
      h('div.k-sectitle', { text: 'Kaynak' }),
      h('div.k-group', row('Dosya', select)),
      h('div.k-sectitle', { text: 'Bilgiler' }),
      h('div.k-group',
        row('Ad', h('div.k-field', nameF)),
        row('Kimlik', h('div.k-field', idF)),
        row('Özet', h('div.k-field', sumF)),
        row('Kategori', catF),
        row('Sürüm', h('div.k-field', { style: { width: '120px' } }, verF))),
      h('div.k-sectitle', { text: 'Önizleme' }), preview,
      h('div.k-hstack', { style: { gap: '10px', marginTop: '16px' } },
        go, status, h('div.k-spacer'),
        h('div.k-text.t-caption', { text: 'Hedef: ' + target })));
    applyHeader();
  }

  p_cloud() {
    const st = cloud.status();
    this.body.append(
      h('div.k-hstack', { style: { gap: '14px' } },
        h('div.app-icon', { style: { '--ic1': '#64d2ff', '--ic2': '#0a84ff', width: '52px', height: '52px' },
          html: icon('cloud', 26) }),
        h('div.k-vstack', { style: { gap: '2px' } },
          h('div.k-text.t-title', { text: 'OpenOS Cloud' }),
          h('div.k-text.t-callout', { text: st.signedIn ? `@${st.user.handle} olarak bağlısınız` : 'Hesapsız da kullanabilirsiniz' })),
        h('div.k-spacer'),
        h('span.k-badge', { class: st.mode === 'offline' ? 'b-gray' : 'b-green',
          text: ({ cloud: 'BULUT', github: 'GITHUB', offline: 'ÇEVRİMDIŞI' })[st.mode] })));

    /* ---- account ---- */
    if (st.signedIn) {
      this.body.append(h('div.k-sectitle', { text: 'Hesap' }),
        h('div.k-group',
          this.infoRow('user', 'var(--blue)', st.user.handle, st.user.email),
          h('div.k-row', h('div.k-text.t-secondary', { text: 'Oturum', style: { flex: 1 } }),
            h('button.k-btn.s-sm', { text: 'Çıkış yap', onclick: () => { cloud.signOut(); this.render(); } }))));
    } else if (cloud.hasApi) {
      this.body.appendChild(this.authForm());
    }

    /* Sunucu adresi, depo ve belirteç artık arayüzde yok: bunlar
       uygulamanın kendi ayrıntılarıdır, kullanıcının ayarlayacağı şey değil. */
    this.body.append(
      h('div.k-sectitle', { text: 'Durum' }),
      h('div.k-group',
        this.infoRow('cloud', 'var(--teal)', 'Mağaza',
          ({ cloud: 'OpenOS Cloud’a bağlı', github: 'Yedek katalog', offline: 'Çevrimdışı — yerleşik katalog' })[st.mode]),
        this.infoRow('package', 'var(--purple)', 'Katalog', `${this.catalog.length} uygulama`),
        this.infoRow('upload', 'var(--orange)', 'Yayınlama',
          st.signedIn ? 'hesabınızla açık' : 'giriş yapınca açılır')),
      h('div.k-hstack', { style: { gap: '8px', marginTop: '12px', flexWrap: 'wrap' } },
        h('button.k-btn.s-sm', { html: icon('refresh', 13), text: ' Katalogu yenile',
          onclick: () => this.refreshCatalog() }),
        h('button.k-btn.v-ghost.s-sm', { html: icon('globe', 13), text: ' Web panosu',
          onclick: () => this.ctx.openApp('browser', { url: 'https://m3sto.github.io/openos-cloud/' }) })),
    );
  }

  infoRow(glyph, tint, title, sub) {
    return h('div.k-row', h('div.lead', { style: { background: tint }, html: icon(glyph, 15) }),
      h('div.k-vstack', { style: { flex: 1, gap: '1px' } },
        h('div.k-text', { text: title, style: { fontWeight: 520 } }),
        sub ? h('div.k-text.t-caption', { text: sub }) : null));
  }
  fieldRow(glyph, tint, title, sub, field) {
    return h('div.k-row', h('div.lead', { style: { background: tint }, html: icon(glyph, 15) }),
      h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '1px' } },
        h('div.k-text', { text: title, style: { fontWeight: 520 } }),
        sub ? h('div.k-text.t-caption', { text: sub }) : null),
      h('div.k-field', { style: { width: '270px', flex: '0 0 auto' } }, field));
  }

  signInPrompt(msg) {
    return h('div.k-card', { style: { display: 'grid', gap: '10px', maxWidth: '520px' } },
      h('div.k-text.t-headline', { text: 'Bağlantı gerekiyor' }),
      h('div.k-text.t-callout', { text: msg }),
      h('div.k-hstack', { style: { gap: '8px' } },
        h('button.k-btn.v-primary.s-sm', { text: 'OpenOS Cloud’a bağlan', onclick: () => this.select('cloud') }),
        h('button.k-btn.s-sm', { text: 'GitHub belirteci gir', onclick: () => this.select('cloud') })));
  }

  authForm() {
    let mode = 'login';
    const email = h('input', { type: 'email', placeholder: 'e-posta' });
    const pass = h('input', { type: 'password', placeholder: 'şifre (en az 8 karakter)' });
    const handle = h('input', { placeholder: 'kullanıcı adı' });
    const msg = h('div.k-text.t-caption');
    const submit = h('button.k-btn.v-primary.s-sm', { text: 'Giriş yap' });
    const toggle = h('button.k-btn.v-plain.s-sm', { text: 'Hesabın yok mu? Kaydol' });
    const handleRow = h('div.k-row', h('div.k-text.t-secondary', { text: 'Kullanıcı adı', style: { width: '120px' } }),
      h('div.k-field', handle));
    handleRow.style.display = 'none';

    on(toggle, 'click', () => {
      mode = mode === 'login' ? 'signup' : 'login';
      submit.textContent = mode === 'login' ? 'Giriş yap' : 'Hesap oluştur';
      toggle.textContent = mode === 'login' ? 'Hesabın yok mu? Kaydol' : 'Zaten hesabın var mı? Giriş yap';
      handleRow.style.display = mode === 'login' ? 'none' : '';
    });
    on(submit, 'click', async () => {
      submit.disabled = true; msg.textContent = 'Bağlanılıyor…';
      try {
        if (mode === 'login') await cloud.signIn({ email: email.value, password: pass.value });
        else await cloud.signUp({ email: email.value, password: pass.value, handle: handle.value });
        notify.toast('Bağlandınız', { glyph: '☁️' });
        this.render();
      } catch (e) { msg.textContent = e.message; }
      finally { submit.disabled = false; }
    });

    return h('div', { style: { display: 'grid', gap: '8px' } },
      h('div.k-sectitle', { text: 'OpenOS Cloud hesabı' }),
      h('div.k-group',
        h('div.k-row', h('div.k-text.t-secondary', { text: 'E-posta', style: { width: '120px' } }), h('div.k-field', email)),
        h('div.k-row', h('div.k-text.t-secondary', { text: 'Şifre', style: { width: '120px' } }), h('div.k-field', pass)),
        handleRow),
      h('div.k-hstack', { style: { gap: '8px' } }, submit, toggle, h('div.k-spacer'), msg));
  }

  /* ---------------- grid ---------------- */
  renderGrid() {
    if (!this.grid) return;
    clear(this.grid);
    const list = this.filtered();
    if (this.category) {
      this.grid.appendChild(h('div.k-hstack', { style: { gap: '8px' } },
        h('span.k-badge', { text: this.category }),
        h('button.k-btn.v-plain.s-sm', { text: 'filtreyi kaldır', onclick: () => { this.category = null; this.renderGrid(); } })));
    }
    if (!list.length) {
      this.grid.appendChild(h('div.k-empty', h('div.glyph', { text: '🔍' }),
        h('div.k-text.t-callout', { text: 'Sonuç yok' })));
      return;
    }
    list.forEach(entry => this.grid.appendChild(this.card(entry)));
  }

  card(entry) {
    const installed = this.installedFor(entry);
    const btn = h('button.k-btn.s-sm', {
      class: installed ? '' : 'v-primary',
      text: installed ? 'Aç' : 'Kur',
    });
    on(btn, 'click', () => installed ? this.ctx.openApp(installed.id) : this.install(entry, btn));

    const card = h('div.as-card',
      appIcon({ id: entry.id, glyph: entry.icon, tint: entry.tint }, 52),
      h('div.k-vstack', { style: { flex: 1, gap: '3px', minWidth: 0 } },
        h('div.k-hstack', { style: { gap: '7px' } },
          h('div.k-text.t-headline', { text: entry.name }),
          entry.builtin ? h('span.k-badge.b-gray', { text: 'YERLEŞİK' }) : null,
          entry.remote ? h('span.k-badge', { text: 'BULUT' }) : null),
        h('div.k-text.t-caption', { text: entry.summary || entry.desc || '' }),
        h('div.k-hstack', { style: { gap: '10px', marginTop: '3px' } },
          h('span.k-text.t-caption', { text: entry.category }),
          entry.author ? h('span.k-text.t-caption', { text: '· ' + entry.author }) : null,
          entry.version ? h('span.k-text.t-caption', { text: '· v' + entry.version }) : null,
          entry.size ? h('span.k-text.t-caption', { text: '· ' + fmtBytes(entry.size) }) : null)),
      h('div.k-vstack', { style: { gap: '6px' } }, btn,
        h('button.k-btn.v-ghost.s-sm', { text: 'Kaynak', onclick: () => this.showSource(entry) })));

    contextMenu(card, () => [
      { label: installed ? 'Aç' : 'Kur', glyph: installed ? 'play' : 'download',
        run: () => installed ? this.ctx.openApp(installed.id) : this.install(entry) },
      { label: 'Kaynağı Studio’da aç', glyph: 'code', run: () => this.showSource(entry) },
      ...(installed ? ['-', { label: 'Kaldır', danger: true, glyph: 'trash',
        run: () => this.ctx.os.uninstallApp(installed.id) }] : []),
    ]);
    return card;
  }

  async install(entry, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'İndiriliyor…'; }
    try {
      const source = await cloud.fetchSource(entry);
      const file = VFS.join('/Applications', entry.name.replace(/[^\w .-]/g, '_') + '.osh');
      vfs.write(file, source);
      const app = this.ctx.os.installApp(file);
      app.storeId = entry.id;
      const pinned = settings.get('pinned');
      if (!pinned.includes(app.id)) settings.set('pinned', [...pinned, app.id]);
      if (entry.remote && cloud.hasApi)
        cloud.api(`/v1/apps/${encodeURIComponent(entry.id)}/install`, { method: 'POST' }).catch(() => {});
      notify.post({ title: 'Kuruldu', body: entry.name, glyph: 'package', tint: entry.tint || ['#0a84ff', '#5e5ce6'] });
      this.renderGrid();
    } catch (e) {
      notify.alert(e.message, { title: 'Kurulamadı', glyph: '⚠️' });
      if (btn) { btn.disabled = false; btn.textContent = 'Kur'; }
    }
  }

  async showSource(entry) {
    try {
      const source = await cloud.fetchSource(entry);
      const p = VFS.join(vfs.home, 'Projeler', entry.name + '.osh');
      if (!vfs.exists(p)) vfs.write(p, source);
      this.ctx.openApp('studio', { path: p });
    } catch (e) { notify.alert(e.message, { title: 'Kaynak alınamadı', glyph: '⚠️' }); }
  }
}

/* ---------------------------------------------------------------- bits */
const previewCard = (form) => h('div.as-card',
  h('div.app-icon', { style: { '--ic1': form.tint[0], '--ic2': form.tint[1], width: '52px', height: '52px' },
    html: hasIcon(form.icon) ? icon(form.icon, 26) : form.icon }),
  h('div.k-vstack', { style: { flex: 1, gap: '3px' } },
    h('div.k-text.t-headline', { text: form.name || 'Uygulama adı' }),
    h('div.k-text.t-caption', { text: form.summary || 'Özet yazın…' }),
    h('div.k-text.t-caption', { text: form.id || 'kimlik' })));

const errorCard = (msg) => h('div.k-card', { style: { color: 'var(--red)' } },
  h('div.k-text', { text: '⚠︎ ' + msg }));


