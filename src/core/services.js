/* ==========================================================================
   OpenOS · core/services.js — arka plan servisleri

   Bir uygulamanın penceresi kapalıyken de çalışması gereken işler var:
   alarmın çalması, geri sayımın bitmesi, bir indirmenin sürmesi, bir
   OpenSharp uygulamasının zamanlanmış görevi. Bunlar uygulamanın kendi
   `setInterval`'ına bağlı olamaz — pencere kapanınca o zamanlayıcı da
   ölüyor ve alarm hiç çalmıyordu.

   Servis, uygulamadan bağımsız yaşar: çekirdek açılışta kaydeder, sistem
   kapanana kadar çalıştırır. Uygulama penceresi yalnızca aynı veriyi
   *gösterir*; işi yapan burasıdır.

   Zamanlayıcı seçimi bilerek `setInterval`: `requestAnimationFrame` arka
   plandaki sekmede tamamen duruyor — bu sistemde daha önce OpenSharp'ın
   donmasına ve Canvas'ın hiç çizilmemesine yol açmıştı. `setInterval` de
   kısılır (gizli sekmede en az bir saniyeye çekilir) ama durmaz; bu yüzden
   hiçbir servisin aralığı bir saniyenin altında olmamalı ve her servis
   "kaç kez çalıştığıma değil, saate bakarım" diye yazılmalı.
   ========================================================================== */

import { Bus } from './util.js';

class Services {
  constructor() {
    this.kayitlar = new Map();
    this.bus = new Bus();
    this.calisiyor = false;
  }

  /**
   * @param {string} id       benzersiz servis kimliği
   * @param {object} o
   * @param {string} o.ad     Görev Yöneticisi'nde görünecek ad
   * @param {number} o.her    çalışma aralığı (ms) — 1000'in altına inilmez
   * @param {Function} o.calistir  yapılacak iş; hata fırlatırsa yutulur ve sayılır
   * @param {string} [o.uygulama]  ilgili uygulamanın kimliği
   */
  register(id, { ad, her, calistir, uygulama = null }) {
    if (typeof calistir !== 'function') throw new Error(`servis ${id}: calistir gerekli`);
    this.unregister(id);
    const kayit = {
      id, ad: ad || id, uygulama,
      her: Math.max(1000, her || 15000),
      calistir,
      sayac: 0, hata: 0, sonHata: null, sonCalisma: 0,
      zamanlayici: 0,
    };
    this.kayitlar.set(id, kayit);
    if (this.calisiyor) this._baslat(kayit);
    this.bus.emit('degisti', this.list());
    return kayit;
  }

  unregister(id) {
    const k = this.kayitlar.get(id);
    if (!k) return false;
    clearInterval(k.zamanlayici);
    this.kayitlar.delete(id);
    this.bus.emit('degisti', this.list());
    return true;
  }

  /** Çekirdek açılışta çağırır; kayıtlı ve sonradan eklenen her servisi başlatır. */
  start() {
    this.calisiyor = true;
    for (const k of this.kayitlar.values()) this._baslat(k);
  }

  stop() {
    this.calisiyor = false;
    for (const k of this.kayitlar.values()) { clearInterval(k.zamanlayici); k.zamanlayici = 0; }
  }

  _baslat(k) {
    clearInterval(k.zamanlayici);
    const calistir = () => {
      k.sayac++;
      k.sonCalisma = Date.now();
      try {
        k.calistir();
      } catch (e) {
        /* Bir servisin hatası diğerlerini durdurmamalı: sayılır, saklanır,
           Görev Yöneticisi'nde görünür — sessizce yutulmaz. */
        k.hata++;
        k.sonHata = e.message;
        console.warn(`[servis:${k.id}]`, e);
      }
    };
    k.zamanlayici = setInterval(calistir, k.her);
    calistir();   /* ilk çalıştırma beklemesin: açılışta geçmiş alarm yakalanır */
  }

  /** Görev Yöneticisi için okunabilir liste. */
  list() {
    return [...this.kayitlar.values()].map(k => ({
      id: k.id, ad: k.ad, uygulama: k.uygulama, her: k.her,
      sayac: k.sayac, hata: k.hata, sonHata: k.sonHata, sonCalisma: k.sonCalisma,
      aktif: !!k.zamanlayici,
    }));
  }

  get(id) { return this.kayitlar.get(id) || null; }
}

export const services = new Services();
export default services;
