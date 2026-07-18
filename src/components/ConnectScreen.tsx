import { useState } from "react";
import { Bluetooth, Loader2 } from "lucide-react";
import { connection, parsePairing } from "../lib/connection";

interface Props {
  onConnected: () => void;
}

const AGENT_CMD = "npx cutshort-agent";

export function ConnectScreen({ onConnected }: Props) {
  const [manual, setManual] = useState("");
  // Which pairing is in flight (null = idle). Drives the disabled/spinner state and,
  // via a live region, tells screen-reader users the button did something during the
  // multi-second connect — otherwise CONNECT just goes silently disabled.
  const [pairing, setPairing] = useState<null | "manual" | "bluetooth">(null);
  const busy = pairing !== null;
  const [err, setErr] = useState("");
  // Copy outcome for both the button label and a live-region announcement (the
  // COPY→COPIED text swap sits inside the button's own accessible name, so AT never
  // hears it).
  const [copyState, setCopyState] = useState<"idle" | "ok" | "err">("idle");

  async function connectManual() {
    const p = parsePairing(manual);
    if (!p) {
      setErr("That doesn't look like an agent URL.");
      return;
    }
    setPairing("manual");
    setErr("");
    const ok = await connection.pair(p);
    setPairing(null);
    if (ok) onConnected();
    else setErr(connection.lastError || "Couldn't reach the agent.");
  }

  async function bluetooth() {
    setPairing("bluetooth");
    setErr("");
    const ok = await connection.pairBluetooth();
    setPairing(null);
    if (ok) onConnected();
    else setErr(connection.lastError || "Bluetooth pairing failed.");
  }

  function copyCmd() {
    navigator.clipboard?.writeText(AGENT_CMD).then(
      () => {
        setCopyState("ok");
        window.setTimeout(() => setCopyState("idle"), 1400);
      },
      () => {
        setCopyState("err");
        window.setTimeout(() => setCopyState("idle"), 1400);
      },
    );
  }

  return (
    <div className="cp">
      <span className="cp-tick cp-tick--tl" aria-hidden />
      <span className="cp-tick cp-tick--tr" aria-hidden />
      <span className="cp-tick cp-tick--bl" aria-hidden />
      <span className="cp-tick cp-tick--br" aria-hidden />

      <header className="cp-rail">
        <span className="cp-rail-id">
          CUTSHORT<span className="cp-sep">//</span>CONTROL
        </span>
        <span className="cp-rail-stat">
          <i className="cp-led" aria-hidden />
          STANDBY
        </span>
      </header>

      <main className="cp-main">
        <div className="cp-hero">
          <h1 className="cp-mark">
            <span className="cp-mark-a">CUT</span>
            <span className="cp-mark-b">SHORT</span>
          </h1>
          <p className="cp-tagline">
            Pocket shortcut deck. Every key you tap fires a real keystroke on
            your&nbsp;Mac or&nbsp;PC.
          </p>
        </div>

        <section className="cp-panel" style={{ animationDelay: "0.18s" }}>
          <div className="cp-panel-head">
            <span>01 / Run agent</span>
            <span className="cp-sep">localhost</span>
          </div>
          <div className="cp-term">
            <code>
              <span className="cp-prompt">$</span>
              {AGENT_CMD}
            </code>
            <button className="cp-copy" onClick={copyCmd} aria-label="Copy command">
              {copyState === "ok" ? "COPIED" : "COPY"}
            </button>
          </div>
          <span className="sr-only" role="status" aria-live="polite">
            {copyState === "ok"
              ? "Command copied to clipboard"
              : copyState === "err"
                ? "Couldn't copy — select and copy the command manually"
                : ""}
          </span>
          <p className="cp-note">
            Scan the QR it prints — opens this deck already paired. No app store,
            no account.
          </p>
        </section>

        <section className="cp-panel" style={{ animationDelay: "0.26s" }}>
          <div className="cp-panel-head">
            <span>02 / Manual link</span>
            <span className="cp-sep">ws://</span>
          </div>
          <div className="cp-console">
            <span className="cp-prompt">&gt;</span>
            <input
              className="cp-input"
              aria-label="Agent hostname and port"
              placeholder="hostname.local:8787"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter" && manual && !busy) connectManual();
              }}
            />
          </div>
          <div className="cp-actions" aria-busy={busy}>
            <span className="sr-only" role="status" aria-live="polite">
              {pairing === "manual"
                ? "Connecting to the agent…"
                : pairing === "bluetooth"
                  ? "Pairing over Bluetooth…"
                  : ""}
            </span>
            <button
              className="cp-btn cp-btn--primary"
              disabled={busy || !manual}
              onClick={connectManual}
            >
              {busy ? <Loader2 className="spin" size={15} /> : null}
              CONNECT
            </button>
            {connection.bluetoothSupported() && (
              <button className="cp-btn" disabled={busy} onClick={bluetooth}>
                <Bluetooth size={15} strokeWidth={2} />
                BLUETOOTH
              </button>
            )}
          </div>
          {err && (
            <div className="cp-err" role="alert">
              <span aria-hidden>!</span> {err}
            </div>
          )}
        </section>
      </main>

      <footer className="cp-foot">
        <span>v0.1.0</span>
        <span className="cp-sep">CutShort // open source</span>
        <span>READY</span>
      </footer>
    </div>
  );
}
