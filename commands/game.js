module.exports = async (sock, msg) => {
  const choices = ["rock", "paper", "scissors"];
  const bot = choices[Math.floor(Math.random() * choices.length)];
  await sock.sendMessage(msg.key.remoteJid, {
    text: `🎮 STUNNER GAME\n\nI picked: ${bot}\n\nReply /game again for another round!`
  });
};
