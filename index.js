const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const qrcode = require('qrcode');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestWaWebVersion, Browsers, makeCacheableSignalKeyStore, downloadMediaMessage } = require('@whiskeysockets/baileys');

const port = process.env.PORT || 3000;
const SESSIONS_DIR = './sessions';
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const sessions = new Map();
const reconnectTimers = new Map();
const pairingBusy = new Set();

function normalizePhone(raw) {
  let phone = String(raw || '').replace(/\D/g, '');
  if (phone.startsWith('0')) phone = '254' + phone.slice(1);
  if (phone.startsWith('7') && phone.length === 9) phone = '254' + phone;
  return phone;
}

function sessionId(phone) {
  return normalizePhone(phone);
}

function sessionPath(phone) {
  return path.join(SESSIONS_DIR, sessionId(phone));
}

async function listSessionIds() {
  try {
    const entries = await fs.readdir(SESSIONS_DIR, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name).filter(x => /^2547\d{8}$/.test(x));
  } catch { return []; }
}

function getText(msg) {
  return (msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || '').trim();
}

function getQuotedMessage(msg) {
  return msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
}

async function sendQuotedMedia(socket, msg) {
  const quoted = getQuotedMessage(msg);
  if (!quoted) {
    await socket.sendMessage(msg.key.remoteJid, { text: '📥 Reply to a photo, video, audio, or document with /download.' });
    return;
  }
  const type = Object.keys(quoted)[0];
  if (!['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(type)) {
    await socket.sendMessage(msg.key.remoteJid, { text: '❌ The quoted message does not contain downloadable media.' });
    return;
  }
  try {
    const mediaMsg = { key: { ...msg.key, fromMe: false }, message: quoted };
    const buffer = await downloadMediaMessage(mediaMsg, 'buffer', {}, { logger, reuploadRequest: socket.updateMediaMessage });
    const m = quoted[type];
    const out = type === 'imageMessage' ? { image: buffer, caption: '📥 STUNNER MD' } :
      type === 'videoMessage' ? { video: buffer, caption: '📥 STUNNER MD' } :
      type === 'audioMessage' ? { audio: buffer, mimetype: m.mimetype || 'audio/mpeg' } :
      { document: buffer, mimetype: m.mimetype || 'application/octet-stream', fileName: m.fileName || 'download' };
    await socket.sendMessage(msg.key.remoteJid, out);
  } catch (e) {
    console.error('Download error:', e?.stack || e?.message || e);
    await socket.sendMessage(msg.key.remoteJid, { text: '❌ Download failed. Reply to the original media message and try again.' });
  }
}

async function sendProfilePicture(socket, msg) {
  const jid = msg.key.participant || msg.key.remoteJid;
  try {
    const url = await socket.profilePictureUrl(jid, 'image');
    await socket.sendMessage(msg.key.remoteJid, { image: { url }, caption: '🖼️ Profile picture — STUNNER MD' });
  } catch {
    await socket.sendMessage(msg.key.remoteJid, { text: '❌ No profile picture is available for this contact.' });
  }
}

async function handleCommand(socket, msg) {
  const text = getText(msg);
  const command = text.split(/\s+/)[0].toLowerCase();
  if (command === '/menu') return require('./commands/menu')(socket, msg);
  if (command === '/joke') return require('./commands/joke')(socket, msg);
  if (command === '/game') return require('./commands/game')(socket, msg);
  if (command === '/ping') return require('./commands/ping')(socket, msg);
  if (command === '/help') return require('./commands/help')(socket, msg);
  if (command === '/getpp') return sendProfilePicture(socket, msg);
  if (command === '/download' || command === '/dl') return sendQuotedMedia(socket, msg);
}

function statusText() {
  const all = [...sessions.values()].map(s => ({ phone: s.phone, status: s.status }));
  return all.length ? all : [];
}

async function resetSession(phone) {
  try {
    await fs.rm(sessionPath(phone), { recursive: true, force: true });
    console.log(`Session cleared for ${phone}. A new pairing is required.`);
  } catch (e) { console.error('Could not clear session:', e?.message || e); }
}

function scheduleReconnect(phone, delay = 3000) {
  clearTimeout(reconnectTimers.get(phone));
  const timer = setTimeout(() => startBot(phone), delay);
  reconnectTimers.set(phone, timer);
}

async function startBot(phone) {
  phone = sessionId(phone);
  if (!/^2547\d{8}$/.test(phone)) return;
  const old = sessions.get(phone);
  if (old?.starting) return;

  const stateInfo = old || { phone, status: 'starting', qr: null, pairingCode: null, socket: null, starting: false, generation: 0, reconnectDelay: 3000 };
  stateInfo.starting = true;
  stateInfo.status = 'connecting';
  stateInfo.generation += 1;
  stateInfo.qr = null;
  stateInfo.pairingCode = null;
  sessions.set(phone, stateInfo);
  const generation = stateInfo.generation;

  try {
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath(phone));
    const { version } = await fetchLatestWaWebVersion();
    console.log(`Starting WhatsApp session ${phone} with Web version ${version.join('.')}`);
    const socket = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      version,
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      logger
    });
    stateInfo.socket = socket;
    stateInfo.starting = false;
    stateInfo.status = state.creds.registered ? 'connecting' : 'QR ready';
    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      const current = sessions.get(phone);
      if (!current || current.generation !== generation || current.socket !== socket) return;
      if (qr) {
        current.qr = qr;
        if (!state.creds.registered && current.status !== 'phone pairing ready') current.status = 'QR ready';
        console.log(`STUNNER MD QR is ready for ${phone}.`);
      }
      if (connection === 'open') {
        current.qr = null;
        current.pairingCode = null;
        current.status = 'connected';
        current.reconnectDelay = 3000;
        console.log(`STUNNER MD WhatsApp ${phone} is connected!`);
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.message || lastDisconnect?.error?.output?.payload?.message || 'unknown';
        console.log(`WhatsApp ${phone} closed. statusCode: ${code ?? 'unknown'} reason: ${reason}`);
        if (current.generation !== generation || current.socket !== socket) return;
        current.socket = null;
        current.pairingCode = null;
        if (code === DisconnectReason.loggedOut || code === 401) {
          await resetSession(phone);
          current.status = 'pairing required';
          current.qr = null;
          current.reconnectDelay = 3000;
        } else {
          current.status = 'reconnecting';
          current.reconnectDelay = Math.min(Math.max(current.reconnectDelay * 2, 3000), 30000);
        }
        scheduleReconnect(phone, current.reconnectDelay);
      }
    });

    socket.ev.on('messages.upsert', async ({ messages }) => {
      const current = sessions.get(phone);
      if (!current || current.generation !== generation || current.socket !== socket) return;
      for (const msg of messages || []) {
        if (!msg?.message) continue;
        if (msg.key?.remoteJid === 'status@broadcast') {
          try { await socket.readMessages([msg.key]); } catch (e) { console.error(`Status read error ${phone}:`, e?.message || e); }
          continue;
        }
        if (msg.key?.fromMe) continue;
        try { await handleCommand(socket, msg); } catch (e) { console.error(`Command error ${phone}:`, e?.stack || e); }
      }
    });
  } catch (e) {
    const current = sessions.get(phone);
    if (current && current.generation === generation) {
      current.starting = false;
      current.status = 'reconnecting';
      current.socket = null;
      current.reconnectDelay = Math.min(Math.max(current.reconnectDelay * 2, 3000), 30000);
      console.error(`Bot startup error for ${phone}:`, e?.stack || e);
      scheduleReconnect(phone, current.reconnectDelay);
    }
  }
}

async function page(message = '') {
  const rows = statusText().map(s => `<tr><td>${s.phone}</td><td>${s.status}</td></tr>`).join('') || '<tr><td colspan="2">No WhatsApp accounts paired yet.</td></tr>';
  const cards = [...sessions.values()].map(async s => {
    let qrHtml = '';
    if (s.qr) {
      const dataUrl = await qrcode.toDataURL(s.qr);
      qrHtml = `<div class="qr"><p>Open WhatsApp → Linked devices → Link a device.</p><img src="${dataUrl}" alt="WhatsApp QR code"></div>`;
    }
    const codeHtml = s.pairingCode ? `<div class="msg"><p>📱 Pairing code for ${s.phone}:</p><div class="code">${s.pairingCode}</div><p>WhatsApp → Linked devices → Link with phone number.</p></div>` : '';
    return `<div class="card"><h3>📱 ${s.phone}</h3><p>Status: <b>${s.status}</b></p>${codeHtml}${qrHtml}</div>`;
  });
  const cardHtml = (await Promise.all(cards)).join('');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>STUNNER MD Multi Pairing</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#0b0b0b;color:#fff;padding:24px}.box{max-width:900px;margin:auto}h1{color:#25d366;text-align:center;font-size:34px}.lead{text-align:center;color:#aaa}.card{padding:22px;border:1px solid #292929;border-radius:16px;background:#151515;margin:18px 0}input{width:100%;padding:14px;border-radius:10px;border:1px solid #444;background:#222;color:#fff;font-size:17px;margin-top:10px}button{width:100%;margin-top:10px;padding:14px;border:0;border-radius:10px;background:#25d366;color:#000;font-weight:bold;font-size:17px}.prefix{color:#25d366;font-weight:bold;font-size:18px}.code{font-size:30px;font-weight:bold;letter-spacing:6px;background:#222;padding:14px;border-radius:10px;color:#25d366;margin:12px 0;text-align:center}.msg{padding:12px;border-radius:10px;background:#202020;margin-top:14px}.qr img{max-width:100%;border-radius:12px;background:#fff;padding:10px}table{width:100%;border-collapse:collapse;margin-top:18px}td{padding:10px;border-bottom:1px solid #292929}a{color:#25d366}.small{color:#777;font-size:13px}</style></head><body><div class="box"><h1>⚡ STUNNER MD</h1><p class="lead">Pair and run multiple WhatsApp accounts from one bot.</p><div class="card"><h2>➕ Add WhatsApp account</h2><p>Enter a Kenyan WhatsApp number. Each number gets its own session.</p><div class="prefix">🇰🇪 +254</div><form method="POST" action="/pair-phone"><input name="phone" inputmode="numeric" pattern="7[0-9]{8}" maxlength="9" placeholder="7XXXXXXXX" required><button type="submit">Generate Pairing Code</button></form>${message}</div><div class="card"><h2>Connected accounts</h2><table><tr><th>Account</th><th>Status</th></tr>${rows}</table></div>${cardHtml}<p class="small">Page refreshes every 30 seconds. Keep the bot on a persistent paid host if you need reliable long-running WhatsApp sessions.</p><p style="text-align:center"><a href="/status">JSON status</a></p></div></body></html>`;
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    if (pathname === '/pair-phone' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const phone = normalizePhone(new URLSearchParams(body).get('phone'));
          let message = '';
          if (!/^2547\d{8}$/.test(phone)) message = '<div class="msg">❌ Enter a valid Kenyan number such as 7XXXXXXXX.</div>';
          else if (pairingBusy.has(phone)) message = '<div class="msg">⏳ A pairing request for this number is already running.</div>';
          else {
            pairingBusy.add(phone);
            try {
              let current = sessions.get(phone);
              if (!current || !current.socket) {
                await startBot(phone);
                current = sessions.get(phone);
              }
              if (!current?.socket) throw new Error('WhatsApp connection is not ready yet');
              if (current.status === 'connected') {
                message = '<div class="msg">✅ This WhatsApp account is already connected.</div>';
              } else {
                current.qr = null;
                current.pairingCode = await current.socket.requestPairingCode(phone);
                current.status = 'phone pairing ready';
                message = `<div class="msg">✅ Pairing code generated for ${phone}. Enter it in WhatsApp Linked devices.</div>`;
              }
            } catch (e) {
              console.error(`Phone pairing failed for ${phone}:`, e?.stack || e?.message || e);
              message = '<div class="msg">❌ Pairing failed. Wait a few seconds, refresh, and try again.</div>';
            } finally { pairingBusy.delete(phone); }
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(await page(message));
        } catch (e) { console.error('Pairing request error:', e); res.writeHead(500, {'Content-Type':'text/plain'}); res.end('Pairing request error'); }
      });
      return;
    }
    if (pathname === '/' || pathname === '/pair' || pathname === '/qr') {
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      res.end(await page());
      return;
    }
    if (pathname === '/qr.png') {
      const first = [...sessions.values()].find(s => s.qr);
      if (!first) { res.writeHead(404); return res.end('QR not ready'); }
      try { const png = await qrcode.toBuffer(first.qr); res.writeHead(200, {'Content-Type':'image/png','Cache-Control':'no-store'}); return res.end(png); } catch { res.writeHead(500); return res.end('QR error'); }
    }
    if (pathname === '/status') {
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      return res.end(JSON.stringify({ accounts: statusText(), count: sessions.size, uptime: Math.round(process.uptime()) }));
    }
    if (pathname === '/health') {
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      return res.end(JSON.stringify({ ok:true, accounts: sessions.size }));
    }
    res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); res.end('Not Found');
  } catch (e) { console.error('HTTP error:', e); if (!res.headersSent) res.writeHead(500, {'Content-Type':'text/plain'}); res.end('Server error'); }
}).listen(port, () => console.log(`STUNNER MD server listening on port ${port}`));

async function bootSavedSessions() {
  const ids = await listSessionIds();
  for (const phone of ids) startBot(phone);
  if (!ids.length) console.log('No saved WhatsApp sessions. Open /pair to add an account.');
}

process.on('uncaughtException', err => console.error('Uncaught exception:', err?.stack || err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err?.stack || err));

bootSavedSessions();
