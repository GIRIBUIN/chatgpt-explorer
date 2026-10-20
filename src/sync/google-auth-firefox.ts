import { webext } from '../utils/browser';
import { encode } from './crypto';

import { DRIVE_SCOPE, GOOGLE_TOKEN_KEY, DRIVE_PENDING_KEY, ReconnectError } from './google-auth-common';
type Token = { accessToken: string; expiresAt: number; clientId: string };
export async function pkce() {
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}
export function authCode(callback: string, redirect: string, state: string) {
  const url = new URL(callback), expected = new URL(redirect);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.hash ||
      url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state)
    throw Error('Invalid Google authorization redirect.');
  if (url.searchParams.has('error')) throw Error('Google authorization was cancelled or denied.');
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.getAll('code').length !== 1) throw Error('Invalid Google authorization response.');
  return code;
}
/** This is the only interactive entry point. Never called by a provider or coordinator. */
export async function connectGoogle(clientId: string, fetcher: typeof fetch = (i, o) => fetch(i, o)) {
  if (!clientId) throw Error('Google OAuth client is not configured in this build.');
  const api = webext(), redirect = api.identity.getRedirectURL('google');
  const { verifier, challenge } = await pkce();
  const state = encode(crypto.getRandomValues(new Uint8Array(32)));
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect,
    response_type: 'code', scope: DRIVE_SCOPE, state, code_challenge: challenge,
    code_challenge_method: 'S256', prompt: 'select_account' }).toString();
  let callback: string | undefined;
  try { callback = await api.identity.launchWebAuthFlow({ url: url.href, interactive: true }); }
  catch { throw Error('Google authorization was cancelled or denied.'); }
  if (!callback) throw Error('Google authorization was cancelled or denied.');
  const code = authCode(callback, redirect, state);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, code, code_verifier: verifier,
        redirect_uri: redirect, grant_type: 'authorization_code' }).toString(),
    });
    if (!response.ok) throw Error('Google token exchange failed. Check the OAuth client configuration.');
    const reader = response.body?.getReader();
    if (!reader) throw Error();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32768) { await reader.cancel(); throw Error(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const data = JSON.parse(new TextDecoder().decode(bytes)) as { access_token?: string; expires_in?: number; scope?: string; token_type?: string };
    if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 16384 ||
        !Number.isFinite(data.expires_in) || data.expires_in! <= 0 || data.expires_in! > 86400 ||
        data.token_type?.toLowerCase() !== 'bearer' || !data.scope?.split(' ').includes(DRIVE_SCOPE))
      throw Error('Google did not grant app data access.');
    await api.storage.local.set({ [GOOGLE_TOKEN_KEY]: {
      accessToken: data.access_token, expiresAt: Date.now() + data.expires_in! * 1000, clientId,
    } satisfies Token });
  } catch {
    // Token endpoint errors/JSON parse failures can contain credentials. Never surface their body.
    throw Error('Google token exchange failed. Check the OAuth client configuration and app data permission.');
  } finally { clearTimeout(timer); }
}
export async function googleToken(clientId: string) {
  const token = (await webext().storage.local.get(GOOGLE_TOKEN_KEY))[GOOGLE_TOKEN_KEY] as Token | undefined;
  if (!token || token.clientId !== clientId || typeof token.accessToken !== 'string' || !token.accessToken ||
      token.accessToken.length > 16384 || !Number.isFinite(token.expiresAt) || token.expiresAt <= Date.now() + 30000)
    throw new ReconnectError();
  return token.accessToken;
}
export async function disconnectGoogle() { await webext().storage.local.remove([GOOGLE_TOKEN_KEY, DRIVE_PENDING_KEY]); }
