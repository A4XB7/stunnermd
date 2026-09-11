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

function page(phoneMessage = "") {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="8"><title>STUNNER MD Pairing</title><style>body{font-family:Arial;background:#111;color:#fff;text-align:center;padding:20px}.box{max-width:650px;margin:auto}h1{color:#25d366}.card{margin:20px auto;padding:20px;border:1px solid #333;border-radius:14px;max-width:430px;background:#181818}input{box-sizing:border-box;width:100%;padding:14px;border-radius:8px;border:1px solid #555;background:#222;color:#fff;font-size:17px}button{width:100%;margin-top:10px;padding:14px;border:0;border-radius:8px;background:#25d366;color:#000;font-weight:bold;font-size:17px;cursor:pointer}img{border-radius:10px;max-width:85vw}.code{font-size:32px;font-weight:bold;letter-spacing:6px;background:#222;padding:15px;border-radius:8px;color:#25d366}.msg{padding:10px;border-radius:8px;background:#222;margin:10px 0}</style></head><body><div class="box"><h1>⚡ STUNNER MD</h1><p>Status: <b>${botStatus}</b></p><div class="card"><h2>📱 Pair with phone number</h2><p>Kenya: <b>+254</b> is already selected.</p><form method="POST" action="/pair-phone"><input name="phone" inputmode="numeric" pattern="[0-9]{9}" maxlength="9" placeholder="7XXXXXXXX" required><button type="submit">Generate Pairing Code</button></form>${phoneMessage}</div><section class="card"><h2>🔳 Scan QR Code</h2>${latestQr ? `<p>WhatsApp → Linked devices → Link a device</p><img src="${await QRCode.toDataURL(latestQr)}" alt="WhatsApp QR">` : `<p>QR code is not ready yet. This page refreshes automatically.</p>`}</section><p><a href="/status" style="color:#25d366">Check status</a></p></div></body></html>`;
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
        message = `<div class="msg">❌ Enter a valid Kenyan mobile number, for example 7XXXXXXXX.</div>`;
      } else if (!waSocket) {
        message = `<div class="msg">⏳ WhatsApp connection is not ready yet. Try again in a few seconds.</div>`;
      } else if (pairingBusy) {
        message = `<div class="msg">⏳ A pairing request is already running. Please wait.</div>`;
      } else {
        pairingBusy = true;
        try {
          const code = await waSocket.requestPairingCode(phone);
          pairingCode = code;
          botStatus = "phone pairing ready";
          message = `<div class="msg"><p>✅ Pairing code:</p><div class="code">${code}</div><p>Enter this code in WhatsApp → Linked devices → Link with phone number.</p></div>`;
        } catch (error) {
          console.error("Phone pairing failed:", error);
          message = `<div class="msg">❌ Phone pairing could not be generated right now. Try QR pairing below.</div>`;
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