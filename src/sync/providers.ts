import { CloudflareProvider } from './api';
import { GoogleDriveProvider } from './google-drive';
import { DropboxProvider } from './dropbox';
import type { Credentials } from './types';
export const googleClientId = () => typeof __GOOGLE_CLIENT_ID__ === 'string' ? __GOOGLE_CLIENT_ID__ : '';
export const legacyDefault = () => typeof __SYNC_PROVIDER__ === 'string' && __SYNC_PROVIDER__ === 'cloudflare';
export const dropboxDefault = () => typeof __SYNC_PROVIDER__ !== 'string' || !['cloudflare', 'google-drive'].includes(__SYNC_PROVIDER__);
export const dropboxClientId = () => typeof __DROPBOX_CLIENT_ID__ === 'string' ? __DROPBOX_CLIENT_ID__ : '';
export function providerFor(c?: Credentials | null) {
  if (c ? c.provider === 'dropbox' : dropboxDefault()) return DropboxProvider.configured(dropboxClientId());
  if (c ? c.provider !== 'google-drive' : legacyDefault()) return new CloudflareProvider(__SYNC_ORIGIN__);
  return GoogleDriveProvider.configured(googleClientId());
}
