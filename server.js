require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization',
    'x-asheo-install', 'x-asheo-ts', 'x-asheo-sig',
    'x-asheo-build', 'x-asheo-nonce'
  ]
}));
app.options(/.*/, cors());
app.use(express.json());

function loadKey(envVal) {
  if (!envVal) return null;
  if (!envVal.includes('BEGIN')) {
    try { return Buffer.from(envVal, 'base64').toString('utf8'); }
    catch (e) { console.error('Erro base64:', e); return null; }
  }
  return envVal.replace(/\\n/g, '\n');
}

const privateKey = loadKey(process.env.EC_PRIVATE_KEY);
const publicKey  = loadKey(process.env.EC_PUBLIC_KEY);
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!privateKey) console.error('⚠️  EC_PRIVATE_KEY não configurada');
if (!publicKey)  console.error('⚠️  EC_PUBLIC_KEY não configurada');

// ==== Redis (Upstash) ====
async function redisSet(key, value) {
  const res = await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: value
  });
  return res.json();
}

async function redisGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  const data = await res.json();
  if (!data.result) return null;
  try { return JSON.parse(data.result); } catch { return data.result; }
}

async function redisDel(key) {
  const res = await fetch(`${UPSTASH_URL}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  return res.json();
}

async function redisKeys() {
  const res = await fetch(`${UPSTASH_URL}/keys/ASHEO-*`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  const data = await res.json();
  return data.result || [];
}

// ==== Utils ====
function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () => {
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[crypto.randomInt(0, chars.length)];
    return s;
  };
  return `ASHEO-${block()}-${block()}-${block()}-${block()}`;
}

async function sendTelegramMessage(chatId, text, keyboard = null) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
  if (keyboard) body.reply_markup = keyboard;
  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function answerCallbackQuery(id, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`;
  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: id, text }) });
}

function generateLicenseToken(installId, plan, days) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: installId, installId: installId, status: 'active',
    plan: plan, planDisplayName: plan === 'premium' ? 'Premium' : 'Free',
    active: true, tier: plan, kind: plan === 'premium' ? 'premium' : 'free',
    features: { advanced_automation: true, multi_account: true, cloud_sync: true, priority_support: true, custom_export: true, api_access: true },
    secret: 'segredo-' + installId,
    iat: now, nbf: now - 5, exp: now + (days * 24 * 60 * 60)
  };
  return jwt.sign(payload, privateKey, { algorithm: 'ES256' });
}

// ==== Health ====
app.get('/', (req, res) => res.json({ ok: true, service: 'mozlince-license', status: 'live', ts: Date.now() }));
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ==== /v1/activate ====
app.post('/v1/activate', async (req, res) => {
  try {
    const { installId, licenseKey } = req.body || {};
    if (!installId) return res.status(400).json({ error: 'missing_installId' });
    if (!licenseKey) return res.status(400).json({ error: 'missing_licenseKey' });

    const lic = await redisGet(licenseKey);
    if (!lic) return res.status(401).json({ error: 'invalid_license' });
    if (!lic.active) return res.status(403).json({ error: 'revoked' });

    if (!lic.installId) {
      lic.installId = installId;
      await redisSet(licenseKey, JSON.stringify(lic));
    } else if (lic.installId !== installId) {
      return res.status(403).json({ error: 'seat_taken', installId: lic.installId, message: 'Use /desvincular no bot pra liberar' });
    }

    const expDate = lic.createdAt + lic.days * 24 * 60 * 60 * 1000;
    if (Date.now() > expDate) return res.status(403).json({ error: 'expired' });

    const token = generateLicenseToken(installId, lic.plan, lic.days);
    console.log(`[activate] ${installId} plan=${lic.plan} days=${lic.days}`);

    res.json({
      token, tier: lic.plan, seat: 1, seats: 1, gwPass: null,
      secret: 'segredo-' + installId, status: 'active', plan: lic.plan, days: lic.days
    });
  } catch (e) {
    console.error('[activate] ERRO:', e);
    res.status(500).json({ error: 'internal', message: e.message });
  }
});

app.post('/v1/deactivate', (req, res) => res.json({ ok: true }));
app.post('/verificar-licenca', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ erro: 'Token obrigatório' });
  try {
    const decoded = jwt.verify(token, publicKey, { algorithms: ['ES256'] });
    res.json({ valido: true, dados: decoded });
  } catch (err) {
    res.status(401).json({ valido: false, erro: err.message });
  }
});

// ================================================================
//  TELEGRAM WEBHOOK (agora com /desvincular, /reset, /info)
// ================================================================
app.post('/telegram-webhook', async (req, res) => {
  const update = req.body;

  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const data = cb.data;
    if (String(chatId) !== String(OWNER_ID)) { await answerCallbackQuery(cb.id, '⛔ Sem permissão.'); return res.sendStatus(200); }
    if (data.startsWith('dur_')) {
      const days = parseInt(data.split('_')[1]);
      const licenseKey = generateLicenseKey();
      await redisSet(licenseKey, JSON.stringify({ plan: 'premium', days, createdAt: Date.now(), active: true, installId: null }));
      await answerCallbackQuery(cb.id, `Licença gerada!`);
      await sendTelegramMessage(chatId, `✅ *Licença gerada!*\n\n*Chave:* \`${licenseKey}\`\n*Duração:* ${days === 3650 ? 'Ilimitada' : days + ' dias'}`);
    }
    return res.sendStatus(200);
  }

  if (!update.message || !update.message.text) return res.sendStatus(200);
  const chatId = update.message.chat.id;
  const args = update.message.text.trim().replace(/\n/g, ' ').split(' ').filter(a => a.length > 0);
  const command = args[0].toLowerCase();

  if (String(chatId) !== String(OWNER_ID)) {
    await sendTelegramMessage(chatId, '⛔ Sem permissão.');
    return res.sendStatus(200);
  }

  try {
    if (command === '/start') {
      await sendTelegramMessage(chatId,
        `👋 *Comandos disponíveis:*\n\n` +
        `*Licenças:*\n` +
        `/gerar - Gera licença nova\n` +
        `/activate <installId> <chave> - Vincula\n` +
        `/desvincular <chave> - Remove vínculo (libera pra outro device)\n` +
        `/reset <chave> - Desvincula + reativa + reseta expiração\n` +
        `/status <chave> - Status da licença\n` +
        `/info <chave> - Info completa (JSON)\n` +
        `/revogar <chave> - Revoga\n` +
        `/listar - Lista todas\n`
      );
    } else if (command === '/gerar') {
      const keyboard = { inline_keyboard: [
        [{ text: '3 Dias', callback_data: 'dur_3' }, { text: '7 Dias', callback_data: 'dur_7' }],
        [{ text: '30 Dias', callback_data: 'dur_30' }, { text: 'Ilimitado', callback_data: 'dur_3650' }]
      ]};
      await sendTelegramMessage(chatId, `📅 *Escolha a duração:*`, keyboard);

    } else if (command === '/activate') {
      const licenseKey = args[args.length - 1];
      const installId = args.slice(1, args.length - 1).join(' ');
      if (!installId || !licenseKey) { await sendTelegramMessage(chatId, '⚠️ Use: /activate <installId> <chave>'); return res.sendStatus(200); }
      const lic = await redisGet(licenseKey);
      if (!lic) { await sendTelegramMessage(chatId, `❌ Chave não encontrada.`); return res.sendStatus(200); }
      if (lic.installId) { await sendTelegramMessage(chatId, `⚠️ Já vinculada. Use /desvincular primeiro.`); return res.sendStatus(200); }
      lic.installId = installId;
      await redisSet(licenseKey, JSON.stringify(lic));
      await sendTelegramMessage(chatId, `✅ Chave vinculada a \`${installId}\`.`);

    } else if (command === '/desvincular') {
      const key = args[1];
      if (!key) { await sendTelegramMessage(chatId, '⚠️ Use: /desvincular <chave>'); return res.sendStatus(200); }
      const lic = await redisGet(key);
      if (!lic) { await sendTelegramMessage(chatId, `❌ Chave não encontrada.`); return res.sendStatus(200); }
      const oldInstall = lic.installId || 'nenhum';
      lic.installId = null;
      await redisSet(key, JSON.stringify(lic));
      await sendTelegramMessage(chatId,
        `🔓 *Chave desvinculada!*\n\n*Chave:* \`${key}\`\n*Install antigo:* \`${oldInstall}\`\n\nAgora pode ativar em outro dispositivo.`
      );

    } else if (command === '/reset') {
      const key = args[1];
      if (!key) { await sendTelegramMessage(chatId, '⚠️ Use: /reset <chave>'); return res.sendStatus(200); }
      const lic = await redisGet(key);
      if (!lic) { await sendTelegramMessage(chatId, `❌ Chave não encontrada.`); return res.sendStatus(200); }
      const oldInstall = lic.installId || 'nenhum';
      lic.installId = null;
      lic.active = true;
      lic.createdAt = Date.now();
      await redisSet(key, JSON.stringify(lic));
      await sendTelegramMessage(chatId,
        `♻️ *Chave resetada!*\n\n*Chave:* \`${key}\`\n*Install antigo:* \`${oldInstall}\`\n*Duração:* ${lic.days === 3650 ? 'Ilimitada' : lic.days + ' dias'}\n*Reativada:* Sim\n\nAgora pode ativar em qualquer dispositivo.`
      );

    } else if (command === '/status') {
      const key = args[1];
      if (!key) { await sendTelegramMessage(chatId, '⚠️ Use: /status <chave>'); return res.sendStatus(200); }
      const lic = await redisGet(key);
      if (lic) {
        const expDate = new Date(lic.createdAt + lic.days * 24 * 60 * 60 * 1000);
        await sendTelegramMessage(chatId,
          `📋 *Status*\n*Chave:* \`${key}\`\n*Install:* \`${lic.installId || 'não vinculado'}\`\n*Duração:* ${lic.days === 3650 ? 'Ilimitada' : lic.days + ' dias'}\n*Expira:* ${expDate.toLocaleString('pt-BR')}\n*Ativa:* ${lic.active ? 'Sim' : 'Não'}`
        );
      } else { await sendTelegramMessage(chatId, `❌ Nenhuma licença.`); }

    } else if (command === '/info') {
      const key = args[1];
      if (!key) { await sendTelegramMessage(chatId, '⚠️ Use: /info <chave>'); return res.sendStatus(200); }
      const lic = await redisGet(key);
      if (!lic) { await sendTelegramMessage(chatId, `❌ Chave não encontrada.`); return res.sendStatus(200); }
      const expDate = new Date(lic.createdAt + lic.days * 24 * 60 * 60 * 1000);
      await sendTelegramMessage(chatId,
        `🔎 *Info completa*\n\n` +
        `*Chave:* \`${key}\`\n` +
        `*Install ID:* \`${lic.installId || 'não vinculado'}\`\n` +
        `*Plano:* ${lic.plan}\n` +
        `*Duração:* ${lic.days === 3650 ? 'Ilimitada' : lic.days + ' dias'}\n` +
        `*Criada em:* ${new Date(lic.createdAt).toLocaleString('pt-BR')}\n` +
        `*Expira em:* ${expDate.toLocaleString('pt-BR')}\n` +
        `*Ativa:* ${lic.active ? 'Sim' : 'Não'}`
      );

    } else if (command === '/revogar') {
      const key = args[1];
      if (!key) { await sendTelegramMessage(chatId, '⚠️ Use: /revogar <chave>'); return res.sendStatus(200); }
      const lic = await redisGet(key);
      if (lic) { lic.active = false; await redisSet(key, JSON.stringify(lic)); await sendTelegramMessage(chatId, `🗑️ Revogada.`); }
      else { await sendTelegramMessage(chatId, `❌ Nenhuma licença.`); }

    } else if (command === '/listar') {
      const keys = await redisKeys();
      if (keys.length === 0) { await sendTelegramMessage(chatId, '📭 Nenhuma licença.'); }
      else {
        let msg = `📋 *Licenças (${keys.length})*\n\n`;
        for (const key of keys) {
          const lic = await redisGet(key);
          if (lic) msg += `• \`${key}\` - ${lic.days === 3650 ? 'Ilimitado' : lic.days + 'd'} - ${lic.active ? 'Ativa' : 'Revogada'} - ${lic.installId ? 'Vinculada' : 'Livre'}\n`;
        }
        await sendTelegramMessage(chatId, msg);
      }
    } else { await sendTelegramMessage(chatId, '❓ Use /start.'); }
  } catch (err) { console.error('Erro:', err); }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
