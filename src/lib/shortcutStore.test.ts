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
