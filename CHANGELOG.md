# Değişiklik günlüğü

Bu dosya [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/) biçimini ve
[Semantic Versioning](https://semver.org/lang/tr/) kurallarını izler.

## [1.7.0] - 2026-08-02

### Eklendi

- **A→B döngüsü**: bir kısayolla başlangıç noktası, ikinciyle bitiş noktası
  işaretlenir ve aradaki bölüm sürekli tekrarlanır; üçüncü basış döngüyü kaldırır.
  Iframe ve kapalı Shadow DOM oynatıcılarında MAIN-world köprüsü üzerinden çalışır.
- **Kare kare ilerleme**: `Önceki kare` ve `Sonraki kare` işlemleri videoyu
  duraklatıp tek kare oynatır. Kısayolun değer alanı kare hızını belirler
  (varsayılan `30`); tuş basılı tutulduğunda kareler tekrarlanır.
- **Pencere içinde pencere**: aktif videoyu bir kısayolla PiP moduna alır veya
  çıkarır. Tarayıcı veya oynatıcı PiP'i engellerse rozet `!` gösterir.
- **Ses tonunu koruma** ayarı: hız değiştiğinde `preservesPitch` her seferinde
  yeniden uygulanır; böylece sitenin oynatıcısı bayrağı sıfırlasa bile yüksek
  hızlarda sesin tonu bozulmaz. Varsayılan olarak açıktır.
- Yeni işlemlerin arayüz metinleri desteklenen 13 dilin tamamına eklendi.
- Proje MIT lisansıyla yayımlandı ([LICENSE](LICENSE)).
- İngilizce belge: [README.en.md](README.en.md).

### Düzeltildi

- Hız rozetinin üzerindeyken sayfanın arka planda değişmesi rozeti soluklaştırıyor
  ve `−`/`+` düğmelerine tıklamayı zorlaştırıyordu. Rozet artık fare üzerindeyken
  yalnızca fare ayrıldıktan sonra soluklaşır.

### Notlar

- Yeni işlemlerin varsayılan tuş ataması yoktur. Popup içindeki **Ek kısayollar**
  bölümünden istediğiniz tuşa atayabilirsiniz. Mevcut kısayollarınız değişmez.
- Evrensel content script sıkıştırılmış `11.2 KB`, MAIN-world köprüsü `2.0 KB`
  boyutunda kaldı; sırasıyla `35 KB` ve `5 KB` bütçelerinin altındadır.
- Brave uçtan uca testi artık gerçek, aranabilir bir video klibiyle (25 fps,
  4 saniye, `scripts/fixtures/tiny-clip.webm`) kare adımlamayı ve A→B döngüsünü
  doğruluyor. Belge linti (`npm run lint:md`) CI'ya eklendi.

## [1.6.8] - 2026-07-30

### Düzeltildi

- Hız değişikliğinin bazı oynatıcılarda oynatma konumunu kaydırması engellendi.
- YouTube'un kendi `T` sinema modu kısayolu korundu.
- İç içe iframe'lerde tek hız rozeti gösterilmesi sağlandı.
- Firefox ve Zen Browser desteği tamamlandı; evrensel mod F5 sonrası kalıcı hale
  getirildi.

### Eklendi

- Gerçek Firefox ve Zen ikilileriyle uçtan uca test kapsamı.

## [1.6.0] - 2026-07-29

### Eklendi

- Tüm sitelerde çalışan evrensel medya hız kontrolü ve kullanım kılavuzu.
- 13 dilli çok dilli arayüz.

## [1.0.0] - 2026-07-28

### Eklendi

- İlk sürüm: YouTube playlist toplam/kalan süre hesaplama, ilerleme takibi,
  çalışma planı ve Playlistlerim ekranı.

[1.7.0]: https://github.com/csmutlu/playlist-uzunluk/releases/tag/v1.7.0
[1.6.8]: https://github.com/csmutlu/playlist-uzunluk/releases/tag/v1.6.8
[1.6.0]: https://github.com/csmutlu/playlist-uzunluk/releases/tag/v1.6.0
[1.0.0]: https://github.com/csmutlu/playlist-uzunluk/releases/tag/v1.0.0
