/* ==========================================================================
   OpenOS · core/sounds.js — sistem sesleri

   Arayüz sesleri Web Audio ile *sentezleniyor*, dosyadan çalınmıyor. Sebebi
   pratik: bir ses bankası megabaytlarca yer tutar, ilk açılışı yavaşlatır ve
   sistemin "hiçbir dış varlığa bağlı değil" sözünü bozar. Sentez birkaç yüz
   bayt kod ve her ses tam istediğimiz karakterde.

   Karakter: kısa, yumuşak, tok. Her ses bir ya da iki sinüs/üçgen dalga ve
   üstel bir sönüm zarfı. Tıslama ve keskin atak yok — bir işletim sistemi
   günde yüzlerce kez ses çalar, kulak tırmalayan bir ton üçüncü seferde
   rahatsız eder.

   Otomatik oynatma politikası: tarayıcı, kullanıcı sayfayla etkileşmeden
   AudioContext'in çalışmasına izin vermiyor. Bu yüzden bağlam ilk *gerçek*
   etkileşimde kuruluyor ve askıya alınmışsa her çalma denemesinde yeniden
   uyandırılıyor — yoksa açılış sesinden sonraki hiçbir ses duyulmuyordu.
   ========================================================================== */

import settings from './settings.js';

/* Her ses: [frekanslar], süre(sn), dalga, başlangıç kazancı, frekans kayması */
const SESLER = {
  tik:        { nota: [1180],            sure: 0.035, dalga: 'sine',     kazanc: 0.10, kayma: -180 },
  sec:        { nota: [880],             sure: 0.05,  dalga: 'sine',     kazanc: 0.09, kayma: 120 },
  ac:         { nota: [523.25, 783.99],  sure: 0.20,  dalga: 'sine',     kazanc: 0.13, kayma: 60 },
  kapat:      { nota: [659.25, 392.00],  sure: 0.17,  dalga: 'sine',     kazanc: 0.11, kayma: -90 },
  kucult:     { nota: [740, 370],        sure: 0.14,  dalga: 'triangle', kazanc: 0.10, kayma: -220 },
  buyult:     { nota: [370, 740],        sure: 0.14,  dalga: 'triangle', kazanc: 0.10, kayma: 220 },
  bildirim:   { nota: [880, 1174.66],    sure: 0.26,  dalga: 'sine',     kazanc: 0.15, kayma: 0 },
  basari:     { nota: [659.25, 830.61, 987.77], sure: 0.34, dalga: 'sine', kazanc: 0.14, kayma: 0 },
  hata:       { nota: [311.13, 233.08],  sure: 0.30,  dalga: 'triangle', kazanc: 0.15, kayma: -40 },
  uyari:      { nota: [587.33, 587.33],  sure: 0.22,  dalga: 'triangle', kazanc: 0.13, kayma: 0 },
  cop:        { nota: [420, 180],        sure: 0.22,  dalga: 'triangle', kazanc: 0.12, kayma: -300 },
  ekran:      { nota: [1600, 900],       sure: 0.12,  dalga: 'sine',     kazanc: 0.11, kayma: -700 },
  kilit:      { nota: [523.25, 349.23],  sure: 0.26,  dalga: 'sine',     kazanc: 0.12, kayma: -60 },
  kilitAc:    { nota: [349.23, 523.25, 698.46], sure: 0.32, dalga: 'sine', kazanc: 0.12, kayma: 0 },
  alarm:      { nota: [880, 1108.73, 880, 1108.73], sure: 0.75, dalga: 'sine', kazanc: 0.20, kayma: 0 },
  takildi:    { nota: [440, 660],        sure: 0.18,  dalga: 'sine',     kazanc: 0.11, kayma: 0 },
  cikarildi:  { nota: [660, 440],        sure: 0.18,  dalga: 'sine',     kazanc: 0.11, kayma: 0 },
  acilis:     { nota: [261.63, 392.00, 523.25, 783.99], sure: 1.1, dalga: 'sine', kazanc: 0.16, kayma: 0 },
};

class Sesler {
  constructor() {
    this.ctx = null;
    this.master = null;
    this._kuruldu = false;
  }

  get acikMi() { return settings.get('system.sounds') !== false; }
  get seviye() { return (settings.get('system.volume') ?? 60) / 100; }

  /**
   * Bağlamı ilk gerçek kullanıcı etkileşiminde kurar. Doğrudan çağrılabilir
   * ama genelde `install()` bunu kendisi yapar.
   */
  hazirla() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
    } catch (e) {
      console.warn('[ses] ses bağlamı kurulamadı', e);
      this.ctx = null;
    }
    return this.ctx;
  }

  /** Kullanıcının ilk dokunuşunu bekler; sonra kendini söker. */
  install(kok = document) {
    if (this._kuruldu) return;
    this._kuruldu = true;
    const uyandir = () => {
      this.hazirla();
      this.ctx?.resume?.();
      kok.removeEventListener('pointerdown', uyandir, true);
      kok.removeEventListener('keydown', uyandir, true);
    };
    kok.addEventListener('pointerdown', uyandir, true);
    kok.addEventListener('keydown', uyandir, true);
  }

  /**
   * Bir sistem sesi çalar.
   * @param {keyof SESLER} ad
   * @param {object} [o]
   * @param {number} [o.seviye] 0..1 — bu sese özel çarpan
   */
  cal(ad, o = {}) {
    if (!this.acikMi) return;
    const s = SESLER[ad];
    if (!s) return;
    const ctx = this.hazirla();
    if (!ctx) return;
    /* Sekme arkaplandayken bağlam askıya alınabiliyor; her çalmada uyandır. */
    if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});

    const t0 = ctx.currentTime;
    const notaSuresi = s.sure / s.nota.length;
    const hacim = this.seviye * (o.seviye ?? 1);
    if (hacim <= 0) return;

    s.nota.forEach((frekans, i) => {
      const bas = t0 + i * notaSuresi * 0.82;   /* notalar hafif bindirsin */
      const osc = ctx.createOscillator();
      const kaz = ctx.createGain();
      osc.type = s.dalga;
      osc.frequency.setValueAtTime(frekans, bas);
      if (s.kayma) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(40, frekans + s.kayma), bas + notaSuresi);
      }
      /* Üstel zarf: ani atak yerine 8 ms'lik yumuşak bir yükseliş, sonra
         sıfıra inmeyen bir sönüm (exponentialRamp sıfırı kabul etmez). */
      const tepe = s.kazanc * hacim;
      kaz.gain.setValueAtTime(0.0001, bas);
      kaz.gain.exponentialRampToValueAtTime(tepe, bas + 0.008);
      kaz.gain.exponentialRampToValueAtTime(0.0001, bas + notaSuresi);
      osc.connect(kaz); kaz.connect(this.master);
      osc.start(bas);
      osc.stop(bas + notaSuresi + 0.02);
    });
  }

  /** Bilinen ses adları — Ayarlar'daki önizleme listesi için. */
  get adlar() { return Object.keys(SESLER); }
}

export const sesler = new Sesler();
export default sesler;
