export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface Env {
  DB: { prepare(sql: string): Statement };
  RATE_LIMITER: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
}
const MAX_BLOB = 1000000,
  MAX_BODY = 1010000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
type Row = { revision: number; encrypted_blob: string; updated_at: number };
const digest = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
function envelope(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return (
    Object.keys(r).length === 3 &&
    r.version === 1 &&
    typeof r.iv === "string" &&
    /^[A-Za-z0-9_-]{16}$/.test(r.iv) &&
    typeof r.ciphertext === "string" &&
    /^[A-Za-z0-9_-]{22,}$/.test(r.ciphertext) &&
    JSON.stringify(value).length <= MAX_BLOB
  );
}
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw Error("invalid");
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw Error("large");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("invalid");
  return raw as Record<string, unknown>;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin"),
      allowed =
        !origin ||
        /^(chrome-extension|moz-extension):\/\/[A-Za-z0-9-]+$/.test(origin);
    const headers: Record<string, string> = {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    };
    if (origin && allowed) headers["Access-Control-Allow-Origin"] = origin;
    const send = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status, headers });
    if (!allowed) return send(403, { error: "Forbidden" });
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "600",
        },
      });
    try {
      if (
        !env.RATE_LIMITER ||
        !(
          await env.RATE_LIMITER.limit({
            key: request.headers.get("CF-Connecting-IP") ?? "local",
          })
        ).success
      )
        return send(429, { error: "Rate limited" });
      const path = new URL(request.url).pathname,
        match = /^\/v1\/sync\/([A-Za-z0-9_-]{43})$/.exec(path),
        create = path === "/v1/sync" && request.method === "POST";
      if (!create && (!match || !["GET", "PUT"].includes(request.method)))
        return send(404, { error: "Not found" });
      const auth = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
        request.headers.get("Authorization") ?? "",
      );
      if (!auth) return send(401, { error: "Unauthorized" });
      const authHash = await digest(auth[1]);
      let existing: Row | null = null;
      if (!create) {
        existing = await env.DB.prepare(
          "SELECT revision, encrypted_blob, updated_at FROM sync_workspaces WHERE sync_id = ? AND auth_hash = ?",
        )
          .bind(match![1], authHash)
          .first<Row>();
        if (!existing) return send(401, { error: "Unauthorized" });
      }
      if (request.method === "GET")
        return send(200, {
          revision: existing!.revision,
          encryptedBlob: JSON.parse(existing!.encrypted_blob),
          updatedAt: existing!.updated_at,
        });
      if (
        !request.headers
          .get("Content-Type")
          ?.toLowerCase()
          .startsWith("application/json")
      )
        return send(400, { error: "Invalid request" });
      const r = await body(request);
      if (
        Object.keys(r).sort().join(",") !==
          (create
            ? "encryptedBlob,syncId"
            : "encryptedBlob,expectedRevision") ||
        !envelope(r.encryptedBlob)
      )
        return send(400, { error: "Invalid request" });
      const blob = JSON.stringify(r.encryptedBlob),
        updatedAt = Date.now();
      if (create) {
        if (typeof r.syncId !== "string" || !tokenPattern.test(r.syncId))
          return send(400, { error: "Invalid request" });
        const result = await env.DB.prepare(
          "INSERT OR IGNORE INTO sync_workspaces (sync_id, auth_hash, revision, encrypted_blob, updated_at) VALUES (?, ?, 1, ?, ?)",
        )
          .bind(r.syncId, authHash, blob, updatedAt)
          .run();
        if (result.meta.changes !== 1) return send(409, { error: "Conflict" });
        return send(201, {
          revision: 1,
          encryptedBlob: r.encryptedBlob,
          updatedAt,
        });
      }
      if (
        !Number.isSafeInteger(r.expectedRevision) ||
        Number(r.expectedRevision) < 1 ||
        Number(r.expectedRevision) >= Number.MAX_SAFE_INTEGER
      )
        return send(400, { error: "Invalid revision" });
      const result = await env.DB.prepare(
        "UPDATE sync_workspaces SET encrypted_blob = ?, revision = revision + 1, updated_at = ? WHERE sync_id = ? AND auth_hash = ? AND revision = ?",
      )
        .bind(blob, updatedAt, match![1], authHash, r.expectedRevision)
        .run();
      if (result.meta.changes !== 1) return send(409, { error: "Conflict" });
      return send(200, {
        revision: Number(r.expectedRevision) + 1,
        encryptedBlob: r.encryptedBlob,
        updatedAt,
      });
    } catch (e) {
      return send(
        e instanceof SyntaxError
          ? 400
          : e instanceof Error && e.message === "large"
            ? 413
            : e instanceof Error && e.message === "invalid"
              ? 400
              : 503,
        { error: "Request could not be completed" },
      );
    }
  },
};
