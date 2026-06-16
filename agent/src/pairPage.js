// Browser pairing page (app mode)
// --------------------------------
// When the agent runs as CutShort.app it has no terminal to print the QR into,
// so it serves this page and opens it in the default browser. The user scans
// the on-screen QR with their phone — same as scanning the terminal QR before.
// It also surfaces the one-time Accessibility step and a Stop button.
//
// Styled as a monochrome "control panel" to match the phone app's homepage.
// Self-contained (system monospace, no web fonts) so it renders identically
// even when the agent host is offline / LAN-only.

import QRCode from "qrcode";

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * @param {{label:string,url:string}[]} entries  scan targets (LAN / tunnel)
 * @param {string} appName   bundle name shown in the UI + Accessibility row
 */
export async function renderPairPage({ entries, appName }) {
  const cards = await Promise.all(
    entries.map(async (e) => {
      const data = await QRCode.toDataURL(e.url, { margin: 1, width: 320, errorCorrectionLevel: "M" });
      return `<section class="card">
        <div class="card-head"><span>${esc(e.label)}</span><span class="sep">scan</span></div>
        <img alt="QR code for ${esc(e.label)}" src="${data}" />
        <code>${esc(e.url)}</code>
      </section>`;
    }),
  );

  const cardsHtml = cards.length
    ? `<div class="cards">${cards.join("")}</div>`
    : `<p class="muted">No reachable address yet — waiting for the network/tunnel…</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(appName)} — pair your phone</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; color: #ededed;
    font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
    background-color: #060607;
    background-image:
      linear-gradient(rgba(255,255,255,.028) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.028) 1px, transparent 1px);
    background-size: 30px 30px;
    display: flex; flex-direction: column; align-items: center;
    padding: clamp(20px,5vw,40px) clamp(16px,5vw,40px) 40px;
    position: relative;
  }
  body::before {
    content: ""; position: fixed; inset: 0; pointer-events: none;
    background: radial-gradient(125% 80% at 50% 0%, transparent 45%, rgba(0,0,0,.6) 100%);
  }
  .rail, main, footer { width: 100%; max-width: 760px; }
  .rail {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,.1);
    font-size: 11px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase;
    color: rgba(255,255,255,.6);
  }
  .rail .id { color: #fff; }
  .sep { color: rgba(255,255,255,.32); padding: 0 .5ch; }
  .stat { display: inline-flex; align-items: center; gap: 8px; }
  .led {
    width: 7px; height: 7px; border-radius: 50%; background: #fff;
    box-shadow: 0 0 9px rgba(255,255,255,.9); animation: pulse 1.8s ease-in-out infinite;
  }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .22; } }
  main { display: flex; flex-direction: column; align-items: center; }
  h1 {
    margin: 34px 0 0; font-size: clamp(34px,9vw,60px); font-weight: 700;
    letter-spacing: .04em; text-transform: uppercase; text-align: center;
  }
  .lead { margin: .6rem 0 0; color: rgba(255,255,255,.5); font-size: 13px; letter-spacing: .02em; text-align: center; }
  .cards { display: flex; flex-wrap: wrap; gap: 18px; justify-content: center; margin-top: 30px; }
  .card { width: 320px; max-width: 100%; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.018); padding: 14px; }
  .card-head, .panel-head {
    display: flex; align-items: baseline; justify-content: space-between;
    padding-bottom: 10px; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,.08);
    font-size: 10.5px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: rgba(255,255,255,.78);
  }
  .card img { width: 100%; aspect-ratio: 1 / 1; background: #fff; padding: 12px; display: block; }
  .card code { display: block; margin-top: 10px; font-size: 11px; color: rgba(255,255,255,.5); word-break: break-all; }
  .muted { color: rgba(255,255,255,.5); margin-top: 30px; font-size: 13px; }
  .panel { width: 100%; max-width: 520px; margin-top: 26px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.018); padding: 14px; }
  .panel p { margin: 0 0 12px; font-size: 12.5px; line-height: 1.55; color: rgba(255,255,255,.6); }
  .panel b { color: #fff; }
  .btn {
    appearance: none; border: 1px solid rgba(255,255,255,.4); background: transparent; color: #fff;
    font-family: inherit; font-size: 11px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase;
    padding: 10px 16px; cursor: pointer; transition: background .16s ease, color .16s ease, border-color .16s ease;
  }
  .btn:hover { background: #fff; color: #000; border-color: #fff; }
  footer {
    margin-top: 36px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,.1);
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: rgba(255,255,255,.4);
  }
</style>
</head>
<body>
  <div class="rail">
    <span class="id">CUTSHORT<span class="sep">//</span>PAIR</span>
    <span class="stat"><i class="led"></i> LIVE</span>
  </div>

  <main>
    <h1>${esc(appName)}</h1>
    <p class="lead">Scan a code with your phone to control this Mac.</p>

    ${cardsHtml}

    <section class="panel">
      <div class="panel-head"><span>01 / Accessibility</span></div>
      <p>If shortcuts don't fire, enable <b>${esc(appName)}</b> under
         System Settings ▸ Privacy &amp; Security ▸ Accessibility, then restart the agent.</p>
      <button class="btn" onclick="openAccess(this)">Open Accessibility settings</button>
    </section>
  </main>

  <footer>
    <span>${esc(appName)}<span class="sep">//</span>v0.1.0</span>
    <button class="btn" onclick="stop()">Stop agent</button>
  </footer>

  <script>
    function openAccess(b) { fetch('/api/open-accessibility', { method: 'POST' }); b.textContent = 'OPENED SETTINGS ✓'; }
    function stop() {
      fetch('/api/quit', { method: 'POST' }).finally(() => {
        document.body.innerHTML = '<p style="font-family:ui-monospace,monospace;color:#888;padding:3rem;text-align:center;letter-spacing:.12em">CUTSHORT AGENT STOPPED — you can close this tab.</p>';
      });
    }
  </script>
</body>
</html>`;
}
