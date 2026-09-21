/* ==========================================================================
   OpenOS · apps/storage.js — Depolama Analizi
   Sanal dosya sistemini tarar, yeri neyin kapladığını ağaç haritasıyla
   gösterir ve büyük/eski dosyaları ayıklamayı kolaylaştırır.
   ========================================================================== */

import { h, clear, on, fmtBytes, relTime } from '../core/util.js';
import { icon } from '../core/icons.js';
import { contextMenu } from '../ui/menu.js';
import vfs, { VFS } from '../core/vfs.js';
import vault from '../core/vault.js';
import notify from '../core/notify.js';

export default {
  id: 'storage', name: 'Depolama Analizi', glyph: 'database', tint: ['#40c8e0', '#0a7b96'],
  category: 'util', width: 880, height: 620, minWidth: 520, minHeight: 400,
  keywords: ['depolama', 'disk', 'analiz', 'yer', 'temizlik'],
  about: 'Yeri neyin kapladığını gösterir ve temizlemeyi kolaylaştırır.',
  mount(ctx) { return new Storage(ctx).el; },
};

const PALETTE = ['#0a84ff', '#bf5af2', '#30d158', '#ff9f0a', '#ff375f',
                 '#64d2ff', '#5e5ce6', '#ac8e68', '#40c8e0', '#8e8e93'];

class Storage {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = '/';
    this.sidebar = h('div.sidebar', { style: { width: '200px' } });
    this.body = h('div.content.k-scroll', { style: { padding: '18px 20px', gap: '14px' } });
    this.el = h('div.app-shell', this.sidebar, this.body);
    contextMenu(this.el, () => [
      { header: 'Depolama' },
      { label: 'Yeniden tara', glyph: 'refresh', run: () => this.render() },
      { label: 'Çöp kutusunu boşalt', glyph: 'trash', danger: true, run: () => this.emptyTrash() },
      { label: 'Finder’da aç', glyph: 'folder', run: () => this.ctx.openApp('finder', { path: this.root }) },
    ]);
    this.render();
  }

  /** Bir klasörün toplam boyutunu ve dosya sayısını özyinelemeli hesaplar. */
  measure(path) {
    let bytes = 0, files = 0, dirs = 0, newest = 0;
    let items;
    try { items = vfs.list(path); } catch { return { bytes, files, dirs, newest }; }
    for (const s of items) {
      if (s.type === 'dir') {
        dirs++;
        const sub = this.measure(s.path);
        bytes += sub.bytes; files += sub.files; dirs += sub.dirs;
        newest = Math.max(newest, sub.newest);
      } else {
        files++; bytes += s.size; newest = Math.max(newest, s.modified);
      }
    }
    return { bytes, files, dirs, newest };
  }

  /**
   * Şifreleme durumu. Eskiden şifresizlik tek bir nedenle açıklanıyordu
   * ("bu tarayıcı desteklemiyor"); oysa en sık neden anahtar
   * veritabanının bozulması ve bunun çözümü farklı. Durum kasadan
   * okunuyor ve onarılabilir olan hâller için düğme gösteriliyor.
   */
  /**
   * Diskin nerede durduğu. Kullanıcı "verilerim tarayıcıda mı, klasörümde mi"
   * sorusunun cevabını görebilmeli — bu, sistemin en temel sözlerinden biri
   * ve tahmine bırakılamaz.
   */
  konumSatiri() {
    const k = vfs.konum;
    const klasorde = k.tur === 'klasor';
    return h('div.k-row',
      h('span.ic', { html: icon('hardDrive', 15),
        style: { color: klasorde ? 'var(--green, #30d158)' : 'var(--orange, #ff9f0a)' } }),
      h('div', { style: { flex: 1 } },
        h('div.k-text', { text: klasorde ? `Disk: ${k.ad}` : 'Disk: tarayıcı deposu' }),
        h('div.k-text.t-caption', {
          text: klasorde
            ? 'Seçtiğiniz klasörde `openos.disk` olarak duruyor. Tarayıcı verilerini temizlemek onu silmez.'
            : 'Tarayıcının deposunda. Site verileri temizlenirse silinir ve birkaç megabaytla sınırlıdır — kalıcı bir disk için sistemi yeniden başlatıp makine ekranından klasör seçin.' })));
  }

  guvenlikSatiri() {
    const d = vault.durum;
    const sifreli = vfs.sifreli && d.ok;

    return h('div.k-row',
      h('span.ic', { html: icon(sifreli ? 'lock' : 'unlock', 15),
        style: { color: sifreli ? 'var(--green, #30d158)'
                : d.kod === 'depo-bozuk' ? 'var(--red)' : 'var(--orange, #ff9f0a)' } }),
      h('div', { style: { flex: 1 } },
        h('div.k-text', { text: sifreli ? 'Disk şifreli' : 'Disk şifresiz' }),
        h('div.k-text.t-caption', {
          text: sifreli
            ? 'AES-256-GCM · anahtar bu cihazda, dışa aktarılamaz. Depolamayı doğrudan okuyan ya da elle kurcalayan erişime kapalı.'
            : (d.ileti || 'Anahtar kasası açılamadı.') })),
      d.kod === 'depo-bozuk' || (!sifreli && d.kod === 'bilinmeyen')
        ? h('button.k-btn.s-sm', { text: 'Onar', onclick: () => this.kasayiOnar() })
        : null);
  }

  /** Anahtar kasasını yeniden kurar ve diski şifreli olarak tazeler. */
  async kasayiOnar() {
    const ok = await notify.confirm(
      'Anahtar kasası yeniden kurulacak ve disk şifreli olarak yeniden yazılacak. ' +
      'Dosyalarınız olduğu yerde kalır.',
      { title: 'Şifrelemeyi onar', ok: 'Onar', root: this.el });
    if (!ok) return;
    try {
      const acildi = await vault.onar();
      if (!acildi) throw new Error(vault.durum.ileti);
      vfs._sifresizUyarildi = false;
      await vfs.persist();
      await vfs.flush();
      notify.post({ title: 'Şifreleme onarıldı',
        body: vfs.sifreli ? 'Disk artık şifreli saklanıyor.' : 'Kasa açıldı ama disk hâlâ şifresiz.',
        glyph: 'lock' });
    } catch (e) {
      notify.toast('Onarılamadı: ' + e.message, { glyph: '⚠️' });
    }
    this.render?.();
    this.refresh?.();
  }

  /**
   * Yedeği bir dosya olarak indirir. Tarayıcının indirme akışı kullanılır;
   * yedek düz JSON'dur ki başka bir cihazda okunabilsin.
   */
  yedekAl() {
    let paket;
    try { paket = vfs.export(); }
    catch (e) { return notify.toast('Yedek alınamadı: ' + e.message, { glyph: '⚠️' }); }

    const metin = JSON.stringify(paket);
    const tarih = new Date().toISOString().slice(0, 10);
    const ad = `openos-${tarih}.osbackup`;
    const blob = new Blob([metin], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: ad });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);

    /* Ana bilgisayara inen dosyanın yanında sanal diske de bir kopya bırakılır:
       indirme engellenmiş olsa bile yedek kaybolmasın. */
    try {
      const klasor = VFS.join(vfs.home, 'İndirilenler');
      vfs.mkdir(klasor);
      vfs.write(VFS.join(klasor, ad), metin);
    } catch {}

    notify.post({
      title: 'Yedek alındı',
      body: `${paket.ozet.dosya} dosya · ${fmtBytes(metin.length)} · ${ad}`,
      glyph: 'save',
      actions: [{ label: 'İndirilenler', run: () => this.ctx.openApp('finder', { path: VFS.join(vfs.home, 'İndirilenler') }) }],
    });
  }

  /** Yedek dosyasını seçtirir ve kipi sorar. */
  yedektenYukle() {
    const secici = h('input', { type: 'file', accept: '.osbackup,.json,application/json',
      style: { display: 'none' } });
    document.body.appendChild(secici);
    on(secici, 'change', async () => {
      const dosya = secici.files?.[0];
      secici.remove();
      if (!dosya) return;

      let paket;
      try { paket = JSON.parse(await dosya.text()); }
      catch { return notify.toast('Dosya okunamadı ya da geçerli JSON değil', { glyph: '⚠️' }); }
      if (paket?.bicim !== 'openos-backup') {
        return notify.toast('Bu bir OpenOS yedeği değil', { glyph: '⚠️' });
      }

      const ozet = paket.ozet || {};
      const ne = `${ozet.dosya ?? '?'} dosya · ${fmtBytes(ozet.bayt || 0)} · ` +
                 `${new Date(paket.olusturma).toLocaleString('tr-TR')}`;
      const secim = await notify.choose(
        `Yedek: ${ne}\n\nBirleştirmek yedektekileri ekler ve aynı adlıların üzerine yazar. ` +
        `Değiştirmek diskteki her şeyi siler ve yedeğin aynısını kurar.`,
        { title: 'Yedekten geri yükle', glyph: '💾', root: this.el, buttons: [
          { label: 'Birleştir', value: 'birlestir', variant: 'primary' },
          { label: 'Diski Değiştir', value: 'degistir', variant: 'danger' },
          { label: 'Vazgeç', value: null },
        ] });
      if (!secim) return;

      if (secim === 'degistir') {
        const ok = await notify.confirm(
          'Diskteki bütün dosyalar silinecek ve yerine yedektekiler konacak. Bu işlem geri alınamaz.',
          { title: 'Emin misiniz?', ok: 'Diski Değiştir', danger: true, root: this.el });
        if (!ok) return;
      }

      try {
        const r = vfs.import(paket, { kip: secim });
        notify.post({ title: 'Yedek geri yüklendi',
          body: `${r.dosya} dosya, ${r.klasor} klasör`, glyph: 'check' });
        this.refresh?.();
        this.render?.();
      } catch (e) {
        notify.toast('Geri yüklenemedi: ' + e.message, { glyph: '⚠️' });
      }
    });
    secici.click();
  }

  render() {
    const total = this.measure('/');
    let top = [];
    try {
      top = vfs.list(this.root).map(s => ({
        ...s,
        total: s.type === 'dir' ? this.measure(s.path) : { bytes: s.size, files: 1, dirs: 0, newest: s.modified },
      })).sort((a, b) => b.total.bytes - a.total.bytes);
    } catch {}

    /* ---- kenar çubuğu ---- */
    clear(this.sidebar);
    this.sidebar.appendChild(h('div.sb-title', { text: 'Konum' }));
    [['/', 'Kök'], [vfs.home, 'Ana Klasör'], ['/Applications', 'Uygulamalar'],
     [VFS.join(vfs.home, 'Projeler'), 'Projeler'], [VFS.join(vfs.home, '.Trash'), 'Çöp Kutusu']]
      .forEach(([p, label]) => {
        if (!vfs.exists(p)) return;
        this.sidebar.appendChild(h('div.sb-item', { class: p === this.root ? 'on' : '',
          onclick: () => { this.root = p; this.render(); } },
          h('span.ic', { html: icon('folder', 13) }), h('span.ellipsis', { text: label })));
      });
    this.sidebar.append(h('div.k-spacer'),
      h('div.k-text.t-caption', { style: { padding: '10px 10px 14px', lineHeight: 1.6 },
        text: `Toplam\n${fmtBytes(total.bytes)}\n${total.files} dosya · ${total.dirs} klasör` }));

    /* ---- gövde ---- */
    clear(this.body);
    const maxB = top.length ? Math.max(...top.map(t => t.total.bytes), 1) : 1;

    /* ağaç haritası: alanlar boyutla orantılı */
    const map = h('div.stg-map');
    const sum = top.reduce((a, t) => a + t.total.bytes, 0) || 1;
    top.filter(t => t.total.bytes > 0).slice(0, 10).forEach((t, i) => {
      const pct = (t.total.bytes / sum) * 100;
      map.appendChild(h('div.stg-tile', {
        style: { flexGrow: String(Math.max(pct, 2)), background: PALETTE[i % PALETTE.length] },
        title: `${t.name} — ${fmtBytes(t.total.bytes)} (%${pct.toFixed(1)})`,
        onclick: () => { if (t.type === 'dir') { this.root = t.path; this.render(); } },
      }, pct > 7 ? h('span', { text: t.name }) : null));
    });

    this.body.append(
      h('div.k-hstack', { style: { gap: '10px' } },
        h('div.k-vstack', { style: { flex: 1, gap: '2px' } },
          h('div.k-text.t-title', { text: 'Depolama Analizi' }),
          h('div.k-text.t-callout', { text: this.root })),
        this.root !== '/' ? h('button.k-btn.s-sm', { text: 'Üst klasör',
          onclick: () => { this.root = VFS.dirname(this.root); this.render(); } }) : null,
        h('button.k-btn.s-sm', { html: icon('refresh', 13), text: ' Tara', onclick: () => this.render() })),
      map,
      h('div.k-sectitle', { text: 'Yedekleme' }),
      h('div.k-group',
        h('div.k-row',
          h('span.ic', { html: icon('save', 15), style: { color: 'var(--accent)' } }),
          h('div', { style: { flex: 1 } },
            h('div.k-text', { text: 'Diskin yedeğini al' }),
            h('div.k-text.t-caption', {
              text: 'Disk bu tarayıcıya bağlı bir anahtarla şifreli. Yedek taşınabilir bir dosyadır: başka bir tarayıcıda ya da başka bir makinede geri yüklenebilir.' })),
          h('button.k-btn.s-sm', { text: 'Yedek Al', onclick: () => this.yedekAl() })),
        h('div.k-row',
          h('span.ic', { html: icon('upload', 15), style: { color: 'var(--orange, #ff9f0a)' } }),
          h('div', { style: { flex: 1 } },
            h('div.k-text', { text: 'Yedekten geri yükle' }),
            h('div.k-text.t-caption', { text: 'Birleştir: yedektekiler eklenir. Değiştir: disk tamamen yedeğe döner.' })),
          h('button.k-btn.s-sm', { text: 'Dosya Seç…', onclick: () => this.yedektenYukle() }))),
      h('div.k-sectitle', { text: 'Güvenlik' }),
      h('div.k-group', this.konumSatiri(), this.guvenlikSatiri()),
      h('div.k-sectitle', { text: 'Yeri kaplayanlar' }),
    );

    const list = h('div.k-group');
    if (!top.length) list.appendChild(h('div.k-row', h('div.k-text.t-caption', { text: 'Bu klasör boş' })));
    top.forEach((t, i) => {
      const pct = (t.total.bytes / maxB) * 100;
      const row = h('div.k-row',
        h('div.lead', { style: { background: PALETTE[i % PALETTE.length] },
          html: icon(t.type === 'dir' ? 'folder' : 'file', 15) }),
        h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '3px' } },
          h('div.k-hstack', { style: { gap: '8px' } },
            h('div.k-text.ellipsis', { text: t.name, style: { fontWeight: 520, flex: 1 } }),
            h('div.k-text.t-caption', { text: t.type === 'dir'
              ? `${t.total.files} dosya` : (t.ext || 'dosya') })),
          h('div.k-progress', { style: { height: '4px' } },
            h('i', { style: { width: Math.max(2, pct) + '%',
              background: PALETTE[i % PALETTE.length] } }))),
        h('div.k-vstack', { style: { alignItems: 'flex-end', gap: '1px' } },
          h('div.k-text', { text: fmtBytes(t.total.bytes), style: { fontWeight: 560 } }),
          h('div.k-text.t-caption', { text: t.total.newest ? relTime(t.total.newest, 'tr') : '' })));
      if (t.type === 'dir') { row.classList.add('tappable'); on(row, 'click', () => { this.root = t.path; this.render(); }); }
      contextMenu(row, () => [
        { label: 'Finder’da göster', glyph: 'folder',
          run: () => this.ctx.openApp('finder', { path: t.type === 'dir' ? t.path : VFS.dirname(t.path) }) },
        ...(t.type === 'file' ? [{ label: 'Aç', glyph: 'file', run: () => this.ctx.openPath(t.path) }] : []),
        '-',
        { label: 'Çöp kutusuna at', glyph: 'trash', danger: true, run: () => {
          this.ctx.os.trash(t.path); this.render(); } },
      ]);
      list.appendChild(row);
    });
    this.body.appendChild(list);

    /* ---- temizlik önerileri ---- */
    const big = [];
    vfs.walk('/', s => { if (s.type === 'file' && s.size > 2048) big.push(s); });
    big.sort((a, b) => b.size - a.size);
    const trashPath = VFS.join(vfs.home, '.Trash');
    const trash = vfs.exists(trashPath) ? this.measure(trashPath) : { bytes: 0, files: 0 };

    this.body.append(
      h('div.k-sectitle', { text: 'Temizlik' }),
      h('div.k-group',
        h('div.k-row',
          h('div.lead', { style: { background: 'var(--orange)' }, html: icon('trash', 15) }),
          h('div.k-vstack', { style: { flex: 1, gap: '1px' } },
            h('div.k-text', { text: 'Çöp kutusu', style: { fontWeight: 520 } }),
            h('div.k-text.t-caption', { text: `${trash.files} öğe · ${fmtBytes(trash.bytes)}` })),
          h('button.k-btn.s-sm', { text: 'Boşalt', disabled: !trash.files, onclick: () => this.emptyTrash() })),
        ...big.slice(0, 5).map(s => h('div.k-row',
          h('div.lead', { style: { background: 'var(--gray)' }, html: icon('file', 15) }),
          h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '1px' } },
            h('div.k-text.ellipsis', { text: s.name, style: { fontWeight: 520 } }),
            h('div.k-text.t-caption.ellipsis', { text: s.path })),
          h('div.k-text.t-secondary', { text: fmtBytes(s.size) }),
          h('button.k-btn.v-ghost.icon.s-sm', { html: icon('trash', 13),
            onclick: () => { this.ctx.os.trash(s.path); this.render(); } })))),
      h('div.k-text.t-caption', { style: { lineHeight: 1.7 },
        text: 'OpenOS’un tüm dosya sistemi tarayıcının yerel deposunda durur. Tarayıcı yer sıkıştığında ' +
              'geçici depolamayı uyarmadan silebilir — Grafik İşletici’den kalıcı depolama isteyin.' }),
      h('button.k-btn.s-sm', { text: 'Grafik İşletici → Bellek',
        onclick: () => this.ctx.openApp('graphics', { pane: 'memory' }) }));
  }

  async emptyTrash() {
    const p = VFS.join(vfs.home, '.Trash');
    if (!(await notify.confirm('Çöp kutusundaki her şey kalıcı olarak silinecek.',
      { title: 'Çöp Kutusunu Boşalt', danger: true, ok: 'Sil' }))) return;
    try { vfs.list(p).forEach(s => vfs.remove(s.path)); } catch {}
    notify.toast('Çöp kutusu boşaltıldı', { glyph: '🗑️' });
    this.render();
  }
}
