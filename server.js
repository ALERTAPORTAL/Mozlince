require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const privateKey = process.env.EC_PRIVATE_KEY.replace(/\\n/g, '\n');
const publicKey = process.env.EC_PUBLIC_KEY.replace(/\\n/g, '\n');
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID;

const licenses = new Map();

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
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function answerCallbackQuery(callbackQueryId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text: text })
  });
}

function generateLicenseToken(installId, plan, days) {
  const payload = {
    installId: installId,
    status: 'active',
    plan: plan,
    active: true,
    tier: plan,
    features: {
      advanced_automation: true, multi_account: true, cloud_sync: true,
      priority_support: true, custom_export: true, api_access: true
    },
    secret: 'segredo-' + installId,
    exp: Math.floor(Date.now() / 1000) + (days * 24 * 60 * 60)
  };
  return jwt.sign(payload, privateKey, { algorithm: 'ES256' });
}

app.post('/activate', (req, res) => {
  const { installId, licenseKey } = req.body;
  if (!installId) return res.status(400).json({ erro: 'installId é obrigatório' });

  if (licenseKey) {
    const lic = licenses.get(licenseKey);
    if (!lic) return res.status(404).json({ erro: 'Chave de licença inválida' });
    if (!lic.active) return res.status(403).json({ erro: 'Licença revogada' });
    const expDate = lic.createdAt + lic.days * 24 * 60 * 60 * 1000;
    if (Date.now() > expDate) return res.status(403).json({ erro: 'Licença expirada' });

    const token = generateLicenseToken(installId, lic.plan, lic.days);
    return res.json({
      token,
      licenseKey,
      secret: 'segredo-' + installId,
      status: 'active',
      plan: lic.plan,
      days: lic.days,
      features: { advanced_automation: true, multi_account: true, cloud_sync: true, priority_support: true, custom_export: true, api_access: true }
    });
  }

  const newKey = generateLicenseKey();
  const token = generateLicenseToken(installId, 'premium', 30);
  licenses.set(newKey, { installId, plan: 'premium', days: 30, createdAt: Date.now(), active: true, token });
  res.json({
    token,
    licenseKey: newKey,
    secret: 'segredo-' + installId,
    status: 'active',
    plan: 'premium',
    days: 30,
    features: { advanced_automation: true, multi_account: true, cloud_sync: true, priority_support: true, custom_export: true, api_access: true }
  });
});

app.post('/gerar-licenca', (req, res) => {
  const { userId, installId, days } = req.body;
  const id = installId || userId;
  if (!id) return res.status(400).json({ erro: 'installId ou userId é obrigatório' });
  const duration = days || 30;
  const newKey = generateLicenseKey();
  const token = generateLicenseToken(id, 'premium', duration);
  licenses.set(newKey, { installId: id, plan: 'premium', days: duration, createdAt: Date.now(), active: true, token });
  res.json({ token, licenseKey: newKey, secret: 'segredo-' + id, status: 'active', plan: 'premium', days: duration });
});

app.post('/telegram-webhook', async (req, res) => {
  const update = req.body;

  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const data = cb.data;

    if (String(chatId) !== String(OWNER_ID)) {
      await answerCallbackQuery(cb.id, '⛔ Sem permissão.');
      return res.sendStatus(200);
    }

    if (data.startsWith('dur_')) {
      const parts = data.split('_');
      const days = parseInt(parts[1]);
      const installId = parts[2];
      const licenseKey = generateLicenseKey();
      const token = generateLicenseToken(installId, 'premium', days);
      licenses.set(licenseKey, { installId, plan: 'premium', days, createdAt: Date.now(), active: true, token });
      await answerCallbackQuery(cb.id, `Licença gerada!`);
      await sendTelegramMessage(chatId,
        `✅ *Licença gerada!*\n\n` +
        `*Chave:* \`${licenseKey}\`\n` +
        `*Install ID:* \`${installId}\`\n` +
        `*Duração:* ${days === 3650 ? 'Ilimitada' : days + ' dias'}\n\n` +
        `Use a chave acima na extensão.`
      );
    }
    return res.sendStatus(200);
  }

  if (!update.message || !update.message.text) return res.sendStatus(200);
  const chatId = update.message.chat.id;
  const text = update.message.text.trim();
  const args = text.split(' ');
  const command = args[0].toLowerCase();

  if (String(chatId) !== String(OWNER_ID)) {
    await sendTelegramMessage(chatId, '⛔ Sem permissão.');
    return res.sendStatus(200);
  }

  try {
    if (command === '/start') {
      await sendTelegramMessage(chatId,
        `👋 *Bem-vindo!*\n\n` +
        `/gerar <installId> - Gera licença\n` +
        `/status <chave> - Verifica status\n` +
        `/revogar <chave> - Revoga\n` +
        `/listar - Lista todas`
      );
    } else if (command === '/gerar') {
      const installId = args[1];
      if (!installId) { await sendTelegramMessage(chatId, '⚠️ Use: /gerar <installId>'); return res.sendStatus(200); }
      const keyboard = {
        inline_keyboard: [
          [{ text: '3 Dias', callback_data: `dur_3_${installId}` }, { text: '7 Dias', callback_data: `dur_7_${installId}` }],
          [{ text: '30 Dias', callback_data: `dur_30_${installId}` }, { text: 'Ilimitado', callback_data: `dur_3650_${installId}` }]
        ]
      };
      await sendTelegramMessage(chatId, `📅 *Duração para* \`${installId}\`:`, keyboard);
    } else if (command === '/status') {
      const key = args[1];
      if (!key) { await sendTelegramMessage(chatId, '⚠️ Use: /status <chave>'); return res.sendStatus(200); }
      const lic = licenses.get(key);
      if (lic) {
        const expDate = new Date(lic.createdAt + lic.days * 24 * 60 * 60 * 1000);
        await sendTelegramMessage(chatId,
          `📋 *Status*\n*Chave:* \`${key}\`\n*Install ID:* \`${lic.installId}\`\n` +
          `*Duração:* ${lic.days === 3650 ? 'Ilimitada' : lic.days + ' dias'}\n*Expira:* ${expDate.toLocaleString()}\n*Ativa:* ${lic.active ? 'Sim' : 'Não'}`
        );
      } else { await sendTelegramMessage(chatId, `❌ Nenhuma licença para \`${key}\`.`); }
    } else if (command === '/revogar') {
      const key = args[1];
      if (!key) { await sendTelegramMessage(chatId, '⚠️ Use: /revogar <chave>'); return res.sendStatus(200); }
      if (licenses.has(key)) {
        const lic = licenses.get(key);
        lic.active = false;
        licenses.set(key, lic);
        await sendTelegramMessage(chatId, `🗑️ Licença \`${key}\` revogada.`);
      } else { await sendTelegramMessage(chatId, `❌ Nenhuma licença para \`${key}\`.`); }
    } else if (command === '/listar') {
      if (licenses.size === 0) { await sendTelegramMessage(chatId, '📭 Nenhuma licença.'); }
      else {
        let msg = `📋 *Licenças (${licenses.size})*\n\n`;
        for (const [key, lic] of licenses) { msg += `• \`${key}\` - ${lic.days === 3650 ? 'Ilimitado' : lic.days + 'd'} - ${lic.active ? 'Ativa' : 'Revogada'}\n`; }
        await sendTelegramMessage(chatId, msg);
      }
    } else { await sendTelegramMessage(chatId, '❓ Use /start.'); }
  } catch (err) { console.error('Erro:', err); }
  res.sendStatus(200);
});

app.post('/verificar-licenca', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ erro: 'Token é obrigatório' });
  try {
    const decoded = jwt.verify(token, publicKey, { algorithms: ['ES256'] });
    res.json({ valido: true, dados: decoded });
  } catch (err) {
    res.status(401).json({ valido: false, erro: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Servidor rodando na porta ${PORT}`); });
