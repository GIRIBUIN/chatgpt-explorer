import { expect, it } from "vitest";
import { importFailureMessage, importFeedback } from "../src/explorer/import-feedback";

const result = { added: 3, existed: 2, metadataUpdated: 0, projectNamesUpdated: 0 };
it("keeps success concise and reports existing chats", () => {
  expect(importFeedback(result)).toBe("Imported 3 chats. 2 already existed.");
});
it("reports partial counts using source-page failures rather than invented chat failures", () => {
  expect(importFeedback(result, 1)).toBe("Imported 3 chats. Skipped 2 existing chats. Source pages not fully read: 1. Saved chats are kept.");
});
it.each([
  ["no-chatgpt-tab", "ChatGPT is not open"],
  ["sidebar-closed", "conversation list is not ready"],
  ["sidebar-open-timeout", "conversation list is not ready"],
  ["sidebar-not-found", "sign in if needed"],
  ["injection-failed", "Reload the ChatGPT tab"],
  ["ping-timeout", "Could not contact"],
  ["tab-navigated", "page changed"],
  ["traversal-failed", "Could not finish reading"],
  ["secret internal selector/stack trace", "Could not finish reading"],
])("provides safe recovery text for %s", (reason, expected) => {
  expect(importFailureMessage(reason)).toContain(expected);
  expect(importFailureMessage(reason)).not.toContain("selector/stack");
});
