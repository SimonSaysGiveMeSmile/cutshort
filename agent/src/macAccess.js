// macOS Accessibility helper
// ---------------------------
// Injecting keystrokes needs Accessibility permission, granted PER HOST APP
// (the terminal/IDE that launched node — not "node" itself). Two things trip
// people up: (1) reflexively clicking Deny on the prompt, (2) not knowing which
// row to enable afterwards. So we:
//   • figure out the exact host app name and tell the user to flip THAT row,
//   • do a harmless lone-modifier tap to force the app into the list (so the
//     row exists even if the prompt was denied),
//   • open the Accessibility pane directly — no hunting through Settings.
// No-op on Windows/Linux, where nut.js works without this.

import { execFileSync, exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { keyboard, Key } from "@nut-tree-fork/nut-js";

const STATE = path.join(os.homedir(), ".cutshort-agent.json");
const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
};
const writeState = (s) => {
  try {
    fs.writeFileSync(STATE, JSON.stringify(s));
  } catch {
    /* best-effort */
  }
};

// TERM_PROGRAM is the most reliable signal for the host app.
const TERM_MAP = {
  Apple_Terminal: "Terminal",
  "iTerm.app": "iTerm",
  vscode: 'Visual Studio Code (shown as "Code")',
  ghostty: "Ghostty",
  WezTerm: "WezTerm",
  Hyper: "Hyper",
  Tabby: "Tabby",
  WarpTerminal: "Warp",
  rio: "Rio",
};

// Fallback: walk the parent process chain looking for a .app bundle.
function appFromParents() {
  try {
    let pid = process.ppid;
    for (let i = 0; i < 12 && pid > 1; i++) {
      const out = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], {
        encoding: "utf8",
      }).trim();
      const sp = out.indexOf(" ");
      if (sp < 0) break;
      const parent = parseInt(out.slice(0, sp), 10);
      const comm = out.slice(sp + 1).trim();
      const m = comm.match(/\/([^/]+)\.app\//);
      if (m) return m[1];
      pid = parent;
    }
  } catch {
    /* ps unavailable */
  }
  return null;
}

export function hostAppName() {
  const tp = process.env.TERM_PROGRAM;
  if (tp && TERM_MAP[tp]) return TERM_MAP[tp];
  return appFromParents() || tp || "the app you launched this from";
}

// A lone-modifier tap is a no-op for the focused app but forces macOS to add
// this host app to the Accessibility list, so the user has a row to switch on.
async function registerInList() {
  try {
    keyboard.config.autoDelayMs = 0;
    await keyboard.type(Key.LeftShift);
  } catch {
    /* not trusted yet — the attempt itself is what registers the app */
  }
}

/** Open System Settings straight to the Accessibility pane. */
export function openAccessibilityPane() {
  exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');
}

// `rowName` lets the caller name the exact row to enable. In app mode that's the
// bundle ("CutShort"); otherwise we detect the host terminal/IDE.
export async function ensureAccessibility({ open = "auto", rowName } = {}) {
  if (process.platform !== "darwin") return; // win/linux: nothing to do
  const app = rowName || hostAppName();
  await registerInList();

  console.log("\n🔐  macOS needs Accessibility access to send keystrokes.");
  console.log(`    ➜  Turn ON exactly this row:  «${app}»`);
  console.log("       (System Settings ▸ Privacy & Security ▸ Accessibility)");

  const st = readState();
  const shouldOpen =
    open === "always" ||
    process.env.CUTSHORT_OPEN_SETTINGS === "1" ||
    (open === "auto" && !st.accessibilityOpened);

  if (shouldOpen) {
    openAccessibilityPane();
    writeState({ ...st, accessibilityOpened: true });
    console.log("    ✦ Opened it for you — just flip the switch next to «" + app + "».");
  }
  console.log("");
}
