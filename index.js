const http = require("http");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestWaWebVersion
} = require("@whiskeysockets/baileys");
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
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>STUNNER MD</title><style>body{font-family:Arial;background:#111;color:#fff;text-align:center;padding:30px}img{background:#fff;padding:12px;max-width:85vw}a{color:#25d366}.box{max-width:600px;margin:auto}</style></head><body><div class="box"><h1>⚡ STUNNER MD</h1><p>Status: <b>${botStatus}</b></p><p><a href="/pair">Open pairing page</a></p></div></body></html>`);
    return;
  }

  if (req.url === "/pair") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (!latestQr) {
      res.end(`<!doctype html><html><body style="font-family:Arial;text-align:center;background:#111;color:#fff;padding:30px"><h1>⚡ STUNNER MD</h1><p>QR code is not ready yet.</p><p>Refresh this page in a few seconds.</p></body></html>`);
      return;
    }
    const dataUrl = await QRCode.toDataURL(latestQr);
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="10"></head><body style="font-family:Arial;text-align:center;background:#111;color:#fff;padding:20px"><h1>⚡ STUNNER MD QR</h1><p>WhatsApp → Linked devices → Link a device</p><img src="${dataUrl}" alt="WhatsApp QR"><p>This page refreshes automatically.</p></body></html>`);
    return;
  }

  if (req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: botStatus, pairingCode: pairingCode ? "available" : null }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
}).listen(port, () => console.log(`STUNNER MD server listening on port ${port}`));

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./session");
  const { version } = await fetchLatestWaWebVersion();

  console.log(`Using WhatsApp Web version ${version.join(".")}`);

  const sock = makeWASocket({
    auth: state,
    version,
    browser: Browsers.ubuntu("Chrome"),
    syncFullHistory: false,
    logger: pino({ level: "silent" })
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      latestQr = qr;
      botStatus = "QR ready";
      pairingCode = null;
      console.log("STUNNER MD QR is ready. Open /pair on the Render URL to scan it.");
    }

    if (connection === "open") {
      latestQr = null;
      pairingCode = null;
      botStatus = "connected";
      console.log("STUNNER MD is connected!");
    }

    if (connection === "close") {
      botStatus = "disconnected";
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) setTimeout(startBot, 5000);
    }
  });

  // PHONE_NUMBER enables the alternative phone-number pairing method.
  // Set PAIRING_MODE=phone to use it; otherwise QR mode is used.
  if (!state.creds.registered && process.env.PAIRING_MODE === "phone") {
    const phone = (process.env.PHONE_NUMBER || "").replace(/\D/g, "");
    if (!phone) {
      console.error("PHONE_NUMBER is required when PAIRING_MODE=phone.");
    } else {
      try {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const code = await sock.requestPairingCode(phone);
        pairingCode = code;
        botStatus = "phone pairing ready";
        console.log("STUNNER MD phone pairing code:");
        console.log(code);
        console.log("WhatsApp > Linked devices > Link a device > Link with phone number.");
      } catch (error) {
        console.error("Phone pairing failed:", error);
      }
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
