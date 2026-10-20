// Only explicit conversation routes are accepted; a generic /g/ slug is not a project ID.
export function parseConversationUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.hostname !== "chatgpt.com" ||
      url.port ||
      url.username ||
      url.password
    )
      return null;
    const match = /^\/(?:g\/([^/]+)\/)?c\/([a-zA-Z0-9-]+)\/?$/.exec(
      url.pathname,
    );
    if (!match) return null;
    const slug = match[1];
    const project = slug ? /^g-p-([a-f0-9]{32})(?:-|$)/i.exec(slug) : null;
    return {
      id: match[2],
      url: `https://chatgpt.com${url.pathname.replace(/\/$/, "")}`,
      projectId: project ? `g-p-${project[1]}` : null,
    };
  } catch {
    return null;
  }
}
export const isProjectId = (value: unknown): value is string =>
  typeof value === "string" && /^g-p-[a-f0-9]{32}$/i.test(value);
export function parseProjectUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.origin !== "https://chatgpt.com" || url.username || url.password)
      return null;
    const match = /^\/g\/(g-p-[a-f0-9]{32})(?:-[^/]+)?\/project\/?$/i.exec(
      url.pathname,
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
