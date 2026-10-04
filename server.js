require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// ─── LOGS COLORIDOS ───
const C = { r:'\x1b[0m', b:'\x1b[1m', g:'\x1b[32m', y:'\x1b[33m', red:'\x1b[31m', c:'\x1b[36m', m:'\x1b[35m', bl:'\x1b[34m', gr:'\x1b[90m' };
function log(t, m) {
  const ts = new Date().toISOString().replace('T',' ').substring(0,19);
  const cores = { INFO:C.c, OK:C.g, WARN:C.y, ERRO:C.red, SYS:C.m, ATIV:C.bl };
  console.log(`${C.gr}[${ts}]${C.r} ${cores[t]||C.r}${C.b}[${t}]${C.r} ${m}`);
}

// ─── CARREGA CHAVES (file first, depois env) ───
let PRIVATE_KEY = null, PUBLIC_KEY = null, ORIGEM = 'nenhuma';

function carregarChaveDeFicheiros() {
  const ficheirosPriv = ['/etc/secrets/private.pem', './private.pem', '/etc/secrets/ec_private.pem'];
  const ficheirosPub  = ['/etc/secrets/public.pem', './public.pem', '/etc/secrets/ec_public.pem'];
  let priv = null, pub = null;
  for (const f of ficheirosPriv) {
    try { if (fs.existsSync(f)) { priv = fs.readFileSync(f, 'utf8').trim(); break; } } catch {}
  }
  for (const f of ficheirosPub) {
    try { if (fs.existsSync(f)) { pub = fs.readFileSync(f, 'utf8').trim(); break; } } catch {}
  }
  return { priv, pub };
}

(function initKeys() {
  // Tentativa 1: ficheiros
  const { priv, pub } = carregarChaveDeFicheiros();
  if (priv) {
    PRIVATE_KEY = priv;
    PUBLIC_KEY = pub || null;
    ORIGEM = 'file:/etc/secrets/private.pem';
    log('OK', 'Chaves carregadas do FICHEIRO');
    return;
  }
  // Tentativa 2: variáveis de ambiente
  let p = process.env.EC_PRIVATE_KEY || process.env.JWT_PRIVATE_KEY_PEM || '';
  if (p) {
    if (!p.includes('BEGIN')) {
      log('SYS', 'Descodificando EC_PRIVATE_KEY em Base64...');
      try { p = Buffer.from(p.trim(), 'base64').toString('utf8'); } catch {}
    }
    PRIVATE_KEY = p.replace(/\\n/g, '\n').trim();
    ORIGEM = 'env:EC_PRIVATE_KEY';
  }
  let pu = process.env.EC_PUBLIC_KEY || '';
  if (pu) {
    if (!pu.includes('BEGIN')) {
      try { pu = Buffer.from(pu.trim(), 'base64').toString('utf8'); } catch {}
    }
    PUBLIC_KEY = pu.replace(/\\n/g, '\n').trim();
  }
  if (PRIVATE_KEY) {
    log('OK', 'Chaves carregadas da VARIAVEL de ambiente');
    // Valida a privada
    try { crypto.createPrivateKey(PRIVATE_KEY); log('OK', 'Chave privada ES256 validada'); }
    catch (e) { log('ERRO', 'Chave privada invalida: ' + e.message); PRIVATE_KEY = null; }
  } else {
    log('ERRO', 'Nenhuma chave privada encontrada! Configure EC_PRIVATE_KEY ou /etc/secrets/private.pem');
  }
})();

// ─── UPSTASH REDIS ───
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID;

async function redisSet(key, value) {
  const res = await fetch(`${UPSTASH_URL}/set/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: value
  });
  return res.json();
}

async function redisGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function redisKeys() {
  const res = await fetch(`${UPSTASH_URL}/keys/ASHEO-*`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  const data = await res.json();
  return data.result || [];
}

// ─── GERAR CHAVE ───
function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () => {
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[crypto.randomInt(0, chars.length)];
    return s;
  };
  return `ASHEO-${block()}-${block()}-${block()}-${block()}`;
}

// ─── GERA JWT COM TODOS OS CAMPOS PREMIUM ───
function generateLicenseToken(installId, plan, days) {
  if (!PRIVATE_KEY) throw new Error('Chave privada nao inicializada');
  const now = Math.floor(Date.now() / 1000);
  const isUnlimited = days >= 3650;
  const payload = {
    sub: installId,
    iss: 'mozlince-license-api',
    aud: 'mozlince-client',
    installId: installId,
    status: 'active',
    plan: plan,
    planDisplayName: plan === 'premium' ? 'Premium' : plan,
    tier: plan === 'premium' ? 'premium' : 'free',
    kind: plan === 'premium' ? 'premium' : 'free',
    active: true,
    isPremium: true,
    isVerified: true,
    features: {
      advanced_automation: true,
      multi_account: true,
      cloud_sync: true,
      priority_support: true,
      custom_export: true,
      api_access: true
    },
    capabilities: {
      bulk_actions: true,
      advanced_analytics: true,
      custom_webhooks: true
    },
    limits: {
      max_accounts: -1,
      daily_actions: -1,
      max_templates: -1,
      history_days: -1,
      export_limit: -1
    },
    secret: 'segredo-' + installId,
    iat: now,
    nbf: now - 5,
    exp: isUnlimited ? now + (365 * 24 * 60 * 60 * 10) : now + (days * 24 * 60 * 60),
    jti: crypto.randomUUID()
  };
  return jwt.sign(payload, PRIVATE_KEY, { algorithm: 'ES256' });
}

// ─── HELPERS TELEGRAM ───
async function sendTelegramMessage(chatId, text, keyboard = null) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
  if (keyboard) body.reply_markup = keyboard;
  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function answerCallbackQuery(callbackQueryId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`;
  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: callbackQueryId, text: text }) });
}

// ═══════════════════════════════════════════════════════════════
// ROTAS
// ═══════════════════════════════════════════════════════════════

// Health
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'mozlince-license-api', version: '3.0-premium', chave: ORIGEM, status: PRIVATE_KEY ? 'live' : 'misconfigured', planos: 7 });
});

// ─── /v1/activate (o que a EXTENSÃO chama) ───
app.post('/v1/activate', async (req, res) => {
  const inicio = Date.now();
  const { installId, licenseKey, clientTag, deviceLabel, buildFingerprint, installType } = req.body || {};

  if (!installId) return res.status(400).json({ error: 'missing_installId', message: 'installId obrigatorio' });
  if (!PRIVATE_KEY) return res.status(500).json({ error: 'server_misconfigured', message: 'Chave privada nao configurada' });

  if (licenseKey && licenseKey.startsWith('ASHEO-')) {
    const lic = await redisGet(licenseKey);
    if (!lic) return res.status(404).json({ error: 'invalid_license', message: 'Chave nao encontrada' });
    if (!lic.active) return res.status(403).json({ error: 'revoked', message: 'Licenca revogada' });

    if (!lic.installId) {
      lic.installId = installId;
      await redisSet(licenseKey, JSON.stringify(lic));
    } else if (lic.installId !== installId) {
      return res.status(403).json({ error: 'already_used', message: 'Chave ja vinculada a outro dispositivo' });
    }

    const expDate = lic.createdAt + lic.days * 24 * 60 * 60 * 1000;
    if (lic.days < 3650 && Date.now() > expDate) return res.status(403).json({ error: 'expired', message: 'Licenca expirada' });

    const token = generateLicenseToken(installId, lic.plan || 'premium', lic.days || 30);
    log('ATIV', `${installId} | ${licenseKey.substring(0, 18)}... | ${Date.now() - inicio}ms`);

    return res.json({
      token,
      tier: 'premium',
      kind: 'premium',
      seat: 1,
      seats: 1,
      gwPass: null,
      plan: lic.plan || 'premium',
      planDisplayName: 'Premium',
      expires_in: Math.floor((expDate - Date.now()) / 1000),
      licenseKey
    });
  }

  // Sem licenseKey: gera nova licença automaticamente (modo trial)
  const newKey = generateLicenseKey();
  const token = generateLicenseToken(installId, 'premium', 30);
  await redisSet(newKey, JSON.stringify({ installId, plan: 'premium', days: 30, createdAt: Date.now(), active: true }));
  log('ATIV', `${installId} | NOVA CHAVE ${newKey.substring(0, 18)}...`);
  return res.json({
    token,
    tier: 'premium',
    kind: 'premium',
    seat: 1,
    seats: 1,
    gwPass: null,
    plan: 'premium',
    planDisplayName: 'Premium',
    expires_in: 30 * 24 * 60 * 60,
    licenseKey: newKey
  });
});

// ─── /v1/deactivate (a extensão chama) ───
app.post('/v1/deactivate', async (req, res) => {
  const { installId } = req.body || {};
  log('WARN', 'Desativacao: ' + (installId || 'sem id'));
  res.json({ ok: true, message: 'Desativado com sucesso' });
});

// ─── /v1/status ───
app.get('/v1/status', (req, res) => {
  res.json({ ok: true, versao: '3.0-premium', chave_carregada: !!PRIVATE_KEY, origem_chave: ORIGEM, uptime: Math.floor(process.uptime()), memoria_mb: Math.round(process.memoryUsage().rss / 1024 / 1024), node: process.version, hora: new Date().toISOString() });
});

// ─── /v1/verify ───
app.post('/v1/verify', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'missing_token' });
  try {
    const decoded = jwt.verify(token, PUBLIC_KEY, { algorithms: ['ES256'] });
    return res.json({ valido: true, ok: true, dados: decoded, expira_em: decoded.exp - Math.floor(Date.now() / 1000) + 's' });
  } catch (e) {
    return res.status(401).json({ valido: false, ok: false, erro: e.message });
  }
});

// ─── /v1/planos ───
app.get('/v1/planos', (req, res) => {
  res.json({ ok: true, planos: [
    { id: '3d', nome: '3 Dias', dias: 3, preco: 2.99 },
    { id: '7d', nome: '7 Dias', dias: 7, preco: 4.99 },
    { id: '15d', nome: '15 Dias', dias: 15, preco: 7.99 },
    { id: '30d', nome: '1 Mes', dias: 30, preco: 12.99 },
    { id: '90d', nome: '3 Meses', dias: 90, preco: 29.99 },
    { id: '1a', nome: '1 Ano', dias: 365, preco: 79.99 },
    { id: 'unli', nome: 'Ilimitado', dias: 3650, preco: 149.99, ilimitado: true }
  ]});
});

// ─── ROTA ANTIGA /activate (compatibilidade) ───
app.post('/activate', async (req, res) => {
  const { installId, licenseKey } = req.body;
  if (!installId) return res.status(400).json({ erro: 'installId é obrigatório' });
  if (licenseKey) {
    const lic = await redisGet(licenseKey);
    if (!lic) return res.status(404).json({ erro: 'Chave de licença inválida' });
    if (!lic.active) return res.status(403).json({ erro: 'Licença revogada' });
    if (!lic.installId) { lic.installId = installId; await redisSet(licenseKey, JSON.stringify(lic)); }
    else if (lic.installId !== installId) return res.status(403).json({ erro: 'Chave já usada em outro dispositivo' });
    const expDate = lic.createdAt + lic.days * 24 * 60 * 60 * 1000;
    if (lic.days < 3650 && Date.now() > expDate) return res.status(403).json({ erro: 'Licença expirada' });
    const token = generateLicenseToken(installId, lic.plan, lic.days);
    return res.json({ token, licenseKey, secret: 'segredo-' + installId, status: 'active', plan: lic.plan, days: lic.days });
  }
  const newKey = generateLicenseKey();
  const token = generateLicenseToken(installId, 'premium', 30);
  await redisSet(newKey, JSON.stringify({ installId, plan: 'premium', days: 30, createdAt: Date.now(), active: true }));
  res.json({ token, licenseKey: newKey, secret: 'segredo-' + installId, status: 'active', plan: 'premium', days: 30 });
});

// ─── /verificar-licenca ───
app.post('/verificar-licenca', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ erro: 'Token é obrigatório' });
  try {
    const decoded = jwt.verify(token, PUBLIC_KEY, { algorithms: ['ES256'] });
    res.json({ valido: true, dados: decoded });
  } catch (err) {
    res.status(401).json({ valido: false, erro: err.message });
  }
});

// ─── /telegram-webhook (o bot chama) ───
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
      await answerCallbackQuery(cb.id, 'Licença gerada!');
      await sendTelegramMessage(chatId, `✅ *Licença gerada!*\n\n*Chave:* \`${licenseKey}\`\n*Duração:* ${days >= 3650 ? 'Ilimitada' : days + ' dias'}`);
    }
    return res.sendStatus(200);
  }

  if (!update.message || !update.message.text) return res.sendStatus(200);
  const chatId = update.message.chat.id;
  const args = update.message.text.trim().replace(/\n/g, ' ').split(' ').filter(a => a.length > 0);
  const command = args[0].toLowerCase();

  if (String(chatId) !== String(OWNER_ID)) { await sendTelegramMessage(chatId, '⛔ Sem permissão.'); return res.sendStatus(200); }

  try {
    if (command === '/start') {
      await sendTelegramMessage(chatId, `👋 *Bem-vindo!*\n\n/gerar - Gera licença\n/activate <installId> <chave>\n/status <chave>\n/revogar <chave>\n/listar - Lista todas`);
    } else if (command === '/gerar') {
      const keyboard = { inline_keyboard: [
        [{ text: '3 Dias', callback_data: 'dur_3' }, { text: '7 Dias', callback_data: 'dur_7' }],
        [{ text: '15 Dias', callback_data: 'dur_15' }, { text: '30 Dias', callback_data: 'dur_30' }],
        [{ text: '90 Dias', callback_data: 'dur_90' }, { text: '1 Ano', callback_data: 'dur_365' }],
        [{ text: '💎 ILIMITADO', callback_data: 'dur_3650' }]
      ]};
      await sendTelegramMessage(chatId, `📅 *Escolha a duração:*`, keyboard);
    } else if (command === '/activate') {
      const licenseKey = args[args.length - 1];
      const installId = args.slice(1, args.length - 1).join(' ');
      if (!installId || !licenseKey) { await sendTelegramMessage(chatId, '⚠️ Use: `/activate <installId> <chave>`'); return res.sendStatus(200); }
      const lic = await redisGet(licenseKey);
      if (!lic) { await sendTelegramMessage(chatId, `❌ Chave \`${licenseKey}\` não encontrada.`); return res.sendStatus(200); }
      if (lic.installId) { await sendTelegramMessage(chatId, `⚠️ Chave já vinculada.`); return res.sendStatus(200); }
      lic.installId = installId;
      await redisSet(licenseKey, JSON.stringify(lic));
      await sendTelegramMessage(chatId, `✅ *Chave vinculada!*\n\n*Chave:* \`${licenseKey}\`\n*Install ID:* \`${installId}\``);
    } else if (command === '/status') {
      const key = args[1];
      if (!key) { await sendTelegramMessage(chatId, '⚠️ Use: /status <chave>'); return res.sendStatus(200); }
      const lic = await redisGet(key);
      if (lic) {
        const expDate = new Date(lic.createdAt + lic.days * 24 * 60 * 60 * 1000);
        await sendTelegramMessage(chatId, `📋 *Status*\n*Chave:* \`${key}\`\n*Install ID:* \`${lic.installId || 'não vinculado'}\`\n*Duração:* ${lic.days >= 3650 ? 'Ilimitada' : lic.days + ' dias'}\n*Expira:* ${expDate.toLocaleString('pt-BR')}\n*Ativa:* ${lic.active ? 'Sim' : 'Não'}`);
      } else { await sendTelegramMessage(chatId, `❌ Nenhuma licença.`); }
    } else if (command === '/revogar') {
      const key = args[1];
      if (!key) { await sendTelegramMessage(chatId, '⚠️ Use: /revogar <chave>'); return res.sendStatus(200); }
      const lic = await redisGet(key);
      if (lic) { lic.active = false; await redisSet(key, JSON.stringify(lic)); await sendTelegramMessage(chatId, `🗑️ Licença revogada.`); }
      else { await sendTelegramMessage(chatId, `❌ Nenhuma licença.`); }
    } else if (command === '/listar') {
      const keys = await redisKeys();
      if (keys.length === 0) { await sendTelegramMessage(chatId, '📭 Nenhuma licença.'); }
      else {
        let msg = `📋 *Licenças (${keys.length})*\n\n`;
        for (const key of keys) {
          const lic = await redisGet(key);
          if (lic) msg += `• \`${key}\` - ${lic.days >= 3650 ? 'Ilimitado' : lic.days + 'd'} - ${lic.active ? 'Ativa' : 'Revogada'}\n`;
        }
        await sendTelegramMessage(chatId, msg);
      }
    } else { await sendTelegramMessage(chatId, '❓ Use /start.'); }
  } catch (err) { log('ERRO', 'Telegram: ' + err.message); }
  res.sendStatus(200);
});

// ─── START ───
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log('SYS', `Servidor Mozlince v3.0 na porta ${PORT}`);
  log('SYS', `Chave: ${ORIGEM}`);
  log('SYS', `Redis: ${UPSTASH_URL ? 'OK' : 'NAO CONFIGURADO'}`);
  log('SYS', `Telegram: ${TELEGRAM_TOKEN ? 'OK' : 'NAO CONFIGURADO'}`);
  if (!PRIVATE_KEY) log('WARN', 'Configure EC_PRIVATE_KEY ou /etc/secrets/private.pem!');
});

process.on('uncaughtException', e => log('ERRO', 'Uncaught: ' + e.message));
process.on('unhandledRejection', e => log('ERRO', 'Rejection: ' + e));
