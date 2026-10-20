import type { ReactNode } from "react";
import type { Conversation, Folder } from "../models/types";
import { t } from "../i18n";
import { FolderIcon } from './FolderIcon';
import { TruncatedName } from './TruncatedName';

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
            <FolderIcon color={folder.color} />
          </span>
        )}
        {nameEditor ?? (
          <TruncatedName>{folder?.name ?? conversation?.title ?? ''}</TruncatedName>
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
