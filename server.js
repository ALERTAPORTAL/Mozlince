require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-asheo-install','x-asheo-ts','x-asheo-sig','x-asheo-build','x-asheo-nonce']
}));
app.options(/.*/, cors());
app.use(express.json());

function loadKeyFromFile(filePath, envVal, label) {
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      console.log('✅ ' + label + ' carregada do arquivo ' + filePath);
      return content;
    } catch (e) {
      console.error('⚠️ ' + label + ' erro ao ler arquivo:', e.message);
    }
  }
  if (envVal) {
    let v = envVal.trim();
    if (!v.includes('BEGIN')) {
      try { v = Buffer.from(v, 'base64').toString('utf8'); } catch (e) {}
    } else {
      v = v.replace(/\\n/g, '\n');
    }
    console.log('✅ ' + label + ' carregada da env var');
    return v;
  }
  console.error('❌ ' + label + ' NÃO ENCONTRADA');
  return null;
}

const privateKey = loadKeyFromFile('/etc/secrets/private.pem', process.env.EC_PRIVATE_KEY, 'EC_PRIVATE_KEY');
const publicKey  = loadKeyFromFile('/etc/secrets/public.pem',  process.env.EC_PUBLIC_KEY,  'EC_PUBLIC_KEY');

console.log('========== BOOT ==========');
console.log('privateKey existe?', !!privateKey);
if (privateKey) {
  try { crypto.createPrivateKey(privateKey); console.log('✅ privateKey VÁLIDA'); }
  catch (e) { console.error('❌ privateKey INVÁLIDA:', e.message); }
}
console.log('publicKey existe?', !!publicKey);
console.log('==========================');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisSet(key, value) {
  return (await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: value
  })).json();
}
async function redisGet(key) {
  const data = await (await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  })).json();
  if (!data.result) return null;
  try { return JSON.parse(data.result); } catch { return data.result; }
}
async function redisKeys() {
  const data = await (await fetch(`${UPSTASH_URL}/keys/ASHEO-*`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  })).json();
  return data.result || [];
}

function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () => { let s=''; for (let i=0;i<4;i++) s+=chars[crypto.randomInt(0,chars.length)]; return s; };
  return `ASHEO-${block()}-${block()}-${block()}-${block()}`;
}

async function sendTelegramMessage(chatId, text, keyboard=null) {
  const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (keyboard) body.reply_markup = keyboard;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
}
async function answerCallbackQuery(id, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: id, text })
  });
}

function generateLicenseToken(installId, plan, days) {
  if (!privateKey) throw new Error('privateKey NÃO CARREGADA');
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    sub: installId, installId, status: 'active',
    plan, planDisplayName: plan === 'premium' ? 'Premium' : 'Free',
    active: true, tier: plan, kind: plan === 'premium' ? 'premium' : 'free',
    features: { advanced_automation:true, multi_account:true, cloud_sync:true, priority_support:true, custom_export:true, api_access:true },
    secret: 'segredo-' + installId,
    iat: now, nbf: now - 5, exp: now + (days * 24 * 60 * 60)
  }, privateKey, { algorithm: 'ES256' });
}

app.get('/', (req, res) => res.json({ ok: true, ts: Date.now() }));
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/debug-env', (req, res) => {
  res.json({
    private_file_exists: fs.existsSync('/etc/secrets/private.pem'),
    public_file_exists: fs.existsSync('/etc/secrets/public.pem'),
    private_key_loaded: !!privateKey,
    public_key_loaded: !!publicKey,
    ec_priv_env_exists: !!process.env.EC_PRIVATE_KEY,
    ec_priv_env_len: (process.env.EC_PRIVATE_KEY || '').length,
    upstash_exists: !!UPSTASH_URL,
    telegram_exists: !!TELEGRAM_TOKEN,
    owner_exists: !!OWNER_ID
  });
});

app.post('/v1/activate', async (req, res) => {
  try {
    const { installId, licenseKey } = req.body || {};
    if (!installId) return res.status(400).json({ error: 'missing_installId' });
    if (!licenseKey) return res.status(400).json({ error: 'missing_licenseKey' });
    if (!privateKey) return res.status(500).json({ error: 'no_private_key', message: 'private.pem ausente' });

    const lic = await redisGet(licenseKey);
    if (!lic) return res.status(401).json({ error: 'invalid_license' });
    if (!lic.active) return res.status(403).json({ error: 'revoked' });

    if (!lic.installId) { lic.installId = installId; await redisSet(licenseKey, JSON.stringify(lic)); }
    else if (lic.installId !== installId) return res.status(403).json({ error: 'seat_taken', installId: lic.installId });

    const expDate = lic.createdAt + lic.days * 24 * 60 * 60 * 1000;
    if (Date.now() > expDate) return res.status(403).json({ error: 'expired' });

    const token = generateLicenseToken(installId, lic.plan, lic.days);
    console.log(`[activate] OK ${installId}`);
    res.json({ token, tier: lic.plan, seat: 1, seats: 1, gwPass: null, secret: 'segredo-' + installId, status: 'active', plan: lic.plan, days: lic.days });
  } catch (e) {
    console.error('[activate] ERRO:', e);
    res.status(500).json({ error: 'internal', message: e.message });
  }
});

app.post('/v1/deactivate', (req, res) => res.json({ ok: true }));
app.post('/verificar-licenca', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ erro: 'Token obrigatório' });
  try { res.json({ valido: true, dados: jwt.verify(token, publicKey, { algorithms: ['ES256'] }) }); }
  catch (err) { res.status(401).json({ valido: false, erro: err.message }); }
});

app.post('/telegram-webhook', async (req, res) => {
  const update = req.body;
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    if (String(chatId) !== String(OWNER_ID)) { await answerCallbackQuery(cb.id, '⛔ Sem permissão.'); return res.sendStatus(200); }
    if (cb.data.startsWith('dur_')) {
      const days = parseInt(cb.data.split('_')[1]);
      const licenseKey = generateLicenseKey();
      await redisSet(licenseKey, JSON.stringify({ plan: 'premium', days, createdAt: Date.now(), active: true, installId: null }));
      await answerCallbackQuery(cb.id, 'Licença gerada!');
      await sendTelegramMessage(chatId, `✅ *Licença gerada!*\n\n*Chave:* \`${licenseKey}\`\n*Duração:* ${days===3650?'Ilimitada':days+' dias'}`);
    }
    return res.sendStatus(200);
  }
  if (!update.message || !update.message.text) return res.sendStatus(200);
  const chatId = update.message.chat.id;
  const args = update.message.text.trim().replace(/\n/g,' ').split(' ').filter(a=>a.length>0);
  const cmd = args[0].toLowerCase();
  if (String(chatId) !== String(OWNER_ID)) { await sendTelegramMessage(chatId, '⛔ Sem permissão.'); return res.sendStatus(200); }

  try {
    if (cmd === '/start') await sendTelegramMessage(chatId, '👋 *Comandos:*\n/gerar\n/activate <installId> <chave>\n/desvincular <chave>\n/reset <chave>\n/status <chave>\n/info <chave>\n/revogar <chave>\n/listar');
    else if (cmd === '/gerar') await sendTelegramMessage(chatId, '📅 *Duração:*', { inline_keyboard: [
      [{ text:'3 Dias', callback_data:'dur_3' }, { text:'7 Dias', callback_data:'dur_7' }],
      [{ text:'30 Dias', callback_data:'dur_30' }, { text:'Ilimitado', callback_data:'dur_3650' }]
    ]});
    else if (cmd === '/activate') {
      const k = args[args.length-1], id = args.slice(1,args.length-1).join(' ');
      if (!id || !k) { await sendTelegramMessage(chatId, '⚠️ Use: /activate <installId> <chave>'); return res.sendStatus(200); }
      const lic = await redisGet(k);
      if (!lic) { await sendTelegramMessage(chatId, '❌ Chave não encontrada.'); return res.sendStatus(200); }
      if (lic.installId) { await sendTelegramMessage(chatId, '⚠️ Já vinculada. Use /desvincular.'); return res.sendStatus(200); }
      lic.installId = id; await redisSet(k, JSON.stringify(lic));
      await sendTelegramMessage(chatId, `✅ Vinculada a \`${id}\`.`);
    } else if (cmd === '/desvincular') {
      const k = args[1]; const lic = await redisGet(k);
      if (!lic) { await sendTelegramMessage(chatId, '❌ Chave não encontrada.'); return res.sendStatus(200); }
      lic.installId = null; await redisSet(k, JSON.stringify(lic));
      await sendTelegramMessage(chatId, `🔓 Desvinculada: \`${k}\``);
    } else if (cmd === '/reset') {
      const k = args[1]; const lic = await redisGet(k);
      if (!lic) { await sendTelegramMessage(chatId, '❌ Chave não encontrada.'); return res.sendStatus(200); }
      lic.installId = null; lic.active = true; lic.createdAt = Date.now(); await redisSet(k, JSON.stringify(lic));
      await sendTelegramMessage(chatId, `♻️ Resetada: \`${k}\``);
    } else if (cmd === '/status' || cmd === '/info') {
      const k = args[1]; const lic = await redisGet(k);
      if (!lic) { await sendTelegramMessage(chatId, '❌ Chave não encontrada.'); return res.sendStatus(200); }
      const exp = new Date(lic.createdAt + lic.days*24*60*60*1000);
      await sendTelegramMessage(chatId, `🔎 *Info*\n*Chave:* \`${k}\`\n*Install:* \`${lic.installId||'livre'}\`\n*Dias:* ${lic.days===3650?'Ilimitado':lic.days}\n*Expira:* ${exp.toLocaleString('pt-BR')}\n*Ativa:* ${lic.active?'Sim':'Não'}`);
    } else if (cmd === '/revogar') {
      const k = args[1]; const lic = await redisGet(k);
      if (lic) { lic.active = false; await redisSet(k, JSON.stringify(lic)); await sendTelegramMessage(chatId, '🗑️ Revogada.'); }
      else await sendTelegramMessage(chatId, '❌ Nenhuma licença.');
    } else if (cmd === '/listar') {
      const keys = await redisKeys();
      if (!keys.length) await sendTelegramMessage(chatId, '📭 Nenhuma.');
      else {
        let msg = `📋 *Licenças (${keys.length})*\n\n`;
        for (const k of keys) { const lic = await redisGet(k); if (lic) msg += `• \`${k}\` - ${lic.days===3650?'Ilimitado':lic.days+'d'} - ${lic.active?'Ativa':'Revogada'} - ${lic.installId?'Vinculada':'Livre'}\n`; }
        await sendTelegramMessage(chatId, msg);
      }
    } else await sendTelegramMessage(chatId, '❓ Use /start.');
  } catch (err) { console.error('Erro:', err); }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
