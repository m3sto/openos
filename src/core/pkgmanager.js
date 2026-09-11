/* ==========================================================================
   OpenOS · core/pkgmanager.js — paket yöneticisi

   Tek bir yerden: kurulu uygulamaları listeler, mağazadan ya da dosya
   sisteminden paket kurar, kaldırır, günceller ve bir paketin sağlamlığını
   denetler. Terminal (`pkg`), App Store ve Studio aynı çekirdeği kullanır —
   böylece "mağazadan kurulan uygulama terminalden kaldırılabilir".

   Yayınlanmamış, imzasız bir paket de kurulabilir: dosya sisteminde duran
   herhangi bir `.osapp` klasörü ya da tek `.osh` dosyası geçerli bir
   kaynaktır. Kurulum, paketin nereden geldiğini kaydeder; gizlenmez.
   ========================================================================== */

import vfs, { VFS } from './vfs.js';
import registry from './registry.js';
import notify from './notify.js';
import settings from './settings.js';
import { paketOku, paketMi, paketYaz, manifestiDenetle, kimlikYap, PAKET_UZANTISI } from '../lang/package.js';

export const UYGULAMALAR = '/Applications';

/** Kurulum kaydı: hangi paket nereden, ne zaman kuruldu. */
const DEFTER = '/Users/shared/.pkg/defter.json';

function defterOku() { return vfs.readJSON(DEFTER, {}) || {}; }
function defterYaz(d) { vfs.mkdir(VFS.dirname(DEFTER)); vfs.writeJSON(DEFTER, d); }

class PackageManager {
  /** Kurulu OpenSharp uygulamaları — sistemin yerli uygulamaları hariç. */
  list() {
    const defter = defterOku();
    return registry.all()
      .filter(a => a.kind === 'opensharp')
      .map(a => {
        const kayit = defter[a.id] || {};
        return {
          id: a.id,
          ad: a.name,
          surum: a.version || kayit.surum || '—',
          paket: a.packagePath || null,
          kaynak: a.source || null,
          nereden: kayit.nereden || (a.packagePath ? 'yerel paket' : 'yerel dosya'),
          kuruldu: kayit.kuruldu || null,
          yazar: kayit.yazar || null,
        };
      })
      .sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
  }

  get(id) { return this.list().find(p => p.id === id) || null; }

  /**
   * Bir paketi denetler. Kurmadan önce ne olduğunu söyler; sorunları
   * gizlemek yerine sayar.
   * @param {string} yol  .osapp klasörü ya da .osh dosyası
   */
  inspect(yol) {
    if (paketMi(yol)) {
      const p = paketOku(yol);
      if (!p) return { gecerli: false, sorunlar: [{ alan: 'manifest', ileti: 'manifest.json okunamadı.' }] };
      const sorunlar = manifestiDenetle(p.manifest);
      if (!p.kaynak.trim()) sorunlar.push({ alan: 'entry', ileti: 'Giriş dosyası boş.' });
      return {
        gecerli: sorunlar.length === 0,
        tur: 'paket', yol,
        manifest: p.manifest,
        simgeVar: !!p.simge,
        boyut: this.boyut(yol),
        sorunlar,
      };
    }
    if (vfs.isFile(yol) && VFS.ext(yol) === 'osh') {
      let kaynak = '';
      try { kaynak = vfs.read(yol); } catch { return { gecerli: false, sorunlar: [{ alan: 'dosya', ileti: 'Okunamadı.' }] }; }
      const ad = VFS.basename(yol).replace(/\.osh$/, '');
      return {
        gecerli: !!kaynak.trim(),
        tur: 'dosya', yol,
        manifest: { id: kimlikYap(ad), name: ad, version: '—' },
        simgeVar: false,
        boyut: kaynak.length,
        sorunlar: kaynak.trim() ? [] : [{ alan: 'dosya', ileti: 'Dosya boş.' }],
      };
    }
    return { gecerli: false, sorunlar: [{ alan: 'yol', ileti: `Paket ya da .osh dosyası değil: ${yol}` }] };
  }

  boyut(dizin) {
    let toplam = 0;
    try { vfs.walk(dizin, s => { if (s.type === 'file') toplam += s.size || 0; }); } catch {}
    return toplam;
  }

  /**
   * Kurar. Kaynak bir `.osapp` klasörü, bir `.osh` dosyası ya da doğrudan
   * kaynak metin olabilir.
   *
   * @param {object} o
   * @param {string} [o.yol]      kurulacak paketin yolu
   * @param {string} [o.kaynak]   doğrudan kaynak metin (mağaza indirmesi)
   * @param {object} [o.manifest] kaynakla birlikte verilen manifest
   * @param {string} [o.nereden]  'mağaza' | 'yerel' | 'bağlantı' …
   * @param {boolean}[o.pinle]    Dock'a iliştir
   */
  install({ yol, kaynak, manifest, nereden = 'yerel', pinle = true, sessiz = false } = {}) {
    let hedef = yol;

    /* Kaynak metinden kuruluyorsa önce diske bir paket yazılır — kurulan
       her şey dosya sisteminde görünür olmalı, bellekte kalmamalı. */
    if (!hedef && kaynak != null) {
      const m = { ...(manifest || {}) };
      m.name = m.name || 'Adsız';
      m.id = m.id || kimlikYap(m.name);
      m.version = m.version || '1.0.0';
      hedef = VFS.join(UYGULAMALAR, `${m.name}.${PAKET_UZANTISI}`);
      paketYaz({ dizin: hedef, kaynak: String(kaynak), manifest: m, simge: m.iconData || null });
    }

    const bilgi = this.inspect(hedef);
    if (!bilgi.gecerli) {
      const e = new Error(bilgi.sorunlar.map(s => s.ileti).join(' '));
      e.sorunlar = bilgi.sorunlar;
      throw e;
    }

    /* Kurulum yeri /Applications değilse oraya kopyalanır; kaynağı silinmez. */
    if (!hedef.startsWith(UYGULAMALAR + '/')) {
      const ad = VFS.basename(hedef);
      const kopya = VFS.join(UYGULAMALAR, ad);
      vfs.mkdir(UYGULAMALAR);
      if (vfs.exists(kopya)) vfs.remove(kopya);
      vfs.copy(hedef, kopya);
      hedef = kopya;
    }

    const app = this.kernel.installApp(hedef, { silent: true });

    const defter = defterOku();
    defter[app.id] = {
      nereden, kuruldu: Date.now(),
      surum: bilgi.manifest.version,
      yazar: bilgi.manifest.author || null,
      yol: hedef,
    };
    defterYaz(defter);

    if (pinle) {
      const pinned = settings.get('pinned') || [];
      if (!pinned.includes(app.id)) settings.set('pinned', [...pinned, app.id]);
    }
    if (!sessiz) {
      notify.post({ title: 'Uygulama kuruldu', body: `${app.name} · ${nereden}`,
                    glyph: 'package', tint: app.tint });
    }
    return { app, yol: hedef, manifest: bilgi.manifest };
  }

  /**
   * Kaldırır. Paketin dosyalarını da siler; uygulamanın kendi verisi
   * (`store_set` ile yazdıkları) isteğe bağlı olarak korunur.
   */
  remove(id, { veriyiDeSil = false } = {}) {
    const app = registry.get(id);
    if (!app || app.kind !== 'opensharp') {
      throw new Error(`Kurulu bir OpenSharp uygulaması değil: ${id}`);
    }
    const silinen = [];
    const hedef = app.packagePath || app.source;
    if (hedef && vfs.exists(hedef)) { vfs.remove(hedef); silinen.push(hedef); }

    if (veriyiDeSil) {
      const veri = `/Users/shared/.appdata/${id}.json`;
      if (vfs.exists(veri)) { vfs.remove(veri); silinen.push(veri); }
    }

    registry.unregister(id);
    const pinned = (settings.get('pinned') || []).filter(p => p !== id);
    settings.set('pinned', pinned);

    const defter = defterOku();
    delete defter[id];
    defterYaz(defter);

    return { id, ad: app.name, silinen };
  }

  /** Kurulu bir paketin kaynağını yeni sürümle değiştirir. */
  update(id, { kaynak, manifest }) {
    const mevcut = registry.get(id);
    if (!mevcut) throw new Error(`Kurulu değil: ${id}`);
    const paketYolu = mevcut.packagePath;
    if (!paketYolu) {
      /* Tek dosyaysa yalnızca kaynağı yenilenir. */
      vfs.write(mevcut.source, String(kaynak));
      this.kernel.installApp(mevcut.source, { silent: true });
      return { id, surum: manifest?.version || '—' };
    }
    const eski = paketOku(paketYolu);
    paketYaz({
      dizin: paketYolu,
      kaynak: String(kaynak),
      manifest: { ...(eski?.manifest || {}), ...(manifest || {}) },
      simge: manifest?.iconData || eski?.simge || null,
    });
    this.kernel.installApp(paketYolu, { silent: true });
    const defter = defterOku();
    defter[id] = { ...(defter[id] || {}), surum: manifest?.version, guncellendi: Date.now() };
    defterYaz(defter);
    return { id, surum: manifest?.version || '—' };
  }
}

const pkg = new PackageManager();
export default pkg;
