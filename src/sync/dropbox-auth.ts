import { webext } from '../utils/browser';
import { encode } from './crypto';

export const DROPBOX_ORIGIN = 'https://api.dropboxapi.com';
export const DROPBOX_SCOPES = ['files.metadata.read', 'files.content.read', 'files.content.write'];
export const DROPBOX_TOKEN_KEY = 'explorerDropboxToken';
export const DROPBOX_PENDING_KEY = 'explorerDropboxPendingKey';
export const DROPBOX_ACCOUNT_KEY = 'explorerDropboxAccount';
type Token = { clientId: string; accessToken: string; refreshToken: string; expiresAt: number; accountId?: string };
export class DropboxReconnectError extends Error {
  readonly syncRecovery = 'reconnect';
  constructor() { super('Reconnect Dropbox to continue syncing.'); }
}
export class DropboxUnavailableError extends Error {
  readonly syncRecovery = 'temporary';
  constructor() { super('Dropbox is temporarily unavailable. Your local changes are safe. Try again later.'); }
}
/** Only controlled messages reach Settings; never expose OAuth responses or tokens. */
export function dropboxMessage(error: unknown, connected: boolean): string {
  if (error instanceof DropboxReconnectError && !connected)
    return 'Could not connect Dropbox. Please connect again.';
  if (error instanceof Error) return error.message;
  return 'Could not sync with Dropbox. Your local changes are safe.';
}
export async function limitedJson(response: Response, limit: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw Error('Invalid response.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw Error('Response too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function dropboxPkce() {
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}
export function dropboxCode(callback: string, redirect: string, state: string) {
  try {
  const u = new URL(callback), expected = new URL(redirect);
  if (u.origin !== expected.origin || u.pathname !== expected.pathname || u.hash ||
      u.searchParams.getAll('state').length !== 1 || u.searchParams.get('state') !== state)
    throw Error('Invalid Dropbox authorization redirect.');
  if (u.searchParams.has('error')) throw Error('Dropbox authorization was cancelled or denied.');
  if (u.searchParams.getAll('code').length !== 1 || !u.searchParams.get('code'))
    throw Error('Invalid Dropbox authorization response.');
  return u.searchParams.get('code')!;
  } catch (error) {
    if (error instanceof Error && error.message === 'Dropbox authorization was cancelled or denied.') throw error;
    throw Error('Invalid Dropbox authorization redirect.');
  }
}
const validText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 16384;
export class DropboxAuth {
  private refreshing: Promise<string> | null = null;
  constructor(private clientId: string, private fetcher: typeof fetch = (i, o) => fetch(i, o)) {}
  private async exchange(params: Record<string, string>, previous?: Token): Promise<Token> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await this.fetcher(`${DROPBOX_ORIGIN}/oauth2/token`, { method: 'POST', credentials: 'omit',
        redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.clientId, ...params }).toString() });
      if (!r.ok) {
        await r.body?.cancel();
        if (r.status === 429 || r.status >= 500) throw new DropboxUnavailableError();
        throw new DropboxReconnectError();
      }
      let data: Record<string, unknown>;
      try { data = await limitedJson(r, 32768) as Record<string, unknown>; }
      catch { throw new DropboxReconnectError(); }
      const refresh = data.refresh_token ?? previous?.refreshToken;
      const scopes = typeof data.scope === 'string' ? data.scope.split(' ').filter(Boolean) : null;
      if (!validText(data.access_token) || !validText(refresh) ||
          data.token_type?.toString().toLowerCase() !== 'bearer' ||
          !Number.isSafeInteger(data.expires_in) || Number(data.expires_in) <= 0 || Number(data.expires_in) > 86400 ||
          (!previous && !scopes) || scopes && (DROPBOX_SCOPES.some(s => !scopes.includes(s)) || scopes.some(s => !DROPBOX_SCOPES.includes(s))))
        throw new DropboxReconnectError();
      return { clientId: this.clientId, accessToken: data.access_token, refreshToken: refresh,
        ...(validText(data.account_id) ? { accountId: data.account_id } : previous?.accountId ? { accountId: previous.accountId } : {}),
        expiresAt: Date.now() + Number(data.expires_in) * 1000 };
    } catch (error) {
      if (error instanceof DropboxReconnectError || error instanceof DropboxUnavailableError) throw error;
      throw new DropboxUnavailableError();
    }
    finally { clearTimeout(timer); }
  }
  /** Only an explicit Connect/Reconnect action calls this interactive method. */
  async connect(options: { changeAccount?: boolean; beforeSave?: (accountId?: string) => Promise<void> } = {}) {
    if (!this.clientId) throw Error('Dropbox app key is not configured in this build.');
    const api = webext(), redirect = api.identity.getRedirectURL('dropbox');
    const { verifier, challenge } = await dropboxPkce(), state = encode(crypto.getRandomValues(new Uint8Array(32)));
    const url = new URL('https://www.dropbox.com/oauth2/authorize');
    url.search = new URLSearchParams({ client_id: this.clientId, redirect_uri: redirect, response_type: 'code',
      code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline',
      scope: DROPBOX_SCOPES.join(' '), state }).toString();
    if (options.changeAccount) url.searchParams.set('force_reauthentication', 'true');
    let callback: string | undefined;
    try { callback = await api.identity.launchWebAuthFlow({ url: url.href, interactive: true }); }
    catch { throw Error('Dropbox authorization was cancelled or denied.'); }
    if (!callback) throw Error('Dropbox authorization was cancelled or denied.');
    const code = dropboxCode(callback, redirect, state);
    await this.lock(async () => {
      const token = await this.exchange({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect });
      await options.beforeSave?.(token.accountId);
      await api.storage.local.set({ [DROPBOX_TOKEN_KEY]: token });
      if (token.accountId) await api.storage.local.set({ [DROPBOX_ACCOUNT_KEY]: token.accountId });
      else await api.storage.local.remove(DROPBOX_ACCOUNT_KEY);
    });
  }
  private async lock<T>(work: () => Promise<T>): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.locks)
      return await navigator.locks.request('explorer-dropbox-token', work);
    return work();
  }
  token(): Promise<string> {
    if (this.refreshing) return this.refreshing;
    const task = this.lock(async () => {
      const t = (await webext().storage.local.get(DROPBOX_TOKEN_KEY))[DROPBOX_TOKEN_KEY] as Token | undefined;
      if (!this.clientId || !t || t.clientId !== this.clientId || !validText(t.refreshToken) ||
          !validText(t.accessToken) || !Number.isFinite(t.expiresAt)) throw new DropboxReconnectError();
      if (t.expiresAt > Date.now() + 60000) return t.accessToken;
      const updated = await this.exchange({ grant_type: 'refresh_token', refresh_token: t.refreshToken }, t);
      await webext().storage.local.set({ [DROPBOX_TOKEN_KEY]: updated });
      return updated.accessToken;
    });
    this.refreshing = task;
    void task.finally(() => { if (this.refreshing === task) this.refreshing = null; }).catch(() => {});
    return task;
  }
  async invalidate(rejected: string) {
    await this.lock(async () => {
      const t = (await webext().storage.local.get(DROPBOX_TOKEN_KEY))[DROPBOX_TOKEN_KEY] as Token | undefined;
      if (t?.clientId === this.clientId && t.accessToken === rejected)
        await webext().storage.local.set({ [DROPBOX_TOKEN_KEY]: { ...t, expiresAt: 0 } });
    });
  }
  async disconnect() {
    await this.lock(async () => {
      const t = (await webext().storage.local.get(DROPBOX_TOKEN_KEY))[DROPBOX_TOKEN_KEY] as Token | undefined;
      // Local disconnect must succeed even offline. Never refresh just to revoke.
      await webext().storage.local.remove(DROPBOX_TOKEN_KEY);
      if (!validText(t?.accessToken)) return;
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
      try {
        const r = await this.fetcher(`${DROPBOX_ORIGIN}/2/auth/token/revoke`, { method: 'POST', credentials: 'omit',
          redirect: 'error', signal: controller.signal, headers: { Authorization: `Bearer ${t.accessToken}` } });
        await r.body?.cancel();
      } catch { /* Best effort; never restore removed credentials. */ }
      finally { clearTimeout(timer); }
    });
  }
}
