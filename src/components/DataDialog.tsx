import { useRef, useState } from "react";
import type { AppState } from "../models/types";
import { systemTheme, parseTheme } from "../models/theme";
import {
  applyWorkspace,
  exportWorkspace,
  parseWorkspace,
  workspaceDiff,
  type Workspace,
} from "../models/workspace";
import { webext } from "../utils/browser";
import { t } from "../i18n";
export function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function DataDialog({
  state,
  commit,
}: {
  state: AppState;
  commit: (
    update: (s: AppState) => AppState | Promise<AppState>,
  ) => Promise<boolean>;
}) {
  const themeInput = useRef<HTMLInputElement>(null);
  const workspaceInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{
      workspace: Workspace;
      basis: string;
      diff: ReturnType<typeof workspaceDiff>;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function read(file: File | undefined, kind: "theme" | "workspace") {
    if (!file) return;
    if (kind === "workspace") setPreview(null);
    setError("");
    try {
      if (file.size > 10 * 1024 * 1024) throw Error(t("fileTooLarge"));
      const raw: unknown = JSON.parse(await file.text());
      if (kind === "theme") {
        const theme = parseTheme(raw);
        if (!(await commit((s) => ({ ...s, theme }))))
          throw Error(t("saveFailed"));
      } else {
        const w = parseWorkspace(raw);
        setPreview({
          workspace: w,
          basis: JSON.stringify(exportWorkspace(state)),
          diff: workspaceDiff(state, w),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("invalidJson"));
    }
  }
  async function apply() {
    if (!preview || busy) return;
    setBusy(true);
    const ok = await commit(async (s) => {
      if (JSON.stringify(exportWorkspace(s)) !== preview.basis)
        throw Error(t("previewStale"));
      const next = applyWorkspace(s, preview.workspace);
      await webext().storage.local.set({
        workspaceBackup: { savedAt: Date.now(), state: s },
      });
      return next;
    });
    setBusy(false);
    if (ok) setPreview(null);
    else setError(t("saveFailed"));
  }
  const diff = preview?.diff;
  const stale =
    preview && JSON.stringify(exportWorkspace(state)) !== preview.basis;
  return (
    <section className="data-settings">
      <h3>{t("appearance")}</h3>
      <div className="settings-row" role="group" aria-label={t("theme")}>
        <span>{t("theme")}</span>
        <p className="hint">{t("themeDescription")}</p>
        <input
          ref={themeInput}
          hidden
          type="file"
          aria-label={t("importTheme")}
          accept=".json,application/json"
          onChange={(e) => {
            void read(e.target.files?.[0], "theme");
            e.target.value = "";
          }}
        />
        <div className="dialog-actions settings-actions">
          <button type="button" onClick={() => themeInput.current?.click()}>
            {t("importJson")}
          </button>
          <button
            type="button"
            aria-label={t("exportTheme")}
            onClick={() =>
              downloadJson(
                "chat-explorer-theme.json",
                state.theme ??
                  systemTheme(
                    window.matchMedia("(prefers-color-scheme: dark)").matches,
                  ),
              )
            }
          >
            {t("exportJson")}
          </button>
        </div>
      </div>
      <div
        className="settings-row"
        role="group"
        aria-label={t("resetThemeLabel")}
      >
        <span>{t("resetThemeLabel")}</span>
        <p className="hint">{t("resetThemeDescription")}</p>
        <div className="dialog-actions settings-actions">
          <button
            type="button"
            aria-label={t("resetTheme")}
            onClick={() =>
              void commit((s) => {
                const next = { ...s };
                delete next.theme;
                return next;
              })
            }
          >
            {t("reset")}
          </button>
        </div>
      </div>
      <h3>{t("data")}</h3>
      <div
        className="settings-row"
        role="group"
        aria-label={t("workspaceJson")}
      >
        <span>{t("workspaceJson")}</span>
        <p className="hint">{t("workspaceDescription")}</p>
        <input
          ref={workspaceInput}
          hidden
          type="file"
          aria-label={t("importWorkspace")}
          disabled={busy}
          accept=".json,application/json"
          onChange={(e) => {
            void read(e.target.files?.[0], "workspace");
            e.target.value = "";
          }}
        />
        <div className="dialog-actions settings-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => workspaceInput.current?.click()}
          >
            {t("importJson")}
          </button>
          <button
            type="button"
            aria-label={t("exportWorkspace")}
            onClick={() =>
              downloadJson(
                "chat-explorer-workspace.json",
                exportWorkspace(state),
              )
            }
          >
            {t("exportJson")}
          </button>
        </div>
      </div>
      <div className="settings-row" role="group" aria-label={t("backup")}>
        <span>{t("backup")}</span>
        <p className="hint">{t("backupDescription")}</p>
        <div className="dialog-actions settings-actions">
          <button
            type="button"
            aria-label={t("exportBackup")}
            onClick={() =>
              void webext()
                .storage.local.get("workspaceBackup")
                .then((data) => {
                  const backup = data.workspaceBackup as
                    { state?: AppState } | undefined;
                  if (backup?.state)
                    downloadJson(
                      "chat-explorer-workspace-backup.json",
                      exportWorkspace(backup.state),
                    );
                  else setError(t("noBackup"));
                })
                .catch(() => setError(t("saveFailed")))
            }
          >
            {t("exportBackupShort")}
          </button>
        </div>
      </div>
      {diff && (
        <section aria-label={t("preview")}>
          <h3>{t("preview")}</h3>
          <ul>
            {Object.entries(diff).map(([key, count]) => (
              <li key={key}>
                {t(key as keyof typeof import("../i18n").messages.en)}: {count}
              </li>
            ))}
          </ul>
          <p>{t("workspaceMergeHint")}</p>
          {stale && <p role="alert">{t("previewStale")}</p>}
          <div className="dialog-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || !!stale}
              onClick={() => void apply()}
            >
              {t("apply")}
            </button>
          </div>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
