const http = require("http");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const pino = require("pino");

const menu = require("./commands/menu");
const joke = require("./commands/joke");
const game = require("./commands/game");
const ping = require("./commands/ping");
const help = require("./commands/help");

// Render Web Services need an HTTP listener.
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("STUNNER MD is running");
}).listen(port, () => console.log(`STUNNER MD server listening on port ${port}`));

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState("./session");

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" })
  });

  sock.ev.on("creds.update", saveCreds);

  if (!state.creds.registered) {
    const phone = (process.env.PHONE_NUMBER || "").replace(/\D/g, "");

    if (!phone) {
      console.error("PHONE_NUMBER environment variable is not set.");
      return;
    }

    const code = await sock.requestPairingCode(phone);

    console.log("STUNNER MD pairing code:");
    console.log(code);
    console.log("Use WhatsApp > Linked devices > Link a device > Link with phone number.");
  }

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log("STUNNER MD is connected!");
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;

      if (shouldReconnect) {
        setTimeout(startBot, 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];

    if (!msg.message || msg.key.fromMe) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

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
