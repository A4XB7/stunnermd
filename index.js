const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const pino = require("pino");

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState("./session");

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" })
  });

  sock.ev.on("creds.update", saveCreds);

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

    if (command === "/ping") {
      await sock.sendMessage(msg.key.remoteJid, {
        text: "🏓 Pong!\n⚡ STUNNER MD is online."
      });
    }

    if (command === "/menu") {
      await sock.sendMessage(msg.key.remoteJid, {
        text:
`╭━━━〔 ⚡ STUNNER MD ⚡ 〕━━━╮
┃
┃ 📌 COMMANDS
┃
┃ /menu
┃ /joke
┃ /game
┃ /ping
┃ /help
┃
╰━━━━━━━━━━━━━━━━━━━━━━╯`
      });
    }

    if (command === "/joke") {
      const jokes = [
        "😂 Why did the computer go to the doctor? It had a virus!",
        "🤣 What do you call a sleeping computer? A nap-top!",
        "😂 Why was the phone wearing glasses? It lost its contacts!"
      ];

      const joke =
        jokes[Math.floor(Math.random() * jokes.length)];

      await sock.sendMessage(msg.key.remoteJid, {
        text: joke
      });
    }

    if (command === "/help") {
      await sock.sendMessage(msg.key.remoteJid, {
        text:
`🆘 STUNNER MD HELP

/menu - Show menu
/joke - Random joke
/game - Game
/ping - Check bot
/help - Help`
      });
    }

    if (command === "/game") {
      const number = Math.floor(Math.random() * 10) + 1;

      await sock.sendMessage(msg.key.remoteJid, {
        text:
`🎮 STUNNER MD GAME

I'm thinking of a number from 1 to 10.

Your challenge: guess it! 😎

Hint: The number is ${number}.`
      });
    }
  });
}

startBot();
