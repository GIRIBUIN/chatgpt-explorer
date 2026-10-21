import { it, expect, vi, afterEach } from 'vitest';
import { DropboxAuth, DROPBOX_SCOPES, DROPBOX_TOKEN_KEY, DROPBOX_PENDING_KEY, dropboxPkce, dropboxCode, dropboxMessage, DropboxReconnectError } from '../src/sync/dropbox-auth';
import { t } from '../src/i18n';
import { encode } from '../src/sync/crypto';
import { manifestFor } from '../scripts/manifest';
import { readFileSync } from 'node:fs';
afterEach(() => vi.unstubAllGlobals());
function fixture(target = 'chromium') {
  const data: Record<string, unknown> = {};
  const redirect = target === 'chromium' ? 'https://extension.chromiumapp.org/dropbox' : 'https://extension.extensions.allizom.org/dropbox';
  const launch = vi.fn(async ({ url, interactive }: { url: string; interactive: boolean }) => {
    expect(interactive).toBe(true); const u = new URL(url);
    return `${redirect}?code=authorization-code&state=${u.searchParams.get('state')}`;
  });
  const api = { identity: { getRedirectURL: vi.fn(() => redirect), launchWebAuthFlow: launch },
    storage: { local: { get: vi.fn(async () => structuredClone(data)), set: vi.fn(async (v: object) => { Object.assign(data, structuredClone(v)); }),
      remove: vi.fn(async (keys: string | string[]) => { for (const k of typeof keys === 'string' ? [keys] : keys) delete data[k]; }) } } };
  vi.stubGlobal('browser', target === 'chromium' ? undefined : api); vi.stubGlobal('chrome', api);
  const fetcher = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
    const p = new URLSearchParams(String(options?.body));
    if (String(_input).endsWith('/revoke')) return new Response('');
    return Response.json({ access_token: p.get('grant_type') === 'refresh_token' ? 'refreshed-access' : 'access',
      token_type: 'bearer', expires_in: 14400, scope: DROPBOX_SCOPES.join(' '),
      ...(p.get('grant_type') === 'authorization_code' ? { refresh_token: 'refresh' } : {}) });
  });
  const auth = new DropboxAuth('common-app-key', fetcher);
  return { auth, fetcher, data, api, launch, redirect };
}
it('PKCE uses random 256-bit verifier and SHA256 S256 challenge', async () => {
  const a = await dropboxPkce(), b = await dropboxPkce();
  expect(a.verifier).toMatch(/^[\w-]{43}$/); expect(a.verifier).not.toBe(b.verifier);
  expect(a.challenge).toBe(encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(a.verifier)))));
});
it.each(['chromium', 'firefox', 'zen'])('%s uses the same code/PKCE/offline flow and common client ID', async target => {
  const f = fixture(target); await f.auth.connect();
  const u = new URL(f.launch.mock.calls[0][0].url), p = new URLSearchParams(f.fetcher.mock.calls[0][1]!.body as string);
  expect(u.searchParams.get('client_id')).toBe('common-app-key'); expect(u.searchParams.get('response_type')).toBe('code');
  expect(u.searchParams.get('token_access_type')).toBe('offline'); expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  expect(u.searchParams.get('scope')!.split(' ')).toEqual(DROPBOX_SCOPES);
  expect(p.get('grant_type')).toBe('authorization_code'); expect(p.get('client_id')).toBe('common-app-key');
  expect(p.get('code_verifier')).toHaveLength(43); expect(p.get('redirect_uri')).toBe(f.redirect);
  expect(p.has('client_secret')).toBe(false); expect(f.api.identity.getRedirectURL).toHaveBeenCalledWith('dropbox');
});
it('connect persists refresh/access credentials locally with an expiry', async () => {
  const f = fixture(); await f.auth.connect();
  expect(f.data[DROPBOX_TOKEN_KEY]).toMatchObject({ accessToken: 'access', refreshToken: 'refresh', clientId: 'common-app-key' });
  expect((f.data[DROPBOX_TOKEN_KEY] as { expiresAt: number }).expiresAt).toBeGreaterThan(Date.now());
});
it('valid access token needs no OAuth request or interactive flow', async () => {
  const f = fixture(); await f.auth.connect(); f.fetcher.mockClear(); f.launch.mockClear();
  expect(await f.auth.token()).toBe('access'); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.launch).not.toHaveBeenCalled();
});
it('expired token silently refreshes without a secret and retains the refresh token', async () => {
  const f = fixture(); await f.auth.connect(); await f.auth.invalidate('access'); f.fetcher.mockClear(); f.launch.mockClear();
  expect(await f.auth.token()).toBe('refreshed-access');
  const p = new URLSearchParams(f.fetcher.mock.calls[0][1]!.body as string);
  expect([...p.keys()].sort()).toEqual(['client_id', 'grant_type', 'refresh_token']);
  expect((f.data[DROPBOX_TOKEN_KEY] as { refreshToken: string }).refreshToken).toBe('refresh'); expect(f.launch).not.toHaveBeenCalled();
});
it('refresh is single-flight within one auth instance', async () => {
  const f = fixture(); await f.auth.connect(); await f.auth.invalidate('access'); f.fetcher.mockClear();
  await Promise.all([f.auth.token(), f.auth.token(), f.auth.token()]); expect(f.fetcher).toHaveBeenCalledTimes(1);
});
it('access token within the expiry margin refreshes silently', async () => {
  const f = fixture(); await f.auth.connect();
  (f.data[DROPBOX_TOKEN_KEY] as { expiresAt: number }).expiresAt = Date.now() + 30000;
  f.fetcher.mockClear(); f.launch.mockClear(); expect(await f.auth.token()).toBe('refreshed-access');
  expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.launch).not.toHaveBeenCalled();
});
it('missing app key rejects Connect before any browser/network action', async () => {
  const f = fixture(); await expect(new DropboxAuth('', f.fetcher).connect()).rejects.toThrow('not configured');
  expect(f.launch).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
});
it('expired refresh failure requires reconnect without invoking interactive login', async () => {
  const f = fixture(); await f.auth.connect(); await f.auth.invalidate('access'); f.launch.mockClear();
  f.fetcher.mockResolvedValueOnce(new Response('sensitive-error-body', { status: 400 }));
  await expect(f.auth.token()).rejects.toThrow('Reconnect Dropbox'); expect(f.launch).not.toHaveBeenCalled();
  expect((f.data[DROPBOX_TOKEN_KEY] as { refreshToken: string }).refreshToken).toBe('refresh');
});
it('missing tokens never start interactive background auth', async () => {
  const f = fixture(); await expect(f.auth.token()).rejects.toThrow('Reconnect'); expect(f.launch).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
});
it('user cancellation is sanitized and preserves prior local credentials', async () => {
  const f = fixture(); await f.auth.connect(); const before = structuredClone(f.data);
  f.launch.mockRejectedValueOnce(Error('secret-detail')); await expect(f.auth.connect()).rejects.toThrow('cancelled'); expect(f.data).toEqual(before);
});
it.each(['https://evil.test/dropbox?code=x&state=s', 'https://extension.chromiumapp.org/wrong?code=x&state=s',
  'https://extension.chromiumapp.org/dropbox?code=x&state=wrong', 'https://extension.chromiumapp.org/dropbox?code=x&state=s&state=s', 'invalid-secret'])('invalid callback rejected: %s', callback => {
  expect(() => dropboxCode(callback, 'https://extension.chromiumapp.org/dropbox', 's')).toThrow('Invalid Dropbox');
});
it('authorization denial rejects before token exchange', async () => {
  const f = fixture(); f.launch.mockImplementationOnce(async ({ url }) => `${f.redirect}?error=access_denied&state=${new URL(url).searchParams.get('state')}`);
  await expect(f.auth.connect()).rejects.toThrow('cancelled'); expect(f.fetcher).not.toHaveBeenCalled();
});
it('malformed token response leaves existing tokens unchanged and never leaks response text', async () => {
  const f = fixture(); await f.auth.connect(); const before = structuredClone(f.data);
  f.fetcher.mockResolvedValueOnce(new Response('secret-refresh-not-json'));
  await expect(f.auth.connect()).rejects.toThrow('Reconnect Dropbox'); expect(f.data).toEqual(before);
});
it('unexpected or missing scopes are rejected', async () => {
  const f = fixture(); f.fetcher.mockResolvedValueOnce(Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 1000, token_type: 'bearer', scope: 'account_info.read' }));
  await expect(f.auth.connect()).rejects.toThrow('Reconnect'); expect(f.data[DROPBOX_TOKEN_KEY]).toBeUndefined();
});
it('Disconnect removes OAuth tokens but preserves the local pending key before best-effort revoke', async () => {
  const f = fixture(); await f.auth.connect(); f.data[DROPBOX_PENDING_KEY] = 'key';
  f.fetcher.mockImplementationOnce(async () => { expect(f.data[DROPBOX_TOKEN_KEY]).toBeUndefined(); return new Response(''); });
  await f.auth.disconnect(); expect(f.data[DROPBOX_TOKEN_KEY]).toBeUndefined(); expect(f.data[DROPBOX_PENDING_KEY]).toBe('key');
  expect(String(f.fetcher.mock.calls.at(-1)![0])).toContain('/2/auth/token/revoke');
});
it('revoke/network failure cannot prevent local Disconnect', async () => {
  const f = fixture(); await f.auth.connect(); f.fetcher.mockRejectedValueOnce(Error('offline-token'));
  await expect(f.auth.disconnect()).resolves.toBeUndefined(); expect(f.data[DROPBOX_TOKEN_KEY]).toBeUndefined();
});
it.each(['chromium', 'firefox'] as const)('%s Dropbox manifest uses narrow hosts and identity, not native Google OAuth', target => {
  const m = manifestFor(target, '', false, '', '', true);
  expect(m.permissions).toContain('identity'); expect(m.host_permissions).toContain('https://api.dropboxapi.com/oauth2/token');
  expect(m.host_permissions).not.toContain('https://*/*'); expect(m).not.toHaveProperty('oauth2');
});
it('auth source contains no credential logging or app secret parameter', () => {
  const source = readFileSync(new URL('../src/sync/dropbox-auth.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/console\.|client_secret|app_secret/);
});
it.each([429, 503])('temporary token endpoint failure %s preserves tokens and does not demand new consent', async status => {
  const f = fixture(); await f.auth.connect(); await f.auth.invalidate('access');
  const before = structuredClone(f.data); f.launch.mockClear();
  f.fetcher.mockResolvedValueOnce(new Response('private server details', { status }));
  await expect(f.auth.token()).rejects.toThrow('temporarily unavailable');
  expect(f.data).toEqual(before); expect(f.launch).not.toHaveBeenCalled();
});
it('offline token refresh is a temporary error and never logs credentials', async () => {
  const f = fixture(); await f.auth.connect(); await f.auth.invalidate('access');
  f.fetcher.mockRejectedValueOnce(Error('private refresh-token'));
  const log = vi.spyOn(console, 'log'), error = vi.spyOn(console, 'error');
  try {
    await expect(f.auth.token()).rejects.toThrow('temporarily unavailable');
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  } finally { log.mockRestore(); error.mockRestore(); }
});
it('disconnected failure copy says Connect rather than unavailable Reconnect/Sync now actions', () => {
  expect(dropboxMessage(new DropboxReconnectError(), false)).toBe('Could not connect Dropbox. Please connect again.');
  expect(dropboxMessage(new DropboxReconnectError(), true)).toBe('Reconnect Dropbox to continue syncing.');
});
it('Sync settings accurately disclose Full Dropbox permission and separate Sync Key protection', () => {
  expect(t('dropboxDisclosure')).toContain('Full Dropbox');
  expect(t('dropboxDisclosure')).toContain('/ChatGPT Chat Explorer');
  expect(t('dropboxDisclosure')).not.toContain('App Folder');
  expect(t('syncKeyWarning')).toContain('not stored in Dropbox');
  expect(t('syncKeyWarning')).toContain('lose it');
});

it.each(['chromium', 'firefox', 'zen'])('%s normal Connect keeps session reuse; Change account explicitly reauthenticates', async target => {
  const f = fixture(target); await f.auth.connect();
  expect(new URL(f.launch.mock.calls[0][0].url).searchParams.has('force_reauthentication')).toBe(false);
  await f.auth.connect({ changeAccount: true });
  const u = new URL(f.launch.mock.calls[1][0].url);
  expect(u.searchParams.get('force_reauthentication')).toBe('true');
  expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  expect(u.searchParams.get('token_access_type')).toBe('offline');
});
it('token account identity is stored locally without extra scopes and survives silent refresh', async () => {
  const f = fixture(); f.fetcher.mockResolvedValueOnce(Response.json({ access_token: 'access', refresh_token: 'refresh',
    expires_in: 14400, token_type: 'bearer', scope: DROPBOX_SCOPES.join(' '), account_id: 'dbid:synthetic-account' }));
  await f.auth.connect();
  expect(f.data.explorerDropboxAccount).toBe('dbid:synthetic-account');
  await f.auth.invalidate('access'); await f.auth.token();
  expect(f.data[DROPBOX_TOKEN_KEY]).toMatchObject({ accountId: 'dbid:synthetic-account' });
});
