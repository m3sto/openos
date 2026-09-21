/* ==========================================================================
   OpenOS · ui/jelly.js — jöle (wobbly) pencereler

   Compiz'in "Wobbly Windows" etkisi. Pencere ağır ve hamurumsu tek bir
   gövdedir: tuttuğunuz nokta imlece çivilenir, geri kalan her şey **tek
   parça hâlinde** arkadan sürüklenir, tutulan noktadan uzaklaştıkça daha
   çok geri kalır. Bıraktığınızda gövde birkaç kez salınıp yerine oturur.

   Önceki sürümde dört köşenin her birinin ayrı yayı vardı; köşeler birbirinden
   bağımsız hareket ettiği için pencere sallanmıyor, köşelerinden buruşuyordu.
   Şimdi **tek** bir gecikme yayı var ve dört köşe de onu paylaşıyor — sallanan
   şey pencerenin tamamı. Köşe başına değişen tek şey bu ortak gecikmenin ne
   kadarını aldığı: tutulan noktada sıfıra yakın, karşı köşede tam.

   Şekil afin değil (tutulan noktanın iki yanı da geride kalır, biri öne
   geçmez), o yüzden dönüşüm projektif: dört köşenin hedefinden bir homografi
   çözülüp matrix3d olarak uygulanıyor.
   ========================================================================== */

import settings from '../core/settings.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* --------------------------------------------------------------------------
   Dört noktadan dört noktaya projektif dönüşüm.
   8 bilinmeyenli doğrusal sistemi Gauss eliminasyonuyla çözer; sonucu CSS'in
   beklediği sütun-öncelikli matrix3d dizisine çevirir.
   -------------------------------------------------------------------------- */
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  /* Gauss–Jordan, kısmi pivotlama ile */
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-9) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    const d = A[col][col];
    for (let c = col; c < 8; c++) A[col][c] /= d;
    b[col] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (!f) continue;
      for (let c = col; c < 8; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const [a, bb, c, d, e, f, g, hh] = b;
  /* CSS matrix3d sütun-öncelikli: m11 m12 m13 m14, m21 … */
  return [a, d, 0, g,
          bb, e, 0, hh,
          0, 0, 1, 0,
          c, f, 0, 1];
}

/* Tek boyutlu sönümlü yay. */
class Spring {
  constructor(k, damp) { this.k = k; this.d = damp; this.x = 0; this.v = 0; }
  step() {
    this.v = (this.v - this.x * this.k) * this.d;
    this.x += this.v;
    return this.x;
  }
  kick(a) { this.v += a; }
  get still() { return Math.abs(this.v) < 0.02 && Math.abs(this.x) < 0.06; }
  reset() { this.x = 0; this.v = 0; }
}

/**
 * Ortak gecikmeden her köşenin aldığı pay. 0 = imlece çivili, 1 = tam geri kalır.
 *
 * Düz Öklit uzaklığı yanlış geliyordu: başlık çubuğunun ortasından tutunca üst
 * iki köşe de yarım pencere genişliği uzakta sayılıyor ve belirgin biçimde
 * kayıyordu. Oysa başlık çubuğunu tutmak *bütün üst kenarı* tutmaktır — orada
 * pencere imlece yapışık durmalı, sarkan taraf gövdenin geri kalanı olmalı.
 * Bu yüzden dikey uzaklık ağır, yatay uzaklık hafif basar: köşeden tutunca
 * karşı köşe yine de geri kalsın diye yatay terim tamamen atılmadı.
 */
function agirliklar(px, py) {
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([cx, cy]) =>
    0.08 + 0.92 * clamp(Math.abs(cy - py) * 0.78 + Math.abs(cx - px) * 0.34, 0, 1));
}

export class Jelly {
  /** @param {HTMLElement} el pencere öğesi */
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;
    /* Tek gövde, tek gecikme. Pencerenin imleçten ne kadar geri kaldığını
       tutan iki eksenli yay; dört köşe de bunu paylaşır, bu yüzden pencere
       bir bütün olarak sallanır. Yumuşak yay + düşük sönüm = hamur kıvamı. */
    this.lag = { x: new Spring(0.085, 0.86), y: new Spring(0.085, 0.86) };
    /* köşe sırası: SÜ, SğÜ, SğA, SA — her köşenin ortak gecikmeden aldığı pay */
    this.weights = [1, 1, 1, 1];
    this.running = false;
    this.raf = 0;
    this.dragging = false;
    this.offset = { x: 0, y: 0 };     /* sürükleme sırasında kompozit öteleme */
  }

  static get enabled() {
    return !!settings.get('desktop.jelly') && !settings.get('system.reduceMotion');
  }
  get strength() { return (settings.get('desktop.jellyStrength') ?? 1) * (this.opts.strength ?? 1); }

  /* ---------------------------------------------------------------- tutma */
  /**
   * @param {number} px 0..1 — tutulan noktanın pencere içindeki yatay oranı
   * @param {number} py 0..1
   */
  grab(px, py) {
    if (!Jelly.enabled) return;
    this.dragging = true;
    this.el.classList.add('jelly');
    this.el.style.transformOrigin = '0 0';
    this.weights = agirliklar(px, py);
    /* Ölçü burada bir kez okunur. `apply()` her karede çalışıyor ve
       `offsetWidth` okumak zorunlu yerleşim hesabı tetikler; sürüklemenin
       sıcak yolunda bunu kare başına yapmak, pencerenin imlecin arkasından
       geldiği hissinin sebebiydi. Sürükleme boyunca boyut zaten sabit. */
    this.olcu = [this.el.offsetWidth, this.el.offsetHeight];
    this.start();
  }

  /** Pencere bu karede (dx,dy) kadar ötelendi — köşelere tepki ver. */
  move(dx, dy) {
    if (!Jelly.enabled || !this.dragging) return;
    /* Gövde harekete direnir: pencere sağa gidiyorsa gecikme sola büyür.
       Tek yayı ittiğimiz için dört köşe de aynı anda aynı yöne savrulur. */
    const s = this.strength;
    this.lag.x.kick(clamp(-dx, -60, 60) * 0.38 * s);
    this.lag.y.kick(clamp(-dy, -60, 60) * 0.38 * s);
    this.start();
  }

  release() {
    this.dragging = false;
    /* bırakırken hafif bir salınım kalsın */
    const s = this.strength;
    this.lag.x.kick(this.lag.x.x * -0.3 * s);
    this.lag.y.kick(this.lag.y.x * -0.3 * s);
    this.start();
  }

  /** Tek seferlik dalgalanma — açılış, büyütme, kenara yapışma için. */
  pulse(amount = 16) {
    if (!Jelly.enabled) return;
    this.el.classList.add('jelly');
    this.el.style.transformOrigin = '0 0';
    /* Darbe de tek gövdeyi sallar: pencere üst kenarından tutulmuş gibi
       davranır, alt tarafı bir sarkıp geri toplanır. */
    this.weights = agirliklar(0.5, 0);
    this.olcu = [this.el.offsetWidth, this.el.offsetHeight];
    this.lag.y.kick(amount * this.strength * 1.6);
    this.start();
  }

  /* ------------------------------------------------------- kompozit öteleme */
  /** Sürükleme sırasında left/top yerine transform kullanılır (yerleşim yok). */
  setOffset(x, y) {
    this.offset.x = x; this.offset.y = y;
    if (!this.running) this.apply();
  }
  /** Ötelemeyi sıfırlar VE ekrana yansıtır; yoksa eski transform üzerinde
      kalır ve pencere, kalıcı konumuyla toplanıp yerinden oynamış görünür. */
  clearOffset() {
    this.offset.x = this.offset.y = 0;
    this.apply();
  }

  /* ---------------------------------------------------------------- döngü */
  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      this.lag.x.step(); this.lag.y.step();
      const moving = !this.lag.x.still || !this.lag.y.still;
      this.apply();
      if (!moving && !this.dragging) { this.settleNow(); return; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);

    /* Emniyet: sekme arka plandayken requestAnimationFrame durur, dolayısıyla
       yukarıdaki temizlik hiç çalışmayabilir. O durumda pencerede `jelly`
       sınıfı ve onunla gelen `will-change: transform` kalıcı olur; pencere
       sürekli ayrı bir birleştirme katmanına yükseltilir ve yuvarlak köşeli,
       kırpılmış bu katmanın içindeki çapraz kaynaklı <iframe> hiç boyanmaz —
       tarayıcı penceresi bembeyaz görünür. Zamanlayıcı arka planda da işler. */
    clearTimeout(this.safety);
    this.safety = setTimeout(() => { if (!this.dragging) this.settleNow(); }, 1400);
  }

  /** Yayları sıfırlar ve pencereyi düz, katmansız hâline döndürür. */
  settleNow() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.safety);
    this.running = false;
    this.olcu = null;
    this.lag.x.reset(); this.lag.y.reset();
    if (this.offset.x || this.offset.y) {
      this.el.style.transform = `translate3d(${this.offset.x}px, ${this.offset.y}px, 0)`;
    } else {
      this.el.style.transform = '';
      this.el.style.transformOrigin = '';
    }
    this.el.classList.remove('jelly');
  }

  apply() {
    const deforme = Math.abs(this.lag.x.x) > 0.05 || Math.abs(this.lag.y.x) > 0.05;
    const oteleme = this.offset.x || this.offset.y;

    /* Hiçbir şey yoksa `transform` tamamen kaldırılır. Kimlik matrisi bile
       bırakılmamalı: pencereyi ayrı bir birleştirme katmanında tutar ve
       içindeki çapraz kaynaklı çerçeve boyanmaz. */
    if (!deforme && !oteleme) {
      if (this.el.style.transform) this.el.style.transform = '';
      this.el.style.transformOrigin = '';
      return;
    }

    const t = oteleme ? `translate3d(${this.offset.x}px, ${this.offset.y}px, 0)` : '';

    /* Yalnızca öteleme varsa ne matris hesabı yapılır ne de ölçü okunur.
       `offsetWidth` okumak zorunlu yerleşim hesabı tetikler; sürüklemenin
       sıcak yolunda her imleç olayında bunu yapmak, pencerenin imlecin
       arkasından sürüklenmesinin başlıca sebebiydi. */
    if (!deforme) { this.el.style.transform = t; return; }

    const [w, h] = this.olcu || [this.el.offsetWidth, this.el.offsetHeight];
    if (!w || !h) { this.el.style.transform = t; return; }
    const src = [[0, 0], [w, 0], [w, h], [0, h]];
    /* Tek gecikme, köşe başına payıyla dağıtılır: sallanan pencerenin
       tamamı, geri kalma miktarı tutulan noktadan uzaklıkla artıyor. */
    /* Kayma sınırı: bundan ötesi jöle değil, kopmuş bir yüzey gibi görünüyor. */
    const lim = Math.min(w, h) * 0.16;
    const lx = clamp(this.lag.x.x, -lim, lim);
    const ly = clamp(this.lag.y.x, -lim, lim);
    const dst = src.map((p, i) => [
      p[0] + lx * this.weights[i],
      p[1] + ly * this.weights[i],
    ]);
    const m = homography(src, dst);
    this.el.style.transform = m ? `${t} matrix3d(${m.map(n => +n.toFixed(6)).join(',')})` : t;
  }

  destroy() {
    this.dragging = false;
    this.offset.x = this.offset.y = 0;
    this.settleNow();
  }
}

export default Jelly;
