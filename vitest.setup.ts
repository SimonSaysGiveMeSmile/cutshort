// Node 22+ ships an experimental global `localStorage` that is inert unless
// `--localstorage-file` is passed, and it shadows the one jsdom provides — so
// the app's `localStorage.*` calls read `undefined` under test. Install a small
// in-memory Storage so the real (non-DOM) persistence logic can be exercised.
class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(key: string) {
    return this.m.has(key) ? this.m.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.m.set(String(key), String(value));
  }
  removeItem(key: string) {
    this.m.delete(key);
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
}

const storage = new MemoryStorage();
const def = { value: storage, configurable: true, writable: true };
Object.defineProperty(globalThis, "localStorage", def);
if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", def);
}
