import type { ImportCandidate } from "../models/import";
import { parseConversationUrl } from "../utils/url";

export type ScrollState = { top: number; height: number; viewport: number };
export type TraversalPort = {
  read(): Promise<ImportCandidate[]>;
  start(): Promise<ScrollState | null>;
  advance(): Promise<ScrollState>;
  restore(): Promise<void>;
};

// No DOM dependency: retains evidence after virtualized nodes disappear.
export async function traverseChats(
  port: TraversalPort,
  progress: (count: number) => void,
  limits = { iterations: 160, milliseconds: 90000 },
  now = Date.now,
  cancelled = () => false,
) {
  const found = new Map<string, ImportCandidate[]>();
  const started = now();
  let failure: string | null = null;
  let limited = false,
    failed = false;
  const collect = async () => {
    for (const item of await port.read()) {
      const id = parseConversationUrl(item.url)?.id;
      if (!id) continue;
      const evidence = found.get(id) ?? [];
      // Keep conflicting project evidence for the existing conservative merger.
      if (
        !evidence.some(
          (x) =>
            x.url === item.url &&
            x.projectId === item.projectId &&
            x.projectName === item.projectName,
        )
      )
        evidence.push(item);
      found.set(id, evidence);
    }
    progress(found.size);
  };
  try {
    if (cancelled()) throw Error("Import stopped");
    await collect(); // Include the user's original viewport before returning to top.
    let previous = cancelled() ? null : await port.start();
    if (previous) {
      let stable = 0;
      await collect();
      for (let i = 0; ; i++) {
        if (cancelled()) break;
        if (i >= limits.iterations || now() - started >= limits.milliseconds) {
          limited = true;
          break;
        }
        const count = found.size;
        const next = await port.advance();
        await collect();
        const unchanged =
          Math.abs(next.top - previous.top) < 2 &&
          next.height === previous.height;
        stable = count === found.size && unchanged ? stable + 1 : 0;
        const bottom = next.top + next.viewport >= next.height - 3;
        // Also stop if a scroller becomes immovable away from the bottom.
        if (stable >= (bottom ? 4 : 8)) break;
        previous = next;
      }
    }
  } catch (error) {
    failed = !cancelled();
    if (failed)
      failure = error instanceof Error ? error.message : "Traversal failed";
  } finally {
    try {
      await port.restore();
    } catch {
      failed = true;
    }
  }
  return {
    candidates: [...found.values()].flat(),
    limited,
    failed,
    failure,
    stopped: cancelled(),
  };
}
