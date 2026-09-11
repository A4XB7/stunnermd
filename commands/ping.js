module.exports = async (sock, msg) => {
  await sock.sendMessage(msg.key.remoteJid, { text: "🏓 Pong! STUNNER MD is online." });
};
