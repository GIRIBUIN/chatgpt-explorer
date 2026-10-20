// Firefox's browser namespace and Chromium's chrome namespace both support
// promises. Resolve at call time so tests can supply an isolated API instance.
export function webext(): typeof chrome {
  return (
    (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ??
    chrome
  );
}
