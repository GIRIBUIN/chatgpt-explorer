import { t } from "../i18n";
export function importFeedback(result: {
  added: number;
  existed: number;
  projectNamesUpdated: number;
  metadataUpdated: number;
}, failedPages = 0) {
  if (failedPages) return t("partialImportCounts", { imported: result.added, skipped: result.existed, failed: failedPages });
  if (!result.added && !result.metadataUpdated) return t("nothingToImport");
  return [
    t("importedCount", { count: result.added }),
    result.existed ? t("existedCount", { count: result.existed }) : "",
    result.projectNamesUpdated
      ? t("namesUpdatedCount", { count: result.projectNamesUpdated })
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function importFailureMessage(reason?: string | null) {
  if (reason === "no-chatgpt-tab") return t("chatGPTNotOpen");
  if (["sidebar-closed", "sidebar-open-timeout"].includes(reason ?? "")) return t("chatGPTNotReady");
  if (reason === "sidebar-not-found") return t("chatGPTUnavailable");
  if (["content-script-unavailable", "injection-failed"].includes(reason ?? "")) return t("contentUnavailable");
  if (["message-failed", "ping-timeout"].includes(reason ?? "")) return t("importMessageFailed");
  if (["unsupported-page", "tab-navigated"].includes(reason ?? "")) return t("importUnsupported");
  return t("pagesSkipped");
}
