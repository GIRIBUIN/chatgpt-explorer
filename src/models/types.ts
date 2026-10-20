export type Location = "home" | "favorites" | "inbox" | `folder:${string}`;
export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  pinned?: boolean;
  createdAt: number;
  color?: string;
};
export type Conversation = {
  id: string;
  title: string;
  originalTitle?: string;
  url: string;
  projectId: string | null;
  projectName: string | null;
  folderId: string | null;
  color: string;
  favorite: boolean;
  createdAt: number;
  lastOpenedAt: number | null;
};
// The normalized HEX is the stable preset key as well as its display value.
export type ColorRule = { color: string; order: number; name?: string };
export type Bounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export type Settings = {
  // Device/display preference; excluded from workspace and sync payloads.
  uiScale?: number;
  defaultOpenBehavior: OpenBehavior;
  startup: "last" | "home" | "favorites" | "folder";
  startupFolderId: string | null;
  lastLocation: Location;
  rememberBounds: boolean;
  alwaysCentered: boolean;
  sort: "name" | "color" | "opened" | "added";
  direction: "asc" | "desc";
  colorFilter: string;
  projectFilter?: string;
  collapsed: string[];
};
export type AppState = {
  version: 2;
  theme?: import("./theme").Theme;
  folders: Folder[];
  conversations: Conversation[];
  colorRules: ColorRule[];
  settings: Settings;
};
export type Item = { kind: "folder" | "conversation"; id: string };
export type OpenBehavior = "reuse" | "new-tab" | "new-window";
