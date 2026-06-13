import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { connection, parsePairing } from "../lib/connection";
import type { OS } from "../shortcuts";

interface Props {
  onConnected: () => void;
}

// In the real product the *desktop* agent shows this QR; the phone scans it.
// Here we render a representative pairing payload so the flow is demonstrable
// end-to-end without the agent installed.
function pairingURL() {
  const code = "CUT-" + Math.abs(hash(navigator.userAgent)).toString(36).slice(0, 4).toUpperCase();
  return { code, url: `cutshort://${location.host}/pair?host=DevMachine&os=mac&t=${code}` };
}
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}

export function ConnectScreen({ onConnected }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [{ code, url }] = useState(pairingURL);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, {
        width: 188,
        margin: 1,
        color: { dark: "#0c1830", light: "#ffffff" },
      });
    }
  }, [url]);

  async function connectManual() {
    const p = parsePairing(manual);
    if (!p) return;
    setBusy(true);
    await connection.pair(p);
    setBusy(false);
    onConnected();
  }

  async function bluetooth() {
    setBusy(true);
    await connection.pairBluetooth();
    setBusy(false);
    if (connection.state === "live") onConnected();
  }

  function demo(os: OS) {
    connection.demo(os);
    onConnected();
  }

  return (
    <div className="connect">
      <h1>
        Cut<span style={{ color: "var(--accent)" }}>Short</span>
      </h1>
      <p>
        Your pocket shortcut deck. Open the desktop agent, then scan its code —
        every key you tap fires on your Mac or PC.
      </p>

      <div className="qr-card">
        <canvas ref={canvasRef} width={188} height={188} />
        <div className="pair-code">{code}</div>
      </div>

      <div style={{ width: "100%", display: "grid", gap: 12, placeItems: "center" }}>
        <input
          className="input"
          placeholder="…or paste agent URL (ws://host.local:8787)"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <div className="btn-row">
          <button className="btn primary" disabled={busy || !manual} onClick={connectManual}>
            Connect
          </button>
          <button className="btn" disabled={busy} onClick={bluetooth}>
            Bluetooth
          </button>
        </div>
      </div>

      <div className="btn-row" style={{ marginTop: 4 }}>
        <button className="btn" onClick={() => demo("mac")}>
          Try demo · macOS
        </button>
        <button className="btn" onClick={() => demo("win")}>
          Try demo · Windows
        </button>
      </div>
    </div>
  );
}
