import { webext } from '../utils/browser';

// Session storage survives worker suspension, but not a new browser session with reused IDs.
export const EXPLORER_WINDOW_KEY = 'syncExplorerWindowId';
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>) {
  const task = queue.then(work);
  queue = task.catch(() => {});
  return task;
}
export function rememberExplorerWindow(id: number) {
  return serial(async () => {
    await webext().storage.session.set({ [EXPLORER_WINDOW_KEY]: id });
  });
}
export function consumeExplorerClose(id: number) {
  return serial(async () => {
    const api = webext();
    const saved = (await api.storage.session.get(EXPLORER_WINDOW_KEY))[EXPLORER_WINDOW_KEY];
    if (saved !== id) return false;
    if (saved === id) await api.storage.session.remove(EXPLORER_WINDOW_KEY);
    return true;
  });
}
export async function discoverExplorerWindow() {
  const api = webext(), url = api.runtime.getURL('explorer.html');
  const windows = await api.windows.getAll({ populate: true });
  const explorer = windows.find(w => w.type === 'popup' && w.tabs?.some(tab => tab.url === url));
  if (explorer?.id !== undefined) await rememberExplorerWindow(explorer.id);
}
