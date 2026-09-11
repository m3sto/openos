# OpenSharp ile yazılmış sistem uygulamaları

Bu klasördeki uygulamalar OpenSharp ile yazılmış, `.osapp` paketi olarak
derlenip sisteme kurulabilen gerçek uygulamalardır. Amaç dilin sistem
uygulaması taşıyabildiğini göstermek ve okunacak örnek bırakmaktır.

| Dosya | Ne gösteriyor |
|---|---|
| `Hesap Makinesi.osh` | `match` ile işlem gönderimi, kalıcı geçmiş, `store_get/set`, sıfıra bölmenin `nil` ile ele alınması |
| `Notlar.osh` | `type` + yöntemler, listede arama/süzme, `dialog_open`/`dialog_save`, `try/catch`, göreli tarih |

## Kurmak

```bash
oshc check "Hesap Makinesi.osh"
oshc build "Hesap Makinesi.osh"
pkg install "Hesap Makinesi.osapp"
```

Ya da Studio'da dosyayı açıp **Paket** panelinden "Paketle ve Kur".

## Taşıma durumu

Sistemin 29 uygulamasının tamamı OpenSharp'a taşınmadı; bu bilinçli.
OpenBrow (çapraz kaynak çerçeve yönetimi, motor köprüsü), Studio (kendi
düzenleyici çekirdeği, minimap için canvas) ve Finder (ağır DOM
etkileşimi) doğrudan DOM ve Canvas API'lerine ihtiyaç duyuyor; bunları
dile taşımak işlevsellik kaybettirirdi. Dilin taşıyabildiği sınıftaki
uygulamalar için bu klasördekiler örnektir.
