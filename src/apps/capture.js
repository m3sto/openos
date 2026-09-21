/* ==========================================================================
   OpenOS · apps/capture.js — Kamera ve Ses Kaydedici
   İkisi de gerçek donanımı kullanır (getUserMedia / MediaRecorder) ve
   ürettiklerini sanal dosya sistemine yazar. İzin verilmezse ne olduğu
   açıkça söylenir; sahte bir önizleme gösterilmez.
   ========================================================================== */

import { h, clear, on, fmtBytes, relTime } from '../core/util.js';
import { icon } from '../core/icons.js';
import { contextMenu } from '../ui/menu.js';
import vfs, { VFS } from '../core/vfs.js';
import notify from '../core/notify.js';

/* ====================================================================== */
export const camera = {
  id: 'camera', name: 'Kamera', glyph: 'camera', tint: ['#9aa0aa', '#3a3f47'],
  category: 'media', width: 760, height: 600, minWidth: 480, minHeight: 400,
  keywords: ['kamera', 'fotoğraf', 'webcam', 'selfie'],
  about: 'Kameradan fotoğraf çeker ve Resimler klasörüne kaydeder.',
  mount(ctx) { return new Camera(ctx).el; },
};

class Camera {
  constructor(ctx) {
    this.ctx = ctx;
    this.dir = VFS.join(vfs.home, 'Resimler');
    vfs.mkdir(this.dir);
    this.mirror = true;
    this.delay = 0;

    this.video = h('video', { autoplay: true, playsinline: true, muted: true,
      style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } });
    this.stage = h('div.cap-stage', this.video);
    this.strip = h('div.cap-strip');
    this.status = h('div.statusbar');

    this.shutter = h('button.cap-shutter', { title: 'Çek (Boşluk)', onclick: () => this.shoot() });
    const bar = h('div.cap-bar',
      h('button.k-btn.v-ghost.icon', { html: icon('refresh', 16), title: 'Kamera değiştir',
        onclick: () => this.cycleDevice() }),
      this.shutter,
      h('button.k-btn.v-ghost.icon', { html: icon('image', 16), title: 'Aynala',
        onclick: e => { this.mirror = !this.mirror; this.applyMirror();
          e.currentTarget.classList.toggle('v-tinted', this.mirror); } }),
      h('select.k-select', { style: { width: '92px' },
        onchange: e => { this.delay = +e.target.value; } },
        h('option', { value: '0', text: 'Gecikme yok' }),
        h('option', { value: '3', text: '3 sn' }),
        h('option', { value: '10', text: '10 sn' })));

    this.el = h('div.app-shell', h('div.content', this.stage, bar, this.strip, this.status));
    contextMenu(this.el, () => [
      { header: 'Kamera' },
      { label: 'Fotoğraf çek', glyph: 'camera', run: () => this.shoot() },
      { label: 'Aynala', glyph: 'image', checked: this.mirror,
        run: () => { this.mirror = !this.mirror; this.applyMirror(); } },
      '-',
      { label: 'Resimler klasörü', glyph: 'folder',
        run: () => this.ctx.openApp('finder', { path: this.dir }) },
    ]);

    this.onKey = e => {
      if (e.code === 'Space' && ctx.win.el.classList.contains('focused')
          && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) {
        e.preventDefault(); this.shoot();
      }
    };
    window.addEventListener('keydown', this.onKey);
    ctx.win.onClosed = () => this.destroy();

    this.applyMirror();
    this.start();
    this.renderStrip();
  }

  applyMirror() { this.video.style.transform = this.mirror ? 'scaleX(-1)' : ''; }

  async start(deviceId) {
    this.status.textContent = 'Kamera isteniyor…';
    try {
      this.stream?.getTracks().forEach(t => t.stop());
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }, audio: false,
      });
      this.video.srcObject = this.stream;
      const track = this.stream.getVideoTracks()[0];
      const st = track.getSettings();
      this.status.textContent = `${track.label || 'Kamera'} · ${st.width}×${st.height}`;
      this.devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    } catch (e) {
      clear(this.stage);
      this.stage.appendChild(h('div.cap-denied',
        h('div.g', { html: icon('camera', 34) }),
        h('div.k-text.t-title2', { text: 'Kameraya erişilemedi' }),
        h('div.k-text.t-callout', { style: { maxWidth: '360px' }, text: reason(e) }),
        h('button.k-btn.v-primary.s-sm', { text: 'Tekrar dene', onclick: () => {
          clear(this.stage); this.stage.appendChild(this.video); this.start(); } })));
      this.status.textContent = 'kamera yok';
      this.shutter.disabled = true;
    }
  }

  async cycleDevice() {
    if (!this.devices || this.devices.length < 2) { notify.toast('Başka kamera yok'); return; }
    const cur = this.stream?.getVideoTracks()[0]?.getSettings().deviceId;
    const i = this.devices.findIndex(d => d.deviceId === cur);
    this.start(this.devices[(i + 1) % this.devices.length].deviceId);
  }

  async shoot() {
    if (!this.stream) return;
    if (this.delay) {
      for (let n = this.delay; n > 0; n--) {
        this.status.textContent = `${n}…`;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    const v = this.video;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    const g = c.getContext('2d');
    if (this.mirror) { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(v, 0, 0);
    const data = c.toDataURL('image/png');

    const name = `Kamera ${new Date().toLocaleString('tr-TR').replace(/[/:]/g, '-')}.png`;
    const p = vfs.unique(VFS.join(this.dir, name));
    vfs.write(p, data);

    this.stage.classList.add('flash');
    setTimeout(() => this.stage.classList.remove('flash'), 180);
    this.status.textContent = `${VFS.basename(p)} · ${fmtBytes(data.length)}`;
    this.renderStrip();
    notify.post({ title: 'Fotoğraf kaydedildi', body: VFS.basename(p), glyph: 'camera',
      tint: ['#9aa0aa', '#3a3f47'], onClick: () => this.ctx.openPath(p) });
  }

  renderStrip() {
    clear(this.strip);
    let shots = [];
    try {
      shots = vfs.list(this.dir).filter(s => s.ext === 'png' && s.name.startsWith('Kamera'))
        .sort((a, b) => b.modified - a.modified).slice(0, 12);
    } catch {}
    if (!shots.length) {
      this.strip.appendChild(h('div.k-text.t-caption', { text: 'Henüz fotoğraf yok', style: { padding: '10px' } }));
      return;
    }
    shots.forEach(s => {
      const t = h('div.cap-thumb', { style: { backgroundImage: `url(${vfs.read(s.path)})` },
        title: s.name, onclick: () => this.ctx.openPath(s.path) });
      contextMenu(t, () => [
        { label: 'Aç', run: () => this.ctx.openPath(s.path) },
        { label: 'Çöp Kutusuna At', glyph: 'trash', danger: true,
          run: () => { this.ctx.os.trash(s.path); this.renderStrip(); } },
      ]);
      this.strip.appendChild(t);
    });
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    this.stream?.getTracks().forEach(t => t.stop());
  }
}

/* ====================================================================== */
export const recorder = {
  id: 'recorder', name: 'Ses Kaydedici', glyph: 'music', tint: ['#ff453a', '#7b0b27'],
  category: 'media', width: 640, height: 560, minWidth: 420, minHeight: 380,
  keywords: ['ses', 'kayıt', 'mikrofon', 'audio'],
  about: 'Mikrofondan kayıt alır, dalga biçimini gösterir ve dosyaya yazar.',
  mount(ctx) { return new Recorder(ctx).el; },
};

class Recorder {
  constructor(ctx) {
    this.ctx = ctx;
    this.dir = VFS.join(vfs.home, 'Müzik');
    vfs.mkdir(this.dir);
    this.recording = false;
    this.startedAt = 0;

    this.canvas = h('canvas.rec-wave');
    this.timeEl = h('div.clk-big', { text: '00:00' });
    this.btn = h('button.rec-btn', { title: 'Kaydet', onclick: () => this.toggle() });
    this.list = h('div.k-group');
    this.status = h('div.statusbar');

    this.el = h('div.app-shell', h('div.content',
      h('div.rec-stage', this.canvas, this.timeEl, this.btn),
      h('div', { style: { padding: '12px 16px', overflow: 'auto', flex: 1 } },
        h('div.k-sectitle', { text: 'Kayıtlar' }), this.list),
      this.status));

    contextMenu(this.el, () => [
      { header: 'Ses Kaydedici' },
      { label: this.recording ? 'Kaydı durdur' : 'Kaydet', glyph: this.recording ? 'stop' : 'music',
        run: () => this.toggle() },
      { label: 'Müzik klasörü', glyph: 'folder', run: () => this.ctx.openApp('finder', { path: this.dir }) },
    ]);

    ctx.win.onClosed = () => this.destroy();
    this.renderList();
    this.status.textContent = 'Kayıt için düğmeye basın';
  }

  async toggle() {
    if (this.recording) return this.stop();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      notify.alert(reason(e), { title: 'Mikrofona erişilemedi', glyph: '🎙️' });
      return;
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      .find(m => MediaRecorder.isTypeSupported(m)) || '';
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.rec.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.onstop = () => this.save(mime);
    this.rec.start();

    this.recording = true;
    this.startedAt = Date.now();
    this.btn.classList.add('on');
    this.status.textContent = 'Kaydediliyor…';
    this.startMeter();
    this.timer = setInterval(() => {
      const s = Math.floor((Date.now() - this.startedAt) / 1000);
      this.timeEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }, 250);
  }

  stop() {
    this.recording = false;
    this.btn.classList.remove('on');
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    try { this.rec?.stop(); } catch {}
    this.stream?.getTracks().forEach(t => t.stop());
  }

  async save(mime) {
    const blob = new Blob(this.chunks, { type: mime || 'audio/webm' });
    const data = await new Promise(res => {
      const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob);
    });
    const ext = (mime || '').includes('mp4') ? 'm4a' : 'webm';
    const name = `Kayıt ${new Date().toLocaleString('tr-TR').replace(/[/:]/g, '-')}.${ext}`;
    const p = vfs.unique(VFS.join(this.dir, name));
    vfs.write(p, data);
    this.status.textContent = `${VFS.basename(p)} · ${fmtBytes(data.length)}`;
    this.timeEl.textContent = '00:00';
    this.renderList();
    notify.post({ title: 'Kayıt tamamlandı', body: VFS.basename(p), glyph: 'music',
      tint: ['#ff453a', '#7b0b27'] });
  }

  /** Canlı dalga biçimi — kaydın gerçekten alındığını gösterir. */
  startMeter() {
    const actx = new (window.AudioContext || window.webkitAudioContext)();
    const src = actx.createMediaStreamSource(this.stream);
    const an = actx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    this.actx = actx;
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      const c = this.canvas;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const W = c.clientWidth || 500, H = c.clientHeight || 90;
      if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      an.getByteTimeDomainData(buf);
      g.beginPath();
      for (let i = 0; i < buf.length; i++) {
        const x = (i / buf.length) * W;
        const y = H / 2 + ((buf[i] - 128) / 128) * (H / 2 - 4);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '#ff453a';
      g.lineWidth = 2; g.stroke();
    };
    draw();
  }

  renderList() {
    clear(this.list);
    let files = [];
    try {
      files = vfs.list(this.dir).filter(s => ['webm', 'm4a', 'mp3', 'wav'].includes(s.ext))
        .sort((a, b) => b.modified - a.modified);
    } catch {}
    if (!files.length) {
      this.list.appendChild(h('div.k-row', h('div.k-text.t-caption', { text: 'Kayıt yok' })));
      return;
    }
    files.forEach(f => {
      const audio = h('audio', { controls: true, src: vfs.read(f.path),
        style: { height: '30px', maxWidth: '190px' } });
      const row = h('div.k-row',
        h('div.lead', { style: { background: 'var(--red)' }, html: icon('music', 15) }),
        h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '1px' } },
          h('div.k-text.ellipsis', { text: f.name, style: { fontWeight: 520 } }),
          h('div.k-text.t-caption', { text: `${fmtBytes(f.size)} · ${relTime(f.modified, 'tr')}` })),
        audio,
        h('button.k-btn.v-ghost.icon.s-sm', { html: icon('trash', 13),
          onclick: () => { this.ctx.os.trash(f.path); this.renderList(); } }));
      this.list.appendChild(row);
    });
  }

  destroy() {
    this.stop();
    try { this.actx?.close(); } catch {}
  }
}

/* ------------------------------------------------------------------ */
function reason(e) {
  const n = e?.name || '';
  if (n === 'NotAllowedError') return 'İzin reddedildi. Tarayıcının adres çubuğundaki kilit simgesinden bu siteye izin verin.';
  if (n === 'NotFoundError') return 'Bu cihazda uygun bir aygıt bulunamadı.';
  if (n === 'NotReadableError') return 'Aygıt başka bir uygulama tarafından kullanılıyor.';
  if (n === 'SecurityError') return 'Güvenli olmayan bağlantı. Kamera ve mikrofon yalnızca HTTPS ya da localhost üzerinde çalışır.';
  return e?.message || 'Bilinmeyen hata.';
}

export default [camera, recorder];
