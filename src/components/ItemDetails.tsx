import type { ReactNode } from "react";
import type { Conversation, Folder } from "../models/types";
import { t } from "../i18n";

export function ItemDetails({
  folder,
  conversation,
  nameEditor,
  onColor,
}: {
  nameEditor?: ReactNode;
  onColor?: () => void;
  folder?: Folder;
  conversation?: Conversation;
}) {
  return (
    <>
      <span role="cell" className="item-name">
        {folder && (
          <span className="folder-icon" aria-hidden="true">
            ▰
          </span>
        )}
        {nameEditor ?? (
          <span className="truncate">
            {folder?.name ?? conversation?.title}
          </span>
        )}
        {(folder?.favorite || conversation?.favorite) && (
          <span title={t("favorite")} aria-label={t("favorite")}>
            ★
          </span>
        )}
        {conversation?.projectId && (
          <small
            className="project-badge"
            title={conversation.projectName ?? conversation.projectId}
          >
            {conversation.projectName ?? t("project")}
          </small>
        )}
      </span>
      <span role="cell" className="color-cell">
        {conversation && (
          <button
            type="button"
            className="color-dot-button"
            aria-label={t("colorAction")}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onColor?.();
            }}
          >
            <i
              className="dot"
              role="img"
              aria-label={t("colorLabel")}
              style={{ background: conversation.color }}
            />
          </button>
        )}
      </span>
    </>
  );
}
