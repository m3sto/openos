/* ==========================================================================
   OpenOS · services/alarms.js — alarm ve geri sayım servisi

   Saat uygulamasının penceresi kapalıyken de alarmların çalması gerekiyor.
   Uygulama artık yalnızca listeyi *gösteriyor*; saate bakıp bildirimi
   düşüren yer burası.

   Servis diskten okuyor, uygulama diske yazıyor. Aralarında paylaşılan bir
   nesne yok — uygulama kapalıyken de doğru veriyi görmenin tek yolu bu, ve
   kullanıcı alarmı silip uygulamayı kapattığında servis silinmiş alarmı
   çalmaz.
   ========================================================================== */

import vfs, { VFS } from '../core/vfs.js';
import notify from '../core/notify.js';
import services from '../core/services.js';
import sesler from '../core/sounds.js';

const DEPO = () => VFS.join(vfs.home, 'Belgeler/saat.json');

function oku() {
  try { return vfs.readJSON(DEPO(), null) || {}; } catch { return {}; }
}
function yaz(veri) {
  try { vfs.writeJSON(DEPO(), veri); } catch (e) { console.warn('[alarm] yazılamadı', e); }
}

/**
 * Saate bakar, vakti gelen alarmları çalar.
 *
 * "Kaç kez çalıştım" değil "saat kaç" sorusuna göre karar veriyor: gizli
 * sekmede zamanlayıcılar kısılıyor ve sayıya güvenen bir servis alarmı
 * kaçırırdı. `calindi` damgası gün bazında tutuluyor, böylece aynı alarm
 * aynı gün iki kez çalmıyor ama ertesi gün yeniden çalıyor.
 */
function alarmlariDenetle() {
  const veri = oku();
  const alarmlar = veri.alarms;
  if (!Array.isArray(alarmlar) || !alarmlar.length) return;

  const simdi = new Date();
  const ss = String(simdi.getHours()).padStart(2, '0');
  const dd = String(simdi.getMinutes()).padStart(2, '0');
  const saat = `${ss}:${dd}`;
  const bugun = simdi.toDateString();

  let degisti = false;
  for (const a of alarmlar) {
    if (!a.on || a.firedOn === bugun) continue;

    /* Kaçırılmış alarmı da yakala: sistem kapalıyken ya da sekme uykudayken
       tam dakika atlanmış olabilir. Aynı gün içinde, alarm saatinden sonraki
       ilk beş dakika hâlâ geçerli sayılır — ondan eskisi sessizce geçilir,
       çünkü kullanıcıyı sabah kurduğu alarmla akşam uyandırmak saçma olur. */
    const [as, ad2] = String(a.at || '').split(':').map(Number);
    if (!isFinite(as) || !isFinite(ad2)) continue;
    const alarmDk = as * 60 + ad2;
    const simdiDk = simdi.getHours() * 60 + simdi.getMinutes();
    const gecikme = simdiDk - alarmDk;
    if (a.at !== saat && !(gecikme > 0 && gecikme <= 5)) continue;

    a.firedOn = bugun;
    degisti = true;
    notify.post({
      title: a.label || 'Alarm',
      body: gecikme > 0 ? `${a.at} · ${gecikme} dk önce` : a.at,
      glyph: 'bell',
      tint: ['#ff9f0a', '#c96f00'],
      timeout: 0,                       /* kullanıcı kapatana kadar dursun */
      actions: [{ label: 'Saat’i aç', run: () => window.__openos?.kernel?.openApp('clock') }],
    });
    sesler.cal('alarm');
  }
  if (degisti) { veri.alarms = alarmlar; yaz(veri); }
}

/** Çekirdek açılışta çağırır. */
export function alarmServisiniKur() {
  services.register('alarm', {
    ad: 'Alarm ve geri sayım',
    uygulama: 'clock',
    her: 20000,        /* dakikalık bir alarm için fazlasıyla sık; kısılmaya dayanıklı */
    calistir: alarmlariDenetle,
  });
}

export default alarmServisiniKur;
