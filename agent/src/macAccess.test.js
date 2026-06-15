import { describe, it, expect, vi } from "vitest";

// macAccess imports nut.js at module load; mock it so no native binding loads
// (same Proxy trick as keys.test.js). We only exercise the pure name helpers.
vi.mock("@nut-tree-fork/nut-js", () => {
  const Key = new Proxy({}, { get: (_t, p) => (typeof p === "string" ? p : undefined) });
  return { keyboard: { config: {}, type: vi.fn(async () => {}) }, Key };
});

import { appNameFromTermProgram, appNameFromCommand } from "./macAccess.js";

// Getting the host-app name wrong means we tell the user to enable the wrong
// Accessibility row, so keystrokes silently never fire (terminal / NO_APP mode).
describe("appNameFromTermProgram", () => {
  it("maps known terminals to the name shown in the Accessibility list", () => {
    expect(appNameFromTermProgram("Apple_Terminal")).toBe("Terminal");
    expect(appNameFromTermProgram("iTerm.app")).toBe("iTerm");
    expect(appNameFromTermProgram("ghostty")).toBe("Ghostty");
    expect(appNameFromTermProgram("WarpTerminal")).toBe("Warp");
    expect(appNameFromTermProgram("WezTerm")).toBe("WezTerm");
  });

  it("returns null for an unknown / empty / missing value", () => {
    expect(appNameFromTermProgram("SomeFutureTerminal")).toBeNull();
    expect(appNameFromTermProgram("")).toBeNull();
    expect(appNameFromTermProgram(undefined)).toBeNull();
  });
});

describe("appNameFromCommand", () => {
  it("extracts the bundle name from a ps comm path (handles spaces)", () => {
    expect(appNameFromCommand("/Applications/iTerm.app/Contents/MacOS/iTerm")).toBe("iTerm");
    expect(
      appNameFromCommand("/Applications/Visual Studio Code.app/Contents/MacOS/Electron"),
    ).toBe("Visual Studio Code");
  });

  it("returns null when the command isn't inside a .app bundle", () => {
    expect(appNameFromCommand("/bin/zsh")).toBeNull();
    expect(appNameFromCommand("node")).toBeNull();
    expect(appNameFromCommand("")).toBeNull();
  });
});
