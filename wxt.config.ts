import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  vite: () => ({
    plugins: [preact()],
  }),
  manifest: ({ browser }) => ({
    name: 'Playlist Zamanı',
    short_name: 'Playlist Zamanı',
    description:
      'YouTube playlistlerinin toplam ve kalan süresini hızlara göre hesaplar, ilerlemeyi ve çalışma planını takip eder.',
    version: '1.0.0',
    ...(browser === 'firefox'
      ? {
          optional_permissions: ['https://www.googleapis.com/*'],
          browser_specific_settings: {
            gecko: {
              id: 'playlist-zamani@local',
              strict_min_version: '142.0',
              data_collection_permissions: {
                required: ['none'],
              },
            },
          },
        }
      : {
          minimum_chrome_version: '114',
          optional_host_permissions: ['https://www.googleapis.com/*'],
        }),
    permissions: ['storage'],
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
    action: {
      default_title: 'Playlist Zamanı',
    },
  }),
});
