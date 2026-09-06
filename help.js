module.exports = async (sock, msg) => {
  await sock.sendMessage(msg.key.remoteJid, {
    text: `╭━━〔 🆘 STUNNER MD HELP 〕━━╮
┃
┃ /menu  - Show bot menu
┃ /joke  - Random joke
┃ /game  - Play a game
┃ /ping  - Check bot status
┃ /help  - Show help
┃
╰━━━━━━━━━━━━━━━━━━━━━━╯`
  });
};
