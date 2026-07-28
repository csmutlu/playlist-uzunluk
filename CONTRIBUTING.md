# Katkı rehberi

Küçük düzeltmeler doğrudan pull request olarak gönderilebilir. Yeni özellikler veya davranış değişiklikleri için önce kısa bir issue açılması tercih edilir.

## Yerel geliştirme

```bash
npm install
npm run typecheck
npm test
npm run build
npm run build:firefox
```

Pull request göndermeden önce:

- Chromium ve Firefox paketlerinin derlendiğini doğrulayın.
- Yeni davranış için uygun test ekleyin.
- YouTube SPA geçişlerinde çift panel oluşmadığını kontrol edin.
- Uzun playlistlerde tam liste taraması veya sürekli timer eklemeyin.
- Yeni izin gerekiyorsa gerekçesini pull request açıklamasında belirtin.
- Kullanıcı verisini harici bir servise gönderen kod eklemeyin.

## Kod yaklaşımı

- DOM seçicilerini `lib/youtube-dom.ts` içindeki adaptörlerde tutun.
- Süre ve ilerleme hesaplarını DOM kodundan ayırın.
- Büyük listelerde artımlı güncellemeyi koruyun.
- YouTube’un eski ve yeni renderer yapılarını fixture testleriyle kapsayın.
- Arayüz değişikliklerinde açık ve koyu temayı birlikte kontrol edin.

README görselleri için `docs/demo` altındaki kontrollü fixture kullanılabilir. Görseller gerçek panel bileşeninden üretilmelidir.
