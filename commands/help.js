module.exports = async (sock, msg) => {
  await sock.sendMessage(msg.key.remoteJid, {
    text: "ℹ️ STUNNER MD HELP\n\nUse /menu to see available commands.\nUse /ping to check the bot.\nUse /joke for a joke.\nUse /game to play."
  });
};
