require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const privateKey = process.env.PRIVATE_KEY.replace(/\\n/g, '\n');
const publicKey = process.env.PUBLIC_KEY.replace(/\\n/g, '\n');
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID; // Seu Chat ID do Telegram

const licenses = new Map();

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
  const expiresIn = days === 3650 ? '3650d' : `${days}d`;
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
    deviceSecret: 'segredo-' + installId,
    exp: Math.floor(Date.now() / 1000) + (days * 24 * 60 * 60)
  };
  return jwt.sign(payload, privateKey, { algorithm: 'RS256', expiresIn: expiresIn });
}

app.post('/gerar-licenca', (req, res) => {
  const { userId, installId, days } = req.body;
  if (!userId && !installId) return res.status(400).json({ erro: 'userId ou installId e obrigatorio' });
  const id = installId || userId;
  const duration = days || 30;
  const token = generateLicenseToken(id, 'premium', duration);
  licenses.set(id, { installId: id, token, createdAt: Date.now(), active: true, plan: 'premium', days: duration });
  res.json({
    token, deviceSecret: 'segredo-' + id, status: 'active', plan: 'premium', days: duration,
    features: { advanced_automation: true, multi_account: true, cloud_sync: true, priority_support: true, custom_export: true, api_access: true }
  });
});

app.post('/telegram-webhook', async (req, res) => {
  const update = req.body;

  // Callback de botões inline
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const data = cb.data;

    // Verifica se é o dono
    if (String(chatId) !== String(OWNER_ID)) {
      await answerCallbackQuery(cb.id, '⛔ Você não tem permissão.');
      return res.sendStatus(200);
    }

    if (data.startsWith('dur_')) {
      const parts = data.split('_');
      const days = parseInt(parts[1]);
      const installId = parts[2];
      const token = generateLicenseToken(installId, 'premium', days);
      licenses.set(installId, { installId, token, createdAt: Date.now(), active: true, plan: 'premium', days });
      await answerCallbackQuery(cb.id, `Licença de ${days === 3650 ? 'Ilimitada' : days + ' dias'} gerada!`);
      await sendTelegramMessage(chatId,
        `✅ *Licença gerada!*\n\n` +
        `*Install ID:* \`${installId}\`\n` +
        `*Duração:* ${days === 3650 ? 'Ilimitada' : days + ' dias'}\n` +
        `*Token:*\n\`${token}\``
      );
    }
    return res.sendStatus(200);
  }

  if (!update.message || !update.message.text) return res.sendStatus(200);

  const chatId = update.message.chat.id;
  const text = update.message.text.trim();
  const args = text.split(' ');
  const command = args[0].toLowerCase();

  // ⛔ BLOQUEIO: Apenas o dono pode usar o bot
  if (String(chatId) !== String(OWNER_ID)) {
    await sendTelegramMessage(chatId, '⛔ Você não tem permissão para usar este bot.');
    return res.sendStatus(200);
  }

  try {
    if (command === '/start') {
      await sendTelegramMessage(chatId,
        `👋 *Bem-vindo, Dono!*\n\n` +
        `Comandos:\n` +
        `/gerar <installId> - Gera licença\n` +
        `/status <installId> - Verifica status\n` +
        `/revogar <installId> - Revoga licença\n` +
        `/listar - Lista todas as licenças`
      );
    } 
    else if (command === '/gerar') {
      const installId = args[1];
      if (!installId) { await sendTelegramMessage(chatId, '⚠️ Use: `/gerar <installId>`'); return res.sendStatus(200); }
      const keyboard = {
        inline_keyboard: [
          [{ text: '3 Dias', callback_data: `dur_3_${installId}` }, { text: '7 Dias', callback_data: `dur_7_${installId}` }],
          [{ text: '30 Dias', callback_data: `dur_30_${installId}` }, { text: 'Ilimitado', callback_data: `dur_3650_${installId}` }]
        ]
      };
      await sendTelegramMessage(chatId, `📅 *Escolha a duração para* \`${installId}\`:`, keyboard);
    } 
    else if (command === '/status') {
      const installId = args[1];
      if (!installId) { await sendTelegramMessage(chatId, '⚠️ Use: `/status <installId>`'); return res.sendStatus(200); }
      const lic = licenses.get(installId);
      if (lic) {
        const expDate = new Date(lic.createdAt + lic.days * 24 * 60 * 60 * 1000);
        await sendTelegramMessage(chatId,
          `📋 *Status*\n\n*Install ID:* \`${installId}\`\n*Plano:* ${lic.plan}\n` +
          `*Duração:* ${lic.days === 3650 ? 'Ilimitada' : lic.days + ' dias'}\n*Expira em:* ${expDate.toLocaleString()}\n*Ativa:* ${lic.active ? 'Sim' : 'Não'}`
        );
      } else {
        await sendTelegramMessage(chatId, `❌ Nenhuma licença para \`${installId}\`.`);
      }
    } 
    else if (command === '/revogar') {
      const installId = args[1];
      if (!installId) { await sendTelegramMessage(chatId, '⚠️ Use: `/revogar <installId>`'); return res.sendStatus(200); }
      if (licenses.has(installId)) { licenses.delete(installId); await sendTelegramMessage(chatId, `🗑️ Licença de \`${installId}\` revogada.`); }
      else { await sendTelegramMessage(chatId, `❌ Nenhuma licença para \`${installId}\`.`); }
    } 
    else if (command === '/listar') {
      if (licenses.size === 0) { await sendTelegramMessage(chatId, '📭 Nenhuma licença ativa.'); }
      else {
        let msg = `📋 *Licenças Ativas (${licenses.size})*\n\n`;
        for (const [id, lic] of licenses) { msg += `• \`${id}\` - ${lic.days === 3650 ? 'Ilimitado' : lic.days + 'd'}\n`; }
        await sendTelegramMessage(chatId, msg);
      }
    } 
    else { await sendTelegramMessage(chatId, '❓ Comando não reconhecido. Use /start.'); }
  } catch (err) { console.error('Erro no webhook:', err); }

  res.sendStatus(200);
});

app.post('/verificar-licenca', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ erro: 'Token e obrigatorio' });
  try {
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
    res.json({ valido: true, dados: decoded });
  } catch (err) {
    res.status(401).json({ valido: false, erro: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Servidor rodando na porta ${PORT}`); });
