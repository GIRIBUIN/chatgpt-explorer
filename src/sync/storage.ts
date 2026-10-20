import { webext } from "../utils/browser";
import { parseCode, syncCode } from "./crypto";
import { SYNC_KEY, type SyncState } from "./types";
import { driveCredentials, driveKey } from './drive-key';
import { dropboxCredentials } from './dropbox';
export async function storedSync(): Promise<SyncState | null> {
  const data = await webext().storage.local.get(SYNC_KEY),
    r = data[SYNC_KEY] as SyncState | undefined;
  if (!r) return null;
  try {
    if (r.provider === 'google-drive' || r.provider === 'dropbox') {
      const c = await (r.provider === 'dropbox' ? dropboxCredentials : driveCredentials)(driveKey(r));
      if (c.syncId !== r.syncId || r.origin !== c.origin || r.authToken !== '' ||
          typeof r.lastSyncedRemoteVersion !== 'string') throw Error();
    } else parseCode(syncCode(r), r.origin);
    if (
      !Number.isSafeInteger(r.lastSyncedRevision) ||
      r.lastSyncedRevision < 1 ||
      typeof r.lastSyncedPayloadHash !== "string" ||
      !Number.isSafeInteger(r.lastSyncedAt)
    )
      throw Error();
    return r;
  } catch {
    throw Error(
      "Saved sync credentials are invalid. Disconnect and reconnect.",
    );
  }
}
export async function syncConsent() {
  const api = globalThis as typeof globalThis & {
    browser?: {
      permissions: {
        request: (p: { data_collection: string[] }) => Promise<boolean>;
      };
    };
  };
  const manifest=webext().runtime.getManifest() as unknown as {browser_specific_settings?:{gecko?:unknown}};
  if (
    manifest.browser_specific_settings?.gecko && api.browser &&
    !(await api.browser.permissions.request({
      data_collection: ["websiteContent", "authenticationInfo"],
    }))
  )
    throw Error("Sync permission was not granted.");
}
