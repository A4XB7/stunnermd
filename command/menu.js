module.exports = async (sock, msg) => {
  await sock.sendMessage(msg.key.remoteJid, {
    text: `╭━━━〔 ⚡ STUNNER MD ⚡ 〕━━━╮
┃
┃ 👋 Welcome to STUNNER MD
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
};
