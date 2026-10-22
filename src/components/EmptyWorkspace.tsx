import { t } from "../i18n";
import { UiIcon } from "./UiIcon";

export function EmptyWorkspace({ disabled, onImport, onAddCurrent }: {
  disabled: boolean;
  onImport: () => void;
  onAddCurrent: () => void;
}) {
  return <section className="empty onboarding" aria-label={t("noConversationsYet")}>
    <UiIcon name="currentChat" size={18} />
    <h2>{t("noConversationsYet")}</h2>
    <p>{t("importToStart")}</p>
    <div className="dialog-actions">
      <button disabled={disabled} onClick={onImport}><UiIcon name="import" />{t("importChats")}</button>
      <button disabled={disabled} onClick={onAddCurrent}><UiIcon name="currentChat" />{t("currentChat")}</button>
    </div>
  </section>;
}
