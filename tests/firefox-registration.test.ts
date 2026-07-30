import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  executeScript: vi.fn(),
  getRegisteredContentScripts: vi.fn(),
  permissionsContains: vi.fn(),
  sendMessage: vi.fn(),
  tabsQuery: vi.fn(),
  unregisterContentScripts: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    permissions: {
      contains: api.permissionsContains,
    },
    runtime: {
      getManifest: () => ({ manifest_version: 2 }),
    },
    scripting: {
      getRegisteredContentScripts: api.getRegisteredContentScripts,
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
  api.tabsQuery.mockResolvedValue([]);
  api.unregisterContentScripts.mockResolvedValue(undefined);
});

describe('Firefox universal content-script registration', () => {
  it('uses the manifest registration and injects the current tab immediately', async () => {
    api.permissionsContains.mockImplementation(async ({ origins }: { origins: string[] }) => (
      origins[0] === 'https://*/*'
    ));
    const { registerUniversalScript } = await import('../lib/universal-registration');
    await registerUniversalScript(7);

    expect(api.executeScript).toHaveBeenCalledWith(7, expect.objectContaining({
      file: '/universal.js',
      allFrames: true,
    }));
  });

  it('reports the static Firefox manifest script as registered', async () => {
    const { isUniversalScriptRegistered } = await import('../lib/universal-registration');
    await expect(isUniversalScriptRegistered()).resolves.toBe(true);
    expect(api.getRegisteredContentScripts).not.toHaveBeenCalled();
  });
});
