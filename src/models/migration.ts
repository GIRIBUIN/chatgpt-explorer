import { normalizeState } from "./state";
import { folderPinned } from './folders';

export function migrateFolderPins(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !('folders' in raw) || !Array.isArray(raw.folders)) return raw;
  let changed = false;
  const folders = raw.folders.map(value => {
    if (!value || typeof value !== 'object' || typeof value.favorite !== 'boolean') return value;
    changed = true;
    const { favorite: _legacy, ...folder } = value;
    void _legacy;
    return { ...folder, pinned: folderPinned(value) };
  });
  return changed ? { ...raw, folders } : raw;
}
// Additive v1 → v2 upgrade. Validation and corruption recovery remain separate.
export function migrateV1(raw: unknown): unknown {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("version" in raw) ||
    raw.version !== 1
  )
    return raw;
  const value = raw as Record<string, unknown>;
  return {
    ...value,
    version: 2,
    conversations: Array.isArray(value.conversations)
      ? value.conversations.map((c) =>
          c && typeof c === "object" ? { ...c, projectName: null } : c,
        )
      : value.conversations,
    settings:
      value.settings && typeof value.settings === "object"
        ? { ...value.settings, defaultOpenBehavior: "reuse" }
        : value.settings,
  };
}

// Additive v2 extension: HEX keys and all conversation assignments remain intact.
export function migrateColorNames(raw: unknown): unknown {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("colorRules" in raw) ||
    !Array.isArray(raw.colorRules)
  )
    return raw;
  const names = normalizeState(raw).colorRules;
  let changed = false;
  const colorRules = raw.colorRules.map((value) => {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.color !== "string" ||
      (typeof value.name === "string" && value.name.trim())
    )
      return value;
    const name = names.find((r) => r.color === value.color.toLowerCase())?.name;
    if (!name) return value;
    changed = true;
    return { ...value, name };
  });
  return changed ? { ...raw, colorRules } : raw;
}
