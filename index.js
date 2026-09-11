const http = require("http");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestWaWebVersion } = require("@whiskeysockets/baileys");
const pino = require("pino");
const QRCode = require("qrcode");
const menu = require("./commands/menu");
const joke = require("./commands/joke");
const game = require("./commands/game");
const ping = require("./commands/ping");
const help = require("./commands/help");

const port = process.env.PORT || 3000;
let latestQr = null;
let botStatus = "starting";
let pairingCode = null;
let waSocket = null;
let pairingBusy = false;

async function page(phoneMessage = "") {
  let qrHtml = `<p>QR code is not ready yet. This page refreshes automatically every 2 minutes.</p>`;
  if (latestQr) {
    const dataUrl = await QRCode.toDataURL(latestQr);
    qrHtml = `<p>Open WhatsApp → Linked devices → Link a device.</p><img src="${dataUrl}" alt="WhatsApp QR code">`;
  }

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="120"><title>STUNNER MD Pairing</title><style>
  *{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#0b0b0b;color:#fff;text-align:center;padding:24px}.box{max-width:760px;margin:auto}h1{color:#25d366;font-size:34px;margin-bottom:6px}.status{color:#aaa;margin-bottom:25px}.options{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{padding:22px;border:1px solid #292929;border-radius:16px;background:#151515;box-shadow:0 8px 25px #0006}h2{margin-top:0}input{width:100%;padding:14px;border-radius:10px;border:1px solid #444;background:#222;color:#fff;font-size:17px;margin-top:10px}button{width:100%;margin-top:10px;padding:14px;border:0;border-radius:10px;background:#25d366;color:#000;font-weight:bold;font-size:17px;cursor:pointer}.prefix{font-size:18px;color:#25d366;font-weight:bold}.code{font-size:30px;font-weight:bold;letter-spacing:6px;background:#222;padding:14px;border-radius:10px;color:#25d366;margin:12px 0}.msg{padding:12px;border-radius:10px;background:#202020;margin-top:14px}.qr img{max-width:100%;border-radius:12px;background:#fff;padding:10px}@media(max-width:650px){.options{grid-template-columns:1fr}}a{color:#25d366}
</style></head><body><div class="box"><h1>⚡ STUNNER MD</h1><div class="status">Status: <b>${botStatus}</b></div><div class="options">
<section class="card"><h2>OPTION 1 — 📱 +254 Pairing</h2><p>Enter your Kenyan WhatsApp number.</p><div class="prefix">🇰🇪 +254</div><form method="POST" action="/pair-phone"><input name="phone" inputmode="numeric" pattern="7[0-9]{8}" maxlength="9" placeholder="7XXXXXXXX" required><button type="submit">Generate Pairing Code</button></form>${phoneMessage}</section>
<section class="card qr"><h2>OPTION 2 — 🔳 QR Pairing</h2>${qrHtml}</section>
</div><p style="margin-top:24px"><a href="/status">Check bot status</a></p><p style="color:#777;font-size:13px">This page refreshes automatically every 2 minutes.</p></div></body></html>`;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (pathname === "/pair-phone" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      const params = new URLSearchParams(body);
      const rawPhone = (params.get("phone") || "").replace(/\D/g, "");
      const phone = rawPhone.startsWith("254") ? rawPhone : `254${rawPhone}`;
      let message = "";

      if (!/^2547\d{8}$/.test(phone)) {
        message = `<div class="msg">❌ Enter a valid Kenyan number such as 7XXXXXXXX.</div>`;
      } else if (!waSocket) {
        message = `<div class="msg">⏳ WhatsApp connection is not ready. Please try again shortly.</div>`;
      } else if (pairingBusy) {
        message = `<div class="msg">⏳ A pairing request is already running. Please wait.</div>`;
      } else {
        pairingBusy = true;
        try {
          const code = await waSocket.requestPairingCode(phone);
          pairingCode = code;
          botStatus = "phone pairing ready";
          message = `<div class="msg"><p>✅ Your pairing code:</p><div class="code">${code}</div><p>In WhatsApp, open Linked devices → Link with phone number and enter the code.</p></div>`;
        } catch (error) {
          console.error("Phone pairing failed:", error);
          message = `<div class="msg">❌ Phone pairing could not be generated right now. Please use Option 2 (QR) instead.</div>`;
        } finally {
          pairingBusy = false;
        }
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await page(message));
    });
    return;
  }

  if (pathname === "/" || pathname === "/pair" || pathname === "/qr") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(await page());
    return;
  }

  if (pathname === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: botStatus, pairingCode: pairingCode ? "available" : null }));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
}).listen(port, () => console.log(`STUNNER MD server listening on port ${port}`));

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./session");
  const { version } = await fetchLatestWaWebVersion();
  console.log(`Using WhatsApp Web version ${version.join(".")}`);

  waSocket = makeWASocket({ auth: state, version, browser: Browsers.ubuntu("Chrome"), syncFullHistory: false, logger: pino({ level: "silent" }) });
  waSocket.ev.on("creds.update", saveCreds);

  waSocket.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      latestQr = qr;
      botStatus = "QR ready";
      console.log("STUNNER MD QR is ready.");
    }
    if (connection === "open") {
      latestQr = null;
      pairingCode = null;
      botStatus = "connected";
      console.log("STUNNER MD is connected!");
    }
    if (connection === "close") {
      botStatus = "disconnected";
      waSocket = null;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) setTimeout(startBot, 5000);
    }
  });

  waSocket.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    const command = text.trim().toLowerCase();
    try {
      if (command === "/menu") await menu(waSocket, msg);
      else if (command === "/joke") await joke(waSocket, msg);
      else if (command === "/game") await game(waSocket, msg);
      else if (command === "/ping") await ping(waSocket, msg);
      else if (command === "/help") await help(waSocket, msg);
    } catch (error) {
      console.error("Command error:", error);
    }
  });
}

startBot().catch(error => console.error("Bot startup error:", error));