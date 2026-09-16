/* ==========================================================================
   OpenOS · core/vault.js — sanal diskin şifrelenmesi

   Ne yapar
   --------
   Sanal disk `localStorage`'a düz JSON olarak yazılıyordu: tarayıcının
   geliştirici araçlarını açan herkes bütün dosyaları okuyabiliyor, elle
   düzenleyebiliyordu. Artık disk AES-256-GCM ile şifrelenmiş olarak
   saklanıyor ve anahtar IndexedDB'de **dışa aktarılamaz** (non-extractable)
   bir `CryptoKey` olarak duruyor.

   Neyi gerçekten engeller
   -----------------------
   · Depolamayı doğrudan okumayı: localStorage'da yalnızca şifreli bir blob
     görünür, dosya adları ve içerikleri görünmez.
   · Elle kurcalamayı: GCM kimlik doğrulamalı bir moddur; tek bir baytı
     değiştirmek çözmeyi sessizce bozmaz, gürültüyle başarısız kılar.
   · Kopyalayıp başka yerde açmayı: anahtar dışa aktarılamaz ve kaynağa
     (origin) bağlıdır; blob'u başka bir tarayıcıya taşımak işe yaramaz.

   Neyi engellemez — açıkça söylemek gerekir
   -----------------------------------------
   Sayfanın kendi konsoluna erişen biri `vfs.read()` çağırabilir. Kod
   tarayıcıda çalıştığı sürece bunun önüne geçilemez; bunu vaat eden her
   tasarım yanlış olur. Buradaki koruma "sayfanın içinden" değil, "depolama
   katmanından" gelen erişime karşıdır.
   ========================================================================== */

const DB_ADI = 'openos.vault';
const DEPO = 'anahtarlar';
const ANAHTAR_ADI = 'disk';

/* ------------------------------------------------------------ IndexedDB */

/**
 * Veritabanını açar ve deponun gerçekten var olduğunu doğrular.
 *
 * `onupgradeneeded` yalnızca sürüm yükselirken çalışır. Aynı adlı bir
 * veritabanı başka bir kodla (eski bir sürüm, bir tanılama betiği, bir
 * uzantı) sürüm 1'de depo oluşturulmadan açılmışsa, bundan sonraki her
 * açılış "zaten var" der, yükseltme hiç tetiklenmez ve her işlem
 * "object store not found" ile düşer — kasa kalıcı olarak bozulur ve
 * sistem sessizce şifresiz yazmaya başlar.
 *
 * Bu yüzden açılıştan sonra depo *doğrulanır*; yoksa sürüm bir artırılıp
 * yeniden açılarak oluşturulur. Doğrulama olmadan bu hata kendini ancak
 * "bu tarayıcıda WebCrypto yok" gibi yanlış bir teşhisle gösteriyordu.
 */
function db() {
  const ac = (surum) => new Promise((çöz, sapt) => {
    const istek = surum ? indexedDB.open(DB_ADI, surum) : indexedDB.open(DB_ADI);
    istek.onupgradeneeded = () => {
      if (!istek.result.objectStoreNames.contains(DEPO)) istek.result.createObjectStore(DEPO);
    };
    istek.onsuccess = () => çöz(istek.result);
    istek.onerror = () => sapt(istek.error);
    istek.onblocked = () => sapt(new Error('Veritabanı başka bir sekmede kilitli'));
  });

  return ac().then(d => {
    if (d.objectStoreNames.contains(DEPO)) return d;
    /* Depo yok: sürümü bir artırıp yükseltmeyi zorla. */
    const yeniSurum = d.version + 1;
    d.close();
    return ac(yeniSurum);
  });
}

function islem(kip, isi) {
  return db().then(d => new Promise((çöz, sapt) => {
    const t = d.transaction(DEPO, kip);
    const istek = isi(t.objectStore(DEPO));
    istek.onsuccess = () => çöz(istek.result);
    istek.onerror = () => sapt(istek.error);
  }));
}

/* --------------------------------------------------------------- yardım */

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(s) {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

/* ----------------------------------------------------------------- kasa */

class Vault {
  constructor() {
    this.anahtar = null;
    this.hazirMi = false;
    this.sebep = null;          /* kullanılamıyorsa nedeni */
  }

  /**
   * Anahtarı açar; yoksa üretir. Dışa aktarılamaz olarak üretilir —
   * `extractable: false` bu sınıfın tek en önemli satırı: anahtar bir daha
   * hiçbir yolla dışarı çıkarılamaz, yalnızca bu kaynakta şifreleme ve
   * çözme için kullanılabilir.
   */
  async ac() {
    if (this.hazirMi) return true;
    if (!crypto?.subtle || !window.indexedDB) {
      this.sebep = 'Bu tarayıcıda WebCrypto ya da IndexedDB yok';
      return false;
    }
    try {
      let k = await islem('readonly', d => d.get(ANAHTAR_ADI));
      if (!k) {
        k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        await islem('readwrite', d => d.put(k, ANAHTAR_ADI));
      }
      this.anahtar = k;
      this.hazirMi = true;
      return true;
    } catch (e) {
      this.sebep = e.message;
      this.hazirMi = false;
      return false;
    }
  }

  /**
   * Kasa neden kullanılamıyor? Depolama katmanı sessizce düz metne
   * düştüğünde kullanıcıya doğru nedeni söyleyebilmek için — "bu tarayıcı
   * desteklemiyor" ile "veritabanı bozulmuş" farklı şeyler ve farklı
   * çözümleri var.
   */
  get durum() {
    if (this.hazirMi) return { ok: true, kod: 'hazir' };
    if (!crypto?.subtle) return { ok: false, kod: 'webcrypto-yok',
      ileti: 'Bu tarayıcı WebCrypto sunmuyor. Şifreleme kullanılamıyor.' };
    if (!window.indexedDB) return { ok: false, kod: 'idb-yok',
      ileti: 'Bu tarayıcı IndexedDB sunmuyor. Anahtar saklanamıyor.' };
    if (/object store|not found/i.test(this.sebep || '')) return { ok: false, kod: 'depo-bozuk',
      ileti: 'Anahtar veritabanı bozulmuş. Depolama → Güvenlik’ten onarabilirsiniz.' };
    return { ok: false, kod: 'bilinmeyen', ileti: this.sebep || 'Bilinmeyen bir sorun.' };
  }

  /**
   * Bozulmuş anahtar veritabanını onarır: veritabanını tamamen siler ve
   * yeniden kurar. Eski anahtar gittiği için o anahtarla şifrelenmiş veri
   * artık okunamaz — bu yüzden çağıran önce diski düz metin olarak
   * okuyabildiğinden emin olmalı.
   */
  async onar() {
    this.anahtar = null;
    this.hazirMi = false;
    this.sebep = null;
    await new Promise(çöz => {
      const istek = indexedDB.deleteDatabase(DB_ADI);
      istek.onsuccess = istek.onerror = istek.onblocked = () => çöz();
    });
    return this.ac();
  }

  /** @returns {Promise<string>} saklanmaya hazır şifreli paket */
  async sifrele(metin) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.anahtar, enc.encode(metin));
    return JSON.stringify({ v: 1, alg: 'A256GCM', iv: b64(iv), ct: b64(ct) });
  }

  /**
   * Çözer. Paket kurcalanmışsa GCM doğrulaması başarısız olur ve burada
   * hata fırlar — bozuk veriyi sessizce kabul etmektense gürültü çıkarmak
   * doğrusu; çağıran buna bakıp kullanıcıyı uyarabilir.
   */
  async coz(paket) {
    const p = JSON.parse(paket);
    if (p.v !== 1) throw new Error('Bilinmeyen kasa sürümü: ' + p.v);
    const düz = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(p.iv) }, this.anahtar, unb64(p.ct));
    return dec.decode(düz);
  }

  /** Bir dize şifreli paket mi, yoksa eski düz JSON mu? */
  static paketMi(s) {
    if (typeof s !== 'string' || s[0] !== '{') return false;
    try { const p = JSON.parse(s); return p && p.v === 1 && typeof p.ct === 'string' && typeof p.iv === 'string'; }
    catch { return false; }
  }

  /** Anahtarı siler — fabrika ayarlarına dönüşte disk okunamaz hâle gelir. */
  async unut() {
    try { await islem('readwrite', d => d.delete(ANAHTAR_ADI)); } catch {}
    this.anahtar = null;
    this.hazirMi = false;
  }
}

const vault = new Vault();
export { Vault };
export default vault;
