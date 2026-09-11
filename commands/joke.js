module.exports = async (sock, msg) => {
  const jokes = [
    "Why did the computer go to the doctor? Because it had a virus! 😂",
    "Why was the JavaScript developer sad? Because they didn't know how to null their feelings. 😄",
    "What do you call a sleeping bull? A bulldozer! 🐂😂"
  ];
  const joke = jokes[Math.floor(Math.random() * jokes.length)];
  await sock.sendMessage(msg.key.remoteJid, { text: joke });
};
