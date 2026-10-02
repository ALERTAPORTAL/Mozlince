require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const privateKey = process.env.PRIVATE_KEY.replace(/\\n/g, '\n');
const publicKey = process.env.PUBLIC_KEY.replace(/\\n/g, '\n');
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID;

// Banco de dados em memória
const licenses = new Map(); // chave -> { installId, plan, days, createdAt, active, token }

// Gera uma chave no formato ASHEO-XXXX-XXXX-XXXX-XXXX
function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem letras/números confusos
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
    deviceSecret: 'segredo-' + installId,
    exp: Math.floor(Date.now() / 1000) + (days * 24 * 60 * 60)
  };
  return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
}

// ============================================================================
// ENDPOINT PARA A EXTENSÃO (usando a chave amigável)
// ============================================================================

app.post('/gerar-licenca', (req, res) => {
  const { userId, installId, licenseKey } = req.body;
  const id = installId || userId;

  if (!id) {
    return res.status(400).json({ erro: 'installId ou userId e obrigatorio' });
  }

  // Se uma chave de licença foi fornecida, verifica se ela existe
  if (licenseKey) {
    const lic = licenses.get(licenseKey);
    if (!lic) {
      return res.status(404).json({ erro: 'Chave de licenca invalida' });
    }
    if (!lic.active) {
      return res.status(403).json({ erro: 'Licenca revogada' });
    }
    const expDate = lic.createdAt + lic.days * 24 * 60 * 60 * 1000;
    if (Date.now() > expDate) {
      return res.status(403).json({ erro: 'Licenca expirada' });
    }
    // Gera o token para essa chave
    const token = generateLicenseToken(id, lic.plan, lic.days);
    return res.json({
      token,
      licenseKey: licenseKey,
      deviceSecret: 'segredo-' + id,
      status: 'active',
      plan: lic.plan,
      days: lic.days,
      features: { advanced_automation: true, multi_account: true, cloud_sync: true, priority_support: true, custom_export: true, api_access: true }
    });
  }

  // Se não foi fornecida chave, gera uma nova (modo antigo, para testes)
  const newKey = generateLicenseKey();
  const token = generateLicenseToken(id, 'premium', 30);
  licenses.set(newKey, {
    installId: id, plan: 'premium', days: 30,
    createdAt: Date.now(), active: true, token
  });
  res.json({
    token,
    licenseKey: newKey,
    deviceSecret: 'segredo-' + id,
    status: 'active',
    plan: 'premium',
    days: 30,
    features: { advanced_automation: true, multi_account: true, cloud_sync: true, priority_support: true, custom_export: true, api_access: true }
  });
});

// ============================================================================
// WEBHOOK DO TELEGRAM
// ============================================================================

app.post('/telegram-webhook', async (req, res) => {
  const update = req.body;

  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const data = cb.data;

    if (String(chatId) !== String(OWNER_ID)) {
      await answerCallbackQuery(cb.id, '⛔ Você não tem permissão.');
      return res.sendStatus(200);
    }

    if (data.startsWith('dur_')) {
      const parts = data.split('_');
      const days = parseInt(parts[1]);
      const installId = parts[2];

      // Gera uma chave amigável
      const licenseKey = generateLicenseKey();
      const token = generateLicenseToken(installId, 'premium', days);
      licenses.set(licenseKey, {
        installId, plan: 'premium', days,
        createdAt: Date.now(), active: true, token
      });

      await answerCallbackQuery(cb.id, `Licença gerada!`);
      await sendTelegramMessage(chatId,
        `✅ *Licença gerada!*\n\n` +
        `*Chave:* \`${licenseKey}\`\n` +
        `*Install ID:* \`${installId}\`\n` +
        `*Duração:* ${days === 3650 ? 'Ilimitada' : days + ' dias'}\n\n` +
        `Use a chave acima na extensão Asheo.`
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
    await sendTelegramMessage(chatId, '⛔ Você não tem permissão para usar este bot.');
    return res.sendStatus(200);
  }

  try {
    if (command === '/start') {
      await sendTelegramMessage(chatId,
        `👋 *Bem-vindo, Dono!*\n\n` +
        `Comandos:\n` +
        `/gerar <installId> - Gera uma chave de licença\n` +
        `/status <chave> - Verifica o status\n` +
        `/revogar <chave> - Revoga uma licença\n` +
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
      const licenseKey = args[1];
      if (!licenseKey) { await sendTelegramMessage(chatId, '⚠️ Use: `/status <chave>`'); return res.sendStatus(200); }
      const lic = licenses.get(licenseKey);
      if (lic) {
        const expDate = new Date(lic.createdAt + lic.days * 24 * 60 * 60 * 1000);
        await sendTelegramMessage(chatId,
          `📋 *Status*\n\n*Chave:* \`${licenseKey}\`\n*Install ID:* \`${lic.installId}\`\n` +
          `*Duração:* ${lic.days === 3650 ? 'Ilimitada' : lic.days + ' dias'}\n*Expira em:* ${expDate.toLocaleString()}\n*Ativa:* ${lic.active ? 'Sim' : 'Não'}`
        );
      } else {
        await sendTelegramMessage(chatId, `❌ Nenhuma licença para \`${licenseKey}\`.`);
      }
    } 
    else if (command === '/revogar') {
      const licenseKey = args[1];
      if (!licenseKey) { await sendTelegramMessage(chatId, '⚠️ Use: `/revogar <chave>`'); return res.sendStatus(200); }
      if (licenses.has(licenseKey)) { 
        const lic = licenses.get(licenseKey);
        lic.active = false;
        licenses.set(licenseKey, lic);
        await sendTelegramMessage(chatId, `🗑️ Licença \`${licenseKey}\` revogada.`); 
      }
      else { await sendTelegramMessage(chatId, `❌ Nenhuma licença para \`${licenseKey}\`.`); }
    } 
    else if (command === '/listar') {
      if (licenses.size === 0) { await sendTelegramMessage(chatId, '📭 Nenhuma licença ativa.'); }
      else {
        let msg = `📋 *Licenças Ativas (${licenses.size})*\n\n`;
        for (const [key, lic] of licenses) { 
          msg += `• \`${key}\` - ${lic.days === 3650 ? 'Ilimitado' : lic.days + 'd'} - ${lic.active ? 'Ativa' : 'Revogada'}\n`; 
        }
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
