/* ==========================================================================
   OpenSharp · oshapp.js — hosts a .osh program inside a DOM container
   ========================================================================== */

import { h, clear } from '../core/util.js';
import { Interpreter, OshError, str } from './interpreter.js';
import { createRenderer, renderChildren } from './runtime.js';
import { makeStdlib } from './stdlib.js';
import vfs, { VFS } from '../core/vfs.js';

export class OshApp {
  /**
   * new OshApp({ source, container, appId, cwd, onPrint, onError, setTitle, close, openApp })
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.container = opts.container;
    this.timers = [];
    this.dirty = false;
    this.errors = [];
    this.interp = new Interpreter({
      onStateChange: () => this.schedule(),
      onError: e => this.reportError(e),
      /* `use "./yardimci.osh"` — yollar çağıran dosyanın klasörüne göre
         çözülür, tıpkı bir modül sisteminde beklendiği gibi. */
      moduleResolver: {
        taban: opts.cwd || vfs.home,
        normalize(yol) {
          const t = String(yol);
          return t.startsWith('/') ? VFS.norm(t) : VFS.join(this.taban, t);
        },
        read(tamYol) {
          try { return vfs.read(tamYol); }
          catch {
            /* Uzantısız yazıldıysa `.osh` denenir. */
            try { return vfs.read(tamYol + '.osh'); } catch { return null; }
          }
        },
        /* Yüklenen modülün kendi `use`'ları o modülün klasörüne göre
           çözülmeli; yoksa iki klasör derinde yollar kayar. */
        child(tamYol) { return { ...this, taban: VFS.dirname(tamYol) }; },
      },
    });
  }

  get meta() { return this.interp.app || {}; }

  start(source) {
    this.source = source ?? this.opts.source;
    this.errors = [];
    try {
      this.interp.load(this.source);
    } catch (e) { return this.fail(e); }

    const appId = this.opts.appId || 'osh';
    const ctx = {
      appId,
      appName: this.opts.name || 'OpenSharp',
      cwd: this.opts.cwd || vfs.home,
      resolve: (p) => vfs.resolve(this.opts.cwd || vfs.home, p),
      storePath: VFS.join('/Users', 'shared', '.appdata', appId + '.json'),
      timers: this.timers,
      permissions: this.opts.permissions,
      tint: this.opts.tint,
      osVersion: this.opts.osVersion,
      onPrint: (s) => this.opts.onPrint?.(s),
      refresh: () => this.schedule(true),
      setTitle: (t) => this.opts.setTitle?.(t),
      close: () => this.opts.close?.(),
      openApp: (id, args) => this.opts.openApp?.(id, args),
    };
    this.interp.install(makeStdlib(this.interp, ctx));

    try {
      this.interp.run();
    } catch (e) { return this.fail(e); }

    if (this.meta.name) this.opts.setTitle?.(str(this.meta.name));
    this.render();
    this.opts.onReady?.(this.meta);
    return this.meta;
  }

  /**
   * Yeniden çizimi bir sonraki kareye erteler. `requestAnimationFrame`
   * arka plandaki sekmede durur; orada durum değişse bile görünüm
   * güncellenmiyor ve uygulama donmuş görünüyordu. Sekme gizliyken
   * zamanlayıcıya düşülür — kare hızında olması gerekmiyor, olması
   * gerekiyor.
   */
  schedule(force) {
    if (this.dirty && !force) return;
    this.dirty = true;
    const ciz = () => { this.dirty = false; this.render(); };
    if (document.hidden) setTimeout(ciz, 32);
    else requestAnimationFrame(ciz);
  }

  captureFocus() {
    const a = document.activeElement;
    if (!a || !this.container.contains(a) || !a.dataset?.focusKey) return {};
    return { key: a.dataset.focusKey, start: a.selectionStart, end: a.selectionEnd };
  }

  render() {
    if (!this.container) return;
    const focusKey = this.captureFocus();
    const scroll = [...this.container.querySelectorAll('.k-scroll')].map(n => n.scrollTop);
    let tree;
    try { tree = this.interp.buildView(); }
    catch (e) { return this.fail(e); }

    const api = createRenderer(this.interp, { focusKey, onError: e => this.reportError(e) });
    const root = h('div.osh-root');
    Object.assign(root.style, {
      display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
      overflow: 'auto', padding: this.meta.padding !== undefined ? this.meta.padding + 'px' : '0',
      background: this.meta.background || 'var(--surface)',
      gap: this.meta.spacing ? this.meta.spacing + 'px' : '0',
    });
    root.appendChild(renderChildren(tree, api));

    clear(this.container);
    this.container.appendChild(root);
    requestAnimationFrame(() => {
      this.container.querySelectorAll('.k-scroll').forEach((n, i) => { if (scroll[i] != null) n.scrollTop = scroll[i]; });
    });
    if (this.errors.length) this.container.appendChild(this.errorBar());
  }

  reportError(e) {
    const msg = e instanceof OshError ? `Satır ${e.line}: ${e.message}` : e.message;
    this.errors = [msg];
    this.opts.onError?.(e);
    this.opts.onPrint?.('⚠︎ ' + msg);
  }

  errorBar() {
    const bar = h('div', {
      style: {
        position: 'absolute', left: '10px', right: '10px', bottom: '10px', padding: '9px 12px',
        borderRadius: 'var(--r-sm)', background: 'color-mix(in srgb, var(--red) 14%, var(--surface))',
        color: 'var(--red)', fontSize: '12px', fontFamily: 'var(--mono)', boxShadow: 'var(--sh-2)',
        display: 'flex', gap: '8px', alignItems: 'center', zIndex: 20,
      },
    }, h('span', { text: '⚠︎' }), h('span', { text: this.errors[0], style: { flex: '1' } }),
       h('button.k-btn.s-sm', { text: 'Kapat', onclick: () => { this.errors = []; bar.remove(); } }));
    return bar;
  }

  fail(e) {
    const msg = e instanceof OshError ? e.toString() : (e.message || String(e));
    this.opts.onError?.(e);
    this.opts.onPrint?.('⚠︎ ' + msg);
    if (this.container) {
      clear(this.container);
      this.container.appendChild(h('div', {
        style: { padding: '26px', display: 'grid', gap: '12px', alignContent: 'start',
                 fontFamily: 'var(--mono)', fontSize: '12.5px' },
      },
        h('div', { text: '⚠︎ OpenSharp derleme hatası', style: { color: 'var(--red)', fontWeight: 700, fontSize: '14px' } }),
        h('div', { text: msg, style: { whiteSpace: 'pre-wrap', color: 'var(--text-2)' } }),
        e.line ? h('pre', {
          text: sourceExcerpt(this.source || '', e.line),
          style: { background: 'var(--surface-2)', padding: '10px', borderRadius: '8px', overflow: 'auto', margin: 0 },
        }) : null,
      ));
    }
    return null;
  }

  destroy() {
    this.timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    this.timers = [];
  }
}

function sourceExcerpt(src, line, span = 2) {
  const lines = src.split('\n');
  const from = Math.max(0, line - span - 1), to = Math.min(lines.length, line + span);
  return lines.slice(from, to).map((l, i) => {
    const no = from + i + 1;
    return `${String(no).padStart(4)} ${no === line ? '▸' : '│'} ${l}`;
  }).join('\n');
}
