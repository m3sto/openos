/* ==========================================================================
   OpenOS · apps/texteditor.js — plain text & markdown editor
   ========================================================================== */

import { h, clear, on, debounce, escapeHtml } from '../core/util.js';
import { icon } from '../core/icons.js';
import vfs, { VFS } from '../core/vfs.js';
import notify from '../core/notify.js';

export default {
  id: 'texteditor', name: 'Metin Düzenleyici', glyph: 'fileText', tint: ['#ffc84a', '#e08a1e'],
  category: 'work', width: 720, height: 520, minWidth: 360, minHeight: 240, singleton: false,
  keywords: ['metin', 'yazı', 'editor', 'markdown'],
  about: 'Düz metin ve Markdown dosyalarını düzenleyin.',
  mount(ctx) {
    const e = new Editor(ctx);
    ctx.win.onArgs = a => { if (a?.path) e.open(a.path); };
    return e.el;
  },
};

class Editor {
  constructor(ctx) {
    this.ctx = ctx;
    this.path = null;
    this.ta = h('textarea.txt-area', { spellcheck: false, placeholder: 'Yazmaya başlayın…' });
    this.prev = h('div.txt-preview.k-scroll');
    this.prev.style.display = 'none';
    this.status = h('div.statusbar');
    this.previewing = false;

    const tb = h('div.toolbar',
      h('button.k-btn.s-sm', { html: icon('save', 13), text: ' Kaydet', onclick: () => this.save() }),
      h('button.k-btn.v-ghost.s-sm', { html: icon('folder', 13), text: ' Aç',
        onclick: () => this.ctx.openApp('finder', { path: VFS.join(vfs.home, 'Belgeler') }) }),
      h('div.k-spacer'),
      this.prevBtn = h('button.k-btn.v-ghost.icon.s-sm', { html: icon('eye', 14), title: 'Markdown önizleme',
        onclick: () => this.togglePreview() }),
    );
    this.el = h('div.app-shell', h('div.content', tb, h('div.txt-wrap', this.ta, this.prev), this.status));

    on(this.ta, 'input', () => { this.dirty = true; this.updateStatus(); this.renderPreview(); });
    on(this.ta, 'keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); this.save(); }
    });
    if (ctx.args?.path) this.open(ctx.args.path);
    else this.updateStatus();
    ctx.win.onBeforeClose = () => {
      if (!this.dirty) return true;
      this.save(); return true;
    };
  }

  open(p) {
    try { this.ta.value = vfs.read(p); } catch { this.ta.value = ''; }
    this.path = p; this.dirty = false;
    this.ctx.setTitle(VFS.basename(p));
    this.updateStatus();
    if (['md', 'markdown'].includes(VFS.ext(p))) { this.previewing = false; this.togglePreview(); }
  }

  async save() {
    let p = this.path;
    if (!p) {
      const n = await notify.prompt('Dosya adı:', { value: 'belge.txt', title: 'Kaydet' });
      if (!n) return;
      p = VFS.join(vfs.home, 'Belgeler', n);
    }
    vfs.write(p, this.ta.value);
    this.path = p; this.dirty = false;
    this.ctx.setTitle(VFS.basename(p));
    this.updateStatus();
    notify.toast('Kaydedildi', { glyph: '💾' });
  }

  togglePreview() {
    this.previewing = !this.previewing;
    this.prev.style.display = this.previewing ? '' : 'none';
    this.ta.style.display = this.previewing ? 'none' : '';
    this.prevBtn.classList.toggle('v-tinted', this.previewing);
    if (this.previewing) this.renderPreview();
  }

  renderPreview = debounce(() => {
    if (!this.previewing) return;
    this.prev.innerHTML = markdown(this.ta.value);
  }, 140);

  updateStatus() {
    const v = this.ta.value;
    const words = v.trim() ? v.trim().split(/\s+/).length : 0;
    this.status.textContent =
      `${this.path || 'kaydedilmemiş'} · ${v.length} karakter · ${words} kelime · ${v.split('\n').length} satır` +
      (this.dirty ? ' · değiştirildi' : '');
  }
}

/** A very small Markdown subset — enough for notes and READMEs. */
export function markdown(src) {
  const esc = escapeHtml(src);
  const blocks = esc.split(/\n{2,}/);
  return blocks.map(b => {
    if (/^```/.test(b)) return `<pre>${b.replace(/^```\w*\n?|```$/g, '')}</pre>`;
    if (/^#{1,6}\s/.test(b)) {
      const lvl = b.match(/^#+/)[0].length;
      return `<h${lvl}>${inline(b.replace(/^#+\s*/, ''))}</h${lvl}>`;
    }
    if (/^[-*]\s/m.test(b) && b.split('\n').every(l => /^\s*[-*]\s/.test(l) || !l.trim()))
      return `<ul>${b.split('\n').filter(l => l.trim()).map(l => `<li>${inline(l.replace(/^\s*[-*]\s*/, ''))}</li>`).join('')}</ul>`;
    if (/^\d+\.\s/m.test(b))
      return `<ol>${b.split('\n').filter(Boolean).map(l => `<li>${inline(l.replace(/^\s*\d+\.\s*/, ''))}</li>`).join('')}</ol>`;
    if (/^&gt;\s/.test(b)) return `<blockquote>${inline(b.replace(/^&gt;\s*/gm, ''))}</blockquote>`;
    if (/^(-{3,}|\*{3,})$/.test(b.trim())) return '<hr>';
    return `<p>${inline(b).replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
}
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
