import type { SyncProvider } from './provider';
import type { Credentials, Envelope, Remote, SyncState } from './types';
import { MAX_BLOB } from './types';
import { decode, decrypt } from './crypto';
import { parsePayload } from './payload';
import { driveCredentials } from './drive-key';
import { SyncError } from './api';
import { DropboxAuth, DropboxReconnectError, DropboxUnavailableError, DROPBOX_ORIGIN, limitedJson } from './dropbox-auth';

export const DROPBOX_FOLDER = '/ChatGPT Chat Explorer';
export const DROPBOX_PATH = `${DROPBOX_FOLDER}/chat-explorer-sync.json`;
export const DROPBOX_LEGACY_PATH = '/chat-explorer-sync.json';
const CONTENT = 'https://content.dropboxapi.com/2/files';
type Metadata = { '.tag'?: 'file'; id: string; rev: string; path_lower: string; size: number };
type Document = { formatVersion: 1; revision: number; updatedAt: number; iv: string; ciphertext: string };
export async function dropboxCredentials(key: string): Promise<Credentials> {
  // Retain the existing key format and AES-GCM AAD identity across providers.
  return { ...await driveCredentials(key), provider: 'dropbox', origin: DROPBOX_ORIGIN };
}
function metadata(value: unknown, path = DROPBOX_PATH): Metadata {
  const m = value as Metadata;
  if (!m || m['.tag'] !== undefined && m['.tag'] !== 'file' || typeof m.id !== 'string' || !/^id:[\w-]+$/.test(m.id) ||
      typeof m.rev !== 'string' || !/^[0-9a-f]{9,}$/.test(m.rev) || m.path_lower !== path.toLowerCase() ||
      !Number.isSafeInteger(m.size) || m.size < 0 || m.size > MAX_BLOB)
    throw Error('Invalid Dropbox sync file metadata.');
  return m;
}
function doc(value: unknown): Document {
  const d = value as Document;
  if (!d || Object.keys(d).sort().join(',') !== 'ciphertext,formatVersion,iv,revision,updatedAt' ||
      d.formatVersion !== 1 || !Number.isSafeInteger(d.revision) || d.revision < 1 ||
      !Number.isSafeInteger(d.updatedAt) || d.updatedAt < 0 || typeof d.iv !== 'string' ||
      typeof d.ciphertext !== 'string' || d.ciphertext.length > MAX_BLOB ||
      decode(d.iv).length !== 12 || decode(d.ciphertext).length < 16) throw Error('Invalid Dropbox sync file.');
  return d;
}
// Include the canonical path in device-local baselines, never in the encrypted payload.
// Old two-element baselines identify clients that may still need root-file migration.
const version = (m: Metadata) => JSON.stringify([m.id, m.rev, m.path_lower]);
export class DropboxProvider implements SyncProvider {
  readonly origin = DROPBOX_ORIGIN;
  private checked: { version: string; revision: number } | null = null;
  private active = false;
  private canonicalSeen = false;
  constructor(private auth: Pick<DropboxAuth, 'token' | 'invalidate' | 'disconnect'>,
    private fetcher: typeof fetch = (i, o) => fetch(i, o)) {}
  static configured(clientId: string) { return new DropboxProvider(new DropboxAuth(clientId)); }
  async operation<T>(work: () => Promise<T>) {
    this.active = true; this.checked = null;
    try { return await work(); } finally { this.active = false; this.checked = null; }
  }
  private async request(url: string, init: RequestInit): Promise<{ value: unknown; meta: string | null } | null> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      let token = await this.auth.token();
      const send = () => this.fetcher(url, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store',
        signal: controller.signal, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
      let r = await send();
      if (r.status === 401) {
        await r.body?.cancel(); await this.auth.invalidate(token); token = await this.auth.token(); r = await send();
      }
      if (r.status === 401) { await r.body?.cancel(); await this.auth.invalidate(token); throw new DropboxReconnectError(); }
      if (r.status === 409) {
        const error = await limitedJson(r, 32768) as { error?: { '.tag'?: string; path?: { '.tag'?: string } } };
        if (url.endsWith('/get_metadata') && error.error?.['.tag'] === 'path' && error.error.path?.['.tag'] === 'not_found') return null;
        throw new SyncError(409);
      }
      if (!r.ok) { await r.body?.cancel(); throw new DropboxUnavailableError(); }
      return { value: await limitedJson(r, MAX_BLOB + 4096), meta: r.headers.get('Dropbox-API-Result') };
    } catch (error) {
      if (error instanceof SyncError || error instanceof DropboxReconnectError || error instanceof DropboxUnavailableError) throw error;
      throw new DropboxUnavailableError();
    } finally { clearTimeout(timer); }
  }
  private async head(path = DROPBOX_PATH): Promise<Metadata | null> {
    const r = await this.request(`${this.origin}/2/files/get_metadata`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
    const m = r ? metadata(r.value, path) : null;
    if (m && path === DROPBOX_PATH) this.canonicalSeen = true;
    return m;
  }
  private remember(r: Remote) {
    if (this.active) this.checked = { version: r.remoteVersion!, revision: r.revision };
    return r;
  }
  private remote(m: Metadata, d: Document): Remote {
    return this.remember({ remoteVersion: version(m), revision: d.revision, updatedAt: d.updatedAt,
      encryptedBlob: { version: 1, iv: d.iv, ciphertext: d.ciphertext } });
  }
  private async download(m: Metadata) {
    const r = await this.request(`${CONTENT}/download`, { method: 'POST',
      headers: { 'Dropbox-API-Arg': JSON.stringify({ path: m.path_lower }) } });
    if (!r?.meta) throw Error('Invalid Dropbox download response.');
    const downloaded = metadata(JSON.parse(r.meta), m.path_lower);
    // The response header describes these exact bytes. A racing edit fails closed.
    if (version(downloaded) !== version(m)) throw new SyncError(409);
    return this.remote(downloaded, doc(r.value));
  }
  private async locate(c?: Credentials): Promise<Metadata | Remote | null> {
    if (c && 'lastSyncedRemoteVersion' in c) {
      const saved = (c as SyncState).lastSyncedRemoteVersion;
      try { if (JSON.parse(saved ?? 'null')?.[2] === DROPBOX_PATH.toLowerCase()) this.canonicalSeen = true; } catch { /* Legacy baseline. */ }
    }
    const canonical = await this.head();
    if (canonical || this.canonicalSeen) return canonical;
    const legacy = await this.head(DROPBOX_LEGACY_PATH);
    if (!legacy || !c) return legacy;
    const old = await this.download(legacy);
    // Validate with the user's key before copying any legacy bytes. No plaintext is uploaded.
    parsePayload(await decrypt(c, old.encryptedBlob));
    const fresh = await this.head(DROPBOX_LEGACY_PATH);
    if (!fresh || version(fresh) !== version(legacy)) throw new SyncError(409);
    // add + strict_conflict makes simultaneous migrations fail closed, never overwrite.
    const saved = await this.upload(old.encryptedBlob, old.revision, 'add');
    const verified = await this.head();
    const legacyAfter = await this.head(DROPBOX_LEGACY_PATH);
    if (!verified || version(verified) !== saved.remoteVersion || !legacyAfter || version(legacyAfter) !== version(legacy))
      throw new SyncError(409);
    return saved;
  }
  async readRemote(c?: Credentials): Promise<Remote | null> {
    const r = await this.locate(c);
    return !r ? null : 'encryptedBlob' in r ? r : this.download(r);
  }
  async get(_c: Credentials, reuse?: Remote): Promise<Remote> {
    const m = await this.locate(_c);
    if (!m) throw Error('Dropbox sync file not found. Reconnect Dropbox.');
    if ('encryptedBlob' in m) return m;
    return reuse?.remoteVersion === version(m) ? this.remember(reuse) : this.download(m);
  }
  async check(c: SyncState): Promise<Remote | null> {
    const m = await this.locate(c);
    if (!m) throw Error('Dropbox sync file not found. Reconnect Dropbox.');
    if ('encryptedBlob' in m) return m;
    if (version(m) !== c.lastSyncedRemoteVersion) return this.download(m);
    if (this.active) this.checked = { version: version(m), revision: c.lastSyncedRevision };
    return null;
  }
  private async upload(blob: Envelope, revision: number, mode: 'add' | { '.tag': 'update'; update: string }) {
    const d = doc({ formatVersion: 1, revision, updatedAt: Date.now(), iv: blob.iv, ciphertext: blob.ciphertext });
    const body = JSON.stringify(d);
    if (new TextEncoder().encode(body).length > MAX_BLOB) throw Error('Dropbox sync snapshot too large.');
    const r = await this.request(`${CONTENT}/upload`, { method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify({
        path: DROPBOX_PATH, mode, autorename: false, strict_conflict: true, mute: true }) }, body });
    if (!r) throw Error('Invalid Dropbox upload response.');
    // Atomic conditional upload returns authoritative metadata for the saved bytes.
    return this.remote(metadata(r.value), d);
  }
  async create(_c: Credentials, blob: Envelope) {
    // A legacy workspace must be connected with its existing key, not replaced by a new one.
    if (await this.head() || !this.canonicalSeen && await this.head(DROPBOX_LEGACY_PATH)) throw new SyncError(409);
    void _c; return this.upload(blob, 1, 'add');
  }
  async put(c: Credentials, revision: number, blob: Envelope, expectedVersion?: string) {
    if (!expectedVersion) throw Error('Dropbox write precondition is missing.');
    let checked = this.active ? this.checked : null;
    if (!checked) { const r = await this.get(c); checked = { version: r.remoteVersion!, revision: r.revision }; }
    if (checked.version !== expectedVersion || checked.revision !== revision) throw new SyncError(409);
    const pair = JSON.parse(expectedVersion) as unknown;
    if (!Array.isArray(pair) || pair.length !== 3 || pair[2] !== DROPBOX_PATH.toLowerCase() || typeof pair[1] !== 'string' || !/^[0-9a-f]{9,}$/.test(pair[1]))
      throw Error('Invalid Dropbox write precondition.');
    return this.upload(blob, revision + 1, { '.tag': 'update', update: pair[1] });
  }
  disconnect() { return this.auth.disconnect(); }
}
