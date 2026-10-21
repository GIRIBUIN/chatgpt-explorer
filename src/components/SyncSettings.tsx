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
import { DropboxAuth, DROPBOX_PENDING_KEY, DROPBOX_TOKEN_KEY, dropboxMessage } from '../sync/dropbox-auth';
import { DropboxProvider } from '../sync/dropbox';
import { authenticateDropbox, connectDropboxWorkspace, type DropboxConnectionOutcome } from '../sync/dropbox-connection';
import { localDropboxKey } from '../sync/dropbox-key';
import { prepareDropboxReset, resetDropboxWorkspace, type DropboxResetPreview } from '../sync/dropbox-recovery';
import { SyncError } from '../sync/api';
import { syncCode } from "../sync/crypto";
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
  const [dropboxAuthorized, setDropboxAuthorized] = useState(false);
  const [retainedKey, setRetainedKey] = useState<string | null>(null);
  const [keyIssue, setKeyIssue] = useState<'required' | 'incorrect' | null>(null);
  const [resetPreview, setResetPreview] = useState<DropboxResetPreview | null>(null);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  async function refreshDropboxLocal() {
    const data = await webext().storage.local.get(DROPBOX_TOKEN_KEY);
    setDropboxAuthorized(!!data[DROPBOX_TOKEN_KEY]);
    setRetainedKey(await localDropboxKey());
  }
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
    void refreshDropboxLocal();
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
      // OAuth may succeed while a remote read fails; show the actual saved connection.
      const saved = await storedSync().catch(() => null);
      setConnection(saved);
      await refreshDropboxLocal();
      setBusy(false);
      onBusy(false);
    }
  }
  const diff = preview ? syncDiff(state, preview.payload) : null;
  const dropbox = connection ? connection.provider === 'dropbox' : dropboxDefault();
  const drive = connection ? connection.provider === 'google-drive' : !dropbox && !legacyDefault();
  const keyed = drive || dropbox;
  const configured = dropbox ? !!dropboxClientId() : drive ? !!googleClientId() : !!__SYNC_ORIGIN__;
  function dropboxResult(result: DropboxConnectionOutcome): Outcome | void {
    if (result.kind !== 'key-required') return result;
    keyRequested.current = true;
    setConnecting(true);
    setKeyIssue(result.mismatch ? 'incorrect' : 'required');
    setResetPreview(null);
    setResetConfirmed(false);
    setShown(false);
    setCode('');
    setMessage(result.mismatch ? t('dropboxKeyMismatch') : '');
  }
  async function connectDropbox(changeAccount = false) {
    const auth = new DropboxAuth(dropboxClientId());
    await authenticateDropbox(auth, store, changeAccount);
    clearAutoPreview(); setPreview(null); setResetPreview(null); setKeyIssue(null);
    return connectAuthorizedWorkspace(new DropboxProvider(auth));
  }
  async function connectAuthorizedWorkspace(provider = DropboxProvider.configured(dropboxClientId())) {
    client.current = new SyncClient(provider, store);
    return dropboxResult(await connectDropboxWorkspace(provider, store));
  }
  async function disconnectProvider() {
    if (dropbox) await client.current!.disconnect();
    else await store.transaction(async () => ({ sync: null }));
    if (drive) await disconnectGoogle();
    client.current = new SyncClient(providerFor(), store);
    clearAutoPreview(); setPreview(null); setResetPreview(null); setKeyIssue(null); setResetConfirmed(false);
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
  const savedKeyOnly = dropbox && !connection;
  const visibleDropboxKey = dropbox ? connection ? driveKey(connection) : retainedKey : null;
  const canReset = state.folders.length > 0 || state.conversations.length > 0;
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
        {dropbox && !connection && <span>{t(dropboxAuthorized ? 'dropboxAuthorized' : 'syncDisconnected')}</span>}
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
                onClick={() => void run(dropbox ? () => connectDropbox() : connectDrive)}>{t(dropbox ? 'reconnectDropbox' : 'reconnectDrive')}</button>}
              <button
                type="button"
                disabled={busy || !client.current}
                onClick={() => void run(() => client.current!.now())}
              >
                {t("syncNow")}
              </button>
              {!dropbox && <button
                type="button"
                disabled={busy}
                aria-expanded={shown}
                onClick={() => setShown(!shown)}
              >
                {t(keyed ? 'showSyncKey' : "showSyncCode")}
              </button>}
              {dropbox && <button type="button" disabled={busy || !configured}
                onClick={() => void run(() => connectDropbox(true))}>{t('changeDropboxAccount')}</button>}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    disconnectProvider,
                    false,
                  )
                }
              >
                {t(dropbox ? 'disconnectDropbox' : drive ? 'disconnectDrive' : "disconnect")}
              </button>
            </div>
          </>
        ) : dropbox && dropboxAuthorized ? (
          <div className="dialog-actions settings-actions">
            <button type="button" disabled={!ready || busy || !client.current}
              onClick={() => void run(disconnectProvider, false)}>{t('disconnectDropbox')}</button>
            <button type="button" disabled={!ready || busy || !configured}
              onClick={() => void run(() => connectDropbox(true))}>{t('changeDropboxAccount')}</button>
            {!connecting && !preview && <button type="button" disabled={!ready || busy || !configured}
              onClick={() => void run(() => connectAuthorizedWorkspace())}>{t('continueWorkspaceConnection')}</button>}
          </div>
        ) : (
          <div className="dialog-actions settings-actions">
            {keyed ? <button type="button" disabled={!ready || busy || !configured}
              onClick={() => void run(dropbox ? () => connectDropbox() : connectDrive)}>{t(dropbox ? 'connectDropbox' : 'connectDrive')}</button> : <>
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
            {dropbox && <button type="button" disabled={!ready || busy || !configured}
              onClick={() => void run(() => connectDropbox(true))}>{t('connectAnotherDropboxAccount')}</button>}
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
            {dropbox && <>
              <h4>{t('existingSyncedWorkspace')}</h4>
              <p className="hint">{t('existingWorkspaceHelp')}</p>
              {!retainedKey && <p className="hint">{t('noSavedSyncKey')}</p>}
            </>}
            <label>
              <span className="icon-label"><UiIcon name="key" />{t(keyed ? 'syncKey' : "syncCode")}</span>
              <input
                type="password"
                autoComplete="off"
                autoCapitalize="off"
                placeholder={dropbox ? t("pasteSyncKey") : undefined}
                disabled={busy || !!resetPreview}
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <p className="hint"><UiIcon name="lock" />{t(keyed ? 'syncKeyWarning' : "syncCodeWarning")}</p>
            <div className="dialog-actions settings-actions">
              <button
                type="button"
                className={dropbox ? "primary" : undefined}
                disabled={busy || !!resetPreview || !code.trim()}
                onClick={() => void run(async () => {
                  if (!keyed) return client.current!.connect(code);
                  if (dropbox) {
                    const provider = DropboxProvider.configured(dropboxClientId());
                    client.current = new SyncClient(provider, store);
                    return dropboxResult(await connectDropboxWorkspace(provider, store, code));
                  }
                  const provider = GoogleDriveProvider.configured(googleClientId());
                  const remote = await provider.readRemote();
                  if (!remote) throw Error(t('driveRemoteMissing'));
                  return client.current!.connectProvider(await driveCredentials(code), remote);
                })}
              >
                {t(dropbox ? "connectExistingWorkspace" : "connectExisting")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setCode("");
                  setConnecting(false);
                  setKeyIssue(null); setResetPreview(null);
                }}
              >
                {t("cancel")}
              </button>
            </div>
          </>
        )}
        {dropbox && connecting && keyIssue && <section aria-label={t('lostSyncKey')}>
          <h4>{t('lostSyncKey')}</h4>
          <p className="hint">{t('lostSyncKeyHelp')}</p>
          <button type="button" disabled={busy || !canReset || !!resetPreview} onClick={() => void run(async () => {
            keyRequested.current = true;
            setResetConfirmed(false);
            setResetPreview(await prepareDropboxReset(DropboxProvider.configured(dropboxClientId()), store));
          })}>{t('resetSyncUsingDevice')}</button>
          {!canReset && <p className="hint">{t('resetSyncEmpty')}</p>}
          {resetPreview && <section aria-label={t('confirmSyncReset')}>
            <p className="safety-note"><UiIcon name="warning" />{t('resetSyncWarning')}</p>
            <label><input type="checkbox" checked={resetConfirmed} disabled={busy}
              onChange={e => setResetConfirmed(e.target.checked)} />{t('resetSyncConfirm')}</label>
            <div className="dialog-actions settings-actions">
              <button type="button" className="danger-button" disabled={busy || !resetConfirmed} onClick={() => void run(async () => {
                const result = await resetDropboxWorkspace(DropboxProvider.configured(dropboxClientId()), store, resetPreview, resetConfirmed);
                setResetPreview(null); setKeyIssue(null); setResetConfirmed(false);
                return result;
              })}>{t('replaceSyncData')}</button>
              <button type="button" disabled={busy} onClick={() => { setResetPreview(null); setResetConfirmed(false); }}>{t('cancel')}</button>
            </div>
          </section>}
        </section>}
        {visibleDropboxKey && <section aria-label={t(savedKeyOnly ? 'savedSyncKeyControls' : 'syncKeyControls')}>
          <h4>{t(savedKeyOnly ? 'savedSyncKey' : 'syncKey')}</h4>
          <p className="hint">{t(savedKeyOnly ? 'savedSyncKeyHelp' : 'syncKeyWarning')}</p>
          {savedKeyOnly && keyIssue === 'incorrect' && <p className="hint">{t('savedSyncKeyMismatch')}</p>}
          <input type={shown ? 'text' : 'password'} aria-label={t(savedKeyOnly ? 'savedSyncKey' : 'syncKey')} autoComplete="off" readOnly spellCheck={false} value={visibleDropboxKey} />
          <div className="dialog-actions settings-actions">
            <button type="button" disabled={busy} aria-expanded={shown} onClick={() => setShown(!shown)}>{t(savedKeyOnly ? shown ? 'hideSavedSyncKey' : 'showSavedSyncKey' : shown ? 'hideSyncKey' : 'showSyncKey')}</button>
            <button type="button" disabled={busy} onClick={() => void navigator.clipboard.writeText(visibleDropboxKey)
              .then(() => setMessage(t('copied'))).catch(() => setMessage(t('copyFailed')))}>{t(savedKeyOnly ? 'copySavedSyncKey' : 'copySyncKey')}</button>
          </div>
        </section>}
        {shown && connection && !dropbox && (
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
                      downloadJson("convoary-sync-local.json", both.local);
                      downloadJson(
                        "convoary-sync-remote.json",
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
