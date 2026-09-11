/* ==========================================================================
   OpenOS · boot/splash.js — the POST logo and the kernel log
   ========================================================================== */

import { h, clear, sleep, on } from '../core/util.js';

const KERNEL_VERSION = '1.0.0-openos';

/** Lines are [class, text, delayMs]. `%t` is replaced with a kernel timestamp. */
function logLines(ctx) {
  const L = [];
  const push = (cls, text, d = 9) => L.push([cls, text, d]);

  push('hi', `OpenOS kernel ${KERNEL_VERSION} (opensharp-runtime) booting on ${ctx.platform}`, 60);
  push('dim', `Command line: root=vfs:/ quiet=0 splash accent=${ctx.accent} lang=${ctx.locale}`, 14);
  push('', 'Detecting virtual hardware...', 26);
  push('ok', 'CPU: OpenCore V8 · ' + ctx.cores + ' logical cores detected');
  push('ok', `Memory: ${ctx.mem} addressable · heap arena mapped`);
  push('ok', `Display: ${ctx.screen} · DPR ${ctx.dpr} · compositor=canvas2d+css`);
  push('', 'Mounting virtual filesystem...', 22);
  push('ok', 'vfs: superblock ok, journal clean');
  push('ok', 'vfs: mounted / (localStorage backend, rw)');
  push('ok', 'vfs: mounted /Users /Applications /System /var');
  push('', 'Starting core services...', 20);
  push('ok', 'systemd[1]: reached target Basic System');
  push('ok', 'kernel: window-manager compositor started');
  push('ok', 'kernel: registered 8 input devices (pointer, keyboard)');
  push('ok', 'netd: virtual link up — ' + ctx.ssid + ' (simulated)');
  push('ok', 'powerd: battery service online');
  push('', 'Loading OpenSharp runtime...', 24);
  push('ok', 'opensharp: lexer/parser/vm linked');
  push('ok', 'opensharp: stdlib v1 — 96 symbols exported');
  push('ok', 'opensharp: UI kit bound — ' + ctx.components + ' components');
  push('', 'Scanning application registry...', 18);
  for (const a of ctx.apps) push('ok', `registry: ${a.padEnd(22, ' ')} ready`, 6);
  push('ok', 'agentd: machine interface exposed at window.OpenOS');
  push('', 'Restoring user session...', 20);
  if (ctx.firstRun) {
    push('warn', 'setup: no user profile found — launching first-run assistant');
  } else {
    push('ok', `session: profile '${ctx.user}' loaded`);
    push('ok', 'session: wallpaper, dock and window state restored');
  }
  push('ok', 'kernel: boot complete in %BOOT%');
  push('hi', 'Starting OpenOS Desktop Environment...', 40);
  return L;
}

/**
 * Runs the full boot animation inside `stage`.
 * Returns a promise that resolves when the splash is gone.
 */
export async function boot(stage, ctx = {}) {
  const t0 = performance.now();
  /* Hidden tabs clamp timers to ~1s — don't make a background boot take a minute. */
  const pause = ms => (document.hidden ? Promise.resolve() : sleep(ms));
  const root = h('div.boot');
  const logoStage = h('div.boot-logo',
    h('div.boot-mark', { html: `
      <svg viewBox="0 0 100 100">
        <circle class="ring" cx="50" cy="50" r="40"/>
        <path class="slash" d="M36 62 L64 38" stroke-linecap="round"/>
      </svg>` }),
    h('div.boot-word', { text: 'OPENOS' }),
    h('div.boot-bar', h('i')),
  );
  root.appendChild(logoStage);
  stage.appendChild(root);

  let skipped = false;
  const offKey = on(window, 'keydown', () => { skipped = true; });
  const offClick = on(root, 'pointerdown', () => { skipped = true; });

  /* --- phase 1: the mark --- */
  const bar = logoStage.querySelector('.boot-bar > i');
  for (let p = 0; p <= 100 && !skipped; p += 4) {
    bar.style.width = p + '%';
    await pause(14);
  }
  if (!skipped) await pause(180);

  /* --- phase 2: the kernel log --- */
  clear(root);
  const log = h('div.boot-log');
  root.appendChild(log);
  const lines = logLines(ctx);
  const started = performance.now();

  for (const [cls, text, delay] of lines) {
    const ts = ((performance.now() - t0) / 1000).toFixed(6).padStart(11, ' ');
    const body = text.replace('%BOOT%', ((performance.now() - t0) / 1000).toFixed(2) + 's');
    const line = h('div.ln');
    line.appendChild(h('span.ts', { text: `[${ts}] ` }));
    if (cls === 'ok') line.appendChild(h('span.ok', { text: '[  OK  ] ' }));
    if (cls === 'warn') line.appendChild(h('span.warn', { text: '[ WARN ] ' }));
    if (cls === 'err') line.appendChild(h('span.err', { text: '[FAILED] ' }));
    line.appendChild(h('span', { class: cls === 'hi' ? 'hi' : (cls === 'dim' ? 'dim' : ''), text: body }));
    log.appendChild(line);
    while (log.children.length > 44) log.firstChild.remove();
    if (!skipped) await pause(delay);
  }
  log.appendChild(h('div.ln', h('span.boot-cursor')));
  await pause(skipped ? 60 : 340);

  /* --- fade out --- */
  root.classList.add('fading');
  await pause(560);
  offKey(); offClick();
  root.remove();
  return performance.now() - started;
}

/** The "shutting down" / "restarting" veil. */
export async function powerVeil(stage, mode = 'shutdown') {
  const veil = h('div.power-veil',
    h('div', { style: { fontSize: '15px', letterSpacing: '.3em', opacity: .85 },
               text: mode === 'restart' ? 'YENİDEN BAŞLATILIYOR' : 'KAPATILIYOR' }),
    h('div.k-spinner', { style: { width: '22px', height: '22px', borderTopColor: '#fff' } }),
  );
  stage.appendChild(veil);
  await sleep(mode === 'restart' ? 1100 : 1500);
  return veil;
}
