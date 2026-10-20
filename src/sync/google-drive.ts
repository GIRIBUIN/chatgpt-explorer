import type { SyncProvider } from './provider';
import { MAX_BLOB, type Credentials, type Envelope, type Remote, type SyncState } from './types';
import { decode } from './crypto';
import { SyncError } from './api';
import { DRIVE_ORIGIN } from './drive-key';
import { disconnectGoogle, googleAuth, ReconnectError } from './google-auth';

export const DRIVE_FILE = 'chat-explorer-sync-v1.json';
const MARKER = 'chat-explorer-sync-v1';
// v2 explicitly exposes file.etag. No arbitrary downloadUrl is followed.
const FILES = `${DRIVE_ORIGIN}/drive/v2/files`;
const UPLOAD = `${DRIVE_ORIGIN}/upload/drive/v2/files`;
type File = { id: string; etag: string; version: string; title: string; appDataContents: boolean;
  properties: { key: string; value: string; visibility: string }[] };
type Document = { formatVersion: 1; revision: number; updatedAt: number; iv: string; ciphertext: string };
const fields = 'id,etag,version,title,appDataContents,properties';
class FileNotFound extends Error {}
function document(raw: unknown): Document {
  const r = raw as Document;
  if (!r || typeof r !== 'object' || Object.keys(r).sort().join(',') !== 'ciphertext,formatVersion,iv,revision,updatedAt' ||
      r.formatVersion !== 1 || !Number.isSafeInteger(r.revision) || r.revision < 1 ||
      !Number.isSafeInteger(r.updatedAt) || r.updatedAt < 0 || typeof r.iv !== 'string' ||
      typeof r.ciphertext !== 'string' || r.ciphertext.length > MAX_BLOB || decode(r.iv).length !== 12 ||
      decode(r.ciphertext).length < 16) throw Error('Invalid Google Drive sync file.');
  return r;
}
function version(f: File) { return JSON.stringify([f.id, f.etag, f.version]); }
export function driveSyncMessage(error: unknown, connected: boolean) {
  if (!connected && (error instanceof SyncError && error.status === 409 || error instanceof Error && /Sync now/i.test(error.message)))
    return 'Google Drive changed during connection. Connect Google Drive again.';
  return error instanceof Error ? error.message : 'Could not connect to Google Drive.';
}
function validateFile(f: File) {
  if (!f || !/^[\w-]+$/.test(f.id) || f.title !== DRIVE_FILE || !f.appDataContents ||
    !f.properties?.some(p => p.key === 'application' && p.value === MARKER && p.visibility === 'PRIVATE') ||
    typeof f.version !== 'string' || !/^\d+$/.test(f.version) ||
    typeof f.etag !== 'string' || !/^"[^"\r\n]+"$/.test(f.etag))
    throw Error('Drive file identity or write precondition is unavailable. No changes written.');
  return f;
}
export class GoogleDriveProvider implements SyncProvider {
  readonly origin = DRIVE_ORIGIN;
  private fileId: string | null = null;
  private inOperation = false;
  private checked: { token: string; revision: number } | null = null;
  constructor(private token: () => Promise<string>, private fetcher: typeof fetch = (i, o) => fetch(i, o),
    private invalidate?: (token: string) => Promise<void>) {}
  static configured(clientId: string) {
    const auth = googleAuth(clientId);
    return new GoogleDriveProvider(auth.token, undefined, auth.invalidate);
  }
  async operation<T>(work: () => Promise<T>) {
    this.inOperation = true;
    this.checked = null;
    try { return await work(); }
    finally { this.checked = null; this.inOperation = false; }
  }
  private async request(url: string, init: RequestInit = {}): Promise<unknown> {
    let token = await this.token();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const send = () => this.fetcher(url, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store',
        signal: controller.signal, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
      let response = await send();
      if (response.status === 401 && this.invalidate) {
        await response.body?.cancel();
        await this.invalidate(token);
        token = await this.token(); // Non-interactive, at most one retry.
        response = await send();
      }
      if (response.status === 401) {
        await response.body?.cancel();
        await this.invalidate?.(token);
        throw new ReconnectError();
      }
      if (response.status === 412 || response.status === 409) throw new SyncError(409);
      if (response.status === 404) throw new FileNotFound('Drive sync file not found. Reconnect Google Drive.');
      if (!response.ok) throw Error(`Google Drive request failed (${response.status}).`);
      const reader = response.body?.getReader();
      if (!reader) throw Error('Invalid Drive response.');
      let size = 0; const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BLOB + 4096) { await reader.cancel(); throw Error('Drive response too large.'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      if (e instanceof SyncError || e instanceof ReconnectError || e instanceof FileNotFound) throw e;
      // Never include server response bodies, URLs with tokens, or raw fetch errors.
      throw Error('Could not access Google Drive sync data.');
    } finally { clearTimeout(timer); }
  }
  private metadata(id: string) {
    return this.request(`${FILES}/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`).then(r => validateFile(r as File));
  }
  private async file(c?: Credentials): Promise<File | null> {
    // The opaque device-local baseline already persists [file ID, ETag, version].
    // Reuse only the ID; metadata is always fetched afresh for a new check.
    if (!this.fileId && c?.provider === 'google-drive') {
      try {
        const saved = JSON.parse((c as SyncState).lastSyncedRemoteVersion ?? 'null');
        if (Array.isArray(saved) && saved.length === 3 && typeof saved[0] === 'string' && /^[\w-]+$/.test(saved[0]))
          this.fileId = saved[0];
      } catch { /* Missing/old baseline: discover instead. */ }
    }
    if (this.fileId) {
      try { return await this.metadata(this.fileId); }
      catch (error) { if (!(error instanceof FileNotFound)) throw error; this.fileId = null; }
    }
    return this.discover();
  }
  async discover(): Promise<File | null> {
    const query = new URLSearchParams({ spaces: 'appDataFolder', q: `title = '${DRIVE_FILE}' and trashed = false`,
      maxResults: '2', fields: 'items(id),nextPageToken' });
    const r = await this.request(`${FILES}?${query}`) as { items?: { id: string }[]; nextPageToken?: string };
    if (!Array.isArray(r.items)) throw Error('Invalid Drive file list.');
    if (r.items.length > 1 || r.nextPageToken) throw Error('Multiple Explorer sync files found. No file was changed.');
    if (!r.items.length) return null;
    if (!/^[\w-]+$/.test(r.items[0].id)) throw Error('Invalid Drive file ID.');
    const f = await this.metadata(r.items[0].id);
    this.fileId = f.id;
    return f;
  }
  async readRemote(): Promise<Remote | null> {
    const f = await this.file();
    if (!f) return null;
    return this.download(f);
  }
  private remember(r: Remote) {
    if (this.inOperation) this.checked = { token: r.remoteVersion!, revision: r.revision };
    return r;
  }
  private async download(f: File): Promise<Remote> {
    // File metadata and alt=media are different representations. Do not send a
    // metadata ETag as a media precondition. Bracket the download with identical
    // metadata queries; monotonically increasing file.version detects a racing write.
    const content = document(await this.request(`${FILES}/${f.id}?alt=media`));
    const after = await this.metadata(f.id);
    if (version(after) !== version(f)) throw new SyncError(409);
    return this.remember({ revision: content.revision, updatedAt: content.updatedAt, remoteVersion: version(after),
      encryptedBlob: { version: 1, iv: content.iv, ciphertext: content.ciphertext } });
  }
  private async requiredFile(c: Credentials) {
    const f = await this.file(c);
    if (!f) throw Error('Drive sync file not found. Reconnect Google Drive.');
    return f;
  }
  async check(c: SyncState): Promise<Remote | null> {
    const f = await this.requiredFile(c);
    if (version(f) !== c.lastSyncedRemoteVersion) return this.download(f);
    if (this.inOperation) this.checked = { token: version(f), revision: c.lastSyncedRevision };
    return null;
  }
  async get(c: Credentials, reuse?: Remote) {
    const f = await this.requiredFile(c);
    // Revalidate a preview with fresh metadata; only identical versions reuse bytes.
    if (reuse?.remoteVersion === version(f)) return this.remember(reuse);
    return this.download(f);
  }
  private body(blob: Envelope, revision: number) {
    const d = document({ formatVersion: 1, revision, updatedAt: Date.now(), iv: blob.iv, ciphertext: blob.ciphertext });
    const body = JSON.stringify(d);
    if (new TextEncoder().encode(body).length > MAX_BLOB) throw Error('Drive sync snapshot too large.');
    return { body, d };
  }
  private async verify(d: Document, written: File) {
    // Drive's monotonically increasing version reflects every server file change.
    // One targeted GET checks our acknowledged write is still current, and supplies
    // the canonical metadata ETag (upload representation ETags can differ).
    const current = await this.metadata(written.id);
    if (current.id !== written.id || current.version !== written.version) throw new SyncError(409);
    this.fileId = current.id;
    return this.remember({ revision: d.revision, updatedAt: d.updatedAt, remoteVersion: version(current),
      encryptedBlob: { version: 1, iv: d.iv, ciphertext: d.ciphertext } });
  }
  async create(_c: Credentials, blob: Envelope) {
    void _c;
    if (await this.discover()) throw new SyncError(409);
    const { body, d } = this.body(blob, 1), boundary = `explorer_${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ title: DRIVE_FILE, mimeType: 'application/json', parents: [{ id: 'appDataFolder' }],
      properties: [{ key: 'application', value: MARKER, visibility: 'PRIVATE' }] });
    const result = await this.request(`${UPLOAD}?uploadType=multipart&fields=${encodeURIComponent(fields)}`, { method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--` });
    return this.verify(d, validateFile(result as File));
  }
  async put(c: Credentials, expectedRevision: number, blob: Envelope, expectedVersion?: string) {
    if (!expectedVersion) throw Error('Drive write precondition is missing.');
    // Reuse this operation's checked baseline; If-Match still guards any write
    // between that check and PUT. Standalone callers must establish their own read.
    let latest = this.inOperation ? this.checked : null;
    if (!latest) {
      const r = await this.get(c);
      latest = { token: r.remoteVersion!, revision: r.revision };
    }
    if (latest.token !== expectedVersion || latest.revision !== expectedRevision) throw new SyncError(409);
    const [id, etag] = JSON.parse(expectedVersion) as string[];
    const { body, d } = this.body(blob, expectedRevision + 1);
    const written = await this.request(`${UPLOAD}/${encodeURIComponent(id)}?uploadType=media&fields=${encodeURIComponent(fields)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': etag }, body,
    });
    return this.verify(d, validateFile(written as File));
  }
  disconnect() { return disconnectGoogle(); }
}
