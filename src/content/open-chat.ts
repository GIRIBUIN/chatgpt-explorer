// Isolated-world execution: let ChatGPT's own anchor handler route the page.
// Never synthesize router state or touch conversation content.
export async function clickConversation(target: string) {
  const path = (value: string) => {
    try {
      const u = new URL(value, location.href);
      if (
        u.origin !== "https://chatgpt.com" ||
        !/^\/(?:g\/[^/]+\/)?c\/[\w-]+\/?$/.test(u.pathname)
      )
        return null;
      return u.pathname.replace(/\/$/, "");
    } catch {
      return null;
    }
  };
  const wanted = path(target);
  if (!wanted || location.origin !== "https://chatgpt.com") return false;
  if (path(location.href) === wanted) return true;
  const anchor = [
    ...document.querySelectorAll<HTMLAnchorElement>(
      'a[data-interactive-row-link="true"]',
    ),
  ].find(
    (link) =>
      path(link.href) === wanted &&
      !link.closest('[hidden],[inert],[aria-disabled="true"]') &&
      link.getClientRects().length > 0,
  );
  if (!anchor) return false;
  anchor.click();
  // A missing/broken app handler must not silently turn Open into a no-op.
  return new Promise<boolean>((resolve) => {
    const finish = () => {
      clearInterval(poll);
      clearTimeout(cap);
      resolve(path(location.href) === wanted);
    };
    const poll = setInterval(() => {
      if (path(location.href) === wanted) finish();
    }, 50);
    const cap = setTimeout(finish, 1500);
    if (path(location.href) === wanted) finish();
  });
}
