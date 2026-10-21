import { webext } from '../utils/browser';
import { driveCredentials, driveKey } from './drive-key';
import { DROPBOX_PENDING_KEY } from './dropbox-auth';
import { SYNC_KEY } from './types';

// Device-local key retention is independent of OAuth and remote baselines.
export const DROPBOX_LOCAL_KEY = 'explorerDropboxSyncKey';
export async function validatedLocalKey(value: unknown): Promise<string | null> {
  if (typeof value !== 'string') return null;
  try { await driveCredentials(value); return value.trim(); }
  catch { return null; }
}
export async function localDropboxKey(): Promise<string | null> {
  const data = await webext().storage.local.get([DROPBOX_LOCAL_KEY, SYNC_KEY, DROPBOX_PENDING_KEY]);
  const saved = await validatedLocalKey(data[DROPBOX_LOCAL_KEY]);
  if (saved) return saved;
  const legacy = data[SYNC_KEY] as { provider?: unknown; encryptionKey?: unknown } | undefined;
  // A broken revision/cache must not make an independently valid key disappear.
  // Recover only a known Dropbox record, never another provider's credentials.
  if (legacy?.provider === 'dropbox' && typeof legacy.encryptionKey === 'string') {
    const key = await validatedLocalKey(driveKey({ encryptionKey: legacy.encryptionKey }));
    if (key) return key;
  }
  // An interrupted upload may have accepted the encrypted file before its reply
  // was lost. Keep that locally generated key available without generating one.
  return validatedLocalKey(data[DROPBOX_PENDING_KEY]);
}
