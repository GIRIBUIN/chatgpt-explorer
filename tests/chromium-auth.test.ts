import { it, expect, vi, afterEach } from 'vitest';
import { chromiumGoogleAuth } from '../src/sync/google-auth-chromium';
import { googleAuth, connectGoogle } from '../src/sync/google-auth';
import { DRIVE_SCOPE } from '../src/sync/google-auth-common';
import { GoogleDriveProvider } from '../src/sync/google-drive';
import { manifestFor } from '../scripts/manifest';
import { AutoSync, type AutoState } from '../src/sync/auto';
import { SyncClient } from '../src/sync/client';
import { defaults } from '../src/models/state';
import { driveCredentials, newSyncKey } from '../src/sync/drive-key';
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const identity = { getAuthToken: vi.fn(async (details: { interactive: boolean; scopes: string[] }) => { void details; return { token: 'token', grantedScopes: [DRIVE_SCOPE] }; }),
    removeCachedAuthToken: vi.fn(async () => {}), clearAllCachedAuthTokens: vi.fn(async () => {}), launchWebAuthFlow: vi.fn() };
  const remove = vi.fn(async () => {});
  vi.stubGlobal('chrome', { identity, runtime: { getManifest: () => ({ oauth2: { client_id: 'client' } }) }, storage: { local: { remove } } });
  vi.stubGlobal('browser', undefined); vi.stubGlobal('__BROWSER_TARGET__', 'chromium');
  return { identity, remove, auth: chromiumGoogleAuth('client') };
}
it('explicit Chromium connect uses interactive identity, never fetch or web flow', async () => { const { identity } = setup(), fetcher = vi.fn(); await connectGoogle('client', fetcher); expect(identity.getAuthToken).toHaveBeenCalledExactlyOnceWith({ interactive: true, scopes: [DRIVE_SCOPE] }); expect(fetcher).not.toHaveBeenCalled(); expect(identity.launchWebAuthFlow).not.toHaveBeenCalled(); });
it('background token always requests non-interactive identity', async () => { const { auth, identity } = setup(); expect(await auth.token()).toBe('token'); expect(identity.getAuthToken).toHaveBeenCalledExactlyOnceWith({ interactive: false, scopes: [DRIVE_SCOPE] }); });
it('cancelled interactive authorization gives sanitized error', async () => { const { auth, identity } = setup(); identity.getAuthToken.mockRejectedValueOnce(Error('private detail')); await expect(auth.connect()).rejects.toThrow('cancelled'); });
it('missing token requires reconnect', async () => { const { auth, identity } = setup(); identity.getAuthToken.mockResolvedValueOnce({ token: '', grantedScopes: [] }); await expect(auth.token()).rejects.toThrow('Reconnect'); });
it('denied scope requires reconnect', async () => { const { auth, identity } = setup(); identity.getAuthToken.mockResolvedValueOnce({ token: 't', grantedScopes: [] }); await expect(auth.token()).rejects.toThrow('Reconnect'); });
it('wrong build client fails before token request', async () => { const { identity } = setup(); await expect(chromiumGoogleAuth('other').token()).rejects.toThrow('Reconnect'); expect(identity.getAuthToken).not.toHaveBeenCalled(); });
it('disconnect clears Chrome cache and local token/draft only', async () => { const { auth, identity, remove } = setup(); await auth.disconnect(); expect(identity.clearAllCachedAuthTokens).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledExactlyOnceWith(['explorerGoogleToken', 'explorerDrivePendingKey']); });
it('401 removes failed token and reacquires once without UI', async () => {
  const { auth, identity } = setup(); identity.getAuthToken.mockResolvedValueOnce({ token: 'old', grantedScopes: [DRIVE_SCOPE] }).mockResolvedValueOnce({ token: 'new', grantedScopes: [DRIVE_SCOPE] });
  const fetcher = vi.fn(async () => new Response('', { status: 401 })).mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(Response.json({ items: [] }));
  const p = new GoogleDriveProvider(auth.token, fetcher, auth.invalidate); expect(await p.discover()).toBeNull();
  expect(identity.removeCachedAuthToken).toHaveBeenCalledExactlyOnceWith({ token: 'old' }); expect(identity.getAuthToken).toHaveBeenCalledTimes(2);
  expect(identity.getAuthToken.mock.calls.every(([d]) => d.interactive === false)).toBe(true); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('repeated 401 stops after one retry and invalidates both rejected tokens', async () => { const { auth, identity } = setup(); const fetcher = vi.fn(async () => new Response('', { status: 401 })); await expect(new GoogleDriveProvider(auth.token, fetcher, auth.invalidate).discover()).rejects.toThrow('Reconnect'); expect(fetcher).toHaveBeenCalledTimes(2); expect(identity.getAuthToken).toHaveBeenCalledTimes(2); expect(identity.removeCachedAuthToken).toHaveBeenCalledTimes(2); });
it('failed noninteractive reacquisition makes no second request', async () => { const { auth, identity } = setup(); identity.getAuthToken.mockRejectedValueOnce(Error('signed out')); const fetcher = vi.fn(); await expect(new GoogleDriveProvider(auth.token, fetcher, auth.invalidate).discover()).rejects.toThrow('Reconnect'); expect(fetcher).not.toHaveBeenCalled(); });
it('401 followed by failed reacquisition never retries HTTP or opens UI', async () => { const { auth, identity } = setup(); identity.getAuthToken.mockRejectedValueOnce(Error('initial failure')); identity.getAuthToken.mockReset().mockResolvedValueOnce({ token: 'old', grantedScopes: [DRIVE_SCOPE] }).mockRejectedValueOnce(Error('reauth needed')); const fetcher = vi.fn(async () => new Response('', { status: 401 })); await expect(new GoogleDriveProvider(auth.token, fetcher, auth.invalidate).discover()).rejects.toThrow('Reconnect'); expect(fetcher).toHaveBeenCalledOnce(); expect(identity.getAuthToken.mock.calls.every(([d]) => !d.interactive)).toBe(true); });
it('missing Chromium token keeps auto-sync dirty, workspace and baseline intact', async () => {
  const { auth, identity } = setup(); identity.getAuthToken.mockRejectedValue(Error('signed out'));
  const local = { state: defaults(), sync: { ...await driveCredentials(newSyncKey()), lastSyncedRevision: 1, lastSyncedRemoteVersion: 'v1', lastSyncedPayloadHash: 'old', lastSyncedAt: 1 } };
  const before = structuredClone(local), writes = vi.fn(), fetcher = vi.fn(); let saved: AutoState | undefined;
  const client = new SyncClient(new GoogleDriveProvider(auth.token, fetcher, auth.invalidate), { read: async () => local, transaction: writes });
  const auto = new AutoSync({ local: async () => local, read: async () => saved, write: async s => { saved = s; }, schedule: async () => {}, now: () => 1000, sync: dirty => client.now(dirty), result: async () => {} });
  await auto.close(); expect(saved?.dirty).toBe(true); expect(local).toEqual(before); expect(writes).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
it('unsupported Chromium identity does not fall back to PKCE', async () => { setup(); vi.stubGlobal('chrome', { identity: {} }); await expect(chromiumGoogleAuth('client').connect()).rejects.toThrow('does not support'); });
it('Chromium manifest has only appdata OAuth scope and no token host', () => { const m = manifestFor('chromium', '', true, 'dev-client'); expect('oauth2' in m && m.oauth2).toEqual({ client_id: 'dev-client', scopes: [DRIVE_SCOPE] }); expect(m.host_permissions).not.toContain('https://oauth2.googleapis.com/token'); expect(JSON.stringify(m)).not.toContain('client_secret'); });
it('Firefox manifest excludes Chromium oauth2 and key', () => { const m = manifestFor('firefox', '', true, 'firefox-client', 'public-key'); expect(m).not.toHaveProperty('oauth2'); expect(m).not.toHaveProperty('key'); expect(m.host_permissions).toContain('https://oauth2.googleapis.com/token'); });
it('public key is optional and dev/prod client interchangeable', () => { expect(manifestFor('chromium', '', true, 'prod-client', 'public-key')).toHaveProperty('key', 'public-key'); expect(manifestFor('chromium', '', true)).not.toHaveProperty('oauth2'); });
it('Firefox target retains its stored-token adapter, not Chrome identity', async () => { const { identity } = setup(); vi.stubGlobal('__BROWSER_TARGET__', 'firefox'); vi.stubGlobal('browser', { storage: { local: { get: async () => ({ explorerGoogleToken: { clientId: 'client', accessToken: 'firefox-token', expiresAt: Date.now() + 3600000 } }) } } }); expect(await googleAuth('client').token()).toBe('firefox-token'); expect(identity.getAuthToken).not.toHaveBeenCalled(); });
