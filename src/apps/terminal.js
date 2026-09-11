/* ==========================================================================
   OpenOS · apps/terminal.js — osh shell
   ========================================================================== */

import { h, clear, on, fmtBytes, escapeHtml } from '../core/util.js';
import vfs, { VFS } from '../core/vfs.js';
import settings from '../core/settings.js';
import registry from '../core/registry.js';
import notify from '../core/notify.js';
import { WALLPAPERS } from '../wallpapers/generator.js';

export default {
  id: 'terminal', name: 'Terminal', glyph: 'terminal', tint: ['#4c4c52', '#1c1c1e'],
  category: 'dev', width: 720, height: 440, minWidth: 380, minHeight: 220,
  singleton: false, keywords: ['konsol', 'shell', 'komut'],
  about: 'OpenOS kabuğu. “help” yazarak başlayın.',
  mount(ctx) {
    const t = new Terminal(ctx);
    ctx.win.onArgs = a => { if (a?.cmd) t.submit(a.cmd); };
    return t.el;
  },
};

class Terminal {
  constructor(ctx) {
    this.ctx = ctx;
    this.cwd = ctx.args?.cwd || vfs.home;
    this.history = JSON.parse(localStorage.getItem('openos.term.history') || '[]');
    this.hi = this.history.length;
    this.build();
    this.banner();
    if (ctx.args?.cmd) setTimeout(() => this.submit(ctx.args.cmd), 80);
  }

  build() {
    this.out = h('div.term-out');
    this.input = h('input.term-input', { spellcheck: false, autocomplete: 'off' });
    this.prompt = h('span.term-prompt');
    this.line = h('div.term-line', this.prompt, this.input);
    this.el = h('div.term', this.out, this.line);
    this.el.addEventListener('pointerup', () => {
      if (!window.getSelection().toString()) this.input.focus();
    });
    on(this.input, 'keydown', e => this.key(e));
    setTimeout(() => this.input.focus(), 60);
    this.setPrompt();
  }

  setPrompt() {
    const user = (settings.get('user.name') || 'user').split(' ')[0].toLowerCase();
    const p = this.cwd === vfs.home ? '~' : this.cwd.replace(vfs.home, '~');
    this.prompt.innerHTML = `<b>${escapeHtml(user)}</b>@openos <i>${escapeHtml(p)}</i> $&nbsp;`;
  }

  write(text, cls = '') {
    const div = h('div.term-row', { class: cls });
    div.innerHTML = typeof text === 'string' ? text : String(text);
    this.out.appendChild(div);
    this.el.scrollTop = this.el.scrollHeight;
    return div;
  }
  echo(text, cls) { return this.write(escapeHtml(String(text)).replace(/\n/g, '<br>'), cls); }

  banner() {
    this.write(`<span class="c-a">OpenOS</span> ${this.ctx.version} “${this.ctx.codename}” · OpenSharp 1.0
Komutları görmek için <b>help</b>, uygulamalar için <b>apps</b> yazın.`, 'dim');
  }

  key(e) {
    if (e.key === 'Enter') {
      const v = this.input.value;
      this.input.value = '';
      this.submit(v);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.hi > 0) { this.hi--; this.input.value = this.history[this.hi] || ''; }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.hi = Math.min(this.history.length, this.hi + 1);
      this.input.value = this.history[this.hi] || '';
    } else if (e.key === 'Tab') {
      e.preventDefault(); this.complete();
    } else if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); clear(this.out);
    } else if (e.key === 'c' && e.ctrlKey) {
      this.write(this.prompt.textContent + this.input.value + ' ^C', 'dim');
      this.input.value = '';
    }
  }

  complete() {
    const v = this.input.value;
    const parts = v.split(/\s+/);
    const last = parts[parts.length - 1] || '';
    const dir = last.includes('/') ? vfs.resolve(this.cwd, last.slice(0, last.lastIndexOf('/'))) : this.cwd;
    const stem = last.includes('/') ? last.slice(last.lastIndexOf('/') + 1) : last;
    let cands = [];
    if (parts.length === 1) cands = Object.keys(CMDS).filter(c => c.startsWith(stem));
    else { try { cands = vfs.list(dir).filter(s => s.name.startsWith(stem)).map(s => s.name + (s.type === 'dir' ? '/' : '')); } catch {} }
    if (cands.length === 1) {
      parts[parts.length - 1] = last.slice(0, last.length - stem.length) + cands[0];
      this.input.value = parts.join(' ');
    } else if (cands.length > 1) {
      this.echo(cands.join('   '), 'dim');
    }
  }

  submit(raw) {
    const line = raw.trim();
    this.write(`<span class="term-prompt">${this.prompt.innerHTML}</span>${escapeHtml(raw)}`);
    if (!line) return;
    this.history.push(line);
    this.history = this.history.slice(-200);
    this.hi = this.history.length;
    localStorage.setItem('openos.term.history', JSON.stringify(this.history));

    for (const seg of line.split('&&')) {
      const argv = tokenize(seg.trim());
      if (!argv.length) continue;
      const cmd = argv.shift();
      const fn = CMDS[cmd];
      if (!fn) { this.echo(`osh: komut bulunamadı: ${cmd}`, 'err'); continue; }
      try { fn(this, argv); }
      catch (e) { this.echo(e.message, 'err'); }
    }
    this.setPrompt();
    this.el.scrollTop = this.el.scrollHeight;
  }

  path(p) { return vfs.resolve(this.cwd, p); }
}

function tokenize(s) {
  const out = []; let cur = '', q = null;
  for (const c of s) {
    if (q) { if (c === q) q = null; else cur += c; }
    else if (c === '"' || c === "'") q = c;
    else if (/\s/.test(c)) { if (cur) { out.push(cur); cur = ''; } }
    else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/* ==================== commands ==================== */
export const CMDS = {
  help(t) {
    const groups = [
      ['Dosya', 'ls cd pwd cat tree mkdir touch rm mv cp find grep stat du'],
      ['Sistem', 'clear whoami date uname neofetch uptime df history exit'],
      ['Uygulama', 'apps open run install uninstall ps kill'],
      ['Görünüm', 'theme accent wallpaper notify'],
      ['Ajan', 'agent'],
    ];
    t.write(groups.map(([g, cmds]) =>
      `<span class="c-a">${g}</span>\n  ${cmds.split(' ').map(c => `<b>${c}</b>`).join('  ')}`)
      .join('\n').replace(/\n/g, '<br>'));
  },

  ls(t, a) {
    const long = a.includes('-l');
    const p = t.path(a.find(x => !x.startsWith('-')) || '.');
    const items = vfs.list(p);
    if (!items.length) return;
    if (long) {
      t.write(items.map(s =>
        `${s.type === 'dir' ? 'd' : '-'}rw-r--r--  ${String(s.type === 'dir' ? '-' : fmtBytes(s.size)).padStart(9)}  ` +
        `${new Date(s.modified).toLocaleDateString()}  ` +
        `<span class="${s.type === 'dir' ? 'c-b' : ''}">${escapeHtml(s.name)}</span>`).join('<br>'));
    } else {
      t.write(items.map(s => s.type === 'dir'
        ? `<span class="c-b">${escapeHtml(s.name)}/</span>`
        : (s.ext === 'osh' ? `<span class="c-p">${escapeHtml(s.name)}</span>` : escapeHtml(s.name)))
        .join('&nbsp;&nbsp;&nbsp;'));
    }
  },

  cd(t, a) {
    const p = t.path(a[0] || '~');
    if (!vfs.exists(p)) throw new Error(`cd: klasör yok: ${a[0]}`);
    if (!vfs.isDir(p)) throw new Error(`cd: klasör değil: ${a[0]}`);
    t.cwd = p;
  },
  pwd(t) { t.echo(t.cwd); },
  cat(t, a) {
    if (!a[0]) throw new Error('cat: dosya adı gerekli');
    t.echo(vfs.read(t.path(a[0])));
  },
  echo(t, a) { t.echo(a.join(' ')); },
  mkdir(t, a) { a.forEach(p => vfs.mkdir(t.path(p))); },
  touch(t, a) { a.forEach(p => { if (!vfs.exists(t.path(p))) vfs.write(t.path(p), ''); }); },
  rm(t, a) {
    const paths = a.filter(x => !x.startsWith('-'));
    if (!paths.length) throw new Error('rm: dosya adı gerekli');
    paths.forEach(p => vfs.remove(t.path(p)));
  },
  mv(t, a) { if (a.length < 2) throw new Error('mv: kaynak ve hedef gerekli'); vfs.move(t.path(a[0]), t.path(a[1])); },
  cp(t, a) { if (a.length < 2) throw new Error('cp: kaynak ve hedef gerekli'); vfs.copy(t.path(a[0]), t.path(a[1])); },

  tree(t, a) {
    const root = t.path(a[0] || '.');
    const lines = [];
    const walk = (p, pre = '') => {
      let items; try { items = vfs.list(p); } catch { return; }
      items.forEach((s, i) => {
        const last = i === items.length - 1;
        lines.push(pre + (last ? '└─ ' : '├─ ') +
          (s.type === 'dir' ? `<span class="c-b">${escapeHtml(s.name)}/</span>` : escapeHtml(s.name)));
        if (s.type === 'dir' && lines.length < 200) walk(s.path, pre + (last ? '   ' : '│  '));
      });
    };
    lines.push(`<span class="c-b">${escapeHtml(root)}</span>`);
    walk(root);
    t.write(lines.join('<br>'));
  },

  find(t, a) {
    const q = a[0];
    if (!q) throw new Error('find: arama metni gerekli');
    const res = vfs.search(q, { root: t.cwd });
    t.write(res.length ? res.map(s => escapeHtml(s.path)).join('<br>') : '(sonuç yok)');
  },
  grep(t, a) {
    const [q, file] = a;
    if (!q || !file) throw new Error('kullanım: grep <metin> <dosya>');
    const lines = vfs.read(t.path(file)).split('\n');
    const hits = lines.map((l, i) => [i + 1, l]).filter(([, l]) => l.includes(q));
    t.write(hits.length
      ? hits.map(([n, l]) => `<span class="dim">${n}:</span> ${escapeHtml(l).replace(new RegExp(escapeHtml(q), 'g'), `<span class="c-y">${escapeHtml(q)}</span>`)}`).join('<br>')
      : '(eşleşme yok)');
  },
  stat(t, a) {
    const s = vfs.stat(t.path(a[0] || '.'));
    if (!s) throw new Error('stat: bulunamadı');
    t.echo(`ad:      ${s.name}\nyol:     ${s.path}\ntür:     ${s.type}\nboyut:   ${fmtBytes(s.size)}\n` +
           `oluşma:  ${new Date(s.created).toLocaleString()}\ndeğişim: ${new Date(s.modified).toLocaleString()}`);
  },
  du(t) {
    const u = vfs.usage();
    t.echo(`${u.files} dosya, ${u.dirs} klasör, ${fmtBytes(u.bytes)}`);
  },
  df(t) {
    const u = vfs.usage();
    const cap = 5 * 1024 * 1024;
    const pct = Math.min(100, (u.bytes / cap) * 100).toFixed(1);
    t.echo(`Dosya sistemi   Boyut   Kullanılan  Boş      %\nvfs:/           5.0M    ${fmtBytes(u.bytes).padEnd(10)}  ${fmtBytes(cap - u.bytes).padEnd(8)} ${pct}%`);
  },

  clear(t) { clear(t.out); },
  whoami(t) { t.echo((settings.get('user.name') || 'user')); },
  date(t) { t.echo(new Date().toString()); },
  uptime(t) {
    const s = Math.floor((Date.now() - t.ctx.os.bootedAt) / 1000);
    t.echo(`up ${Math.floor(s / 60)}m ${s % 60}s`);
  },
  uname(t, a) {
    t.echo(a.includes('-a')
      ? `OpenOS ${t.ctx.version} ${t.ctx.codename} opensharp-runtime ${navigator.platform} web`
      : 'OpenOS');
  },
  history(t) { t.write(t.history.map((c, i) => `<span class="dim">${String(i + 1).padStart(4)}</span>  ${escapeHtml(c)}`).join('<br>')); },
  exit(t) { t.ctx.close(); },

  neofetch(t) {
    const u = vfs.usage();
    const logo = [
      '        ▄▄▄▄▄▄▄        ',
      '     ▄██▀     ▀██▄     ',
      '   ▄██▀   ▄▄▄   ▀██▄   ',
      '  ██▀   ▄█▀ ▀█▄   ▀██  ',
      ' ██    █▀     ▀█    ██ ',
      ' ██   █▌  ▄▄▄  ▐█   ██ ',
      ' ██    █▄     ▄█    ██ ',
      '  ██▄   ▀█▄ ▄█▀   ▄██  ',
      '   ▀██▄   ▀▀▀   ▄██▀   ',
      '     ▀██▄     ▄██▀     ',
      '        ▀▀▀▀▀▀▀        ',
    ];
    const info = [
      `<b class="c-a">${settings.get('user.name')}</b>@<b class="c-a">openos</b>`,
      '─────────────────────',
      `<b>OS</b>       OpenOS ${t.ctx.version} “${t.ctx.codename}”`,
      `<b>Kernel</b>   opensharp-runtime`,
      `<b>Shell</b>    osh`,
      `<b>Tema</b>     ${settings.isDark ? 'Koyu' : 'Açık'} · ${settings.get('accent')}`,
      `<b>Duvar</b>    ${settings.get('wallpaper')}`,
      `<b>Uygulama</b> ${registry.all().length}`,
      `<b>Dosya</b>    ${u.files} (${fmtBytes(u.bytes)})`,
      `<b>Ekran</b>    ${screen.width}×${screen.height}`,
      `<b>Tarayıcı</b> ${navigator.userAgent.split(') ').pop()}`,
      '',
      '<span style="background:#ff5f57">   </span><span style="background:#febc2e">   </span><span style="background:#28c840">   </span><span style="background:#0a84ff">   </span><span style="background:#bf5af2">   </span>',
    ];
    const rows = Math.max(logo.length, info.length);
    let outHtml = '';
    for (let i = 0; i < rows; i++)
      outHtml += `<span class="c-a">${(logo[i] || ' '.repeat(23))}</span>  ${info[i] || ''}<br>`;
    t.write(outHtml);
  },

  apps(t) {
    t.write(registry.all().map(a =>
      `<b class="c-p">${a.id.padEnd(14)}</b> ${escapeHtml(a.name.padEnd(20))} <span class="dim">${a.category}${a.kind === 'opensharp' ? ' · osh' : ''}</span>`).join('<br>'));
  },
  open(t, a) {
    if (!a[0]) throw new Error('open: hedef gerekli');
    const p = t.path(a[0]);
    if (vfs.exists(p)) t.ctx.openPath(p);
    else if (registry.has(a[0])) t.ctx.openApp(a[0]);
    else throw new Error(`open: bulunamadı: ${a[0]}`);
  },
  run(t, a) {
    const p = t.path(a[0] || '');
    if (!vfs.exists(p)) throw new Error('run: dosya yok');
    t.ctx.openApp('studio', { path: p, run: true });
  },
  install(t, a) {
    const p = t.path(a[0] || '');
    if (!vfs.exists(p)) throw new Error('install: .osh dosyası gerekli');
    const app = t.ctx.os.installApp(p);
    t.echo(`kuruldu: ${app.id} (${app.name})`);
  },
  uninstall(t, a) { t.ctx.os.uninstallApp(a[0]); },
  ps(t) {
    const wins = t.ctx.os.wm.list();
    t.write(`<span class="dim">PID   APP              DURUM     BAŞLIK</span><br>` +
      (wins.length ? wins.map((w, i) =>
        `${String(1000 + i).padEnd(6)}${w.app.id.padEnd(17)}${(w.state).padEnd(10)}${escapeHtml(w.title)}`).join('<br>')
        : '(çalışan pencere yok)'));
  },
  kill(t, a) {
    const id = a[0];
    const n = t.ctx.os.wm.byApp(id).length;
    t.ctx.os.wm.closeAll(id);
    t.echo(n ? `${n} pencere kapatıldı` : 'eşleşen pencere yok');
  },

  theme(t, a) {
    if (!a[0]) return t.echo(settings.get('theme'));
    if (!['light', 'dark', 'auto'].includes(a[0])) throw new Error('theme: light | dark | auto');
    settings.set('theme', a[0]); t.echo(`tema: ${a[0]}`);
  },
  accent(t, a) {
    if (!a[0]) return t.echo(settings.get('accent'));
    settings.set('accent', a[0]); t.echo(`vurgu: ${a[0]}`);
  },
  wallpaper(t, a) {
    if (!a[0]) return t.echo(WALLPAPERS.map(w => `${w.id.padEnd(16)}${w.name}`).join('\n'));
    if (!WALLPAPERS.some(w => w.id === a[0])) throw new Error('wallpaper: bilinmeyen kimlik');
    settings.set('wallpaper', a[0]); t.echo(`duvar kâğıdı: ${a[0]}`);
  },
  notify(t, a) {
    notify.post({ title: a[0] || 'Terminal', body: a.slice(1).join(' '), glyph: 'terminal', tint: ['#4c4c52', '#1c1c1e'] });
  },

  agent(t, a) {
    if (a[0] === 'call') {
      const res = window.OpenOS?.[a[1]]?.(...a.slice(2));
      t.echo(JSON.stringify(res, null, 2));
      return;
    }
    t.write(`<b class="c-a">Ajan arayüzü</b> — <span class="dim">window.OpenOS</span><br>` +
      Object.keys(window.OpenOS || {}).map(k => `  <b>${k}</b>`).join('<br>') +
      `<br><span class="dim">Örnek: agent call listApps</span>`);
  },
};
