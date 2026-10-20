import { validColor } from "./state";
export const themeColors = [
  "background",
  "surface",
  "surfaceHover",
  "text",
  "textMuted",
  "border",
  "accent",
] as const;
export type Theme = {
  version: 1;
  name: string;
  colors: Record<(typeof themeColors)[number], string>;
  ui: { radius: number; density: "compact" | "comfortable"; fontSize: number };
};
export const defaultTheme: Theme = {
  version: 1,
  name: "Explorer Light",
  colors: {
    background: "#ffffff",
    surface: "#f7f8fa",
    surfaceHover: "#edf0f3",
    text: "#25282d",
    textMuted: "#717780",
    border: "#e4e6e9",
    accent: "#176bc2",
  },
  ui: { radius: 4, density: "compact", fontSize: 13 },
};
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Expected an object.");
  return value as Record<string, unknown>;
}
export function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
) {
  if (Object.keys(value).some((k) => !allowed.includes(k)))
    throw Error("Unsupported field.");
}
export function text(
  value: unknown,
  nullable = false,
  maxLength = 1000,
): string {
  if (nullable && value === null) return "";
  if (typeof value !== "string" || !value.trim() || value.length > maxLength)
    throw Error("Invalid text.");
  return value;
}
export function parseTheme(raw: unknown): Theme {
  const r = object(raw);
  keys(r, ["version", "name", "colors", "ui"]);
  if (r.version !== 1) throw Error("Unsupported theme version.");
  text(r.name, false, 100);
  const colors = object(r.colors);
  keys(colors, themeColors);
  if (!themeColors.every((k) => validColor(colors[k])))
    throw Error("Invalid theme color.");
  const ui = object(r.ui);
  keys(ui, ["radius", "density", "fontSize"]);
  if (
    typeof ui.radius !== "number" ||
    !Number.isFinite(ui.radius) ||
    ui.radius < 0 ||
    ui.radius > 12 ||
    typeof ui.fontSize !== "number" ||
    !Number.isFinite(ui.fontSize) ||
    ui.fontSize < 11 ||
    ui.fontSize > 18 ||
    !["compact", "comfortable"].includes(String(ui.density))
  )
    throw Error("Invalid theme UI token.");
  return {
    version: 1,
    name: r.name as string,
    colors: colors as Theme["colors"],
    ui: ui as Theme["ui"],
  };
}
export function themeVariables(theme: Theme): Record<string, string> {
  const c = theme.colors;
  return {
    "--bg": c.background,
    "--panel": c.surface,
    "--hover": c.surfaceHover,
    "--text": c.text,
    "--muted": c.textMuted,
    "--line": c.border,
    "--accent": c.accent,
    "--active": c.surfaceHover,
    "--radius": `${theme.ui.radius}px`,
    "--font-size": `${theme.ui.fontSize}px`,
    "--row-height": theme.ui.density === "compact" ? "34px" : "42px",
  };
}

export function systemTheme(dark: boolean): Theme {
  return dark
    ? {
        ...defaultTheme,
        name: "Explorer Dark",
        colors: {
          background: "#202124",
          surface: "#26272b",
          surfaceHover: "#303237",
          text: "#e0e3e7",
          textMuted: "#a0a6b0",
          border: "#393b40",
          accent: "#7ab5f4",
        },
      }
    : defaultTheme;
}
