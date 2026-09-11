/* ==========================================================================
   OpenOS · boot/setup.js — the first-run assistant
   ========================================================================== */

import { h, clear, add, sleep, on } from '../core/util.js';
import { icon } from '../core/icons.js';
import settings, { ACCENTS } from '../core/settings.js';
import cloud from '../core/cloud.js';
import { WALLPAPERS, thumb } from '../wallpapers/generator.js';

const AVATARS = ['🧑‍🚀', '🦊', '🐼', '🦉', '🐙', '🌵', '🍄', '🎧', '🛸', '🪐', '🧊', '🔮'];

const LANGS = [
  { id: 'tr', name: 'Türkçe', sub: 'Turkish', g: '🇹🇷' },
  { id: 'en', name: 'English', sub: 'İngilizce', g: '🇬🇧' },
  { id: 'de', name: 'Deutsch', sub: 'Almanca', g: '🇩🇪' },
  { id: 'fr', name: 'Français', sub: 'Fransızca', g: '🇫🇷' },
];
const REGIONS = [
  { id: 'TR', name: 'Türkiye', sub: 'GMT+3 · TRY', g: '🇹🇷' },
  { id: 'US', name: 'United States', sub: 'GMT-5 · USD', g: '🇺🇸' },
  { id: 'DE', name: 'Deutschland', sub: 'GMT+1 · EUR', g: '🇩🇪' },
  { id: 'JP', name: '日本', sub: 'GMT+9 · JPY', g: '🇯🇵' },
];

/** Runs the wizard; resolves with the collected configuration. */
export function runSetup(stage) {
  return new Promise(resolve => new Wizard(stage, resolve).start());
}

class Wizard {
  constructor(stage, done) {
    this.stage = stage;
    this.done = done;
    this.i = 0;
    this.back = false;
    this.cfg = {
      locale: 'tr', region: 'TR', theme: 'auto', accent: ACCENTS[0].hex,
      wallpaper: 'aurora', name: '', avatar: '🧑‍🚀', password: '',
      agent: true, analytics: false, h12: false,
    };
    this.pages = [
      p => this.pWelcome(p), p => this.pLang(p), p => this.pRegion(p),
      p => this.pAppearance(p), p => this.pAccent(p), p => this.pWallpaper(p),
      p => this.pAccount(p), p => this.pCloud(p), p => this.pAgent(p), p => this.pPrivacy(p),
      p => this.pInstall(p), p => this.pDone(p),
    ];
  }

  start() {
    settings.set('theme', this.cfg.theme);
    settings.set('accent', this.cfg.accent);
    this.root = h('div.setup');
    this.top = h('div.setup-top');
    this.steps = h('div.setup-steps');
    this.body = h('div.setup-body');
    this.foot = h('div.setup-foot');
    this.top.append(
      h('div.k-text.t-caption', { text: 'OpenOS Kurulum Asistanı' }),
      this.steps,
      h('div', { style: { width: '130px' } }),
    );
    this.root.append(this.top, this.body, this.foot);
    this.stage.appendChild(this.root);
    this.renderStep();
  }

  go(delta) { this.back = delta < 0; this.i = Math.max(0, Math.min(this.pages.length - 1, this.i + delta)); this.renderStep(); }

  renderStep() {
    clear(this.steps);
    this.pages.forEach((_, k) =>
      this.steps.appendChild(h('i', { class: k === this.i ? 'on' : (k < this.i ? 'done' : '') })));

    clear(this.body); clear(this.foot);
    const pane = h('div.setup-pane', { class: this.back ? 'back' : '' });
    this.body.appendChild(pane);
    this.pages[this.i](pane);
  }

  /* ---------- pane scaffolding ---------- */
  head(pane, glyph, title, sub) {
    pane.append(...[
      h('div.setup-glyph', { html: glyph.length <= 3 && !/^[a-z]+$/i.test(glyph) ? glyph : icon(glyph, 34, 1.6) }),
      h('div.setup-h1', { text: title }),
      sub ? h('div.setup-sub', { text: sub }) : null,
    ].filter(Boolean));
    const content = h('div.setup-content');
    pane.appendChild(content);
    return content;
  }
  nav({ next = 'Devam', back = true, onNext, disabled } = {}) {
    if (back && this.i > 0)
      this.foot.appendChild(h('button.k-btn.s-lg', { text: 'Geri', onclick: () => this.go(-1) }));
    const b = h('button.k-btn.v-primary.s-lg', {
      text: next, disabled: !!disabled,
      onclick: () => { onNext?.(); this.go(1); },
    });
    this.foot.appendChild(b);
    return b;
  }

  /* ---------- pages ---------- */
  pWelcome(pane) {
    pane.append(
      h('div.boot-mark', { style: { width: '96px', height: '96px' }, html: `
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="none" stroke="var(--text)" stroke-width="6"/>
          <path d="M36 62 L64 38" stroke="var(--accent)" stroke-width="6" stroke-linecap="round"/>
        </svg>` }),
      h('div.welcome-word', { text: 'Merhaba' }),
      h('div.setup-sub', { text: 'OpenOS’a hoş geldiniz. Birkaç adımda sistemi size göre ayarlayalım — hem sizin hem de yapay zekâ ajanlarınız için.' }),
    );
    this.nav({ next: 'Başlayalım', back: false });
  }

  pLang(pane) {
    const c = this.head(pane, 'globe', 'Dil', 'Sistem arayüzünün dilini seçin.');
    const grid = h('div.choice-grid');
    const paint = () => [...grid.children].forEach(el =>
      el.setAttribute('aria-checked', String(el.dataset.id === this.cfg.locale)));
    LANGS.forEach(l => grid.appendChild(h('div.choice', {
      dataset: { id: l.id }, onclick: () => { this.cfg.locale = l.id; paint(); },
    }, h('div.g', { text: l.g }), h('div', h('div.tt', { text: l.name }), h('div.ss', { text: l.sub })))));
    c.appendChild(grid); paint();
    this.nav();
  }

  pRegion(pane) {
    const c = this.head(pane, 'compass', 'Bölge', 'Saat, tarih ve para birimi biçimleri için.');
    const grid = h('div.choice-grid');
    const paint = () => [...grid.children].forEach(el =>
      el.setAttribute('aria-checked', String(el.dataset.id === this.cfg.region)));
    REGIONS.forEach(r => grid.appendChild(h('div.choice', {
      dataset: { id: r.id }, onclick: () => { this.cfg.region = r.id; this.cfg.h12 = r.id === 'US'; paint(); },
    }, h('div.g', { text: r.g }), h('div', h('div.tt', { text: r.name }), h('div.ss', { text: r.sub })))));
    c.appendChild(grid); paint();
    this.nav();
  }

  pAppearance(pane) {
    const c = this.head(pane, 'moon', 'Görünüm', 'Açık, koyu ya da gün boyunca otomatik değişen.');
    const row = h('div.appearance-row');
    const shot = (dark) => h('div.shot',
      h('div.bar', { style: { background: dark ? '#26262b' : '#f2f2f5' } }),
      h('div.win', { style: {
        background: dark ? 'linear-gradient(160deg,#2c2c32,#202025)' : 'linear-gradient(160deg,#fff,#eceef2)',
      } }),
      h('div.dk', { style: { background: dark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.12)' } }),
    );
    const items = [
      ['light', 'Açık', () => h('div.shot', { style: { background: 'linear-gradient(160deg,#dfe6f5,#b9c8e8)' } },
        ...shot(false).children)],
      ['dark', 'Koyu', () => h('div.shot', { style: { background: 'linear-gradient(160deg,#1a1c26,#0b0c12)' } },
        ...shot(true).children)],
      ['auto', 'Otomatik', () => h('div.shot', { style: { background: 'linear-gradient(110deg,#dfe6f5 0 50%,#12141c 50% 100%)' } },
        ...shot(false).children)],
    ];
    const paint = () => [...row.children].forEach(el =>
      el.setAttribute('aria-checked', String(el.dataset.id === this.cfg.theme)));
    items.forEach(([id, label, build]) => row.appendChild(h('div.appearance', {
      dataset: { id },
      onclick: () => { this.cfg.theme = id; settings.set('theme', id); paint(); },
    }, build(), h('div.lab', { text: label }))));
    c.appendChild(row); paint();
    this.nav();
  }

  pAccent(pane) {
    const c = this.head(pane, 'paint', 'Vurgu Rengi', 'Düğmeler, seçimler ve sistem vurguları bu rengi kullanır.');
    const row = h('div.swatches');
    const paint = () => [...row.children].forEach(el =>
      el.setAttribute('aria-checked', String(el.dataset.hex === this.cfg.accent)));
    ACCENTS.forEach(a => row.appendChild(h('div.swatch', {
      dataset: { hex: a.hex }, title: a.name, style: { background: a.hex },
      onclick: () => { this.cfg.accent = a.hex; settings.set('accent', a.hex); paint(); },
    })));
    c.append(row, h('div.k-hstack', { style: { justifyContent: 'center', gap: '9px', marginTop: '26px' } },
      h('button.k-btn.v-primary', { text: 'Örnek düğme' }),
      h('button.k-btn.v-tinted', { text: 'İkincil' }),
      h('div.k-toggle', { dataset: { on: '1' } }),
    ));
    paint();
    this.nav();
  }

  pWallpaper(pane) {
    const c = this.head(pane, 'wallpaper', 'Masaüstü', 'Duvar kâğıtları tamamen kod ile çizilir — her çözünürlükte keskin.');
    const grid = h('div.wall-grid');
    const paint = () => [...grid.children].forEach(el =>
      el.setAttribute('aria-checked', String(el.dataset.id === this.cfg.wallpaper)));
    WALLPAPERS.forEach(w => {
      const tile = h('div.wall-tile', {
        dataset: { id: w.id }, style: { backgroundImage: `url(${thumb(w.id, 240, 150)})` },
        onclick: () => { this.cfg.wallpaper = w.id; paint(); },
      }, h('div.nm', { text: w.name }));
      grid.appendChild(tile);
    });
    c.appendChild(grid); paint();
    this.nav();
  }

  pAccount(pane) {
    const c = this.head(pane, 'user', 'Hesap', 'Adınız kilit ekranında ve ana klasörünüzde kullanılır.');
    const name = h('input', { placeholder: 'Adınız', value: this.cfg.name, autofocus: true });
    const pass = h('input', { type: 'password', placeholder: 'İsteğe bağlı şifre' });
    const avatars = h('div.avatar-grid');
    const paint = () => [...avatars.children].forEach(el =>
      el.setAttribute('aria-checked', String(el.dataset.a === this.cfg.avatar)));
    AVATARS.forEach(a => avatars.appendChild(h('div.avatar-pick', {
      dataset: { a }, text: a, onclick: () => { this.cfg.avatar = a; paint(); },
    })));
    paint();
    c.append(
      h('div.k-vstack', { style: { gap: '12px', maxWidth: '380px', margin: '0 auto' } },
        h('div.k-field', name),
        h('div.k-field', pass),
        h('div.k-text.t-caption', { text: 'Şifre boş bırakılırsa kilit ekranı doğrudan açılır.', style: { textAlign: 'center' } }),
        avatars,
      ));
    const b = this.nav({ onNext: () => { this.cfg.name = name.value.trim() || 'Kullanıcı'; this.cfg.password = pass.value; } });
    const sync = () => { b.disabled = false; };
    on(name, 'input', sync);
    setTimeout(() => name.focus(), 60);
  }

  pCloud(pane) {
    const c = this.head(pane, 'cloud', 'OpenOS Cloud',
      'İsteğe bağlı. Hesabınızla uygulamalarınızı yayınlayabilir, indirdiklerinizi her cihazda bulabilir ve OpenOS kurulumlarınızı tek yerden görebilirsiniz. Şimdi atlayıp sonra da bağlanabilirsiniz.');

    let mode = 'login';
    const email = h('input', { type: 'email', placeholder: 'siz@example.com' });
    const pass = h('input', { type: 'password', placeholder: 'şifre' });
    const handle = h('input', { placeholder: 'kullanici_adi', maxlength: 24 });
    const handleWrap = h('div.k-field', handle);
    handleWrap.style.display = 'none';
    const msg = h('div.k-text.t-caption', { style: { minHeight: '18px', textAlign: 'center' } });

    const seg = h('div.k-seg', { style: { alignSelf: 'center' } });
    [['login', 'Giriş yap'], ['signup', 'Hesap oluştur']].forEach(([v, label]) => {
      const b = h('button', { text: label, 'aria-selected': String(v === mode) });
      on(b, 'click', () => {
        mode = v;
        seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', 'false'));
        b.setAttribute('aria-selected', 'true');
        handleWrap.style.display = v === 'signup' ? '' : 'none';
        connect.textContent = v === 'login' ? 'Bağlan' : 'Hesap oluştur ve bağlan';
        msg.textContent = '';
      });
      seg.appendChild(b);
    });

    const connect = h('button.k-btn.v-primary', { text: 'Bağlan' });
    on(connect, 'click', async () => {
      connect.disabled = true;
      msg.style.color = 'var(--text-3)';
      msg.textContent = 'Bağlanılıyor…';
      try {
        if (mode === 'login') await cloud.signIn({ email: email.value.trim(), password: pass.value });
        else await cloud.signUp({ email: email.value.trim(), password: pass.value,
          handle: handle.value.trim().toLowerCase() });
        msg.style.color = 'var(--green)';
        msg.textContent = `@${cloud.user.handle} olarak bağlandınız`;
        this.cfg.cloudHandle = cloud.user.handle;
        setTimeout(() => this.go(1), 700);
      } catch (e) {
        msg.style.color = 'var(--red)';
        msg.textContent = e.message;
      } finally { connect.disabled = false; }
    });

    c.append(h('div.k-vstack', { style: { gap: '10px', maxWidth: '380px', margin: '0 auto' } },
      seg,
      h('div.k-field', email),
      handleWrap,
      h('div.k-field', pass),
      h('div.k-hstack', { style: { justifyContent: 'center' } }, connect),
      msg,
      h('div.k-text.t-caption', { style: { textAlign: 'center' },
        text: 'Sunucu: ' + (settings.get('cloud.endpoint') || 'tanımlı değil') })));

    if (this.i > 0)
      this.foot.appendChild(h('button.k-btn.s-lg', { text: 'Geri', onclick: () => this.go(-1) }));
    this.foot.appendChild(h('button.k-btn.s-lg', { text: 'Şimdilik atla', onclick: () => this.go(1) }));
  }

  pAgent(pane) {
    const c = this.head(pane, 'robot', 'Yapay Zekâ Ajanları',
      'OpenOS, ajanların sistemi kullanabilmesi için makine dostu bir arayüz sunar: uygulamaları açabilir, dosya okuyup yazabilir, OpenSharp betikleri çalıştırabilir.');
    const state = { on: true };
    const sw = h('div.k-toggle', { dataset: { on: '1' } });
    const card = h('div.k-group', { style: { maxWidth: '430px', margin: '0 auto' } },
      h('div.k-row', h('div.lead', { style: { background: 'var(--indigo)' }, html: icon('robot', 15) }),
        h('div.k-vstack', { style: { flex: 1, gap: '1px' } },
          h('div.k-text', { text: 'Ajan arayüzünü etkinleştir', style: { fontWeight: 560 } }),
          h('div.k-text.t-caption', { text: 'window.OpenOS üzerinden erişilebilir' })), sw),
      h('div.k-row', h('div.lead', { style: { background: 'var(--green)' }, html: icon('terminal', 15) }),
        h('div.k-vstack', { style: { flex: 1, gap: '1px' } },
          h('div.k-text', { text: 'Ajan Merkezi uygulaması', style: { fontWeight: 560 } }),
          h('div.k-text.t-caption', { text: 'Tüm API çağrılarını canlı izleyin' })),
        h('span.k-badge.b-green', { text: 'DAHİL' })),
    );
    sw.addEventListener('click', () => {
      state.on = !state.on; sw.dataset.on = state.on ? '1' : '0'; this.cfg.agent = state.on;
    });
    c.appendChild(card);
    this.nav();
  }

  pPrivacy(pane) {
    const c = this.head(pane, 'shield', 'Gizlilik',
      'OpenOS tamamen tarayıcınızda çalışır. Hiçbir veri dışarı gönderilmez — dosyalarınız yerel depolamada kalır.');
    c.appendChild(h('div.k-group', { style: { maxWidth: '430px', margin: '0 auto' } },
      row('database', 'Veriler cihazınızda', 'localStorage · dışarı çıkmaz', 'var(--blue)'),
      row('lock', 'Sunucu yok', 'Tüm çalışma zamanı istemcide', 'var(--green)'),
      row('code', 'Açık kaynak ruhu', 'Her uygulama OpenSharp ile yazılabilir', 'var(--purple)'),
    ));
    function row(g, t, s, tint) {
      return h('div.k-row', h('div.lead', { style: { background: tint }, html: icon(g, 15) }),
        h('div.k-vstack', { style: { flex: 1, gap: '1px' } },
          h('div.k-text', { text: t, style: { fontWeight: 560 } }),
          h('div.k-text.t-caption', { text: s })));
    }
    this.nav({ next: 'Kurulumu tamamla' });
  }

  async pInstall(pane) {
    this.head(pane, 'package', 'Hazırlanıyor', '');
    clear(this.foot);
    const R = 28, C = 2 * Math.PI * R;
    const ring = h('div', { html: `<svg class="ring" viewBox="0 0 62 62" width="62" height="62">
      <circle class="bgc" cx="31" cy="31" r="${R}"/>
      <circle class="fgc" cx="31" cy="31" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C}"
        transform="rotate(-90 31 31)"/></svg>` });
    const task = h('div.setup-task', { text: 'Başlatılıyor…' });
    const box = h('div.setup-finish', ring, task);
    pane.appendChild(box);

    const steps = [
      'Kullanıcı profili oluşturuluyor', 'Ana klasörler hazırlanıyor',
      'Uygulamalar kaydediliyor', 'OpenSharp örnekleri yazılıyor',
      'Duvar kâğıdı işleniyor', 'Dock yapılandırılıyor',
      'Ajan arayüzü bağlanıyor', 'Son rötuşlar',
    ];
    const fg = ring.querySelector('.fgc');
    for (let i = 0; i < steps.length; i++) {
      task.textContent = steps[i] + '…';
      fg.setAttribute('stroke-dashoffset', String(C * (1 - (i + 1) / steps.length)));
      await (document.hidden ? Promise.resolve() : sleep(260 + Math.random() * 190));
    }
    task.textContent = 'Tamamlandı';
    await (document.hidden ? Promise.resolve() : sleep(320));
    this.go(1);
  }

  pDone(pane) {
    pane.append(
      h('div.setup-glyph', { html: icon('check', 36, 2.4) }),
      h('div.setup-h1', { text: `Hazırsınız, ${this.cfg.name || 'Kullanıcı'}` }),
      h('div.setup-sub', { text: 'Masaüstüne geçmek için başlayın. Spotlight için ⌘/Ctrl + Boşluk, Launchpad için F4.' }),
    );
    clear(this.foot);
    this.foot.appendChild(h('button.k-btn.v-primary.s-xl', {
      text: 'OpenOS’u Başlat',
      onclick: async () => {
        this.root.style.transition = 'opacity .5s var(--ease), transform .6s var(--ease)';
        this.root.style.opacity = '0';
        this.root.style.transform = 'scale(1.04)';
        await sleep(520);
        this.root.remove();
        this.done(this.cfg);
      },
    }));
  }
}
