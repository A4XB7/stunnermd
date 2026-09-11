const http = require('http');
const fs = require('fs/promises');
const qrcode = require('qrcode');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestWaWebVersion, Browsers, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');

const port = process.env.PORT || 3000;
const PHONE_NUMBER = (process.env.PHONE_NUMBER || '').replace(/\D/g, '');
const SESSION_DIR = './session';
let latestQr = null, botStatus = 'starting', pairingCode = null, waSocket = null, pairingBusy = false, reconnectTimer = null, starting = false;
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
let connectionGeneration = 0;
let reconnectDelay = 3000;

function normalizePhone(raw) {
  let phone = String(raw || '').replace(/\D/g, '');
  if (phone.startsWith('0')) phone = '254' + phone.slice(1);
  if (phone.startsWith('7') && phone.length === 9) phone = '254' + phone;
  return phone;
}

async function page(phoneMessage = '') {
  let qrHtml = '<p>QR code is not ready yet. This page refreshes automatically every 2 minutes.</p>';
  if (latestQr) {
    const dataUrl = await qrcode.toDataURL(latestQr);
    qrHtml = `<p>Open WhatsApp → Linked devices → Link a device.</p><img src="${dataUrl}" alt="WhatsApp QR code">`;
  }
  let pairingHtml = '';
  if (pairingCode) pairingHtml = `<div class="msg"><p>📱 Pairing code:</p><div class="code">${pairingCode}</div><p>WhatsApp → Linked devices → Link with phone number → enter this code.</p></div>`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="120"><title>STUNNER MD Pairing</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#0b0b0b;color:#fff;text-align:center;padding:24px}.box{max-width:760px;margin:auto}h1{color:#25d366;font-size:34px}.status{color:#aaa;margin-bottom:25px}.options{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{padding:22px;border:1px solid #292929;border-radius:16px;background:#151515}h2{margin-top:0}input{width:100%;padding:14px;border-radius:10px;border:1px solid #444;background:#222;color:#fff;font-size:17px;margin-top:10px}button{width:100%;margin-top:10px;padding:14px;border:0;border-radius:10px;background:#25d366;color:#000;font-weight:bold;font-size:17px}.prefix{font-size:18px;color:#25d366;font-weight:bold}.code{font-size:30px;font-weight:bold;letter-spacing:6px;background:#222;padding:14px;border-radius:10px;color:#25d366;margin:12px 0}.msg{padding:12px;border-radius:10px;background:#202020;margin-top:14px}.qr img{max-width:100%;border-radius:12px;background:#fff;padding:10px}@media(max-width:650px){.options{grid-template-columns:1fr}}a{color:#25d366}</style></head><body><div class="box"><h1>⚡ STUNNER MD</h1><div class="status">Status: <b>${botStatus}</b></div><div class="options"><section class="card"><h2>OPTION 1 — 📱 +254 Pairing</h2><p>Enter your Kenyan WhatsApp number.</p><div class="prefix">🇰🇪 +254</div><form method="POST" action="/pair-phone"><input name="phone" inputmode="numeric" pattern="7[0-9]{8}" maxlength="9" placeholder="7XXXXXXXX" required><button type="submit">Generate Pairing Code</button></form>${pairingHtml}${phoneMessage}</section><section class="card qr"><h2>OPTION 2 — 🔳 QR Pairing</h2>${qrHtml}</section></div><p style="margin-top:24px"><a href="/status">Check bot status</a></p><p style="color:#777;font-size:13px">This page refreshes automatically every 2 minutes.</p></div></body></html>`;
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
          else if (!waSocket) message = '<div class="msg">⏳ WhatsApp connection is not ready. Please wait a few seconds and try again.</div>';
          else if (botStatus === 'connected') message = '<div class="msg">✅ Bot is already connected.</div>';
          else if (pairingBusy) message = '<div class="msg">⏳ A pairing request is already running. Please wait.</div>';
          else {
            pairingBusy = true;
            try {
              latestQr = null;
              pairingCode = await waSocket.requestPairingCode(phone);
              botStatus = 'phone pairing ready';
              message = '<div class="msg">✅ Pairing code generated above. Enter it in WhatsApp linked-device settings.</div>';
            } catch (e) {
              console.error('Phone pairing failed:', e?.stack || e?.message || e);
              message = '<div class="msg">❌ Phone pairing failed. Refresh and try again, or use QR.</div>';
            } finally { pairingBusy = false; }
          }
          res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
          res.end(await page(message));
        } catch (e) { console.error('Pairing request error:', e); res.writeHead(500, {'Content-Type':'text/plain'}); res.end('Pairing request error'); }
      });
      return;
    }
    if (pathname === '/' || pathname === '/pair' || pathname === '/qr') { res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}); res.end(await page()); return; }
    if (pathname === '/qr.png') {
      if (!latestQr) { res.writeHead(404); return res.end('QR not ready'); }
      try { const png = await qrcode.toBuffer(latestQr); res.writeHead(200, {'Content-Type':'image/png','Cache-Control':'no-store'}); return res.end(png); } catch(e) { res.writeHead(500); return res.end('QR error'); }
    }
    if (pathname === '/status') { res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); return res.end(JSON.stringify({status:botStatus, pairingCode:pairingCode ? 'available' : null, qrAvailable:!!latestQr, uptime:Math.round(process.uptime())})); }
    if (pathname === '/health') { res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); return res.end(JSON.stringify({ok:true,status:botStatus})); }
    res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); res.end('Not Found');
  } catch (e) { console.error('HTTP error:', e); if (!res.headersSent) res.writeHead(500, {'Content-Type':'text/plain'}); res.end('Server error'); }
}).listen(port, () => console.log(`STUNNER MD server listening on port ${port}`));

async function resetSession() {
  try { await fs.rm(SESSION_DIR, {recursive:true, force:true}); console.log('WhatsApp session cleared after device removal. A new pairing is required.'); }
  catch (e) { console.error('Could not clear session:', e?.message || e); }
}

function scheduleReconnect(delay = reconnectDelay) {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => startBot(), delay);
}

async function startBot() {
  if (starting) return;
  starting = true;
  clearTimeout(reconnectTimer);
  const generation = ++connectionGeneration;
  botStatus = 'connecting';
  latestQr = null;
  pairingCode = null;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestWaWebVersion();
    console.log(`Using WhatsApp Web version ${version.join('.')}`);
    const socket = makeWASocket({ auth:{creds:state.creds, keys:makeCacheableSignalKeyStore(state.keys, logger)}, version, browser:Browsers.ubuntu('Chrome'), syncFullHistory:false, markOnlineOnConnect:false, generateHighQualityLinkPreview:false, logger });
    waSocket = socket;
    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', async ({connection,lastDisconnect,qr}) => {
      if (generation !== connectionGeneration) return;
      if (qr) {
        latestQr = qr;
        if (!state.creds.registered) botStatus = 'QR ready';
        console.log('STUNNER MD QR is ready.');
      }
      if (connection === 'open') {
        latestQr=null; pairingCode=null; botStatus='connected'; reconnectDelay=3000;
        console.log('STUNNER MD is connected!');
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.message || lastDisconnect?.error?.output?.payload?.message || 'unknown';
        console.log(`WhatsApp connection closed. statusCode: ${code ?? 'unknown'} reason: ${reason}`);
        if (generation !== connectionGeneration) return;
        if (waSocket === socket) waSocket = null;
        pairingCode = null;
        if (code === DisconnectReason.loggedOut || code === 401) {
          await resetSession();
          botStatus='pairing required';
          reconnectDelay=3000;
        } else {
          botStatus='reconnecting';
          reconnectDelay=Math.min(Math.max(reconnectDelay * 2, 3000), 30000);
        }
        scheduleReconnect(reconnectDelay);
      }
    });
    socket.ev.on('messages.upsert', async ({messages}) => {
      if (generation !== connectionGeneration || waSocket !== socket) return;
      const msg=messages?.[0]; if(!msg?.message || msg.key.fromMe) return;
      const command=(msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim().toLowerCase();
      try { if(command==='/menu') await require('./commands/menu')(socket,msg); else if(command==='/joke') await require('./commands/joke')(socket,msg); else if(command==='/game') await require('./commands/game')(socket,msg); else if(command==='/ping') await require('./commands/ping')(socket,msg); else if(command==='/help') await require('./commands/help')(socket,msg); } catch(e) { console.error('Command error:', e?.stack || e?.message || e); }
    });
  } catch(e) {
    console.error('Bot startup error:', e?.stack || e);
    botStatus='reconnecting';
    waSocket=null;
    reconnectDelay=Math.min(Math.max(reconnectDelay * 2, 3000), 30000);
    scheduleReconnect(reconnectDelay);
  } finally { starting=false; }
}

process.on('uncaughtException', err => console.error('Uncaught exception:', err?.stack || err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err?.stack || err));

startBot();
