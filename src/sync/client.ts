import type { AppState } from "../models/types";
import { credentials, decrypt, encrypt, hash, parseCode } from "./crypto";
import { applyPayload, payload, parsePayload, type Payload } from "./payload";
import { SyncError } from "./api";
import type { SyncProvider } from './provider';
import { direction } from "./conflict";
import { networkLock, SyncBusyError } from "./locks";
import type { Credentials, SyncState, Remote } from "./types";
export type Local = { state: AppState; sync: SyncState | null };
export type Change = {
  state?: AppState;
  sync?: SyncState | null;
  backup?: boolean;
};
export type SyncStore = {
  read: () => Promise<Local>;
  transaction: (fn: (local: Local) => Promise<Change>) => Promise<void>;
};
export type Preview = {
  kind: "connect" | "conflict";
  credentials: Credentials;
  localHash: string;
  remote: Remote;
  payload: Payload;
  connectionId: string | null;
};
export type Outcome = { kind: "done" | "none" } | Preview;
// Extension pages and the worker share the Web Lock. Within each context,
// metadata-first providers using the same store share the active result.
type SyncFlight = { promise: Promise<Outcome>; fullCheckRequested: boolean };
const syncFlights = new WeakMap<SyncStore, SyncFlight>();
export class SyncClient {
  private busy = false;
  constructor(
    private api: SyncProvider,
    private store: SyncStore,
  ) {}
  private async run<T>(work: () => Promise<T>) {
    if (this.busy) throw new SyncBusyError();
    this.busy = true;
    try {
      return await networkLock(() => this.api.operation ? this.api.operation(work) : work());
    } finally {
      this.busy = false;
    }
  }
  private synced(c: Credentials, r: Remote, h: string): SyncState {
    return {
      ...c,
      lastSyncedRevision: r.revision,
      ...(r.remoteVersion ? { lastSyncedRemoteVersion: r.remoteVersion } : {}),
      lastSyncedPayloadHash: h,
      lastSyncedAt: Date.now(),
    };
  }
  private sameConnection(local: Local, id: string | null) {
    if ((local.sync?.syncId ?? null) !== id)
      throw Error("Connection changed. Run Sync now again.");
  }
  private async preview(
    local: Local,
    c: Credentials,
    r: Remote,
    kind: Preview["kind"],
  ): Promise<Preview> {
    return {
      kind,
      credentials: c,
      localHash: await hash(payload(local.state)),
      remote: r,
      payload: parsePayload(await decrypt(c, r.encryptedBlob)),
      connectionId: local.sync?.syncId ?? null,
    };
  }
  /** Legacy Cloudflare pairing. Drive pairing uses connectProvider after explicit OAuth. */
  enable() {
    return this.run(async () => {
      const local = await this.store.read();
      if (local.sync) throw Error("Already connected.");
      const c = credentials(this.api.origin),
        p = payload(local.state),
        h = await hash(p),
        remote = await this.api.create(c, await encrypt(c, p));
      await this.store.transaction(async (now) => {
        this.sameConnection(now, null);
        return { sync: this.synced(c, remote, h) };
      });
      return { kind: "done" } as const;
    });
  }
  connect(code: string) {
    return this.run(async () => {
      const local = await this.store.read();
      if (local.sync)
        throw Error("Disconnect before connecting another workspace.");
      const c = parseCode(code, this.api.origin);
      return this.preview(local, c, await this.api.get(c), "connect");
    });
  }
  /** Explicitly authenticated provider connection; existing remote always previews. */
  connectProvider(c: Credentials, existing: Remote | null) {
    return this.run(async () => {
      const local = await this.store.read();
      if (local.sync) throw Error('Disconnect before connecting another workspace.');
      if (existing) return this.preview(local, c, existing, 'connect');
      const p = payload(local.state);
      const remote = await this.api.create(c, await encrypt(c, p));
      await this.store.transaction(async now => {
        this.sameConnection(now, null);
        return { sync: this.synced(c, remote, await hash(p)) };
      });
      return { kind: 'done' } as const;
    });
  }
  private async acknowledgeEqual(p: Preview): Promise<boolean> {
    if (await hash(p.payload) !== p.localHash) return false;
    await this.store.transaction(async now => {
      this.sameConnection(now, p.connectionId);
      if (await hash(payload(now.state)) !== p.localHash)
        throw Error("Local data changed during sync. Run Sync now again.");
      // A new envelope/version is not a semantic edit. Do not rewrite local data.
      return { sync: this.synced(p.credentials, p.remote, p.localHash) };
    });
    return true;
  }
  now(onlyIfDirty = false) {
    if (!this.api.check) return this.run(() => this.syncOnce(onlyIfDirty));
    const running = syncFlights.get(this.store);
    if (running) {
      if (!onlyIfDirty) running.fullCheckRequested = true;
      return running.promise;
    }
    const entry: SyncFlight = { promise: Promise.resolve({ kind: 'none' }), fullCheckRequested: !onlyIfDirty };
    const flight = this.run(async () => {
      let checkedRemote = false;
      let outcome = await this.syncOnce(onlyIfDirty, () => { checkedRemote = true; });
      if (!('remote' in outcome)) {
        const latest = await this.store.read();
        // A local edit during the active sync gets at most one follow-up. Further
        // edits remain dirty and retain the existing five-minute alarm policy.
        const manualCheck = entry.fullCheckRequested && !checkedRemote;
        if (latest.sync && (manualCheck || await hash(payload(latest.state)) !== latest.sync.lastSyncedPayloadHash))
          outcome = await this.syncOnce(!manualCheck);
      }
      return outcome;
    });
    entry.promise = flight;
    syncFlights.set(this.store, entry);
    void flight.finally(() => {
      if (syncFlights.get(this.store) === entry) syncFlights.delete(this.store);
    }).catch(() => {});
    return flight;
  }
  private async syncOnce(onlyIfDirty: boolean, checkingRemote?: () => void): Promise<Outcome> {
      const local = await this.store.read(),
        c = local.sync;
      if (!c) throw Error("Not connected.");
      const p = payload(local.state), h = await hash(p);
      // Close flush rechecks under the network lock, including a manual sync race.
      if (onlyIfDirty && h === c.lastSyncedPayloadHash) return { kind: "none" };
      checkingRemote?.();
      const r = this.api.check ? await this.api.check(c) : await this.api.get(c);
      if (r && r.revision < c.lastSyncedRevision)
        throw Error("Server revision went backwards. No changes applied.");
      const mode = direction(
        h,
        c.lastSyncedPayloadHash,
        r ? r.remoteVersion ?? String(r.revision) : c.lastSyncedRemoteVersion ?? String(c.lastSyncedRevision),
        c.lastSyncedRemoteVersion ?? String(c.lastSyncedRevision),
      );
      if (mode === "conflict" || mode === "pull") {
        const preview = await this.preview(local, c, r!, mode === "conflict" ? "conflict" : "connect");
        if (await this.acknowledgeEqual(preview)) return { kind: "none" };
        if (mode === "conflict") return preview;
        await this.apply(preview, "remote");
        return { kind: "done" };
      }
      if (mode === "push") {
        try {
          const updated = await this.api.put(
            c,
            r?.revision ?? c.lastSyncedRevision,
            await encrypt(c, p),
            r?.remoteVersion ?? c.lastSyncedRemoteVersion,
          );
          await this.store.transaction(async (now) => {
            this.sameConnection(now, c.syncId);
            return { sync: this.synced(c, updated, h) };
          });
          return { kind: "done" };
        } catch (e) {
          if (e instanceof SyncError && e.status === 409) {
            const preview = await this.preview(local, c, await this.api.get(c), "conflict");
            if (await this.acknowledgeEqual(preview)) return { kind: "none" };
            return preview;
          }
          throw e;
        }
      }
      await this.store.transaction(async (now) => {
        this.sameConnection(now, c.syncId);
        return { sync: { ...c, lastSyncedAt: Date.now() } };
      });
      return { kind: "none" };
  }
  private async check(now: Local, p: Preview) {
    this.sameConnection(now, p.connectionId);
    if ((await hash(payload(now.state))) !== p.localHash)
      throw Error("Preview is stale. Run Sync now or Connect Existing again.");
    const remote = await this.api.get(p.credentials, p.remote);
    if (remote.revision !== p.remote.revision || remote.remoteVersion !== p.remote.remoteVersion)
      throw Error("Preview is stale. Run Sync now or Connect Existing again.");
    return remote;
  }
  private async apply(p: Preview, choice: "local" | "remote") {
    await this.store.transaction(async (now) => {
      const latest = await this.check(now, p);
      if (choice === "local") {
        const current = payload(now.state),
          r = await this.api.put(
            p.credentials,
            latest.revision,
            await encrypt(p.credentials, current),
            latest.remoteVersion,
          );
        return { sync: this.synced(p.credentials, r, await hash(current)) };
      }
      const validated = this.api.check ? p.payload : parsePayload(
        await decrypt(p.credentials, latest.encryptedBlob),
      );
      const next = applyPayload(now.state, validated);
      return {
        state: next,
        backup: true,
        sync: this.synced(p.credentials, latest, await hash(payload(next))),
      };
    });
  }
  resolve(p: Preview, choice: "local" | "remote") {
    return this.run(async () => {
      await this.apply(p, choice);
      return { kind: "done" } as const;
    });
  }
  exportBoth(p: Preview) {
    return this.run(async () => {
      let result!: { local: Payload; remote: Payload };
      await this.store.transaction(async (now) => {
        const r = await this.check(now, p);
        result = {
          local: payload(now.state),
          remote: this.api.check ? p.payload : parsePayload(await decrypt(p.credentials, r.encryptedBlob)),
        };
        return {};
      });
      return result;
    });
  }
  disconnect() {
    return this.run(async () => {
      await this.store.transaction(async () => ({ sync: null }));
      await this.api.disconnect?.();
    });
  }
}
