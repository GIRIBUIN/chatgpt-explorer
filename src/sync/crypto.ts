import { keys, object } from "../models/theme";
import {
  type Credentials,
  type Envelope,
  MAX_BLOB,
  MAX_PLAINTEXT,
  originUrl,
} from "./types";
export function encode(bytes: Uint8Array) {
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decode(s: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw Error("Invalid encoded value.");
  const bytes = Uint8Array.from(
    atob(s.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  if (encode(bytes) !== s) throw Error("Invalid encoded value.");
  return bytes;
}
export function credentials(origin: string): Credentials {
  const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
  return {
    version: 1,
    syncId: random(),
    authToken: random(),
    encryptionKey: random(),
    origin,
  };
}
export function parseCode(code: string, origin: string): Credentials {
  try {
    if (code.length > 2048) throw Error();
    const r = object(JSON.parse(new TextDecoder().decode(decode(code.trim()))));
    keys(r, ["version", "syncId", "authToken", "encryptionKey", "origin"]);
    if (r.version !== 1 || r.origin !== originUrl(origin, true)) throw Error();
    for (const key of ["syncId", "authToken", "encryptionKey"])
      if (typeof r[key] !== "string" || decode(r[key]).length !== 32)
        throw Error();
    return r as Credentials;
  } catch {
    throw Error("Invalid Sync Code or different server.");
  }
}
export const syncCode = (c: Credentials) =>
  encode(
    new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        syncId: c.syncId,
        authToken: c.authToken,
        encryptionKey: c.encryptionKey,
        origin: c.origin,
      }),
    ),
  );
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  );
}
export async function hash(value: unknown) {
  return encode(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(value)),
      ),
    ),
  );
}
const aad = (c: Credentials) =>
  new TextEncoder().encode(`chat-explorer-sync:1:${c.syncId}`);
async function key(c: Credentials) {
  return crypto.subtle.importKey(
    "raw",
    decode(c.encryptionKey),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encrypt(
  c: Credentials,
  value: unknown,
): Promise<Envelope> {
  const plain = new TextEncoder().encode(canonical(value));
  if (plain.length > MAX_PLAINTEXT)
    throw Error("Sync snapshot exceeds 700 KB.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(c) },
    await key(c),
    plain,
  );
  return {
    version: 1,
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(ciphertext)),
  };
}
export async function decrypt(c: Credentials, raw: unknown): Promise<unknown> {
  try {
    const e = object(raw);
    keys(e, ["version", "iv", "ciphertext"]);
    if (
      e.version !== 1 ||
      typeof e.iv !== "string" ||
      typeof e.ciphertext !== "string" ||
      e.ciphertext.length > MAX_BLOB ||
      decode(e.iv).length !== 12
    )
      throw Error();
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decode(e.iv), additionalData: aad(c) },
      await key(c),
      decode(e.ciphertext),
    );
    if (plain.byteLength > MAX_PLAINTEXT) throw Error();
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw Error("Could not decrypt sync data. No local changes applied.");
  }
}
