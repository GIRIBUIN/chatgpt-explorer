import { GoogleDriveProvider, DRIVE_FILE } from '../src/sync/google-drive';

/** Synthetic Drive HTTP contract. This does not prove Google's If-Match behavior. */
export function driveHarness() {
  let content: unknown = null, generation = 0, fileId = 'file-a';
  const calls: { url: URL; init: RequestInit }[] = [];
  let fault = '', duplicate = false, etagMissing = false;
  const metadata = () => ({ id: fileId, title: DRIVE_FILE, appDataContents: true,
    etag: etagMissing ? '' : `"e${generation}"`, version: String(generation),
    properties: [{ key: 'application', value: 'chat-explorer-sync-v1', visibility: 'PRIVATE' }] });
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); calls.push({ url, init });
    if (fault === 'network') throw Error('secret network detail');
    if (fault === 'auth') return new Response('', { status: 401 });
    if (url.pathname.includes('/upload/')) {
      if (init.method === 'POST') {
        const body = String(init.body), boundary = String(new Headers(init.headers).get('Content-Type')).split('boundary=')[1];
        content = JSON.parse(body.split(`--${boundary}`)[2].split('\r\n\r\n')[1].trim());
        generation = 1;
      } else {
        if (fault === 'stale') generation++;
        if (new Headers(init.headers).get('If-Match') !== metadata().etag) return new Response('', { status: 412 });
        content = JSON.parse(String(init.body)); generation++;
      }
      const result = metadata();
      if (fault === 'upload-etag') result.etag = '"upload-representation"';
      if (fault === 'after-write') generation++;
      return Response.json(result);
    }
    if (url.searchParams.has('spaces')) return Response.json({ items: content ? [{ id: fileId }, ...(duplicate ? [{ id: 'file-duplicate' }] : [])] : [] });
    if (url.pathname.split('/').at(-1) !== fileId) return new Response('', { status: 404 });
    if (url.searchParams.get('alt') === 'media') {
      // Metadata ETags are not the media representation's validators.
      if (new Headers(init.headers).has('If-Match')) return new Response('', { status: 412 });
      if (fault === 'during-read') generation++;
      return Response.json(content);
    }
    return Response.json(metadata());
  };
  const provider = () => new GoogleDriveProvider(async () => 'test-access-token', fetcher);
  return { provider, calls, fetcher, content: () => content, corrupt: (value: unknown) => { content = value; generation++; },
    fail: (value: string) => { fault = value; }, duplicates: () => { duplicate = true; }, noEtag: () => { etagMissing = true; },
    replaceFile: () => { fileId = 'file-replacement'; generation++; } };
}
