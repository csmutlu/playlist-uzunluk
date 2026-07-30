import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  vite: () => ({
    plugins: [preact()],
  }),
  manifest: ({ browser }) => ({
    default_locale: 'en',
    name: '__MSG_extensionName__',
    short_name: '__MSG_extensionShortName__',
    description: '__MSG_extensionDescription__',
    version: '1.6.8',
    ...(browser === 'firefox'
      ? {
          optional_permissions: [
            'downloads',
            'https://www.googleapis.com/*',
          ],
          web_accessible_resources: ['universal-main.js'],
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
          optional_host_permissions: [
            'https://www.googleapis.com/*',
            'http://*/*',
            'https://*/*',
            'file:///*',
          ],
          optional_permissions: ['downloads'],
          web_accessible_resources: [
            {
              resources: ['universal-main.js'],
              matches: ['http://*/*', 'https://*/*', 'file:///*'],
            },
          ],
        }),
    permissions: [
      'storage',
      'scripting',
      ...(browser === 'firefox' ? ['http://*/*', 'https://*/*', 'file:///*'] : []),
    ],
    ...(browser === 'firefox'
      ? {
          content_scripts: [{
            matches: ['http://*/*', 'https://*/*', 'file:///*'],
            js: ['universal.js'],
            run_at: 'document_start',
            all_frames: true,
          }],
        }
      : {}),
    icons: {
      16: 'icon-16.png',
      32: 'icon-32.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
    action: {
      default_title: '__MSG_extensionName__',
    },
  }),
});
