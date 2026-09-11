/* ==========================================================================
   OpenOS · apps/settings-app.js — System Settings
   ========================================================================== */

import { h, clear, add, on, fmtBytes, clamp } from '../core/util.js';
import { icon } from '../core/icons.js';
import { contextMenu } from '../ui/menu.js';
import settings, { ACCENTS } from '../core/settings.js';
import vfs, { VFS } from '../core/vfs.js';
import registry from '../core/registry.js';
import notify from '../core/notify.js';
import cloud from '../core/cloud.js';
import { WALLPAPERS, thumb } from '../wallpapers/generator.js';

export default {
  id: 'settings', name: 'Sistem Ayarları', glyph: 'settings', tint: ['#9aa0aa', '#5b6069'],
  category: 'system', width: 820, height: 580, minWidth: 560, minHeight: 380,
  keywords: ['ayar', 'tercih', 'sistem', 'tema'],
  about: 'OpenOS’un tüm davranışını buradan yönetin.',
  mount(ctx) {
    const s = new SettingsApp(ctx);
    ctx.win.onArgs = a => { if (a?.pane) s.select(a.pane); };
    return s.el;
  },
};

const PANES = [
  ['general', 'Genel', 'settings', '#8e8e93'],
  ['appearance', 'Görünüm', 'paint', '#bf5af2'],
  ['wallpaper', 'Duvar Kâğıdı', 'wallpaper', '#0a84ff'],
  ['dock', 'Dock ve Menü', 'apps', '#30d158'],
  ['desktop', 'Masaüstü', 'grid', '#5e5ce6'],
  ['user', 'Kullanıcı', 'user', '#ff9f0a'],
  ['network', 'Ağ', 'wifi', '#64d2ff'],
  ['sound', 'Ses ve Ekran', 'volume', '#ff375f'],
  ['cloud', 'OpenOS Cloud', 'cloud', '#64d2ff'],
  ['agent', 'Ajan Arayüzü', 'robot', '#5ac8fa'],
  ['apps', 'Uygulamalar', 'package', '#ac8e68'],
  ['storage', 'Depolama', 'database', '#40c8e0'],
  ['about', 'Hakkında', 'info', '#7d7f88'],
];

class SettingsApp {
  constructor(ctx) {
    this.ctx = ctx;
    this.pane = ctx.args?.pane || 'general';
    this.sidebar = h('div.sidebar');
    this.content = h('div.content.k-scroll', { style: { padding: '20px 24px', gap: '20px' } });
    this.el = h('div.app-shell', this.sidebar, this.content);
    contextMenu(this.el, () => [
      { header: 'Sistem Ayarları' },
      ...PANES.slice(0, 6).map(([id, label, glyph]) => ({
        label, glyph, checked: this.pane === id, run: () => this.select(id),
      })),
      '-',
      { label: 'Fabrika ayarlarına dön', glyph: 'refresh', danger: true,
        run: () => this.ctx.os.factoryReset() },
    ]);
    this.renderSidebar();
    this.render();
    this.off = settings.bus.on('change', () => { if (['appearance', 'dock', 'general'].includes(this.pane)) this.render(); });
    ctx.win.onClosed = () => this.off?.();
  }

  renderSidebar() {
    clear(this.sidebar);
    this.sidebar.appendChild(h('div.sb-title', { text: 'Ayarlar' }));
    for (const [id, label, glyph, color] of PANES) {
      this.sidebar.appendChild(h('div.sb-item', {
        dataset: { id }, class: id === this.pane ? 'on' : '',
        onclick: () => this.select(id),
      }, h('span.ic', { html: icon(glyph, 14), style: { color } }), h('span', { text: label })));
    }
    this.sidebar.appendChild(h('div.k-spacer'));
    this.sidebar.appendChild(h('div.sb-item', {
      style: { color: 'var(--red)' },
      onclick: () => this.ctx.os.factoryReset(),
    }, h('span.ic', { html: icon('refresh', 14), style: { color: 'var(--red)' } }), h('span', { text: 'Sıfırla' })));
  }

  select(id) {
    this.pane = id;
    this.sidebar.querySelectorAll('.sb-item').forEach(i => i.classList.toggle('on', i.dataset.id === id));
    this.render();
  }

  render() {
    clear(this.content);
    const title = (PANES.find(p => p[0] === this.pane) || [])[1] || '';
    this.ctx.setTitle(title ? `${title} — Ayarlar` : 'Sistem Ayarları');
    this.content.appendChild(h('div.k-text.t-title', { text: title }));
    const fn = this['p_' + this.pane];
    if (fn) fn.call(this);
    this.content.scrollTop = 0;
  }

  /* ---------------- building blocks ---------------- */
  group(title, ...rows) {
    const g = h('div.k-group');
    add(g, rows.filter(Boolean));
    this.content.appendChild(h('div.k-vstack', { style: { gap: '6px' } },
      title ? h('div.k-sectitle', { text: title }) : null, g));
    return g;
  }
  row(glyph, tint, title, subtitle, control) {
    return h('div.k-row',
      glyph ? h('div.lead', { style: { background: tint }, html: icon(glyph, 15) }) : null,
      h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '1px' } },
        h('div.k-text', { text: title, style: { fontWeight: 520 } }),
        subtitle ? h('div.k-text.t-caption', { text: subtitle }) : null),
      control || null);
  }
  toggle(path, onChange) {
    const t = h('div.k-toggle', { dataset: { on: settings.get(path) ? '1' : '0' } });
    t.addEventListener('click', () => {
      const v = !settings.get(path);
      settings.set(path, v); t.dataset.on = v ? '1' : '0'; onChange?.(v);
    });
    return t;
  }
  slider(path, min, max, fmt) {
    const val = settings.get(path) ?? min;
    const fill = h('i.fill'), knob = h('i.knob');
    const lab = h('div.k-text.t-caption', { style: { width: '44px', textAlign: 'right' } });
    const s = h('div.k-slider', { style: { width: '150px', flex: '0 0 auto' } }, h('i.track'), fill, knob);
    const set = v => {
      const pct = ((v - min) / (max - min)) * 100;
      fill.style.width = knob.style.left = pct + '%';
      lab.textContent = fmt ? fmt(v) : Math.round(v);
    };
    set(val);
    const move = e => {
      const r = s.getBoundingClientRect();
      const v = clamp(min + ((e.clientX - r.left) / r.width) * (max - min), min, max);
      set(v);
      settings.set(path, (max - min) <= 5 ? Math.round(v * 10) / 10 : Math.round(v));
    };
    s.addEventListener('pointerdown', e => {
      move(e);
      const mv = ev => move(ev);
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    return h('div.k-hstack', { style: { gap: '8px' } }, s, lab);
  }
  seg(options, value, onPick) {
    const n = h('div.k-seg');
    options.forEach(([v, label]) => {
      const b = h('button', { text: label, 'aria-selected': String(v === value) });
      b.addEventListener('click', () => {
        n.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', 'false'));
        b.setAttribute('aria-selected', 'true'); onPick(v);
      });
      n.appendChild(b);
    });
    return n;
  }

  /* ---------------- panes ---------------- */
  p_general() {
    this.group('Dil ve Bölge',
      this.row('globe', 'var(--blue)', 'Dil', 'Arayüz dili',
        this.seg([['tr', 'TR'], ['en', 'EN']], settings.get('locale'), v => settings.set('locale', v))),
      this.row('clock', 'var(--orange)', 'Saat biçimi', '12 ya da 24 saat',
        this.seg([[false, '24s'], [true, '12s']], settings.get('h12'), v => settings.set('h12', v))),
    );
    this.group('Erişilebilirlik',
      this.row('bolt', 'var(--yellow)', 'Hareketi azalt', 'Animasyonları en aza indirir',
        this.toggle('system.reduceMotion')),
      this.row('volume', 'var(--pink)', 'Arayüz sesleri', 'Tıklama ve uyarı sesleri',
        this.toggle('system.sounds')),
      this.row('compass', 'var(--indigo)', 'OpenOS imleci', 'Sistemin kendi çizdiği imleç takımı',
        this.toggle('system.cursor')),
    );
    this.group('Oturum',
      this.row('lock', 'var(--gray)', 'Ekranı kilitle', 'Ctrl/⌘ + L',
        h('button.k-btn.s-sm', { text: 'Kilitle', onclick: () => this.ctx.os.lock() })),
      this.row('refresh', 'var(--indigo)', 'Yeniden başlat', 'Oturumu baştan yükle',
        h('button.k-btn.s-sm', { text: 'Yeniden başlat', onclick: () => this.ctx.os.restart() })),
    );
  }

  p_appearance() {
    const preview = h('div.set-theme-row');
    [['light', 'Açık'], ['dark', 'Koyu'], ['auto', 'Otomatik']].forEach(([v, label]) => {
      const card = h('div.set-theme', { 'aria-checked': String(settings.get('theme') === v),
        onclick: () => { settings.set('theme', v); this.render(); } },
        h('div.shot', { style: { background: v === 'dark' ? 'linear-gradient(150deg,#1c1c22,#0a0a0e)'
          : v === 'light' ? 'linear-gradient(150deg,#eef1f6,#cdd6e6)'
          : 'linear-gradient(110deg,#eef1f6 0 50%,#15151b 50%)' } },
          h('div.mini-win', { style: { background: v === 'dark' ? '#2a2a30' : '#fff' } })),
        h('div.k-text.t-callout', { text: label }));
      preview.appendChild(card);
    });
    this.content.appendChild(h('div.k-vstack', { style: { gap: '8px' } },
      h('div.k-sectitle', { text: 'Tema' }), preview));

    const sw = h('div.swatches', { style: { justifyContent: 'flex-start', padding: '10px 2px' } });
    ACCENTS.forEach(a => sw.appendChild(h('div.swatch', {
      style: { background: a.hex, width: '28px', height: '28px' }, title: a.name,
      'aria-checked': String(settings.get('accent') === a.hex),
      onclick: () => { settings.set('accent', a.hex); this.render(); },
    })));
    const custom = h('input', { type: 'color', value: settings.get('accent'),
      style: { width: '30px', height: '28px', border: 0, background: 'none', cursor: 'pointer' } });
    on(custom, 'input', () => settings.set('accent', custom.value));
    sw.appendChild(custom);
    this.content.appendChild(h('div.k-vstack', { style: { gap: '8px' } },
      h('div.k-sectitle', { text: 'Vurgu rengi' }), sw));

    this.group('Önizleme',
      h('div.k-row', h('div.k-hstack', { style: { gap: '8px', flexWrap: 'wrap' } },
        h('button.k-btn.v-primary', { text: 'Birincil' }),
        h('button.k-btn', { text: 'İkincil' }),
        h('button.k-btn.v-tinted', { text: 'Renkli' }),
        h('button.k-btn.v-danger', { text: 'Tehlike' }),
        h('div.k-toggle', { dataset: { on: '1' } }),
        h('span.k-badge', { text: 'Rozet' }))));
  }

  p_wallpaper() {
    const grid = h('div.wall-grid');
    WALLPAPERS.forEach(w => {
      const tile = h('div.wall-tile', {
        'aria-checked': String(settings.get('wallpaper') === w.id),
        style: { backgroundImage: `url(${thumb(w.id, 300, 188)})` },
        onclick: () => {
          settings.set('wallpaper', w.id);
          grid.querySelectorAll('.wall-tile').forEach(t => t.setAttribute('aria-checked', 'false'));
          tile.setAttribute('aria-checked', 'true');
        },
      }, h('div.nm', { text: w.name + (w.animated ? ' · canlı' : '') }));
      grid.appendChild(tile);
    });
    this.content.appendChild(grid);
    this.group('Seçenekler',
      this.row('bolt', 'var(--accent)', 'Canlı duvar kâğıdı', 'Desteklenen duvar kâğıtları yavaşça hareket eder',
        this.toggle('wallpaperMotion')),
      this.row('eye', 'var(--indigo)', 'Kilit ekranında da göster', 'Bulanıklaştırılmış olarak',
        h('span.k-badge.b-gray', { text: 'Her zaman' })),
    );
  }

  p_dock() {
    this.group('Dock',
      this.row('apps', 'var(--green)', 'Simge boyutu', null,
        this.slider('dock.size', 36, 74, v => Math.round(v) + 'px')),
      this.row('bolt', 'var(--yellow)', 'Büyütme', 'İmleç üzerindeyken simgeler büyür',
        this.toggle('dock.magnify')),
      this.row('eye', 'var(--blue)', 'Otomatik gizle', 'Dock kenara çekilir',
        this.toggle('dock.autohide')),
      this.row('layers', 'var(--purple)', 'Konum', null,
        this.seg([['bottom', 'Alt'], ['left', 'Sol'], ['right', 'Sağ']],
          settings.get('dock.position'), v => settings.set('dock.position', v))),
    );
    const pinned = settings.get('pinned') || [];
    this.group('Dock’taki uygulamalar',
      ...pinned.map(id => {
        const a = registry.get(id);
        if (!a) return null;
        return this.row(a.glyph, `linear-gradient(150deg, ${a.tint[0]}, ${a.tint[1]})`, a.name, id,
          h('button.k-btn.v-ghost.icon.s-sm', { html: icon('minus', 14), title: 'Kaldır',
            onclick: () => { settings.set('pinned', pinned.filter(p => p !== id)); this.render(); } }));
      }));
  }

  p_desktop() {
    this.group('Masaüstü',
      this.row('grid', 'var(--blue)', 'Simgeleri göster', 'Masaüstü klasörünün içeriği',
        this.toggle('desktop.showIcons')),
      this.row('layers', 'var(--purple)', 'Widget’lar', 'Sağ üstteki bilgi kartları',
        this.toggle('desktop.showWidgets')),
      this.row('folder', 'var(--orange)', 'Masaüstü klasörü', VFS.join(vfs.home, 'Masaüstü'),
        h('button.k-btn.s-sm', { text: 'Aç', onclick: () => this.ctx.openApp('finder', { path: VFS.join(vfs.home, 'Masaüstü') }) })),
      this.row('refresh', 'var(--gray)', 'Simge yerleşimini sıfırla', null,
        h('button.k-btn.s-sm', { text: 'Sıfırla', onclick: () => { settings.set('desktopIcons', {}); notify.toast('Düzenlendi'); } })),
    );
    this.group('Pencereler',
      this.row('window', 'var(--indigo)', 'Kenara yapıştırma', 'Pencereyi kenara sürükleyerek yerleştirin',
        h('span.k-badge.b-green', { text: 'Etkin' })),
      this.row('bolt', 'var(--pink)', 'Jöle modu', 'Pencereler sürüklenirken yumuşak bir gövde gibi esner',
        this.toggle('desktop.jelly', () => this.render())),
      settings.get('desktop.jelly')
        ? this.row('sparkles', 'var(--purple)', 'Jöle şiddeti', 'Deformasyonun büyüklüğü',
            this.slider('desktop.jellyStrength', 0.3, 2.5, v => v.toFixed(1) + '×'))
        : null,
      this.row('layers', 'var(--teal)', 'Tüm pencereleri döşe', null,
        h('button.k-btn.s-sm', { text: 'Döşe', onclick: () => this.ctx.os.wm.tile() })),
    );
  }

  p_user() {
    const u = settings.get('user');
    const name = h('input', { value: u.name });
    on(name, 'change', () => { settings.set('user.name', name.value || 'Kullanıcı'); });
    const pass = h('input', { type: 'password', value: u.password, placeholder: 'Şifre yok' });
    on(pass, 'change', () => settings.set('user.password', pass.value));

    const avatars = h('div.avatar-grid', { style: { justifyContent: 'flex-start', padding: '8px 0' } });
    ['🧑‍🚀', '🦊', '🐼', '🦉', '🐙', '🌵', '🍄', '🎧', '🛸', '🪐', '🧊', '🔮'].forEach(a =>
      avatars.appendChild(h('div.avatar-pick', { text: a, 'aria-checked': String(u.avatar === a),
        onclick: () => { settings.set('user.avatar', a); this.render(); } })));

    this.content.appendChild(h('div.k-hstack', { style: { gap: '14px', padding: '4px 0 10px' } },
      h('div.k-avatar', { text: u.avatar, style: { width: '62px', height: '62px', fontSize: '30px' } }),
      h('div.k-vstack', { style: { gap: '2px' } },
        h('div.k-text.t-title2', { text: u.name }),
        h('div.k-text.t-caption', { text: vfs.home }))));

    this.group('Hesap',
      this.row('user', 'var(--blue)', 'Ad', null, h('div.k-field', { style: { width: '180px' } }, name)),
      this.row('lock', 'var(--red)', 'Şifre', 'Kilit ekranı için', h('div.k-field', { style: { width: '180px' } }, pass)),
    );
    this.content.appendChild(h('div.k-vstack', { style: { gap: '6px' } },
      h('div.k-sectitle', { text: 'Avatar' }), avatars));
  }

  p_network() {
    this.group('Wi-Fi',
      this.row('wifi', 'var(--blue)', 'Wi-Fi', settings.get('network.ssid'), this.toggle('network.wifi')),
      this.row('bluetooth', 'var(--indigo)', 'Bluetooth', 'Sanal cihazlar', this.toggle('network.bluetooth')),
      this.row('send', 'var(--teal)', 'AirDrop', 'Yakındaki cihazlara gönder', this.toggle('network.airdrop')),
    );
    this.group('Bilgi',
      this.row('globe', 'var(--gray)', 'Durum', navigator.onLine ? 'Çevrimiçi' : 'Çevrimdışı',
        h('span.k-badge', { class: navigator.onLine ? 'b-green' : 'b-red', text: navigator.onLine ? 'BAĞLI' : 'KOPUK' })),
      this.row('shield', 'var(--green)', 'Veri konumu', 'Tüm veriler bu tarayıcıda kalır',
        h('span.k-badge.b-gray', { text: 'YEREL' })),
    );
  }

  p_sound() {
    this.group('Ses',
      this.row('volume', 'var(--pink)', 'Ana ses', null, this.slider('system.volume', 0, 100, v => Math.round(v) + '%')),
      this.row('bell', 'var(--orange)', 'Bildirim sesi', null, this.toggle('system.sounds')),
    );
    this.group('Ekran',
      this.row('brightness', 'var(--yellow)', 'Parlaklık', null, this.slider('system.brightness', 25, 100, v => Math.round(v) + '%')),
      this.row('moon', 'var(--indigo)', 'Rahatsız etmeyin', 'Bildirimleri sustur', this.toggle('focus.dnd')),
    );
  }

  p_cloud() {
    const st = cloud.status();
    const u = cloud.user;
    this.content.appendChild(h('div.k-hstack', { style: { gap: '14px', padding: '2px 0 8px' } },
      h('div.app-icon', { style: { '--ic1': '#64d2ff', '--ic2': '#0a84ff', width: '52px', height: '52px' },
        html: icon('cloud', 26) }),
      h('div.k-vstack', { style: { gap: '2px', flex: 1 } },
        h('div.k-text.t-title2', { text: u ? (u.display || u.handle) : 'OpenOS Cloud' }),
        h('div.k-text.t-callout', { text: u ? '@' + u.handle + ' olarak bağlısınız'
          : 'Hesap isteğe bağlı — App Store hesapsız da çalışır' })),
      h('span.k-badge', { class: st.signedIn ? 'b-green' : 'b-gray',
        text: st.signedIn ? 'BAĞLI' : 'BAĞLI DEĞİL' })));

    this.group('Hesap',
      this.row('user', 'var(--blue)', st.signedIn ? 'Hesabı yönet' : 'Giriş yap ya da kaydol',
        st.signedIn ? 'Profil, cihazlar, kütüphane' : 'Uygulama yayınlamak ve cihazları eşlemek için',
        h('button.k-btn.s-sm', { class: st.signedIn ? '' : 'v-primary',
          text: st.signedIn ? 'Aç' : 'Bağlan', onclick: () => this.ctx.openApp('cloud') })),
      st.signedIn ? this.row('cpu', 'var(--indigo)', 'Cihazlar', `${u.devices ?? '—'} etkin oturum`,
        h('button.k-btn.s-sm', { text: 'Göster', onclick: () => this.ctx.openApp('cloud', { pane: 'devices' }) })) : null,
      st.signedIn ? this.row('package', 'var(--green)', 'Kütüphane', `${u.installed ?? '—'} indirilen uygulama`,
        h('button.k-btn.s-sm', { text: 'Göster', onclick: () => this.ctx.openApp('cloud', { pane: 'library' }) })) : null,
      st.signedIn ? this.row('power', 'var(--red)', 'Çıkış yap', 'Bu cihazın oturumunu kapatır',
        h('button.k-btn.s-sm.v-danger', { text: 'Çıkış', onclick: () => { cloud.signOut(); this.render(); } })) : null,
    );

    this.group('Bağlantı',
      this.row('cloud', 'var(--teal)', 'Sunucu', settings.get('cloud.endpoint') || 'tanımlı değil',
        h('button.k-btn.s-sm', { text: 'Değiştir', onclick: () => this.ctx.openApp('cloud', { pane: 'server' }) })),
      this.row('globe', 'var(--purple)', 'Web panosu', 'm3sto.github.io/openos-cloud',
        h('button.k-btn.s-sm', { text: 'Aç',
          onclick: () => this.ctx.openApp('browser', { url: 'https://m3sto.github.io/openos-cloud/' }) })),
      this.row('shield', 'var(--gray)', 'Güvenlik belgesi', 'Şifreleme, oturumlar, gizlilik',
        h('button.k-btn.s-sm', { text: 'Oku',
          onclick: () => this.ctx.openApp('browser', { url: 'https://github.com/m3sto/openos-cloud/blob/main/SECURITY.md' }) })),
    );
  }

  p_agent() {
    this.content.appendChild(h('div.k-text.t-callout', {
      text: 'OpenOS, yapay zekâ ajanlarının sistemi kullanabilmesi için window.OpenOS altında belgelenmiş bir API sunar. Aşağıdaki izinler bu API için geçerlidir.',
      style: { maxWidth: '520px' } }));
    this.group('İzinler',
      this.row('robot', 'var(--indigo)', 'Ajan arayüzü', 'window.OpenOS etkin', this.toggle('agent.enabled')),
      this.row('folder', 'var(--blue)', 'Dosya erişimi', 'fs.read / fs.write', this.toggle('agent.allowFs')),
      this.row('apps', 'var(--green)', 'Uygulama kontrolü', 'openApp / closeApp', this.toggle('agent.allowApps')),
      this.row('code', 'var(--purple)', 'Betik çalıştırma', 'runScript(osh)', this.toggle('agent.allowScript')),
      this.row('list', 'var(--gray)', 'Çağrıları kaydet', 'Ajan Merkezi’nde görünür', this.toggle('agent.logCalls')),
    );
    this.group('Araçlar',
      this.row('sparkles', 'var(--accent)', 'Ajan Merkezi', 'Canlı API belgeleri ve çağrı günlüğü',
        h('button.k-btn.s-sm', { text: 'Aç', onclick: () => this.ctx.openApp('agenthub') })),
    );
  }

  p_apps() {
    const all = registry.all();
    const user = all.filter(a => a.kind === 'opensharp');
    const native = all.filter(a => a.kind !== 'opensharp');
    if (user.length) this.group('OpenSharp uygulamaları', ...user.map(a =>
      this.row(a.glyph, `linear-gradient(150deg, ${a.tint[0]}, ${a.tint[1]})`, a.name, a.source,
        h('div.k-hstack', { style: { gap: '6px' } },
          h('button.k-btn.s-sm', { text: 'Düzenle', onclick: () => this.ctx.openApp('studio', { path: a.source }) }),
          h('button.k-btn.s-sm.v-danger', { text: 'Kaldır', onclick: () => this.ctx.os.uninstallApp(a.id) })))));
    this.group('Sistem uygulamaları', ...native.map(a =>
      this.row(a.glyph, `linear-gradient(150deg, ${a.tint[0]}, ${a.tint[1]})`, a.name, a.id,
        h('button.k-btn.s-sm', { text: 'Aç', onclick: () => this.ctx.openApp(a.id) }))));
  }

  p_storage() {
    const u = vfs.usage();
    const cap = 5 * 1024 * 1024;
    const pct = Math.min(100, (u.bytes / cap) * 100);
    this.content.appendChild(h('div.k-card', { style: { display: 'grid', gap: '10px' } },
      h('div.k-hstack', { style: { gap: '10px' } },
        h('div', { html: icon('database', 24), style: { color: 'var(--accent)' } }),
        h('div.k-vstack', { style: { gap: '1px' } },
          h('div.k-text.t-headline', { text: `${fmtBytes(u.bytes)} kullanıldı` }),
          h('div.k-text.t-caption', { text: `${u.files} dosya · ${u.dirs} klasör · yaklaşık ${fmtBytes(cap)} kapasite` }))),
      h('div.k-progress', h('i', { style: { width: Math.max(2, pct) + '%' } }))));

    const top = [];
    vfs.walk('/', s => { if (s.type === 'file') top.push(s); });
    top.sort((a, b) => b.size - a.size);
    this.group('En büyük dosyalar', ...top.slice(0, 8).map(s =>
      this.row('file', 'var(--gray)', s.name, s.path,
        h('div.k-text.t-caption', { text: fmtBytes(s.size) }))));

    this.group('Bakım',
      this.row('trash', 'var(--orange)', 'Çöp kutusunu boşalt', VFS.join(vfs.home, '.Trash'),
        h('button.k-btn.s-sm', { text: 'Boşalt', onclick: async () => {
          const p = VFS.join(vfs.home, '.Trash');
          if (!(await notify.confirm('Çöp kutusundaki her şey kalıcı olarak silinecek.', { title: 'Çöp Kutusunu Boşalt', danger: true, ok: 'Sil' }))) return;
          try { vfs.list(p).forEach(s => vfs.remove(s.path)); } catch {}
          notify.toast('Çöp kutusu boşaltıldı'); this.render();
        } })),
      this.row('download', 'var(--blue)', 'Dosya sistemini dışa aktar', 'JSON olarak indir',
        h('button.k-btn.s-sm', { text: 'Dışa aktar', onclick: () => exportFs() })),
    );
  }

  p_about() {
    const rows = [
      ['Sürüm', `OpenOS ${this.ctx.version} “${this.ctx.codename}”`],
      ['Çekirdek', 'opensharp-runtime'],
      ['Dil', 'OpenSharp 1.0'],
      ['Tarayıcı', navigator.userAgent.split(') ').pop()],
      ['Ekran', `${screen.width} × ${screen.height} @ ${(devicePixelRatio || 1).toFixed(1)}x`],
      ['Çekirdek sayısı', String(navigator.hardwareConcurrency || '—')],
      ['Uygulamalar', String(registry.all().length)],
      ['Çalışma süresi', Math.floor((Date.now() - this.ctx.os.bootedAt) / 1000) + ' sn'],
    ];
    this.content.appendChild(h('div.k-vstack', { style: { alignItems: 'center', gap: '10px', padding: '14px 0 20px' } },
      h('div', { html: icon('logo', 64, 2.2), style: { color: 'var(--accent)' } }),
      h('div.k-text.t-largetitle', { text: 'OpenOS' }),
      h('div.k-text.t-callout', { text: `Sürüm ${this.ctx.version} “${this.ctx.codename}”` })));
    this.group('Sistem', ...rows.map(([k, v]) => this.row(null, null, k, null,
      h('div.k-text.t-secondary', { text: v }))));
    this.group('Tehlikeli bölge',
      this.row('refresh', 'var(--red)', 'Fabrika ayarlarına dön', 'Tüm dosyalar ve ayarlar silinir',
        h('button.k-btn.s-sm.v-danger', { text: 'Sıfırla', onclick: () => this.ctx.os.factoryReset() })));
  }
}

function exportFs() {
  const data = localStorage.getItem('openos.fs.v1') || '{}';
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'openos-filesystem.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  notify.toast('Dışa aktarıldı', { glyph: '📦' });
}
