import { useState } from "react";
import { Dialog } from "./Dialog";
import { t } from "../i18n";
import { UiIcon } from './UiIcon';
export type Command = { label: string; enabled: boolean; run: () => void };
export function CommandPalette({
  commands,
  close,
}: {
  commands: Command[];
  close: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = commands.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()),
  );
  const run = (c: Command) => {
    if (c.enabled) {
      close();
      c.run();
    }
  };
  return (
    <Dialog title={t("commandPalette")} onClose={close}>
      <label className="search-field">
        <UiIcon name="search" />
        <input
          autoFocus
          aria-label={t("searchCommands")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const c = filtered.find((c) => c.enabled);
              if (c) run(c);
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              e.currentTarget.closest('dialog')
                ?.querySelector<HTMLButtonElement>(
                  ".palette-list button:not(:disabled)",
                )
                ?.focus();
            }
          }}
        />
      </label>
      <div className="palette-list">
        {filtered.map((c) => (
          <button key={c.label} disabled={!c.enabled} onClick={() => run(c)}>
            {c.label}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
