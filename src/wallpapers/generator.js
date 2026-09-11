/* ==========================================================================
   OpenOS · wallpapers/generator.js
   Every wallpaper is drawn procedurally on a canvas — no image assets,
   infinitely resizable, and a few of them are alive.
   ========================================================================== */

/* ------------------------------------------------------------------ noise */
const PERM = (() => {
  const p = new Uint8Array(512);
  const base = [...Array(256).keys()];
  let seed = 1337;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [base[i], base[j]] = [base[j], base[i]]; }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
})();
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + t * (b - a);
const grad = (hash, x, y) => {
  const hv = hash & 3;
  return ((hv & 1) ? -x : x) + ((hv & 2) ? -y : y);
};
export function noise2(x, y) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  x -= Math.floor(x); y -= Math.floor(y);
  const u = fade(x), v = fade(y);
  const A = PERM[X] + Y, B = PERM[X + 1] + Y;
  return lerp(
    lerp(grad(PERM[A], x, y), grad(PERM[B], x - 1, y), u),
    lerp(grad(PERM[A + 1], x, y - 1), grad(PERM[B + 1], x - 1, y - 1), u), v);
}
export function fbm(x, y, oct = 4) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += a * noise2(x * f, y * f); f *= 2; a *= 0.5; }
  return v;
}

/* --------------------------------------------------------------- helpers */
function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}
function radial(ctx, x, y, r, stops) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}
function blob(ctx, x, y, r, color, blur = 0) {
  ctx.save();
  if (blur) ctx.filter = `blur(${blur}px)`;
  ctx.fillStyle = radial(ctx, x, y, r, [[0, color], [1, 'transparent']]);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
/** A soft flowing ribbon built from an fbm-displaced band. */
function ribbon(ctx, w, h, { y, amp, thick, colorA, colorB, phase = 0, freq = 1.6, blur = 0, alpha = 1 }) {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (blur) ctx.filter = `blur(${blur}px)`;
  ctx.beginPath();
  const step = Math.max(4, w / 180);
  const top = [], bot = [];
  for (let x = -step; x <= w + step; x += step) {
    const n = fbm((x / w) * freq + phase, phase * 0.6, 3);
    const cy = y + n * amp;
    const t = thick * (0.72 + 0.5 * fbm((x / w) * 2.2 + phase * 1.4, 5.5, 2));
    top.push([x, cy - t / 2]); bot.push([x, cy + t / 2]);
  }
  ctx.moveTo(top[0][0], top[0][1]);
  top.forEach(([px, py]) => ctx.lineTo(px, py));
  for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
  ctx.closePath();
  ctx.fillStyle = linear(ctx, 0, y - thick, w, y + thick, [[0, colorA], [1, colorB]]);
  ctx.fill();
  ctx.restore();
}
function stars(ctx, w, h, count, seedBase = 7) {
  let s = seedBase;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < count; i++) {
    const x = rnd() * w, y = rnd() * h * 0.92;
    const r = rnd() * 1.35 + 0.25;
    const a = 0.25 + rnd() * 0.75;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}
function grain(ctx, w, h, amount = 10) {
  const n = Math.floor((w * h) / 900);
  ctx.save(); ctx.globalAlpha = amount / 255;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = Math.random() > .5 ? '#fff' : '#000';
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
  }
  ctx.restore();
}

/* -------------------------------------------------------------- catalogue */
export const WALLPAPERS = [
  {
    id: 'aurora', name: 'Aurora', dark: true, animated: true,
    draw(ctx, w, h, t = 0) {
      ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#05060f'], [.55, '#0a1024'], [1, '#04050c']]);
      ctx.fillRect(0, 0, w, h);
      const p = t * 0.045;
      ribbon(ctx, w, h, { y: h * .34, amp: h * .16, thick: h * .30, phase: p,        colorA: 'rgba(0,190,255,.55)',  colorB: 'rgba(120,60,255,.48)', blur: w * .05 });
      ribbon(ctx, w, h, { y: h * .52, amp: h * .19, thick: h * .24, phase: p + 2.1,  colorA: 'rgba(255,60,160,.40)', colorB: 'rgba(90,0,220,.42)',   blur: w * .055 });
      ribbon(ctx, w, h, { y: h * .66, amp: h * .13, thick: h * .17, phase: p + 4.7,  colorA: 'rgba(30,255,200,.34)', colorB: 'rgba(0,140,255,.30)',  blur: w * .05 });
      blob(ctx, w * .78, h * .18, w * .30, 'rgba(90,40,200,.30)', w * .03);
      blob(ctx, w * .16, h * .82, w * .30, 'rgba(0,120,255,.22)', w * .03);
      ctx.save(); ctx.globalAlpha = .5; stars(ctx, w, h * .6, Math.round(w / 12)); ctx.restore();
      grain(ctx, w, h, 7);
    },
  },
  {
    id: 'monterey', name: 'Monterey', dark: true, animated: true,
    draw(ctx, w, h, t = 0) {
      ctx.fillStyle = linear(ctx, 0, 0, w, h, [[0, '#120a2e'], [.5, '#231056'], [1, '#0c0722']]);
      ctx.fillRect(0, 0, w, h);
      const p = t * 0.03;
      for (let i = 0; i < 6; i++) {
        ribbon(ctx, w, h, {
          y: h * (0.26 + i * 0.11), amp: h * .10, thick: h * .09,
          phase: p + i * 0.9, freq: 1.2 + i * .18, blur: w * .022,
          colorA: `hsla(${212 + i * 16}, 95%, ${58 + i * 3}%, .5)`,
          colorB: `hsla(${286 + i * 9}, 92%, ${52 + i * 3}%, .42)`,
        });
      }
      blob(ctx, w * .5, h * .5, w * .5, 'rgba(255,255,255,.05)', w * .06);
      grain(ctx, w, h, 6);
    },
  },
  {
    id: 'sonoma', name: 'Sonoma', dark: false, animated: false,
    draw(ctx, w, h) {
      ctx.fillStyle = linear(ctx, 0, 0, w, h, [[0, '#ffd9a8'], [.45, '#ff9e7a'], [1, '#8c4fb0']]);
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 7; i++) {
        ribbon(ctx, w, h, {
          y: h * (0.2 + i * 0.115), amp: h * .07, thick: h * .085, phase: i * 1.7,
          freq: 1 + i * .14, blur: w * .018, alpha: .85,
          colorA: `hsla(${34 - i * 6}, 100%, ${72 - i * 4}%, .75)`,
          colorB: `hsla(${312 + i * 5}, 78%, ${64 - i * 3}%, .6)`,
        });
      }
      blob(ctx, w * .22, h * .18, w * .34, 'rgba(255,240,200,.5)', w * .04);
      grain(ctx, w, h, 5);
    },
  },
  {
    id: 'ventura', name: 'Ventura', dark: false, animated: false,
    draw(ctx, w, h) {
      ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#1b3fa0'], [.5, '#3f7fe0'], [1, '#9fd6f5']]);
      ctx.fillRect(0, 0, w, h);
      const cx = w * .5, cy = h * .52;
      for (let i = 9; i >= 0; i--) {
        ctx.save();
        ctx.globalAlpha = .13 + i * .015;
        ctx.filter = `blur(${w * .012}px)`;
        ctx.beginPath();
        ctx.ellipse(cx, cy, w * (.14 + i * .075), h * (.10 + i * .055), -0.38, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${205 + i * 7}, 88%, ${62 + i * 2.4}%)`;
        ctx.fill(); ctx.restore();
      }
      blob(ctx, cx, cy, w * .2, 'rgba(255,255,255,.6)', w * .035);
      grain(ctx, w, h, 4);
    },
  },
  {
    id: 'deepspace', name: 'Derin Uzay', dark: true, animated: false,
    draw(ctx, w, h) {
      ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#01020a'], [1, '#0a0716']]);
      ctx.fillRect(0, 0, w, h);
      stars(ctx, w, h, Math.round(w / 2.6), 11);
      blob(ctx, w * .68, h * .34, w * .38, 'rgba(120,40,190,.32)', w * .05);
      blob(ctx, w * .30, h * .62, w * .30, 'rgba(20,90,220,.26)', w * .05);
      blob(ctx, w * .52, h * .46, w * .16, 'rgba(255,120,200,.18)', w * .04);
      ctx.save(); ctx.filter = `blur(${w * .002}px)`;
      for (let i = 0; i < 3; i++) {
        const y = h * (.25 + i * .22);
        ribbon(ctx, w, h, { y, amp: h * .06, thick: h * .015, phase: i * 3.1, freq: 2.4,
          colorA: 'rgba(150,190,255,.16)', colorB: 'rgba(255,150,220,.12)', blur: w * .01 });
      }
      ctx.restore();
      grain(ctx, w, h, 9);
    },
  },
  {
    id: 'canyon', name: 'Kanyon', dark: false, animated: false,
    draw(ctx, w, h) {
      ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#2b1b4d'], [.35, '#a8456b'], [.62, '#f08a52'], [1, '#ffd9a0']]);
      ctx.fillRect(0, 0, w, h);
      blob(ctx, w * .74, h * .30, w * .12, 'rgba(255,240,190,.95)', w * .012);
      const layers = 6;
      for (let i = 0; i < layers; i++) {
        const base = h * (0.52 + i * 0.085);
        ctx.beginPath(); ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += Math.max(3, w / 240)) {
          const n = fbm(x / w * (2 + i * 0.8) + i * 9, i * 3.3, 4);
          ctx.lineTo(x, base + n * h * (0.09 - i * 0.008));
        }
        ctx.lineTo(w, h); ctx.closePath();
        const l = 28 - i * 3.4;
        ctx.fillStyle = `hsl(${282 - i * 6}, ${34 + i * 3}%, ${l}%)`;
        ctx.globalAlpha = 1; ctx.fill();
      }
      grain(ctx, w, h, 6);
    },
  },
  {
    id: 'mesh', name: 'Pastel Mesh', dark: false, animated: true,
    draw(ctx, w, h, t = 0) {
      ctx.fillStyle = '#f6f3ff'; ctx.fillRect(0, 0, w, h);
      const pts = [
        [.18, .22, 'rgba(120,180,255,.85)'], [.82, .18, 'rgba(255,160,210,.8)'],
        [.74, .78, 'rgba(150,240,210,.8)'],  [.22, .80, 'rgba(255,214,150,.8)'],
        [.52, .48, 'rgba(190,160,255,.7)'],
      ];
      pts.forEach(([px, py, c], i) => {
        const dx = Math.sin(t * .25 + i * 1.3) * .05, dy = Math.cos(t * .2 + i * .9) * .05;
        blob(ctx, w * (px + dx), h * (py + dy), w * .42, c, w * .05);
      });
      grain(ctx, w, h, 5);
    },
  },
  {
    id: 'graphite', name: 'Grafit', dark: true, animated: false,
    draw(ctx, w, h) {
      ctx.fillStyle = linear(ctx, 0, 0, w, h, [[0, '#15161a'], [.5, '#1e2026'], [1, '#0e0f12']]);
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 4; i++) {
        ribbon(ctx, w, h, { y: h * (.22 + i * .2), amp: h * .1, thick: h * .16, phase: i * 2.4,
          colorA: 'rgba(255,255,255,.045)', colorB: 'rgba(255,255,255,.015)', blur: w * .04 });
      }
      blob(ctx, w * .3, h * .25, w * .35, 'rgba(120,140,190,.08)', w * .04);
      grain(ctx, w, h, 8);
    },
  },
  {
    id: 'terminalgrid', name: 'Izgara', dark: true, animated: false,
    draw(ctx, w, h) {
      ctx.fillStyle = '#06080c'; ctx.fillRect(0, 0, w, h);
      blob(ctx, w * .5, h * .48, w * .55, 'rgba(0,120,255,.22)', w * .05);
      const cell = Math.max(26, w / 46);
      ctx.strokeStyle = 'rgba(120,190,255,.10)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= w; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = 0; y <= h; y += cell) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(140,210,255,.26)';
      ctx.beginPath();
      for (let x = 0; x <= w; x += cell * 5) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = 0; y <= h; y += cell * 5) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      grain(ctx, w, h, 6);
    },
  },
  {
    id: 'solarflare', name: 'Güneş Patlaması', dark: true, animated: true,
    draw(ctx, w, h, t = 0) {
      ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#150404'], [1, '#2b0a02']]);
      ctx.fillRect(0, 0, w, h);
      const cx = w * .5, cy = h * 1.02;
      blob(ctx, cx, cy, w * .8, 'rgba(255,120,20,.42)', w * .05);
      blob(ctx, cx, cy, w * .45, 'rgba(255,220,120,.55)', w * .04);
      for (let i = 0; i < 5; i++) {
        ribbon(ctx, w, h, { y: h * (.30 + i * .13), amp: h * .09, thick: h * .07,
          phase: t * .06 + i * 1.6, freq: 1.5 + i * .2, blur: w * .03,
          colorA: `rgba(255,${110 + i * 22},30,.34)`, colorB: 'rgba(255,60,20,.24)' });
      }
      grain(ctx, w, h, 8);
    },
  },
  {
    id: 'mint', name: 'Nane', dark: false, animated: false,
    draw(ctx, w, h) {
      ctx.fillStyle = linear(ctx, 0, 0, w, h, [[0, '#dff7ee'], [.5, '#a8e6d2'], [1, '#5fc9c3']]);
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 6; i++) {
        ribbon(ctx, w, h, { y: h * (.18 + i * .14), amp: h * .07, thick: h * .1, phase: i * 2.2,
          colorA: `hsla(${162 + i * 6}, 62%, ${76 - i * 4}%, .6)`,
          colorB: `hsla(${190 + i * 5}, 68%, ${70 - i * 3}%, .5)`, blur: w * .025 });
      }
      blob(ctx, w * .8, h * .2, w * .3, 'rgba(255,255,255,.5)', w * .04);
      grain(ctx, w, h, 4);
    },
  },
  {
    id: 'ink', name: 'Mürekkep', dark: true, animated: false,
    draw(ctx, w, h) {
      ctx.fillStyle = '#0b0b0d'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) {
        const x = (fbm(i * 3.1, 1.7, 2) * .5 + .5) * w;
        const y = (fbm(i * 1.9, 8.3, 2) * .5 + .5) * h;
        const r = w * (.04 + Math.abs(fbm(i * 5.5, 2.2, 2)) * .18);
        blob(ctx, x, y, r, `hsla(${(i * 37) % 360}, 70%, 55%, .10)`, w * .03);
      }
      blob(ctx, w * .5, h * .5, w * .6, 'rgba(255,255,255,.03)', w * .06);
      grain(ctx, w, h, 10);
    },
  },
];

export const byId = id => WALLPAPERS.find(w => w.id === id) || WALLPAPERS[0];

/** Render a wallpaper into a canvas element (fits, DPR-aware). */
export function render(canvas, id, t = 0) {
  const wp = byId(id);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || canvas.width, hh = canvas.clientHeight || canvas.height;
  const W = Math.max(2, Math.round(w * dpr)), H = Math.max(2, Math.round(hh * dpr));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d');
  ctx.save(); ctx.clearRect(0, 0, W, H);
  wp.draw(ctx, W, H, t);
  ctx.restore();
  return wp;
}

/** Offscreen render → data URL (used for thumbnails and the lock screen). */
export function thumb(id, w = 288, h = 180) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  byId(id).draw(c.getContext('2d'), w, h, 0);
  return c.toDataURL('image/jpeg', 0.82);
}
