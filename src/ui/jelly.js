/* ==========================================================================
   OpenOS · ui/jelly.js — jöle (wobbly) pencereler
   Pencere dört köşesi yaylarla bağlı esnek bir yüzey gibi davranır. Tutulan
   köşe imleci anında izler, uzaktaki köşeler gecikir; aradaki fark bir
   projektif dönüşüme (homography) çevrilip matrix3d olarak uygulanır — yani
   pencere gerçekten eğrilir, yalnızca ölçeklenip kayarak taklit etmez.
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

export class Jelly {
  /** @param {HTMLElement} el pencere öğesi */
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;
    /* köşe sırası: SÜ, SğÜ, SğA, SA */
    this.corners = Array.from({ length: 4 }, () => ({
      x: new Spring(0.16, 0.80),
      y: new Spring(0.16, 0.80),
    }));
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
    /* Tutulan noktaya yakın köşe az, uzak köşe çok gecikir. */
    const pts = [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.weights = pts.map(([cx, cy]) => {
      const d = Math.hypot(cx - px, cy - py) / Math.SQRT2;   /* 0..1 */
      return 0.18 + 0.82 * d;
    });
    this.start();
  }

  /** Pencere bu karede (dx,dy) kadar ötelendi — köşelere tepki ver. */
  move(dx, dy) {
    if (!Jelly.enabled || !this.dragging) return;
    const s = this.strength;
    const ax = clamp(-dx, -70, 70) * 0.62 * s;
    const ay = clamp(-dy, -70, 70) * 0.62 * s;
    this.corners.forEach((c, i) => {
      c.x.kick(ax * this.weights[i]);
      c.y.kick(ay * this.weights[i]);
    });
    this.start();
  }

  release() {
    this.dragging = false;
    /* bırakırken hafif bir salınım kalsın */
    const s = this.strength;
    this.corners.forEach((c, i) => {
      c.x.kick(c.x.x * -0.22 * this.weights[i] * s);
      c.y.kick(c.y.x * -0.22 * this.weights[i] * s);
    });
    this.start();
  }

  /** Tek seferlik dalgalanma — açılış, büyütme, kenara yapışma için. */
  pulse(amount = 16) {
    if (!Jelly.enabled) return;
    this.el.classList.add('jelly');
    this.el.style.transformOrigin = '0 0';
    const a = amount * this.strength;
    this.corners[0].y.kick(-a); this.corners[1].y.kick(-a * 0.6);
    this.corners[2].y.kick(a);  this.corners[3].y.kick(a * 0.6);
    this.corners[1].x.kick(a * 0.5); this.corners[3].x.kick(-a * 0.5);
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
      let moving = false;
      for (const c of this.corners) {
        c.x.step(); c.y.step();
        if (!c.x.still || !c.y.still) moving = true;
      }
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
    this.corners.forEach(c => { c.x.reset(); c.y.reset(); });
    if (this.offset.x || this.offset.y) {
      this.el.style.transform = `translate3d(${this.offset.x}px, ${this.offset.y}px, 0)`;
    } else {
      this.el.style.transform = '';
      this.el.style.transformOrigin = '';
    }
    this.el.classList.remove('jelly');
  }

  apply() {
    const deforme = this.corners.some(c => Math.abs(c.x.x) > 0.05 || Math.abs(c.y.x) > 0.05);
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

    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    if (!w || !h) { this.el.style.transform = t; return; }
    const src = [[0, 0], [w, 0], [w, h], [0, h]];
    const lim = Math.min(w, h) * 0.32;
    const dst = src.map((p, i) => [
      p[0] + clamp(this.corners[i].x.x, -lim, lim),
      p[1] + clamp(this.corners[i].y.x, -lim, lim),
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
