/* ==========================================================================
   OpenOS · core/permissions.js — uygulama izinleri

   Sorun: OpenSharp uygulamaları standart kitaplıkta `guard('fs', …)` ile
   korunan işlevler kullanıyor, ama izin listesi hiç verilmediği için
   varsayılan "hepsi açık"tı. Paket yöneticisi imzasız, yayınlanmamış bir
   paketi kurabildiğine göre bu, indirdiğiniz herhangi bir uygulamanın bütün
   dosyalarınızı okuyup ağa gönderebilmesi demekti.

   Artık her uygulamanın izinleri ayrı tutuluyor, kurulumda ne istediği
   gösteriliyor ve kullanıcı istediği an kapatabiliyor.

   Tasarım kararı: izinler *kapalı* değil, *sorulmuş* olarak başlar.
   Manifestinde izin bildiren uygulama kurulurken onaylanır; bildirmeyen
   eski uygulamalar dosya ve uygulama iznini alır ama **ağ iznini almaz** —
   ağ, verinin dışarı çıkabildiği tek kapı olduğu için açıkça istenmeli.
   ========================================================================== */

import vfs, { VFS } from './vfs.js';
import { Bus } from './util.js';

const DOSYA = '/Users/shared/.pkg/izinler.json';

/** Tanımlı izinler; arayüz bu listeyi olduğu gibi gösterir. */
export const IZINLER = [
  { kod: 'fs', ad: 'Dosyalar', glyph: 'folder',
    aciklama: 'Dosyalarınızı okuyabilir ve yazabilir.',
    risk: 'orta' },
  { kod: 'net', ad: 'Ağ', glyph: 'globe',
    aciklama: 'İnternete istek gönderebilir — verinizi dışarı taşıyabilir.',
    risk: 'yüksek' },
  { kod: 'apps', ad: 'Uygulamalar', glyph: 'apps',
    aciklama: 'Başka uygulamaları açabilir.',
    risk: 'düşük' },
];

const KODLAR = IZINLER.map(i => i.kod);

class Permissions {
  constructor() { this.bus = new Bus(); this._onbellek = null; }

  _oku() {
    if (!this._onbellek) this._onbellek = vfs.readJSON(DOSYA, {}) || {};
    return this._onbellek;
  }

  _yaz(d) {
    this._onbellek = d;
    vfs.mkdir(VFS.dirname(DOSYA));
    vfs.writeJSON(DOSYA, d);
  }

  /**
   * Bir uygulamanın geçerli izinleri.
   * @returns {{fs:boolean, net:boolean, apps:boolean}}
   */
  get(appId) {
    const kayit = this._oku()[appId];
    if (kayit) return { ...varsayilan(), ...kayit.izinler };
    return varsayilan();
  }

  /** Tek bir izni açar/kapatır. */
  set(appId, kod, deger) {
    if (!KODLAR.includes(kod)) throw new Error('Bilinmeyen izin: ' + kod);
    const d = this._oku();
    const kayit = d[appId] || { izinler: varsayilan(), guncel: 0 };
    kayit.izinler = { ...varsayilan(), ...kayit.izinler, [kod]: !!deger };
    kayit.guncel = Date.now();
    d[appId] = kayit;
    this._yaz(d);
    this.bus.emit('change', appId, kayit.izinler);
    return kayit.izinler;
  }

  /** Kurulumda manifestten gelen isteği kaydeder. */
  grant(appId, istenen = []) {
    const d = this._oku();
    const izinler = varsayilan();
    for (const kod of istenen) if (KODLAR.includes(kod)) izinler[kod] = true;
    d[appId] = { izinler, guncel: Date.now(), istenen: istenen.filter(k => KODLAR.includes(k)) };
    this._yaz(d);
    this.bus.emit('change', appId, izinler);
    return izinler;
  }

  /** Uygulamanın manifestinde bildirdiği istekler. */
  requested(appId) { return this._oku()[appId]?.istenen || null; }

  /** Uygulama kaldırılınca kaydı da gitsin. */
  forget(appId) {
    const d = this._oku();
    if (!d[appId]) return;
    delete d[appId];
    this._yaz(d);
    this.bus.emit('change', appId, null);
  }

  /** İzin kaydı olan bütün uygulamalar — Ayarlar bunu listeler. */
  all() { return { ...this._oku() }; }
}

/**
 * Bildirim yapmamış uygulamanın varsayılanı. Ağ bilerek kapalı: dosya
 * okumak kötü niyetli bir uygulamayı zararlı yapmaz, okuduğunu dışarı
 * gönderebilmek yapar.
 */
function varsayilan() { return { fs: true, apps: true, net: false }; }

const permissions = new Permissions();
export default permissions;
