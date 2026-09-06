const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const readline = require("readline");

const menu = require("./commands/menu");
const joke = require("./commands/joke");
const game = require("./commands/game");
const ping = require("./commands/ping");
const help = require("./commands/help");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer));
  });
}

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState("./session");

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" })
  });

  sock.ev.on("creds.update", saveCreds);

  if (!state.creds.registered) {
    const phone = await ask(
      "Enter your WhatsApp number with country code (example: 2547XXXXXXXX): "
    );

    const cleanNumber = phone.replace(/\D/g, "");

    const code = await sock.requestPairingCode(cleanNumber);

    console.log("\n⚡ STUNNER MD PAIRING CODE:");
    console.log(code);
    console.log("\nOpen WhatsApp → Linked devices → Link a device → Link with phone number.");
  }

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log("⚡ STUNNER MD is connected!");
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;

      if (shouldReconnect) {
        startBot();
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

startBot();
