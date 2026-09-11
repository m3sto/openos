# OpenBrow Proxy

Bu klasörde OpenOS'un **tarayıcı motoru** için gereken tek dosyalık Cloudflare
Worker'ı bulunur.

```bash
npx wrangler deploy openbrow-proxy.js --name openbrow-proxy \
    --compatibility-date 2026-01-01
```

Çıkan adresi OpenOS içinde **OpenBrow → openos://browser-settings → OpenBrow Proxy**
alanına yapıştırın.

Proxy sayfaları OpenOS kimliğiyle indirir, `X-Frame-Options` / CSP engellerini
kaldırır ve sayfaya OpenBrow kimliğini enjekte eder. Hiçbir veri saklamaz.

---

**Hesap sistemi ve App Store arka ucu burada değil.** Onlar ayrı bir depoda:
👉 <https://github.com/m3sto/openos-cloud>
