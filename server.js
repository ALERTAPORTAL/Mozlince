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

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisSet(key, value) {
  const res = await fetch(`${UPSTASH_URL}/set/${key}`, {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json'
    },
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
    sub: installId,
    installId: installId,
    status: 'active',
    plan: plan,
    planDisplayName: plan === 'premium' ? 'Premium' : 'Free',
    active: true,
    tier: plan,
    kind: plan === 'premium' ? 'premium' : 'free',
    features: {
      advanced_automation: true,
      multi_account: true,
      cloud_sync: true,
      priority_support: true,
      custom_export: true,
      api_access: true
    },
    secret: 'segredo-' + installId,
    exp: Math.floor(Date.now() / 1000) + (days * 24 * 60 * 60)
  };
  return jwt.sign(payload, privateKey, { algorithm: 'ES256' });
}

app.post('/activate', async (req, res) => {
  const { installId, licenseKey } = req.body;
  if (!installId) return res.status(400).json({ erro: 'installId é obrigatório' });

  if (licenseKey) {
    const lic = await redisGet(licenseKey);
    if (!lic) return res.status(404).json({ erro: 'Chave de licença inválida' });
    if (!lic.active) return res.status(403).json({ erro: 'Licença revogada' });

    if (!lic.installId) {
      lic.installId = installId;
      await redisSet(licenseKey, JSON.stringify(lic));
    } else if (lic.installId !== installId) {
      return res.status(403).json({ erro: 'Chave já usada em outro dispositivo' });
    }

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
  await redisSet(newKey, JSON.stringify({ installId, plan: 'premium', days: 30, createdAt: Date.now(), active: true }));
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
      const licenseKey = generateLicenseKey();
      
      await redisSet(licenseKey, JSON.stringify({ 
        plan: 'premium', 
        days: days, 
        createdAt: Date.now(), 
        active: true, 
        installId: null 
      }));
      
      await answerCallbackQuery(cb.id, `Licença gerada!`);
      await sendTelegramMessage(chatId,
        `✅ *Licença gerada!*\n\n` +
        `*Chave:* \`${licenseKey}\`\n` +
        `*Duração:* ${days === 3650 ? 'Ilimitada' : days + ' dias'}\n\n` +
        `Use a chave acima na extensão.`
      );
    }
    return res.sendStatus(200);
  }

  if (!update.message || !update.message.text) return res.sendStatus(200);
  const chatId = update.message.chat.id;
  const text = update.message.text.trim();
  
  // Remove quebras de linha e junta tudo com espaço
  const cleanText = text.replace(/\n/g, ' ');
  const args = cleanText.split(' ').filter(a => a.length > 0);
  const command = args[0].toLowerCase();

  if (String(chatId) !== String(OWNER_ID)) {
    await sendTelegramMessage(chatId, '⛔ Sem permissão.');
    return res.sendStatus(200);
  }

  try {
    if (command === '/start') {
      await sendTelegramMessage(chatId,
        `👋 *Bem-vindo!*\n\n` +
        `/gerar - Gera licença\n` +
        `/activate <installId> <chave> - Vincula chave ao Install ID\n` +
        `/status <chave> - Verifica status\n` +
        `/revogar <chave> - Revoga\n` +
        `/listar - Lista todas`
      );
    } else if (command === '/gerar') {
      const keyboard = {
        inline_keyboard: [
          [{ text: '3 Dias', callback_data: `dur_3` }, { text: '7 Dias', callback_data: `dur_7` }],
          [{ text: '30 Dias', callback_data: `dur_30` }, { text: 'Ilimitado', callback_data: `dur_3650` }]
        ]
      };
      await sendTelegramMessage(chatId, `📅 *Escolha a duração:*`, keyboard);
    } else if (command === '/activate') {
      // Pega a última palavra como chave e junta o resto como Install ID
      const licenseKey = args[args.length - 1];
      const installId = args.slice(1, args.length - 1).join(' ');

      if (!installId || !licenseKey) {
        await sendTelegramMessage(chatId, '⚠️ Use: `/activate <installId> <chave>`\n\nExemplo:\n`/activate 37a52b3d-cef4-4a6a-98d9-772104c89d04 ASHEO-XXXX-XXXX-XXXX-XXXX`');
        return res.sendStatus(200);
      }

      const lic = await redisGet(licenseKey);
      if (!lic) {
        await sendTelegramMessage(chatId, `❌ Chave \`${licenseKey}\` não encontrada.`);
        return res.sendStatus(200);
      }
      if (lic.installId) {
        await sendTelegramMessage(chatId, `⚠️ Chave \`${licenseKey}\` já está vinculada a outro Install ID.`);
        return res.sendStatus(200);
      }

      lic.installId = installId;
      await redisSet(licenseKey, JSON.stringify(lic));
      await sendTelegramMessage(chatId,
        `✅ *Chave vinculada com sucesso!*\n\n` +
        `*Chave:* \`${licenseKey}\`\n` +
        `*Install ID:* \`${installId}\`\n\n` +
        `Agora a extensão pode ser ativada.`
      );
    } else if (command === '/status') {
      const key = args[1];
      if (!key) { await sendTelegramMessage(chatId, '⚠️ Use: /status <chave>'); return res.sendStatus(200); }
      const lic = await redisGet(key);
      if (lic) {
        const expDate = new Date(lic.createdAt + lic.days * 24 * 60 * 60 * 1000);
        const expFormatted = expDate.toLocaleString('pt-BR');
        await sendTelegramMessage(chatId,
          `📋 *Status*\n*Chave:* \`${key}\`\n*Install ID:* \`${lic.installId || 'não vinculado'}\`\n` +
          `*Duração:* ${lic.days === 3650 ? 'Ilimitada' : lic.days + ' dias'}\n*Expira:* ${expFormatted}\n*Ativa:* ${lic.active ? 'Sim' : 'Não'}`
        );
      } else { await sendTelegramMessage(chatId, `❌ Nenhuma licença para \`${key}\`.`); }
    } else if (command === '/revogar') {
      const key = args[1];
      if (!key) { await sendTelegramMessage(chatId, '⚠️ Use: /revogar <chave>'); return res.sendStatus(200); }
      const lic = await redisGet(key);
      if (lic) {
        lic.active = false;
        await redisSet(key, JSON.stringify(lic));
        await sendTelegramMessage(chatId, `🗑️ Licença \`${key}\` revogada.`);
      } else { await sendTelegramMessage(chatId, `❌ Nenhuma licença para \`${key}\`.`); }
    } else if (command === '/listar') {
      const keys = await redisKeys();
      if (keys.length === 0) { await sendTelegramMessage(chatId, '📭 Nenhuma licença.'); }
      else {
        let msg = `📋 *Licenças (${keys.length})*\n\n`;
        for (const key of keys) {
          const lic = await redisGet(key);
          if (lic) {
            const expDate = new Date(lic.createdAt + lic.days * 24 * 60 * 60 * 1000);
            msg += `• \`${key}\` - ${lic.days === 3650 ? 'Ilimitado' : lic.days + 'd'} - ${lic.active ? 'Ativa' : 'Revogada'} - Expira: ${expDate.toLocaleDateString('pt-BR')}\n`;
          }
        }
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


// Alias: extensão chama /v1/activate -> redireciona para /activate
app.post('/v1/activate', (req, res, next) => {
  req.url = '/activate';
  req.method = 'POST';
  app._router.handle(req, res, next);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Servidor rodando na porta ${PORT}`); });
