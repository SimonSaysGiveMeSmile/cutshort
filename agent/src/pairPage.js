// Browser pairing page (app mode)
// --------------------------------
// When the agent runs as CutShort.app it has no terminal to print the QR into,
// so it serves this page and opens it in the default browser. The user scans
// the on-screen QR with their phone — same as scanning the terminal QR before.
// It also surfaces the one-time Accessibility step and a Stop button.

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
        <h2>${esc(e.label)}</h2>
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
    margin: 0; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
    background: radial-gradient(120% 120% at 50% 0%, #15171c 0%, #0a0b0e 60%); color: #e9edf2;
    display: flex; flex-direction: column; align-items: center; padding: 2.5rem 1.25rem 3rem;
  }
  header { text-align: center; margin-bottom: 1.75rem; }
  h1 { margin: 0; font-size: 1.6rem; letter-spacing: -0.01em; }
  header p { margin: .4rem 0 0; color: #9aa3ad; }
  .cards { display: flex; flex-wrap: wrap; gap: 1.25rem; justify-content: center; }
  .card {
    background: #14161b; border: 1px solid #23262d; border-radius: 16px; padding: 1.1rem 1.1rem 1.25rem;
    width: 320px; text-align: center; box-shadow: 0 8px 30px rgba(0,0,0,.35);
  }
  .card h2 { margin: 0 0 .75rem; font-size: .95rem; color: #c7ccd3; font-weight: 600; }
  .card img { width: 280px; height: 280px; background: #fff; border-radius: 10px; display: block; margin: 0 auto .7rem; }
  code { font-size: .72rem; color: #8b93a7; word-break: break-all; display: block; }
  .muted { color: #9aa3ad; }
  .access { max-width: 560px; margin: 2rem auto 0; text-align: center; color: #b9c0c9; line-height: 1.5; }
  .access b { color: #fff; }
  .btn {
    appearance: none; border: 1px solid #2c2f37; background: #1b1e25; color: #e9edf2;
    border-radius: 10px; padding: .55rem 1rem; font-size: .85rem; cursor: pointer; margin: .35rem;
  }
  .btn:hover { background: #232730; }
  .btn.stop { border-color: #5a2230; color: #ff9aa9; }
  footer { margin-top: 2rem; }
</style>
</head>
<body>
  <header>
    <h1>${esc(appName)}</h1>
    <p>Scan a code below with your phone to control this Mac.</p>
  </header>

  ${cardsHtml}

  <section class="access">
    <h3>One-time: allow keystrokes</h3>
    <p>If shortcuts don't fire, enable <b>${esc(appName)}</b> under
       System Settings ▸ Privacy &amp; Security ▸ Accessibility, then restart the agent.</p>
    <button class="btn" onclick="openAccess(this)">Open Accessibility settings</button>
  </section>

  <footer>
    <button class="btn stop" onclick="stop()">Stop agent</button>
  </footer>

  <script>
    function openAccess(b) { fetch('/api/open-accessibility', { method: 'POST' }); b.textContent = 'Opened settings ✓'; }
    function stop() {
      fetch('/api/quit', { method: 'POST' }).finally(() => {
        document.body.innerHTML = '<p style="font-family:system-ui;color:#9aa3ad;padding:3rem;text-align:center">CutShort agent stopped. You can close this tab.</p>';
      });
    }
  </script>
</body>
</html>`;
}
