# Playlist Zamanı Gizlilik Açıklaması

Son güncelleme: 28 Temmuz 2026

Playlist Zamanı analitik, telemetri, reklam veya kullanıcı hesabı içermez. Veriler geliştiriciye ya da üçüncü taraf bir sunucuya gönderilmez.

## Yerel olarak işlenen veriler

Eklenti aşağıdaki verileri yalnızca tarayıcıda işler:

- YouTube playlist kimliği, video kimlikleri, başlıkları ve süreleri
- İzlenmiş/izlenmemiş durumu ve son oynatma konumu
- Dil, tema, hız ve görünüm ayarları
- İsteğe bağlı YouTube Data API anahtarı

Ayarlar Chrome senkronizasyon alanında saklanabilir. Playlist ilerlemesi, API anahtarı ve önbellek yalnızca cihazdaki yerel uzantı depolamasında tutulur. API anahtarı senkronize edilmez ve ilerleme dışa aktarımına eklenmez.

## YouTube Data API

Kullanıcı ayarlardan bir API anahtarı girip Google API alanı için isteğe bağlı izin verdiğinde, public playlist bilgileri doğrudan `www.googleapis.com/youtube/v3` adresine gönderilen taleplerle alınır. Bu talepler Google’ın gizlilik koşullarına tabidir. Özellik tamamen isteğe bağlıdır; anahtar olmadan eklenti YouTube sayfasındaki yerel verilerle çalışır.

## Veri paylaşımı

Eklenti verileri satmaz, reklam amacıyla kullanmaz ve geliştirici dahil hiçbir insanın erişebileceği bir sunucuya yüklemez.

## Veri silme

Popup içindeki **İlerlemeyi sil** düğmesiyle playlist ilerlemesi temizlenebilir. API anahtarı alanı boş kaydedilerek anahtar silinebilir. Uzantının kaldırılması Chrome’un uzantıya ait yerel verileri kaldırmasını sağlar.

## İzinlerin amacı

- `storage`: Ayarlar, ilerleme ve önbellek
- `youtube.com`: Playlist süresini okuyup YouTube üzerinde kullanıcı arayüzü göstermek
- İsteğe bağlı `googleapis.com`: Kullanıcı talep ettiğinde public playlisti API ile tamamlamak
