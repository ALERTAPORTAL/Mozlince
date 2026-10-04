require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','x-asheo-install','x-asheo-ts','x-asheo-sig','x-asheo-build','x-asheo-nonce'] }));
app.options(/.*/, cors());
app.use(express.json());

// ============================================================
//  CONFIG
// ============================================================
const PRICES = {
  '3d':   { dias: 3,    preco: 2.99,   label: '3 Dias' },
  '7d':   { dias: 7,    preco: 4.99,   label: '7 Dias' },
  '15d':  { dias: 15,   preco: 7.99,   label: '15 Dias' },
  '30d':  { dias: 30,   preco: 12.99,  label: '30 Dias' },
  '90d':  { dias: 90,   preco: 29.99,  label: '90 Dias' },
  '365d': { dias: 365,  preco: 79.99,  label: '1 Ano' },
  'ltd':  { dias: 3650, preco: 149.99, label: 'Ilimitado' }
};

const WELCOME_TEXT = `╔══════════════════════════════╗
║   🎫 *MOZLINCE LICENSE BOT*   ║
║       Painel de Controle      ║
╚══════════════════════════════╝

👋 *Bem-vindo, Boss!*

📌 *Ações rápidas:*
• /gerar — Criar nova licença
• /trial — Gerar trial 7 dias
• /listar — Ver todas as licenças
• /estatisticas — Estatísticas gerais
• /avisos — Licenças expirando
• /cupons — Gerenciar cupons
• /backup — Exportar JSON
• /broadcast — Enviar mensagem
• /ajuda — Lista completa

_Selecione uma opção abaixo:_`;

// ============================================================
//  CHAVES
// ============================================================
function loadKeyFromFile(filePath, envVal, label) {
  if (fs.existsSync(filePath)) {
    try { const c = fs.readFileSync(filePath, 'utf8'); console.log('✅ ' + label + ' → ' + filePath); return c; }
    catch (e) { console.error('⚠️ ' + label + ':', e.message); }
  }
  if (envVal) {
    let v = envVal.trim();
    if (!v.includes('BEGIN')) { try { v = Buffer.from(v, 'base64').toString('utf8'); } catch (e) {} }
    else { v = v.replace(/\\n/g, '\n'); }
    console.log('✅ ' + label + ' → env var');
    return v;
  }
  console.error('❌ ' + label + ' NÃO ENCONTRADA');
  return null;
}

const privateKey = loadKeyFromFile('/etc/secrets/private.pem', process.env.EC_PRIVATE_KEY, 'EC_PRIVATE_KEY');
const publicKey  = loadKeyFromFile('/etc/secrets/public.pem',  process.env.EC_PUBLIC_KEY,  'EC_PUBLIC_KEY');

console.log('========== BOOT ==========');
console.log('privateKey existe?', !!privateKey);
if (privateKey) { try { crypto.createPrivateKey(privateKey); console.log('✅ privateKey VÁLIDA'); } catch (e) { console.error('❌', e.message); } }
console.log('==========================');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// ============================================================
//  REDIS
// ============================================================
async function redisSet(key, value) {
  return (await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: typeof value === 'string' ? value : JSON.stringify(value)
  })).json();
}
async function redisGet(key) {
  const data = await (await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  })).json();
  if (!data.result) return null;
  try { return JSON.parse(data.result); } catch { return data.result; }
}
async function redisDel(key) {
  return (await fetch(`${UPSTASH_URL}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  })).json();
}
async function redisKeys(pattern = 'ASHEO-*') {
  const data = await (await fetch(`${UPSTASH_URL}/keys/${pattern}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  })).json();
  return data.result || [];
}
async function redisPush(key, value) {
  const arr = await redisGet(key) || [];
  arr.push(value);
  if (arr.length > 500) arr.splice(0, arr.length - 500);
  await redisSet(key, arr);
  return arr;
}

// ============================================================
//  UTILS
// ============================================================
function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = () => { let s = ''; for (let i = 0; i < 4; i++) s += chars[crypto.randomInt(0, chars.length)]; return s; };
  return `ASHEO-${b()}-${b()}-${b()}-${b()}`;
}
function generateCouponCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[crypto.randomInt(0, chars.length)];
  return s;
}
function fmtDate(ts) {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function diasRestantes(lic) {
  if (!lic.createdAt || !lic.days) return 0;
  return Math.ceil((lic.createdAt + lic.days * 86400000 - Date.now()) / 86400000);
}
function expiraEm(lic) { return lic.createdAt + lic.days * 86400000; }
function isExpired(lic) { return Date.now() > expiraEm(lic); }
function statusEmoji(lic) {
  if (!lic.active) return '🔴';
  if (isExpired(lic)) return '⏰';
  const d = diasRestantes(lic);
  if (d <= 1) return '🚨';
  if (d <= 3) return '⚠️';
  if (d <= 7) return '🟡';
  return '🟢';
}
function statusTexto(lic) {
  if (!lic.active) return 'Revogada';
  if (isExpired(lic)) return 'Expirada';
  return 'Ativa';
}
function aplicarCupom(preco, cupom) {
  if (!cupom) return { preco, desconto: 0, cupom: null };
  if (cupom.tipo === 'percent') {
    const desconto = preco * (cupom.valor / 100);
    return { preco: Math.max(0, preco - desconto), desconto, cupom };
  } else if (cupom.tipo === 'fixed') {
    return { preco: Math.max(0, preco - cupom.valor), desconto: cupom.valor, cupom };
  }
  return { preco, desconto: 0, cupom: null };
}

// ============================================================
//  TELEGRAM
// ============================================================
async function sendTelegramMessage(chatId, text, keyboard = null) {
  const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (keyboard) body.reply_markup = keyboard;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  } catch (e) { console.error('sendTelegramMessage:', e); }
}
async function answerCallbackQuery(id, text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: id, text })
    });
  } catch (e) {}
}

// ============================================================
//  LOGS
// ============================================================
async function logAcao(acao, detalhes) {
  await redisPush('ASHEO_LOG', {
    acao, detalhes, at: Date.now()
  });
}
async function registrarVenda(key, lic, cupomUsado) {
  const venda = {
    key, plano: lic.label, preco: lic.price, precoOriginal: lic.originalPrice || lic.price,
    cupom: cupomUsado || null, at: Date.now(), installId: lic.installId || null
  };
  await redisPush('ASHEO_SALES', venda);
}

// ============================================================
//  JWT
// ============================================================
function generateLicenseToken(installId, plan, days) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    sub: installId, installId, status: 'active',
    plan, planDisplayName: plan === 'premium' ? 'Premium' : 'Free',
    active: true, tier: plan, kind: plan === 'premium' ? 'premium' : 'free',
    features: {
      browser_mods: true, browserMods: true,
      rule_ops_lab: true, ruleOpsLab: true,
      live_injection_hud: true, liveInjectionHud: true,
      advanced_protection: true, advancedProtection: true,
      api_access: true, apiAccess: true,
      experimental_features: true, experimentalFeatures: true,
      advanced_automation: true, advancedAutomation: true,
      multi_account: true, multiAccount: true,
      cloud_sync: true, cloudSync: true,
      priority_support: true, prioritySupport: true,
      custom_export: true, customExport: true
    },
    capabilities: {
      browser_mods: true, browserMods: true,
      rule_ops_lab: true, ruleOpsLab: true,
      live_injection_hud: true, liveInjectionHud: true,
      advanced_protection: true, advancedProtection: true,
      api_access: true, apiAccess: true,
      experimental_features: true, experimentalFeatures: true
    },
    secret: 'segredo-' + installId,
    iat: now, nbf: now - 5, exp: now + (days * 24 * 60 * 60)
  }, privateKey, { algorithm: 'ES256' });
}

// ============================================================
//  ROTAS HTTP
// ============================================================
app.get('/', (req, res) => res.json({ ok: true, service: 'mozlince-license', status: 'live', ts: Date.now() }));
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.post('/v1/activate', async (req, res) => {
  try {
    const { installId, licenseKey } = req.body || {};
    if (!installId || !licenseKey) return res.status(400).json({ error: 'missing_params' });
    if (!privateKey) return res.status(500).json({ error: 'no_private_key' });

    const lic = await redisGet(licenseKey);
    if (!lic) return res.status(401).json({ error: 'invalid_license' });
    if (!lic.active) return res.status(403).json({ error: 'revoked' });
    if (isExpired(lic)) return res.status(403).json({ error: 'expired' });

    if (!lic.installId) { lic.installId = installId; await redisSet(licenseKey, lic); }
    else if (lic.installId !== installId) return res.status(403).json({ error: 'seat_taken', installId: lic.installId });

    const token = generateLicenseToken(installId, lic.plan, lic.days);
    console.log(`[activate] ${installId} ${licenseKey}`);
    res.json({ token, tier: lic.plan, seat: 1, seats: 1, gwPass: null, secret: 'segredo-' + installId, status: 'active', plan: lic.plan, days: lic.days });
  } catch (e) {
    console.error('[activate]', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/v1/deactivate', (req, res) => res.json({ ok: true }));

// ============================================================
//  DASHBOARD WEB
// ============================================================
app.get('/dashboard', async (req, res) => {
  try {
    const keys = await redisKeys();
    const licencas = [];
    let ativas = 0, expiradas = 0, revogadas = 0, receita = 0;
    for (const k of keys) {
      const lic = await redisGet(k);
      if (!lic) continue;
      licencas.push({ key: k, ...lic, status: statusTexto(lic), dias: diasRestantes(lic) });
      if (!lic.active) revogadas++;
      else if (isExpired(lic)) expiradas++;
      else ativas++;
      receita += lic.price || 0;
    }
    const sales = await redisGet('ASHEO_SALES') || [];
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Mozlince Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,sans-serif}
body{background:#0a0a0f;color:#e0e0e0;padding:20px}
h1{color:#f0b429;margin-bottom:20px;font-size:28px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:30px}
.card{background:linear-gradient(135deg,#1a1a2e,#16213e);padding:20px;border-radius:12px;border:1px solid #2a2a4a}
.card .label{font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px}
.card .value{font-size:32px;font-weight:bold;color:#f0b429;margin-top:8px}
table{width:100%;border-collapse:collapse;background:#12121a;border-radius:12px;overflow:hidden}
th,td{padding:12px;text-align:left;border-bottom:1px solid #222}
th{background:#1a1a2e;color:#f0b429;font-size:12px;text-transform:uppercase;letter-spacing:1px}
tr:hover{background:#1a1a2e}
.status{display:inline-block;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:bold}
.status.Ativa{background:#0a4d2e;color:#4ade80}
.status.Expirada{background:#4d2e0a;color:#fbbf24}
.status.Revogada{background:#4d0a0a;color:#f87171}
.mono{font-family:monospace;font-size:12px;color:#888}
</style></head><body>
<h1>🎫 Mozlince Dashboard</h1>
<div class="cards">
<div class="card"><div class="label">Total</div><div class="value">${licencas.length}</div></div>
<div class="card"><div class="label">Ativas</div><div class="value">${ativas}</div></div>
<div class="card"><div class="label">Expiradas</div><div class="value">${expiradas}</div></div>
<div class="card"><div class="label">Revogadas</div><div class="value">${revogadas}</div></div>
<div class="card"><div class="label">Receita</div><div class="value">R$ ${receita.toFixed(2)}</div></div>
<div class="card"><div class="label">Vendas</div><div class="value">${sales.length}</div></div>
</div>
<h2 style="color:#f0b429;margin:20px 0 10px">📋 Licenças</h2>
<table><thead><tr><th>Chave</th><th>Plano</th><th>Status</th><th>Dias</th><th>Install</th><th>Expira</th></tr></thead><tbody>
${licencas.map(l => `<tr><td class="mono">${l.key}</td><td>${l.label || l.days+'d'}</td><td><span class="status ${l.status}">${l.status}</span></td><td>${l.days > 0 ? l.dias : '-'}</td><td class="mono">${(l.installId||'livre').slice(0,8)}</td><td class="mono">${fmtDate(expiraEm(l))}</td></tr>`).join('')}
</tbody></table>
<h2 style="color:#f0b429;margin:30px 0 10px">💰 Últimas Vendas</h2>
<table><thead><tr><th>Data</th><th>Chave</th><th>Plano</th><th>Preço</th><th>Cupom</th></tr></thead><tbody>
${sales.slice(-20).reverse().map(s => `<tr><td class="mono">${fmtDate(s.at)}</td><td class="mono">${s.key}</td><td>${s.plano}</td><td>R$ ${s.preco.toFixed(2)}</td><td>${s.cupom || '-'}</td></tr>`).join('')}
</tbody></table>
<p style="text-align:center;color:#444;margin-top:40px;font-size:12px">Mozlince License System © ${new Date().getFullYear()}</p>
</body></html>`;
    res.send(html);
  } catch (e) {
    console.error('Dashboard erro:', e);
    res.status(500).send('Erro ao carregar dashboard');
  }
});

// ============================================================
//  WEBHOOK TELEGRAM
// ============================================================
app.post('/telegram-webhook', async (req, res) => {
  const update = req.body;

  // ============ CALLBACKS ============
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const data = cb.data;

    if (String(chatId) !== String(OWNER_ID)) {
      await answerCallbackQuery(cb.id, '⛔ Sem permissão.');
      return res.sendStatus(200);
    }

    // ==== MENU PRINCIPAL ====
    if (data === 'menu') { await answerCallbackQuery(cb.id, '🏠'); await sendTelegramMessage(chatId, WELCOME_TEXT); return res.sendStatus(200); }
    if (data === 'back') { await answerCallbackQuery(cb.id, '🔙'); await sendTelegramMessage(chatId, WELCOME_TEXT); return res.sendStatus(200); }

    // ==== COMPRAR / GERAR ====
    if (data.startsWith('buy_')) {
      const planKey = data.slice(4);
      const plan = PRICES[planKey];
      if (!plan) { await answerCallbackQuery(cb.id, '❌ Plano inválido'); return res.sendStatus(200); }

      const licenseKey = generateLicenseKey();
      const lic = {
        plan: 'premium', days: plan.dias, price: plan.preco, originalPrice: plan.preco, label: plan.label,
        createdAt: Date.now(), active: true, installId: null, soldBy: 'owner'
      };
      await redisSet(licenseKey, lic);
      await registrarVenda(licenseKey, lic, null);
      await logAcao('GERAR', { key: licenseKey, plano: plan.label, preco: plan.preco });

      await answerCallbackQuery(cb.id, `✅ ${plan.label} gerada!`);

      // ==== NOTIFICAÇÃO DE NOVA VENDA ====
      await sendTelegramMessage(chatId,
        `╔══════════════════════════════╗\n` +
        `║   🔔 *NOVA VENDA REGISTRADA*  ║\n` +
        `╚══════════════════════════════╝\n\n` +
        `🔑 *Chave:*\n\`${licenseKey}\`\n\n` +
        `📦 *Plano:* ${plan.label}\n` +
        `💰 *Valor:* R$ ${plan.preco.toFixed(2)}\n` +
        `📅 *Expira:* ${plan.dias === 3650 ? 'Nunca' : fmtDate(Date.now() + plan.dias * 86400000)}\n` +
        `🎯 *Status:* 🟢 Ativa\n` +
        `🕐 *Gerada:* ${fmtDate(Date.now())}\n\n` +
        `_Envie a chave para o cliente._`,
        { inline_keyboard: [
          [{ text: '📋 Ver detalhes', callback_data: 'info_' + licenseKey }],
          [{ text: '🔙 Menu', callback_data: 'back' }]
        ]}
      );
    }

    // ==== INFO ====
    if (data.startsWith('info_')) {
      const key = data.slice(5);
      const lic = await redisGet(key);
      if (!lic) { await answerCallbackQuery(cb.id, '❌ Não encontrada'); return res.sendStatus(200); }
      const dias = diasRestantes(lic);
      await answerCallbackQuery(cb.id, '📋');
      await sendTelegramMessage(chatId,
        `📋 *DETALHES*\n\n` +
        `🔑 \`${key}\`\n` +
        `${statusEmoji(lic)} *Status:* ${statusTexto(lic)}\n` +
        `👤 *Install:* \`${lic.installId || 'livre'}\`\n` +
        `📦 *Plano:* ${lic.label || lic.days + 'd'}\n` +
        `💰 *Valor:* R$ ${(lic.price || 0).toFixed(2)}\n` +
        `📅 *Criada:* ${fmtDate(lic.createdAt)}\n` +
        `⏰ *Expira:* ${lic.days === 3650 ? 'Nunca' : fmtDate(expiraEm(lic))}\n` +
        (lic.days !== 3650 ? `⏳ *Restam:* ${dias > 0 ? dias + 'd' : 'Expirada'}\n` : '') +
        (lic.cupom ? `🎟️ *Cupom:* ${lic.cupom}\n` : ''),
        { inline_keyboard: [
          [{ text: '🔓 Desvincular', callback_data: 'unbind_' + key }, { text: '♻️ Resetar', callback_data: 'reset_' + key }],
          [{ text: '🗑️ Excluir', callback_data: 'del_' + key }, { text: '🔙 Menu', callback_data: 'back' }]
        ]}
      );
    }

    // ==== DESVINCULAR / RESET / DELETAR ====
    if (data.startsWith('unbind_')) {
      const key = data.slice(7);
      const lic = await redisGet(key);
      if (!lic) { await answerCallbackQuery(cb.id, '❌'); return res.sendStatus(200); }
      lic.installId = null;
      await redisSet(key, lic);
      await logAcao('DESVINCULAR', { key });
      await answerCallbackQuery(cb.id, '🔓');
      await sendTelegramMessage(chatId, `🔓 \`${key}\` desvinculada.`);
    }
    if (data.startsWith('reset_')) {
      const key = data.slice(6);
      const lic = await redisGet(key);
      if (!lic) { await answerCallbackQuery(cb.id, '❌'); return res.sendStatus(200); }
      lic.installId = null; lic.active = true; lic.createdAt = Date.now();
      await redisSet(key, lic);
      await logAcao('RESET', { key });
      await answerCallbackQuery(cb.id, '♻️');
      await sendTelegramMessage(chatId, `♻️ \`${key}\` resetada.`);
    }
    if (data.startsWith('del_')) {
      const key = data.slice(4);
      await redisDel(key);
      await logAcao('EXCLUIR', { key });
      await answerCallbackQuery(cb.id, '🗑️');
      await sendTelegramMessage(chatId, `🗑️ \`${key}\` excluída.`);
    }
    if (data === 'delall_confirm') {
      const keys = await redisKeys();
      let c = 0;
      for (const k of keys) { await redisDel(k); c++; }
      await logAcao('EXCLUIR_TUDO', { count: c });
      await answerCallbackQuery(cb.id, `🗑️ ${c}`);
      await sendTelegramMessage(chatId, `🗑️ *${c} licenças* excluídas.`);
    }

    // ==== ESTATÍSTICAS ====
    if (data === 'stats') {
      const keys = await redisKeys();
      let ativas = 0, expiradas = 0, revogadas = 0, vinculadas = 0, livres = 0, receita = 0;
      for (const k of keys) {
        const lic = await redisGet(k);
        if (!lic) continue;
        if (!lic.active) revogadas++;
        else if (isExpired(lic)) expiradas++;
        else ativas++;
        if (lic.installId) vinculadas++; else livres++;
        receita += lic.price || 0;
      }
      const sales = await redisGet('ASHEO_SALES') || [];
      await answerCallbackQuery(cb.id, '📊');
      await sendTelegramMessage(chatId,
        `╔══════════════════════════════╗\n` +
        `║   📊 *ESTATÍSTICAS*           ║\n` +
        `╚══════════════════════════════╝\n\n` +
        `📦 Total: *${keys.length}*\n` +
        `🟢 Ativas: *${ativas}*\n` +
        `⏰ Expiradas: *${expiradas}*\n` +
        `🔴 Revogadas: *${revogadas}*\n` +
        `👤 Vinculadas: *${vinculadas}*\n` +
        `🔓 Livres: *${livres}*\n\n` +
        `💰 Receita total: *R$ ${receita.toFixed(2)}*\n` +
        `📈 Vendas: *${sales.length}*`
      );
    }

    // ==== AVISOS ====
    if (data === 'alerts') {
      const keys = await redisKeys();
      let criticas = [];
      for (const k of keys) {
        const lic = await redisGet(k);
        if (!lic || !lic.active || isExpired(lic) || lic.days === 3650) continue;
        const d = diasRestantes(lic);
        if (d <= 7) criticas.push({ key: k, lic, dias: d });
      }
      criticas.sort((a, b) => a.dias - b.dias);
      let msg = `🚨 *AVISOS DE EXPIRAÇÃO*\n\n`;
      if (!criticas.length) msg += `✅ Nenhuma expirando em 7 dias.`;
      else for (const c of criticas) msg += `${statusEmoji(c.lic)} \`${c.key}\` — *${c.dias}d* — ${c.lic.installId ? '👤' : '🔓'}\n`;
      await answerCallbackQuery(cb.id, '🚨');
      await sendTelegramMessage(chatId, msg);
    }

    // ==== BACKUP ====
    if (data === 'backup') {
      const keys = await redisKeys();
      const d = {};
      for (const k of keys) d[k] = await redisGet(k);
      const json = JSON.stringify(d, null, 2);
      await answerCallbackQuery(cb.id, '📦');
      await sendTelegramMessage(chatId, `📦 *Backup* (${keys.length} licenças)`);
      try {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('caption', `📦 Mozlince backup — ${fmtDate(Date.now())}`);
        formData.append('document', new Blob([json], { type: 'application/json' }), `mozlince-${Date.now()}.json`);
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, { method: 'POST', body: formData });
      } catch (e) { await sendTelegramMessage(chatId, '❌ Erro ao enviar.'); }
    }

    // ==== CUPONS ====
    if (data === 'coupons_list') {
      const coupons = await redisGet('ASHEO_COUPONS') || {};
      let msg = `🎟️ *CUPONS CADASTRADOS*\n\n`;
      const keys = Object.keys(coupons);
      if (!keys.length) msg += `_Nenhum cupom cadastrado._`;
      else {
        for (const c of keys) {
          const cup = coupons[c];
          msg += `*${c}*\n`;
          msg += `   ${cup.tipo === 'percent' ? cup.valor + '%' : 'R$ ' + cup.valor.toFixed(2)} off`;
          msg += ` • usos: ${cup.usos || 0}/${cup.maxUsos || '∞'}\n`;
        }
      }
      await answerCallbackQuery(cb.id, '🎟️');
      await sendTelegramMessage(chatId, msg, { inline_keyboard: [
        [{ text: '➕ Novo cupom', callback_data: 'coupon_new' }],
        [{ text: '🔙 Menu', callback_data: 'back' }]
      ]});
    }
    if (data === 'coupon_new') {
      await answerCallbackQuery(cb.id, '➕');
      await sendTelegramMessage(chatId,
        `🎟️ *NOVO CUPOM*\n\nUse um dos comandos:\n\n` +
        `/cupom_pct <código> <desconto%> [max_usos]\n` +
        `_Ex:_ \`/cupom_pct PROMO20 20 100\`\n\n` +
        `/cupom_fix <código> <desconto> [max_usos]\n` +
        `_Ex:_ \`/cupom_fix BLACK5 5 50\``
      );
    }

    // ==== BROADCAST CONFIRMAÇÃO ====
    if (data === 'broadcast_confirm') {
      const pending = await redisGet('ASHEO_BROADCAST_PENDING');
      if (!pending) { await answerCallbackQuery(cb.id, '❌ Expirado'); return res.sendStatus(200); }
      const keys = await redisKeys();
      const installIds = new Set();
      for (const k of keys) { const lic = await redisGet(k); if (lic?.installId) installIds.add(lic.installId); }
      let enviados = 0;
      for (const iid of installIds) {
        await sendTelegramMessage(OWNER_ID, `📢 ${pending.text}`);
        enviados++;
      }
      await redisDel('ASHEO_BROADCAST_PENDING');
      await logAcao('BROADCAST', { enviados });
      await answerCallbackQuery(cb.id, `📢 ${enviados}`);
      await sendTelegramMessage(chatId, `📢 Broadcast enviado para *${enviados}* dispositivos.`);
    }
    if (data === 'broadcast_cancel') {
      await redisDel('ASHEO_BROADCAST_PENDING');
      await answerCallbackQuery(cb.id, '❌ Cancelado');
      await sendTelegramMessage(chatId, `❌ Broadcast cancelado.`);
    }

    // ==== LOGS ====
    if (data === 'logs') {
      const logs = await redisGet('ASHEO_LOG') || [];
      let msg = `📜 *ÚLTIMAS AÇÕES*\n\n`;
      for (const l of logs.slice(-15).reverse()) {
        msg += `• \`${l.acao}\` — ${fmtDate(l.at)}\n`;
      }
      await answerCallbackQuery(cb.id, '📜');
      await sendTelegramMessage(chatId, msg);
    }

    return res.sendStatus(200);
  }

  // ============ MENSAGENS DE TEXTO ============
  if (!update.message || !update.message.text) return res.sendStatus(200);
  const chatId = update.message.chat.id;
  const args = update.message.text.trim().replace(/\n/g, ' ').split(' ').filter(a => a.length > 0);
  const cmd = args[0].toLowerCase();

  if (String(chatId) !== String(OWNER_ID)) {
    await sendTelegramMessage(chatId, '⛔ Sem permissão.');
    return res.sendStatus(200);
  }

  try {
    // ============ BOAS VINDAS ============
    if (cmd === '/start') {
      await logAcao('START', {});
      await sendTelegramMessage(chatId, WELCOME_TEXT);
    }

    // ============ GERAR ============
    else if (cmd === '/gerar') {
      const keyboard = { inline_keyboard: [
        [{ text: '3 Dias — R$ 2,99',   callback_data: 'buy_3d'  }, { text: '7 Dias — R$ 4,99',   callback_data: 'buy_7d'  }],
        [{ text: '15 Dias — R$ 7,99',  callback_data: 'buy_15d' }, { text: '30 Dias — R$ 12,99', callback_data: 'buy_30d' }],
        [{ text: '90 Dias — R$ 29,99', callback_data: 'buy_90d' }, { text: '1 Ano — R$ 79,99',   callback_data: 'buy_365d'}],
        [{ text: '💎 ILIMITADO — R$ 149,99', callback_data: 'buy_ltd' }],
        [{ text: '🔙 Voltar', callback_data: 'back' }]
      ]};
      await sendTelegramMessage(chatId,
        `╔══════════════════════════════╗\n║   💰 *TABELA DE PREÇOS*        ║\n╚══════════════════════════════╝\n\nEscolha um plano:`,
        keyboard
      );
    }

    // ============ TRIAL ============
    else if (cmd === '/trial') {
      const licenseKey = generateLicenseKey();
      const lic = { plan: 'premium', days: 7, price: 0, originalPrice: 4.99, label: 'Trial 7 Dias', createdAt: Date.now(), active: true, installId: null, trial: true };
      await redisSet(licenseKey, lic);
      await logAcao('TRIAL', { key: licenseKey });
      await sendTelegramMessage(chatId, `🎁 *Trial 7 dias gerado:*\n\`${licenseKey}\``);
    }

    // ============ CUPOM PERCENT ============
    else if (cmd === '/cupom_pct') {
      const [, code, val, maxU] = args;
      if (!code || !val) { await sendTelegramMessage(chatId, '⚠️ /cupom_pct <código> <desconto%> [max_usos]'); return res.sendStatus(200); }
      const coupons = await redisGet('ASHEO_COUPONS') || {};
      coupons[code.toUpperCase()] = { tipo: 'percent', valor: parseFloat(val), maxUsos: maxU ? parseInt(maxU) : null, usos: 0, createdAt: Date.now() };
      await redisSet('ASHEO_COUPONS', coupons);
      await logAcao('CUPOM_CRIAR', { code, tipo: 'percent', valor: val });
      await sendTelegramMessage(chatId, `✅ Cupom *${code.toUpperCase()}* criado: ${val}% off`);
    }

    // ============ CUPOM FIXO ============
    else if (cmd === '/cupom_fix') {
      const [, code, val, maxU] = args;
      if (!code || !val) { await sendTelegramMessage(chatId, '⚠️ /cupom_fix <código> <desconto> [max_usos]'); return res.sendStatus(200); }
      const coupons = await redisGet('ASHEO_COUPONS') || {};
      coupons[code.toUpperCase()] = { tipo: 'fixed', valor: parseFloat(val), maxUsos: maxU ? parseInt(maxU) : null, usos: 0, createdAt: Date.now() };
      await redisSet('ASHEO_COUPONS', coupons);
      await logAcao('CUPOM_CRIAR', { code, tipo: 'fixed', valor: val });
      await sendTelegramMessage(chatId, `✅ Cupom *${code.toUpperCase()}* criado: R$ ${parseFloat(val).toFixed(2)} off`);
    }

    // ============ LISTAR CUPONS ============
    else if (cmd === '/cupons' || cmd === '/cupom_list') {
      const coupons = await redisGet('ASHEO_COUPONS') || {};
      const keys = Object.keys(coupons);
      let msg = `🎟️ *CUPONS* (${keys.length})\n\n`;
      if (!keys.length) msg += `_Nenhum._`;
      else for (const c of keys) {
        const cup = coupons[c];
        msg += `*${c}* — ${cup.tipo === 'percent' ? cup.valor + '%' : 'R$ ' + cup.valor.toFixed(2)} off`;
        msg += ` • ${cup.usos || 0}/${cup.maxUsos || '∞'}\n`;
      }
      await sendTelegramMessage(chatId, msg, { inline_keyboard: [
        [{ text: '➕ Novo cupom', callback_data: 'coupon_new' }],
        [{ text: '🔙 Menu', callback_data: 'back' }]
      ]});
    }

    // ============ EXCLUIR CUPOM ============
    else if (cmd === '/cupom_del') {
      const code = args[1]?.toUpperCase();
      if (!code) { await sendTelegramMessage(chatId, '⚠️ /cupom_del <código>'); return res.sendStatus(200); }
      const coupons = await redisGet('ASHEO_COUPONS') || {};
      delete coupons[code];
      await redisSet('ASHEO_COUPONS', coupons);
      await sendTelegramMessage(chatId, `🗑️ Cupom *${code}* excluído.`);
    }

    // ============ USAR CUPOM ============
    else if (cmd === '/usar_cupom') {
      const [, code, planKey] = args;
      const plan = PRICES[planKey];
      if (!plan) { await sendTelegramMessage(chatId, '⚠️ /usar_cupom <código> <plano>'); return res.sendStatus(200); }
      const coupons = await redisGet('ASHEO_COUPONS') || {};
      const cupom = coupons[code.toUpperCase()];
      if (!cupom) { await sendTelegramMessage(chatId, '❌ Cupom inválido.'); return res.sendStatus(200); }
      if (cupom.maxUsos && cupom.usos >= cupom.maxUsos) { await sendTelegramMessage(chatId, '❌ Cupom esgotado.'); return res.sendStatus(200); }
      const { preco, desconto } = aplicarCupom(plan.preco, cupom);
      const licenseKey = generateLicenseKey();
      const lic = {
        plan: 'premium', days: plan.dias, price: preco, originalPrice: plan.preco, label: plan.label,
        cupom: code.toUpperCase(), desconto, createdAt: Date.now(), active: true, installId: null
      };
      await redisSet(licenseKey, lic);
      cupom.usos = (cupom.usos || 0) + 1;
      await redisSet('ASHEO_COUPONS', coupons);
      await registrarVenda(licenseKey, lic, code.toUpperCase());
      await logAcao('VENDA_CUPOM', { key: licenseKey, cupom: code, desconto });
      await sendTelegramMessage(chatId,
        `🎟️ *VENDA COM CUPOM*\n\n` +
        `🔑 \`${licenseKey}\`\n` +
        `📦 ${plan.label}\n` +
        `💰 Original: ~~R$ ${plan.preco.toFixed(2)}~~\n` +
        `🎟️ Cupom: ${code.toUpperCase()} (-R$ ${desconto.toFixed(2)})\n` +
        `💵 *Total: R$ ${preco.toFixed(2)}*`
      );
    }

    // ============ BROADCAST ============
    else if (cmd === '/broadcast') {
      const text = args.slice(1).join(' ');
      if (!text) { await sendTelegramMessage(chatId, '⚠️ /broadcast <mensagem>'); return res.sendStatus(200); }
      await redisSet('ASHEO_BROADCAST_PENDING', { text, at: Date.now() });
      const keys = await redisKeys();
      const installIds = new Set();
      for (const k of keys) { const lic = await redisGet(k); if (lic?.installId) installIds.add(lic.installId); }
      await sendTelegramMessage(chatId,
        `📢 *CONFIRMAR BROADCAST*\n\n"${text}"\n\n*Destinatários:* ${installIds.size} dispositivos`,
        { inline_keyboard: [
          [{ text: '✅ ENVIAR', callback_data: 'broadcast_confirm' }],
          [{ text: '❌ Cancelar', callback_data: 'broadcast_cancel' }]
        ]}
      );
    }

    // ============ EXCLUIR TUDO ============
    else if (cmd === '/excluirtudo') {
      const keys = await redisKeys();
      await sendTelegramMessage(chatId,
        `🚨 *ATENÇÃO*\n\nVai excluir *${keys.length} licenças* permanentemente.\n*Não pode ser desfeito!*`,
        { inline_keyboard: [
          [{ text: '⚠️ SIM, EXCLUIR TUDO', callback_data: 'delall_confirm' }],
          [{ text: '❌ Cancelar', callback_data: 'back' }]
        ]}
      );
    }

    // ============ LOGS ============
    else if (cmd === '/logs') {
      const logs = await redisGet('ASHEO_LOG') || [];
      let msg = `📜 *LOGS* (${logs.length})\n\n`;
      for (const l of logs.slice(-20).reverse()) msg += `• \`${l.acao}\` — ${fmtDate(l.at)}\n`;
      await sendTelegramMessage(chatId, msg);
    }

    // ============ HELP ============
    else if (cmd === '/ajuda' || cmd === '/help') {
      await sendTelegramMessage(chatId, buildHelp());
    }

    else {
      await sendTelegramMessage(chatId, '❓ Use /ajuda');
    }
  } catch (err) {
    console.error('Erro:', err);
    await sendTelegramMessage(chatId, '❌ Erro interno.');
  }
  res.sendStatus(200);
});

// ============================================================
//  HELP
// ============================================================
function buildHelp() {
  return `╔══════════════════════════════╗\n║   📚 *COMANDOS*                ║\n╚══════════════════════════════╝\n\n` +
    `🎫 *LICENÇAS*\n` +
    `/gerar — Tabela + gerar\n` +
    `/trial — Trial 7 dias grátis\n` +
    `/activate <id> <chave> — Vincular\n` +
    `/desvincular <chave>\n` +
    `/reset <chave>\n` +
    `/status <chave>\n` +
    `/revogar <chave>\n` +
    `/listar\n` +
    `/excluir <chave>\n` +
    `/excluirtudo\n\n` +
    `🎟️ *CUPONS*\n` +
    `/cupom_pct <código> <%> [max]\n` +
    `/cupom_fix <código> <R$> [max]\n` +
    `/cupons — Listar\n` +
    `/cupom_del <código>\n` +
    `/usar_cupom <código> <plano>\n\n` +
    `📢 *GESTÃO*\n` +
    `/broadcast <msg> — Massiva\n` +
    `/estatisticas\n` +
    `/avisos\n` +
    `/logs — Auditoria\n` +
    `/backup\n\n` +
    `🔗 Dashboard: /dashboard`;
}

// ============================================================
//  CRON — Aviso automático
// ============================================================
setInterval(async () => {
  try {
    const keys = await redisKeys();
    let avisos = [];
    for (const k of keys) {
      const lic = await redisGet(k);
      if (!lic || !lic.active || isExpired(lic) || lic.days === 3650) continue;
      const d = diasRestantes(lic);
      if ([7, 3, 1, 0].includes(d)) avisos.push({ key: k, lic, dias: d });
    }
    if (avisos.length && OWNER_ID) {
      let msg = `🚨 *AVISO AUTOMÁTICO*\n\n`;
      for (const a of avisos) msg += `${statusEmoji(a.lic)} \`${a.key}\` — *${a.dias}d*\n`;
      await sendTelegramMessage(OWNER_ID, msg);
    }
  } catch (e) {}
}, 6 * 60 * 60 * 1000);

// ============================================================
//  START
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
