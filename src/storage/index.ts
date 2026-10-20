import { webext } from "../utils/browser";
import { t } from "../i18n";
import { defaults, normalizeState } from "../models/state";
import type { AppState } from "../models/types";
import { migrateV1, migrateColorNames, migrateFolderPins } from "../models/migration";
export const STATE_KEY = "explorerState";
// Chrome storage does not promise object key order. Compare values canonically.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const object = entry as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(object)
          .sort()
          .map((key) => [key, object[key]]),
      );
    }
    return entry;
  });
}
export async function loadState(): Promise<{
  state: AppState;
  warning: string;
  readOnly: boolean;
}> {
  const data = await webext().storage.local.get(STATE_KEY);
  const raw = data[STATE_KEY];
  if (raw === undefined)
    return { state: defaults(), warning: "", readOnly: false };
  if (
    raw &&
    typeof raw === "object" &&
    "version" in raw &&
    typeof raw.version === "number" &&
    raw.version > 2
  )
    return {
      state: normalizeState(raw),
      warning: t("newerDataVersionOpenedReadonly"),
      readOnly: true,
    };
  const v1 = migrateV1(raw);
  const colored = migrateColorNames(v1);
  const migrated = migrateFolderPins(colored);
  const state = normalizeState(migrated);
  if (canonical(migrated) !== canonical(state)) {
    // Preserve the original before any repaired state can be written.
    const backup = await webext().storage.local.get("recoveryBackup");
    if (backup.recoveryBackup === undefined)
      await webext().storage.local.set({
        recoveryBackup: { savedAt: Date.now(), raw },
      });
    return {
      state,
      warning: t("dataRepairedOriginalBackupSaved"),
      readOnly: false,
    };
  }
  if (migrated !== raw) {
    const backupKey =
      v1 !== raw ? "migrationBackupV1" : colored !== v1 ? "migrationBackupColorNames" : "migrationBackupFolderPins";
    const backup = await webext().storage.local.get(backupKey);
    if (backup[backupKey] === undefined)
      await webext().storage.local.set({ [backupKey]: raw });
    await saveState(state);
  }
  return { state, warning: "", readOnly: false };
}
export function saveState(state: AppState) {
  return webext().storage.local.set({ [STATE_KEY]: state });
}
