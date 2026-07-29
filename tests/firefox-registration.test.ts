import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  contentRegister: vi.fn(),
  executeScript: vi.fn(),
  getRegisteredContentScripts: vi.fn(),
  permissionsContains: vi.fn(),
  registerContentScripts: vi.fn(),
  sendMessage: vi.fn(),
  tabsQuery: vi.fn(),
  unregisterContentScripts: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    contentScripts: {
      register: api.contentRegister,
    },
    permissions: {
      contains: api.permissionsContains,
    },
    runtime: {
      getManifest: () => ({ manifest_version: 2 }),
    },
    scripting: {
      getRegisteredContentScripts: api.getRegisteredContentScripts,
      registerContentScripts: api.registerContentScripts,
      unregisterContentScripts: api.unregisterContentScripts,
    },
    tabs: {
      executeScript: api.executeScript,
      query: api.tabsQuery,
      sendMessage: api.sendMessage,
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  api.executeScript.mockResolvedValue([]);
  api.getRegisteredContentScripts.mockResolvedValue([]);
  api.registerContentScripts.mockResolvedValue(undefined);
  api.tabsQuery.mockResolvedValue([]);
  api.unregisterContentScripts.mockResolvedValue(undefined);
});

describe('Firefox universal content-script registration', () => {
  it('registers only the host origins Firefox actually granted', async () => {
    api.permissionsContains.mockImplementation(async ({ origins }: { origins: string[] }) => (
      origins[0] === 'https://*/*'
    ));
    api.contentRegister.mockResolvedValue({ unregister: vi.fn() });

    const { registerUniversalScript } = await import('../lib/universal-registration');
    await registerUniversalScript(7);

    expect(api.contentRegister).toHaveBeenCalledWith(expect.objectContaining({
      matches: ['https://*/*'],
      js: [{ file: '/universal.js' }],
      allFrames: true,
    }));
    expect(api.executeScript).toHaveBeenCalledWith(7, expect.objectContaining({
      file: '/universal.js',
      allFrames: true,
    }));
  });

  it('falls back to scripting registration when the Firefox MV2 API rejects', async () => {
    api.permissionsContains.mockImplementation(async ({ origins }: { origins: string[] }) => (
      origins[0] === 'http://*/*' || origins[0] === 'https://*/*'
    ));
    api.contentRegister.mockRejectedValue(new Error('API unavailable'));

    const { registerUniversalScript } = await import('../lib/universal-registration');
    await registerUniversalScript();

    expect(api.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'playlist-zamani-universal',
        matches: ['http://*/*', 'https://*/*'],
        js: ['universal.js'],
        allFrames: true,
      }),
    ]);
  });
});
