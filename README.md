<div align="center">

# OpenOS

**Tarayıcıda çalışan, kendi programlama diline sahip sanal masaüstü işletim sistemi.**

Pencere yöneticisi · Dock · Launchpad · Spotlight · Mission Control · Kontrol Merkezi
Sanal dosya sistemi · 17 uygulama · **OpenSharp** dili · Yapay zekâ ajanları için API

</div>

---

## Çalıştırma

ES modülleri kullanıldığı için `file://` üzerinden değil, bir HTTP sunucusundan açılmalıdır:

```bash
./serve.sh
```

| Adres | Ne var |
| --- | --- |
| `http://localhost:8080/` | tanıtım sitesi (GitHub Pages'te de bu görünür) |
| `http://localhost:8080/os/` | **işletim sisteminin kendisi** |

Başka bir port için: `./serve.sh 3000`. Sunucu önbelleği kapatır, böylece kaynak
düzenlendiğinde basit bir yenileme yeni kodu yükler.

İlk açılışta Linux tarzı bir çekirdek günlüğü akar, sonra iOS tarzı kurulum
sihirbazı gelir (dil, bölge, görünüm, vurgu rengi, duvar kâğıdı, hesap, ajan izinleri).
Tüm durum tarayıcının `localStorage` alanında tutulur; sunucu tarafı yoktur.

---

## Neler var

### Kabuk
| Bileşen | Açıklama |
| --- | --- |
| **Pencere yöneticisi** | Sürükle, 8 yönden boyutlandır, kenara yapıştır (yarım/çeyrek ekran), büyüt, tam ekran, Dock'a küçült animasyonu, z-sıralaması, ⌘\` ile geçiş |
| **Jöle modu** | Pencereler sürüklenirken yumuşak bir gövde gibi davranır: hareketin tersine makaslanır, yönünde ezilip dikinde uzar, köşeleri şişer ve yaylanarak yerine oturur. Ayarlar → Masaüstü'nden açılıp kapanır, şiddeti ayarlanır |
| **Dock** | Gerçek büyütme efekti, çalışan uygulama noktaları, sıçrama animasyonu, sağ tık menüleri, konum/otomatik gizleme |
| **Menü çubuğu** | Sistem menüsü, uygulamaya özel menüler, Wi-Fi/pil/saat, Kontrol Merkezi |
| **Launchpad** `F4` | Bulanık arkaplanlı uygulama ızgarası, anlık arama |
| **Spotlight** `⌘/Ctrl+Space` | Uygulama, dosya, hesap makinesi ve komut araması |
| **Mission Control** `F3` | Tüm pencerelere kuşbakışı, tek tıkla döşeme |
| **Kontrol Merkezi** | Wi-Fi, Bluetooth, Odak, ajan API'si, parlaklık, ses |
| **Bildirimler** | Yığılan, aksiyon düğmeli bildirim başlıkları |
| **Widget'lar** | Saat, depolama, hızlı başlat, ipucu kartları |
| **Kilit ekranı** | Bulanık duvar kâğıdı, avatar, şifre |

### Uygulamalar
`Finder` · `Terminal` · `OpenSharp Studio` · `Sistem Ayarları` · `Metin Düzenleyici` ·
`Notlar` · `Hesap Makinesi` · **`OpenBrow`** (tarayıcı) · `Görseller` · `Takvim` ·
`App Store` · `Ajan Merkezi` · `Etkinlik İzleyici` · `Synth` · `Kılavuz` · `Hoş Geldiniz` · `Hakkında`

### OpenBrow — sistemin kendi tarayıcısı
Sekmeler, akıllı adres çubuğu ve öneriler, yer imleri, geçmiş, indirilenler, gizli
gezinti, sayfa içinde arama, yakınlaştırma, kenar çubuğu ve kendi bağlam menüleri.
İki çizim yolu var:

- **Dahili sayfalar** (`openos://start`, `/history`, `/bookmarks`, `/openbrow`, …)
  doğrudan OpenOS bileşenleriyle çizilir — iframe yok.
- **Web sayfaları** `cloud/openbrow-proxy.js` üzerinden alınır. Proxy sayfayı
  OpenOS kimliğiyle indirir, `X-Frame-Options` / CSP engellerini kaldırır ve sayfaya
  bir kimlik katmanı enjekte eder: `navigator.userAgent` → *OpenBrow/1.0*,
  `navigator.platform` → *OpenOS*, `window.OpenBrow` → sürüm bilgisi. Sayfa
  kendisini bir tarayıcının içindeki tarayıcıda değil, **OpenOS üzerinde çalışan
  OpenBrow'da** sanır. Bağlantı tıklamaları, form gönderimleri ve sağ tık sayfadan
  OpenBrow'un kendi arayüzüne geri iletilir.

Proxy tanımlı değilse doğrudan çerçeveleme yapılır ve engelleyen siteler açıkça bildirilir.

### OpenSharp Studio — IDE
Proje gezgini, anahat (app/state/fn/view simgeleri), çok sekmeli düzenleyici,
bağlama duyarlı **tamamlama** (bileşenler, stdlib, anahtar sözcükler, dosyadaki
semboller, kod parçaları), **canlı sözdizimi denetimi** ve satıra atlayan sorun
listesi, bul & değiştir, komut paleti (`⌘K`), otomatik girinti ve parantez
eşleme, canlı önizleme, konsol ve tek tıkla **Kur** / **Yayınla**.

### OpenOS Cloud & App Store
App Store kataloğu üç kaynaktan okunur: **OpenOS Cloud API'si** → **GitHub deposu**
→ sistemle gelen **yerleşik katalog**. Gezinmek ve kurmak hesap gerektirmez;
yalnızca yayınlamak için OpenOS Cloud hesabı ya da GitHub belirteci gerekir.

`cloud/` klasöründe dağıtıma hazır üç parça var:

| Dosya | Ne yapar |
| --- | --- |
| `cloud/worker.js` | Hesaplar (PBKDF2 + HMAC oturum), uygulama yükleme/indirme, indirme sayacı — Cloudflare Worker + D1 |
| `cloud/schema.sql` | D1 şeması |
| `cloud/openbrow-proxy.js` | OpenBrow'un sayfa motoru |

```bash
npx wrangler d1 create openos-cloud
npx wrangler d1 execute openos-cloud --file cloud/schema.sql --remote
npx wrangler secret put JWT_SECRET
npx wrangler deploy                                   # cloud/wrangler.toml
npx wrangler deploy cloud/openbrow-proxy.js --name openbrow-proxy \
    --compatibility-date 2026-01-01
```

Adresleri **App Store → OpenOS Cloud** ve **OpenBrow → Ayarlar** ekranlarına yapıştırın.
GitHub yolu için ayrı bir depo (örn. `kullanici/openos-cloud`) açıp ince ayrıntılı
bir belirteç (*Contents: Read and write*) verin; **Depoyu hazırla** düğmesi
`catalog.json` ve README'yi oluşturur. Belirteç tarayıcıdan çıkmaz.

### Duvar kâğıtları
12 duvar kâğıdının tamamı canvas üzerinde **yordamsal olarak çizilir** — görsel dosyası yok,
her çözünürlükte keskin, bir kısmı canlı olarak akar (Aurora, Monterey, Pastel Mesh, Güneş Patlaması).

---

## OpenSharp

Uygulama yazmak için tasarlanmış küçük bir dil. Sözcüksel çözümleyici, ayrıştırıcı ve
ağaç yürüyen yorumlayıcı tamamen `src/lang/` altındadır.

```opensharp
app {
  name: "Sayaç"
  icon: "plus"
  tint: ["#5ac8fa", "#0a84ff"]
}

state count = 0          # değişince arayüz kendiliğinden yenilenir

fn bump(n) {
  count = count + n
}

view {
  VStack(spacing: 16, padding: 24, align: "center") {
    Label("Sayaç", style: "title")
    Label("${count}", style: "display")

    HStack(spacing: 10) {
      Button("−", size: "lg", onClick: fn() { bump(-1) })
      Button("+", size: "lg", variant: "primary", onClick: fn() { bump(1) })
    }

    if count > 20 {
      Badge("Rekor! 🎉", color: "green")
    }
  }
}
```

**Dil:** `let` / `state` / `fn` / `if` / `elif` / `else` / `while` / `for … in` /
`return` / `break` / `continue`, kapanışlar, listeler, sözlükler, üçlü işleç,
`and` / `or` / `not`, `"${...}"` metin araya yerleştirme, `??` ve `+=` gibi işleçler.

**Arayüz:** Büyük harfle başlayan çağrılar bileşendir; süslü parantez alt bileşenleri taşır.
`VStack HStack ZStack Grid Card Section ScrollView Label Button TextField TextArea
Toggle Checkbox Slider Select Segmented List ListItem Icon Image Badge Progress
Spinner Avatar Tabs Canvas WebView …`

**Standart kütüphane:** ~100 işlev — metin, liste, matematik, JSON, zaman,
dosya sistemi (`fs_read` / `fs_write` / `fs_list`), kalıcı depo (`store_get` / `store_set`),
sistem (`os_open` / `os_theme` / `os_accent` / `notify` / `toast`) ve ağ (`http_json`).

Studio'da yazdığınız dosyayı **Kur** düğmesiyle gerçek bir uygulamaya dönüştürebilir,
Dock'a ekleyebilirsiniz. `App Store` içinde kaynak kodlu 10 hazır uygulama vardır.

---

## Yapay zekâ ajanları için

OpenOS baştan ajanların kullanabileceği şekilde tasarlandı. Konsolda:

```js
await OpenOS.describe()                 // makine okunur yetenek listesi
OpenOS.listApps()                       // kurulu uygulamalar
OpenOS.openApp("terminal")              // uygulama aç
OpenOS.listWindows()                    // pencere durumu
OpenOS.fs.write("~/Masaüstü/a.txt", "x")
await OpenOS.exec("ls ~/Projeler")      // kabuk komutu
await OpenOS.runScript(kaynak)          // OpenSharp çalıştır / uygulama kur
OpenOS.settings.wallpaper("deepspace")
OpenOS.snapshot()                       // sistemin o anki tam durumu
```

Her çağrı `Sistem Ayarları → Ajan Arayüzü` altındaki izinlere tabidir ve
**Ajan Merkezi** uygulamasında canlı olarak günlüklenir. Uygulama ayrıca
hazır tarifler ve bir deneme konsolu içerir.

---

## Kısayollar

| Kısayol | İşlev |
| --- | --- |
| `⌘/Ctrl + Boşluk` | Spotlight |
| `F4` / `F3` | Launchpad / Mission Control |
| `⌘/Ctrl + W` | Pencereyi kapat |
| `⌘/Ctrl + M` | Küçült |
| `⌘/Ctrl + \`` veya `Tab` | Pencereler arası geçiş |
| `⌃⌘F` | Tam ekran |
| `⌃⌘L` | Ekranı kilitle |
| `⌘/Ctrl + ,` | Sistem Ayarları |
| `⌘K` / `⌘F` / `⌘S` / `⌘↩` | Studio: palet · bul · kaydet · çalıştır |
| `⌘T` / `⌘W` | OpenBrow: yeni sekme · sekmeyi kapat |

Tarayıcının kendi sağ tık menüsü ve metin seçimi sistem genelinde kapalıdır;
her yüzey kendi bağlam menüsünü gösterir (masaüstü, Dock, Finder, OpenBrow,
Studio, metin alanları). Seçim yalnızca metin gerçekten seçilebilir olması
gereken yerlerde açıktır: düzenleyiciler, terminal çıktısı, belgeler.

---

## Proje yapısı

```
index.html           tanıtım sitesi (GitHub Pages kökü)
site/                sitenin stil ve betiği
os/index.html        işletim sisteminin giriş noktası
serve.py serve.sh    önbelleksiz yerel sunucu
assets/icons/        uygulama simgeleri (PNG) + ICON-BRIEF.md
styles/          base · kit · boot · setup · desktop · window · apps
src/
  main.js              giriş noktası
  core/
    kernel.js          oturum, açılış, uygulama başlatma
    vfs.js             sanal dosya sistemi
    settings.js        tercihler + canlı tema
    registry.js        uygulama kaydı
    notify.js          bildirim / uyarı / sor
    agent.js           window.OpenOS makine arayüzü
    seed.js            ilk kurulum dosya ağacı + örnek uygulamalar
    icons.js           tek ailelik SVG ikon seti
    util.js            DOM yardımcıları, olay veri yolu
  boot/
    splash.js          çekirdek günlüğü açılışı
    setup.js           ilk kurulum sihirbazı
  ui/
    window.js          pencere yöneticisi
    jelly.js           jöle modu fiziği
    appicon.js         PNG/SVG simge çözümü
    desktop.js         duvar kâğıdı, simgeler, overlay'ler
    dock.js  menubar.js  menu.js
  lang/                OpenSharp
    lexer.js  parser.js  interpreter.js  runtime.js  stdlib.js  oshapp.js
    cloud.js           OpenOS Cloud istemcisi (hesap, katalog, yayınlama)
    github.js          GitHub içerik API'si ile yayınlama
  apps/                17 uygulama (openbrow.js, studio.js, appstore.js, …)
  wallpapers/
    generator.js       yordamsal duvar kâğıtları
cloud/
  openbrow-proxy.js    OpenBrow sayfa motoru (Cloudflare Worker)
LICENSE  NOTICE  LICENSING.md
```

## Simgeler

`assets/icons/apps/<id>.png` yolunda bir PNG varsa sistem onu kullanır; yoksa
yerleşik SVG simgeye düşer. Tasarım gereksinimleri ve tam id listesi:
[`assets/icons/ICON-BRIEF.md`](assets/icons/ICON-BRIEF.md).

Bağımlılık yok, derleme adımı yok, çerçeve yok — düz ES modülleri.

---

## Lisans

**AGPL-3.0-or-later** — `LICENSE` dosyasına bakın.

OpenOS bir web uygulaması: JavaScript'i zaten tarayıcıya iniyor, yani kaynağı
gizlemek mümkün değil. Korunması gereken şey kodun görünmesi değil, **başkasının
alıp kapalı bir ürüne çevirmesi**. AGPL'in 13. maddesi tam olarak bunu engeller:
OpenOS'u ya da değiştirilmiş bir sürümünü bir ağ üzerinden sunan herkes,
çalıştırdığı sürümün tam kaynağını kullanıcılara açmak zorundadır.

`NOTICE` dosyası ikinci katmanı taşır: **"OpenOS", "OpenSharp", "OpenBrow",
"OpenOS Cloud"** isimleri ve logo AGPL kapsamı dışındadır, tüm hakları saklıdır.
Kodu çatallayabilirsiniz; bu isimlerle dağıtamazsınız.

Ticarileştirme planınız varsa alternatifler ve geçiş yolu `LICENSING.md`
dosyasında anlatılıyor (özet: BUSL-1.1, ilk yayından **önce** seçilmeli).
