import { t } from "../i18n";
export function importFeedback(result: {
  added: number;
  existed: number;
  projectNamesUpdated: number;
  metadataUpdated: number;
}) {
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
