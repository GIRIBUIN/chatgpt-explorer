import { webext } from '../utils/browser';
import { DRIVE_SCOPE, GOOGLE_TOKEN_KEY, DRIVE_PENDING_KEY, ReconnectError, type GoogleAuthAdapter } from './google-auth-common';

export function chromiumGoogleAuth(clientId: string): GoogleAuthAdapter {
  async function acquire(interactive: boolean) {
    if (!clientId) throw new ReconnectError();
    if (typeof chrome.identity?.getAuthToken !== 'function')
      throw Error('This browser does not support Google Chrome identity authentication.');
    try {
      // Use the native Chrome binding; some Chromium hosts also expose a browser alias.
      const identity = chrome.identity;
      const manifest = chrome.runtime.getManifest();
      if (manifest.oauth2?.client_id !== clientId) throw new ReconnectError();
      const result = await identity.getAuthToken({ interactive, scopes: [DRIVE_SCOPE] });
      const token = result?.token;
      if (!token || (result.grantedScopes && !result.grantedScopes.includes(DRIVE_SCOPE))) throw new ReconnectError();
      return token;
    } catch {
      throw interactive ? Error('Google authorization was cancelled or unavailable. Check the Chrome Extension OAuth client.') : new ReconnectError();
    }
  }
  return {
    async connect() {
      await acquire(true);
      // Retire any token left by the former Chromium PKCE implementation.
      await webext().storage.local.remove(GOOGLE_TOKEN_KEY);
    },
    token: () => acquire(false),
    async invalidate(token) {
      try { await chrome.identity.removeCachedAuthToken({ token }); }
      catch { throw new ReconnectError(); }
    },
    async disconnect() {
      try { await chrome.identity.clearAllCachedAuthTokens(); }
      finally { await webext().storage.local.remove([GOOGLE_TOKEN_KEY, DRIVE_PENDING_KEY]); }
    },
  };
}
