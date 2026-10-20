import { webext } from '../utils/browser';
import { chromiumGoogleAuth } from './google-auth-chromium';
import * as firefox from './google-auth-firefox';
import { GOOGLE_TOKEN_KEY, type GoogleAuthAdapter } from './google-auth-common';
export { DRIVE_SCOPE, GOOGLE_TOKEN_KEY, DRIVE_PENDING_KEY, ReconnectError } from './google-auth-common';
export { pkce, authCode } from './google-auth-firefox';

export function googleAuth(clientId: string, fetcher?: typeof fetch): GoogleAuthAdapter {
  const isFirefox = typeof __BROWSER_TARGET__ !== 'undefined'
    ? __BROWSER_TARGET__ === 'firefox'
    : !!(webext().runtime?.getManifest?.() as { browser_specific_settings?: { gecko?: unknown } } | undefined)?.browser_specific_settings?.gecko;
  if (!isFirefox) return chromiumGoogleAuth(clientId);
  return {
    connect: () => firefox.connectGoogle(clientId, fetcher),
    token: () => firefox.googleToken(clientId),
    invalidate: async () => { await webext().storage.local.remove(GOOGLE_TOKEN_KEY); },
    disconnect: firefox.disconnectGoogle,
  };
}
export const connectGoogle = (clientId: string, fetcher?: typeof fetch) => googleAuth(clientId, fetcher).connect();
export const googleToken = (clientId: string) => googleAuth(clientId).token();
export const disconnectGoogle = () => googleAuth(typeof __GOOGLE_CLIENT_ID__ === 'string' ? __GOOGLE_CLIENT_ID__ : '').disconnect();
