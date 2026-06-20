// macOS .app launcher — make Accessibility show "CutShort", not "Node"
// --------------------------------------------------------------------
// nut.js sends keystrokes via CGEvents; macOS attributes the Accessibility
// grant to the "responsible process". A bare `node` run from a terminal is
// attributed to node (or the terminal), so the Accessibility list shows a
// generic "Node" row. By generating a CutShort.app bundle (CFBundleName =
// CutShort) and relaunching THROUGH it via LaunchServices, the responsible
// process becomes CutShort.app — so the list shows a dedicated "CutShort" row,
// which is both clearer and more scoped than enabling all of Terminal.
//
// The bundle's main executable is a COPY of the current node binary — a real
// Mach-O is required for a valid app and a stable TCC identity. It is a copy
// (never a symlink/hardlink) on purpose: ad-hoc code-signing must not touch the
// user's real node. The grant's identity is the copied node's cdhash, so it
// survives agent updates and only needs re-granting when Node itself changes.
//
// Everything here is macOS-only; callers guard on process.platform.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const APP_NAME = "CutShort";
const BUNDLE_ID = "online.cutshort.agent";
const APP_VERSION = "0.1.0";

const APP_DIR = path.join(os.homedir(), "Applications", `${APP_NAME}.app`);
const CONTENTS = path.join(APP_DIR, "Contents");
const MACOS_DIR = path.join(CONTENTS, "MacOS");
const EXEC_PATH = path.join(MACOS_DIR, APP_NAME);
const PLIST_PATH = path.join(CONTENTS, "Info.plist");
const STAMP_PATH = path.join(CONTENTS, ".cutshort-stamp.json");
const PID_FILE = path.join(os.homedir(), ".cutshort-agent.pid");

export const bundlePath = () => APP_DIR;

/** True when this process is the relaunched bundle (set via the --as-app flag). */
export function runningAsApp() {
  return process.argv.includes("--as-app");
}

function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key><string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleExecutable</key><string>${APP_NAME}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleVersion</key><string>${APP_VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${APP_VERSION}</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;
}

// The bundle is keyed to the node binary it wraps + the agent version, so we
// only rebuild (a ~100MB copy) when one of those actually changes.
function currentStamp() {
  return { node: fs.realpathSync(process.execPath), version: process.version, app: APP_VERSION };
}
function stampMatches() {
  try {
    const have = JSON.parse(fs.readFileSync(STAMP_PATH, "utf8"));
    const want = currentStamp();
    return (
      have.node === want.node &&
      have.version === want.version &&
      have.app === want.app &&
      fs.existsSync(EXEC_PATH)
    );
  } catch {
    return false;
  }
}

// Dynamically-linked node (e.g. Homebrew) is a tiny stub that loads the real
// runtime from a sibling libnode*.dylib via the exec's @loader_path[/../lib]
// rpaths; every other dependency uses an absolute path that resolves on any
// machine where node is installed. So we copy libnode into the matching bundle
// location to make the copy self-contained. Static node.org builds have no such
// dylib — nothing is copied and the lone executable is already self-sufficient.
// Returns the list of copied dylib paths (to be signed).
function bundleRuntimeDylibs(realNode) {
  const binDir = path.dirname(realNode);
  const layout = [
    [binDir, MACOS_DIR], // @loader_path
    [path.join(binDir, "..", "lib"), path.join(CONTENTS, "lib")], // @loader_path/../lib
  ];
  const copied = [];
  for (const [fromDir, toDir] of layout) {
    let names = [];
    try {
      names = fs.readdirSync(fromDir).filter((n) => /^libnode(\.\d+)?\.dylib$/.test(n));
    } catch {
      /* dir absent */
    }
    if (!names.length) continue;
    fs.mkdirSync(toDir, { recursive: true });
    for (const n of names) {
      const dest = path.join(toDir, n);
      fs.copyFileSync(path.join(fromDir, n), dest);
      copied.push(dest);
    }
  }
  return copied;
}

/** Create or refresh ~/Applications/CutShort.app. Returns the bundle path. */
export function ensureAppBundle() {
  if (stampMatches()) return APP_DIR;
  // Rebuild from scratch so stale dylibs from a previous node don't linger.
  try {
    fs.rmSync(APP_DIR, { recursive: true, force: true });
  } catch {
    /* fresh install */
  }
  fs.mkdirSync(MACOS_DIR, { recursive: true });
  fs.writeFileSync(PLIST_PATH, infoPlist());

  // Copy (never link) node so signing can't alter the user's real binary.
  const realNode = fs.realpathSync(process.execPath);
  fs.copyFileSync(realNode, EXEC_PATH);
  fs.chmodSync(EXEC_PATH, 0o755);
  bundleRuntimeDylibs(realNode);

  // Write the build stamp BEFORE signing so codesign seals it too — adding any
  // file to the bundle after signing invalidates the seal.
  fs.writeFileSync(STAMP_PATH, JSON.stringify(currentStamp()));

  // Ad-hoc sign so the bundle has a stable identity for the TCC grant. `--deep`
  // signs the nested libnode dylib (in Contents/lib) in the same pass, which is
  // what makes the signature verify cleanly. Best-effort: an unsigned bundle
  // still launches and still shows "CutShort"; signing just keeps the
  // Accessibility grant from resetting on every launch.
  try {
    execFileSync(
      "codesign",
      ["--force", "--deep", "--sign", "-", "--identifier", BUNDLE_ID, APP_DIR],
      { stdio: "ignore" },
    );
  } catch {
    /* codesign missing (no CLT) — proceed unsigned */
  }

  return APP_DIR;
}

/**
 * Relaunch the agent through the bundle so macOS attributes it to CutShort.app.
 * `open <bundle> --args …` forwards the args as the bundle executable's argv,
 * so node runs `<scriptPath> --as-app …`. Returns true if dispatched (the
 * caller should then exit — it has become a throwaway launcher).
 */
export function relaunchViaApp(scriptPath, extraArgs = []) {
  try {
    ensureAppBundle();
    execFileSync(
      "open",
      [APP_DIR, "--args", path.resolve(scriptPath), "--as-app", ...extraArgs],
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

/** Record the running app's pid so `--stop` can find it later. */
export function writePid() {
  try {
    fs.writeFileSync(PID_FILE, String(process.pid));
  } catch {
    /* best-effort */
  }
}
export function clearPid() {
  try {
    fs.rmSync(PID_FILE, { force: true });
  } catch {
    /* best-effort */
  }
}

/** True if a process with this pid currently exists (signal 0 = existence probe). */
export function pidAlive(pid) {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM"; // exists but owned by another user — still alive
  }
}

/** Stop a running (backgrounded) agent. Returns the pid killed, or 0. */
export function stopRunning() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
    fs.rmSync(PID_FILE, { force: true });
    // Only signal a pid that's actually alive: after a hard crash the pid file
    // is stale, and once the OS recycles that pid a blind SIGTERM could kill an
    // unrelated process.
    if (pidAlive(pid)) {
      process.kill(pid, "SIGTERM");
      return pid;
    }
  } catch {
    /* no pid file / already gone */
  }
  return 0;
}
