import { describe, it, expect, beforeEach, vi } from "vitest";

// shortcutStore keeps module-level state that is seeded from localStorage at
// import time. To test the load paths and keep tests isolated we reset the
// module registry and re-import for each scenario.
type Store = typeof import("./shortcutStore");

async function freshStore(seed?: { custom?: unknown; hidden?: unknown }): Promise<Store> {
  localStorage.clear();
  if (seed?.custom !== undefined) {
    localStorage.setItem(
      "cutshort.custom",
      typeof seed.custom === "string" ? seed.custom : JSON.stringify(seed.custom),
    );
  }
  if (seed?.hidden !== undefined) {
    localStorage.setItem(
      "cutshort.hidden",
      typeof seed.hidden === "string" ? seed.hidden : JSON.stringify(seed.hidden),
    );
  }
  vi.resetModules();
  return import("./shortcutStore");
}

const newShortcut = {
  label: "Comment Line",
  icon: "MessageSquare",
  category: "dev" as const,
  combo: { mods: ["MOD"] as ["MOD"], key: "/" },
};

beforeEach(() => {
  localStorage.clear();
});

describe("initial snapshot", () => {
  it("equals the built-in list when nothing is stored", async () => {
    const s = await freshStore();
    expect(s.getShortcuts().map((x) => x.id)).toEqual(s.builtins.map((x) => x.id));
  });

  it("hydrates custom shortcuts and hidden built-ins from localStorage", async () => {
    const s = await freshStore({
      custom: [{ id: "cX", label: "Mine", icon: "Star", category: "dev", combo: { mods: [], key: "k" }, custom: true }],
      hidden: ["copy"],
    });
    const ids = s.getShortcuts().map((x) => x.id);
    expect(ids).toContain("cX");
    expect(ids).not.toContain("copy");
    expect(s.isHidden("copy")).toBe(true);
  });

  it("recovers gracefully from corrupt localStorage", async () => {
    const s = await freshStore({ custom: "}{not json", hidden: "also broken" });
    expect(s.getShortcuts().map((x) => x.id)).toEqual(s.builtins.map((x) => x.id));
  });

  it("drops custom entries with a malformed shape instead of crashing the deck", async () => {
    const s = await freshStore({
      custom: [
        { id: "good", label: "Good", icon: "Star", category: "dev", combo: { mods: [], key: "k" }, custom: true },
        { id: "bad", label: "No combo", icon: "Star", category: "dev" }, // missing combo → would throw in render
        { id: "alsoBad", label: "Bad combo", icon: "Star", category: "dev", combo: { key: "k" } }, // combo.mods missing
        "not even an object",
      ],
    });
    const ids = s.getShortcuts().map((x) => x.id);
    expect(ids).toContain("good");
    expect(ids).not.toContain("bad");
    expect(ids).not.toContain("alsoBad");
  });

  it("drops a custom shortcut whose category isn't a real tab (would be unreachable)", async () => {
    const s = await freshStore({
      custom: [
        { id: "ok", label: "OK", icon: "Star", category: "dev", combo: { mods: [], key: "k" }, custom: true },
        { id: "orphan", label: "Orphan", icon: "Star", category: "misc", combo: { mods: [], key: "j" }, custom: true },
      ],
    });
    const ids = s.getShortcuts().map((x) => x.id);
    expect(ids).toContain("ok");
    expect(ids).not.toContain("orphan");
  });

  it("ignores a non-array hidden value (no per-character garbage ids)", async () => {
    // A stored JSON string would be iterated by `new Set("copy")` into c,o,p,y;
    // pass valid JSON whose value is a string to exercise that path.
    const s = await freshStore({ hidden: '"copy"' });
    expect(s.getShortcuts().map((x) => x.id)).toEqual(s.builtins.map((x) => x.id));
  });
});

describe("mutations", () => {
  it("addCustom appends a custom shortcut, returns a 'c' id, and persists", async () => {
    const s = await freshStore();
    const id = s.addCustom(newShortcut);
    expect(id).toMatch(/^c/);
    expect(s.isCustom(id)).toBe(true);

    const last = s.getShortcuts().at(-1)!;
    expect(last.id).toBe(id);
    expect(last.label).toBe("Comment Line");

    const persisted = JSON.parse(localStorage.getItem("cutshort.custom")!);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe(id);
  });

  it("updateCustom patches fields of an existing custom shortcut", async () => {
    const s = await freshStore();
    const id = s.addCustom(newShortcut);
    s.updateCustom(id, { label: "Renamed" });
    expect(s.getShortcuts().find((x) => x.id === id)!.label).toBe("Renamed");
  });

  it("removeShortcut deletes a custom shortcut", async () => {
    const s = await freshStore();
    const id = s.addCustom(newShortcut);
    s.removeShortcut(id);
    expect(s.isCustom(id)).toBe(false);
    expect(s.getShortcuts().some((x) => x.id === id)).toBe(false);
  });

  it("removeShortcut hides a built-in (and persists), restoreBuiltin brings it back", async () => {
    const s = await freshStore();
    s.removeShortcut("copy");
    expect(s.isHidden("copy")).toBe(true);
    expect(s.getShortcuts().some((x) => x.id === "copy")).toBe(false);
    expect(JSON.parse(localStorage.getItem("cutshort.hidden")!)).toContain("copy");

    s.restoreBuiltin("copy");
    expect(s.isHidden("copy")).toBe(false);
    expect(s.getShortcuts().some((x) => x.id === "copy")).toBe(true);
  });
});

describe("unique ids", () => {
  it("addCustom never reuses an id even when genId collides within one millisecond", async () => {
    const s = await freshStore();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    // 1st add → 0.5; 2nd add's first genId → 0.5 (collides with the 1st), retry → 0.6.
    const randSpy = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.6);
    try {
      const id1 = s.addCustom({ label: "One", icon: "Star", category: "dev", combo: { mods: [], key: "1" } });
      const id2 = s.addCustom({ label: "Two", icon: "Star", category: "dev", combo: { mods: [], key: "2" } });
      expect(id1).not.toBe(id2);
      const ids = s.getShortcuts().map((x) => x.id);
      expect(ids.filter((x) => x === id1)).toHaveLength(1);
      expect(ids.filter((x) => x === id2)).toHaveLength(1);
    } finally {
      nowSpy.mockRestore();
      randSpy.mockRestore();
    }
  });
});

describe("cross-tab sync", () => {
  it("reloadFromStorage adopts another tab's write instead of persisting over it", async () => {
    const s = await freshStore({
      custom: [{ id: "cA", label: "A", icon: "Star", category: "dev", combo: { mods: [], key: "a" }, custom: true }],
    });
    const seen = vi.fn();
    s.subscribe(seen);
    // Another tab replaced the stored set while we held the old one in memory.
    localStorage.setItem(
      "cutshort.custom",
      JSON.stringify([
        { id: "cB", label: "B", icon: "Star", category: "dev", combo: { mods: [], key: "b" }, custom: true },
      ]),
    );
    s.reloadFromStorage();
    const ids = s.getShortcuts().map((x) => x.id);
    expect(ids).toContain("cB");
    expect(ids).not.toContain("cA"); // their write wasn't clobbered by ours
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("re-seeds on a cross-tab 'storage' event for one of our keys", async () => {
    const s = await freshStore();
    const seen = vi.fn();
    s.subscribe(seen);
    localStorage.setItem("cutshort.hidden", JSON.stringify(["copy"]));
    window.dispatchEvent(new StorageEvent("storage", { key: "cutshort.hidden" }));
    expect(s.isHidden("copy")).toBe(true);
    expect(seen).toHaveBeenCalled();
  });
});

describe("subscribe", () => {
  it("notifies on mutation and stops after unsubscribe", async () => {
    const s = await freshStore();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.addCustom(newShortcut);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    s.addCustom(newShortcut);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
