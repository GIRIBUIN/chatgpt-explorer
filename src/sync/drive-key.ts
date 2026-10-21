import { decode, encode, hash } from './crypto';
import type { Credentials } from './types';
export const DRIVE_ORIGIN = 'https://www.googleapis.com';
export function newSyncKey() {
  return encode(new TextEncoder().encode(JSON.stringify({ version: 1, encryptionKey: encode(crypto.getRandomValues(new Uint8Array(32))) })));
}
export async function driveCredentials(code: string): Promise<Credentials> {
  try {
    if (code.length > 512) throw Error();
    const value = JSON.parse(new TextDecoder().decode(decode(code.trim()))) as Record<string, unknown>;
    if (Object.keys(value).sort().join(',') !== 'encryptionKey,version' || value.version !== 1 ||
      typeof value.encryptionKey !== 'string' || decode(value.encryptionKey).length !== 32) throw Error();
    return { version: 1, provider: 'google-drive', encryptionKey: value.encryptionKey,
      // Stable local identity/AAD, not a remote workspace identifier or authentication token.
      syncId: await hash({ driveKey: value.encryptionKey }), authToken: '', origin: DRIVE_ORIGIN };
  } catch { throw Error('Invalid Sync Key.'); }
}
export function driveKey(c: Pick<Credentials, 'encryptionKey'>) {
  return encode(new TextEncoder().encode(JSON.stringify({ version: 1, encryptionKey: c.encryptionKey })));
}
