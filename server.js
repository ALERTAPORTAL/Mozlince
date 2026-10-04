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

const PRICES = {
  '3d':   { dias: 3,    preco: 2.99,   label: '3 Dias' },
  '7d':   { dias: 7,    preco: 4.99,   label: '7 Dias' },
  '15d':  { dias: 15,   preco: 7.99,   label: '15 Dias' },
  '30d':  { dias: 30,   preco: 12.99,  label: '30 Dias' },
  '90d':  { dias: 90,   preco: 29.99,  label: '90 Dias' },
  '365d': { dias: 365,  preco: 79.99,  label: '1 Ano' },
  'ltd':  { dias: 3650, preco: 149.99, label: 'Ilimitado' }
};

function loadKeyFromFile(filePath, envVal, label) {
  if (fs.existsSync(filePath)) {
    try { const c = fs.readFileSync(filePath, 'utf8'); console.log('OK ' + label + ' -> ' + filePath); return c; }
    catch (e) { console.error('ERR ' + label + ':', e.message); }
  }
  if (envVal) {
    let v = envVal.trim();
    if (!v.includes('BEGIN')) { try { v = Buffer.from(v, 'base64').toString('utf8'); } catch (e) {} }
    else { v = v.replace(/\\n/g, '\n'); }
    console.log('OK ' + label + ' -> env');
    return v;
  }
  console.error('MISSING ' + label);
  return null;
}

const privateKey = loadKeyFromFile('/etc/secrets/private.pem', process.env.EC_PRIVATE_KEY, 'EC_PRIVATE_KEY');
const publicKey  = loadKeyFromFile('/etc/secrets/public.pem',  process.env.EC_PUBLIC_KEY,  'EC_PUBLIC_KEY');

console.log('========== BOOT ==========');
console.log('privateKey?', !!privateKey);
if (privateKey) { try { crypto.createPrivateKey(privateKey); console.log('OK privateKey VALIDA'); } catch (e) { console.error('ERR privateKey:', e.message); } }
console.log('==========================');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

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
    method: 'POST', headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
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

function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = () => { let s = ''; for (let i = 0; i < 4; i++) s += chars[crypto.randomInt(0, chars.length)]; return s; };
  return `ASHEO-${b()}-${b()}-${b()}-${b()}`;
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

async function tgSend(token, chatId, text, keyboard = null) {
  const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (keyboard) body.reply_markup = keyboard;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  } catch (e) {}
}
async function tgAnswer(token, id, text) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: id, text })
    });
  } catch (e) {}
}
const sendAdmin = (chatId, text, kb) => tgSend(TELEGRAM_TOKEN, chatId, text, kb);

async function logAcao(acao, detalhes) {
  await redisPush('ASHEO_LOG', { acao, detalhes, at: Date.now() });
}

// ============================================================
//  JWT COM TODAS AS FEATURES
// ============================================================
function generateLicenseToken(installId, plan, days) {
  if (!privateKey) throw new Error('privateKey nao carregada');
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
//  HTTP
// ============================================================
app.get('/', (req, res) => res.json({ ok: true, ts: Date.now() }));
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
    res.json({ token, tier: lic.plan, seat: 1, seats: 1, gwPass: null, secret: 'segredo-' + installId, status: 'active', plan: lic.plan, days: lic.days });
  } catch (e) {
    console.error('[activate]', e);
    res.status(500).json({ error: 'internal' });
  }
});

app.post('/v1/deactivate', (req, res) => res.json({ ok: true }));

app.get('/dashboard', async (req, res) => {
  try {
    const keys = await redisKeys();
    const licencas = [];
    let ativas = 0, expiradas = 0, revogadas = 0, receita = 0;
    for (const k of keys) {
      const lic = await redisGet(k);
      if (!lic) continue;
      licencas.push({ key: k, ...lic, status: statusEmoji(lic), dias: diasRestantes(lic) });
      if (!lic.active) revogadas++;
      else if (isExpired(lic)) expiradas++;
      else ativas++;
      receita += lic.price || 0;
    }
    const sales = await redisGet('ASHEO_SALES') || [];
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Mozlince</title>
<style>body{background:#0a0a0f;color:#e0e0e0;padding:20px;font-family:sans-serif}h1{color:#f0b429}table{width:100%;border-collapse:collapse;background:#12121a;border-radius:10px}th,td{padding:12px;text-align:left;border-bottom:1px solid #222}th{background:#1a1a2e;color:#f0b429}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:15px;margin:20px 0}.card{background:#1a1a2e;padding:20px;border-radius:10px}.card .v{font-size:28px;color:#f0b429;font-weight:bold}.mono{font-family:monospace;font-size:12px}</style></head><body>
<h1>🎫 Mozlince Dashboard</h1>
<div class="cards">
<div class="card"><div>Total</div><div class="v">${licencas.length}</div></div>
<div class="card"><div>Ativas</div><div class="v">${ativas}</div></div>
<div class="card"><div>Expiradas</div><div class="v">${expiradas}</div></div>
<div class="card"><div>Revogadas</div><div class="v">${revogadas}</div></div>
<div class="card"><div>Receita</div><div class="v">R$ ${receita.toFixed(2)}</div></div>
</div>
<h2 style="color:#f0b429">Licenças</h2>
<table><thead><tr><th>Chave</th><th>Plano</th><th>Status</th><th>Dias</th><th>Install</th><th>Expira</th></tr></thead><tbody>
${licencas.map(l => `<tr><td class="mono">${l.key}</td><td>${l.label || l.days+'d'}</td><td>${l.status}</td><td>${l.dias>0?l.dias:'-'}</td><td class="mono">${(l.installId||'livre').slice(0,12)}</td><td class="mono">${fmtDate(expiraEm(l))}</td></tr>`).join('')}
</tbody></table></body></html>`);
  } catch (e) { res.status(500).send('Erro'); }
});

// ============================================================
//  WEBHOOK ADMIN — COM TODOS OS COMANDOS
// ============================================================
app.post('/telegram-webhook-admin', async (req, res) => {
  const update = req.body;
  const T = TELEGRAM_TOKEN;

  try {
    // ========== CALLBACKS ==========
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message.chat.id;
      const data = cb.data;
      if (String(chatId) !== String(OWNER_ID)) { await tgAnswer(T, cb.id, '⛔'); return res.sendStatus(200); }

      if (data.startsWith('buy_')) {
        const planKey = data.slice(4);
        const plan = PRICES[planKey];
        if (!plan) { await tgAnswer(T, cb.id, '❌'); return res.sendStatus(200); }
        const key = generateLicenseKey();
        const lic = { plan: 'premium', days: plan.dias, price: plan.preco, originalPrice: plan.preco, label: plan.label, createdAt: Date.now(), active: true, installId: null };
        await redisSet(key, lic);
        await redisPush('ASHEO_SALES', { key, plano: plan.label, preco: plan.preco, at: Date.now() });
        await tgAnswer(T, cb.id, `✅ ${plan.label}!`);
        await sendAdmin(chatId,
          `╔══════════════════════════════╗\n║   🔔 *NOVA LICENÇA*           ║\n╚══════════════════════════════╝\n\n🔑 \`${key}\`\n📦 ${plan.label}\n💰 R$ ${plan.preco.toFixed(2)}\n📅 ${plan.dias === 3650 ? 'Nunca' : fmtDate(Date.now() + plan.dias * 86400000)}\n🎯 🟢 Ativa`
        );
      }
      if (data.startsWith('info_')) {
        const key = data.slice(5);
        const lic = await redisGet(key);
        if (!lic) { await tgAnswer(T, cb.id, '❌'); return res.sendStatus(200); }
        const d = diasRestantes(lic);
        await tgAnswer(T, cb.id, '📋');
        await sendAdmin(chatId,
          `📋 *DETALHES*\n\n🔑 \`${key}\`\n${statusEmoji(lic)} ${statusTexto(lic)}\n👤 \`${lic.installId || 'livre'}\`\n📦 ${lic.label || lic.days + 'd'}\n💰 R$ ${(lic.price || 0).toFixed(2)}\n📅 ${fmtDate(lic.createdAt)}\n⏰ ${lic.days === 3650 ? 'Nunca' : fmtDate(expiraEm(lic))}\n${lic.days !== 3650 ? '⏳ ' + (d > 0 ? d + ' dias' : 'Expirada') : ''}`,
          { inline_keyboard: [[{ text: '🔓 Desvincular', callback_data: 'unbind_' + key }, { text: '♻️ Resetar', callback_data: 'reset_' + key }], [{ text: '🗑️ Excluir', callback_data: 'del_' + key }, { text: '🔙 Menu', callback_data: 'menu' }]] }
        );
      }
      if (data.startsWith('unbind_')) { const key = data.slice(7); const lic = await redisGet(key); if (lic) { lic.installId = null; await redisSet(key, lic); await tgAnswer(T, cb.id, '🔓'); await sendAdmin(chatId, `🔓 \`${key}\` desvinculada.`); } }
      if (data.startsWith('reset_')) { const key = data.slice(6); const lic = await redisGet(key); if (lic) { lic.installId = null; lic.active = true; lic.createdAt = Date.now(); await redisSet(key, lic); await tgAnswer(T, cb.id, '♻️'); await sendAdmin(chatId, `♻️ \`${key}\` resetada.`); } }
      if (data.startsWith('del_')) { const key = data.slice(4); await redisDel(key); await tgAnswer(T, cb.id, '🗑️'); await sendAdmin(chatId, `🗑️ \`${key}\` excluída.`); }
      if (data === 'delall_confirm') {
        const keys = await redisKeys();
        for (const k of keys) await redisDel(k);
        await tgAnswer(T, cb.id, `🗑️ ${keys.length}`);
        await sendAdmin(chatId, `🗑️ *${keys.length} licenças* excluídas.`);
      }
      if (data === 'menu' || data === 'back') { await tgAnswer(T, cb.id, '🏠'); await sendAdmin(chatId, buildMenu()); }
      if (data === 'stats') {
        const keys = await redisKeys();
        let a = 0, ex = 0, rv = 0, rec = 0;
        for (const k of keys) { const l = await redisGet(k); if (!l) continue; if (!l.active) rv++; else if (isExpired(l)) ex++; else a++; rec += l.price || 0; }
        await tgAnswer(T, cb.id, '📊');
        await sendAdmin(chatId, `📊 *ESTATÍSTICAS*\n\n📦 ${keys.length}\n🟢 ${a}\n⏰ ${ex}\n🔴 ${rv}\n💰 R$ ${rec.toFixed(2)}`);
      }
      return res.sendStatus(200);
    }

    // ========== COMANDOS ==========
    if (!update.message?.text) return res.sendStatus(200);
    const chatId = update.message.chat.id;
    const args = update.message.text.trim().replace(/\n/g, ' ').split(' ').filter(a => a.length > 0);
    const cmd = args[0].toLowerCase();

    if (String(chatId) !== String(OWNER_ID)) { await tgSend(T, chatId, '⛔'); return res.sendStatus(200); }

    // ========== /start ==========
    if (cmd === '/start') {
      await sendAdmin(chatId, buildMenu());
    }

    // ========== /gerar ==========
    else if (cmd === '/gerar') {
      const kb = { inline_keyboard: [
        [{ text: '3 Dias — R$ 2,99', callback_data: 'buy_3d' }, { text: '7 Dias — R$ 4,99', callback_data: 'buy_7d' }],
        [{ text: '15 Dias — R$ 7,99', callback_data: 'buy_15d' }, { text: '30 Dias — R$ 12,99', callback_data: 'buy_30d' }],
        [{ text: '90 Dias — R$ 29,99', callback_data: 'buy_90d' }, { text: '1 Ano — R$ 79,99', callback_data: 'buy_365d' }],
        [{ text: '💎 ILIMITADO — R$ 149,99', callback_data: 'buy_ltd' }],
        [{ text: '🔙 Voltar', callback_data: 'back' }]
      ]};
      await sendAdmin(chatId, '💰 *TABELA DE PREÇOS*\n\nEscolha um plano:', kb);
    }

    // ========== /trial ==========
    else if (cmd === '/trial') {
      const key = generateLicenseKey();
      await redisSet(key, { plan: 'premium', days: 7, price: 0, originalPrice: 4.99, label: 'Trial 7 Dias', createdAt: Date.now(), active: true, installId: null, trial: true });
      await sendAdmin(chatId, `🎁 *Trial 7 dias:*\n\`${key}\``);
    }

    // ========== /activate ==========
    else if (cmd === '/activate') {
      const licenseKey = args[args.length - 1];
      const installId = args.slice(1, args.length - 1).join(' ');
      if (!installId || !licenseKey) { await sendAdmin(chatId, '⚠️ Use: /activate <installId> <chave>'); return res.sendStatus(200); }
      const lic = await redisGet(licenseKey);
      if (!lic) { await sendAdmin(chatId, `❌ \`${licenseKey}\` não encontrada.`); return res.sendStatus(200); }
      if (lic.installId) { await sendAdmin(chatId, `⚠️ Já vinculada. Use /desvincular.`); return res.sendStatus(200); }
      lic.installId = installId;
      await redisSet(licenseKey, lic);
      await sendAdmin(chatId, `✅ \`${licenseKey}\` vinculada a \`${installId}\`.`);
    }

    // ========== /desvincular ==========
    else if (cmd === '/desvincular') {
      const key = args[1];
      if (!key) { await sendAdmin(chatId, '⚠️ Use: /desvincular <chave>'); return res.sendStatus(200); }
      const lic = await redisGet(key);
      if (!lic) { await sendAdmin(chatId, `❌ \`${key}\` não encontrada.`); return res.sendStatus(200); }
      lic.installId = null;
      await redisSet(key, lic);
      await sendAdmin(chatId, `🔓 \`${key}\` desvinculada.`);
    }

    // ========== /reset ==========
    else if (cmd === '/reset') {
      const key = args[1];
      if (!key) { await sendAdmin(chatId, '⚠️ Use: /reset <chave>'); return res.sendStatus(200); }
      const lic = await redisGet(key);
      if (!lic) { await sendAdmin(chatId, `❌ \`${key}\` não encontrada.`); return res.sendStatus(200); }
      lic.installId = null; lic.active = true; lic.createdAt = Date.now();
      await redisSet(key, lic);
      await sendAdmin(chatId, `♻️ \`${key}\` resetada.`);
    }

    // ========== /status e /info ==========
    else if (cmd === '/status' || cmd === '/info') {
      const key = args[1];
      if (!key) { await sendAdmin(chatId, '⚠️ Use: /status <chave>'); return res.sendStatus(200); }
      const lic = await redisGet(key);
      if (!lic) { await sendAdmin(chatId, `❌ \`${key}\` não encontrada.`); return res.sendStatus(200); }
      const d = diasRestantes(lic);
      await sendAdmin(chatId,
        `📋 *DETALHES*\n\n🔑 \`${key}\`\n${statusEmoji(lic)} ${statusTexto(lic)}\n👤 \`${lic.installId || 'livre'}\`\n📦 ${lic.label || lic.days + 'd'}\n💰 R$ ${(lic.price || 0).toFixed(2)}\n📅 ${fmtDate(lic.createdAt)}\n⏰ ${lic.days === 3650 ? 'Nunca' : fmtDate(expiraEm(lic))}\n${lic.days !== 3650 ? '⏳ ' + (d > 0 ? d + ' dias' : 'Expirada') : ''}`
      );
    }

    // ========== /revogar ==========
    else if (cmd === '/revogar') {
      const key = args[1];
      if (!key) { await sendAdmin(chatId, '⚠️ Use: /revogar <chave>'); return res.sendStatus(200); }
      const lic = await redisGet(key);
      if (!lic) { await sendAdmin(chatId, `❌ \`${key}\` não encontrada.`); return res.sendStatus(200); }
      lic.active = false;
      await redisSet(key, lic);
      await sendAdmin(chatId, `🔴 \`${key}\` revogada.`);
    }

    // ========== /listar ==========
    else if (cmd === '/listar') {
      const keys = await redisKeys();
      if (!keys.length) { await sendAdmin(chatId, '📭 Nenhuma licença.'); return res.sendStatus(200); }
      let msg = `📋 *LICENÇAS* (${keys.length})\n\n`;
      let cont = 0;
      for (const k of keys) {
        const lic = await redisGet(k);
        if (!lic) continue;
        const d = diasRestantes(lic);
        msg += `${statusEmoji(lic)} \`${k}\` — ${lic.label || lic.days + 'd'} — ${lic.installId ? '👤' : '🔓'}`;
        if (lic.days !== 3650 && lic.active && !isExpired(lic)) msg += ` — ${d}d`;
        msg += `\n`;
        cont++;
        if (cont % 15 === 0) { await sendAdmin(chatId, msg); msg = ''; }
      }
      if (msg) await sendAdmin(chatId, msg);
    }

    // ========== /excluir ==========
    else if (cmd === '/excluir') {
      const key = args[1];
      if (!key) { await sendAdmin(chatId, '⚠️ Use: /excluir <chave>'); return res.sendStatus(200); }
      await redisDel(key);
      await sendAdmin(chatId, `🗑️ \`${key}\` excluída.`);
    }

    // ========== /excluirtudo ==========
    else if (cmd === '/excluirtudo') {
      const keys = await redisKeys();
      await sendAdmin(chatId,
        `🚨 *ATENÇÃO*\n\nVai excluir *${keys.length} licenças* permanentemente.`,
        { inline_keyboard: [[{ text: '⚠️ SIM, EXCLUIR TUDO', callback_data: 'delall_confirm' }], [{ text: '❌ Cancelar', callback_data: 'back' }]] }
      );
    }

    // ========== /cupom_pct e /cupom_fix ==========
    else if (cmd === '/cupom_pct' || cmd === '/cupom_fix') {
      const [, code, val, maxU] = args;
      if (!code || !val) { await sendAdmin(chatId, `⚠️ Use: ${cmd} <código> <valor> [max]`); return res.sendStatus(200); }
      const coupons = await redisGet('ASHEO_COUPONS') || {};
      coupons[code.toUpperCase()] = {
        tipo: cmd === '/cupom_pct' ? 'percent' : 'fixed',
        valor: parseFloat(val),
        maxUsos: maxU ? parseInt(maxU) : null,
        usos: 0, createdAt: Date.now()
      };
      await redisSet('ASHEO_COUPONS', coupons);
      await sendAdmin(chatId, `✅ Cupom *${code.toUpperCase()}* criado.`);
    }

    // ========== /cupons ==========
    else if (cmd === '/cupons') {
      const coupons = await redisGet('ASHEO_COUPONS') || {};
      const ks = Object.keys(coupons);
      let msg = `🎟️ *CUPONS* (${ks.length})\n\n`;
      if (!ks.length) msg += '_Nenhum._';
      else for (const c of ks) { const cp = coupons[c]; msg += `*${c}* — ${cp.tipo === 'percent' ? cp.valor + '%' : 'R$ ' + cp.valor.toFixed(2)} — ${cp.usos || 0}/${cp.maxUsos || '∞'}\n`; }
      await sendAdmin(chatId, msg);
    }

    // ========== /cupom_del ==========
    else if (cmd === '/cupom_del') {
      const code = args[1]?.toUpperCase();
      if (!code) { await sendAdmin(chatId, '⚠️ Use: /cupom_del <código>'); return res.sendStatus(200); }
      const coupons = await redisGet('ASHEO_COUPONS') || {};
      delete coupons[code];
      await redisSet('ASHEO_COUPONS', coupons);
      await sendAdmin(chatId, `🗑️ Cupom *${code}* excluído.`);
    }

    // ========== /broadcast ==========
    else if (cmd === '/broadcast') {
      const text = args.slice(1).join(' ');
      if (!text) { await sendAdmin(chatId, '⚠️ Use: /broadcast <mensagem>'); return res.sendStatus(200); }
      await redisSet('ASHEO_BROADCAST_PENDING', { text, at: Date.now() });
      await sendAdmin(chatId, `📢 *Broadcast*\n\n"${text}"`, {
        inline_keyboard: [[{ text: '✅ ENVIAR', callback_data: 'broadcast_confirm' }], [{ text: '❌ Cancelar', callback_data: 'back' }]]
      });
    }

    // ========== /logs ==========
    else if (cmd === '/logs') {
      const logs = await redisGet('ASHEO_LOG') || [];
      let msg = `📜 *LOGS* (${logs.length})\n\n`;
      for (const l of logs.slice(-15).reverse()) msg += `• \`${l.acao}\` — ${fmtDate(l.at)}\n`;
      await sendAdmin(chatId, msg);
    }

    // ========== /estatisticas ==========
    else if (cmd === '/estatisticas' || cmd === '/stats') {
      const keys = await redisKeys();
      let a = 0, ex = 0, rv = 0, vin = 0, rec = 0;
      for (const k of keys) { const l = await redisGet(k); if (!l) continue; if (!l.active) rv++; else if (isExpired(l)) ex++; else a++; if (l.installId) vin++; rec += l.price || 0; }
      await sendAdmin(chatId, `📊 *ESTATÍSTICAS*\n\n📦 Total: ${keys.length}\n🟢 Ativas: ${a}\n⏰ Expiradas: ${ex}\n🔴 Revogadas: ${rv}\n👤 Vinculadas: ${vin}\n💰 R$ ${rec.toFixed(2)}`);
    }

    // ========== /avisos ==========
    else if (cmd === '/avisos') {
      const keys = await redisKeys();
      let crit = [];
      for (const k of keys) { const l = await redisGet(k); if (!l || !l.active || isExpired(l) || l.days === 3650) continue; const d = diasRestantes(l); if (d <= 7) crit.push({ k, d }); }
      crit.sort((a, b) => a.d - b.d);
      let msg = `🚨 *AVISOS*\n\n`;
      if (!crit.length) msg += '✅ Nenhuma expirando.';
      else for (const c of crit) msg += `⚠️ \`${c.k}\` — ${c.d}d\n`;
      await sendAdmin(chatId, msg);
    }

    // ========== /backup ==========
    else if (cmd === '/backup') {
      const keys = await redisKeys();
      const d = {};
      for (const k of keys) d[k] = await redisGet(k);
      const json = JSON.stringify(d, null, 2);
      await sendAdmin(chatId, `📦 *Backup* (${keys.length} licenças)`);
      try {
        const fd = new FormData();
        fd.append('chat_id', chatId);
        fd.append('document', new Blob([json], { type: 'application/json' }), `backup-${Date.now()}.json`);
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, { method: 'POST', body: fd });
      } catch (e) { await sendAdmin(chatId, '❌ Erro no arquivo.'); }
    }

    // ========== /ajuda ==========
    else if (cmd === '/ajuda' || cmd === '/help') {
      await sendAdmin(chatId, buildHelp());
    }

    else {
      await sendAdmin(chatId, '❓ Use /ajuda');
    }
  } catch (err) {
    console.error('Erro webhook:', err);
  }
  res.sendStatus(200);
});

function buildMenu() {
  return `╔══════════════════════════════╗\n║   👑 *PAINEL ADMIN*            ║\n╚══════════════════════════════╝\n\n👋 Bem-vindo!\n\n📌 Ações rápidas:\n• /gerar — Tabela + gerar\n• /listar — Ver licenças\n• /estatisticas — Visão geral\n• /ajuda — Todos os comandos`;
}

function buildHelp() {
  return `📚 *COMANDOS*\n\n🎫 *LICENÇAS*\n/gerar — Tabela + gerar\n/trial — Trial grátis\n/activate <id> <chave>\n/desvincular <chave>\n/reset <chave>\n/status <chave>\n/info <chave>\n/revogar <chave>\n/listar\n/excluir <chave>\n/excluirtudo\n\n🎟️ *CUPONS*\n/cupom_pct <código> <%> [max]\n/cupom_fix <código> <R$> [max]\n/cupons\n/cupom_del <código>\n\n📢 *GESTÃO*\n/broadcast <msg>\n/estatisticas\n/avisos\n/logs\n/backup\n\n🔗 Dashboard: /dashboard`;
}

app.listen(process.env.PORT || 3000, () => console.log('🚀 Servidor na porta ' + (process.env.PORT || 3000)));
