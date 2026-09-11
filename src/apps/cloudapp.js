/* ==========================================================================
   OpenOS · apps/cloudapp.js — OpenOS Cloud
   Hesap, profil, bağlı cihazlar, kütüphane ve yayınlanan uygulamalar.
   Hesap isteğe bağlıdır: App Store hesapsız da çalışır.
   ========================================================================== */

import { h, clear, add, on, fmtBytes, relTime, debounce } from '../core/util.js';
import { icon, hasIcon } from '../core/icons.js';
import { contextMenu } from '../ui/menu.js';
import { appIcon } from '../ui/appicon.js';
import cloud from '../core/cloud.js';
import settings from '../core/settings.js';
import notify from '../core/notify.js';

export default {
  id: 'cloud', name: 'OpenOS Cloud', glyph: 'cloud', tint: ['#64d2ff', '#0a84ff'],
  category: 'system', width: 880, height: 620, minWidth: 520, minHeight: 400,
  keywords: ['bulut', 'hesap', 'cloud', 'giriş', 'profil', 'cihaz'],
  about: 'OpenOS hesabınız, cihazlarınız ve yayınladığınız uygulamalar.',
  mount(ctx) {
    const c = new CloudApp(ctx);
    ctx.win.onArgs = a => { if (a?.pane) c.select(a.pane); };
    return c.el;
  },
};

const AVATARS = ['🧑‍🚀', '🦊', '🐼', '🦉', '🐙', '🌵', '🍄', '🎧', '🛸', '🪐', '🧊', '🔮',
                 '🐝', '🦋', '🌊', '⚡️', '🎨', '🧩'];

const PANES = [
  ['overview', 'Genel Bakış', 'cloud', '#64d2ff'],
  ['profile', 'Profil', 'user', '#0a84ff'],
  ['devices', 'Cihazlar', 'cpu', '#5e5ce6'],
  ['library', 'Kütüphane', 'package', '#30d158'],
  ['published', 'Yayınladıklarım', 'upload', '#ff9f0a'],
  ['security', 'Güvenlik', 'shield', '#ff453a'],
];

class CloudApp {
  constructor(ctx) {
    this.ctx = ctx;
    this.pane = ctx.args?.pane || 'overview';
    this.sidebar = h('div.sidebar', { style: { width: '196px' } });
    this.body = h('div.content.k-scroll', { style: { padding: '20px 24px', gap: '16px' } });
    this.el = h('div.app-shell', this.sidebar, this.body);
    this.renderSidebar();
    this.render();
    this.off = cloud.bus.on('auth', () => { this.renderSidebar(); this.render(); });
    ctx.win.onClosed = () => this.off?.();
    if (cloud.signedIn) cloud.refresh().then(() => this.render());
  }

  renderSidebar() {
    clear(this.sidebar);
    const u = cloud.user;
    this.sidebar.appendChild(h('div.cl-me',
      this.avatar(u, 40),
      h('div.k-vstack', { style: { minWidth: 0, gap: '1px' } },
        h('div.k-text.ellipsis', { text: u ? (u.display || u.handle) : 'Oturum açılmadı',
          style: { fontWeight: 580, fontSize: '12.5px' } }),
        h('div.k-text.t-caption.ellipsis', { text: u ? '@' + u.handle : 'İsteğe bağlı' }))));
    for (const [id, label, glyph, color] of PANES) {
      this.sidebar.appendChild(h('div.sb-item', {
        dataset: { id }, class: id === this.pane ? 'on' : '', onclick: () => this.select(id),
      }, h('span.ic', { html: icon(glyph, 14), style: { color } }), h('span', { text: label })));
    }
    this.sidebar.appendChild(h('div.k-spacer'));
    if (cloud.signedIn) {
      this.sidebar.appendChild(h('div.sb-item', { style: { color: 'var(--red)' },
        onclick: () => { cloud.signOut(); notify.toast('Çıkış yapıldı', { glyph: '☁️' }); } },
        h('span.ic', { html: icon('power', 14), style: { color: 'var(--red)' } }),
        h('span', { text: 'Çıkış yap' })));
    }
  }

  select(id) {
    this.pane = id;
    this.sidebar.querySelectorAll('.sb-item').forEach(i => i.classList.toggle('on', i.dataset.id === id));
    this.render();
  }

  render() {
    clear(this.body);
    if (!cloud.signedIn && this.pane !== 'overview') return this.renderSignIn();
    const fn = this['p_' + this.pane];
    if (fn) fn.call(this);
    this.body.scrollTop = 0;
  }

  avatar(u, size = 40) {
    const box = h('div.k-avatar', { style: { width: size + 'px', height: size + 'px',
      fontSize: Math.round(size * 0.46) + 'px', overflow: 'hidden', flex: '0 0 auto' } });
    if (u?.hasAvatarImage) {
      const img = h('img', { src: cloud.avatarUrl(u.handle), alt: '',
        style: { width: '100%', height: '100%', objectFit: 'cover' } });
      on(img, 'error', () => { box.textContent = u.avatar || '🧑‍🚀'; });
      box.appendChild(img);
    } else box.textContent = u?.avatar || (u ? '🧑‍🚀' : '☁️');
    return box;
  }

  /* ---------------- sign in ---------------- */
  renderSignIn(intro) {
    clear(this.body);
    let mode = 'login';
    const email = h('input', { type: 'email', placeholder: 'siz@example.com' });
    const pass = h('input', { type: 'password', placeholder: '••••••••••' });
    const handle = h('input', { placeholder: 'kullanici_adi', maxlength: 24 });
    const handleRow = this.fieldRow('user', 'var(--purple)', 'Kullanıcı adı', '3–24 karakter · a-z 0-9 - _', handle);
    handleRow.style.display = 'none';
    const msg = h('div.k-text.t-caption', { style: { minHeight: '18px' } });
    const submit = h('button.k-btn.v-primary.s-lg', { text: 'Giriş yap' });
    const toggle = h('button.k-btn.v-plain.s-sm', { text: 'Hesabın yok mu? Kaydol' });

    on(toggle, 'click', () => {
      mode = mode === 'login' ? 'signup' : 'login';
      submit.textContent = mode === 'login' ? 'Giriş yap' : 'Hesap oluştur';
      toggle.textContent = mode === 'login' ? 'Hesabın yok mu? Kaydol' : 'Zaten hesabın var mı? Giriş yap';
      handleRow.style.display = mode === 'login' ? 'none' : '';
      msg.textContent = '';
    });

    const go = async () => {
      msg.style.color = 'var(--text-3)';
      msg.textContent = 'Bağlanılıyor…';
      submit.disabled = true;
      try {
        if (mode === 'login') await cloud.signIn({ email: email.value.trim(), password: pass.value });
        else await cloud.signUp({ email: email.value.trim(), password: pass.value,
          handle: handle.value.trim().toLowerCase() });
        notify.post({ title: 'OpenOS Cloud', body: `@${cloud.user.handle} olarak bağlandınız`,
          glyph: 'cloud', tint: ['#64d2ff', '#0a84ff'] });
        this.select('overview');
      } catch (e) {
        msg.style.color = 'var(--red)';
        msg.textContent = e.message;
      } finally { submit.disabled = false; }
    };
    on(submit, 'click', go);
    [email, pass, handle].forEach(i => on(i, 'keydown', e => { if (e.key === 'Enter') go(); }));

    this.body.append(
      h('div.cl-hero',
        h('div.cl-hero-mark', { html: icon('cloud', 34) }),
        h('div.k-text.t-largetitle', { text: 'OpenOS Cloud' }),
        h('div.k-text.t-callout', { style: { maxWidth: '460px', textAlign: 'center' },
          text: intro || 'Uygulamalarınızı yayınlayın, indirdiklerinizi her cihazda bulun, OpenOS kurulumlarınızı tek yerden görün. Hesap isteğe bağlıdır — App Store hesapsız da çalışır.' })),
      h('div.k-group', { style: { maxWidth: '460px', margin: '0 auto', width: '100%' } },
        this.fieldRow('mail', 'var(--blue)', 'E-posta', null, email),
        handleRow,
        this.fieldRow('lock', 'var(--red)', 'Şifre', 'En az 10 karakter, üç farklı sınıf', pass)),
      h('div.k-hstack', { style: { gap: '10px', justifyContent: 'center', marginTop: '4px' } },
        submit, toggle),
      h('div.k-hstack', { style: { justifyContent: 'center' } }, msg),
      h('div.k-hstack', { style: { justifyContent: 'center', gap: '8px', marginTop: '8px' } },
        h('button.k-btn.v-ghost.s-sm', { text: 'Panoyu aç',
          onclick: () => this.ctx.openApp('browser', { url: 'https://m3sto.github.io/openos-cloud/' }) })),
    );
  }

  fieldRow(glyph, tint, title, sub, field) {
    return h('div.k-row',
      h('div.lead', { style: { background: tint }, html: icon(glyph, 15) }),
      h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '1px' } },
        h('div.k-text', { text: title, style: { fontWeight: 520 } }),
        sub ? h('div.k-text.t-caption', { text: sub }) : null),
      h('div.k-field', { style: { width: '230px', flex: '0 0 auto' } }, field));
  }
  infoRow(glyph, tint, title, sub, trailing) {
    return h('div.k-row',
      h('div.lead', { style: { background: tint }, html: icon(glyph, 15) }),
      h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '1px' } },
        h('div.k-text', { text: title, style: { fontWeight: 520 } }),
        sub ? h('div.k-text.t-caption', { text: sub }) : null),
      trailing || null);
  }
  stat(n, label) {
    return h('div.k-card', { style: { display: 'grid', gap: '2px' } },
      h('div.k-text', { text: n == null ? '—' : String(n), style: { fontSize: '26px', fontWeight: 650 } }),
      h('div.k-text.t-caption', { text: label }));
  }

  /* ---------------- overview ---------------- */
  async p_overview() {
    if (!cloud.signedIn) return this.renderSignIn();
    const u = cloud.user;
    this.body.append(
      h('div.k-hstack', { style: { gap: '16px' } },
        this.avatar(u, 74),
        h('div.k-vstack', { style: { gap: '2px', flex: 1, minWidth: 0 } },
          h('div.k-text.t-title', { text: u.display || u.handle }),
          h('div.k-text.t-callout', { text: '@' + u.handle + (u.email ? ' · ' + u.email : '') }),
          u.bio ? h('div.k-text.t-caption', { text: u.bio }) : null),
        h('span.k-badge.b-green', { text: 'BAĞLI' })),
      h('div.k-grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' } },
        this.stat(u.published, 'yayınlanan'),
        this.stat(u.installed, 'kütüphanede'),
        this.stat(u.devices, 'etkin cihaz'),
        this.stat(null, 'ağ durumu')),
    );

    const netCard = this.body.lastChild.lastChild;
    cloud.stats().then(s => {
      clear(netCard);
      netCard.append(
        h('div.k-text', { text: String(s.apps), style: { fontSize: '26px', fontWeight: 650 } }),
        h('div.k-text.t-caption', { text: `mağazada uygulama · ${s.users} hesap` }));
    }).catch(() => {});

    this.body.append(
      h('div.k-sectitle', { text: 'Hızlı işlemler' }),
      h('div.k-group',
        this.infoRow('upload', 'var(--orange)', 'Uygulama yayınla', 'Studio → Yayınla ya da App Store',
          h('button.k-btn.s-sm', { text: 'App Store', onclick: () => this.ctx.openApp('appstore', { pane: 'publish' }) })),
        this.infoRow('cpu', 'var(--indigo)', 'Bu cihaz', cloud.deviceName(),
          h('button.k-btn.s-sm', { text: 'Cihazlar', onclick: () => this.select('devices') })),
        this.infoRow('globe', 'var(--blue)', 'Web panosu', 'm3sto.github.io/openos-cloud',
          h('button.k-btn.s-sm', { text: 'Aç',
            onclick: () => this.ctx.openApp('browser', { url: 'https://m3sto.github.io/openos-cloud/' }) }))),
    );
  }

  /* ---------------- profile ---------------- */
  p_profile() {
    const u = cloud.user;
    let emoji = u.avatar || '🧑‍🚀';
    const display = h('input', { value: u.display || '', maxlength: 48 });
    const bio = h('textarea', { rows: 3, maxlength: 280 });
    bio.value = u.bio || '';
    const preview = this.avatar(u, 74);

    const grid = h('div.avatar-grid', { style: { justifyContent: 'flex-start', padding: '8px 0' } },
      ...AVATARS.map(a => h('div.avatar-pick', { text: a, 'aria-checked': String(a === emoji),
        onclick: () => {
          emoji = a;
          grid.querySelectorAll('.avatar-pick').forEach(b =>
            b.setAttribute('aria-checked', String(b.textContent === a)));
          clear(preview).textContent = a;
        } })));

    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: { display: 'none' } });
    const drop = h('div.cl-drop', { text: 'Görsel yüklemek için tıklayın · PNG/JPEG/WebP · en fazla 96 KB',
      onclick: () => file.click() });
    on(drop, 'dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    on(drop, 'dragleave', () => drop.classList.remove('over'));
    on(drop, 'drop', e => { e.preventDefault(); drop.classList.remove('over');
      if (e.dataTransfer.files[0]) this.upload(e.dataTransfer.files[0], drop); });
    on(file, 'change', () => file.files[0] && this.upload(file.files[0], drop));

    const save = h('button.k-btn.v-primary', { text: 'Kaydet', onclick: async () => {
      save.disabled = true;
      try {
        await cloud.updateProfile({ display: display.value.trim(), bio: bio.value.trim(), avatar: emoji });
        notify.toast('Profil kaydedildi', { glyph: '☁️' });
        this.renderSidebar();
      } catch (e) { notify.alert(e.message, { title: 'Kaydedilemedi', glyph: '⚠️' }); }
      finally { save.disabled = false; }
    } });

    this.body.append(
      h('div.k-text.t-title', { text: 'Profil' }),
      h('div.k-hstack', { style: { gap: '16px', padding: '4px 0 10px' } },
        preview,
        h('div.k-vstack', { style: { gap: '2px' } },
          h('div.k-text.t-title2', { text: '@' + u.handle }),
          h('div.k-text.t-caption', { text: u.email || '' }))),
      h('div.k-group',
        this.fieldRow('user', 'var(--blue)', 'Görünen ad', null, display),
        h('div.k-row',
          h('div.lead', { style: { background: 'var(--purple)' }, html: icon('note', 15) }),
          h('div.k-vstack', { style: { flex: 1, gap: '1px' } },
            h('div.k-text', { text: 'Hakkında', style: { fontWeight: 520 } }),
            h('div.k-text.t-caption', { text: 'En fazla 280 karakter' })),
          h('div.k-field.area', { style: { width: '230px', flex: '0 0 auto' } }, bio))),
      h('div.k-sectitle', { text: 'Avatar' }),
      grid, drop, file,
      u.hasAvatarImage
        ? h('button.k-btn.s-sm', { text: 'Yüklenen görseli kaldır', onclick: async () => {
            try { await cloud.removeAvatar(); notify.toast('Kaldırıldı'); this.render(); this.renderSidebar(); }
            catch (e) { notify.alert(e.message, { title: 'Kaldırılamadı', glyph: '⚠️' }); } } })
        : null,
      h('div', { style: { marginTop: '10px' } }, save),
    );
  }

  async upload(f, drop) {
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return notify.toast('Yalnızca PNG, JPEG ya da WebP', { glyph: '⚠️' });
    if (f.size > 96 * 1024) return notify.toast('Görsel 96 KB’den küçük olmalı', { glyph: '⚠️' });
    const prev = drop.textContent;
    drop.textContent = 'Yükleniyor…';
    try {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f);
      });
      await cloud.uploadAvatar(dataUrl);
      notify.toast('Avatar güncellendi', { glyph: '🖼️' });
      this.render(); this.renderSidebar();
    } catch (e) {
      drop.textContent = prev;
      notify.alert(e.message, { title: 'Yüklenemedi', glyph: '⚠️' });
    }
  }

  /* ---------------- devices ---------------- */
  async p_devices() {
    this.body.append(h('div.k-text.t-title', { text: 'Cihazlar' }),
      h('div.k-text.t-callout', { style: { maxWidth: '560px' },
        text: 'Bu hesapla giriş yapılmış OpenOS kurulumları. Tanımadığınız bir cihaz görürseniz oturumunu kapatın ve şifrenizi değiştirin.' }));
    const box = h('div', h('div.k-text.t-caption', { text: 'Yükleniyor…' }));
    this.body.appendChild(box);
    let list = [];
    try { list = await cloud.devices(); }
    catch (e) { clear(box); box.appendChild(h('div.k-card', { style: { color: 'var(--red)' } },
      h('div.k-text', { text: '⚠︎ ' + e.message }))); return; }
    clear(box);
    if (!list.length) {
      box.appendChild(h('div.k-empty', h('div.glyph', { text: '💻' }),
        h('div.k-text.t-callout', { text: 'Cihaz yok' })));
      return;
    }
    const g = h('div.k-group');
    list.forEach(d => g.appendChild(h('div.k-row',
      h('span.cl-live', { class: d.active ? 'on' : '', title: d.active ? 'Etkin' : 'Beklemede' }),
      h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '1px' } },
        h('div.k-text', { text: d.name + (d.current ? '  (bu cihaz)' : ''), style: { fontWeight: 520 } }),
        h('div.k-text.t-caption', { text: `${d.platform} · giriş ${new Date(d.created).toLocaleDateString('tr')}` }),
        h('div.k-text.t-caption', { text: 'son görülme ' + relTime(d.lastSeen, 'tr') })),
      h('span.k-badge', { class: d.revoked ? 'b-gray' : d.active ? 'b-green' : 'b-gray',
        text: d.revoked ? 'KAPALI' : d.active ? 'ETKİN' : 'BEKLEMEDE' }),
      d.revoked ? null : h('button.k-btn.s-sm', { text: d.current ? 'Çıkış' : 'Kapat', onclick: async () => {
        try {
          await cloud.revokeDevice(d.id);
          if (d.current) { cloud.signOut(); return; }
          notify.toast('Cihaz çıkarıldı'); this.render();
        } catch (e) { notify.alert(e.message, { title: 'Kapatılamadı', glyph: '⚠️' }); }
      } }))));
    box.appendChild(g);
  }

  /* ---------------- library ---------------- */
  async p_library() {
    this.body.append(h('div.k-text.t-title', { text: 'Kütüphane' }),
      h('div.k-text.t-callout', { text: 'Bu hesapla indirdiğiniz uygulamalar. Her OpenOS cihazınızda aynı liste görünür.' }));
    const box = h('div', h('div.k-text.t-caption', { text: 'Yükleniyor…' }));
    this.body.appendChild(box);
    let apps = [];
    try { apps = await cloud.library(); }
    catch (e) { clear(box); box.appendChild(h('div.k-card', h('div.k-text', { text: '⚠︎ ' + e.message }))); return; }
    clear(box);
    if (!apps.length) {
      box.appendChild(h('div.k-empty', h('div.glyph', { text: '📦' }),
        h('div.k-text.t-callout', { text: 'Henüz uygulama indirmediniz' }),
        h('button.k-btn.v-primary.s-sm', { text: 'App Store’a git', onclick: () => this.ctx.openApp('appstore') })));
      return;
    }
    const g = h('div.k-group');
    apps.forEach(a => g.appendChild(h('div.k-row',
      appIcon({ id: a.id, glyph: a.icon, tint: a.tint }, 34),
      h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '1px' } },
        h('div.k-text', { text: a.name, style: { fontWeight: 520 } }),
        h('div.k-text.t-caption', { text: `@${a.author || '—'} · v${a.version}` })),
      h('button.k-btn.s-sm', { text: 'Kur', onclick: () => this.ctx.openApp('appstore') }))));
    box.appendChild(g);
  }

  /* ---------------- published ---------------- */
  async p_published() {
    this.body.append(h('div.k-text.t-title', { text: 'Yayınladıklarım' }));
    const box = h('div', h('div.k-text.t-caption', { text: 'Yükleniyor…' }));
    this.body.appendChild(box);
    let apps = [];
    try { apps = await cloud.myApps(); }
    catch (e) { clear(box); box.appendChild(h('div.k-card', h('div.k-text', { text: '⚠︎ ' + e.message }))); return; }
    clear(box);
    if (!apps.length) {
      box.appendChild(h('div.k-empty', h('div.glyph', { text: '🚀' }),
        h('div.k-text.t-callout', { text: 'Henüz yayınlanmış uygulamanız yok' }),
        h('button.k-btn.v-primary.s-sm', { text: 'Uygulama yayınla',
          onclick: () => this.ctx.openApp('appstore', { pane: 'publish' }) })));
      return;
    }
    const g = h('div.k-group');
    apps.forEach(a => g.appendChild(h('div.k-row',
      appIcon({ id: a.id, glyph: a.icon, tint: a.tint }, 34),
      h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '1px' } },
        h('div.k-text', { text: a.name, style: { fontWeight: 520 } }),
        h('div.k-text.t-caption', { text: `${a.id} · v${a.version} · ${fmtBytes(a.size || 0)} · ${a.downloads || 0} indirme` })),
      h('button.k-btn.s-sm.v-danger', { text: 'Kaldır', onclick: async () => {
        if (!(await notify.confirm(`${a.name} mağazadan kaldırılsın mı?`,
          { title: 'Yayından kaldır', danger: true, ok: 'Kaldır' }))) return;
        try { await cloud.unpublish(a.id, a.name); notify.toast('Kaldırıldı'); this.render(); }
        catch (e) { notify.alert(e.message, { title: 'Kaldırılamadı', glyph: '⚠️' }); }
      } }))));
    box.appendChild(g);
  }

  /* ---------------- security ---------------- */
  p_security() {
    const cur = h('input', { type: 'password' });
    const next = h('input', { type: 'password' });
    const msg = h('div.k-text.t-caption', { style: { minHeight: '18px' } });
    const btn = h('button.k-btn.v-primary', { text: 'Şifreyi değiştir', onclick: async () => {
      btn.disabled = true;
      msg.style.color = 'var(--text-3)'; msg.textContent = 'Gönderiliyor…';
      try {
        await cloud.changePassword(cur.value, next.value);
        msg.style.color = 'var(--green)';
        msg.textContent = 'Şifre değiştirildi. Diğer tüm cihazların oturumu kapatıldı.';
        cur.value = next.value = '';
      } catch (e) { msg.style.color = 'var(--red)'; msg.textContent = e.message; }
      finally { btn.disabled = false; }
    } });

    this.body.append(
      h('div.k-text.t-title', { text: 'Güvenlik' }),
      h('div.k-group',
        this.fieldRow('lock', 'var(--red)', 'Mevcut şifre', null, cur),
        this.fieldRow('lock', 'var(--orange)', 'Yeni şifre', 'En az 10 karakter, üç farklı sınıf', next)),
      h('div.k-hstack', { style: { gap: '10px' } }, btn, msg),
      h('div.k-sectitle', { text: 'Bu hesap nasıl korunuyor' }),
      h('div.k-card', h('div.k-text.t-callout', { style: { whiteSpace: 'pre-line', lineHeight: 1.7 }, text:
        '· Şifreler PBKDF2-SHA256 ile 310.000 tur türetilir; düz şifre hiçbir yerde saklanmaz.\n' +
        '· Oturum belirteçleri sunucuda yalnızca SHA-256 özeti olarak durur.\n' +
        '· IP adresleri ham değil, gizli bir biberle özetlenmiş olarak tutulur.\n' +
        '· Giriş, kayıt ve yayınlama uçları oran sınırlıdır.\n' +
        '· Şifre değişimi diğer tüm cihazların oturumunu kapatır.' })),
      h('button.k-btn.s-sm', { text: 'Güvenlik belgesini aç',
        onclick: () => this.ctx.openApp('browser', { url: 'https://github.com/m3sto/openos-cloud/blob/main/SECURITY.md' }) }),
    );
  }

}
