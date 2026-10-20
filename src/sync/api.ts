import type { Credentials, Envelope, Remote } from "./types";
import { MAX_BLOB, originUrl } from "./types";
import type { SyncProvider } from './provider';
export class SyncError extends Error {
  constructor(public status: number) {
    super(
      status === 409
        ? "Sync changed remotely. Run Sync now again."
        : status === 401
          ? "Sync authentication failed."
          : status === 429
            ? "Too many requests. Try again later."
            : "Sync request failed. Try again.",
    );
  }
}
export class CloudflareProvider implements SyncProvider {
  readonly origin: string;
  constructor(
    origin: string,
    private fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.origin = originUrl(origin, true);
  }
  private async request(
    c: Credentials,
    method: string,
    body?: unknown,
  ): Promise<Remote> {
    if (c.origin !== this.origin)
      throw Error("Sync server changed. Reconnect to the configured server.");
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetcher(
        `${this.origin}/v1/sync${method === "POST" ? "" : `/${c.syncId}`}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${c.authToken}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
        },
      );
      if (!response.ok) throw new SyncError(response.status);
      const reader = response.body?.getReader();
      if (!reader) throw Error("Invalid sync response.");
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BLOB + 4096) {
          await reader.cancel();
          throw Error("Sync response too large.");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const r = JSON.parse(new TextDecoder().decode(bytes)) as Remote;
      if (
        !Number.isSafeInteger(r.revision) ||
        r.revision < 1 ||
        !Number.isSafeInteger(r.updatedAt) ||
        !r.encryptedBlob
      )
        throw Error("Invalid sync response.");
      return r;
    } catch (e) {
      if (e instanceof SyncError) throw e;
      throw Error("Could not access the sync server.");
    } finally {
      clearTimeout(timer);
    }
  }
  get(c: Credentials) {
    return this.request(c, "GET");
  }
  create(c: Credentials, encryptedBlob: Envelope) {
    return this.request(c, "POST", { syncId: c.syncId, encryptedBlob });
  }
  put(c: Credentials, expectedRevision: number, encryptedBlob: Envelope) {
    return this.request(c, "PUT", { expectedRevision, encryptedBlob });
  }
}
// Compatibility export for existing builds/tests and legacy connections.
export { CloudflareProvider as SyncApi };
