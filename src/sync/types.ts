export type Credentials = {
  provider?: 'google-drive' | 'dropbox';
  version: 1;
  syncId: string;
  authToken: string;
  encryptionKey: string;
  origin: string;
};
export type Envelope = { version: 1; iv: string; ciphertext: string };
export type Remote = {
  remoteVersion?: string;
  revision: number;
  encryptedBlob: Envelope;
  updatedAt: number;
};
export type SyncState = Credentials & {
  lastSyncedRemoteVersion?: string;
  lastSyncedRevision: number;
  lastSyncedPayloadHash: string;
  lastSyncedAt: number;
};
export const SYNC_KEY = "explorerSync";
export const MAX_PLAINTEXT = 700000;
export const MAX_BLOB = 1000000;
export function originUrl(value: string, allowLocal = false) {
  const u = new URL(value);
  if (
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    !(
      u.protocol === "https:" ||
      (allowLocal &&
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
    )
  )
    throw Error("Invalid sync server origin.");
  return u.origin;
}
