import { useEffect, useRef, useState } from "react";
import { UiIcon } from './UiIcon';
import type { AppState } from "../models/types";
import {
  SyncClient,
  type SyncStore,
  type Preview,
  type Outcome,
} from "../sync/client";
import { providerFor, googleClientId, legacyDefault, dropboxDefault, dropboxClientId } from '../sync/providers';
import { GoogleDriveProvider, driveSyncMessage } from '../sync/google-drive';
import { connectGoogle, disconnectGoogle, DRIVE_PENDING_KEY } from '../sync/google-auth';
import { driveCredentials, driveKey, newSyncKey } from '../sync/drive-key';
import { DropboxAuth, DROPBOX_PENDING_KEY, dropboxMessage } from '../sync/dropbox-auth';
import { DropboxProvider, dropboxCredentials } from '../sync/dropbox';
import { SyncError } from '../sync/api';
import { syncCode, hash } from "../sync/crypto";
import { syncDiff } from "../sync/payload";
import { storedSync, syncConsent } from "../sync/storage";
import type { SyncState } from "../sync/types";
import { downloadJson } from "./DataDialog";
import { t } from "../i18n";
import { AUTO_KEY, autoDefaults, type AutoState } from "../sync/auto";
import { webext } from "../utils/browser";
export function SyncSettings({
  state,
  store,
  onBusy,
  autoPreview,
  clearAutoPreview,
}: {
  state: AppState;
  store: SyncStore;
  onBusy: (busy: boolean) => void;
  autoPreview: Preview | null;
  clearAutoPreview: () => void;
}) {
  const client = useRef<SyncClient | null>(null);
  const keyRequested = useRef(false);
  if (!client.current && (!legacyDefault() || __SYNC_ORIGIN__))
    client.current = new SyncClient(providerFor(), store);
  const [connection, setConnection] = useState<SyncState | null>(null),
    [invalid, setInvalid] = useState(false),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [code, setCode] = useState(""),
    [shown, setShown] = useState(false),
    [connecting, setConnecting] = useState(false),
    [preview, setPreview] = useState<Preview | null>(autoPreview);
  const [automatic, setAutomatic] = useState<AutoState>(autoDefaults);
  useEffect(() => { setPreview(autoPreview); }, [autoPreview]);
  useEffect(() => {
    const refresh = () => void webext().storage.local.get(AUTO_KEY).then(data => setAutomatic({ ...autoDefaults(), ...(data[AUTO_KEY] as Partial<AutoState> | undefined) }));
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[AUTO_KEY]) refresh();
    };
    refresh();
    webext().storage.onChanged.addListener(listener);
    return () => webext().storage.onChanged.removeListener(listener);
  }, []);
  useEffect(() => {
    void storedSync()
      .then(c => {
        setConnection(c);
        if (c) client.current = new SyncClient(providerFor(c), store);
      })
      .catch(() => {
        setInvalid(true);
        setMessage(t("syncInvalidCredentials"));
      })
      .finally(() => setReady(true));
  }, []);
  async function run(action: () => Promise<Outcome | void>, network = true) {
    if (busy) return;
    setBusy(true);
    onBusy(true);
    setMessage("");
    keyRequested.current = false;
    try {
      if (network) await syncConsent();
      const result = await action();
      if (result && "remote" in result) setPreview(result);
      else if (!keyRequested.current) {
        clearAutoPreview();
        setPreview(null);
        setMessage(t(result?.kind === "none" ? "syncUpToDate" : "syncDone"));
      }
      const savedConnection = await storedSync();
      setConnection(savedConnection);
      if (savedConnection?.provider === 'google-drive') await webext().storage.local.remove(DRIVE_PENDING_KEY);
      if (savedConnection?.provider === 'dropbox') await webext().storage.local.remove(DROPBOX_PENDING_KEY);
      setInvalid(false);
      if (!keyRequested.current) setCode("");
      if (!keyRequested.current) setConnecting(false);
      setShown(false);
    } catch (e) {
      setMessage(dropbox && !connection && e instanceof SyncError && e.status === 409 ? t('dropboxConnectChanged')
        : dropbox ? dropboxMessage(e, !!connection) : drive ? driveSyncMessage(e, !!connection) : e instanceof Error ? e.message : t("syncFailed"));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  const diff = preview ? syncDiff(state, preview.payload) : null;
  const dropbox = connection ? connection.provider === 'dropbox' : dropboxDefault();
  const drive = connection ? connection.provider === 'google-drive' : !dropbox && !legacyDefault();
  const keyed = drive || dropbox;
  const configured = dropbox ? !!dropboxClientId() : drive ? !!googleClientId() : !!__SYNC_ORIGIN__;
  async function connectDropbox() {
    const auth = new DropboxAuth(dropboxClientId());
    await auth.connect();
    const provider = new DropboxProvider(auth);
    client.current = new SyncClient(provider, store);
    if (connection) return client.current.now();
    const remote = await provider.readRemote();
    const pending = (await webext().storage.local.get(DROPBOX_PENDING_KEY))[DROPBOX_PENDING_KEY];
    if (remote) {
      keyRequested.current = true; setConnecting(true); setMessage(t('driveKeyRequired'));
      setCode(typeof pending === 'string' ? pending : ''); return;
    }
    const key = typeof pending === 'string' ? pending : newSyncKey();
    await webext().storage.local.set({ [DROPBOX_PENDING_KEY]: key });
    return client.current.connectProvider(await dropboxCredentials(key), null);
  }
  async function connectDrive() {
    await connectGoogle(googleClientId());
    const provider = GoogleDriveProvider.configured(googleClientId());
    client.current = new SyncClient(provider, store);
    if (connection) {
      // A different account is never silently accepted: existing revision/key checks still run.
      return client.current.now();
    }
    const remote = await provider.readRemote();
    const pending = (await webext().storage.local.get(DRIVE_PENDING_KEY))[DRIVE_PENDING_KEY];
    if (remote) {
      keyRequested.current = true;
      setConnecting(true);
      setMessage(t('driveKeyRequired'));
      setCode(typeof pending === 'string' ? pending : '');
      return;
    }
    const key = typeof pending === 'string' ? pending : newSyncKey();
    const credentials = await driveCredentials(key);
    // Preserve the key even if Drive accepts creation but its response is lost.
    await webext().storage.local.set({ [DRIVE_PENDING_KEY]: key });
    const result = await client.current.connectProvider(credentials, null);
    await webext().storage.local.remove(DRIVE_PENDING_KEY);
    return result;
  }
  return (
    <section className="data-settings" aria-busy={busy}>
      <h3>{t("sync")}</h3>
      <div className="settings-row">
        <span>{t("crossDeviceSync")}</span>
        <p className="hint">{t(dropbox ? 'dropboxDescription' : drive ? 'driveDescription' : "syncDescription")}</p>
        <p className="hint">{t(dropbox ? 'dropboxDisclosure' : drive ? 'driveDisclosure' : "syncDisclosure")}</p>
        {connection && !dropbox && dropboxDefault() && <p className="hint">{t('legacyProvider')}</p>}
        {!configured ? (
          <p className="hint">{t(dropbox ? 'dropboxNotConfigured' : drive ? 'driveNotConfigured' : "syncNotConfigured")}</p>
        ) : (
          <small>{dropbox ? t('dropbox') : drive ? t('googleDrive') : __SYNC_ORIGIN__}</small>
        )}
        {connection ? (
          <>
            <span>{t("syncConnected")}</span>
            <label>
              {t("automaticSync")}
              <select aria-label={t("automaticSync")} value={automatic.enabled ? "on" : "off"} disabled={busy}
                onChange={e => void webext().runtime.sendMessage({ type: "auto-sync-enabled", enabled: e.target.value === "on" }).catch(() => setMessage(t("syncFailed")))}>
                <option value="on">{t("autoOn")}</option>
                <option value="off">{t("autoOff")}</option>
              </select>
            </label>
            <p className="hint">{t("automaticSyncDescription")}</p>
            {!busy && (automatic.conflict || automatic.error || automatic.dirty) && <p role="status">
              <UiIcon name={automatic.conflict ? 'warning' : automatic.error ? 'error' : 'info'} />
              {automatic.conflict ? t("syncConflict") : automatic.error
                ? t(dropbox && automatic.error === 'reconnect-required' ? 'dropboxReconnectRequired'
                  : dropbox && automatic.error === 'temporarily-unavailable' ? 'dropboxUnavailable' : 'autoSyncError')
                : t("autoSyncPending")}
            </p>}
            <span>
              {t("lastSynced")}:{" "}
              {new Date(connection.lastSyncedAt)
                .toISOString()
                .replace("T", " ")
                .slice(0, 19)}{" "}
              UTC
            </span>
            <div className="dialog-actions settings-actions">
              {keyed && <button type="button" disabled={busy || !configured}
                onClick={() => void run(dropbox ? connectDropbox : connectDrive)}>{t(dropbox ? 'reconnectDropbox' : 'reconnectDrive')}</button>}
              <button
                type="button"
                disabled={busy || !client.current}
                onClick={() => void run(() => client.current!.now())}
              >
                {t("syncNow")}
              </button>
              <button
                type="button"
                disabled={busy}
                aria-expanded={shown}
                onClick={() => setShown(!shown)}
              >
                {t(keyed ? 'showSyncKey' : "showSyncCode")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    async () => {
                      await store.transaction(async () => ({ sync: null }));
                      if (dropbox) await new DropboxAuth(dropboxClientId()).disconnect();
                      else if (drive) await disconnectGoogle();
                      client.current = new SyncClient(providerFor(), store);
                    },
                    false,
                  )
                }
              >
                {t(dropbox ? 'disconnectDropbox' : drive ? 'disconnectDrive' : "disconnect")}
              </button>
            </div>
          </>
        ) : (
          <div className="dialog-actions settings-actions">
            {keyed ? <button type="button" disabled={!ready || busy || !configured}
              onClick={() => void run(dropbox ? connectDropbox : connectDrive)}>{t(dropbox ? 'connectDropbox' : 'connectDrive')}</button> : <>
            <button
              type="button"
              disabled={!ready || busy || !client.current}
              onClick={() => void run(() => client.current!.enable())}
            >
              {t("enableSync")}
            </button>
            <button
              type="button"
              disabled={!ready || busy || !client.current}
              onClick={() => {
                setConnecting(true);
                setPreview(null);
              }}
            >
              {t("connectExisting")}
            </button>
            </>}
          </div>
        )}
        {invalid && (
          <div className="dialog-actions settings-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  async () => {
                    await store.transaction(async () => ({ sync: null }));
                    if (dropbox) await new DropboxAuth(dropboxClientId()).disconnect();
                  },
                  false,
                )
              }
            >
                {t("disconnect")}
            </button>
          </div>
        )}
        {connecting && (
          <>
            <label>
              <span className="icon-label"><UiIcon name="key" />{t(keyed ? 'syncKey' : "syncCode")}</span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <p className="hint"><UiIcon name="lock" />{t(keyed ? 'syncKeyWarning' : "syncCodeWarning")}</p>
            <div className="dialog-actions settings-actions">
              <button
                type="button"
                disabled={busy || !code.trim()}
                onClick={() => void run(async () => {
                  if (!keyed) return client.current!.connect(code);
                  if (dropbox) {
                    const provider = DropboxProvider.configured(dropboxClientId());
                    const credentials = await dropboxCredentials(code);
                    const remote = await provider.readRemote(credentials);
                    if (!remote) throw Error(t('dropboxRemoteMissing'));
                    const result = await client.current!.connectProvider(credentials, remote) as Preview;
                    if (await hash(result.payload) === result.localHash) return client.current!.resolve(result, 'remote');
                    const local = await store.read();
                    return local.state.folders.length || local.state.conversations.length ? { ...result, kind: 'conflict' as const } : result;
                  }
                  const provider = GoogleDriveProvider.configured(googleClientId());
                  const remote = await provider.readRemote();
                  if (!remote) throw Error(t('driveRemoteMissing'));
                  return client.current!.connectProvider(await driveCredentials(code), remote);
                })}
              >
                {t("connectExisting")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setCode("");
                  setConnecting(false);
                }}
              >
                {t("cancel")}
              </button>
            </div>
          </>
        )}
        {shown && connection && (
          <>
            <p className="safety-note"><UiIcon name="lock" />{t(keyed ? 'syncKeyWarning' : "syncCodeWarning")}</p>
            <input
              type="text"
              aria-label={t(keyed ? 'syncKey' : "syncCode")}
              readOnly
              spellCheck={false}
              value={keyed ? driveKey(connection) : syncCode(connection)}
            />
            <div className="dialog-actions settings-actions">
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(keyed ? driveKey(connection) : syncCode(connection))
                    .then(() => setMessage(t("copied")))
                    .catch(() => setMessage(t("copyFailed")))
                }
              >
                {t("copy")}
              </button>
            </div>
          </>
        )}
        {preview && diff && (
          <section aria-label={t("syncPreview")}>
            <h3>
              <UiIcon name={preview.kind === 'conflict' ? 'warning' : 'download'} />
              {t(preview.kind === "conflict" ? "syncConflict" : "remoteFound")}
            </h3>
            <p className="hint">
              {t(
                preview.kind === "conflict"
                  ? "syncConflictDescription"
                  : "syncReplaceDescription",
              )}
            </p>
            <ul>
              {Object.entries(diff).map(([key, value]) => (
                <li key={key}>
                  {t(key as keyof typeof import("../i18n").messages.en)}:{" "}
                  {String(value)}
                </li>
              ))}
            </ul>
            <div className="dialog-actions settings-actions">
              {preview.kind === "conflict" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(() => client.current!.resolve(preview, "local"))
                  }
                >
                  {t("useThisDevice")}
                </button>
              )}
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(() => client.current!.resolve(preview, "remote"))
                }
              >
                {t(preview.kind === "conflict" ? "useRemote" : "apply")}
              </button>
              {preview.kind === "conflict" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const both = await client.current!.exportBoth(preview);
                      downloadJson("chat-explorer-sync-local.json", both.local);
                      downloadJson(
                        "chat-explorer-sync-remote.json",
                        both.remote,
                      );
                      return preview;
                    })
                  }
                >
                  {t("exportBoth")}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => { setPreview(null); clearAutoPreview(); }}
              >
                {t("cancel")}
              </button>
            </div>
          </section>
        )}
        {busy && <p role="status"><UiIcon name="sync" />{t("syncWorking")}</p>}
        {message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}
