/* ==========================================================================
   OpenOS · apps/terminal.js — osh shell
   ========================================================================== */

import { h, clear, on, fmtBytes, escapeHtml } from '../core/util.js';
import { contextMenu } from '../ui/menu.js';
import vfs, { VFS } from '../core/vfs.js';
import settings from '../core/settings.js';
import registry from '../core/registry.js';
import notify from '../core/notify.js';
import { WALLPAPERS } from '../wallpapers/generator.js';
import clipboard from '../core/clipboard.js';
import pkg from '../core/pkgmanager.js';
import { paketOku, paketMi, paketYaz, manifestiDenetle, kimlikYap, PAKET_UZANTISI } from '../lang/package.js';
import { parse } from '../lang/parser.js';
import { OshApp } from '../lang/oshapp.js';
import { parseAppHeader } from '../core/kernel.js';

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
    contextMenu(this.el, () => this.menu());
    setTimeout(() => this.input.focus(), 60);
    this.setPrompt();
    this.kurSecimKipi();
  }

  /* ------------------------------------------------------------------
     Terminalin kendi seçim denetimi.

     Tarayıcının fare seçimi çıktıda çalışır ama klavyeyle seçmek —
     gerçek bir terminalde en çok kullanılan şey — çalışmaz: odak giriş
     alanındadır, ok tuşları imleci oynatır. Burada `⌘⇧↑/↓` ile satır
     satır işaretlenen kendi seçimimiz var; işaretli satırlar vurgulanır
     ve `⌘C` sistemin panosuna yazar.
     ------------------------------------------------------------------ */
  kurSecimKipi() {
    this.secim = { etkin: false, bas: 0, son: 0 };

    on(this.el, 'keydown', e => {
      const mod = e.metaKey || e.ctrlKey;

      /* ⌘A — çıktının tamamını işaretle */
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'a' && !this.input.value) {
        e.preventDefault(); return this.tumunuSec();
      }
      /* ⌘C — işaretli satırları ya da fare seçimini panoya al */
      if (mod && e.key.toLowerCase() === 'c' && !e.ctrlKey) {
        const s0 = String(window.getSelection() || '');
        if (this.secim.etkin || s0.trim()) {
          e.preventDefault();
          clipboard.write(this.secim.etkin ? this.secilenMetin() : s0, { kaynak: 'terminal' });
          this.echo('panoya kopyalandı', 'dim');
          return;
        }
      }
      /* ⌘V — sistemin panosundan yapıştır */
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        const t = clipboard.read();
        if (t) {
          /* Çok satırlı yapıştırmada her satır ayrı komut olur — bir
             terminalde beklenen davranış budur. */
          const satirlar = t.split('\n');
          this.input.value += satirlar.shift();
          satirlar.forEach(l => { this.submit(this.input.value); this.input.value = l; });
        }
        this.input.focus();
        return;
      }
      /* ⌘⇧↑ / ⌘⇧↓ — satır satır işaretle */
      if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        return this.secimiKaydir(e.key === 'ArrowUp' ? -1 : +1);
      }
      if (e.key === 'Escape' && this.secim.etkin) { e.preventDefault(); return this.secimiBirak(); }
    });

    /* Fareyle bir satıra tıklamak seçim kipini bırakır. */
    on(this.out, 'pointerdown', () => this.secimiBirak());
  }

  get satirlar() { return [...this.out.children]; }

  secimiKaydir(yon) {
    const n = this.satirlar.length;
    if (!n) return;
    if (!this.secim.etkin) {
      this.secim = { etkin: true, bas: n - 1, son: n - 1 };
    } else {
      this.secim.son = Math.max(0, Math.min(n - 1, this.secim.son + yon));
    }
    this.secimiCiz();
  }

  tumunuSec() {
    const n = this.satirlar.length;
    if (!n) return;
    this.secim = { etkin: true, bas: 0, son: n - 1 };
    this.secimiCiz();
  }

  secimiBirak() {
    if (!this.secim?.etkin) return;
    this.secim.etkin = false;
    this.satirlar.forEach(l => l.classList.remove('secili'));
  }

  secimiCiz() {
    const a = Math.min(this.secim.bas, this.secim.son);
    const b = Math.max(this.secim.bas, this.secim.son);
    this.satirlar.forEach((l, i) => l.classList.toggle('secili', i >= a && i <= b));
    this.satirlar[this.secim.son]?.scrollIntoView({ block: 'nearest' });
  }

  secilenMetin() {
    const a = Math.min(this.secim.bas, this.secim.son);
    const b = Math.max(this.secim.bas, this.secim.son);
    return this.satirlar.slice(a, b + 1).map(l => l.innerText).join('\n');
  }

  menu() {
    const sel = String(window.getSelection() || '');
    return [
      { header: 'Terminal' },
      { label: 'Kopyala', glyph: 'copy', key: '⌘C', disabled: !sel.trim(),
        run: () => clipboard.write(sel, { kaynak: 'terminal' }) },
      { label: 'Yapıştır', glyph: 'clipboard', key: '⌘V', disabled: clipboard.bos,
        run: () => { this.input.value += clipboard.read(); this.input.focus(); } },
      { label: 'Tümünü Seç', glyph: 'selectAll', key: '⌘A', run: () => this.tumunuSec() },
      { label: 'Çıktıyı Kopyala', glyph: 'copy',
        run: () => clipboard.write(this.out.innerText, { kaynak: 'terminal' }) },
      '-',
      { label: 'Ekranı temizle', glyph: 'trash', key: '⌃L', run: () => clear(this.out) },
      { label: 'Geçmişi göster', glyph: 'clock', run: () => this.submit('history') },
      { label: 'Bu klasörü Finder’da aç', glyph: 'folder',
        run: () => this.ctx.openApp('finder', { path: this.cwd }) },
      '-',
      { label: 'Yeni terminal', glyph: 'plus', run: () => this.ctx.openApp('terminal', { cwd: this.cwd }, true) },
      { label: 'neofetch', glyph: 'cpu', run: () => this.submit('neofetch') },
    ];
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
  help(t, a) {
    if (a && a.length) return CMDS.man(t, a);
    const groups = [
      ['Dosya', 'ls cd pwd cat tree mkdir touch rm trash mv cp find grep stat du head tail wc sort uniq'],
      ['Metin', 'echo json clip'],
      ['Sistem', 'clear whoami date uname neofetch uptime df history env which man exit'],
      ['Uygulama', 'apps open run ps kill'],
      ['Paket', 'pkg oshc osh'],
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
  /**
   * Varsayılan olarak çöp kutusuna taşır — kabukta yazılan bir komutun
   * dosyayı geri dönüşsüz yok etmesi, yanlış yazılmış tek bir yolda veri
   * kaybı demek. Kalıcı silmek `-f` ile açıkça istenir.
   */
  rm(t, a) {
    const paths = a.filter(x => !x.startsWith('-'));
    if (!paths.length) throw new Error('rm: dosya adı gerekli');
    const kalici = a.includes('-f') || a.includes('--force');
    let n = 0;
    for (const p of paths) {
      const tam = t.path(p);
      if (kalici) { vfs.remove(tam); n++; }
      else { const k = vfs.trash(tam); if (k) n++; }
    }
    t.echo(kalici ? `${n} öğe kalıcı olarak silindi` : `${n} öğe çöp kutusuna taşındı  (kalıcı için: rm -f)`, 'dim');
  },

  /** trash — çöp kutusunu listeler, geri yükler, boşaltır. */
  trash(t, a) {
    const alt = a[0] || 'ls';
    if (alt === 'ls' || alt === 'list') {
      const liste = vfs.trashList();
      if (!liste.length) return t.echo('çöp kutusu boş', 'dim');
      return t.write(liste.map(k =>
        `<span class="c-a">${escapeHtml(k.id)}</span>  ${escapeHtml(k.ad)}  ` +
        `<span class="dim">${escapeHtml(VFS.dirname(k.eskiYol))}</span>`).join('<br>'));
    }
    if (alt === 'restore') {
      if (!a[1]) return t.echo('kullanım: trash restore <id|all>', 'err');
      if (a[1] === 'all') {
        let n = 0;
        for (const k of vfs.trashList()) { try { vfs.restore(k.id); n++; } catch {} }
        return t.echo(`${n} öğe geri yüklendi`, 'ok');
      }
      try { t.echo('✓ ' + vfs.restore(a[1]), 'ok'); }
      catch (e) { t.echo(e.message, 'err'); }
      return;
    }
    if (alt === 'empty') {
      const n = vfs.emptyTrash();
      return t.echo(`${n} öğe kalıcı olarak silindi`, 'ok');
    }
    t.echo('trash ls | restore <id|all> | empty', 'dim');
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

  /* ==================== paket yöneticisi ==================== */
  /**
   * pkg ls | info <id> | install <yol> | remove <id> | search <q> | verify <yol>
   *
   * Mağazadan kurulan uygulama da buradan kaldırılabilir; yayınlanmamış,
   * imzasız bir paket de buradan kurulabilir. İkisi arasında ayrım yok —
   * fark yalnızca kurulum defterine yazılan kaynak.
   */
  pkg(t, a) {
    const alt = a[0] || 'ls';

    if (alt === 'ls' || alt === 'list') {
      const liste = pkg.list();
      if (!liste.length) return t.echo('kurulu OpenSharp uygulaması yok', 'dim');
      t.write(liste.map(p =>
        `<b>${escapeHtml(p.id)}</b>  <span class="c-a">${escapeHtml(p.surum)}</span>  ` +
        `${escapeHtml(p.ad)}  <span class="dim">${escapeHtml(p.nereden)}</span>`).join('<br>'));
      return;
    }

    if (alt === 'info') {
      const p = pkg.get(a[1]);
      if (!p) return t.echo(`kurulu değil: ${a[1] || ''}`, 'err');
      const satir = (k, v) => `<span class="c-a">${k.padEnd(10)}</span>${escapeHtml(String(v ?? '—'))}`;
      t.write([
        satir('kimlik', p.id), satir('ad', p.ad), satir('sürüm', p.surum),
        satir('yazar', p.yazar), satir('kaynak', p.nereden),
        satir('paket', p.paket || p.kaynak),
        satir('kuruldu', p.kuruldu ? new Date(p.kuruldu).toLocaleString('tr-TR') : '—'),
      ].join('<br>'));
      return;
    }

    if (alt === 'verify') {
      const yol = t.path(a[1] || '.');
      const b = pkg.inspect(yol);
      if (b.gecerli) {
        t.echo(`✓ geçerli ${b.tur} · ${b.manifest.name} ${b.manifest.version} · ${fmtBytes(b.boyut)}` +
               (b.simgeVar ? ' · simgeli' : ''), 'ok');
      } else {
        t.echo(`✗ kurulamaz:`, 'err');
        b.sorunlar.forEach(x => t.echo(`   ${x.alan}: ${x.ileti}`, 'err'));
      }
      return;
    }

    if (alt === 'install' || alt === 'add') {
      if (!a[1]) return t.echo('kullanım: pkg install <yol>', 'err');
      const yol = t.path(a[1]);
      try {
        const r = pkg.install({ yol, nereden: 'yerel', pinle: !a.includes('--no-pin') });
        t.echo(`✓ ${r.manifest.name} ${r.manifest.version} kuruldu → ${r.yol}`, 'ok');
      } catch (e) {
        t.echo(`✗ kurulamadı: ${e.message}`, 'err');
      }
      return;
    }

    if (alt === 'remove' || alt === 'rm' || alt === 'uninstall') {
      if (!a[1]) return t.echo('kullanım: pkg remove <id> [--purge]', 'err');
      try {
        const r = pkg.remove(a[1], { veriyiDeSil: a.includes('--purge') });
        t.echo(`✓ ${r.ad} kaldırıldı`, 'ok');
        r.silinen.forEach(y => t.echo(`   silindi: ${y}`, 'dim'));
      } catch (e) { t.echo(`✗ ${e.message}`, 'err'); }
      return;
    }

    if (alt === 'search') {
      const q = (a[1] || '').toLowerCase();
      const bulunan = registry.all().filter(x =>
        x.id.toLowerCase().includes(q) || x.name.toLowerCase().includes(q));
      if (!bulunan.length) return t.echo('eşleşme yok', 'dim');
      t.write(bulunan.map(x =>
        `<b>${escapeHtml(x.id)}</b>  ${escapeHtml(x.name)}  ` +
        `<span class="dim">${x.kind === 'opensharp' ? 'OpenSharp' : 'yerli'}</span>`).join('<br>'));
      return;
    }

    t.echo('pkg ls | info <id> | install <yol> | remove <id> [--purge] | search <q> | verify <yol>', 'dim');
  },

  /* ==================== OpenSharp derleyicisi ==================== */
  /**
   * oshc — komut satırı derleyicisi.
   *   oshc check <dosya>            söz dizimini denetler
   *   oshc build <dosya> [-o <yol>] .osapp paketi üretir
   *   oshc info <dosya>             app başlığını ve simgeleri dökümler
   */
  oshc(t, a) {
    const alt = a[0];
    const dosya = a[1] ? t.path(a[1]) : null;

    if (!alt || alt === '--help') {
      return t.write([
        '<span class="c-a">oshc</span> — OpenSharp derleyicisi',
        '  oshc check &lt;dosya&gt;             söz dizimini denetle',
        '  oshc build &lt;dosya&gt; [-o &lt;yol&gt;]  .osapp paketi üret',
        '  oshc info  &lt;dosya&gt;             başlık ve simgeleri göster',
      ].join('<br>'));
    }

    if (!dosya || !vfs.isFile(dosya)) return t.echo(`dosya yok: ${a[1] || ''}`, 'err');
    const kaynak = vfs.read(dosya);

    if (alt === 'check') {
      try {
        parse(kaynak);
        t.echo(`✓ ${VFS.basename(dosya)} · söz dizimi temiz · ${kaynak.split('\n').length} satır`, 'ok');
      } catch (e) {
        t.echo(`✗ satır ${e.line || '?'}: ${e.message}`, 'err');
      }
      return;
    }

    if (alt === 'info') {
      let agac;
      try { agac = parse(kaynak); } catch (e) { return t.echo(`✗ ${e.message}`, 'err'); }
      const m = parseAppHeader(kaynak);
      const simgeler = [];
      const gez = n => {
        if (!n || typeof n !== 'object') return;
        if (n.type === 'FnDecl') simgeler.push(`fn ${n.name}()`);
        if (n.type === 'VarDecl' && n.kind === 'state') simgeler.push(`state ${n.name}`);
        if (n.type === 'TypeDecl') simgeler.push(`type ${n.ad}`);
        if (n.type === 'EnumDecl') simgeler.push(`enum ${n.ad}`);
        for (const k in n) if (Array.isArray(n[k])) n[k].forEach(gez); else if (n[k]?.type) gez(n[k]);
      };
      agac.body.forEach(gez);
      t.write([
        `<span class="c-a">ad</span>       ${escapeHtml(m.name || '—')}`,
        `<span class="c-a">simge</span>    ${escapeHtml(m.icon || '—')}`,
        `<span class="c-a">ölçü</span>     ${m.width || '—'}×${m.height || '—'}`,
        `<span class="c-a">görünüm</span>  ${agac.view ? 'var' : 'yok'}`,
        `<span class="c-a">simgeler</span> ${simgeler.length}`,
        ...simgeler.map(x => `  ${escapeHtml(x)}`),
      ].join('<br>'));
      return;
    }

    if (alt === 'build') {
      try { parse(kaynak); }
      catch (e) { return t.echo(`✗ derleme durdu — satır ${e.line || '?'}: ${e.message}`, 'err'); }

      const m = parseAppHeader(kaynak);
      const ad = m.name || VFS.basename(dosya).replace(/\.osh$/, '');
      const manifest = {
        id: m.id || kimlikYap(ad), name: ad, version: m.version || '1.0.0',
        icon: m.icon || 'sparkles', tint: m.tint || ['#5e5ce6', '#bf5af2'],
        width: m.width || 480, height: m.height || 420,
        author: m.author || settings.get('user.name') || '',
        about: m.about || '',
      };
      const sorunlar = manifestiDenetle(manifest);
      if (sorunlar.length) {
        t.echo('✗ manifest geçersiz:', 'err');
        sorunlar.forEach(x => t.echo(`   ${x.alan}: ${x.ileti}`, 'err'));
        return;
      }
      const oIndex = a.indexOf('-o');
      const hedef = oIndex !== -1 && a[oIndex + 1]
        ? t.path(a[oIndex + 1])
        : VFS.join(VFS.dirname(dosya), `${ad}.${PAKET_UZANTISI}`);

      paketYaz({ dizin: hedef, kaynak, manifest, benioku: m.about ? `# ${ad}\n\n${m.about}\n` : null });
      t.echo(`✓ ${hedef}`, 'ok');
      t.echo(`  ${manifest.id} ${manifest.version} · ${fmtBytes(pkg.boyut(hedef))}`, 'dim');
      t.echo(`  kurmak için: pkg install ${hedef}`, 'dim');
      return;
    }

    t.echo(`bilinmeyen alt komut: ${alt}`, 'err');
  },

  /** osh <dosya> — bir .osh betiğini pencere açmadan çalıştırır, çıktısı burada. */
  osh(t, a) {
    if (!a[0]) return t.echo('kullanım: osh <dosya.osh>', 'err');
    const dosya = t.path(a[0]);
    if (!vfs.isFile(dosya)) return t.echo(`dosya yok: ${a[0]}`, 'err');
    const kutu = document.createElement('div');
    const runner = new OshApp({
      container: kutu, appId: 'osh-cli', cwd: VFS.dirname(dosya),
      onPrint: line => t.echo(String(line)),
      onError: e => t.echo(`✗ ${e.message}`, 'err'),
    });
    try {
      runner.start(vfs.read(dosya));
      /* Görünüm üreten bir program betik olarak çalıştırıldığında yalnızca
         yan etkileri görünür; kaç bileşen üretildiği bilgi olarak verilir. */
      if (kutu.childElementCount) t.echo(`(${kutu.childElementCount} görünüm ögesi çizildi — pencerede görmek için: run ${a[0]})`, 'dim');
    } catch (e) { t.echo(`✗ ${e.message}`, 'err'); }
    setTimeout(() => runner.destroy?.(), 50);
  },

  /* ==================== ek konsol araçları ==================== */
  head(t, a) {
    const n = Number((a.find(x => /^-\d+$/.test(x)) || '-10').slice(1));
    const p = t.path(a.find(x => !x.startsWith('-')) || '.');
    t.write(escapeHtml(vfs.read(p).split('\n').slice(0, n).join('\n')).replace(/\n/g, '<br>'));
  },
  tail(t, a) {
    const n = Number((a.find(x => /^-\d+$/.test(x)) || '-10').slice(1));
    const p = t.path(a.find(x => !x.startsWith('-')) || '.');
    t.write(escapeHtml(vfs.read(p).split('\n').slice(-n).join('\n')).replace(/\n/g, '<br>'));
  },
  wc(t, a) {
    const p = t.path(a[0] || '.');
    const v = vfs.read(p);
    t.echo(`${v.split('\n').length} satır  ${v.trim() ? v.trim().split(/\s+/).length : 0} kelime  ${v.length} karakter  ${VFS.basename(p)}`);
  },
  sort(t, a) {
    const ters = a.includes('-r');
    const p = t.path(a.find(x => !x.startsWith('-')) || '.');
    const satir = vfs.read(p).split('\n').filter(Boolean).sort((x, y) => x.localeCompare(y, 'tr'));
    if (ters) satir.reverse();
    t.write(escapeHtml(satir.join('\n')).replace(/\n/g, '<br>'));
  },
  uniq(t, a) {
    const p = t.path(a[0] || '.');
    const gorulen = new Set(), cikti = [];
    for (const l of vfs.read(p).split('\n')) { if (!gorulen.has(l)) { gorulen.add(l); cikti.push(l); } }
    t.write(escapeHtml(cikti.join('\n')).replace(/\n/g, '<br>'));
  },
  json(t, a) {
    const p = t.path(a[0] || '.');
    try {
      const v = JSON.parse(vfs.read(p));
      t.write(escapeHtml(JSON.stringify(v, null, 2)).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;'));
    } catch (e) { t.echo(`geçersiz JSON: ${e.message}`, 'err'); }
  },
  /** Sistemin panosunu görüntüler ve yazar — dışarıyla hiç ilişkisi yok. */
  clip(t, a) {
    if (a[0] === 'set') { clipboard.write(a.slice(1).join(' '), { kaynak: 'terminal' }); return t.echo('panoya yazıldı', 'ok'); }
    if (a[0] === 'clear') { clipboard.clear(); return t.echo('pano temizlendi', 'ok'); }
    if (a[0] === 'history') {
      const g = clipboard.gecmis;
      if (!g.length) return t.echo('pano geçmişi boş', 'dim');
      return t.write(g.map((o, i) =>
        `<span class="c-a">${String(i).padStart(2)}</span>  ${escapeHtml(o.text.slice(0, 70).replace(/\n/g, '⏎'))}` +
        `  <span class="dim">${o.kaynak || ''}</span>`).join('<br>'));
    }
    const v = clipboard.read();
    t.echo(v || '(pano boş)', v ? '' : 'dim');
  },
  env(t) {
    const bilgi = {
      KULLANICI: settings.get('user.name'), EV: vfs.home, KLASOR: t.cwd,
      TEMA: settings.isDark ? 'koyu' : 'açık', VURGU: settings.get('accent'),
      DIL: 'OpenSharp 1.0', KABUK: 'osh',
    };
    t.write(Object.entries(bilgi).map(([k, v]) =>
      `<span class="c-a">${k}</span>=${escapeHtml(String(v))}`).join('<br>'));
  },
  which(t, a) {
    const c = a[0];
    if (!c) return t.echo('kullanım: which <komut>', 'err');
    t.echo(CMDS[c] ? `${c}: yerleşik kabuk komutu` : `${c}: bulunamadı`, CMDS[c] ? '' : 'err');
  },
  /** man — komutların tek satırlık açıklamaları. */
  man(t, a) {
    const c = a[0];
    if (!c) return t.echo('kullanım: man <komut>', 'err');
    const metin = MAN[c];
    if (!metin) return t.echo(`kılavuz yok: ${c}`, 'err');
    t.write(`<span class="c-a">${escapeHtml(c)}</span> — ${escapeHtml(metin)}`);
  },
};

/* Komutların tek satırlık kılavuzu — `man <komut>` bunu okur. */
export const MAN = {
  ls: 'Klasör içeriğini listeler. -l ile ayrıntılı.',
  cd: 'Çalışma klasörünü değiştirir. `cd -` bir öncekine döner.',
  pwd: 'Bulunduğunuz klasörün tam yolunu yazar.',
  cat: 'Dosyanın içeriğini yazdırır.',
  head: 'Dosyanın ilk satırlarını yazar. -20 ile sayı verilir.',
  tail: 'Dosyanın son satırlarını yazar. -20 ile sayı verilir.',
  wc: 'Satır, kelime ve karakter sayar.',
  sort: 'Satırları sıralar. -r ile tersten.',
  uniq: 'Art arda yinelenen satırları teke indirir.',
  grep: 'Dosyalarda metin arar.',
  find: 'Ada göre dosya arar.',
  tree: 'Klasörü ağaç olarak çizer.',
  stat: 'Dosyanın boyutunu ve tarihlerini gösterir.',
  du: 'Klasörün kapladığı yeri hesaplar.',
  json: 'JSON dosyasını biçimli yazdırır.',
  rm: 'Çöp kutusuna taşır. Kalıcı silmek için -f.',
  trash: 'Çöp kutusu: trash ls | restore <id|all> | empty.',
  clip: 'Sistemin panosu: clip | clip set <metin> | clip history | clip clear.',
  env: 'Ortam bilgilerini listeler.',
  which: 'Bir komutun var olup olmadığını söyler.',
  man: 'Bir komutun kılavuzunu gösterir.',
  pkg: 'Paket yöneticisi: ls, info, install, remove, search, verify.',
  oshc: 'OpenSharp derleyicisi: check, build, info.',
  osh: 'Bir .osh betiğini pencere açmadan çalıştırır.',
  ps: 'Çalışan uygulamaları listeler.',
  kill: 'Bir uygulamayı kapatır.',
  apps: 'Kurulu uygulamaları listeler.',
  open: 'Bir dosyayı uygun uygulamayla açar.',
  run: 'Bir .osh dosyasını pencerede çalıştırır.',
  theme: 'Temayı değiştirir: theme dark | light.',
  accent: 'Vurgu rengini değiştirir.',
  wallpaper: 'Duvar kâğıdını değiştirir.',
  notify: 'Bildirim gönderir.',
  agent: 'Ajan arayüzüne komut gönderir.',
  neofetch: 'Sistem künyesini gösterir.',
  history: 'Komut geçmişini listeler.',
  clear: 'Ekranı temizler.',
  exit: 'Terminali kapatır.',
};
