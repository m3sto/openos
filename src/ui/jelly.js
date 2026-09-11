/* ==========================================================================
   OpenOS · ui/jelly.js — "jöle" pencere modu
   A window under the cursor behaves like a soft body: it lags, shears against
   the direction of travel, squashes along its motion and stretches across it,
   then settles with a damped spring. Everything here is a transform on top of
   the window's left/top geometry, so the window manager keeps owning layout.
   ========================================================================== */

import settings from '../core/settings.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Critically-under-damped spring, integrated per frame. */
class Spring {
  constructor(stiffness = 0.14, damping = 0.72) {
    this.k = stiffness; this.d = damping;
    this.value = 0; this.velocity = 0; this.target = 0;
  }
  step() {
    const force = (this.target - this.value) * this.k;
    this.velocity = (this.velocity + force) * this.d;
    this.value += this.velocity;
    return this.value;
  }
  get settled() { return Math.abs(this.velocity) < 0.001 && Math.abs(this.target - this.value) < 0.001; }
  reset(v = 0) { this.value = this.target = v; this.velocity = 0; }
}

export class Jelly {
  /**
   * @param {HTMLElement} el   the window element
   * @param {object} opts      { origin: 'top'|'center', strength }
   */
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;
    this.shearX = new Spring(0.16, 0.70);
    this.shearY = new Spring(0.16, 0.70);
    this.squash = new Spring(0.13, 0.74);
    this.lastX = 0; this.lastY = 0;
    this.running = false;
    this.raf = 0;
  }

  static get enabled() { return !!settings.get('desktop.jelly') && !settings.get('system.reduceMotion'); }
  get strength() { return (settings.get('desktop.jellyStrength') ?? 1) * (this.opts.strength ?? 1); }

  /* ---------------- lifecycle ---------------- */
  begin(x, y, grab) {
    if (!Jelly.enabled) return;
    this.lastX = x; this.lastY = y;
    this.grab = grab;                       /* { px, py } in 0..1 of the window box */
    this.el.classList.add('jelly');
    if (grab) this.el.style.transformOrigin = `${(grab.px * 100).toFixed(1)}% ${(grab.py * 100).toFixed(1)}%`;
    this.start();
  }

  /** Feed the pointer position; velocity drives the deformation. */
  move(x, y) {
    if (!Jelly.enabled) return;
    const vx = clamp(x - this.lastX, -90, 90);
    const vy = clamp(y - this.lastY, -90, 90);
    this.lastX = x; this.lastY = y;
    const s = this.strength;
    /* shear opposes the motion: the window "drags" behind the cursor */
    this.shearX.target = clamp(-vx * 0.36, -16, 16) * s;
    this.shearY.target = clamp(-vy * 0.22, -10, 10) * s;
    this.squash.target = clamp(Math.hypot(vx, vy) * 0.0042, 0, 0.09) * s;
    this.start();
  }

  /** Release: everything springs home, overshooting once or twice. */
  end() {
    this.shearX.target = 0;
    this.shearY.target = 0;
    this.squash.target = 0;
    /* a parting kick so the settle is visible even on a slow release */
    this.shearX.velocity += this.shearX.value * -0.22;
    this.squash.velocity += 0.012 * this.strength;
    this.start();
  }

  /** One-shot wobble — used for open, maximise, snap. */
  pulse(amount = 0.06, shear = 6) {
    if (!Jelly.enabled) return;
    this.el.classList.add('jelly');
    this.squash.value = amount * this.strength;
    this.squash.velocity = 0.02 * this.strength;
    this.shearX.value = shear * this.strength;
    this.squash.target = 0; this.shearX.target = 0;
    this.start();
  }

  /* ---------------- the loop ---------------- */
  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      const sx = this.shearX.step();
      const sy = this.shearY.step();
      const q = this.squash.step();
      this.apply(sx, sy, q);
      if (this.shearX.settled && this.shearY.settled && this.squash.settled) {
        this.running = false;
        this.apply(0, 0, 0);
        this.el.style.transform = '';
        this.el.classList.remove('jelly');
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  apply(sx, sy, q) {
    /* squash along travel, stretch across it — volume roughly preserved */
    const dir = Math.abs(sx) >= Math.abs(sy);
    const scaleX = 1 + (dir ? q : -q * 0.6);
    const scaleY = 1 + (dir ? -q * 0.6 : q);
    this.el.style.transform =
      `skewX(${sx.toFixed(2)}deg) skewY(${(sy * 0.35).toFixed(2)}deg) ` +
      `scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;
    /* corners soften as the window stretches — the giveaway that sells jelly */
    const r = 14 + Math.abs(q) * 130;
    this.el.style.borderRadius = `${r.toFixed(1)}px`;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.running = false;
    this.el.style.transform = '';
    this.el.style.borderRadius = '';
    this.el.classList.remove('jelly');
  }
}

export default Jelly;
