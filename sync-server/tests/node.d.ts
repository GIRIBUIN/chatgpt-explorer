// Minimal declarations for Node 24's built-ins used only by the local SQLite harness.
// The extension/server production code has no Node dependency.
declare module "node:sqlite" {
  export type SQLInputValue = string | number | bigint | null | Uint8Array;
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    close(): void;
    prepare(sql: string): {
      get(...values: SQLInputValue[]): Record<string, unknown> | undefined;
      run(...values: SQLInputValue[]): { changes: number | bigint };
    };
  }
}
declare module "node:fs" {
  export function readFileSync(path: URL, encoding: "utf8"): string;
  export function readFileSync(path: URL): Uint8Array;
}
