import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
export function InlineRename({
  value,
  save,
  close,
}: {
  value: string;
  save: (name: string) => Promise<boolean>;
  close: () => void;
}) {
  const [name, setName] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  async function finish(cancel = false) {
    if (done.current) return;
    done.current = true;
    if (cancel || !name.trim()) {
      close();
      return;
    }
    if (await save(name)) close();
    else done.current = false;
  }
  return (
    <input
      ref={input}
      className="inline-rename"
      aria-label={t("rename")}
      value={name}
      maxLength={300}
      onChange={(e) => setName(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => void finish()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          void finish();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          void finish(true);
        }
      }}
    />
  );
}
