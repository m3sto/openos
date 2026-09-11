/* ==========================================================================
   OpenOS · agent.js — the machine interface (window.OpenOS)
   Everything an AI agent needs to drive the system, permission-checked and
   logged. All returns are plain JSON-serialisable values.
   ========================================================================== */

import { Bus } from './util.js';
import vfs, { VFS } from './vfs.js';
import settings from './settings.js';
import registry from './registry.js';
import notify from './notify.js';

const MAX_LOG = 300;

export class AgentAPI {
  constructor(os) {
    this.os = os;
    this.bus = new Bus();
    this.log = [];
  }

  /* ---------------- plumbing ---------------- */
  _check(flag, name) {
    if (!settings.get('agent.enabled')) throw new Error('Ajan arayüzü kapalı (Sistem Ayarları → Ajan Arayüzü)');
    if (flag && !settings.get(flag)) throw new Error(`İzin yok: ${name}`);
  }
  _record(method, args, result, error) {
    const entry = { t: Date.now(), method, args: safe(args), ok: !error,
                    result: error ? String(error.message || error) : safe(result) };
    this.log.unshift(entry);
    if (this.log.length > MAX_LOG) this.log.pop();
    this.bus.emit('call', entry);
    return entry;
  }
  _wrap(method, flag, permName, fn) {
    return (...args) => {
      try {
        this._check(flag, permName);
        const r = fn(...args);
        if (settings.get('agent.logCalls')) this._record(method, args, r);
        return r;
      } catch (e) {
        this._record(method, args, null, e);
        return { error: String(e.message || e) };
      }
    };
  }

  /* ---------------- public surface ---------------- */
  build() {
    const w = (m, flag, perm, fn) => this._wrap(m, flag, perm, fn);

    const api = {
      version: this.os.constructor.name === 'Kernel' ? '1.0.0' : '1.0.0',
      name: 'OpenOS Agent API',

      /** Machine-readable capability manifest — call this first. */
      describe: () => DESCRIBE,

      /* ----- apps & windows ----- */
      listApps: w('listApps', null, null, () => registry.all().map(a => ({
        id: a.id, name: a.name, category: a.category, kind: a.kind,
        running: this.os.wm.byApp(a.id).length > 0, source: a.source || null,
      }))),
      openApp: w('openApp', 'agent.allowApps', 'uygulama açma', (id, args = {}) => {
        const win = this.os.openApp(id, args);
        return win ? { ok: true, window: win.id, app: id, title: win.title } : { ok: false, error: 'bulunamadı' };
      }),
      closeApp: w('closeApp', 'agent.allowApps', 'uygulama kapatma', (id) => {
        const n = this.os.wm.byApp(id).length;
        this.os.wm.closeAll(id);
        return { ok: true, closed: n };
      }),
      focusApp: w('focusApp', 'agent.allowApps', 'uygulama odağı', (id) => {
        const win = this.os.wm.byApp(id)[0];
        if (!win) return { ok: false, error: 'açık değil' };
        win.state === 'min' ? win.restore() : this.os.wm.focus(win);
        return { ok: true };
      }),
      listWindows: w('listWindows', null, null, () => this.os.wm.list().map(win => ({
        id: win.id, app: win.app.id, title: win.title, state: win.state,
        focused: this.os.wm.focused === win,
        bounds: { x: win.x, y: win.y, w: win.w, h: win.h },
      }))),
      arrangeWindows: w('arrangeWindows', 'agent.allowApps', 'pencere düzeni', (mode = 'tile') => {
        if (mode === 'tile') this.os.wm.tile();
        else if (mode === 'minimizeAll') this.os.wm.list().forEach(x => x.minimize());
        else if (mode === 'closeAll') this.os.wm.list().forEach(x => x.close());
        return { ok: true, mode };
      }),

      /* ----- filesystem ----- */
      fs: {
        read: w('fs.read', 'agent.allowFs', 'dosya okuma', (p) => vfs.read(vfs.resolve(vfs.home, p))),
        write: w('fs.write', 'agent.allowFs', 'dosya yazma', (p, content) => {
          const s = vfs.write(vfs.resolve(vfs.home, p), String(content ?? ''));
          return { ok: true, path: s.path, size: s.size };
        }),
        append: w('fs.append', 'agent.allowFs', 'dosya yazma', (p, c) => {
          vfs.append(vfs.resolve(vfs.home, p), String(c ?? '')); return { ok: true };
        }),
        list: w('fs.list', 'agent.allowFs', 'dosya listeleme', (p = '.') =>
          vfs.list(vfs.resolve(vfs.home, p)).map(s => ({
            name: s.name, path: s.path, type: s.type, size: s.size, modified: s.modified }))),
        stat: w('fs.stat', 'agent.allowFs', 'dosya bilgisi', (p) => vfs.stat(vfs.resolve(vfs.home, p))),
        exists: w('fs.exists', 'agent.allowFs', 'dosya bilgisi', (p) => vfs.exists(vfs.resolve(vfs.home, p))),
        mkdir: w('fs.mkdir', 'agent.allowFs', 'klasör oluşturma', (p) => {
          vfs.mkdir(vfs.resolve(vfs.home, p)); return { ok: true }; }),
        remove: w('fs.remove', 'agent.allowFs', 'dosya silme', (p) => {
          vfs.remove(vfs.resolve(vfs.home, p)); return { ok: true }; }),
        move: w('fs.move', 'agent.allowFs', 'dosya taşıma', (a, b) =>
          vfs.move(vfs.resolve(vfs.home, a), vfs.resolve(vfs.home, b))),
        copy: w('fs.copy', 'agent.allowFs', 'dosya kopyalama', (a, b) =>
          vfs.copy(vfs.resolve(vfs.home, a), vfs.resolve(vfs.home, b))),
        search: w('fs.search', 'agent.allowFs', 'dosya arama', (q, root = '/') =>
          vfs.search(q, { root }).map(s => ({ name: s.name, path: s.path, type: s.type }))),
        tree: w('fs.tree', 'agent.allowFs', 'dosya listeleme', (root = '/', depth = 3) => tree(root, depth)),
        home: () => vfs.home,
      },

      /* ----- OpenSharp ----- */
      runScript: w('runScript', 'agent.allowScript', 'betik çalıştırma', (source, opts = {}) =>
        this.runScript(source, opts)),
      installApp: w('installApp', 'agent.allowScript', 'uygulama kurma', (source, name = 'Ajan Uygulaması') => {
        const file = VFS.join('/Applications', name.replace(/[^\w .-]/g, '_') + '.osh');
        vfs.write(file, source);
        const app = this.os.installApp(file);
        return { ok: true, id: app.id, name: app.name, path: file };
      }),

      /* ----- shell ----- */
      exec: w('exec', 'agent.allowScript', 'komut çalıştırma', (command) => this.exec(command)),

      /* ----- ui ----- */
      ui: {
        notify: w('ui.notify', null, null, (title, body, glyph = 'robot') => {
          notify.post({ title: String(title), body: String(body || ''), glyph,
                        tint: ['#5e5ce6', '#bf5af2'], app: 'agent' });
          return { ok: true };
        }),
        toast: w('ui.toast', null, null, (text) => { notify.toast(String(text), { glyph: '🤖' }); return { ok: true }; }),
        openPath: w('ui.openPath', 'agent.allowApps', 'dosya açma', (p) => {
          this.os.openPath(vfs.resolve(vfs.home, p)); return { ok: true }; }),
        spotlight: w('ui.spotlight', 'agent.allowApps', 'arayüz', () => { this.os.toggleSpotlight(); return { ok: true }; }),
        launchpad: w('ui.launchpad', 'agent.allowApps', 'arayüz', () => { this.os.toggleLaunchpad(); return { ok: true }; }),
        lock: w('ui.lock', 'agent.allowApps', 'arayüz', () => { this.os.lock(); return { ok: true }; }),
      },

      /* ----- settings ----- */
      settings: {
        get: w('settings.get', null, null, (path) => path ? settings.get(path) : settings.data),
        set: w('settings.set', 'agent.allowApps', 'ayar değiştirme', (path, value) => {
          settings.set(path, value); return { ok: true, path, value }; }),
        theme: w('settings.theme', null, null, (t) => t ? (settings.set('theme', t), t) : settings.get('theme')),
        accent: w('settings.accent', null, null, (c) => c ? (settings.set('accent', c), c) : settings.get('accent')),
        wallpaper: w('settings.wallpaper', null, null, (id) => id ? (settings.set('wallpaper', id), id) : settings.get('wallpaper')),
      },

      /* ----- introspection ----- */
      snapshot: w('snapshot', null, null, () => ({
        os: { version: '1.0.0', codename: 'Meridian', uptime: Math.floor((Date.now() - this.os.bootedAt) / 1000) },
        user: { name: settings.get('user.name'), home: vfs.home },
        appearance: { theme: settings.isDark ? 'dark' : 'light', accent: settings.get('accent'),
                      wallpaper: settings.get('wallpaper') },
        windows: this.os.wm.list().map(x => ({ app: x.app.id, title: x.title, state: x.state })),
        apps: registry.all().map(a => a.id),
        storage: vfs.usage(),
        locked: this.os.locked,
      })),
      history: () => this.log.slice(0, 50),
      on: (evt, fn) => this.bus.on(evt, fn),
    };

    return api;
  }

  /* ---------------- implementations ---------------- */
  runScript(source, opts = {}) {
    const out = [];
    return import('../lang/interpreter.js').then(async ({ Interpreter }) => {
      const { makeStdlib } = await import('../lang/stdlib.js');
      const interp = new Interpreter({ onStateChange: () => {} });
      interp.install(makeStdlib(interp, {
        appId: 'agent_script', appName: 'Ajan Betiği', cwd: vfs.home,
        resolve: p => vfs.resolve(vfs.home, p),
        storePath: '/Users/shared/.appdata/agent.json',
        timers: [], onPrint: s => out.push(s),
        permissions: { fs: settings.get('agent.allowFs'), apps: settings.get('agent.allowApps'), net: true },
        openApp: (id, a) => this.os.openApp(id, a),
        refresh: () => {}, setTitle: () => {}, close: () => {},
      }));
      interp.load(source);
      const meta = interp.run();
      const hasView = !!interp.program.view;
      if (hasView && opts.open !== false) {
        const file = VFS.join('/Applications', (meta.name || 'Ajan Uygulaması').replace(/[^\w .-]/g, '_') + '.osh');
        vfs.write(file, source);
        const app = this.os.installApp(file, { silent: true });
        this.os.openApp(app.id);
        return { ok: true, output: out, app: app.id, opened: true };
      }
      return { ok: true, output: out, state: safe(interp.snapshotState()), app: null };
    }).catch(e => ({ ok: false, error: String(e.message || e), output: out }));
  }

  async exec(command) {
    const { CMDS } = await import('../apps/terminal.js');
    const lines = [];
    const fake = {
      cwd: vfs.home, history: [], ctx: this.os.appContext({ args: {}, setTitle() {}, close() {} },
        { id: 'agent', name: 'Agent' }),
      write: (htmlStr) => lines.push(decodeEntities(String(htmlStr).replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ''))),
      echo: (t) => lines.push(String(t)),
      path: (p) => vfs.resolve(fake.cwd, p),
      out: { }, el: {},
    };
    fake.ctx.os = this.os;
    fake.ctx.openApp = (id, a) => this.os.openApp(id, a);
    fake.ctx.openPath = p => this.os.openPath(p);
    fake.ctx.version = '1.0.0'; fake.ctx.codename = 'Meridian';
    const argv = command.trim().split(/\s+/);
    const cmd = argv.shift();
    if (!CMDS[cmd]) return { ok: false, error: `komut bulunamadı: ${cmd}`, output: '' };
    try {
      CMDS[cmd](fake, argv);
      return { ok: true, output: lines.join('\n'), cwd: fake.cwd };
    } catch (e) {
      return { ok: false, error: String(e.message || e), output: lines.join('\n') };
    }
  }
}

function decodeEntities(s) {
  const el = document.createElement('textarea');
  el.innerHTML = s;
  return el.value.replace(/\u00a0/g, ' ');
}

function tree(root, depth) {
  const walk = (p, d) => {
    if (d <= 0) return null;
    let items;
    try { items = vfs.list(p); } catch { return null; }
    return items.map(s => s.type === 'dir'
      ? { name: s.name, type: 'dir', children: walk(s.path, d - 1) }
      : { name: s.name, type: 'file', size: s.size });
  };
  return { root, children: walk(root, depth) };
}

function safe(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch { return String(v); }
}

export const DESCRIBE = {
  name: 'OpenOS',
  version: '1.0.0',
  description: 'Tarayıcıda çalışan sanal masaüstü işletim sistemi. Bu API bir ajanın sistemi ' +
    'uçtan uca kullanmasını sağlar: uygulama açma, dosya işlemleri, OpenSharp betikleri ve sistem durumu.',
  language: { name: 'OpenSharp', ext: '.osh', entry: 'app { } / state / fn / view { }' },
  permissions: ['agent.enabled', 'agent.allowFs', 'agent.allowApps', 'agent.allowScript'],
  methods: [
    { name: 'describe()', returns: 'bu belge' },
    { name: 'listApps()', returns: '[{id,name,category,kind,running}]' },
    { name: 'openApp(id, args?)', returns: '{ok, window, app}' },
    { name: 'closeApp(id)', returns: '{ok, closed}' },
    { name: 'focusApp(id)', returns: '{ok}' },
    { name: 'listWindows()', returns: '[{id,app,title,state,bounds}]' },
    { name: 'arrangeWindows(mode)', args: 'tile | minimizeAll | closeAll' },
    { name: 'fs.read(path)', returns: 'string' },
    { name: 'fs.write(path, content)', returns: '{ok,path,size}' },
    { name: 'fs.list(path)', returns: '[{name,path,type,size,modified}]' },
    { name: 'fs.stat(path)' }, { name: 'fs.exists(path)' }, { name: 'fs.mkdir(path)' },
    { name: 'fs.remove(path)' }, { name: 'fs.move(from,to)' }, { name: 'fs.copy(from,to)' },
    { name: 'fs.search(query, root?)' }, { name: 'fs.tree(root?, depth?)' }, { name: 'fs.home()' },
    { name: 'runScript(source, {open})', returns: 'Promise<{ok, output, app}>',
      note: 'OpenSharp kaynağını çalıştırır; view içeriyorsa uygulama olarak açar' },
    { name: 'installApp(source, name)', returns: '{ok,id,path}' },
    { name: 'exec(command)', returns: 'Promise<{ok, output}>', note: 'terminal komutu çalıştırır' },
    { name: 'ui.notify(title, body, glyph?)' }, { name: 'ui.toast(text)' },
    { name: 'ui.openPath(path)' }, { name: 'ui.spotlight()' }, { name: 'ui.launchpad()' }, { name: 'ui.lock()' },
    { name: 'settings.get(path?)' }, { name: 'settings.set(path, value)' },
    { name: 'settings.theme(t?)' }, { name: 'settings.accent(hex?)' }, { name: 'settings.wallpaper(id?)' },
    { name: 'snapshot()', returns: 'sistemin o anki tam durumu' },
    { name: 'history()', returns: 'son API çağrıları' },
    { name: 'on(event, cb)', note: "event: 'call'" },
  ],
  examples: [
    'OpenOS.openApp("terminal")',
    'await OpenOS.exec("ls ~/Projeler")',
    'OpenOS.fs.write("~/Masaüstü/merhaba.txt", "selam")',
    'await OpenOS.runScript(`app { name: "Test" } view { Label("merhaba") }`)',
    'OpenOS.settings.wallpaper("deepspace")',
  ],
};
