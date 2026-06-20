import { describe, it, expect, vi } from "vitest";

// macAccess imports nut.js at module load; mock it so no native binding loads
// (same Proxy trick as keys.test.js). We only exercise the pure name helpers.
vi.mock("@nut-tree-fork/nut-js", () => {
  const Key = new Proxy({}, { get: (_t, p) => (typeof p === "string" ? p : undefined) });
  return { keyboard: { config: {}, type: vi.fn(async () => {}) }, Key };
});

import { appNameFromTermProgram, appNameFromCommand, pickHostApp } from "./macAccess.js";

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

describe("pickHostApp", () => {
  it("uses the term-program name for plain terminals", () => {
    expect(pickHostApp("Apple_Terminal", null)).toBe("Terminal");
    expect(pickHostApp("iTerm.app", "/ignored")).toBe("iTerm");
  });

  it("prefers the parent .app over the generic VSCode label for forks", () => {
    // Cursor/Windsurf/VSCodium all set TERM_PROGRAM=vscode
    expect(pickHostApp("vscode", "Cursor")).toBe("Cursor");
    expect(pickHostApp("vscode", "Windsurf")).toBe("Windsurf");
  });

  it("falls back to the VSCode label when no parent .app is found", () => {
    expect(pickHostApp("vscode", null)).toBe('Visual Studio Code (shown as "Code")');
  });

  it("falls back to the parent app, then the raw value, then a generic phrase", () => {
    expect(pickHostApp("SomeFutureTerm", "Hyper")).toBe("Hyper");
    expect(pickHostApp("SomeFutureTerm", null)).toBe("SomeFutureTerm");
    expect(pickHostApp(undefined, null)).toBe("the app you launched this from");
  });
});
