import { SyncSettings } from "../components/SyncSettings";
import { UiIcon } from '../components/UiIcon';
import { FolderIcon } from '../components/FolderIcon';
import { TruncatedName } from '../components/TruncatedName';
import { FavoriteButton } from '../components/FavoriteButton';
import { FolderPinButton } from '../components/FolderPinButton';
import { sortFolders } from '../models/folders';
import { dragPayload, canDropItems, moveDraggedItems } from '../models/drag';
import { FolderColorFields } from '../components/FolderColorFields';
import { uiScale, scaleStep, scaleShortcut, menuPosition } from '../models/ui-scale';
import { extensionSyncStore } from "../sync/store";
import { stateLock } from "../sync/locks";
import type { Preview } from "../sync/client";

import type { SyncStore } from "../sync/client";
import {
  itemKey,
  selectItems,
  matchesSearch,
  matchesChat,
  renameItem,
  isTextInput,
} from "../models/explorer";
import { InlineRename } from "../components/InlineRename";
import { CommandPalette } from "../components/CommandPalette";
import { DataDialog } from "../components/DataDialog";
import { themeVariables } from "../models/theme";
import type { ImportCandidate } from "../models/import";
import { webext } from "../utils/browser";
import type { OpenBehavior } from "../models/types";
import { importFeedback } from "./import-feedback";
import { ItemDetails } from "../components/ItemDetails";
import { t } from "../i18n";
import type { ChatCandidate } from "../utils/discovery";
import { importChats } from "../models/import";
import { formatDate } from "../utils/date";
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import type {
  AppState,
  Conversation,
  Folder,
  Item,
  Location,
  Settings,
} from "../models/types";
import {
  addConversation,
  assignColor,
  colorName,
  renameColor,
  ancestors,
  canMoveFolder,
  defaults,
  deleteFolder,
  moveItem,
  sortConversations,
  startupLocation,
  validColor,
  validLocation,
} from "../models/state";
import { navigate, travel, type History } from "../utils/navigation";
import { loadState, saveState } from "../storage";
import { request } from "./api";
import { Dialog } from "../components/Dialog";
import { useMarquee } from './use-marquee';

type Editor =
  | { kind: "add"; title: string; url: string }
  | { kind: "new"; parentId: string | null }
  | { kind: "move" | "color" | "delete"; item: Item; items?: Item[] }
  | { kind: "settings" };
const nameOf = (s: AppState, item: Item) =>
  item.kind === "folder"
    ? s.folders.find((f) => f.id === item.id)?.name
    : s.conversations.find((c) => c.id === item.id)?.title;
export function App() {
  const [state, setState] = useState(defaults),
    [ready, setReady] = useState(false),
    [readOnly, setReadOnly] = useState(false),
    [notice, setNotice] = useState(""),
    [candidates, setCandidates] = useState<ChatCandidate[] | null>(null),
    [discovering, setDiscovering] = useState(false);
  const [selection, setSelection] = useState<{
    ids: string[];
    anchor: string | null;
  }>({ ids: [], anchor: null });
  const [renaming, setRenaming] = useState<(Item & { surface?: 'main' | 'sidebar' }) | null>(null);
  const [palette, setPalette] = useState(false);
  const [syncEpoch, setSyncEpoch] = useState(0);
  const [autoPreview, setAutoPreview] = useState<Preview | null>(null);
  const startupSyncSent = useRef(false);
  const [importSession, setImportSession] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [scanProgress, setScanProgress] = useState({ count: 0, projects: 0 });
  const sessionRef = useRef<string | null>(null);
  const current = useRef(state),
    queue = useRef(Promise.resolve()),
    addingCandidate = useRef(false),
    discoveryLock = useRef(false),
    searchRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<History>({
      entries: ["home"],
      index: 0,
    }),
    [search, setSearch] = useState(""),
    [editor, setEditor] = useState<Editor | null>(null),
    [menu, setMenu] = useState<{ item: Item; x: number; y: number; surface?: 'main' | 'sidebar' } | null>(
      null,
    ),
    [drag, setDrag] = useState<Item[] | null>(null),
    [over, setOver] = useState<string | null>(null);
  useEffect(() => {
    void loadState()
      .then((result) => {
        current.current = result.state;
        setState(result.state);
        setReadOnly(result.readOnly);
        setNotice(result.warning);
        setHistory({ entries: [startupLocation(result.state)], index: 0 });
        setReady(true);
      })
      .catch(() => {
        setNotice(t("storageReadFailed"));
        setReadOnly(true);
        setReady(true);
      });
  }, []);
  useEffect(() => {
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local" || !changes.explorerState || !changes.explorerSync) return;
      const task = queue.current.then(async () => {
        const loaded = await loadState();
        current.current = loaded.state;
        setState(loaded.state);
        if (changes.explorerSync) setSyncEpoch(e => e + 1);
      });
      queue.current = task.catch(() => {});
    };
    const result = (message: { type?: string; outcome?: Preview }, sender: chrome.runtime.MessageSender) => {
      if (sender.id === webext().runtime.id && !sender.tab && message.type === "auto-sync-result" && message.outcome?.kind === "conflict") {
        setAutoPreview(message.outcome);
        setNotice(t("syncConflict"));
      }
    };
    webext().storage.onChanged.addListener(changed);
    webext().runtime.onMessage.addListener(result);
    return () => {
      webext().storage.onChanged.removeListener(changed);
      webext().runtime.onMessage.removeListener(result);
    };
  }, []);
  useEffect(() => {
    if (!ready || readOnly || startupSyncSent.current) return;
    startupSyncSent.current = true;
    void webext().runtime.sendMessage({ type: "auto-sync-startup" }).catch(() => {});
  }, [ready, readOnly]);
  useEffect(() => {
    if (!notice || discovering) return;
    const timer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice, discovering]);
  useEffect(() => {
    const listener = (
      message: {
        type?: string;
        count?: number;
        projects?: number;
        sessionId?: string;
      },
      sender: chrome.runtime.MessageSender,
    ) => {
      if (
        sender.id === webext().runtime.id &&
        !sender.tab &&
        discoveryLock.current &&
        message?.type === "import-progress" &&
        message.sessionId === sessionRef.current &&
        Number.isSafeInteger(message.count) &&
        message.count! >= 0 &&
        Number.isSafeInteger(message.projects) &&
        message.projects! >= 0
      )
        setScanProgress((previous) => ({
          count: Math.max(previous.count, message.count!),
          projects: Math.max(previous.projects, message.projects!),
        }));
    };
    webext().runtime.onMessage.addListener(listener);
    return () => webext().runtime.onMessage.removeListener(listener);
  }, []);
  function commit(
    update: (s: AppState) => AppState | Promise<AppState>,
  ): Promise<boolean> {
    if (readOnly) {
      setNotice(t("readonlyDataUpdateTheExtension"));
      return Promise.resolve(false);
    }
    const task = queue.current.then(async () => {
      await stateLock(async () => {
      const fresh = await loadState();
      if (fresh.readOnly) throw Error(t("readonlyDataUpdateTheExtension"));
      const next = await update(fresh.state);
      await saveState(next);
      current.current = next;
      setState(next);
      });
    });
    queue.current = task.catch(() => {});
    return task.then(
      () => true,
      () => {
        setNotice(t("saveFailed"));
        return false;
      },
    );
  }
  const syncStore = extensionSyncStore;
  function setSelected(item: Item | null) {
    setSelection({
      ids: item ? [itemKey(item)] : [],
      anchor: item ? itemKey(item) : null,
    });
  }
  useEffect(() => {
    const root = document.documentElement;
    const variables = state.theme ? themeVariables(state.theme) : {};
    for (const [key, value] of Object.entries(variables))
      root.style.setProperty(key, value);
    return () => {
      for (const key of Object.keys(variables)) root.style.removeProperty(key);
    };
  }, [state.theme]);
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale(state.settings.uiScale) / 100));
    return () => { document.documentElement.style.removeProperty('--ui-scale'); };
  }, [state.settings.uiScale]);
  useEffect(() => {
    if (!ready) return;
    const onScaleKey = (event: globalThis.KeyboardEvent) => {
      const direction = scaleShortcut(event);
      if (direction === null) return;
      event.preventDefault(); // Also in dialogs/text inputs; never invokes browser page zoom.
      if (!readOnly) void commit(s => ({ ...s, settings: { ...s.settings, uiScale: scaleStep(s.settings.uiScale, direction) } }));
    };
    document.addEventListener('keydown', onScaleKey, true);
    return () => document.removeEventListener('keydown', onScaleKey, true);
  }, [ready, readOnly]);
  function settings(patch: Partial<Settings>) {
    void commit((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  }
  const location = validLocation(state, history.entries[history.index]);
  const folderId = location.startsWith("folder:") ? location.slice(7) : null;
  const path = ancestors(state.folders, folderId);
  function go(to: Location) {
    to = validLocation(current.current, to);
    setHistory((h) => navigate(h, to));
    setSearch("");
    setSelected(null);
    setMenu(null);
    settings({ lastLocation: to });
  }
  function back(delta: number) {
    const h = travel(history, delta);
    setHistory(h);
    setSearch("");
    setSelected(null);
    settings({ lastLocation: validLocation(state, h.entries[h.index]) });
  }
  function up() {
    if (folderId) {
      const parent = state.folders.find((f) => f.id === folderId)?.parentId;
      go(parent ? `folder:${parent}` : "home");
    } else go("home");
  }
  async function open(item: Item, mode?: OpenBehavior) {
    if (item.kind === "folder") {
      go(`folder:${item.id}`);
      return;
    }
    const c = current.current.conversations.find((c) => c.id === item.id);
    if (!c) return;
    try {
      await request("open-chat", c.url, mode);
      await commit((s) => ({
        ...s,
        conversations: s.conversations.map((x) =>
          x.id === c.id ? { ...x, lastOpenedAt: Date.now() } : x,
        ),
      }));
    } catch {
      setNotice(t("browserFailed"));
    }
  }
  function pinFolder(id: string) {
    void commit(s => ({ ...s, folders: s.folders.map(f => f.id === id ? { ...f, pinned: !f.pinned } : f) }));
    setMenu(null);
  }
  function favorite(item: Item) {
    if (item.kind !== 'conversation') return;
    void commit(s => ({ ...s, conversations: s.conversations.map(c => c.id === item.id ? { ...c, favorite: !c.favorite } : c) }));
    setMenu(null);
  }
  async function addCandidate(candidate: ChatCandidate) {
    if (addingCandidate.current) return;
    addingCandidate.current = true;
    setDiscovering(true);
    let duplicate = false;
    const ok = await commit((s) => {
      const result = addConversation(
        s,
        candidate.title,
        candidate.url,
        folderId,
      );
      duplicate = result.duplicate;
      if (duplicate) return result.state;
      return {
        ...result.state,
        conversations: result.state.conversations.map((c) =>
          c.id === result.conversation.id
            ? { ...c, originalTitle: candidate.title }
            : c,
        ),
      };
    });
    if (ok) {
      setCandidates(null);
      setNotice(t(duplicate ? "alreadyAdded" : "conversationAdded"));
    }
    addingCandidate.current = false;
    setDiscovering(false);
  }
  async function discover(importMode?: "page" | "tabs") {
    if (discoveryLock.current || discovering) return;
    discoveryLock.current = true;
    setDiscovering(true);
    if (importMode === "page") {
      sessionRef.current = crypto.randomUUID();
      setImportSession(sessionRef.current);
      setStopping(false);
      setScanProgress({ count: 0, projects: 0 });
      setNotice("");
    }
    try {
      if (importMode) {
        const scan =
          importMode === "page"
            ? await request<{
                candidates: ImportCandidate[];
                pageCount: number;
                failedPages: number;
                failureReason?: string | null;
                limitedPages?: number;
                stopped?: boolean;
                progress?: { count: number; projects: number };
                projectNames?: import("../content/project-names").ProjectNameMap;
              }>("import-chats", undefined, undefined, sessionRef.current!)
            : {
                candidates: await request<ChatCandidate[]>("import-open-tabs"),
                pageCount: 1,
                failedPages: 0,
                failureReason: null,
                limitedPages: 0,
                stopped: false,
                progress: undefined,
                projectNames: {},
              };
        if (scan.pageCount === 0 && !scan.stopped) {
          setNotice(t("noChatGPTPage"));
          return;
        }
        let message = "";
        const ok = await commit((s) => {
          const result = importChats(s, scan.candidates, scan.projectNames);
          message = importFeedback(result);
          return result.state;
        });
        if (ok)
          setNotice(
            [
              scan.failedPages && scan.candidates.length === 0 ? "" : message,
              scan.stopped
                ? t(
                    "stoppedProgress",
                    scan.progress ?? { count: 0, projects: 0 },
                  )
                : "",
              scan.failedPages
                ? t(
                    [
                      "sidebar-not-found",
                      "sidebar-closed",
                      "sidebar-open-timeout",
                    ].includes(scan.failureReason ?? "")
                      ? "sidebarNotFound"
                      : [
                            "content-script-unavailable",
                            "injection-failed",
                          ].includes(scan.failureReason ?? "")
                        ? "contentUnavailable"
                        : ["message-failed", "ping-timeout"].includes(
                              scan.failureReason ?? "",
                            )
                          ? "importMessageFailed"
                          : ["unsupported-page", "tab-navigated"].includes(
                                scan.failureReason ?? "",
                              )
                            ? "importUnsupported"
                            : "pagesSkipped",
                  )
                : "",
              scan.limitedPages ? t("scanLimited") : "",
            ]
              .filter(Boolean)
              .join(" "),
          );
      } else {
        const found = await request<ChatCandidate[]>("current-chat");
        if (found.length === 0) setNotice(t("noConversation"));
        else if (found.length === 1) await addCandidate(found[0]);
        else setCandidates(found);
      }
    } catch {
      setNotice(t("browserFailed"));
    } finally {
      sessionRef.current = null;
      setImportSession(null);
      setStopping(false);
      discoveryLock.current = false;
      setDiscovering(false);
    }
  }
  async function stopScan() {
    const id = sessionRef.current;
    if (!id || stopping) return;
    setStopping(true);
    try {
      await request("stop-import", undefined, undefined, id);
    } catch {
      if (sessionRef.current === id) {
        setStopping(false);
        setNotice(t("stopFailed"));
      }
    }
  }
  function showEditor(
    kind: "rename" | "move" | "color" | "delete",
    item: Item,
    surface: 'main' | 'sidebar' = 'main',
  ) {
    setMenu(null);
    if (kind === "rename") {
      setSelected(item);
      if (
        surface === 'main' && item.kind === "folder" &&
        !visibleItems.some((i) => itemKey(i) === itemKey(item))
      ) {
        const parent = state.folders.find((f) => f.id === item.id)?.parentId;
        settings({ colorFilter: "all", projectFilter: "all" });
        go(parent ? `folder:${parent}` : "home");
      }
      setRenaming({ ...item, surface });
      return;
    }
    const items = activeItems.some((i) => itemKey(i) === itemKey(item))
      ? activeItems
      : [item];
    if (kind === 'color' && items.some(i => i.kind !== item.kind)) return;
    setEditor({
      kind,
      item,
      items: kind === "color" ? items.filter(i => i.kind === item.kind) : items,
    });
  }
  function closeRename() {
    const id = renaming?.surface === 'sidebar' ? renaming.id : null;
    const focused = document.activeElement;
    const restoreFocus = id && focused instanceof HTMLInputElement &&
      focused.closest('[data-sidebar-folder-id]')?.getAttribute('data-sidebar-folder-id') === id;
    setRenaming(null);
    if (restoreFocus) requestAnimationFrame(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>('[data-sidebar-folder-id]'))
        .find(row => row.dataset.sidebarFolderId === id);
      row?.querySelector<HTMLButtonElement>('.tree-name')?.focus({ preventScroll: true });
    });
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape' && dragRef.current) {
      endDrag();
      return;
    }
    if (editor || candidates || palette) return;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      setPalette(true);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (isTextInput(e.target as HTMLElement)) return;
    if (e.key === 'F2') {
      e.preventDefault();
      if (readOnly || renaming) return;
      const target = e.target as HTMLElement;
      const id = target.closest('[data-sidebar-folder-id]')?.getAttribute('data-sidebar-folder-id');
      if (id && state.folders.some(f => f.id === id))
        showEditor('rename', { kind: 'folder', id }, 'sidebar');
      else if (!target.closest('aside') && activeItems.length === 1 && selected)
        showEditor('rename', selected);
      return;
    }
    if (e.key === "Escape") {
      setMenu(null);
      setSelected(null);
      return;
    }
    if ((e.altKey && e.key === "ArrowLeft") || e.key === "Backspace") {
      e.preventDefault();
      back(-1);
    } else if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      back(1);
    } else if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      up();
    } else if (selected && e.key === "Delete") {
      e.preventDefault();
      showEditor("delete", selected);
    }
  }
  const dragRef = useRef<Item[] | null>(null);
  const dragClick = useRef(false);
  function endDrag() {
    dragRef.current = null;
    setDrag(null);
    setOver(null);
    // Native drag normally suppresses click; also guard a trailing synthetic click.
    setTimeout(() => { dragClick.current = false; }, 0);
  }
  function dropProps(target: string | null, zone = target ?? 'system') {
    const valid = !readOnly && !!drag && canDropItems(state, drag, target);
    return {
      onDragOver: (e: DragEvent) => {
        const items = dragRef.current;
        if (!items) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = !readOnly && canDropItems(current.current, items, target) ? 'move' : 'none';
        setOver(zone);
      },
      onDragLeave: (e: DragEvent) => {
        if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setOver(null);
      },
      onDrop: (e: DragEvent) => {
        const items = dragRef.current;
        if (!items) return;
        e.preventDefault();
        e.stopPropagation();
        if (!readOnly && canDropItems(current.current, items, target)) {
          void commit(s => moveDraggedItems(s, items, target)).then(ok => {
            if (ok) setSelected(null);
          });
        }
        endDrag();
      },
      'data-drop': drag && over === zone ? (valid ? 'valid' : 'invalid') : undefined,
    };
  }
  const dragProps = (item: Item) => ({
    draggable: !readOnly && !renaming,
    onClickCapture: (e: React.MouseEvent) => {
      if (dragClick.current) { e.preventDefault(); e.stopPropagation(); }
    },
    onDragStart: (e: DragEvent) => {
      if (readOnly || renaming || isTextInput(e.target as HTMLElement)) { e.preventDefault(); return; }
      const items = dragPayload(current.current, item, activeItems);
      if (!items.length) { e.preventDefault(); return; }
      if (!selection.ids.includes(itemKey(item))) setSelected(item);
      dragClick.current = true;
      dragRef.current = items;
      setDrag(items);
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-chat-explorer', JSON.stringify(items));
    },
    onDragEnd: endDrag,
  });
  function context(e: React.MouseEvent, item: Item) {
    e.preventDefault();
    if (!selection.ids.includes(itemKey(item))) setSelected(item);
    setMenu({
      item,
      surface: e.currentTarget.closest('[data-sidebar-folder-id]') ? 'sidebar' : 'main',
      ...menuPosition(e.clientX, e.clientY, window.innerWidth, window.innerHeight, state.settings.uiScale),
    });
  }
  function folderTree() {
    const rows: { folder: Folder; depth: number }[] = [];
    const stack = sortFolders(state.folders.filter(f => f.parentId === null), (a, b) => a.name.localeCompare(b.name))
      .reverse()
      .map((folder) => ({ folder, depth: 0 }));
    while (stack.length) {
      const entry = stack.pop()!;
      rows.push(entry);
      if (!state.settings.collapsed.includes(entry.folder.id))
        stack.push(
          ...sortFolders(state.folders.filter(f => f.parentId === entry.folder.id), (a, b) => a.name.localeCompare(b.name))
            .reverse()
            .map((folder) => ({ folder, depth: entry.depth + 1 })),
        );
    }
    return rows.map(({ folder: f, depth }) => (
      <div
        className={`tree-row ${folderId === f.id ? "active" : ""}`}
        data-sidebar-folder-id={f.id}
        key={f.id}
        style={{ paddingLeft: 8 + depth * 16 }}
        {...dropProps(f.id)}
        {...dragProps({ kind: "folder", id: f.id })}
        onPointerDownCapture={e => {
          if (renaming?.surface === 'sidebar' && renaming.id === f.id &&
            e.button === 0 && !isTextInput(e.target as HTMLElement)) e.preventDefault();
        }}
        onContextMenu={(e) => context(e, { kind: "folder", id: f.id })}
      >
        <button
          className="chevron"
          disabled={(renaming?.surface === 'sidebar' && renaming.id === f.id) || !state.folders.some((x) => x.parentId === f.id)}
          aria-label={`${f.name} ${state.settings.collapsed.includes(f.id) ? t("expand") : t("collapse")}`}
          aria-expanded={!state.settings.collapsed.includes(f.id)}
          onClick={() =>
            settings({
              collapsed: state.settings.collapsed.includes(f.id)
                ? state.settings.collapsed.filter((id) => id !== f.id)
                : [...state.settings.collapsed, f.id],
            })
          }
        >
          {state.folders.some((x) => x.parentId === f.id)
            ? <UiIcon name={state.settings.collapsed.includes(f.id) ? 'chevronRight' : 'chevronDown'} />
            : null}
        </button>
        {renaming?.surface === 'sidebar' && renaming.id === f.id ? <div className="tree-name tree-name-editing">
          <span className="folder-icon" aria-hidden="true"><FolderIcon color={f.color} /></span>
          <InlineRename value={f.name} save={name => commit(s => renameItem(s, { kind: 'folder', id: f.id }, name))}
            close={closeRename} />
        </div> : <button
          className="tree-name"
          onClick={() => go(`folder:${f.id}`)}
        >
          <span className="folder-icon" aria-hidden="true"><FolderIcon color={f.color} /></span>
          <TruncatedName>{f.name}</TruncatedName>
        </button>}
        <FolderPinButton pinned={!!f.pinned} name={f.name} onToggle={() => pinFolder(f.id)}
          disabled={renaming?.kind === 'folder' && renaming.id === f.id} />
      </div>
    ));
  }
  const query = search.trim().toLocaleLowerCase();
  const filterChats = (items: Conversation[]) =>
    sortConversations(
      state,
      items.filter((c) =>
        matchesChat(state, c, search, state.settings.projectFilter ?? "all"),
      ),
    );
  let folders: Folder[] = [],
    chats: Conversation[] = [];
  if (query) {
    folders = state.folders.filter((f) =>
      matchesSearch(search, { name: f.name }),
    );
    chats = state.conversations.filter((c) =>
      matchesChat(state, c, search, state.settings.projectFilter ?? "all"),
    );
  } else if (location === "favorites") {
    folders = [];
    chats = state.conversations.filter((c) => c.favorite);
  } else if (location === "home") {
    folders = state.folders.filter((f) => !f.parentId);
  } else {
    folders = folderId
      ? state.folders.filter((f) => f.parentId === folderId)
      : [];
    chats = state.conversations.filter((c) => c.folderId === folderId);
  }
  if (location === "favorites") folders = [];
  folders = sortFolders(folders,
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }) *
      (state.settings.direction === "asc" ? 1 : -1),
  );
  chats = filterChats(chats);
  const homeFavorites = filterChats(
    state.conversations.filter((c) => c.favorite),
  );
  const homeRecent = filterChats(
    state.conversations.filter((c) => c.lastOpenedAt !== null && !c.favorite),
  )
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
    .slice(0, 20);
  const asItems = (fs: Folder[], cs: Conversation[]): Item[] => [
    ...fs.map((f) => ({ kind: "folder" as const, id: f.id })),
    ...cs.map((c) => ({ kind: "conversation" as const, id: c.id })),
  ];
  const visibleItems = [
    ...new Map(
      (location === "home" && !query
        ? [
            ...asItems([], homeFavorites),
            ...asItems(folders, homeRecent),
          ]
        : asItems(folders, chats)
      ).map((i) => [itemKey(i), i]),
    ).values(),
  ];
  const activeItems = visibleItems.filter((i) =>
    selection.ids.includes(itemKey(i)),
  );
  const marquee = useMarquee({ keys: visibleItems.map(itemKey), selection, select: setSelection,
    scope: JSON.stringify([location, search, state.settings.projectFilter, state.settings.colorFilter,
      state.settings.sort, state.settings.direction, state.settings.uiScale, visibleItems.map(itemKey)]),
    disabled: !!(editor || candidates || palette || drag),
  });
  const mixedSelection = activeItems.some(i => i.kind === 'folder') &&
    activeItems.some(i => i.kind === 'conversation');
  const selected = activeItems[0] ?? null;
  const projects = [
    ...new Map(
      state.conversations
        .filter((c) => c.projectId)
        .map((c) => [c.projectId!, c.projectName ?? c.projectId!]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const usedColors = [...new Set(state.conversations.map((c) => c.color))];
  const title = query
    ? t("searchResults")
    : location === "home"
      ? t("home")
      : location === "favorites"
        ? t("favorites")
        : location === "inbox"
          ? t("inbox")
          : (path.at(-1)?.name ?? t("home"));
  function row(item: Item) {
    const f =
      item.kind === "folder"
        ? state.folders.find((f) => f.id === item.id)
        : undefined;
    const c =
      item.kind === "conversation"
        ? state.conversations.find((c) => c.id === item.id)
        : undefined;
    if (!f && !c) return null;
    const active = selection.ids.includes(itemKey(item));
    return (
      <div
        role="row"
        tabIndex={0}
        aria-selected={active}
        className={`item-row ${active ? "selected" : ""}`}
        data-item-key={itemKey(item)}
        key={`${item.kind}:${item.id}`}
        onClick={(e) => {
          setSelection((previous) =>
            selectItems(
              previous.ids,
              previous.anchor,
              itemKey(item),
              visibleItems.map(itemKey),
              e.ctrlKey || e.metaKey,
              e.shiftKey,
            ),
          );
          setMenu(null);
        }}
        onDoubleClick={(e) => {
          if (!e.ctrlKey && !e.shiftKey) void open(item);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target === e.currentTarget) {
            e.preventDefault();
            void open(item);
          }
          if (
            (e.key === "ArrowDown" || e.key === "ArrowUp") &&
            e.target === e.currentTarget
          ) {
            e.preventDefault();
            const rows = Array.from(
              document.querySelectorAll<HTMLElement>(".item-row"),
            );
            const next =
              rows[
                rows.indexOf(e.currentTarget) + (e.key === "ArrowDown" ? 1 : -1)
              ];
            next?.focus();
            next?.click();
          }
        }}
        onContextMenu={(e) => context(e, item)}
        {...dragProps(item)}
        {...(f ? dropProps(f.id) : {})}
      >
        <ItemDetails
          folder={f}
          conversation={c}
          onColor={() => {
            setSelected(item);
            setEditor({ kind: "color", item });
          }}
          nameEditor={
            renaming && renaming.surface !== 'sidebar' && itemKey(renaming) === itemKey(item) ? (
              <InlineRename
                value={f?.name ?? c?.title ?? ""}
                save={(name) => commit((s) => renameItem(s, item, name))}
                close={closeRename}
              />
            ) : undefined
          }
        />
        <span role="cell" className="date-cell">
          {formatDate(c?.lastOpenedAt ?? null)}
        </span>
        <span role="cell" className="row-actions">
          {f ? <FolderPinButton pinned={!!f.pinned} name={f.name} onToggle={() => pinFolder(f.id)}
              disabled={renaming?.kind === 'folder' && renaming.id === f.id} />
            : <FavoriteButton favorite={!!c?.favorite} name={c?.title ?? ""} onToggle={() => favorite(item)} />}
          <button
            className="row-menu"
            aria-label={t("itemMenu", { name: f?.name ?? c?.title ?? "" })}
            title={t("itemActions")}
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              if (!selection.ids.includes(itemKey(item))) setSelected(item);
              setMenu({
                item,
                ...menuPosition(rect.left, rect.bottom, window.innerWidth, window.innerHeight, state.settings.uiScale),
              });
            }}
          >
            <UiIcon name="more" />
          </button>
        </span>
      </div>
    );
  }
  const list = (fs: Folder[], cs: Conversation[]) => [
    ...fs.map((f) => row({ kind: "folder", id: f.id })),
    ...cs.map((c) => row({ kind: "conversation", id: c.id })),
  ];
  useEffect(() => {
    // A freshly opened Explorer can have body focus, outside React's app wrapper.
    const selectVisible = (e: globalThis.KeyboardEvent) => {
      if (!ready || editor || candidates || palette || e.defaultPrevented ||
        !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'a' ||
        !(e.target instanceof Element) || isTextInput(e.target, false)) return;
      e.preventDefault();
      setSelection({
        ids: visibleItems.map(itemKey),
        anchor: visibleItems[0] ? itemKey(visibleItems[0]) : null,
      });
    };
    document.addEventListener('keydown', selectVisible);
    return () => document.removeEventListener('keydown', selectVisible);
  }, [ready, editor, candidates, palette, visibleItems]);
  if (!ready) return <div className="loading">{t("loading")}</div>;
  return (
    <div className="app" onKeyDown={key}>
      {drag && <div className="drag-count" role="status">{t(drag.length === 1 ? 'movingItem' : 'movingItems', { count: drag.length })}</div>}
      <div className="toolbar">
        <div className="nav-buttons">
          <button
            title={t("backAltLeft")}
            aria-label={t("back")}
            disabled={history.index === 0}
            onClick={() => back(-1)}
          >
            <UiIcon name="back" />
          </button>
          <button
            title={t("forwardAltRight")}
            aria-label={t("forward")}
            disabled={history.index === history.entries.length - 1}
            onClick={() => back(1)}
          >
            <UiIcon name="forward" />
          </button>
        </div>
        <nav className="breadcrumb" aria-label={t("breadcrumb")}>
          <button onClick={() => go("home")}><UiIcon name="home" />{t("home")}</button>
          {path.map((f) => (
            <span key={f.id}>
              {" "}
              <UiIcon name="chevronRight" /><button onClick={() => go(`folder:${f.id}`)}>{f.name}</button>
            </span>
          ))}
          {!folderId && location !== "home" && <span><UiIcon name="chevronRight" />{title}</span>}
        </nav>
        <label className="search-field">
          <UiIcon name="search" />
          <input
            ref={searchRef}
            type="search"
            aria-label={t("search")}
            placeholder={t("search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button
          className="settings-button"
          onClick={() => setEditor({ kind: "settings" })}
          title={t("settings")}
          aria-label={t("settings")}
        >
          <UiIcon name="settings" size={18} />
        </button>
      </div>
      <div className="commandbar">
        <button onClick={() => setEditor({ kind: "new", parentId: folderId })}>
          <UiIcon name="newFolder" />{t("newFolder")}
        </button>
        <button disabled={discovering} onClick={() => void discover()}>
          <UiIcon name="currentChat" />{t("currentChat")}
        </button>
        <button disabled={discovering} onClick={() => void discover("page")}>
          <UiIcon name="import" />{t("importChats")}
        </button>
        <details
          className="overflow"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null))
              e.currentTarget.open = false;
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.currentTarget.open = false;
              e.stopPropagation();
            }
          }}
        >
          <summary aria-label={t("moreActions")} title={t("moreActions")}>
            <UiIcon name="more" />
          </summary>
          <div className="overflow-menu">
            <button onClick={() => setPalette(true)}>
              <UiIcon name="commands" />{t("commandPalette")}
            </button>
            <button
              onClick={(e) => {
                e.currentTarget.closest("details")?.removeAttribute("open");
                setEditor({ kind: "add", title: "", url: "" });
              }}
            >
              <UiIcon name="connect" />{t("addByUrl")}
            </button>
            <button
              disabled={discovering}
              onClick={(e) => {
                e.currentTarget.closest("details")?.removeAttribute("open");
                void discover("tabs");
              }}
            >
              <UiIcon name="import" />{t("importOpenTabs")}
            </button>
          </div>
        </details>
        <div className="spacer" />
        <label>
          <select
            aria-label={t("sortBy")}
            value={state.settings.sort}
            onChange={(e) =>
              settings({ sort: e.target.value as Settings["sort"] })
            }
          >
            <option value="name">{t("name")}</option>
            <option value="color">{t("color")}</option>
            <option value="opened">{t("recentlyOpened")}</option>
            <option value="added">{t("recentlyAdded")}</option>
          </select>
        </label>
        <button
          title={t("sortDirection")}
          aria-label={t("sortDirection")}
          onClick={() =>
            settings({
              direction: state.settings.direction === "asc" ? "desc" : "asc",
            })
          }
        >
          <UiIcon name={state.settings.direction === 'asc' ? 'sortAscending' : 'sortDescending'} />
        </button>
      </div>
      {(notice || importSession) && (
        <div className="notice" role="status">
          <UiIcon name="info" />
          <span>{importSession ? t("scanFound", scanProgress) : notice}</span>
          {importSession ? (
            <button disabled={stopping} onClick={() => void stopScan()}>
              {t(stopping ? "stoppingImport" : "stopImport")}
            </button>
          ) : (
            <button
              title={t("dismiss")}
              aria-label={t("dismiss")}
              onClick={() => setNotice("")}
            >
              <UiIcon name="close" />
            </button>
          )}
        </div>
      )}
      <div className="workspace">
        <aside aria-label={t("navigation")}>
          <button
            className={`side-link ${location === "home" ? "active" : ""}`}
            onClick={() => go("home")}
            {...dropProps(null, 'system:home')}
          >
            <UiIcon name="home" />{t("home")}
          </button>
          <button
            className={`side-link ${location === "favorites" ? "active" : ""}`}
            onClick={() => go("favorites")}
            {...dropProps(null, 'system:favorites')}
          >
            <UiIcon name="favorite" />{t("favorites")}
          </button>
          <button
            className={`side-link ${location === "inbox" ? "active" : ""}`}
            onClick={() => go("inbox")}
            {...dropProps(null, 'system:inbox')}
          >
            <UiIcon name="inbox" />{t("inbox")}{" "}
            <span className="count">
              {state.conversations.filter((c) => !c.folderId).length}
            </span>
          </button>
          <div className="side-heading" {...dropProps(null, 'system:folders')}>
            {t("fOLDERS")}{" "}
            <button
              aria-label={t("newRootFolder")}
              title={t("newRootFolder")}
              onClick={() => setEditor({ kind: "new", parentId: null })}
            >
              <UiIcon name="newFolder" />
            </button>
          </div>
          <div className="tree">{folderTree()}</div>
        </aside>
        <main ref={marquee.ref} {...marquee.handlers} onClick={() => setMenu(null)}
          className={marquee.rectangle ? 'marquee-active' : undefined}>
          {marquee.rectangle && <div className="selection-marquee" aria-hidden="true" style={{
            left: marquee.rectangle.x, top: marquee.rectangle.y,
            width: marquee.rectangle.width, height: marquee.rectangle.height,
          }} />}
          <div className="view-heading">
            <h1>{title}</h1>
            <select
              aria-label={t("projectFilter")}
              value={state.settings.projectFilter ?? "all"}
              onChange={(e) => settings({ projectFilter: e.target.value })}
            >
              <option value="all">{t("allProjects")}</option>
              <option value="none">{t("noProject")}</option>
              {projects.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label={t("colorFilter")}
              value={state.settings.colorFilter}
              onChange={(e) => settings({ colorFilter: e.target.value })}
            >
              <option value="all">{t("allColors")}</option>
              {[
                ...new Set([
                  ...usedColors,
                  ...(state.settings.colorFilter === "all"
                    ? []
                    : [state.settings.colorFilter]),
                ]),
              ].map((c) => (
                <option key={c} value={c}>
                  {colorName(state, c)}
                </option>
              ))}
            </select>
          </div>
          <div
            className="file-list"
            role="grid"
            aria-multiselectable="true"
            aria-label={title}
          >
            <div className="table-heading" role="row">
              <span role="columnheader">{t("name")}</span>
              <span role="columnheader">{t("color")}</span>
              <span className="date-cell" role="columnheader">
                {t("lastOpened")}
              </span>
              <span />
            </div>
            {location === "home" && !query ? (
              <>
                <h3>{t("favorites")}</h3>
                {list([], homeFavorites)}
                {!state.conversations.some((c) => c.favorite) && (
                    <p className="empty-small">{t("noItems")}</p>
                  )}
                <h3>{t("folders")}</h3>
                {list(folders, [])}
                {!folders.length && (
                  <p className="empty-small">{t("noItems")}</p>
                )}
                <h3>{t("recent")}</h3>
                {list([], homeRecent)}
                {!state.conversations.some((c) => c.lastOpenedAt) && (
                  <p className="empty-small">{t("noItems")}</p>
                )}
              </>
            ) : (
              list(folders, chats)
            )}
            {(location !== "home" || query) &&
              folders.length + chats.length === 0 && (
                <div className="empty">{t("noItems")}</div>
              )}
          </div>
        </main>
      </div>
      {menu && (
        <>
          <div className="menu-dismiss" onClick={() => setMenu(null)} />
          <div
            className="context-menu"
            role="menu"
            aria-label={t("itemActions")}
            style={{ left: menu.x, top: menu.y }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setMenu(null);
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const buttons = Array.from(
                  e.currentTarget.querySelectorAll("button"),
                );
                const i = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                buttons[
                  (i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                    buttons.length
                ]?.focus();
              }
            }}
          >
            <button
              role="menuitem"
              autoFocus
              onClick={() => {
                void open(menu.item);
                setMenu(null);
              }}
            >
              {t("open")}
              <kbd>{t("enter")}</kbd>
            </button>
            {menu.item.kind === "conversation" && (
              <>
                <button
                  role="menuitem"
                  onClick={() => {
                    void open(menu.item, "new-tab");
                    setMenu(null);
                  }}
                >
                  {t("openNewTab")}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    void open(menu.item, "new-window");
                    setMenu(null);
                  }}
                >
                  {t("openNewWindow")}
                </button>
                <hr />
              </>
            )}
            {menu.item.kind === "folder" && (
              <button
                role="menuitem"
                onClick={() => {
                  setEditor({ kind: "new", parentId: menu.item.id });
                  setMenu(null);
                }}
              >
                <span className="icon-label"><UiIcon name="newFolder" />{t("newFolder")}</span>
              </button>
            )}
            <button
              role="menuitem"
              onClick={() => showEditor("rename", menu.item, menu.surface)}
            >
              {t("rename")}
              <kbd>{t("f2")}</kbd>
            </button>
            <button
              role="menuitem"
              onClick={() => showEditor("move", menu.item)}
            >
              {t("move")}
            </button>
              <button
                role="menuitem"
                disabled={mixedSelection}
                onClick={() => showEditor("color", menu.item)}
              >
                {t("colorAction")}
              </button>
            <button role="menuitem" onClick={() => menu.item.kind === 'folder' ? pinFolder(menu.item.id) : favorite(menu.item)}>
              <span className="icon-label"><UiIcon name={menu.item.kind === 'folder' ? 'pin' : 'favorite'} />
              {menu.item.kind === 'folder'
                ? t(state.folders.find(f => f.id === menu.item.id)?.pinned ? 'unpinFolder' : 'pinFolder')
                : t(state.conversations.find(c => c.id === menu.item.id)?.favorite ? 'removeFromFavorites' : 'addToFavorites')}
              </span>
            </button>
            <hr />
            <button
              role="menuitem"
              className="danger"
              onClick={() => showEditor("delete", menu.item)}
            >
              {menu.item.kind === "folder"
                ? t("deleteFolderAction")
                : t("removeFromExplorerAction")}
            </button>
          </div>
        </>
      )}
      {candidates && (
        <Dialog
          title={t("chooseConversation")}
          onClose={() => setCandidates(null)}
        >
          <div className="candidate-list">
            {candidates.map((c) => (
              <button
                key={c.id}
                disabled={discovering}
                onClick={() => void addCandidate(c)}
              >
                <strong>{c.title}</strong>
                <small>{c.url}</small>
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {palette && (
        <CommandPalette
          close={() => setPalette(false)}
          commands={[
            {
              label: t("newFolder"),
              enabled: !readOnly,
              run: () => setEditor({ kind: "new", parentId: folderId }),
            },
            {
              label: t("rename"),
              enabled: activeItems.length === 1 && !readOnly,
              run: () => selected && showEditor("rename", selected),
            },
            {
              label: t("move"),
              enabled: activeItems.length > 0 && !readOnly,
              run: () => selected && showEditor("move", selected),
            },
            {
              label: t("colorAction"),
              enabled:
                activeItems.length > 0 && !mixedSelection && !readOnly,
              run: () => selected && showEditor("color", selected),
            },
            ...([true, false] as const).map(value => ({
              label: t(value ? 'pinFolder' : 'unpinFolder'),
              enabled: activeItems.some(i => i.kind === 'folder') && !readOnly,
              run: () => { void commit(s => ({ ...s, folders: s.folders.map(f =>
                activeItems.some(i => i.kind === 'folder' && i.id === f.id) ? { ...f, pinned: value } : f) })); },
            })),
            ...([true, false] as const).map(value => ({
              label: t(value ? 'addToFavorites' : 'removeFromFavorites'),
              enabled: activeItems.some(i => i.kind === 'conversation') && !readOnly,
              run: () => { void commit(s => ({ ...s, conversations: s.conversations.map(c =>
                activeItems.some(i => i.kind === 'conversation' && i.id === c.id) ? { ...c, favorite: value } : c) })); },
            })),
            {
              label: t("removeFromExplorer"),
              enabled: activeItems.length > 0 && !readOnly,
              run: () => selected && showEditor("delete", selected),
            },
            {
              label: t("importChats"),
              enabled: !discovering && !readOnly,
              run: () => void discover("page"),
            },
            {
              label: t("currentChat"),
              enabled: !discovering && !readOnly,
              run: () => void discover(),
            },
            ...([undefined, "new-tab", "new-window"] as const).map((mode) => ({
              label: t(
                mode === "new-tab"
                  ? "openNewTab"
                  : mode === "new-window"
                    ? "openNewWindow"
                    : "open",
              ),
              enabled:
                activeItems.length === 1 &&
                (!mode || selected?.kind === "conversation"),
              run: () => {
                if (selected) void open(selected, mode);
              },
            })),
          ]}
        />
      )}
      {editor && (
        <EditorDialog
          key={`${JSON.stringify(editor)}:${syncEpoch}`}
          editor={editor}
          syncStore={syncStore}
          autoPreview={autoPreview}
          clearAutoPreview={() => setAutoPreview(null)}
          state={state}
          folderId={folderId}
          commit={commit}
          close={() => setEditor(null)}
          notice={setNotice}
          go={go}
        />
      )}
    </div>
  );
}

function EditorDialog({
  autoPreview,
  clearAutoPreview,
  syncStore,
  editor,
  state,
  folderId,
  commit,
  close,
  notice,
  go,
}: {
  autoPreview: Preview | null;
  clearAutoPreview: () => void;
  editor: Editor;
  syncStore: SyncStore;
  state: AppState;
  folderId: string | null;
  commit: (
    fn: (s: AppState) => AppState | Promise<AppState>,
  ) => Promise<boolean>;
  close: () => void;
  notice: (s: string) => void;
  go: (l: Location) => void;
}) {
  const [syncBusy, setSyncBusy] = useState(false);
  const item = "item" in editor ? editor.item : null;
  const items = item
    ? "items" in editor
      ? (editor.items ?? [item])
      : [item]
    : [];
  const chat =
    item?.kind === "conversation"
      ? state.conversations.find((c) => c.id === item.id)
      : null;
  const folder =
    item?.kind === "folder"
      ? state.folders.find((f) => f.id === item.id)
      : null;
  const [name, setName] = useState(
      editor.kind === "add"
        ? editor.title
        : item
          ? (nameOf(state, item) ?? "")
          : "",
    ),
    [url, setUrl] = useState(editor.kind === "add" ? editor.url : ""),
    [target, setTarget] = useState(folder?.parentId ?? chat?.folderId ?? ""),
    [color, setColor] = useState(chat?.color ?? folder?.color ?? (folder ? '' : '#ffffff')),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [prefs, setPrefs] = useState(state.settings),
    [colors, setColors] = useState(state.colorRules.map((r) => r.color));
  const initialColorOrder = useRef(colors.join(","));
  const [colorNames, setColorNames] = useState<Record<string, string>>({});
  const shownColorName = (c: string) =>
    colorNames[c.toLowerCase()] ?? colorName(state, c);
  const editColorName = (c: string, value: string) =>
    setColorNames((names) => ({ ...names, [c.toLowerCase()]: value }));
  const titles = {
    add: t("addByUrl"),
    new: t("newFolder"),
    move: t("moveToFolder"),
    color: t(item?.kind === "folder" ? "folderColor" : "colorLabel"),
    delete:
      item?.kind === "folder" ? t("deleteFolder") : t("removeFromExplorer"),
    settings: t("settings"),
  };
  async function submit() {
    setError("");
    setBusy(true);
    try {
      if ((editor.kind === "add" || editor.kind === "new") && !name.trim())
        throw Error(t("enterAName"));
      if (editor.kind === "color" && !validColor(color) && !(color === '' && items.every(i => i.kind === 'folder')))
        throw Error(t("enterAColorAsRRGGBB"));
      if (Object.values(colorNames).some((value) => !value.trim()))
        throw Error(t("enterAName"));
      let duplicate: Conversation | undefined;
      const ok = await commit((s) => {
        if (editor.kind === "add") {
          const result = addConversation(s, name, url, folderId);
          if (result.duplicate) duplicate = result.conversation;
          return result.state;
        }
        if (editor.kind === "new") {
          if (
            editor.parentId &&
            !s.folders.some((f) => f.id === editor.parentId)
          )
            throw Error(t("parentFolderNotFound"));
          return {
            ...s,
            folders: [
              ...s.folders,
              {
                id: crypto.randomUUID(),
                name: name.trim(),
                parentId: editor.parentId,
                createdAt: Date.now(),
                pinned: false,
              },
            ],
            settings: {
              ...s.settings,
              collapsed: s.settings.collapsed.filter(
                (id) => id !== editor.parentId,
              ),
            },
          };
        }
        if (editor.kind === "settings") {
          if (prefs.startup === "folder" && !prefs.startupFolderId)
            throw Error(t("chooseAStartupFolder"));
          return {
            ...s,
            settings: { ...prefs, lastLocation: s.settings.lastLocation, ...(s.settings.uiScale !== undefined ? { uiScale: s.settings.uiScale } : {}) },
            colorRules: (colors.join(",") === initialColorOrder.current
              ? s.colorRules.map((r) => r.color)
              : [
                  ...colors,
                  ...s.colorRules
                    .map((r) => r.color)
                    .filter((c) => !colors.includes(c)),
                ]
            ).map((color, order) => ({
              color,
              order,
              name: colorNames[color]?.trim() || colorName(s, color),
            })),
          };
        }
        if (!item) return s;
        if (editor.kind === "move")
          return items.reduce(
            (next, i) => moveItem(next, i, target || null),
            s,
          );
        if (editor.kind === "delete")
          return items.reduce(
            (next, i) =>
              i.kind === "folder"
                ? deleteFolder(next, i.id)
                : {
                    ...next,
                    conversations: next.conversations.filter(
                      (c) => c.id !== i.id,
                    ),
                  },
            s,
          );
        if (editor.kind === "color") {
          const normalized = color.toLowerCase();
          if (item?.kind === "folder")
            return assignColor(s, items.filter(i => i.kind === "folder"), normalized || null);
          let next = s;
          for (const [key, value] of Object.entries(colorNames))
            next = renameColor(next, key, value);
          if (normalized && !next.colorRules.some((r) => r.color === normalized))
            next = renameColor(next, normalized, shownColorName(normalized));
          return assignColor(next, items.filter(i => i.kind === "conversation"), normalized || null);
        }
        return s;
      });
      if (ok) {
        if (duplicate) {
          notice(t("alreadyAdded"));
          go(duplicate.folderId ? `folder:${duplicate.folderId}` : "inbox");
        }
        close();
      } else setError(t("saveFailed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function reorder(index: number, delta: number) {
    setColors((previous) => {
      const next = [...previous];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  }
  const folderOptions = state.folders.filter((f) =>
    items.every(
      (i) => i.kind !== "folder" || canMoveFolder(state.folders, i.id, f.id),
    ),
  );
  return (
    <Dialog
      title={titles[editor.kind]}
      onClose={() => {
        if (!busy && !syncBusy) close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {(editor.kind === "add" || editor.kind === "new") && (
          <label>
            {t("displayName")}
            <input
              autoFocus
              required
              maxLength={300}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        {editor.kind === "add" && (
          <>
            <label>
              {t("chatGPTConversationURL")}
              <input
                required
                type="url"
                value={url}
                placeholder="https://chatgpt.com/c/…"
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <p className="hint">
              {t("location")}{" "}
              {folderId
                ? ancestors(state.folders, folderId)
                    .map((f) => f.name)
                    .join(" / ")
                : t("inbox")}
            </p>
          </>
        )}
        {editor.kind === "move" && (
          <>
            <label>
              {t("destinationFolder")}
              <select
                autoFocus
                aria-label={t("destinationFolder")}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">
                  {item?.kind === "folder" ? t("root") : t("inbox")}
                </option>
                {folderOptions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {ancestors(state.folders, f.id)
                      .map((p) => p.name)
                      .join(" / ")}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">{t("chatGPTProjectsAreNotChanged")}</p>
          </>
        )}
        {editor.kind === "color" && item?.kind === "folder" && (
          <FolderColorFields color={color} change={setColor} />
        )}
        {editor.kind === "color" && item?.kind === "conversation" && (
          <>
            <div className="swatches">
              {state.colorRules.map((r) => (
                <button
                  type="button"
                  key={r.color}
                  aria-label={shownColorName(r.color)}
                  title={`${shownColorName(r.color)} (${r.color})`}
                  aria-pressed={r.color === color}
                  style={{ background: r.color }}
                  onClick={() => setColor(r.color)}
                />
              ))}
            </div>
            <label>
              {t("colorPresetName")}
              <input
                maxLength={100}
                disabled={!validColor(color)}
                value={validColor(color) ? shownColorName(color) : ''}
                onChange={(e) => editColorName(color, e.target.value)}
              />
            </label>
            <p className="hint">{t("colorNameShared")}</p>
            <label>
              {t("customColor")}
              <input
                type="color"
                value={validColor(color) ? color : "#ffffff"}
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
            <label>
              {t("hEX")}
              <input
                value={color}
                pattern="#[0-9a-fA-F]{6}"
                onChange={(e) => setColor(e.target.value)}
              />
            </label>
          </>
        )}
        {editor.kind === "delete" && (
          <>
            <p>
              <strong>{items.map((i) => nameOf(state, i)).join(", ")}</strong>
            </p>
            <p>
              {item?.kind === "folder"
                ? t(
                    "chatsInThisFolderMoveToInboxChildFoldersMoveToTheParentKeepingTheirChats",
                  )
                : t("removeLocalMetadataOnly")}
            </p>
            <p className="safety-note">
              <UiIcon name="warning" />
              {t("yourChatGPTConversationsWillNotBeDeleted")}
            </p>
          </>
        )}
        {editor.kind === "settings" && (
          <>
            <label>
              {t("defaultOpenBehavior")}
              <select
                aria-label={t("defaultOpenBehavior")}
                value={prefs.defaultOpenBehavior}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    defaultOpenBehavior: e.target.value as OpenBehavior,
                  })
                }
              >
                <option value="reuse">{t("reuseTab")}</option>
                <option value="new-tab">{t("newTab")}</option>
                <option value="new-window">{t("newWindow")}</option>
              </select>
            </label>
            <label>
              {t("startupLocation")}
              <select
                aria-label={t("startupLocation")}
                value={prefs.startup}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    startup: e.target.value as Settings["startup"],
                  })
                }
              >
                <option value="last">{t("lastLocation")}</option>
                <option value="home">{t("home")}</option>
                <option value="favorites">{t("favorites")}</option>
                <option value="folder">{t("specificFolder")}</option>
              </select>
            </label>
            {prefs.startup === "folder" && (
              <label>
                {t("startupFolder")}
                <select
                  required
                  aria-label={t("startupFolder")}
                  value={prefs.startupFolderId ?? ""}
                  onChange={(e) =>
                    setPrefs({
                      ...prefs,
                      startupFolderId: e.target.value || null,
                    })
                  }
                >
                  <option value="">{t("chooseAFolder")}</option>
                  {state.folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {ancestors(state.folders, f.id)
                        .map((p) => p.name)
                        .join(" / ")}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={prefs.rememberBounds}
                onChange={(e) =>
                  setPrefs({ ...prefs, rememberBounds: e.target.checked })
                }
              />
              {t("rememberWindowPositionAndSize")}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={prefs.alwaysCentered}
                onChange={(e) =>
                  setPrefs({ ...prefs, alwaysCentered: e.target.checked })
                }
              />
              {t("alwaysOpenCentered")}
            </label>
            <p className="hint">{t("aboutSafety")}</p>
            <h3>{t("colorPriority")}</h3>
            <p className="hint">{t("colorsSortFromTopToBottom")}</p>
            <div className="color-order">
              {colors.map((c, i) => (
                <div key={c}>
                  <i className="dot" style={{ background: c }} />
                  <input
                    aria-label={t("colorPresetNameFor", { color: c })}
                    maxLength={100}
                    value={shownColorName(c)}
                    onChange={(e) => editColorName(c, e.target.value)}
                  />
                  <span>{c}</span>
                  <button
                    type="button"
                    title={t("colorUp", { color: c })}
                    aria-label={t("colorUp", { color: c })}
                    disabled={i === 0}
                    onClick={() => reorder(i, -1)}
                  >
                    <UiIcon name="up" />
                  </button>
                  <button
                    type="button"
                    title={t("colorDown", { color: c })}
                    aria-label={t("colorDown", { color: c })}
                    disabled={i === colors.length - 1}
                    onClick={() => reorder(i, 1)}
                  >
                    <UiIcon name="down" />
                  </button>
                </div>
              ))}
            </div>
            <p className="hint">
              {t(
                "themeFollowsYourOSChangeShortcutsInYourBrowserExtensionSettings",
              )}
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            <UiIcon name="error" />
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {editor.kind === "color" && item?.kind === "folder" && <button className="folder-color-reset" type="button" disabled={busy} onClick={() => setColor('')}>{t("resetFolderColor")}</button>}
          <button type="button" disabled={busy || syncBusy} onClick={close}>
            {t("cancel")}
          </button>
          <button
            className={editor.kind === "delete" ? "danger-button" : "primary"}
            disabled={busy || syncBusy}
          >
            {busy
              ? t("saving")
              : editor.kind === "delete"
                ? t("remove")
                : t("save")}
          </button>
        </div>
      </form>
      {editor.kind === "settings" && (
        <>
          <DataDialog state={state} commit={commit} />
          <SyncSettings state={state} store={syncStore} onBusy={setSyncBusy} autoPreview={autoPreview} clearAutoPreview={clearAutoPreview} />
        </>
      )}
    </Dialog>
  );
}

