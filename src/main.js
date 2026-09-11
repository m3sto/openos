/* ==========================================================================
   OpenOS · main.js — entry point
   ========================================================================== */

import kernel, { VERSION, CODENAME } from './core/kernel.js';
import { registerBuiltins } from './apps/index.js';
import { AgentAPI } from './core/agent.js';
import settings from './core/settings.js';

registerBuiltins();

/* the machine interface — available before the desktop finishes booting */
kernel.agent = new AgentAPI(kernel);
const api = kernel.agent.build();
api.version = VERSION;
Object.defineProperty(window, 'OpenOS', { value: api, writable: false, configurable: false });

/* a friendly console banner for whoever opens devtools (human or agent) */
console.log(
  `%cOpenOS%c ${VERSION} “${CODENAME}”\n` +
  `%cAjan arayüzü hazır: %cwindow.OpenOS%c — başlamak için %cawait OpenOS.describe()`,
  'font:600 16px system-ui;color:#0a84ff', 'font:14px system-ui;color:#888',
  'color:#888', 'font-family:monospace;color:#0a84ff', 'color:#888', 'font-family:monospace;color:#30d158',
);

const stage = document.getElementById('stage');
kernel.start(stage).catch(err => {
  console.error('[OpenOS] boot failed', err);
  stage.innerHTML =
    `<div style="position:absolute;inset:0;background:#000;color:#ff6a5e;font:13px/1.6 monospace;padding:30px;white-space:pre-wrap">` +
    `KERNEL PANIC\n\n${err.stack || err}</div>`;
});

/* expose a few internals for debugging / advanced agents */
window.__openos = { kernel, settings };
