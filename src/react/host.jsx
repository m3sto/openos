/* ==========================================================================
   OpenOS · react/host.jsx — React uygulamaları için köprü

   React sistemin *tamamını* devralmıyor ve bu bilinçli bir sınır:

     · Pencere yöneticisi imperatif kalıyor. Sürükleme sıcak yolu her
       `pointermove`'da doğrudan `transform` yazmak zorunda; araya bir
       uzlaştırıcı koymak, bu projede bir kez çözülmüş olan "pencere imlecin
       arkasından geliyor" hatasını geri getirir.
     · OpenSharp çalışma zamanı da öyle: kendi reaktif sistemi var
       (`state` → öğe ağacı → DOM). Altına React koymak iki uzlaştırıcıyı
       üst üste bindirmek olurdu.
     · React **uygulama arayüzüne** giriyor — sistemin asıl UI yazdığı yere.

   Bir uygulama React ile yazıldığında sözleşme değişmiyor: `mount(ctx)`
   yine bir DOM düğümü döndürüyor, pencere yöneticisi farkı bilmiyor.

   Kullanım:

     import { reactApp } from '../react/host.jsx';
     function Uygulamam() { … }
     export default { id: 'x', name: 'X', mount: reactApp(Uygulamam) };
   ========================================================================== */

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import settingsNesnesi from '../core/settings.js';
import vfsNesnesi, { VFS } from '../core/vfs.js';
import { contextMenu } from '../ui/menu.js';

/** Uygulama bağlamı — `mount(ctx)`'e verilen nesnenin aynısı. */
const OsContext = createContext(null);

/** Bir React bileşenini OpenOS uygulama `mount` işlevine çevirir. */
export function reactApp(Component, { sinif = 'app-shell' } = {}) {
  return function mount(ctx) {
    const kok = document.createElement('div');
    kok.className = sinif;

    const root = createRoot(kok);
    root.render(
      <OsContext.Provider value={ctx}>
        <Component ctx={ctx} />
      </OsContext.Provider>,
    );

    /* Pencere kapanınca React kökü sökülmeli: yoksa bileşenlerin
       `useEffect` temizlikleri hiç çalışmaz, abonelikler ve zamanlayıcılar
       pencere gittikten sonra da yaşamaya devam eder. `unmount` bir sonraki
       göreve erteleniyor çünkü React, render sırasında kökün sökülmesinden
       şikâyet ediyor. */
    const oncekiKapanis = ctx.win.onClosed;
    ctx.win.onClosed = (...a) => {
      try { oncekiKapanis?.(...a); } finally { queueMicrotask(() => root.unmount()); }
    };
    return kok;
  };
}

/** Uygulama bağlamı: `os`, `win`, `vfs`, `settings`, `notify`, `openApp`… */
export function useOs() {
  const ctx = useContext(OsContext);
  if (!ctx) throw new Error('useOs yalnızca reactApp() ile takılan bir ağaçta çalışır');
  return ctx;
}

/**
 * Bir sistem ayarına iki yönlü bağlanır. Ayar başka bir yerden değişirse
 * (Ayarlar uygulaması, terminal, ajan) bileşen kendiliğinden tazelenir —
 * bu yüzden değeri kopyalayıp bırakmak yerine olay yoluna abone oluyoruz.
 */
export function useSetting(yol) {
  const [deger, setDeger] = useState(() => settingsNesnesi.get(yol));
  useEffect(() => {
    const kapat = settingsNesnesi.bus.on(`change:${yol}`, v => setDeger(v));
    setDeger(settingsNesnesi.get(yol));       /* abone olana kadar değişmiş olabilir */
    return kapat;
  }, [yol]);
  const yaz = useCallback(v => settingsNesnesi.set(yol, v), [yol]);
  return [deger, yaz];
}

/**
 * Uygulamaya özel kalıcı durum. Sanal diskte `~/.appdata/<id>.json` altında
 * yaşar; `useState` gibi kullanılır ama yeniden açılışta yerinde durur.
 */
export function useStore(anahtar, varsayilan) {
  const { app } = useOs();
  const yol = VFS.join('/Users/shared/.appdata', `${app.id}.json`);
  const [deger, setDeger] = useState(() => {
    const hepsi = vfsNesnesi.readJSON(yol, null) || {};
    return anahtar in hepsi ? hepsi[anahtar] : varsayilan;
  });
  const yaz = useCallback(v => {
    setDeger(onceki => {
      const yeni = typeof v === 'function' ? v(onceki) : v;
      const hepsi = vfsNesnesi.readJSON(yol, null) || {};
      hepsi[anahtar] = yeni;
      try {
        vfsNesnesi.mkdir(VFS.dirname(yol));
        vfsNesnesi.writeJSON(yol, hepsi);
      } catch (e) { console.warn('[react] kalıcı durum yazılamadı', e); }
      return yeni;
    });
  }, [yol, anahtar]);
  return [deger, yaz];
}

/**
 * Sistemin bağlam menüsünü bir öğeye bağlar. `ogeler` her açılışta yeniden
 * sorulduğu için menü o anki duruma göre kuruluyor.
 */
export function useContextMenu(ogeler) {
  const ref = useRef(null);
  const sonOgeler = useRef(ogeler);
  sonOgeler.current = ogeler;
  useEffect(() => {
    if (!ref.current) return undefined;
    return contextMenu(ref.current, () => sonOgeler.current());
  }, []);
  return ref;
}

/** Klavye kısayolu — pencere odaktayken. */
export function useKey(handler, bagimliliklar = []) {
  const { win } = useOs();
  useEffect(() => {
    const f = e => { if (win.wm?.focused === win) handler(e); };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, bagimliliklar);
}

export { OsContext };
