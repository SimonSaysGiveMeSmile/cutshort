import { useState } from "react";
import { Bluetooth, Loader2, TerminalSquare, Wifi } from "lucide-react";
import { connection, parsePairing } from "../lib/connection";

interface Props {
  onConnected: () => void;
}

export function ConnectScreen({ onConnected }: Props) {
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function connectManual() {
    const p = parsePairing(manual);
    if (!p) {
      setErr("That doesn't look like an agent URL.");
      return;
    }
    setBusy(true);
    setErr("");
    const ok = await connection.pair(p);
    setBusy(false);
    if (ok) onConnected();
    else setErr(connection.lastError || "Couldn't reach the agent.");
  }

  async function bluetooth() {
    setBusy(true);
    setErr("");
    const ok = await connection.pairBluetooth();
    setBusy(false);
    if (ok) onConnected();
    else setErr(connection.lastError || "Bluetooth pairing failed.");
  }

  return (
    <div className="connect">
      <h1>
        Cut<span style={{ color: "var(--accent)" }}>Short</span>
      </h1>
      <p>
        A pocket shortcut deck. Run the agent on your computer, then scan the QR
        it prints — every key you tap fires on your Mac or PC.
      </p>

      <div className="run-card">
        <div className="run-card-head">
          <TerminalSquare size={16} strokeWidth={1.8} />
          On your computer
        </div>
        <code className="run-cmd">npx cutshort-agent</code>
        <span className="run-note">
          Scanning the QR it prints opens this deck already paired. No app store,
          no account.
        </span>
      </div>

      <div className="connect-or">or connect manually</div>

      <div className="connect-form">
        <div className="input-wrap">
          <Wifi size={16} strokeWidth={1.8} />
          <input
            className="input"
            placeholder="ws://hostname.local:8787"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <div className="btn-row">
          <button className="btn primary" disabled={busy || !manual} onClick={connectManual}>
            {busy ? <Loader2 className="spin" size={16} /> : null}
            Connect
          </button>
          {connection.bluetoothSupported() && (
            <button className="btn" disabled={busy} onClick={bluetooth}>
              <Bluetooth size={16} strokeWidth={1.8} />
              Bluetooth
            </button>
          )}
        </div>
        {err && <div className="connect-err">{err}</div>}
      </div>
    </div>
  );
}
