# VideoExpert Gizlilik Açıklaması

Son güncelleme: 2 Ağustos 2026

VideoExpert analitik, telemetri, reklam veya kullanıcı hesabı içermez. Veriler
geliştiriciye ya da üçüncü taraf bir sunucuya gönderilmez.

## Yerel olarak işlenen veriler

Eklenti aşağıdaki verileri yalnızca tarayıcıda işler:

- YouTube playlist kimliği, video kimlikleri, başlıkları ve süreleri
- İzlenmiş/izlenmemiş durumu, son oynatma konumu ve son açılan playlist özetleri
- Dil, tema, hız ve görünüm ayarları
- Evrensel hız kontrolü açıldığında site alan adı, siteye özel hız kuralı ve son kullanılan hız
- İsteğe bağlı YouTube Data API anahtarı

Ayarlar Chrome senkronizasyon alanında saklanabilir. Playlist ilerlemesi, en fazla
20 son playlistin küçük özeti, en fazla 200 siteye ait alan adı/hız kaydı, API anahtarı
ve önbellek yalnızca cihazdaki yerel uzantı depolamasında tutulur. Tam sayfa adresi,
sayfa başlığı veya site izleme geçmişi saklanmaz. API anahtarı senkronize edilmez
ve ilerleme dışa aktarımına eklenmez.

## Evrensel hız kontrolü

Bu özellik varsayılan olarak kapalıdır. Chromium paketinde kullanıcı popup içinden
etkinleştirdiğinde tarayıcı `http` ve `https` siteleri için isteğe bağlı izin ister.
Firefox/Zen geçici MV2 paketinde aynı erişim kurulum sırasında verilir; bu, Gecko’da
etkinleştirme durumunun F5 sonrasında güvenilir kalmasını sağlar. Eklenti sayfadaki
HTML5 video ve ses öğelerini yalnızca yerel olarak denetler; medya içeriğini okumaz,
indirmez veya başka bir sunucuya göndermez. Özellik popup içinden kapatıldığında
Chromium dinamik içerik betiğini ve isteğe bağlı erişimi kaldırır; Firefox/Zen ise
manifest iznini koruyup denetleyiciyi durdurur.

Chromium manifestindeki isteğe bağlı `file:///*` izni yalnızca kullanıcının tarayıcı
eklenti ayrıntılarında yerel dosya erişimini ayrıca açması halinde kullanılır.
Firefox/Zen paketinde bu izin Gecko uyumluluğu için kurulum izinleri arasındadır;
evrensel denetleyici kapalıyken yerel dosyalarda da çalışmaz.

## Audio Master ve sekme sesi

Chromium paketinde `activeTab`, `tabCapture`, `offscreen` ve `tabs` izinleri,
kullanıcı popup’taki ses, bas veya konuşma netliği kontrolünü değiştirdiğinde aktif
sekmenin ses akışını tarayıcı içinde işlemek ve ses çalan sekmeleri listelemek için
kullanılır. Ses kaydedilmez, kalıcı depolamaya yazılmaz, ağ üzerinden gönderilmez
ve eklenti dışına aktarılmaz. İşleme yalnızca tarayıcının yerel Web Audio motorunda
yapılır. Firefox/Zen paketinde tam sekme yakalama yerine desteklenen sayfa medya
öğesi yine yalnızca yerel Web Audio ile işlenir.

## Doğrudan medya indirme

Kullanıcı **Doğrudan medyayı indir** düğmesine bastığında eklenti yalnızca
oynatıcının zaten sunduğu doğrudan `http/https` medya adresini tarayıcının yerel
indirme yöneticisine iletir. `downloads` izni ilk kullanımda ayrıca istenir.
Adres geliştiriciye veya üçüncü taraf bir analiz sunucusuna gönderilmez. DRM,
`blob:`, HLS ve DASH korumaları aşılmaz veya birleştirilmez.

## YouTube Data API

Kullanıcı ayarlardan bir API anahtarı girip Google API alanı için isteğe bağlı izin verdiğinde, public playlist bilgileri doğrudan `www.googleapis.com/youtube/v3` adresine gönderilen taleplerle alınır. Bu talepler Google’ın gizlilik koşullarına tabidir. Özellik tamamen isteğe bağlıdır; anahtar olmadan eklenti YouTube sayfasındaki yerel verilerle çalışır.

## Veri paylaşımı

Eklenti verileri satmaz, reklam amacıyla kullanmaz ve geliştirici dahil hiçbir insanın erişebileceği bir sunucuya yüklemez.

## Veri silme

Popup içindeki **İlerlemeyi sil** düğmesiyle playlist ilerlemesi ve son playlist
listesi temizlenebilir. API anahtarı alanı boş kaydedilerek anahtar silinebilir.
Uzantının kaldırılması Chrome’un uzantıya ait yerel verileri kaldırmasını sağlar.

## İzinlerin amacı

- `storage`: Ayarlar, ilerleme ve önbellek
- `scripting`: Küçük evrensel hız denetleyicisini açık sekmeye uygulamak
- `tabs`: Ses çalan sekmeleri ve kullanıcı tarafından seçilen aktif sekmeyi göstermek
- Chromium’da `activeTab`, `tabCapture`, `offscreen`: Kullanıcının seçtiği aktif
  sekmenin sesini yerel olarak yükseltmek ve filtrelemek
- `youtube.com`: Playlist süresini okuyup YouTube üzerinde kullanıcı arayüzü göstermek
- Chromium’da isteğe bağlı, Firefox/Zen’de kurulum sırasında verilen `http://*/*`
  ve `https://*/*`: Evrensel hız kontrolünü kullanıcı açtığında çalıştırmak
- Chromium’da isteğe bağlı, Firefox/Zen’de kurulum sırasında verilen `file:///*`:
  Kullanıcı evrensel kontrolü açtığında yerel video ve ses dosyalarını kontrol etmek
- İsteğe bağlı `downloads`: Kullanıcı istediğinde doğrudan sunulan medya dosyasını tarayıcının indirme yöneticisine kaydetmek
- İsteğe bağlı `googleapis.com`: Kullanıcı talep ettiğinde public playlisti API ile tamamlamak
