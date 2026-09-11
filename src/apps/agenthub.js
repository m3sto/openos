/* ==========================================================================
   OpenOS · apps/agenthub.js — live docs + call log + playground for the
   window.OpenOS agent interface.
   ========================================================================== */

import { h, clear, on, escapeHtml } from '../core/util.js';
import { icon } from '../core/icons.js';
import settings from '../core/settings.js';
import { DESCRIBE } from '../core/agent.js';

export default {
  id: 'agenthub', name: 'Ajan Merkezi', glyph: 'robot', tint: ['#7b5cff', '#3f21b8'],
  category: 'dev', width: 880, height: 600, minWidth: 520, minHeight: 360,
  keywords: ['ajan', 'agent', 'api', 'otomasyon', 'ai'],
  about: 'window.OpenOS arayüzünün canlı belgeleri, çağrı günlüğü ve deneme konsolu.',
  mount(ctx) { return new AgentHub(ctx).el; },
};

class AgentHub {
  constructor(ctx) {
    this.ctx = ctx;
    this.tab = 'overview';
    this.body = h('div.content.k-scroll', { style: { padding: '18px 22px', gap: '16px' } });
    this.sidebar = h('div.sidebar', { style: { width: '190px' } });
    this.el = h('div.app-shell', this.sidebar, this.body);
    [['overview', 'Genel Bakış', 'info'], ['methods', 'Yöntemler', 'list'],
     ['log', 'Çağrı Günlüğü', 'clock'], ['console', 'Konsol', 'terminal'],
     ['recipes', 'Tarifler', 'sparkles']].forEach(([id, label, g]) => {
      this.sidebar.appendChild(h('div.sb-item', { dataset: { id }, class: id === this.tab ? 'on' : '',
        onclick: () => this.select(id) }, h('span.ic', { html: icon(g, 14) }), h('span', { text: label })));
    });
    this.off = ctx.os.agent.bus.on('call', () => { if (this.tab === 'log') this.render(); });
    ctx.win.onClosed = () => this.off?.();
    this.render();
  }

  select(id) {
    this.tab = id;
    this.sidebar.querySelectorAll('.sb-item').forEach(i => i.classList.toggle('on', i.dataset.id === id));
    this.render();
  }

  render() {
    clear(this.body);
    this['t_' + this.tab]?.call(this);
    this.body.scrollTop = 0;
  }

  t_overview() {
    const enabled = settings.get('agent.enabled');
    this.body.append(
      h('div.k-hstack', { style: { gap: '14px' } },
        h('div.app-icon', { style: { '--ic1': '#7b5cff', '--ic2': '#3f21b8', width: '54px', height: '54px' },
          html: icon('robot', 27) }),
        h('div.k-vstack', { style: { gap: '2px' } },
          h('div.k-text.t-title', { text: 'Ajan Arayüzü' }),
          h('div.k-text.t-callout', { text: `window.OpenOS · sürüm ${DESCRIBE.version}` })),
        h('div.k-spacer'),
        h('span.k-badge', { class: enabled ? 'b-green' : 'b-red', text: enabled ? 'ETKİN' : 'KAPALI' })),
      h('div.k-text.t-body', { text: DESCRIBE.description, style: { maxWidth: '620px', lineHeight: 1.55 } }),
      h('div.k-sectitle', { text: 'İzinler' }),
      h('div.k-group', ...[
        ['agent.enabled', 'Arayüz etkin', 'Tüm API çağrıları'],
        ['agent.allowFs', 'Dosya erişimi', 'fs.* yöntemleri'],
        ['agent.allowApps', 'Uygulama kontrolü', 'openApp / closeApp / ui.*'],
        ['agent.allowScript', 'Betik çalıştırma', 'runScript / exec / installApp'],
      ].map(([path, t, s]) => {
        const tg = h('div.k-toggle', { dataset: { on: settings.get(path) ? '1' : '0' } });
        tg.addEventListener('click', () => {
          const v = !settings.get(path); settings.set(path, v); tg.dataset.on = v ? '1' : '0'; this.render();
        });
        return h('div.k-row', h('div.lead', { style: { background: 'var(--indigo)' }, html: icon('shield', 15) }),
          h('div.k-vstack', { style: { flex: 1, gap: '1px' } },
            h('div.k-text', { text: t, style: { fontWeight: 520 } }),
            h('div.k-text.t-caption', { text: s })), tg);
      })),
      h('div.k-sectitle', { text: 'Hızlı başlangıç' }),
      h('pre.st-code', { text: DESCRIBE.examples.join('\n') }),
      h('div.k-hstack', { style: { gap: '8px' } },
        h('button.k-btn.v-primary.s-sm', { text: 'describe() çalıştır',
          onclick: () => { this.select('console'); setTimeout(() => this.run('OpenOS.describe()'), 60); } }),
        h('button.k-btn.s-sm', { text: 'Manifesti kopyala',
          onclick: () => { navigator.clipboard?.writeText(JSON.stringify(DESCRIBE, null, 2));
                           this.ctx.notify.toast('Kopyalandı', { glyph: '📋' }); } })),
    );
  }

  t_methods() {
    this.body.append(h('div.k-text.t-title2', { text: 'Yöntemler' }),
      h('div.k-text.t-caption', { text: `${DESCRIBE.methods.length} yöntem` }));
    const g = h('div.k-group');
    DESCRIBE.methods.forEach(m => {
      g.appendChild(h('div.k-row.tappable', {
        onclick: () => { this.select('console'); setTimeout(() => { this.input.value = 'OpenOS.' + m.name; this.input.focus(); }, 60); },
      }, h('div.k-vstack', { style: { flex: 1, gap: '2px' } },
          h('div.k-text.t-mono', { text: m.name, style: { color: 'var(--accent)' } }),
          m.returns ? h('div.k-text.t-caption', { text: '→ ' + m.returns }) : null,
          m.note ? h('div.k-text.t-caption', { text: m.note }) : null)));
    });
    this.body.appendChild(g);
  }

  t_log() {
    const log = this.ctx.os.agent.log;
    this.body.append(
      h('div.k-hstack', { style: { gap: '8px' } },
        h('div.k-text.t-title2', { text: 'Çağrı Günlüğü' }), h('div.k-spacer'),
        h('button.k-btn.s-sm', { text: 'Temizle', onclick: () => { this.ctx.os.agent.log.length = 0; this.render(); } })));
    if (!log.length) {
      this.body.appendChild(h('div.k-empty', h('div.glyph', { text: '🤖' }),
        h('div.k-text.t-callout', { text: 'Henüz çağrı yok. Konsoldan bir şeyler deneyin.' })));
      return;
    }
    const g = h('div.k-group');
    log.slice(0, 80).forEach(e => {
      g.appendChild(h('div.k-row',
        h('div.lead', { style: { background: e.ok ? 'var(--green)' : 'var(--red)' },
          html: icon(e.ok ? 'check' : 'x', 14) }),
        h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '2px' } },
          h('div.k-text.t-mono', { text: e.method + '(' + shortArgs(e.args) + ')' }),
          h('div.k-text.t-caption.ellipsis', { text: typeof e.result === 'string' ? e.result : JSON.stringify(e.result) })),
        h('div.k-text.t-caption', { text: new Date(e.t).toLocaleTimeString() })));
    });
    this.body.appendChild(g);
  }

  t_console() {
    this.out = h('div.term-out', { style: { flex: '1', minHeight: '180px' } });
    this.input = h('input.term-input', { spellcheck: false, placeholder: 'OpenOS.listApps()' });
    const line = h('div.term-line', h('span.term-prompt', { html: '<b>agent</b> &gt;&nbsp;' }), this.input);
    const box = h('div.term', { style: { borderRadius: 'var(--r-md)', minHeight: '280px' } }, this.out, line);
    on(this.input, 'keydown', e => { if (e.key === 'Enter') { this.run(this.input.value); this.input.value = ''; } });
    this.body.append(
      h('div.k-text.t-title2', { text: 'Konsol' }),
      h('div.k-text.t-caption', { text: 'JavaScript ifadeleri değerlendirilir; OpenOS global olarak kullanılabilir.' }),
      box,
      h('div.k-hstack', { style: { gap: '6px', flexWrap: 'wrap' } },
        ...['OpenOS.snapshot()', 'OpenOS.listApps()', 'await OpenOS.exec("neofetch")',
            'OpenOS.fs.list("~")', 'OpenOS.settings.theme("dark")'].map(s =>
          h('button.k-btn.s-sm.v-ghost', { text: s, onclick: () => this.run(s) }))));
    setTimeout(() => this.input?.focus(), 60);
  }

  async run(expr) {
    if (!expr.trim()) return;
    this.out.appendChild(h('div.term-row', { html: `<span class="term-prompt"><b>agent</b> &gt;&nbsp;</span>${escapeHtml(expr)}` }));
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('OpenOS', `return (async () => (${expr}))()`);
      const res = await fn(window.OpenOS);
      this.out.appendChild(h('div.term-row.ok', { text: pretty(res) }));
    } catch (e) {
      this.out.appendChild(h('div.term-row.err', { text: String(e.message || e) }));
    }
    this.out.parentElement.scrollTop = this.out.parentElement.scrollHeight;
  }

  t_recipes() {
    const recipes = [
      ['Sistemi tanı', 'await OpenOS.describe()\nOpenOS.snapshot()'],
      ['Bir dosya oluştur ve aç',
       'OpenOS.fs.write("~/Masaüstü/ajan.txt", "Bu dosyayı bir ajan yazdı.")\nOpenOS.ui.openPath("~/Masaüstü/ajan.txt")'],
      ['Kendi uygulamanı kur',
       'await OpenOS.runScript(`\napp { name: "Ajan Paneli" icon: "robot" }\nstate n = 0\nview {\n  VStack(spacing: 12, padding: 20) {\n    Label("Sayaç: " + n, style: "title")\n    Button("Artır", variant: "primary", onClick: fn() { n = n + 1 })\n  }\n}`)'],
      ['Kabuk komutu çalıştır', 'await OpenOS.exec("ls ~/Projeler")\nawait OpenOS.exec("df")'],
      ['Masaüstünü yeniden düzenle',
       'OpenOS.openApp("finder")\nOpenOS.openApp("terminal")\nOpenOS.arrangeWindows("tile")'],
      ['Görünümü değiştir',
       'OpenOS.settings.theme("dark")\nOpenOS.settings.accent("#bf5af2")\nOpenOS.settings.wallpaper("deepspace")'],
    ];
    this.body.append(h('div.k-text.t-title2', { text: 'Tarifler' }),
      h('div.k-text.t-caption', { text: 'Kopyalayıp konsolda çalıştırın.' }));
    recipes.forEach(([title, code]) => {
      this.body.appendChild(h('div.k-card', { style: { display: 'grid', gap: '8px' } },
        h('div.k-hstack', h('div.k-text.t-headline', { text: title }), h('div.k-spacer'),
          h('button.k-btn.s-sm', { text: 'Çalıştır', onclick: async () => {
            this.select('console');
            setTimeout(async () => { for (const l of code.split('\n').filter(Boolean)) await this.run(l); }, 80);
          } })),
        h('pre.st-code', { text: code })));
    });
  }
}

const shortArgs = a => (a || []).map(x => {
  const s = typeof x === 'string' ? `"${x}"` : JSON.stringify(x);
  return s && s.length > 28 ? s.slice(0, 26) + '…' : s;
}).join(', ');

function pretty(v) {
  if (v === undefined) return 'undefined';
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}
