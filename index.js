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

http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;

  if (pathname === "/" || pathname === "/pair" || pathname === "/qr") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

    let qrHtml = `<p>QR code is not ready yet. This page refreshes automatically.</p>`;
    if (latestQr) {
      const dataUrl = await QRCode.toDataURL(latestQr);
      qrHtml = `<p>WhatsApp → Linked devices → Link a device</p><img src="${dataUrl}" alt="WhatsApp QR" style="background:#fff;padding:12px;max-width:85vw">`;
    }

    const phoneHtml = pairingCode
      ? `<div style="margin:25px auto;padding:20px;border:1px solid #25d366;border-radius:12px;max-width:420px"><h2>📱 Phone-number pairing</h2><p>On WhatsApp: Linked devices → Link a device → Link with phone number</p><div style="font-size:32px;font-weight:bold;letter-spacing:6px;background:#222;padding:15px;border-radius:8px">${pairingCode}</div></div>`
      : `<div style="margin:25px auto;padding:20px;border:1px solid #444;border-radius:12px;max-width:420px"><h2>📱 Phone-number pairing</h2><p>Pairing code is not ready yet.</p></div>`;

    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5"><title>STUNNER MD Pairing</title><style>body{font-family:Arial;background:#111;color:#fff;text-align:center;padding:20px}h1{color:#25d366}.box{max-width:650px;margin:auto}img{border-radius:10px}</style></head><body><div class="box"><h1>⚡ STUNNER MD</h1><p>Status: <b>${botStatus}</b></p><section><h2>🔳 QR pairing</h2>${qrHtml}</section>${phoneHtml}<p>This page refreshes automatically.</p><p><a href="/status" style="color:#25d366">Check status</a></p></div></body></html>`);
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

  const sock = makeWASocket({ auth: state, version, browser: Browsers.ubuntu("Chrome"), syncFullHistory: false, logger: pino({ level: "silent" }) });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
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
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) setTimeout(startBot, 5000);
    }
  });

  if (!state.creds.registered) {
    const phone = (process.env.PHONE_NUMBER || "").replace(/\D/g, "");
    if (phone) {
      try {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const code = await sock.requestPairingCode(phone);
        pairingCode = code;
        botStatus = "QR + phone pairing ready";
        console.log("STUNNER MD phone pairing code generated.");
      } catch (error) {
        console.error("Phone pairing failed:", error);
      }
    } else {
      console.error("PHONE_NUMBER is required for phone-number pairing.");
    }
  }

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    const command = text.trim().toLowerCase();
    try {
      if (command === "/menu") await menu(sock, msg);
      else if (command === "/joke") await joke(sock, msg);
      else if (command === "/game") await game(sock, msg);
      else if (command === "/ping") await ping(sock, msg);
      else if (command === "/help") await help(sock, msg);
    } catch (error) {
      console.error("Command error:", error);
    }
  });
}

startBot().catch(error => console.error("Bot startup error:", error));