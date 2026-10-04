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
  if (fs.existsSync(filePath)) { try { const c = fs.readFileSync(filePath, 'utf8'); console.log('OK ' + label); return c; } catch (e) { console.error(e.message); } }
  if (envVal) { let v = envVal.trim(); if (!v.includes('BEGIN')) { try { v = Buffer.from(v, 'base64').toString('utf8'); } catch (e) {} } else { v = v.replace(/\\n/g, '\n'); } return v; }
  console.error('MISSING ' + label); return null;
}

const privateKey = loadKeyFromFile('/etc/secrets/private.pem', process.env.EC_PRIVATE_KEY, 'EC_PRIVATE_KEY');
const publicKey  = loadKeyFromFile('/etc/secrets/public.pem',  process.env.EC_PUBLIC_KEY,  'EC_PUBLIC_KEY');
console.log('========== BOOT ==========');
console.log('privateKey?', !!privateKey);
if (privateKey) { try { crypto.createPrivateKey(privateKey); console.log('OK privateKey VALIDA'); } catch (e) { console.error('ERR:', e.message); } }
console.log('==========================');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisSet(key, value) { return (await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}`, { method: 'POST', headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' }, body: typeof value === 'string' ? value : JSON.stringify(value) })).json(); }
async function redisGet(key) { const d = await (await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } })).json(); if (!d.result) return null; try { return JSON.parse(d.result); } catch { return d.result; } }
async function redisDel(key) { return (await fetch(`${UPSTASH_URL}/del/${encodeURIComponent(key)}`, { method: 'POST', headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } })).json(); }
async function redisKeys(pattern = 'ASHEO-*') { const d = await (await fetch(`${UPSTASH_URL}/keys/${pattern}`, { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } })).json(); return d.result || []; }
async function redisPush(key, value) { const a = await redisGet(key) || []; a.push(value); if (a.length > 500) a.splice(0, a.length - 500); await redisSet(key, a); return a; }

function generateLicenseKey() { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const b = () => { let s = ''; for (let i = 0; i < 4; i++) s += c[crypto.randomInt(0, c.length)]; return s; }; return `ASHEO-${b()}-${b()}-${b()}-${b()}`; }
function fmtDate(ts) { const d = new Date(ts); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function diasRestantes(l) { if (!l.createdAt || !l.days) return 0; return Math.ceil((l.createdAt + l.days * 86400000 - Date.now()) / 86400000); }
function expiraEm(l) { return l.createdAt + l.days * 86400000; }
function isExpired(l) { return Date.now() > expiraEm(l); }
function statusEmoji(l) { if (!l.active) return '🔴'; if (isExpired(l)) return '⏰'; const d = diasRestantes(l); if (d <= 1) return '🚨'; if (d <= 3) return '⚠️'; if (d <= 7) return '🟡'; return '🟢'; }
function statusTexto(l) { if (!l.active) return 'Revogada'; if (isExpired(l)) return 'Expirada'; return 'Ativa'; }

async function tgSend(chatId, text, kb = null) {
  const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (kb) body.reply_markup = kb;
  try { await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); } catch (e) {}
}
async function tgAnswer(id, text) { try { await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: id, text }) }); } catch (e) {} }

function generateLicenseToken(installId, plan, days) {
  if (!privateKey) throw new Error('sem privateKey');
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    sub: installId, installId, status: 'active', plan, planDisplayName: plan === 'premium' ? 'Premium' : 'Free',
    active: true, tier: plan, kind: plan === 'premium' ? 'premium' : 'free',
    features: {
      browser_mods: true, browserMods: true, rule_ops_lab: true, ruleOpsLab: true,
      live_injection_hud: true, liveInjectionHud: true, advanced_protection: true, advancedProtection: true,
      api_access: true, apiAccess: true, experimental_features: true, experimentalFeatures: true,
      advanced_automation: true, advancedAutomation: true, multi_account: true, multiAccount: true,
      cloud_sync: true, cloudSync: true, priority_support: true, prioritySupport: true,
      custom_export: true, customExport: true
    },
    capabilities: {
      browser_mods: true, browserMods: true, rule_ops_lab: true, ruleOpsLab: true,
      live_injection_hud: true, liveInjectionHud: true, advanced_protection: true, advancedProtection: true,
      api_access: true, apiAccess: true, experimental_features: true, experimentalFeatures: true
    },
    secret: 'segredo-' + installId, iat: now, nbf: now - 5, exp: now + (days * 24 * 60 * 60)
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
  } catch (e) { console.error('[activate]', e); res.status(500).json({ error: 'internal' }); }
});

app.post('/v1/deactivate', (req, res) => res.json({ ok: true }));

app.get('/dashboard', async (req, res) => {
  try {
    const keys = await redisKeys();
    const ls = [];
    let a = 0, ex = 0, rv = 0, rec = 0;
    for (const k of keys) { const l = await redisGet(k); if (!l) continue; ls.push({ k, l }); if (!l.active) rv++; else if (isExpired(l)) ex++; else a++; rec += l.price || 0; }
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Mozlince</title><style>body{background:#0a0a0f;color:#e0e0e0;padding:20px;font-family:sans-serif}h1{color:#f0b429;margin-bottom:20px}table{width:100%;border-collapse:collapse;background:#12121a}th,td{padding:12px;text-align:left;border-bottom:1px solid #222}th{background:#1a1a2e;color:#f0b429}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:15px;margin:20px 0}.card{background:#1a1a2e;padding:20px;border-radius:10px}.card .v{font-size:28px;color:#f0b429;font-weight:bold}.mono{font-family:monospace;font-size:12px}</style></head><body><h1>🎫 Mozlince</h1><div class="cards"><div class="card"><div>Total</div><div class="v">${ls.length}</div></div><div class="card"><div>Ativas</div><div class="v">${a}</div></div><div class="card"><div>Expiradas</div><div class="v">${ex}</div></div><div class="card"><div>Revogadas</div><div class="v">${rv}</div></div><div class="card"><div>Receita</div><div class="v">R$ ${rec.toFixed(2)}</div></div></div><table><thead><tr><th>Chave</th><th>Plano</th><th>Status</th><th>Dias</th><th>Install</th><th>Expira</th></tr></thead><tbody>${ls.map(({k, l}) => `<tr><td class="mono">${k}</td><td>${l.label || l.days+'d'}</td><td>${statusEmoji(l)}</td><td>${diasRestantes(l) > 0 ? diasRestantes(l) : '-'}</td><td class="mono">${(l.installId||'livre').slice(0,12)}</td><td class="mono">${fmtDate(expiraEm(l))}</td></tr>`).join('')}</tbody></table></body></html>`);
  } catch (e) { res.status(500).send('Erro'); }
});

// ============================================================
//  WEBHOOK ÚNICO — Detecta admin vs cliente
// ============================================================
app.post('/telegram-webhook', async (req, res) => {
  const update = req.body;
  const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
  const isAdmin = String(chatId) === String(OWNER_ID);

  try {
    if (!chatId) return res.sendStatus(200);

    // ========== ADMIN ==========
    if (isAdmin) {
      // CALLBACKS ADMIN
      if (update.callback_query) {
        const cb = update.callback_query;
        const data = cb.data;

        if (data.startsWith('buy_')) {
          const plan = PRICES[data.slice(4)];
          if (!plan) { await tgAnswer(cb.id, '❌'); return res.sendStatus(200); }
          const key = generateLicenseKey();
          await redisSet(key, { plan: 'premium', days: plan.dias, price: plan.preco, originalPrice: plan.preco, label: plan.label, createdAt: Date.now(), active: true, installId: null });
          await redisPush('ASHEO_SALES', { key, plano: plan.label, preco: plan.preco, at: Date.now() });
          await tgAnswer(cb.id, `✅ ${plan.label}!`);
          await tgSend(chatId, `🔔 *NOVA LICENÇA*\n\n🔑 \`${key}\`\n📦 ${plan.label}\n💰 R$ ${plan.preco.toFixed(2)}\n📅 ${plan.dias === 3650 ? 'Nunca' : fmtDate(Date.now() + plan.dias * 86400000)}`);
        }
        if (data.startsWith('info_')) { const key = data.slice(5); const l = await redisGet(key); if (!l) { await tgAnswer(cb.id, '❌'); return res.sendStatus(200); } const d = diasRestantes(l); await tgAnswer(cb.id, '📋'); await tgSend(chatId, `📋 *DETALHES*\n\n🔑 \`${key}\`\n${statusEmoji(l)} ${statusTexto(l)}\n👤 \`${l.installId || 'livre'}\`\n📦 ${l.label || l.days + 'd'}\n💰 R$ ${(l.price || 0).toFixed(2)}\n📅 ${fmtDate(l.createdAt)}\n⏰ ${l.days === 3650 ? 'Nunca' : fmtDate(expiraEm(l))}`, { inline_keyboard: [[{ text: '🔓 Desvincular', callback_data: 'unbind_' + key }, { text: '♻️ Resetar', callback_data: 'reset_' + key }], [{ text: '🗑️ Excluir', callback_data: 'del_' + key }]] }); }
        if (data.startsWith('unbind_')) { const k = data.slice(7); const l = await redisGet(k); if (l) { l.installId = null; await redisSet(k, l); await tgAnswer(cb.id, '🔓'); await tgSend(chatId, `🔓 \`${k}\` desvinculada.`); } }
        if (data.startsWith('reset_')) { const k = data.slice(6); const l = await redisGet(k); if (l) { l.installId = null; l.active = true; l.createdAt = Date.now(); await redisSet(k, l); await tgAnswer(cb.id, '♻️'); await tgSend(chatId, `♻️ \`${k}\` resetada.`); } }
        if (data.startsWith('del_')) { const k = data.slice(4); await redisDel(k); await tgAnswer(cb.id, '🗑️'); await tgSend(chatId, `🗑️ \`${k}\` excluída.`); }
        if (data === 'delall_confirm') { const ks = await redisKeys(); for (const k of ks) await redisDel(k); await tgAnswer(cb.id, `🗑️ ${ks.length}`); await tgSend(chatId, `🗑️ *${ks.length} licenças* excluídas.`); }
        if (data === 'broadcast_confirm') { const p = await redisGet('ASHEO_BROADCAST_PENDING'); if (p) { await redisDel('ASHEO_BROADCAST_PENDING'); await tgAnswer(cb.id, '📢'); await tgSend(chatId, `📢 Broadcast: "${p.text}"`); } }
        if (data === 'menu' || data === 'back') { await tgAnswer(cb.id, '🏠'); await tgSend(chatId, buildAdminMenu()); }
        return res.sendStatus(200);
      }

      // COMANDOS ADMIN
      if (!update.message?.text) return res.sendStatus(200);
      const args = update.message.text.trim().replace(/\n/g, ' ').split(' ').filter(a => a.length > 0);
      const cmd = args[0].toLowerCase();

      if (cmd === '/start') await tgSend(chatId, buildAdminMenu());
      else if (cmd === '/gerar') await tgSend(chatId, '💰 *TABELA DE PREÇOS*\n\nEscolha:', { inline_keyboard: [[{ text: '3 Dias — R$ 2,99', callback_data: 'buy_3d' }, { text: '7 Dias — R$ 4,99', callback_data: 'buy_7d' }], [{ text: '15 Dias — R$ 7,99', callback_data: 'buy_15d' }, { text: '30 Dias — R$ 12,99', callback_data: 'buy_30d' }], [{ text: '90 Dias — R$ 29,99', callback_data: 'buy_90d' }, { text: '1 Ano — R$ 79,99', callback_data: 'buy_365d' }], [{ text: '💎 ILIMITADO — R$ 149,99', callback_data: 'buy_ltd' }]] });
      else if (cmd === '/trial') { const k = generateLicenseKey(); await redisSet(k, { plan: 'premium', days: 7, price: 0, label: 'Trial 7 Dias', createdAt: Date.now(), active: true, installId: null, trial: true }); await tgSend(chatId, `🎁 Trial: \`${k}\``); }
      else if (cmd === '/activate') { const k = args[args.length - 1], id = args.slice(1, args.length - 1).join(' '); if (!id || !k) { await tgSend(chatId, '⚠️ /activate <id> <chave>'); return res.sendStatus(200); } const l = await redisGet(k); if (!l) { await tgSend(chatId, '❌ Não encontrada.'); return res.sendStatus(200); } if (l.installId) { await tgSend(chatId, '⚠️ Já vinculada.'); return res.sendStatus(200); } l.installId = id; await redisSet(k, l); await tgSend(chatId, `✅ \`${k}\` → \`${id}\``); }
      else if (cmd === '/desvincular') { const k = args[1]; if (!k) { await tgSend(chatId, '⚠️ /desvincular <chave>'); return res.sendStatus(200); } const l = await redisGet(k); if (!l) { await tgSend(chatId, '❌ Não encontrada.'); return res.sendStatus(200); } l.installId = null; await redisSet(k, l); await tgSend(chatId, `🔓 \`${k}\` desvinculada.`); }
      else if (cmd === '/reset') { const k = args[1]; if (!k) { await tgSend(chatId, '⚠️ /reset <chave>'); return res.sendStatus(200); } const l = await redisGet(k); if (!l) { await tgSend(chatId, '❌ Não encontrada.'); return res.sendStatus(200); } l.installId = null; l.active = true; l.createdAt = Date.now(); await redisSet(k, l); await tgSend(chatId, `♻️ \`${k}\` resetada.`); }
      else if (cmd === '/status' || cmd === '/info') { const k = args[1]; if (!k) { await tgSend(chatId, '⚠️ /status <chave>'); return res.sendStatus(200); } const l = await redisGet(k); if (!l) { await tgSend(chatId, '❌ Não encontrada.'); return res.sendStatus(200); } const d = diasRestantes(l); await tgSend(chatId, `📋 \`${k}\`\n${statusEmoji(l)} ${statusTexto(l)}\n👤 \`${l.installId || 'livre'}\`\n📦 ${l.label || l.days + 'd'}\n📅 ${fmtDate(l.createdAt)}\n⏰ ${l.days === 3650 ? 'Nunca' : fmtDate(expiraEm(l))}\n⏳ ${d > 0 ? d + ' dias' : 'Expirada'}`); }
      else if (cmd === '/revogar') { const k = args[1]; if (!k) { await tgSend(chatId, '⚠️ /revogar <chave>'); return res.sendStatus(200); } const l = await redisGet(k); if (!l) { await tgSend(chatId, '❌'); return res.sendStatus(200); } l.active = false; await redisSet(k, l); await tgSend(chatId, `🔴 \`${k}\` revogada.`); }
      else if (cmd === '/listar') { const ks = await redisKeys(); if (!ks.length) { await tgSend(chatId, '📭 Nenhuma.'); return res.sendStatus(200); } let msg = `📋 *LICENÇAS* (${ks.length})\n\n`; for (const k of ks.slice(-30)) { const l = await redisGet(k); if (l) msg += `${statusEmoji(l)} \`${k}\` — ${l.label || l.days + 'd'} — ${l.installId ? '👤' : '🔓'}\n`; } await tgSend(chatId, msg); }
      else if (cmd === '/excluir') { const k = args[1]; if (!k) { await tgSend(chatId, '⚠️'); return res.sendStatus(200); } await redisDel(k); await tgSend(chatId, `🗑️ \`${k}\` excluída.`); }
      else if (cmd === '/excluirtudo') { const ks = await redisKeys(); await tgSend(chatId, `🚨 Excluir *${ks.length}*?`, { inline_keyboard: [[{ text: '⚠️ SIM', callback_data: 'delall_confirm' }, { text: '❌ Não', callback_data: 'back' }]] }); }
      else if (cmd === '/estatisticas' || cmd === '/stats') { const ks = await redisKeys(); let a = 0, ex = 0, rv = 0, rec = 0; for (const k of ks) { const l = await redisGet(k); if (!l) continue; if (!l.active) rv++; else if (isExpired(l)) ex++; else a++; rec += l.price || 0; } await tgSend(chatId, `📊 *STATS*\n\n📦 ${ks.length}\n🟢 ${a}\n⏰ ${ex}\n🔴 ${rv}\n💰 R$ ${rec.toFixed(2)}`); }
      else if (cmd === '/avisos') { const ks = await redisKeys(); let c = []; for (const k of ks) { const l = await redisGet(k); if (!l || !l.active || isExpired(l) || l.days === 3650) continue; const d = diasRestantes(l); if (d <= 7) c.push({ k, d }); } c.sort((a, b) => a.d - b.d); let msg = `🚨 *AVISOS*\n\n`; if (!c.length) msg += '✅ Nenhuma.'; else for (const x of c) msg += `⚠️ \`${x.k}\` — ${x.d}d\n`; await tgSend(chatId, msg); }
      else if (cmd === '/broadcast') { const t = args.slice(1).join(' '); if (!t) { await tgSend(chatId, '⚠️ /broadcast <msg>'); return res.sendStatus(200); } await redisSet('ASHEO_BROADCAST_PENDING', { text: t }); await tgSend(chatId, `📢 Broadcast: "${t}"`, { inline_keyboard: [[{ text: '✅ Enviar', callback_data: 'broadcast_confirm' }, { text: '❌', callback_data: 'back' }]] }); }
      else if (cmd === '/logs') { const lg = await redisGet('ASHEO_LOG') || []; let msg = `📜 *LOGS* (${lg.length})\n\n`; for (const x of lg.slice(-15).reverse()) msg += `• \`${x.acao}\` — ${fmtDate(x.at)}\n`; await tgSend(chatId, msg); }
      else if (cmd === '/ajuda' || cmd === '/help') await tgSend(chatId, buildAdminHelp());
      else await tgSend(chatId, '❓ Use /ajuda');
      return res.sendStatus(200);
    }

    // ========== CLIENTE ==========
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data;

      if (data === 'client_planos') {
        await tgAnswer(cb.id, '💎');
        let msg = `💎 *NOSSOS PLANOS*\n\n`;
        for (const [k, p] of Object.entries(PRICES)) msg += `⭐ *${p.label}* — R$ ${p.preco.toFixed(2)}\n`;
        const kb = { inline_keyboard: [] };
        const entries = Object.entries(PRICES);
        for (let i = 0; i < entries.length; i += 2) {
          const row = [{ text: `${entries[i][1].label} — R$ ${entries[i][1].preco.toFixed(2)}`, callback_data: `client_buy_${entries[i][0]}` }];
          if (entries[i+1]) row.push({ text: `${entries[i+1][1].label}`, callback_data: `client_buy_${entries[i+1][0]}` });
          kb.inline_keyboard.push(row);
        }
        kb.inline_keyboard.push([{ text: '🔙 Voltar', callback_data: 'client_menu' }]);
        await tgSend(chatId, msg, kb);
      }

      if (data.startsWith('client_buy_')) {
        const planKey = data.slice(11);
        const plan = PRICES[planKey];
        if (!plan) { await tgAnswer(cb.id, '❌'); return res.sendStatus(200); }
        const orderId = 'ORD-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const order = { orderId, telegramId: chatId, nome: cb.from?.first_name || 'Cliente', username: cb.from?.username || null, plano: planKey, planoLabel: plan.label, preco: plan.preco, dias: plan.dias, at: Date.now(), status: 'pending' };
        const orders = await redisGet('ASHEO_ORDERS') || [];
        orders.push(order);
        await redisSet('ASHEO_ORDERS', orders);
        await tgAnswer(cb.id, '✅');
        await tgSend(OWNER_ID, `🔔 *NOVO PEDIDO*\n\n🆔 \`${orderId}\`\n👤 ${order.nome}\n📱 ${order.username ? '@' + order.username : 'sem @'}\n🆔 \`${chatId}\`\n📦 ${plan.label}\n💰 R$ ${plan.preco.toFixed(2)}`);
        await tgSend(chatId, `✅ *Pedido ${orderId}*\n\n📦 ${plan.label}\n💰 R$ ${plan.preco.toFixed(2)}\n\n💳 *PIX:* \`pagamentos@mozlince.com\`\n\nEnvie o comprovante aqui.`, { inline_keyboard: [[{ text: '📤 Enviar Comprovante', callback_data: 'client_comprovante' }], [{ text: '💬 Suporte', callback_data: 'client_suporte' }]] });
      }

      if (data === 'client_comprovante') { await tgAnswer(cb.id, '📤'); await tgSend(chatId, `📤 Envie a *foto ou PDF* do comprovante aqui.`); }
      if (data === 'client_pedidos') { await tgAnswer(cb.id, '📋'); const os = await redisGet('ASHEO_ORDERS') || []; const meus = os.filter(o => String(o.telegramId) === String(chatId)); if (!meus.length) await tgSend(chatId, '📭 Sem pedidos.'); else { let m = `📋 *MEUS PEDIDOS*\n\n`; for (const o of meus.slice(-10).reverse()) { const st = o.status === 'pending' ? '⏳' : o.status === 'delivered' ? '✅' : '❌'; m += `${st} \`${o.orderId}\` — ${o.planoLabel}\n`; } await tgSend(chatId, m); } }
      if (data === 'client_suporte') { await tgAnswer(cb.id, '💬'); await redisSet(`ASHEO_USER_${chatId}_SUP`, { at: Date.now() }); await tgSend(chatId, `💬 *SUPORTE*\n\nDescreva sua dúvida.`); }
      if (data === 'client_menu') { await tgAnswer(cb.id, '🏠'); await tgSend(chatId, `🏠 *Menu*\n\nEscolha:`, { inline_keyboard: [[{ text: '💎 Ver Planos', callback_data: 'client_planos' }], [{ text: '🛒 Como Comprar', callback_data: 'client_comprar' }], [{ text: '💬 Suporte', callback_data: 'client_suporte' }], [{ text: '📋 Meus Pedidos', callback_data: 'client_pedidos' }]] }); }
      if (data === 'client_comprar') { await tgAnswer(cb.id, '🛒'); await tgSend(chatId, `🛒 *COMO COMPRAR*\n\n1️⃣ Escolha um plano\n2️⃣ Pague via PIX\n3️⃣ Envie o comprovante\n4️⃣ Receba a chave`, { inline_keyboard: [[{ text: '💎 Ver Planos', callback_data: 'client_planos' }]] }); }
      return res.sendStatus(200);
    }

    if (update.message?.text === '/start') {
      const firstName = update.message.from?.first_name || 'Cliente';
      await tgSend(chatId, `╔══════════════════════════════╗\n║  👋 *BEM-VINDO(A), ${firstName}!*  ║\n╚══════════════════════════════╝\n\n🎫 *Mozlince Premium*\n\nSou o assistente virtual. Como posso ajudar?\n\n💎 Ver planos e preços\n🛒 Comprar uma licença\n💬 Falar com suporte\n📋 Consultar pedidos`, { inline_keyboard: [[{ text: '💎 Ver Planos', callback_data: 'client_planos' }], [{ text: '🛒 Como Comprar', callback_data: 'client_comprar' }], [{ text: '💬 Suporte', callback_data: 'client_suporte' }], [{ text: '📋 Meus Pedidos', callback_data: 'client_pedidos' }]] });
      return res.sendStatus(200);
    }

    // Comprovante (foto/documento)
    if (update.message?.photo || update.message?.document) {
      const firstName = update.message.from?.first_name || 'Cliente';
      const username = update.message.from?.username || null;
      const fileId = update.message.photo ? update.message.photo[update.message.photo.length - 1].file_id : update.message.document.file_id;
      await tgSend(chatId, `✅ *Comprovante recebido!*\n\nAguarde a confirmação.`);
      await tgSend(OWNER_ID, `📤 *COMPROVANTE*\n\n👤 ${firstName}\n📱 ${username ? '@' + username : 'sem @'}\n🆔 \`${chatId}\``);
      return res.sendStatus(200);
    }

    // Suporte (texto)
    if (update.message?.text && !update.message.text.startsWith('/')) {
      const sup = await redisGet(`ASHEO_USER_${chatId}_SUP`);
      if (sup) {
        await redisDel(`ASHEO_USER_${chatId}_SUP`);
        await tgSend(chatId, `✅ Enviado! Em breve responderemos.`);
        await tgSend(OWNER_ID, `💬 *SUPORTE*\n\n👤 ${update.message.from?.first_name}\n🆔 \`${chatId}\`\n\n"${update.message.text}"`);
      } else {
        await tgSend(chatId, `❓ Use /start para ver o menu.`);
      }
      return res.sendStatus(200);
    }
  } catch (err) {
    console.error('webhook erro:', err);
  }
  res.sendStatus(200);
});

function buildAdminMenu() {
  return `╔══════════════════════════════╗\n║   👑 *PAINEL ADMIN*            ║\n╚══════════════════════════════╝\n\n👋 Bem-vindo!\n\n• /gerar — Tabela + gerar\n• /listar — Ver licenças\n• /estatisticas\n• /ajuda`;
}
function buildAdminHelp() {
  return `📚 *COMANDOS*\n\n🎫 *LICENÇAS*\n/gerar\n/trial\n/activate <id> <chave>\n/desvincular <chave>\n/reset <chave>\n/status <chave>\n/revogar <chave>\n/listar\n/excluir <chave>\n/excluirtudo\n\n📢 *GESTÃO*\n/broadcast <msg>\n/estatisticas\n/avisos\n/logs\n\n🔗 Dashboard: /dashboard`;
}

app.listen(process.env.PORT || 3000, () => console.log('🚀 Servidor na porta ' + (process.env.PORT || 3000)));
