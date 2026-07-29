# Playlist Zamanı Gizlilik Açıklaması

Son güncelleme: 30 Temmuz 2026

Playlist Zamanı analitik, telemetri, reklam veya kullanıcı hesabı içermez. Veriler geliştiriciye ya da üçüncü taraf bir sunucuya gönderilmez.

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

Bu özellik varsayılan olarak kapalıdır. Kullanıcı popup içinden etkinleştirdiğinde
tarayıcı `http` ve `https` siteleri için isteğe bağlı izin ister. Eklenti sayfadaki
HTML5 video ve ses öğelerini yalnızca yerel olarak denetler; medya içeriğini okumaz,
indirmez veya başka bir sunucuya göndermez. İzin popup içinden kapatıldığında
dinamik içerik betikleri ve geniş site izni kaldırılır.

Manifestteki isteğe bağlı `file:///*` izni yalnızca kullanıcının tarayıcı eklenti
ayrıntılarında yerel dosya erişimini ayrıca açması halinde yerel video/ses
dosyalarını kontrol etmek için kullanılır.

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
- `scripting`: Kullanıcı izin verdiğinde küçük evrensel hız denetleyicisini kaydetmek veya kaldırmak
- `youtube.com`: Playlist süresini okuyup YouTube üzerinde kullanıcı arayüzü göstermek
- İsteğe bağlı `http://*/*` ve `https://*/*`: Evrensel hız kontrolünü kullanıcının seçtiği sitelerde çalıştırmak
- İsteğe bağlı `file:///*`: Kullanıcı ayrıca izin verdiğinde yerel video ve ses dosyalarını kontrol etmek
- İsteğe bağlı `downloads`: Kullanıcı istediğinde doğrudan sunulan medya dosyasını tarayıcının indirme yöneticisine kaydetmek
- İsteğe bağlı `googleapis.com`: Kullanıcı talep ettiğinde public playlisti API ile tamamlamak
