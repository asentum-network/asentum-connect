// Browser storage that never throws. Reading `window.localStorage` itself
// throws a SecurityError when storage is blocked (third-party iframes,
// "block all cookies", some private modes), so every access goes through
// here and the kit keeps working with the state held in memory.

function store(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function storageGet(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    store()?.setItem(key, value);
  } catch {
    // blocked or full: keep it for this page only
  }
}

export function storageRemove(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    // blocked
  }
}
