import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, { type Env, type Statement } from "../src/index.ts";
export function server() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../migrations/0001_sync.sql", import.meta.url),
      "utf8",
    ),
  );
  const env: Env = {
    DB: {
      prepare(sql: string) {
        let values: SQLInputValue[] = [];
        const statement: Statement = {
          bind(...v: unknown[]) {
            values = v as SQLInputValue[];
            return statement;
          },
          async first<T>() {
            return (db.prepare(sql).get(...values) ?? null) as T | null;
          },
          async run() {
            return {
              meta: { changes: Number(db.prepare(sql).run(...values).changes) },
            };
          },
        };
        return statement;
      },
    },
    RATE_LIMITER: {
      async limit() {
        return { success: true };
      },
    },
  };
  const fetcher: typeof fetch = async (input, init) =>
    worker.fetch(new Request(input, init), env);
  return { db, env, fetcher };
}
