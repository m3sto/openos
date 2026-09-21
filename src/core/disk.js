/* ==========================================================================
   OpenOS · core/disk.js — gerçek disk

   Sanal disk artık tarayıcının deposunda değil, kullanıcının seçtiği bir
   **klasörde** duruyor. O klasörde tek bir dosya var: `openos.disk`, ve
   içeriği baştan sona şifreli.

   Neden böyle:
     · `localStorage` birkaç megabaytla sınırlı ve tarayıcı "site verilerini
       temizle" dediğinde haber vermeden siliniyor. Bir işletim sisteminin
       diski, tarayıcı ayarlarının altında yaşayamaz.
     · Klasördeki dosya taşınabilir: yedeklenir, USB'ye kopyalanır, başka
       bir makinede açılır. "Dışa aktar / içe aktar" diye ayrı bir tören
       gerekmiyor — dosyanın kendisi zaten disk.

   Dosya biçimi (kendini tanımlar, ayrı bir meta dosyası yok):

     0..7    "OPENOSD1"           sihirli imza
     8..11   uint32               sürüm ve bayraklar
     12..27  16 bayt              PBKDF2 tuzu
     28..39  12 bayt              AES-GCM başlatma vektörü
     40..    şifreli veri         AES-256-GCM

   Anahtar parolanızdan türetiliyor (PBKDF2-SHA256, 310 000 tur). Parola
   hiçbir yere yazılmıyor: klasörü kopyalayan biri parolayı bilmeden diski
   açamaz. "Bu cihazda hatırla" seçilirse türetilen anahtar, cihaza bağlı
   ve dışa aktarılamaz kasa anahtarıyla sarılıp IndexedDB'ye konuyor —
   klasör yine tek başına işe yaramaz, ama bu tarayıcıda parola sorulmaz.
   ========================================================================== */

import vault from './vault.js';

const IMZA = 'OPENOSD1';
const SURUM = 1;
const TUR = 310000;           /* PBKDF2 tur sayısı */
const DOSYA_ADI = 'openos.disk';
const IDB_AD = 'openos-makineler';
const IDB_DEPO = 'makineler';

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ------------------------------------------------------------------ IndexedDB
   Dizin tutamaçları (FileSystemDirectoryHandle) yapılandırılabilir kopyalama
   ile saklanabiliyor ama JSON'a çevrilemiyor — bu yüzden localStorage değil,
   IndexedDB. Makine listesi de tutamaçla birlikte burada duruyor. */
function idb() {
  return new Promise((coz, at) => {
    const istek = indexedDB.open(IDB_AD, 1);
    istek.onupgradeneeded = () => {
      const db = istek.result;
      if (!db.objectStoreNames.contains(IDB_DEPO)) db.createObjectStore(IDB_DEPO, { keyPath: 'id' });
    };
    istek.onsuccess = () => {
      const db = istek.result;
      /* Depo yoksa sürümü yükseltip oluştur: eksik bir depo, sessizce
         "makine yok" diye görünüp kullanıcının bütün kayıtlı diskini
         kaybettirir. */
      if (!db.objectStoreNames.contains(IDB_DEPO)) {
        const yeniSurum = db.version + 1;
        db.close();
        const y = indexedDB.open(IDB_AD, yeniSurum);
        y.onupgradeneeded = () => y.result.createObjectStore(IDB_DEPO, { keyPath: 'id' });
        y.onsuccess = () => coz(y.result);
        y.onerror = () => at(y.error);
        return;
      }
      coz(db);
    };
    istek.onerror = () => at(istek.error);
  });
}

async function idbIslem(kip, is) {
  const db = await idb();
  return new Promise((coz, at) => {
    const tx = db.transaction(IDB_DEPO, kip);
    const depo = tx.objectStore(IDB_DEPO);
    let sonuc;
    try { sonuc = is(depo); } catch (e) { at(e); return; }
    tx.oncomplete = () => coz(sonuc?.result !== undefined ? sonuc.result : sonuc);
    tx.onerror = () => at(tx.error);
  });
}

/* ------------------------------------------------------------------ şifreleme */

async function anahtarTuret(parola, tuz) {
  const ham = await crypto.subtle.importKey('raw', enc.encode(parola), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: tuz, iterations: TUR, hash: 'SHA-256' },
    ham,
    { name: 'AES-GCM', length: 256 },
    true,                                  /* sarılabilmesi için dışa aktarılabilir */
    ['encrypt', 'decrypt'],
  );
}

/** Şifreli disk görüntüsünü paketler. */
async function goruntuYaz(metin, anahtar, tuz) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const gizli = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, anahtar, enc.encode(metin)));

  const cikti = new Uint8Array(40 + gizli.length);
  cikti.set(enc.encode(IMZA), 0);
  new DataView(cikti.buffer).setUint32(8, SURUM, true);
  cikti.set(tuz, 12);
  cikti.set(iv, 28);
  cikti.set(gizli, 40);
  return cikti;
}

/** Şifreli disk görüntüsünü açar. @returns {{tuz:Uint8Array, iv:Uint8Array, gizli:Uint8Array}} */
function goruntuAyristir(bayt) {
  if (bayt.length < 41) throw new Error('Disk dosyası bozuk: çok kısa.');
  if (dec.decode(bayt.slice(0, 8)) !== IMZA) throw new Error('Bu bir OpenOS disk dosyası değil.');
  const surum = new DataView(bayt.buffer, bayt.byteOffset).getUint32(8, true);
  if (surum > SURUM) throw new Error(`Disk sürümü ${surum} bu OpenOS'tan yeni.`);
  return { tuz: bayt.slice(12, 28), iv: bayt.slice(28, 40), gizli: bayt.slice(40) };
}

/* ------------------------------------------------------------ klasör deposu */

/**
 * Bir klasöre yazan disk deposu. `vfs` bunun `oku`/`yaz` arayüzünü kullanır;
 * tarayıcı deposundan tek farkı verinin nereye gittiği.
 */
export class KlasorDepo {
  /**
   * @param {FileSystemDirectoryHandle} dizin
   * @param {CryptoKey} anahtar
   * @param {Uint8Array} tuz
   */
  constructor(dizin, anahtar, tuz, makine = null) {
    this.dizin = dizin;
    this.anahtar = anahtar;
    this.tuz = tuz;
    this.makine = makine;
    this.tur = 'klasor';
  }

  get ad() { return this.makine?.ad || this.dizin.name; }

  async oku() {
    let dosya;
    try {
      const tutamac = await this.dizin.getFileHandle(DOSYA_ADI);
      dosya = await tutamac.getFile();
    } catch { return null; }                 /* yeni disk: henüz yazılmamış */
    if (!dosya.size) return null;

    const bayt = new Uint8Array(await dosya.arrayBuffer());
    const { iv, gizli } = goruntuAyristir(bayt);
    const duz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.anahtar, gizli);
    return dec.decode(duz);
  }

  async yaz(metin) {
    const veri = await goruntuYaz(metin, this.anahtar, this.tuz);
    /* Doğrudan `openos.disk` üzerine yazmak, yazma yarıda kalırsa diski
       kullanılamaz bırakır. Önce geçici dosyaya, sonra yerine taşınır —
       böylece her an ya eski ya yeni sürüm bütün hâlde duruyor. */
    const gecici = await this.dizin.getFileHandle(DOSYA_ADI + '.yeni', { create: true });
    const akis = await gecici.createWritable();
    await akis.write(veri);
    await akis.close();

    const hedef = await this.dizin.getFileHandle(DOSYA_ADI, { create: true });
    const h = await hedef.createWritable();
    await h.write(await (await gecici.getFile()).arrayBuffer());
    await h.close();
    try { await this.dizin.removeEntry(DOSYA_ADI + '.yeni'); } catch {}

    if (this.makine) {
      this.makine.boyut = veri.length;
      this.makine.sonKullanim = Date.now();
      await makineler.kaydet(this.makine);
    }
    return veri.length;
  }

  /** Klasöre hâlâ yazma iznimiz var mı? */
  async izinVarMi() {
    if (!this.dizin.queryPermission) return true;
    return (await this.dizin.queryPermission({ mode: 'readwrite' })) === 'granted';
  }
}

/* ------------------------------------------------------------ makine kaydı */

class Makineler {
  /** Tarayıcı gerçek klasöre yazabiliyor mu? */
  get destekleniyorMu() {
    return typeof window.showDirectoryPicker === 'function';
  }

  /** Neden desteklenmiyor — kullanıcıya dürüst bir cevap verebilmek için. */
  get sebep() {
    if (this.destekleniyorMu) return null;
    if (!window.isSecureContext) return 'guvensiz-baglam';
    return 'tarayici-desteklemiyor';
  }

  async listele() {
    try {
      const hepsi = await idbIslem('readonly', d => d.getAll());
      return (hepsi || []).sort((a, b) => (b.sonKullanim || 0) - (a.sonKullanim || 0));
    } catch (e) { console.warn('[disk] makine listesi okunamadı', e); return []; }
  }

  async kaydet(m) { return idbIslem('readwrite', d => d.put(m)); }
  async unut(id)  { return idbIslem('readwrite', d => d.delete(id)); }

  /**
   * Yeni disk oluşturur: kullanıcıdan klasör ister, içine şifreli boş bir
   * disk görüntüsü yazar ve makineyi kaydeder.
   */
  async olustur({ ad, parola, hatirla = false }) {
    if (!this.destekleniyorMu) throw new Error('Bu tarayıcı klasöre yazmayı desteklemiyor.');
    if (!parola || parola.length < 4) throw new Error('Parola en az 4 karakter olmalı.');

    const dizin = await window.showDirectoryPicker({ mode: 'readwrite', id: 'openos-disk' });

    /* Klasörde zaten bir disk varsa üstüne yazmak, kullanıcının bütün
       verisini tek tıkla silmek olur. Önce sorulur. */
    try {
      await dizin.getFileHandle(DOSYA_ADI);
      throw new Error(`Bu klasörde zaten bir OpenOS diski var (${DOSYA_ADI}). Onu açın ya da başka bir klasör seçin.`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) {
        if (e.message?.includes('zaten bir OpenOS diski')) throw e;
      }
    }

    const tuz = crypto.getRandomValues(new Uint8Array(16));
    const anahtar = await anahtarTuret(parola, tuz);
    const makine = {
      id: crypto.randomUUID(),
      ad: ad || dizin.name || 'OpenOS',
      dizin,
      olusturma: Date.now(),
      sonKullanim: Date.now(),
      boyut: 0,
      hatirla: false,
    };
    const depo = new KlasorDepo(dizin, anahtar, tuz, makine);
    /* Boş bir yük yazılıyor — düğüm biçimi bilerek burada yok. Disk katmanı
       dosya sisteminin iç yapısını bilirse iki yerde iki gerçek olur ve
       biri değiştiğinde diğeri sessizce yanlış kalır; ilk denemede tam da
       bu oldu ve çekirdek açılışta çöktü. `vfs` boş yükü "veri yok" diye
       okuyup kendi boş kökünü kuruyor. Yine de şifreli yazılıyor: "varolan
       diski aç" yolunun parolayı doğrulayabilmesi için geçerli bir
       görüntüye ihtiyacı var. */
    await depo.yaz('');
    if (hatirla) await this.anahtariSakla(makine, anahtar);
    await this.kaydet(makine);
    return depo;
  }

  /** Varolan bir klasörü disk olarak bağlar. */
  async ac({ makine = null, parola = null } = {}) {
    let dizin = makine?.dizin;
    if (!dizin) {
      if (!this.destekleniyorMu) throw new Error('Bu tarayıcı klasör açmayı desteklemiyor.');
      dizin = await window.showDirectoryPicker({ mode: 'readwrite', id: 'openos-disk' });
    }
    if (!(await this.izinIste(dizin))) throw new Error('Klasöre erişim izni verilmedi.');

    let bayt;
    try {
      bayt = new Uint8Array(await (await (await dizin.getFileHandle(DOSYA_ADI)).getFile()).arrayBuffer());
    } catch {
      throw new Error(`Bu klasörde ${DOSYA_ADI} yok. Yeni disk oluşturmayı deneyin.`);
    }
    const { tuz, iv, gizli } = goruntuAyristir(bayt);

    let anahtar = null;
    if (makine?.hatirla) anahtar = await this.anahtariAc(makine);
    if (!anahtar) {
      if (!parola) { const e = new Error('Parola gerekli.'); e.kod = 'parola-gerekli'; throw e; }
      anahtar = await anahtarTuret(parola, tuz);
    }

    /* Parolayı doğrula: yanlışsa GCM doğrulaması patlar. Kullanıcıya
       "disk bozuk" demek yanlış olur — büyük ihtimalle parola yanlış. */
    try {
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, anahtar, gizli);
    } catch {
      const e = new Error('Parola yanlış ya da disk başka bir anahtarla şifrelenmiş.');
      e.kod = 'parola-yanlis';
      throw e;
    }

    const kayit = makine || {
      id: crypto.randomUUID(), ad: dizin.name || 'OpenOS', dizin,
      olusturma: Date.now(), sonKullanim: Date.now(), boyut: bayt.length, hatirla: false,
    };
    kayit.dizin = dizin;
    kayit.sonKullanim = Date.now();
    await this.kaydet(kayit);
    return new KlasorDepo(dizin, anahtar, tuz, kayit);
  }

  /**
   * Klasör izni sayfa yenilenince düşüyor ve geri almak kullanıcı hareketi
   * gerektiriyor — bu yüzden makine ekranındaki düğmeden çağrılıyor.
   */
  async izinIste(dizin) {
    if (!dizin.queryPermission) return true;
    if ((await dizin.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    return (await dizin.requestPermission({ mode: 'readwrite' })) === 'granted';
  }

  /* --- "bu cihazda hatırla": türetilen anahtarı cihaz anahtarıyla sar --- */

  async anahtariSakla(makine, anahtar) {
    if (!(await vault.ac())) return false;
    const ham = new Uint8Array(await crypto.subtle.exportKey('raw', anahtar));
    /* Kasa metin şifreliyor; ham anahtar base64'e çevrilip sarılıyor. */
    makine.sarili = await vault.sifrele(btoa(String.fromCharCode(...ham)));
    makine.hatirla = true;
    await this.kaydet(makine);
    return true;
  }

  async anahtariAc(makine) {
    if (!makine.sarili) return null;
    try {
      if (!(await vault.ac())) return null;
      const b64 = await vault.coz(makine.sarili);
      const ham = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return crypto.subtle.importKey('raw', ham, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    } catch (e) { console.warn('[disk] saklanan anahtar açılamadı', e); return null; }
  }

  async unutAnahtar(makine) {
    delete makine.sarili;
    makine.hatirla = false;
    await this.kaydet(makine);
  }
}

export const makineler = new Makineler();
export default makineler;
