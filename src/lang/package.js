/* ==========================================================================
   OpenOS · lang/package.js — .osapp uygulama paketi

   Bir OpenSharp uygulaması tek bir kaynak dosyadan ibaret olmak zorunda
   değil. Paket, dosya sisteminde sıradan bir klasördür:

     Sayaç.osapp/
       manifest.json     kimlik, sürüm, boyut, izinler, yazar
       main.osh          çalıştırılan kaynak
       icon.png          simge (isteğe bağlı, veri URL'i olarak saklanır)
       README.md         açıklama (isteğe bağlı)

   Klasör olması bilerek: Finder'da açılır, içi okunur, tek dosya kopyalamak
   gibi taşınır ve hiçbir arşiv biçimi öğrenmeyi gerektirmez.
   ========================================================================== */

import vfs, { VFS } from '../core/vfs.js';

export const PAKET_UZANTISI = 'osapp';
export const MANIFEST = 'manifest.json';
export const GIRIS = 'main.osh';
export const SIMGE = 'icon.png';

/** Bir yol paket mi? */
export function paketMi(yol) {
  return VFS.ext(yol) === PAKET_UZANTISI && vfs.isDir(yol)
      && vfs.isFile(VFS.join(yol, MANIFEST));
}

/** Ad → kimlik. Türkçe harfler latin karşılıklarına düşürülür. */
export function kimlikYap(ad) {
  const harita = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u' };
  return String(ad || 'uygulama')
    .toLowerCase()
    .replace(/[çğıİöşü]/g, c => harita[c] || c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'uygulama';
}

/**
 * Paketi diske yazar. Var olan bir paketin üzerine yazmak güvenlidir:
 * yalnızca verilen parçalar değişir, kullanıcının pakete elle eklediği
 * dosyalar olduğu gibi kalır.
 *
 * @param {object} o
 * @param {string} o.dizin     hedef klasör (…/Ad.osapp)
 * @param {string} o.kaynak    main.osh içeriği
 * @param {object} o.manifest
 * @param {string} [o.simge]   veri URL'i (data:image/…)
 * @param {string} [o.benioku]
 * @returns {string} paketin yolu
 */
export function paketYaz({ dizin, kaynak, manifest, simge, benioku }) {
  vfs.mkdir(dizin);
  const tam = {
    bicim: 1,
    id: manifest.id || kimlikYap(manifest.name),
    name: manifest.name || 'Adsız',
    version: manifest.version || '1.0.0',
    entry: GIRIS,
    ...manifest,
    derlendi: new Date().toISOString(),
  };
  vfs.writeJSON(VFS.join(dizin, MANIFEST), tam);
  vfs.write(VFS.join(dizin, GIRIS), kaynak ?? '');
  if (simge) vfs.write(VFS.join(dizin, SIMGE), simge, { encoding: 'dataurl' });
  if (benioku) vfs.write(VFS.join(dizin, 'README.md'), benioku);
  return dizin;
}

/** Paketi okur. Bozuksa `null` döner — çağıran tek dosya yoluna düşebilir. */
export function paketOku(dizin) {
  if (!paketMi(dizin)) return null;
  const manifest = vfs.readJSON(VFS.join(dizin, MANIFEST), null);
  if (!manifest) return null;
  const girisYolu = VFS.join(dizin, manifest.entry || GIRIS);
  let kaynak = '';
  try { kaynak = vfs.read(girisYolu); } catch { return null; }
  let simge = null;
  const simgeYolu = VFS.join(dizin, SIMGE);
  if (vfs.isFile(simgeYolu)) { try { simge = vfs.read(simgeYolu); } catch {} }
  return { dizin, manifest, kaynak, girisYolu, simge };
}

/**
 * Paketin tutarlılığını denetler. Kurulumdan önce çalışır; bulduğu her sorunu
 * insan diliyle döndürür, sessizce düzeltmeye çalışmaz.
 * @returns {{alan:string, ileti:string}[]}
 */
export function manifestiDenetle(m = {}) {
  const sorunlar = [];
  const ekle = (alan, ileti) => sorunlar.push({ alan, ileti });

  if (!m.name || !String(m.name).trim()) ekle('name', 'Uygulama adı boş olamaz.');
  else if (String(m.name).length > 40) ekle('name', 'Ad 40 karakterden uzun olamaz.');

  if (!m.id) ekle('id', 'Kimlik boş olamaz.');
  else if (!/^[a-z][a-z0-9-]{1,39}$/.test(m.id)) {
    ekle('id', 'Kimlik küçük harfle başlamalı; yalnızca küçük harf, rakam ve tire içerebilir.');
  }

  if (!/^\d+\.\d+\.\d+$/.test(m.version || '')) ekle('version', 'Sürüm 1.0.0 biçiminde olmalı.');

  for (const [alan, en, ust] of [['width', 240, 2000], ['height', 180, 1400]]) {
    const v = Number(m[alan]);
    if (m[alan] != null && (!Number.isFinite(v) || v < en || v > ust)) {
      ekle(alan, `${alan === 'width' ? 'Genişlik' : 'Yükseklik'} ${en}–${ust} arasında olmalı.`);
    }
  }
  if (m.tint && (!Array.isArray(m.tint) || m.tint.length !== 2)) {
    ekle('tint', 'Renk iki değerli bir dizi olmalı: ["#aabbcc", "#112233"].');
  }
  return sorunlar;
}

export default { paketYaz, paketOku, paketMi, manifestiDenetle, kimlikYap, PAKET_UZANTISI };
