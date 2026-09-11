module.exports = async (sock, msg) => {
  await sock.sendMessage(msg.key.remoteJid, {
    text: `⚡ STUNNER MD\n\nCommands:\n/menu - Show this menu\n/help - Help\n/ping - Check bot\n/joke - Get a joke\n/game - Play a game`
  });
};
