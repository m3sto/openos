# OpenOS — Uygulama Simgesi Brifi

## Teknik gereksinimler

| Konu | Değer |
| --- | --- |
| Biçim | WebP (tercih) ya da PNG-24, saydam arkaplan |
| Boyut | **384 × 384** yeterli (en büyük gösterim Dock hover ≈ 107 px, 2x'te 214 px) |
| Dosya adı | `<id>.webp` ya da `<id>.png` — aşağıdaki tablodaki **id** birebir |
| Konum | `assets/icons/apps/` |
| Şekil | macOS squircle (superellipse), kenar yarıçapı ≈ %22.5 |
| Güvenli alan | Kenarlardan **%8** boşluk bırakın; simge dock'ta kırpılmaz |
| Gölge | Gömmeyin — sistem kendi gölgesini ekler |
| Parlaklık | Üstten alta hafif ışık geçişi iyi durur (iOS/macOS dili) |

Sistem sırayla `<id>.webp`, sonra `<id>.png` arar; ikisi de yoksa yerleşik SVG
simgeye düşer. Yeniden başlatma gerekmez.

**Kaynak levha:** `assets/icons/sheet.png` (1536×1024, 10×6 ızgara). Simgeler
bu levhadan ölçülerek kesildi; levhayı güncellerseniz aynı yöntemle yeniden
üretilebilirler.

İsteğe bağlı: `<id>@dark.png` koyarsanız koyu temada o kullanılır.

## Renk kimliği

Her uygulamanın sistemde tanımlı iki renkli gradyanı var (aşağıda).
PNG tasarımında bu gradyanı taban almanız, sistemin geri kalanıyla
(bildirimler, Spotlight, App Store kartları) uyumu korur.

## Tam liste — 19 simge

| # | id | Ad | Gradyan | Kategori | Not |
| --- | --- | --- | --- | --- | --- |
| 1 | `finder` | Finder | `#4aa8ff → #0a6ede` | Sistem | Dosya yöneticisi |
| 2 | `terminal` | Terminal | `#4c4c52 → #1c1c1e` | Geliştirme | Kabuk |
| 3 | `studio` | OpenSharp Studio | `#7b5cff → #4a2fd0` | Geliştirme | IDE |
| 4 | `settings` | Sistem Ayarları | `#9aa0aa → #5b6069` | Sistem | Dişli |
| 5 | `texteditor` | Metin Düzenleyici | `#ffc84a → #e08a1e` | Çalışma | Markdown/metin |
| 6 | `notes` | Notlar | `#ffd60a → #e0a000` | Çalışma | Not defteri |
| 7 | `calculator` | Hesap Makinesi | `#ff9f0a → #c96f00` | Araçlar | |
| 8 | `browser` | **OpenBrow** | `#4aa8ff → #1b56d6` | İnternet | Pusula/tarayıcı |
| 9 | `photos` | Görseller | `#ff7ab6 → #c4408a` | Medya | Galeri |
| 10 | `calendar` | Takvim | `#ff6b6b → #d63a3a` | Çalışma | |
| 11 | `appstore` | App Store | `#0a84ff → #5e5ce6` | Sistem | Paket/kutu |
| 12 | `cloud` | **OpenOS Cloud** | `#64d2ff → #0a84ff` | Sistem | Hesap + bulut |
| 13 | `agenthub` | Ajan Merkezi | `#7b5cff → #3f21b8` | Geliştirme | Robot |
| 14 | `activity` | Etkinlik İzleyici | `#30d158 → #0c7a34` | Araçlar | Grafik |
| 15 | `music` | Synth | `#ff375f → #7b0b27` | Medya | Piyano/dalga |
| 16 | `welcome` | Hoş Geldiniz | `#5e5ce6 → #bf5af2` | Sistem | Yıldız/kıvılcım |
| 17 | `help` | Kılavuz | `#64d2ff → #0a84ff` | Sistem | Soru işareti |
| 18 | `about` | Bu OpenOS Hakkında | `#8e8e93 → #48484a` | Sistem | Launchpad'de gizli |
| 19 | `trash` | Çöp Kutusu | `#9aa0aa → #6b7078` | Dock | `trash.png` ve `trash-full.png` |

## Ek simgeler (isteğe bağlı ama güzel durur)

| Dosya | Nerede kullanılır |
| --- | --- |
| `assets/icons/logo.png` | Açılış ekranı, menü çubuğu, Hakkında (1024×1024, saydam) |
| `assets/icons/logo-mark.svg` | Vektör gerekiyorsa |
| `favicon.png` | Tarayıcı sekmesi (512×512) |
| `assets/icons/apps/_default.png` | OpenSharp ile yazılmış kullanıcı uygulamaları için genel simge |

## Yerleşim ipucu

Simgeler sistemde şu boyutlarda görünür:
`52px` dock (hover'da ~2×, yani 104px) · `66px` Launchpad · `34px` widget ·
`30px` bildirim · `28px` Spotlight · `52px` App Store kartı.

En küçük boyutta okunabilirlik belirleyici: ince çizgilerden ve küçük
metinden kaçının.
