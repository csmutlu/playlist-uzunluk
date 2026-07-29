# Playlist Zamanı

YouTube playlistlerinin toplam süresini, kalan izleme zamanını ve farklı oynatma hızlarındaki karşılığını doğrudan playlist sayfasında gösteren tarayıcı eklentisi.

![Playlist Zamanı playlist görünümü](docs/screenshots/playlist-overview.png)

## Özellikler

- Playlistin tamamını `1x`, `1.25x`, `1.5x`, `1.75x` ve `2x` hızlarda hesaplar.
- İzleme sayfasında mevcut videodaki konumu ve sonraki izlenmemiş videoları birlikte değerlendirir.
- Videoları %90 eşiğinde otomatik tamamlandı sayar; manuel seçimler otomatik durumdan önceliklidir.
- Başlangıç ve bitiş videosu seçerek belirli bir aralığın süresini hesaplar.
- Günlük çalışma süresi ve aktif günlere göre tahmini bitiş tarihi çıkarır.
- Oynatma hızını YouTube oynatıcısıyla çift yönlü eşitler.
- Otomatik dil algılama; Türkçe, İngilizce, İspanyolca, Fransızca, Arapça,
  Almanca, Portekizce, Rusça, Hintçe, Endonezce, Japonca, Korece ve Çince arayüz sunar.
- Arapçada RTL yerleşimini; tüm dillerde yerel süre, tarih, saat ve hafta günü biçimlerini kullanır.
- YouTube ile uyumlu açık/koyu tema sunar.
- Public playlistler için isteğe bağlı YouTube Data API desteği sağlar.

![Playlist Zamanı ayrıntılı görünüm](docs/screenshots/playlist-details.png)

## Kurulum

### Chrome, Brave, Edge ve Opera

1. Repoyu indirin ve bağımlılıkları kurun:

   ```bash
   npm install
   npm run build
   ```

2. Tarayıcının eklentiler sayfasını açın:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
   - Opera: `opera://extensions`
3. **Geliştirici modu**nu açın.
4. **Paketlenmemiş öğe yükle** seçeneğiyle `.output/chrome-mv3` klasörünü seçin.
5. Açık YouTube sekmelerini yenileyin.

Dağıtım ZIP’i:

```bash
npm run zip
```

### Zen Browser ve Firefox

1. Firefox paketini oluşturun:

   ```bash
   npm install
   npm run build:firefox
   ```

2. Zen veya Firefox’ta `about:debugging#/runtime/this-firefox` adresini açın.
3. **Geçici Eklenti Yükle** düğmesine basın.
4. `.output/firefox-mv2/manifest.json` dosyasını seçin.
5. Açık YouTube sekmelerini yenileyin.

Firefox ZIP’i `npm run zip:firefox` komutuyla oluşturulur. İmzalanmamış yerel kurulum tarayıcı yeniden başlatılana kadar geçerlidir; kalıcı dağıtım Mozilla imzası gerektirir.
