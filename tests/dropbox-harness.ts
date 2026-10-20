import { DropboxProvider, DROPBOX_PATH, DROPBOX_LEGACY_PATH } from '../src/sync/dropbox';
import { vi } from 'vitest';
/** Synthetic official HTTP shapes; no real Dropbox account is used. */
export function dropboxHarness() {
  let content: unknown = null, legacy: unknown = null, generation = 0, legacyGeneration = 0, fault = '';
  const calls: { url: string; init: RequestInit }[] = [];
  const meta = (path = DROPBOX_PATH) => ({ id: path === DROPBOX_PATH ? 'id:appfile' : 'id:legacy', rev: (path === DROPBOX_PATH ? generation : legacyGeneration).toString(16).padStart(12, '0'), path_lower: path.toLowerCase(),
    name: path.split('/').at(-1), size: new TextEncoder().encode(JSON.stringify(path === DROPBOX_PATH ? content : legacy)).length });
  const auth = { token: vi.fn(async () => 'access-token'), invalidate: vi.fn(async (_t: string) => { void _t; }), disconnect: vi.fn(async () => {}) };
  const conflict = () => Response.json({ error: { '.tag': 'path', path: { '.tag': 'conflict' } } }, { status: 409 });
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = String(input); calls.push({ url, init });
    if (fault === 'network') throw Error('private network details access-token');
    if (fault === '401' || fault === '401-once' && calls.length === 1) return new Response('', { status: 401 });
    if (url.endsWith('/get_metadata')) {
      const path = JSON.parse(String(init.body)).path;
      if (![DROPBOX_PATH, DROPBOX_LEGACY_PATH].includes(path)) throw Error('Outside dedicated sync paths');
      if (!(path === DROPBOX_PATH ? content : legacy)) return Response.json({ error: { '.tag': 'path', path: { '.tag': 'not_found' } } }, { status: 409 });
      return Response.json({ '.tag': 'file', ...meta(path) });
    }
    if (url.endsWith('/download')) {
      const path = JSON.parse(new Headers(init.headers).get('Dropbox-API-Arg')!).path;
      if (![DROPBOX_PATH.toLowerCase(), DROPBOX_LEGACY_PATH].includes(path)) throw Error('Outside dedicated sync paths');
      if (fault === 'read-race') generation++;
      return Response.json(path === DROPBOX_LEGACY_PATH ? legacy : content, { headers: { 'Dropbox-API-Result': JSON.stringify(meta(path === DROPBOX_LEGACY_PATH ? path : DROPBOX_PATH)) } });
    }
    if (url.endsWith('/upload')) {
      const args = JSON.parse(new Headers(init.headers).get('Dropbox-API-Arg')!);
      if (args.path !== DROPBOX_PATH || args.autorename !== false || args.strict_conflict !== true) throw Error('Unsafe upload');
      if (fault === 'stale') generation++;
      if (args.mode === 'add' ? !!content : !content || args.mode.update !== meta().rev) return conflict();
      content = JSON.parse(String(init.body)); generation++;
      return Response.json(meta()); // Concrete FileMetadata need not carry a union .tag.
    }
    throw Error('Unexpected endpoint');
  };
  return { calls, fetcher, auth, provider: () => new DropboxProvider(auth, fetcher), meta,
    seedLegacy: (v: unknown) => { legacy = structuredClone(v); legacyGeneration++; }, legacy: () => legacy,
    removeCanonical: () => { content = null; },
    content: () => content, corrupt: (v: unknown) => { content = v; generation++; }, fail: (f: string) => { fault = f; } };
}
