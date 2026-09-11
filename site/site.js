/* OpenOS tanıtım sitesi — küçük davranışlar
   SPDX-License-Identifier: AGPL-3.0-or-later */

/* ---- tema ---- */
function applyTheme(mode) {
  const m = mode || localStorage.getItem('openos.site.theme') || 'auto';
  localStorage.setItem('openos.site.theme', m);
  const dark = m === 'dark' || (m === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
applyTheme();
document.getElementById('themeBtn')?.addEventListener('click', () => {
  const order = ['auto', 'light', 'dark'];
  const cur = localStorage.getItem('openos.site.theme') || 'auto';
  applyTheme(order[(order.indexOf(cur) + 1) % order.length]);
});

/* ---- canlı önizleme: istenene kadar OpenOS yüklenmez ---- */
const play = document.getElementById('playBtn');
play?.addEventListener('click', () => {
  const stage = document.getElementById('stage');
  const frame = document.createElement('iframe');
  frame.src = 'os/';
  frame.title = 'OpenOS canlı önizleme';
  frame.loading = 'eager';
  frame.allow = 'clipboard-write; fullscreen';
  stage.appendChild(frame);
  play.remove();
  stage.querySelector('.mock')?.remove();
});

/* ---- görünüme girince kartları canlandır ---- */
const io = new IntersectionObserver((entries) => {
  entries.forEach((e, i) => {
    if (!e.isIntersecting) return;
    e.target.style.animation = `rise .6s var(--spring) both ${(i % 6) * 60}ms`;
    io.unobserve(e.target);
  });
}, { threshold: .12 });
document.querySelectorAll('.card, .mini, .strip div, .code, .browser-mock, .cloudcard')
  .forEach(n => io.observe(n));
