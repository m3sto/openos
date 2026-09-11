/* ==========================================================================
   OpenOS · notify.js — banners, alerts, prompts, toasts
   ========================================================================== */

import { h, add, clear, Bus, uid, once } from './util.js';
import { icon } from './icons.js';

class Notifier {
  constructor() {
    this.bus = new Bus();
    this.layer = null;
    this.history = [];
    this.muted = false;
  }
  mount(layer) { this.layer = layer; }

  /** notify({title, body, app, glyph, tint, timeout, onClick, actions:[{label,run}]}) */
  post(opts = {}) {
    const n = {
      id: uid('ntf'), time: Date.now(), title: 'OpenOS', body: '', app: 'system',
      glyph: 'bell', tint: ['#8e8e93', '#5a5a60'], timeout: 5200, seen: false, ...opts,
    };
    this.history.unshift(n);
    if (this.history.length > 120) this.history.pop();
    this.bus.emit('post', n);
    if (this.muted || !this.layer) return n.id;

    const glyphHtml = n.glyph && n.glyph.length <= 3 && !/^[a-z]+$/i.test(n.glyph)
      ? n.glyph : icon(n.glyph || 'bell', 16);
    const el = h('div.notif', { dataset: { id: n.id } },
      h('div.app-icon', { style: { '--ic1': n.tint[0], '--ic2': n.tint[1] }, html: glyphHtml }),
      h('div.bd',
        h('div.ti', { text: n.title }),
        n.body ? h('div.ms', { text: n.body }) : null,
        n.actions?.length
          ? h('div.row', { style: { gap: '6px', marginTop: '7px' } },
              ...n.actions.map(a => h('button.k-btn.s-sm', {
                text: a.label,
                onclick: e => { e.stopPropagation(); a.run?.(); this.dismiss(n.id); },
              })))
          : null),
      h('div.tm', { text: new Date(n.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }),
    );
    el.addEventListener('click', () => { n.onClick?.(); this.dismiss(n.id); });
    this.layer.prepend(el);
    while (this.layer.children.length > 5) this.layer.lastChild.remove();
    if (n.timeout > 0) setTimeout(() => this.dismiss(n.id), n.timeout);
    return n.id;
  }

  dismiss(id) {
    const el = this.layer?.querySelector(`.notif[data-id="${id}"]`);
    if (!el || el.classList.contains('out')) return;
    el.classList.add('out');
    once(el, 'animationend', () => el.remove());
  }
  clearAll() { if (this.layer) clear(this.layer); }
  markAllSeen() { this.history.forEach(n => { n.seen = true; }); this.bus.emit('seen'); }
  clearHistory() { this.history.length = 0; this.bus.emit('seen'); }

  /* ---------------- modal dialogs ---------------- */
  _modal(build, root) {
    return new Promise(resolve => {
      const host = root || document.getElementById('stage');
      const scrim = h('div.k-scrim');
      let done = false;
      const finish = v => { if (done) return; done = true; scrim.remove(); resolve(v); };
      const box = build(finish);
      scrim.appendChild(box);
      scrim.addEventListener('pointerdown', e => { if (e.target === scrim) finish(null); });
      const key = e => {
        if (e.key === 'Escape') { finish(null); window.removeEventListener('keydown', key, true); }
        if (e.key === 'Enter') { box.querySelector('.k-btn.v-primary')?.click(); }
      };
      window.addEventListener('keydown', key, true);
      host.appendChild(scrim);
      setTimeout(() => box.querySelector('input,button.v-primary')?.focus(), 40);
    });
  }

  alert(message, { title = 'OpenOS', glyph = '💬', ok = 'Tamam', root } = {}) {
    return this._modal(finish => h('div.k-alert',
      h('div.glyph', { text: glyph }),
      h('div.k-text.t-title2', { text: title }),
      message ? h('div.k-text.t-callout', { text: message, style: { marginTop: '5px' } }) : null,
      h('div.acts', h('button.k-btn.v-primary.s-lg', { text: ok, onclick: () => finish(true) })),
    ), root);
  }

  confirm(message, { title = 'Emin misiniz?', glyph = '⚠️', ok = 'Devam', cancel = 'Vazgeç', danger, root } = {}) {
    return this._modal(finish => h('div.k-alert',
      h('div.glyph', { text: glyph }),
      h('div.k-text.t-title2', { text: title }),
      message ? h('div.k-text.t-callout', { text: message, style: { marginTop: '5px' } }) : null,
      h('div.acts',
        h('button.k-btn.s-lg', { text: cancel, onclick: () => finish(false) }),
        h('button.k-btn.s-lg', { class: danger ? 'v-danger' : 'v-primary', text: ok, onclick: () => finish(true) })),
    ), root);
  }

  /**
   * Üç (ya da daha çok) seçenekli soru. `confirm` iki yola zorluyordu;
   * "kaydetmeden kapat" ile "hiç kapatma" farklı şeyler ve kullanıcının
   * ikisini de görebilmesi gerekiyor.
   * @param {string} message
   * @param {{title?:string, glyph?:string, root?:Element,
   *          buttons:{label:string, value:any, variant?:string}[]}} o
   */
  choose(message, { title = 'OpenOS', glyph = '❔', buttons = [], root } = {}) {
    return this._modal(finish => h('div.k-alert',
      h('div.glyph', { text: glyph }),
      h('div.k-text.t-title2', { text: title }),
      message ? h('div.k-text.t-callout', { text: message, style: { marginTop: '5px' } }) : null,
      h('div.acts', { style: { flexDirection: buttons.length > 2 ? 'column' : 'row' } },
        ...buttons.map(b => h('button.k-btn.s-lg', {
          class: b.variant ? 'v-' + b.variant : '', text: b.label, onclick: () => finish(b.value),
        }))),
    ), root);
  }

  prompt(message, { title = 'OpenOS', value = '', placeholder = '', ok = 'Tamam', cancel = 'Vazgeç', glyph = '✏️', root } = {}) {
    return this._modal(finish => {
      const input = h('input', { value, placeholder, onkeydown: e => { if (e.key === 'Enter') finish(input.value); } });
      return h('div.k-alert',
        h('div.glyph', { text: glyph }),
        h('div.k-text.t-title2', { text: title }),
        message ? h('div.k-text.t-callout', { text: message, style: { marginTop: '5px' } }) : null,
        h('div.k-field', { style: { marginTop: '12px' } }, input),
        h('div.acts',
          h('button.k-btn.s-lg', { text: cancel, onclick: () => finish(null) }),
          h('button.k-btn.v-primary.s-lg', { text: ok, onclick: () => finish(input.value) })),
      );
    }, root);
  }

  /** Small transient toast in the centre-bottom of the screen. */
  toast(text, { glyph = '', ms = 1600 } = {}) {
    const host = document.getElementById('stage');
    const el = h('div', {
      style: {
        position: 'absolute', left: '50%', bottom: 'calc(var(--dock-h) + 26px)',
        transform: 'translateX(-50%)', zIndex: 9600, padding: '9px 16px',
        borderRadius: '99px', background: 'var(--glass-strong)', boxShadow: 'var(--sh-3)',
        backdropFilter: 'blur(30px) saturate(180%)', fontSize: '12.5px',
        animation: 'os-pop-in .22s var(--spring-soft)', display: 'flex', gap: '7px', alignItems: 'center',
      },
    }, glyph ? h('span', { text: glyph }) : null, h('span', { text }));
    host.appendChild(el);
    setTimeout(() => { el.style.animation = 'os-fade-out .22s var(--ease) forwards'; setTimeout(() => el.remove(), 240); }, ms);
  }
}

export const notify = new Notifier();
export default notify;
