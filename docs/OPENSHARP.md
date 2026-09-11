# OpenSharp 1.0 — Dil Kılavuzu

OpenSharp, OpenOS için yazılmış küçük bir betik dilidir. Tek bir dosyada hem
arayüzü hem de arkasındaki mantığı tarif edersiniz; yazdığınız şey yorumlanır,
derleme adımı yoktur, kaydettiğiniz anda çalışır.

Bu belge dilin tamamını kapsar. Hem öğrenmek isteyen bir geliştirici hem de
OpenSharp uygulaması üretecek bir yapay zekâ modeli için yazıldı: her başlıkta
önce kuralın kendisi, sonra çalıştırılabilir bir örnek var.

> Bu belgeyi sistemde **Studio → Belgeler** bölmesinden ya da terminalde
> `cat /Applications/docs/OPENSHARP.md` ile okuyabilirsiniz.

---

## İçindekiler

1. [Otuz saniyede OpenSharp](#1-otuz-saniyede-opensharp)
2. [Bir dosyanın yapısı](#2-bir-dosyanın-yapısı)
3. [Değerler ve değişkenler](#3-değerler-ve-değişkenler)
4. [İşleçler](#4-işleçler)
5. [Denetim akışı](#5-denetim-akışı)
6. [Fonksiyonlar](#6-fonksiyonlar)
7. [Yıkarak bağlama ve yayma](#7-yıkarak-bağlama-ve-yayma)
8. [Tipler ve sayımlar](#8-tipler-ve-sayımlar)
9. [Hata yönetimi](#9-hata-yönetimi)
10. [Örüntü eşleme](#10-örüntü-eşleme)
11. [Modüller](#11-modüller)
12. [Görünüm: bileşenler](#12-görünüm-bileşenler)
13. [Durum ve tepkisellik](#13-durum-ve-tepkisellik)
14. [Standart kitaplık](#14-standart-kitaplık)
15. [Paketleme ve dağıtım](#15-paketleme-ve-dağıtım)
16. [Yapay zekâ modelleri için notlar](#16-yapay-zekâ-modelleri-için-notlar)
17. [Sık yapılan hatalar](#17-sık-yapılan-hatalar)

---

## 1. Otuz saniyede OpenSharp

```opensharp
app {
  name: "Sayaç"
  icon: "plus"
  tint: ["#5ac8fa", "#0a84ff"]
  width: 360
  height: 320
}

state sayi = 0

fn arttir(n) {
  sayi = sayi + n
}

view {
  VStack(spacing: 16, padding: 24, align: "center") {
    Label("Sayaç", style: "title")
    Label("${sayi}", style: "display", tint: true)

    HStack(spacing: 10) {
      Button("−", size: "lg", onClick: fn() { arttir(-1) })
      Button("+", size: "lg", variant: "primary", onClick: fn() { arttir(1) })
    }

    Button("Sıfırla", variant: "plain", onClick: fn() { sayi = 0 })
  }
}
```

Üç şey oluyor:

- `app { … }` uygulamanın künyesi — adı, simgesi, pencere ölçüsü.
- `state sayi = 0` **tepkili** bir değişken. Değeri değişince görünüm kendini
  yeniden çizer; elle "güncelle" demek gerekmez.
- `view { … }` arayüz. İçindeki her ifade bir bileşen üretir.

---

## 2. Bir dosyanın yapısı

Bir `.osh` dosyası şu üst düzey blokları tanır. Hepsi isteğe bağlıdır ve
sırası önemli değildir.

| Blok | Ne işe yarar |
|---|---|
| `app { … }` | Uygulamanın künyesi. Paketleme bu bloğu okur. |
| `style { … }` | Uygulamaya özel renk ve ölçü değerleri. |
| `view { … }` | Arayüz ağacı. |
| üst düzey deyimler | `state`, `let`, `fn`, `type`, `enum`, `use` … |

### `app` bloğunun alanları

```opensharp
app {
  name:    "Görev Listesi"      # zorunlu sayılır — paket adı buradan gelir
  id:      "gorev-listesi"      # verilmezse addan türetilir
  version: "1.2.0"
  icon:    "check"              # yerleşik simge adı
  tint:    ["#30d158", "#248a3d"]
  width:   420
  height:  560
  author:  "Mesto"
  about:   "Basit ve hızlı görev listesi."
}
```

Üst düzey deyimler program başlarken **bir kez** çalışır. `view` ise her
yeniden çizimde yeniden değerlendirilir — bu yüzden `view` içinde yan etkisi
olan iş yapmayın (aşağıda [Sık yapılan hatalar](#17-sık-yapılan-hatalar)).

---

## 3. Değerler ve değişkenler

### Türler

| Tür | Örnek | `type()` sonucu |
|---|---|---|
| Sayı | `42`, `3.14`, `-7` | `"num"` |
| Metin | `"merhaba"`, `"satır\n"` | `"str"` |
| Mantıksal | `true`, `false` | `"bool"` |
| Boş | `nil` | `"nil"` |
| Liste | `[1, 2, 3]` | `"list"` |
| Nesne | `{ ad: "Mesto", yas: 30 }` | `"obj"` |
| Fonksiyon | `fn(x) { return x }` | `"fn"` |
| Kendi tipiniz | `Nokta(x: 1)` | `"Nokta"` |

### Bildirimler

```opensharp
let   sayac = 0        # yeniden atanabilir, yerel
const PI2   = 6.283    # değişmez
state secili = nil     # tepkili: değişince görünüm yenilenir
```

`state` yalnızca üst düzeyde tepkilidir. Bir fonksiyonun içinde `state`
yazarsanız sıradan bir yerel değişken olur.

### Metin araya değer koyma

```opensharp
let ad = "Mesto"
let n = 3
print("Merhaba ${ad}, ${n} iletiniz var")
print("Toplam: ${n * 2 + 1}")     # içinde ifade de olabilir
```

### Yorumlar

```opensharp
# satır yorumu
// bu da satır yorumu
/* blok
   yorumu */
```

---

## 4. İşleçler

```
aritmetik     +  -  *  /  %
karşılaştırma ==  !=  <  >  <=  >=
mantık        and  or  not      (&&  ||  !  de geçerli)
boş birleşim  ??
üyelik        in
tip sınama    is
atama         =  +=  -=  *=  /=  %=
zincir        ?.   ?.[ ]   ?.( )
üç terimli    kosul ? a : b
yayma         ...
```

Örnekler:

```opensharp
let a = nil
print(a ?? "varsayılan")            # varsayılan

print("ma" in "kumaş")              # true
print(3 in [1, 2, 3])               # true
print("ad" in { ad: "x" })          # true

print([1,2] is "list")              # true
print(nil is "nil")                 # true

let kullanici = nil
print(kullanici?.profil?.eposta)    # nil — çökmez
```

`+` sayı ile sayıyı toplar, metinle her şeyi birleştirir:

```opensharp
print(1 + 2)          # 3
print("say: " + 2)    # say: 2
```

---

## 5. Denetim akışı

```opensharp
if puan >= 90 {
  print("pekiyi")
} elif puan >= 70 {
  print("iyi")
} else {
  print("geçer")
}

while kalan > 0 {
  kalan -= 1
  if kalan == 3 { continue }
  if kalan == 1 { break }
}

for sayi in [1, 2, 3] {
  print(sayi)
}

# indeksle birlikte
for i, deger in ["a", "b"] {
  print("${i}: ${deger}")
}

# nesnede anahtar ve değer
for anahtar, deger in { x: 1, y: 2 } {
  print("${anahtar} = ${deger}")
}

# sayı üstünde dönmek `range` gerektirmez
for i in 5 { print(i) }          # 0 1 2 3 4
```

---

## 6. Fonksiyonlar

```opensharp
fn selamla(ad, selam = "Merhaba") {
  return "${selam}, ${ad}!"
}

print(selamla("Mesto"))               # Merhaba, Mesto!
print(selamla("Mesto", "Günaydın"))   # Günaydın, Mesto!
```

### Adlandırılmış argümanlar

Çağrıda `ad: değer` yazarsanız sıra önemsizleşir. Bileşenlerin tamamı bu
biçimi kullanır.

```opensharp
fn kutu(genislik: 100, yukseklik: 50) {
  return genislik * yukseklik
}
print(kutu(yukseklik: 20, genislik: 3))   # 60
```

### Kalan parametreler

```opensharp
fn topla(...sayilar) {
  return reduce(sayilar, fn(a, b) => a + b, 0)
}
print(topla(1, 2, 3, 4))     # 10
```

### İsimsiz fonksiyonlar

```opensharp
let ikiKat = fn(x) { return x * 2 }
let uckat  = fn(x) => x * 3          # tek ifade: `return` yazmaya gerek yok

print(map([1, 2, 3], fn(x) => x * x))    # [1, 4, 9]
```

Fonksiyonlar birinci sınıf değerlerdir: değişkene atanır, argüman olarak
geçirilir, döndürülür.

---

## 7. Yıkarak bağlama ve yayma

```opensharp
# nesneyi parçalara ayır
let kullanici = { ad: "Mesto", sehir: "İstanbul" }
let { ad, sehir, yas = 0 } = kullanici
print("${ad} / ${sehir} / ${yas}")       # Mesto / İstanbul / 0

# listeyi parçalara ayır
let [ilk, ikinci, ...kalan] = [10, 20, 30, 40]
print(kalan)                              # [30, 40]

# yayma
let temel = [1, 2]
let genis = [...temel, 3, 4]

let varsayilan = { tema: "koyu", punto: 13 }
let ayar = { ...varsayilan, punto: 15 }   # punto ezilir → 15

# çağrıda yayma
let parcalar = [1, 2, 3]
print(topla(...parcalar))
```

Nesne yaymasında **yazım sırası** belirleyicidir: `{...a, x: 1}` ile
`{x: 1, ...a}` farklı sonuç verir.

---

## 8. Tipler ve sayımlar

### `type` — alanları ve yöntemleri olan yapı

```opensharp
type Gorev {
  baslik = ""
  bitti  = false
  onem   = 1

  fn etiket() {
    return self.bitti ? "✓ ${self.baslik}" : "○ ${self.baslik}"
  }
  fn degistir() {
    self.bitti = not self.bitti
  }
}

let g = Gorev(baslik: "Alışveriş", onem: 3)
print(g.etiket())        # ○ Alışveriş
g.degistir()
print(g.etiket())        # ✓ Alışveriş
print(g is "Gorev")      # true
```

Yöntemlerin içinde nesnenin kendisine `self` ile ulaşırsınız. Verilmeyen
alanlar varsayılanlarını alır.

### `enum` — adlandırılmış sabitler

```opensharp
enum Durum {
  bekliyor
  calisiyor
  bitti
}

let d = Durum.calisiyor
print(d)                      # calisiyor

# değer vermek de mümkün
enum Renk {
  kirmizi = "#ff3b30"
  yesil   = "#30d158"
}
print(Renk.yesil)             # #30d158
```

---

## 9. Hata yönetimi

```opensharp
fn bol(a, b) {
  if b == 0 {
    throw "sıfıra bölme"
  }
  return a / b
}

try {
  print(bol(10, 0))
} catch e {
  print("hata: ${e.message}")     # hata: sıfıra bölme
} finally {
  print("her durumda çalışır")
}
```

`throw` metin de nesne de alabilir; yakalanan değer her zaman `message` alanı
taşır:

```opensharp
throw { message: "dosya bozuk", kod: 422, yol: "/tmp/x" }
```

```opensharp
try {
  let veri = json_parse(fs_read("/ayar.json"))
  if is_nil(veri) { throw "ayar dosyası okunamadı" }
} catch e {
  toast("Ayarlar yüklenemedi: ${e.message}")
}
```

`catch` içindeki değişken adı isteğe bağlıdır — `catch { … }` de yazılabilir.

---

## 10. Örüntü eşleme

`match` bir **ifadedir**: değer üretir, atanabilir, döndürülebilir.

```opensharp
fn adlandir(n) {
  return match n {
    0  => "sıfır",
    1  => "bir",
    2  => "iki",
    _  => "çok"
  }
}
```

Koşullu dallar — `_` o dalda eşleşen değeri gösterir:

```opensharp
let etiket = match sicaklik {
  _ if _ > 30 => "sıcak",
  _ if _ > 15 => "ılık",
  _           => "soğuk"
}
```

Tip üstünden eşleme:

```opensharp
fn yaz(v) {
  return match v {
    is "nil"  => "boş",
    is "list" => "${len(v)} öğelik liste",
    is "obj"  => "nesne",
    _         => str(v)
  }
}
```

Dal gövdesi blok da olabilir:

```opensharp
match komut {
  "kaydet" => { kaydet(); toast("Kaydedildi") },
  "sil"    => { sil() },
  _        => toast("Bilinmeyen komut")
}
```

---

## 11. Modüller

Büyüyen bir uygulamayı dosyalara bölebilirsiniz. Yollar **çağıran dosyanın
klasörüne** göre çözülür.

`yardimcilar.osh`:

```opensharp
export fn paraBicimle(n) {
  return format(n, 2) + " ₺"
}

export let KDV = 0.20

fn yalnizcaIcerde() { return 1 }     # `export` yok — dışarı açılmaz
```

`ana.osh`:

```opensharp
use { paraBicimle, KDV } from "./yardimcilar.osh"
use "./yardimcilar.osh" as yardim          # hepsi tek nesnede
use "./ortak/tarih.osh"                    # adlar doğrudan kapsama girer

print(paraBicimle(19.9))        # 19.90 ₺
print(yardim.KDV)               # 0.2
```

Aynı dosya iki kez yüklenmez. Döngüsel bağımlılık sessizce donmak yerine
anlaşılır bir hata verir.

---

## 12. Görünüm: bileşenler

`view` bloğunun içinde her ifade bir bileşen üretir. Büyük harfle başlayan
her ad bir bileşendir.

```opensharp
view {
  VStack(spacing: 12, padding: 20) {
    Label("Başlık", style: "title")
    Button("Tamam", onClick: fn() { close() })
  }
}
```

Çocuk alan bileşenler süslü parantezle yazılır; almayanlar yalnızca çağrılır.

### Yerleşim

| Bileşen | Açıklama | Başlıca özellikler |
|---|---|---|
| `VStack { }` | Dikey yığın | `spacing`, `padding`, `align`, `justify`, `grow` |
| `HStack { }` | Yatay yığın | aynı |
| `ZStack { }` | Üst üste bindirme | — |
| `Grid { }` | Izgara | `columns`, `gap` |
| `ScrollView { }` | Kaydırılabilir alan | `height` |
| `Spacer()` | Esner, kalanı doldurur | — |
| `Divider()` | İnce ayraç | — |
| `Card("Başlık") { }` | Kart | `padding` |
| `Section("Başlık") { }` | Bölüm başlığı + içerik | — |

### Metin

| Bileşen | Açıklama |
|---|---|
| `Label("metin")` | Genel metin. `style:` ile `"display" · "title" · "headline" · "body" · "caption"` |
| `Title("metin")` | `Label` + başlık biçimi |
| `Caption("metin")` | Küçük, soluk metin |
| `Text("metin")` | Çok satırlı gövde metni |
| `Code("kod")` | Tek aralıklı blok |

`Label` özellikleri: `tint: true` (vurgu rengi), `color`, `weight`, `font`,
`align`.

### Denetimler

| Bileşen | Açıklama |
|---|---|
| `Button("Metin", onClick: fn() { })` | `variant:` `"primary" · "secondary" · "tinted" · "danger" · "ghost" · "plain"`, `size:` `"sm" · "lg" · "xl"`, `icon:`, `full:` |
| `TextField(value, placeholder: "")` | `bind:`, `onChange:`, `onSubmit:`, `icon:`, `secure:` |
| `TextArea(value, rows: 5)` | `bind:`, `onChange:` |
| `Toggle("Etiket", value: x)` | `bind:`, `onChange:` |
| `Checkbox("Etiket", value: x)` | `bind:`, `onChange:` |
| `Slider(value, min: 0, max: 100)` | `step:`, `bind:`, `onChange:` |
| `Select(value, options: [...])` | `bind:`, `onChange:` |
| `Segmented(value, options: [...])` | `bind:`, `onChange:` |

### Gösterim

| Bileşen | Açıklama |
|---|---|
| `Icon("check", size: 18)` | Yerleşik simge |
| `Image(url, width: 80)` | Görsel |
| `Badge("3")` | Rozet |
| `Progress(0.4)` | İlerleme çubuğu |
| `Spinner()` | Dönen gösterge |
| `Avatar("M")` | Baş harf dairesi |
| `List { }` / `ListItem("Başlık", subtitle: "", glyph: "")` | Liste |
| `Empty("İleti", glyph: "")` | Boş durum |
| `Tabs { Tab("Ad") { } }` | Sekmeler |
| `Canvas(onDraw: fn(ctx) { })` | Serbest çizim |

### Her bileşende geçerli özellikler

```
width  height  minWidth  maxWidth  padding  margin
background  radius  color  opacity  border  shadow
grow  hidden  font  weight  class  id  tip  style
```

`tip:` fareyle üzerine gelince çıkan ipucudur. `style:` bir nesne alır ve
doğrudan CSS uygular: `style: { letterSpacing: "-0.02em" }`.

### Koşullu ve döngülü arayüz

```opensharp
view {
  VStack(spacing: 10, padding: 18) {
    if len(gorevler) == 0 {
      Empty("Henüz görev yok", glyph: "check")
    } else {
      List {
        for g in gorevler {
          ListItem(g.baslik, subtitle: g.bitti ? "tamamlandı" : "bekliyor",
                   glyph: g.bitti ? "check" : "circle")
        }
      }
    }
  }
}
```

---

## 13. Durum ve tepkisellik

```opensharp
state metin = ""
state liste = []

fn ekle() {
  if trim(metin) == "" { return }
  push(liste, { baslik: metin, bitti: false })
  metin = ""
}

view {
  VStack(spacing: 10, padding: 16) {
    HStack(spacing: 8) {
      TextField(metin, placeholder: "Yeni görev", bind: "metin", grow: true)
      Button("Ekle", variant: "primary", onClick: ekle)
    }
    for g in liste {
      Checkbox(g.baslik, value: g.bitti, onChange: fn(v) { g.bitti = v })
    }
  }
}
```

Üç kural:

1. **`state` değişkenine atamak** görünümü yeniler.
2. Bir **liste ya da nesnenin içini** değiştirmek (örneğin `push`) da yeniler.
3. Yenilemeyi elle istemeniz gerekirse `refresh()` çağırın — zamanlayıcıların
   içinde çoğu zaman gerekir.

```opensharp
state saniye = 0
every(1000, fn() {
  saniye += 1
  refresh()
})
```

### İki yönlü bağlama

`bind: "degiskenAdi"` yazdığınızda denetim, o `state` değişkenini kendisi
günceller; `onChange` yazmanıza gerek kalmaz.

```opensharp
state ad = ""
TextField(ad, placeholder: "Adınız", bind: "ad")
Label("Merhaba ${ad}")
```

---

## 14. Standart kitaplık

Her işlev doğrudan çağrılabilir. Ayrıca **yöntem biçiminde** de yazılabilir:
`upper(s)` ile `s.upper()` aynı şeydir, `map(l, f)` ile `l.map(f)` aynı
şeydir. Zincirlemek okunaklı olur:

```opensharp
let temiz = metin.trim().lower().split(" ").filter(fn(w) => len(w) > 3)
```

### Çıktı ve bildirim
`print(...)` · `alert(msg)` · `confirm(msg, fn(ok))` · `ask(msg, fn(v))` ·
`toast(msg, glyph)` · `notify(title, body, glyph)`

### Türler
`len(v)` · `str(v)` · `num(v)` · `int(v)` · `bool(v)` · `type(v)` · `is_nil(v)`

### Matematik
`abs` · `floor` · `ceil` · `round(v, basamak)` · `min` · `max` · `sqrt` ·
`pow` · `random(a, b)` · `clamp(v, alt, ust)` · `PI`

### Metin
`upper` · `lower` · `trim` · `trim_start` · `trim_end` · `split(s, ayrac)` ·
`join(liste, ayrac)` · `replace(s, a, b)` · `contains(s, q)` · `starts` ·
`ends` · `slice(s, a, b)` · `pad(s, n, c)` · `pad_end` · `repeat(s, n)` ·
`char_at(s, i)` · `index_of(s, q)` · `format(n, basamak)` · `title_case` ·
`lines(s)` · `words(s)` · `count(s, q)` · `slug(s)`

### Düzenli ifadeler
Desen bir metindir, bayraklar ayrı verilir.

```opensharp
re_test("^[a-z]+$", "merhaba")              # true
re_find("(\\d+)-(\\d+)", "12-34")           # { text, index, groups }
re_all("\\w+", "bir iki üç")                # üç eşleşme
re_replace("[0-9]+", "a1b22c", "#")         # a#b#c
re_split("\\s*,\\s*", "a, b ,c")            # ["a","b","c"]
```

### Listeler
`range(a, b, adim)` · `push` · `pop` · `shift` · `unshift` · `remove_at` ·
`insert_at` · `map(l, fn)` · `filter` · `find` · `each` · `reduce` · `sort` ·
`reverse` · `sum` · `avg` · `unique`

### Nesneler
`keys(o)` · `values(o)` · `entries(o)` · `has(o, k)` · `del(o, k)` ·
`merge(a, b)` · `json_str(v, guzel)` · `json_parse(s)`

### Zaman
`now()` · `time_str(ts)` · `date_str(ts)` · `date_parts(ts)` ·
`date_make(y, ay, gun, sa, dk)` · `date_add(ts, gun, sa, dk)` ·
`date_diff(a, b, birim)` · `date_format(ts, bicim)` · `date_relative(ts)` ·
`after(ms, fn)` · `every(ms, fn)` · `cancel(t)`

`date_format` biçimleri: `"uzun"` · `"kisa"` · `"saat"` · `"tam"` · `"iso"`.
`date_diff` birimleri: `"ms"` · `"sn"` · `"dk"` · `"sa"` · `"gun"`.

### Dosya sistemi
`fs_read(p)` · `fs_write(p, c)` · `fs_append(p, c)` · `fs_list(p)` ·
`fs_exists(p)` · `fs_remove(p)` · `fs_mkdir(p)` · `fs_read_json(p, vars)` ·
`fs_write_json(p, v)` · `fs_copy(a, b)` · `fs_move(a, b)` · `fs_stat(p)` ·
`fs_search(q, kok)` · `fs_home()` · `fs_dir()`

### Yol
`path_join(...)` · `path_dir(p)` · `path_name(p)` · `path_ext(p)`

### Dosya kutuları
```opensharp
dialog_open(fn(yol) {
  if is_nil(yol) { return }        # vazgeçildi
  icerik = fs_read(yol)
}, { baslik: "Aç", uzantilar: ["txt", "md"] })

dialog_save(fn(yol) {
  if yol { fs_write(yol, icerik) }
}, { ad: "belge.txt" })
```

### Pano
Sistemin kendi panosudur; ana bilgisayarın panosuna erişilmez.

`clip_read()` · `clip_write(v)` · `clip_history()` · `clip_clear()`

### Kalıcı depo
Uygulamanıza özel, yeniden açılınca duran anahtar/değer deposu.

```opensharp
state sayac = store_get("sayac", 0)
fn arttir() {
  sayac += 1
  store_set("sayac", sayac)
}
```

### Kodlama
`b64_encode` · `b64_decode` · `url_encode` · `url_decode` · `uuid()` ·
`hash(s)`

> `hash` kısa ve kararlı bir özet üretir; kimlik ve önbellek anahtarı içindir.
> **Parola saklamak için kullanmayın.**

### Sistem
`os_open(id, args)` · `os_apps()` · `os_theme(t)` · `os_accent(c)` ·
`os_user()` · `os_info()` · `ps_list()` · `refresh()` · `title(t)` ·
`close()` · `win_size(w, h)` · `beep(hz, ms)`

### Ağ
```opensharp
http_get("https://ornek.com/veri.txt", fn(metin, durum) {
  if durum != 200 { return toast("İstek başarısız") }
  icerik = metin
  refresh()
})

http_json("https://ornek.com/api", fn(veri, durum) { … })
http_post("https://ornek.com/api", { ad: "Mesto" }, fn(yanit, durum) { … })

if not net_online() { toast("Çevrimdışısınız") }
```

---

## 15. Paketleme ve dağıtım

Bir uygulama tek bir `.osh` dosyası olabilir; ama dağıtmak için **paket**
haline getirilir. Paket, dosya sisteminde sıradan bir klasördür:

```
Görevler.osapp/
  manifest.json     kimlik, sürüm, ölçüler, yazar
  main.osh          çalıştırılan kaynak
  icon.png          simge (isteğe bağlı)
  README.md         açıklama (isteğe bağlı)
```

### Studio'dan

**Paket** panelini açın, alanları doldurun, simgeyi seçin, **Paketle ve Kur**.

### Terminalden

```bash
oshc check Görevler.osh                    # söz dizimini denetle
oshc build Görevler.osh                    # Görevler.osapp üret
oshc build Görevler.osh -o /tmp/G.osapp    # başka yere
pkg verify /tmp/G.osapp                    # kurmadan denetle
pkg install /tmp/G.osapp                   # kur
pkg ls                                     # kurulu paketler
pkg info gorevler                          # ayrıntı
pkg remove gorevler --purge                # verisiyle birlikte kaldır
```

`osh dosya.osh` bir betiği pencere açmadan çalıştırır — çıktısı terminale
düşer, kısa işler için pratiktir.

---

## 16. Yapay zekâ modelleri için notlar

Bu bölüm, OpenSharp uygulaması üretecek bir model için yoğunlaştırılmış
kurallardır.

**Her zaman bu iskeletle başlayın.** `app` ve `view` olmadan uygulama
çalışmaz:

```opensharp
app { name: "Ad", icon: "sparkles", tint: ["#5e5ce6", "#bf5af2"], width: 480, height: 420 }

state ...

fn ...

view {
  VStack(spacing: 12, padding: 20) {
    ...
  }
}
```

**Uyulması gereken kısıtlar**

- Sınıf, kalıtım, `async`/`await`, jeneratör **yoktur**. Eşzamansız iş
  geri çağırma ile yapılır: `http_get(url, fn(veri, durum) { … })`.
- `for (i = 0; i < n; i++)` biçimi **yoktur**. `for i in n { }` yazın.
- Dizin `[]` ile, üye `.` ile okunur; metin dizinleme `char_at(s, i)`.
- Metin birleştirmede `+` çalışır ama `"${…}"` tercih edilir.
- `view` içinde yalnızca bileşen üretin: atama, `push`, ağ isteği yapmayın.
- Değişiklikten sonra görünümün yenilenmesi için `state` değişkenine atayın;
  zamanlayıcı içinde ayrıca `refresh()` çağırın.
- Yerleşik simge adlarını uydurmayın — bilmiyorsanız `"sparkles"` kullanın.
  Güvenli olanlar: `check` `x` `plus` `search` `folder` `folderOpen` `file`
  `fileText` `fileCode` `code` `package` `bolt` `clock` `calendar` `music`
  `image` `globe` `terminal` `settings` `trash` `heart` `star` `grid` `list`
  `info` `alert` `play` `save` `upload` `download` `refresh` `home` `user`
  `sparkles` `calc` `chart` `lock` `wifi` `window` `copy` `clipboard`.

  Adı doğrulamak için terminalde `oshc check` yetmez — bilinmeyen simge
  sessizce boş çizilir. Emin değilseniz `sparkles` kullanın.
- Renkler `#rrggbb` biçiminde; `tint` **iki** renkli bir dizidir.
- Türkçe karakterli değişken adı kullanmayın; metinlerde serbesttir.

**Kalite ölçütleri** — bir uygulamanın "tamam" sayılması için:

1. `app` künyesi eksiksiz (ad, simge, renk, ölçü).
2. Boş durum ele alınmış (`Empty(...)`).
3. Kullanıcı girdisi doğrulanmış (boş metin eklenmiyor).
4. Kalıcılık gerekiyorsa `store_get` / `store_set` kullanılmış.
5. Yıkıcı işlem `confirm` ile onaylatılmış.
6. Hata verebilecek her çağrı (`fs_read`, `json_parse`, ağ) `try`/`catch`
   ya da `is_nil` denetimiyle sarılmış.

**Tam örnek — kalıcı görev listesi**

```opensharp
app {
  name: "Görevler"
  icon: "check"
  tint: ["#30d158", "#248a3d"]
  width: 420
  height: 560
  about: "Kalıcı, basit görev listesi."
}

state gorevler = store_get("gorevler", [])
state yeni = ""

fn kaydet() {
  store_set("gorevler", gorevler)
}

fn ekle() {
  let baslik = trim(yeni)
  if baslik == "" { return }
  push(gorevler, { id: uuid(), baslik: baslik, bitti: false, tarih: now() })
  yeni = ""
  kaydet()
}

fn degistir(g) {
  g.bitti = not g.bitti
  kaydet()
}

fn sil(g) {
  confirm("“${g.baslik}” silinsin mi?", fn(ok) {
    if not ok { return }
    gorevler = filter(gorevler, fn(x) => x.id != g.id)
    kaydet()
    refresh()
  })
}

fn temizle() {
  gorevler = filter(gorevler, fn(g) => not g.bitti)
  kaydet()
}

view {
  VStack(spacing: 0, grow: true) {
    HStack(spacing: 8, padding: 14) {
      TextField(yeni, placeholder: "Yeni görev", bind: "yeni", grow: true, onSubmit: ekle)
      Button("Ekle", variant: "primary", onClick: ekle)
    }
    Divider()

    ScrollView(grow: true) {
      VStack(spacing: 6, padding: 12) {
        if len(gorevler) == 0 {
          Empty("Henüz görev yok", glyph: "check")
        }
        for g in gorevler {
          HStack(spacing: 10) {
            Checkbox(g.baslik, value: g.bitti, onChange: fn(v) { degistir(g) })
            Spacer()
            Button("", icon: "trash", variant: "ghost", onClick: fn() { sil(g) })
          }
        }
      }
    }

    Divider()
    HStack(spacing: 8, padding: 12) {
      Caption("${len(filter(gorevler, fn(g) => not g.bitti))} bekliyor")
      Spacer()
      Button("Tamamlananları temizle", variant: "plain", onClick: temizle)
    }
  }
}
```

---

## 17. Sık yapılan hatalar

**`view` içinde durum değiştirmek.** `view` her çizimde yeniden çalışır;
içinde atama yaparsanız sonsuz döngüye girer.

```opensharp
view {
  sayac = sayac + 1        # YANLIŞ
  Label("${sayac}")
}
```

Değişikliği bir olay işleyicisinde yapın.

**Zamanlayıcıda `refresh()` unutmak.** `state`'e atamak çoğu durumda yeter,
ama zamanlayıcının içinden gelen değişiklikler için açıkça çağırın.

**`bind` ile `value`yu karıştırmak.** `bind` bir **değişken adıdır**, metin
olarak yazılır:

```opensharp
TextField(ad, bind: "ad")      # doğru
TextField(ad, bind: ad)        # yanlış — değerin kendisini geçirir
```

**Zamanlayıcıyı iptal etmemek.** Uygulama kapanınca zamanlayıcılar
temizlenir, ama uygulama içinde yeniden başlatıyorsanız eskisini durdurun:

```opensharp
state t = nil
fn basla() {
  cancel(t)
  t = every(1000, fn() { … })
}
```

**Ağ yanıtını denetlememek.** `http_get` başarısız olduğunda ilk argüman
`nil` gelir:

```opensharp
http_get(url, fn(metin, durum) {
  if is_nil(metin) { return toast("Bağlantı yok") }
  …
})
```

**Yerleşik olmayan simge adı vermek.** Bilinmeyen simge sessizce boş çizilir;
listedeki adlardan birini kullanın.

---

## Hızlı başvuru

```opensharp
app { … }  style { … }  view { … }

let x = 1        const K = 2        state s = 3
fn f(a, b = 1, ...kalan) { return a }
let g = fn(x) => x * 2

if … { } elif … { } else { }
while … { }
for v in liste { }       for i, v in liste { }
break    continue    return

try { } catch e { } finally { }      throw "ileti"
match v { 0 => "a", _ if _ > 5 => "b", is "list" => "c", _ => "d" }

type T { alan = 0, fn y() { return self.alan } }
enum E { a, b }

use "./m.osh"    use "./m.osh" as m    use { a } from "./m.osh"
export fn f() { }

let { a, b = 1 } = o      let [x, ...r] = l
[...a, b]    { ...o, k: v }    f(...args)
a?.b    a ?? b    a in b    a is "list"
```

---

*OpenSharp 1.0 · OpenOS “Meridian” · Bu belge sistemle birlikte dağıtılır.*
