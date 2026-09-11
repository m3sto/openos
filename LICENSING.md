# Lisanslama notları

## Şu anki lisans: AGPL-3.0-or-later

`LICENSE` dosyası GNU Affero General Public License v3.0'ın resmî tam metnidir.
`NOTICE` dosyası telif bildirimi ve **marka istisnasını** içerir.

### Neden AGPL?

OpenOS bir web uygulaması. JavaScript'i zaten tarayıcıya indiriliyor — yani
kaynağı "gizlemek" teknik olarak mümkün değil. Bu durumda korunması gereken şey
kodun görünmesi değil, **başkasının alıp kapalı bir ürüne çevirmesi**.

AGPL'in 13. maddesi tam olarak bunu engeller: OpenOS'u (ya da değiştirilmiş bir
sürümünü) bir ağ üzerinden sunan herkes, çalıştırdığı sürümün tam kaynağını
kullanıcılara açmak zorundadır. MIT/Apache'de böyle bir zorunluluk yoktur;
GPL'de yalnızca "dağıtım" tetikler, barındırma tetiklemez — bir web OS için
bu boşluk ölümcüldür.

Marka istisnası da ikinci katman: kodu çatallayabilirler ama "OpenOS" adıyla
yayınlayamazlar.

### Yayınlarken yapılacaklar

1. `LICENSE` ve `NOTICE` dosyalarını repo köküne koy (hazır).
2. GitHub repo ayarlarında lisans otomatik "AGPL-3.0" olarak görünecek.
3. README'nin sonundaki lisans bölümünü koru.
4. İsteğe bağlı: her kaynak dosyanın başına kısa SPDX satırı ekle —
   `// SPDX-License-Identifier: AGPL-3.0-or-later`
   (`npm run license:headers` yerine tek satırlık bir sed betiği yeter.)

## Alternatif: ticarileştirme planın varsa

İleride OpenOS Cloud'u ücretli bir hizmete çevirmek istersen AGPL seni
engellemez (telif hakkı sende, istediğin zaman lisans değiştirebilirsin) ama
rakiplerin de aynı kodu barındırabilir — sadece kaynaklarını açmak zorundalar.

Bunu da istemiyorsan **BUSL-1.1** (Business Source License) doğru seçim:

- Kaynak herkese açık, inceleyebilir, katkı verebilir, kendi makinesinde
  çalıştırabilir.
- **Üretimde / ticari hizmet olarak sunmak yasak** (senin dışında).
- Belirlediğin süre sonunda (genelde 4 yıl) otomatik olarak AGPL-3.0'a döner.
- MariaDB, Sentry, HashiCorp Terraform bu lisansı kullanıyor.

Geçiş kolay: `LICENSE` dosyasını BUSL-1.1 metniyle değiştirip başına
`Licensor: Mesto`, `Change Date: 2030-01-01`, `Change License: AGPL-3.0-or-later`
parametrelerini yazman yeterli. Bunu **ilk yayından önce** yapman lazım —
AGPL ile yayınlanmış bir sürüm geri çekilemez (o sürüm için verilen izin kalıcıdır).

## Kesinlikle kaçınılması gerekenler

| Lisans | Neden olmaz |
| --- | --- |
| MIT / BSD / Apache-2.0 | Biri alır, kapatır, kendi adıyla satar. Hiçbir yükümlülüğü olmaz. |
| GPL-3.0 | Barındırma "dağıtım" sayılmaz — web OS için delik. |
| CC BY-NC-ND | Yazılım için tasarlanmadı; patent ve garanti maddeleri yok. Creative Commons bile yazılımda kullanmayın diyor. |
| Lisanssız repo | "Tüm hakları saklı" demektir ama katkı alamazsın, kimse güvenle kullanamaz, GitHub yine de fork edilmesine izin verir. |
