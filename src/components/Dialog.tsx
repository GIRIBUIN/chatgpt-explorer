import { t } from "../i18n";
import { useEffect, useRef, type ReactNode } from "react";
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      <header>
        <h2>{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          title={t("close")}
        >
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
