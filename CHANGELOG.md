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
- **Video Speed Controller’dan içe aktarma.** Popup’taki içe aktarma, o
  eklentinin `videospeed-settings.json` dosyasını otomatik tanıyıp dönüştürür:
  hız adımı, sarma süreleri, tercih edilen hız, modifier’lı kısayollar, gösterge
  opaklığı/boyutu, özel CSS, ses desteği, `siteRules` ve `blacklist`. Tüm siteler
  izni dosyadan alınmaz. Ayrıntı: [README](README.md#video-speed-controllerdan-geçiş).
- Yeni işlemlerin arayüz metinleri desteklenen 13 dilin tamamına eklendi.
- Proje MIT lisansıyla yayımlandı ([LICENSE](LICENSE)).
- İngilizce belge: [README.en.md](README.en.md).

### Düzeltildi

- **Yüksek hızlarda hız kaybı.** Tampon kurtarma yalnızca `stalled` olayında
  tampon doluluğunu kontrol ediyor, `waiting` olayında koşulsuz `1x`'e
  düşüyordu. Yüksek hızlarda tarayıcı ağ değil kod çözücü geri kaldığı için
  sık `waiting` yayar; sonuçta eklenti hızı fiilen `1x`'e kilitliyordu.
  Ölçüm (Brave, 60 sn'lik gerçek klip, 4 sn pencere):

  | İstenen | Öncesi | Sonrası | Eklentisiz |
  | --- | --- | --- | --- |
  | 4x | 3.47x | 4.00x | — |
  | 8x | 8.01x | 7.99x | 7.91x |
  | 16x | 1.03x | 9.97x | 14.99x |

  Tampon gerçekten azaldığında kurtarma eskisi gibi devreye girer; `16x` ile
  eklentisiz `14.99x` arasındaki fark bu kasıtlı takılma korumasından gelir.

- **Sitenin kendi klavye kısayoluyla yaptığı hız değişikliği geri alınıyordu.**
  Kullanıcı jesti yalnızca `pointerdown` ile kaydediliyordu; bizim bir hız
  tuşumuza bastıktan sonraki 8 saniye içinde YouTube’un `<`/`>` kısayolunu
  kullanmak sessizce eski hıza dönüyordu. Tüketmediğimiz her tuş basışı artık
  kullanıcı jesti sayılıyor. Fare menüsüyle yapılan değişiklikler zaten
  doğru çalışıyordu; sessiz sıfırlamalara karşı koruma da korunuyor.

  Not: eşleştirme `event.code` ile yapıldığı için klavye düzeninden bağımsızdır.
  Türkçe Mac’te `Shift+ö` ve `Shift+ç`, US düzenindeki `Shift+,` ve `Shift+.`
  ile aynı kodları üretir; kare adımlama aynı fiziksel tuşlara atanmış olsa bile
  modifier eşleşmesi birebir olduğu için çakışma olmaz.

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
