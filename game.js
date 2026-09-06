module.exports = async (sock, msg) => {
  const number = Math.floor(Math.random() * 10) + 1;

  await sock.sendMessage(msg.key.remoteJid, {
    text: `🎮 STUNNER MD GAME

I'm thinking of a number from 1 to 10.

Your challenge: guess it! 😎

Reply with your guess.`
  });

  console.log(`Game number: ${number}`);
};
