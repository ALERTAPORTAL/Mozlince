require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');

const app = express();

// ═══════════════════════════════════════════════
// CORS
// ═══════════════════════════════════════════════
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Asheo-Install, X-Asheo-Ts, X-Asheo-Sig, X-Asheo-Build, X-Asheo-Nonce, Kty, Crv, X-Asheo-Signature, X-Asheo-Timestamp');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type, X-Asheo-*');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '2mb' }));

const C = { r:'\x1b[0m', b:'\x1b[1m', g:'\x1b[32m', y:'\x1b[33m', red:'\x1b[31m', c:'\x1b[36m', m:'\x1b[35m', bl:'\x1b[34m', gr:'\x1b[90m' };
function log(t, m) {
  const ts = new Date().toISOString().replace('T',' ').substring(0,19);
  const cores = { INFO:C.c, OK:C.g, WARN:C.y, ERRO:C.red, SYS:C.m, ATIV:C.bl, BOT:C.c, FEAT:'\x1b[35m', BOOT:'\x1b[36m', API:'\x1b[33m' };
  console.log(`${C.gr}[${ts}]${C.r} ${cores[t]||C.r}${C.b}[${t}]${C.r} ${m}`);
}

// ═══════════════════════════════════════════════
// CHAVES ES256
// ═══════════════════════════════════════════════
let PRIVATE_KEY = null, PUBLIC_KEY = null, ORIGEM = 'nenhuma';
(function initKeys() {
  const fp = ['/etc/secrets/private.pem','./private.pem','/etc/secrets/ec_private.pem'];
  const fu = ['/etc/secrets/public.pem','./public.pem','/etc/secrets/ec_public.pem'];
  for (const f of fp) { try { if (fs.existsSync(f)) { PRIVATE_KEY = fs.readFileSync(f,'utf8').trim(); ORIGEM='file:'+f; break; } } catch {} }
  for (const f of fu) { try { if (fs.existsSync(f)) { PUBLIC_KEY = fs.readFileSync(f,'utf8').trim(); break; } } catch {} }
  if (!PRIVATE_KEY) {
    let p = process.env.EC_PRIVATE_KEY || process.env.JWT_PRIVATE_KEY_PEM || '';
    if (p) {
      if (!p.includes('BEGIN')) { try { p = Buffer.from(p.trim(),'base64').toString('utf8'); } catch {} }
      PRIVATE_KEY = p.replace(/\\n/g,'\n').trim();
      ORIGEM = 'env';
    }
    let pu = process.env.EC_PUBLIC_KEY || '';
    if (pu) {
      if (!pu.includes('BEGIN')) { try { pu = Buffer.from(pu.trim(),'base64').toString('utf8'); } catch {} }
      PUBLIC_KEY = pu.replace(/\\n/g,'\n').trim();
    }
  }
  if (PRIVATE_KEY) {
    try {
      const k = crypto.createPrivateKey(PRIVATE_KEY);
      const jwk = crypto.createPublicKey(k).export({ format:'jwk' });
      log('OK', 'Chave privada OK');
      log('DBG', `X: ${jwk.x}`);
      log('DBG', `Y: ${jwk.y}`);
      if (jwk.x === 'aTAr_kSTrfocOkpAHlVSDc71E1pc5Pd5KgnE-ggBr_4' && jwk.y === 'GFrU897XAPvrxqcRhlwoAwpooKHl69-0YrBaJbfwAT4') {
        log('OK', '✅ Chave CORRESPONDE à extensão!');
      } else {
        log('ERRO', '❌ Chave NÃO corresponde à extensão');
      }
    } catch (e) { log('ERRO','Chave privada invalida: '+e.message); PRIVATE_KEY = null; }
  } else { log('ERRO','Nenhuma chave privada encontrada'); }
})();

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID;

// ═══════════════════════════════════════════════
// PREMIUM DEFINITIONS
// ═══════════════════════════════════════════════
const PREMIUM_FEATURES = {
  browser_mods:       { enabled: true, label: 'Browser Mods', description: 'Spoof fingerprint and rotate user-agent.' },
  rule_ops_lab:       { enabled: true, label: 'Rule Ops Lab', description: 'Bulk rule ops, presets, conflict scan.' },
  live_injection_hud: { enabled: true, label: 'Live Injection HUD', description: 'On-page overlay showing each card swap.' },
  algo_v2:            { enabled: true, label: 'Algo V2', description: 'Advanced algorithm v2.' },
  exclusive_rules:    { enabled: true, label: 'Exclusive Rules', description: 'Premium rules from server.' },
  advanced_automation:{ enabled: true, label: 'Advanced Automation' },
  multi_account:      { enabled: true, label: 'Multi Account' },
  custom_export:      { enabled: true, label: 'Custom Export' },
  api_access:         { enabled: true, label: 'API Access' }
};

const PREMIUM_CAPABILITIES = {
  priority_support:  { enabled: true, label: 'Priority Support' },
  custom_webhooks:   { enabled: true, label: 'Custom Webhooks' },
  cloud_sync:        { enabled: true, label: 'Cloud Sync' },
  bulk_actions:      { enabled: true, label: 'Bulk Actions' },
  advanced_analytics:{ enabled: true, label: 'Advanced Analytics' }
};

const PREMIUM_LIMITS = { max_accounts: -1, daily_actions: -1, max_templates: -1, history_days: -1, export_limit: -1 };
const FREE_LIMITS = { max_accounts: 1, daily_actions: 20, max_templates: 3, history_days: 3, export_limit: 5 };
const PREMIUM_SCOPE = ['bypasser', 'cardfiller', 'cvv', 'premium', 'browserMods', 'persona', 'rules', 'gateways', 'exclusive'];

function mapFeatures(on) { const o = {}; for (const [k,v] of Object.entries(PREMIUM_FEATURES)) o[k] = on ? v.enabled : false; return o; }
function mapCapabilities(on) { const o = {}; for (const [k,v] of Object.entries(PREMIUM_CAPABILITIES)) o[k] = on ? v.enabled : false; return o; }

// ═══════════════════════════════════════════════
// REDIS
// ═══════════════════════════════════════════════
function normalizeKey(key) {
  if (!key || typeof key !== 'string') return '';
  return key.trim().toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9\-]/g,'');
}

async function redisSet(key, value) {
  const k = normalizeKey(key);
  const res = await fetch(`${UPSTASH_URL}/set/${k}`, { method:'POST', headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}`, 'Content-Type':'application/json' }, body:value });
  return res.json();
}
async function redisGet(key) {
  const k = normalizeKey(key);
  if (!k) return null;
  const res = await fetch(`${UPSTASH_URL}/get/${k}`, { headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } });
  const data = await res.json();
  if (!data.result) return null;
  try { return migrarLicenca(JSON.parse(data.result)); } catch { return null; }
}
async function redisDel(key) {
  const k = normalizeKey(key);
  await fetch(`${UPSTASH_URL}/del/${k}`, { method:'POST', headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } });
}
async function redisKeys(pattern='*') {
  const res = await fetch(`${UPSTASH_URL}/keys/${pattern}`, { headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } });
  const data = await res.json();
  return data.result || [];
}

const PACOTES = {
  '3d':   { nome:'3 Dias',    dias:3,    preco:'R$ 2,99',   emoji:'🥉' },
  '7d':   { nome:'7 Dias',    dias:7,    preco:'R$ 4,99',   emoji:'🥈' },
  '15d':  { nome:'15 Dias',   dias:15,   preco:'R$ 7,99',   emoji:'🥇' },
  '30d':  { nome:'1 Mês',     dias:30,   preco:'R$ 12,99',  emoji:'💎' },
  '90d':  { nome:'3 Meses',   dias:90,   preco:'R$ 29,99',  emoji:'👑' },
  '1a':   { nome:'1 Ano',     dias:365,  preco:'R$ 79,99',  emoji:'🏆' },
  'unli': { nome:'ILIMITADO', dias:3650, preco:'R$ 149,99', emoji:'🔥' }
};

function migrarLicenca(lic) {
  if (!lic || typeof lic !== 'object') return lic;
  const n = { ...lic };
  if (!n.plano && n.plan) n.plano = n.plan === 'premium' ? 'unli' : n.plan;
  if (!n.plano) n.plano = '30d';
  if (!n.planoNome) { const pk = PACOTES[n.plano]; n.planoNome = pk ? pk.nome : 'Premium'; }
  if (typeof n.dias !== 'number') n.dias = typeof n.days === 'number' ? n.days : (n.plano === 'unli' ? 3650 : 30);
  if (!n.criadaEm && n.createdAt) n.criadaEm = n.createdAt;
  if (!n.criadaEm) n.criadaEm = Date.now();
  if (typeof n.ilimitada !== 'boolean') n.ilimitada = n.dias >= 3650;
  if (!n.expiraEm) n.expiraEm = n.ilimitada ? n.criadaEm + 365*24*60*60*1000*10 : n.criadaEm + n.dias*24*60*60*1000;
  if (typeof n.ativa !== 'boolean') n.ativa = typeof n.active === 'boolean' ? n.active : true;
  if (!n.preco) { const pk = PACOTES[n.plano]; n.preco = pk ? pk.preco : 'R$ 0,00'; }
  return n;
}

// ═══════════════════════════════════════════════
// JWT — COM SOURCE PREMIUM
// ═══════════════════════════════════════════════
function buildClaims(installId, lic) {
  const now = Math.floor(Date.now()/1000);
  const isUnli = lic && lic.ilimitada;
  const days = lic && lic.dias ? lic.dias : 30;
  const exp = isUnli ? now + (365*24*60*60*10) : now + (days*24*60*60);
  return {
    // Identity
    sub: installId,
    iss: 'asheo.api',
    aud: 'mozlince-client',
    installId,

    // Plan
    plan: 'premium',
    planDisplayName: 'Premium',
    tier: 'premium',
    kind: 'premium',
    status: 'active',
    active: true,
    isPremium: true,
    isVerified: true,

    // 🔥 SOURCE — corrige o bug do buildFreeEntitlement
    source: 'premium',
    sourceType: 'server',
    isFounder: true,

    // Scope
    scope: PREMIUM_SCOPE,

    // Features / Capabilities / Limits
    features: mapFeatures(true),
    capabilities: mapCapabilities(true),
    limits: { ...PREMIUM_LIMITS },

    // Secret
    secret: 'segredo-' + installId,

    // Timestamps
    iat: now,
    nbf: now - 5,
    exp: exp,
    jti: crypto.randomUUID()
  };
}

function signToken(claims) {
  if (!PRIVATE_KEY) throw new Error('Chave privada nao inicializada');
  return jwt.sign(claims, PRIVATE_KEY, { algorithm:'ES256' });
}

function formatDate(ts) { if (!ts) return 'Nunca'; return new Date(ts).toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
function humanTime(ms) {
  if (ms <= 0) return '❌ Expirada';
  const s = Math.floor(ms/1000);
  const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function generateLicenseKey() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const blk=()=>{let s='';for(let i=0;i<4;i++)s+=chars[crypto.randomInt(0,chars.length)];return s;};
  return `ASHEO-${blk()}-${blk()}-${blk()}-${blk()}`;
}

// ═══════════════════════════════════════════════
// AUTH — Bearer JWT
// ═══════════════════════════════════════════════
function validateBearer(req) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return { ok: false, error: 'missing_bearer' };
  const token = auth.substring(7);
  try {
    const decoded = jwt.verify(token, PUBLIC_KEY || PRIVATE_KEY, { algorithms: ['ES256'] });
    return { ok: true, decoded };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ═══════════════════════════════════════════════
// GATEWAYS + RULES + CAMPAIGNS
// ═══════════════════════════════════════════════
const GATEWAYS = [
  { id: 'default-stripe', name: 'Stripe', pattern: 'https://js.stripe.com/*', enabled: true, isDefault: true },
  { id: 'default-checkout', name: 'Checkout.com', pattern: 'https://*.checkout.com/*', enabled: true, isDefault: true },
  { id: 'default-adyen', name: 'Adyen', pattern: 'https://*.adyen.com/*', enabled: true, isDefault: true },
  { id: 'default-braintree', name: 'Braintree', pattern: 'https://*.braintreegateway.com/*', enabled: true, isDefault: true }
];

const RULES = [
  { id: 'bypasser', name: 'Bypasser', enabled: true, gateway: '*', priority: 1 },
  { id: 'cardfiller', name: 'Card Filler', enabled: true, gateway: '*', priority: 2 },
  { id: 'cvv', name: 'CVV Handler', enabled: true, gateway: '*', priority: 3 },
  { id: 'premium', name: 'Premium Rules', enabled: true, gateway: '*', priority: 10 }
];

const CAMPAIGNS = [
  { id: 'default-1', name: 'Default Campaign', enabled: true, createdAt: new Date().toISOString() }
];

// ═══════════════════════════════════════════════
// TELEGRAM BOT
// ═══════════════════════════════════════════════
const TG_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
async function tgSend(chatId, text, keyboard=null) {
  try { const body = { chat_id:chatId, text, parse_mode:'HTML', disable_web_page_preview:true }; if (keyboard) body.reply_markup = keyboard; await fetch(`${TG_API}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); } catch {}
}
async function tgEdit(chatId, messageId, text, keyboard=null) {
  try { const body = { chat_id:chatId, message_id:messageId, text, parse_mode:'HTML', disable_web_page_preview:true }; if (keyboard) body.reply_markup = keyboard; await fetch(`${TG_API}/editMessageText`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); } catch {}
}
async function tgAnswer(id, text='') {
  try { await fetch(`${TG_API}/answerCallbackQuery`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ callback_query_id:id, text }) }); } catch {}
}

function menuPrincipal() {
  return {
    texto: `╔══════════════════════════════════════╗\n║   👑 <b>MOZLINCE LICENSE PANEL</b> 👑   ║\n║      <i>Premium Edition v5.1</i>         ║\n╚══════════════════════════════════════╝\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✨ <b>Selecione:</b>`,
    teclado: { inline_keyboard: [
      [{ text:'🔑 GERAR LICENÇA', callback_data:'m_gerar' }],
      [{ text:'📋 LISTAR', callback_data:'m_listar' }, { text:'📊 STATS', callback_data:'m_stats' }],
      [{ text:'🔗 VINCULAR ID', callback_data:'m_vincular' }, { text:'🔓 DESVINCULAR', callback_data:'m_desvincular' }],
      [{ text:'🔍 CONSULTAR', callback_data:'m_consultar' }],
      [{ text:'❌ REVOGAR', callback_data:'m_revogar' }, { text:'🗑️ DELETAR', callback_data:'m_deletar' }],
      [{ text:'💰 PREÇOS', callback_data:'m_precos' }],
      [{ text:'📞 CONTACTAR', callback_data:'m_contacto' }, { text:'ℹ️ AJUDA', callback_data:'m_ajuda' }],
      [{ text:'⚠️ ZONA DE PERIGO', callback_data:'m_perigo' }]
    ]}
  };
}

async function cmdStart(chatId, msgId=null) {
  const m = menuPrincipal();
  if (msgId) await tgEdit(chatId, msgId, m.texto, m.teclado);
  else await tgSend(chatId, m.texto, m.teclado);
}

async function handleCallback(cb) {
  const chatId = cb.message.chat.id, msgId = cb.message.message_id, data = cb.data, userId = String(cb.from.id);
  if (userId !== String(OWNER_ID)) {
    await tgAnswer(cb.id, '⛔ Acesso negado.');
    if (data === 'm_contacto') {
      await tgSend(chatId, '📞 <b>Pedido enviado.</b>');
      await tgSend(OWNER_ID, `📞 Pedido\n👤 ${cb.from.first_name||'?'}\n💬 <code>${chatId}</code>`);
    }
    return;
  }
  try {
    if (data === 'm_home') { await tgAnswer(cb.id); return cmdStart(chatId, msgId); }
    if (data === 'm_gerar') {
      await tgAnswer(cb.id, '💰');
      const kb = { inline_keyboard: [] };
      const entries = Object.entries(PACOTES);
      for (let i = 0; i < entries.length; i += 2) {
        const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome} — ${entries[i][1].preco}`, callback_data:`g_${entries[i][0]}` }];
        if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome} — ${entries[i+1][1].preco}`, callback_data:`g_${entries[i+1][0]}` });
        kb.inline_keyboard.push(linha);
      }
      kb.inline_keyboard.push([{ text:'🔙 Voltar', callback_data:'m_home' }]);
      await tgEdit(chatId, msgId, `🔑 <b>GERAR</b>`, kb);
      return;
    }
    if (data.startsWith('g_')) {
      const pk = data.substring(2), p = PACOTES[pk];
      if (!p) { await tgAnswer(cb.id, '❌'); return; }
      const chave = generateLicenseKey(), agora = Date.now(), expira = agora + p.dias * 24 * 60 * 60 * 1000;
      await redisSet(chave, JSON.stringify({ chave, plano:pk, planoNome:p.nome, preco:p.preco, dias:p.dias, criadaEm:agora, expiraEm:expira, ilimitada: p.dias>=3650, ativa:true, installId:null, ativadaEm:null }));
      log('OK', 'Chave: ' + chave);
      await tgAnswer(cb.id, '✅');
      await tgEdit(chatId, msgId, `✅ <b>GERADA!</b>\n\n🔑 <code>${chave}</code>\n\n${p.emoji} ${p.nome}\n💰 ${p.preco}\n📅 ${formatDate(agora)}\n⏰ ${p.dias>=3650?'Nunca':formatDate(expira)}\n⌛ ${p.dias>=3650?'Ilimitada':humanTime(expira-agora)}`, { inline_keyboard: [[{ text:'🔍 Detalhes', callback_data:`c_${chave}` }], [{ text:'🔙 Menu', callback_data:'m_home' }]] });
      return;
    }
    if (data === 'm_listar') {
      await tgAnswer(cb.id);
      const keys = await redisKeys('ASHEO-*');
      if (keys.length === 0) { await tgEdit(chatId, msgId, `📋\n\n📭 Vazio.`, { inline_keyboard: [[{ text:'🔙', callback_data:'m_home' }]] }); return; }
      let txt = `📋 <b>LICENÇAS (${keys.length})</b>\n\n`;
      for (let i = 0; i < Math.min(keys.length, 25); i++) {
        const l = await redisGet(keys[i]); if (!l) continue;
        const exp = l.ilimitada ? '∞' : humanTime((l.expiraEm||0) - Date.now());
        txt += `${l.ativa?'🟢':'🔴'}${l.installId?'🔗':'⚪'} <code>${keys[i]}</code>\n     ${l.planoNome} • ${exp}\n\n`;
      }
      await tgEdit(chatId, msgId, txt, { inline_keyboard: [[{ text:'🔙', callback_data:'m_home' }]] });
      return;
    }
    if (data === 'm_stats') {
      await tgAnswer(cb.id);
      const keys = await redisKeys('ASHEO-*');
      let ativas=0, expiradas=0, vinc=0, unli=0, receita=0;
      for (const k of keys) {
        const l = await redisGet(k); if (!l) continue;
        if (l.ativa) ativas++; if (!l.ilimitada && l.expiraEm < Date.now()) expiradas++;
        if (l.installId) vinc++; if (l.ilimitada) unli++;
        if (l.preco) receita += parseFloat(String(l.preco).replace(/[^\d.,]/g,'').replace(',','.')) || 0;
      }
      await tgEdit(chatId, msgId, `📊 <b>STATS</b>\n\n🔑 ${keys.length}\n🟢 ${ativas}\n🔴 ${expiradas}\n🔗 ${vinc}\n🔥 ${unli}\n💰 R$ ${receita.toFixed(2)}`, { inline_keyboard: [[{ text:'🔄', callback_data:'m_stats' }], [{ text:'🔙', callback_data:'m_home' }]] });
      return;
    }
    if (data === 'm_vincular') { await tgAnswer(cb.id); await tgEdit(chatId, msgId, `🔗 <code>/activate &lt;id&gt; &lt;chave&gt;</code>`, { inline_keyboard: [[{ text:'🔙', callback_data:'m_home' }]] }); return; }
    if (data === 'm_desvincular') { await tgAnswer(cb.id); await tgEdit(chatId, msgId, `🔓 <code>/desvincular &lt;chave&gt;</code>`, { inline_keyboard: [[{ text:'🔙', callback_data:'m_home' }]] }); return; }
    if (data === 'm_consultar') { await tgAnswer(cb.id); await tgEdit(chatId, msgId, `🔍 <code>/status &lt;chave&gt;</code>`, { inline_keyboard: [[{ text:'🔙', callback_data:'m_home' }]] }); return; }
    if (data === 'm_revogar') { await tgAnswer(cb.id); await tgEdit(chatId, msgId, `❌ <code>/revogar &lt;chave&gt;</code>`, { inline_keyboard: [[{ text:'🔙', callback_data:'m_home' }]] }); return; }
    if (data === 'm_deletar') { await tgAnswer(cb.id); await tgEdit(chatId, msgId, `🗑️ <code>/deletar &lt;chave&gt;</code>`, { inline_keyboard: [[{ text:'🔙', callback_data:'m_home' }]] }); return; }
    if (data === 'm_precos') {
      await tgAnswer(cb.id);
      let txt = `💰 <b>PREÇOS</b>\n\n`;
      for (const [,p] of Object.entries(PACOTES)) txt += `${p.emoji} <b>${p.nome}</b> — ${p.preco}\n`;
      await tgEdit(chatId, msgId, txt, { inline_keyboard: [[{ text:'📞', callback_data:'m_contacto' }], [{ text:'🔙', callback_data:'m_home' }]] });
      return;
    }
    if (data === 'm_contacto') {
      await tgAnswer(cb.id, '📞');
      await tgEdit(chatId, msgId, `📞 <b>CONTACTAR</b>`, { inline_keyboard: [[{ text:'🔙', callback_data:'m_home' }]] });
      if (userId !== String(OWNER_ID)) await tgSend(OWNER_ID, `📞 Pedido\n👤 ${cb.from.first_name||'?'}\n💬 <code>${chatId}</code>`);
      return;
    }
    if (data === 'm_ajuda') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId, `ℹ️ <b>AJUDA</b>\n\n<code>/gerar</code> • <code>/listar</code> • <code>/stats</code>\n<code>/status &lt;chave&gt;</code>\n<code>/activate &lt;id&gt; &lt;chave&gt;</code>\n<code>/desvincular &lt;chave&gt;</code>\n<code>/revogar &lt;chave&gt;</code>\n<code>/deletar &lt;chave&gt;</code>\n<code>/deletarativas</code>\n<code>/deletartudo</code>`, { inline_keyboard: [[{ text:'🔙', callback_data:'m_home' }]] });
      return;
    }
    if (data === 'm_perigo') { await tgAnswer(cb.id, '⚠️'); await tgEdit(chatId, msgId, `⚠️ <b>PERIGO</b>`, { inline_keyboard: [[{ text:'🗑️ Deletar Ativas', callback_data:'danger_ativas' }], [{ text:'💣 Deletar Tudo', callback_data:'danger_tudo' }], [{ text:'🔙', callback_data:'m_home' }]] }); return; }
    if (data === 'danger_ativas') { await tgAnswer(cb.id); await tgEdit(chatId, msgId, `⚠️ <b>Confirmar?</b>`, { inline_keyboard: [[{ text:'✅', callback_data:'confirm_ativas' }], [{ text:'❌', callback_data:'m_perigo' }]] }); return; }
    if (data === 'danger_tudo') { await tgAnswer(cb.id); await tgEdit(chatId, msgId, `💣 <b>Confirmar?</b>`, { inline_keyboard: [[{ text:'💣 SIM', callback_data:'confirm_tudo' }], [{ text:'❌', callback_data:'m_perigo' }]] }); return; }
    if (data === 'confirm_ativas') {
      await tgAnswer(cb.id, '...');
      const keys = await redisKeys('ASHEO-*'); let n = 0;
      for (const k of keys) { const l = await redisGet(k); if (l && l.ativa) { await redisDel(k); n++; } }
      await tgEdit(chatId, msgId, `✅ ${n} removidas.`, { inline_keyboard: [[{ text:'🔙', callback_data:'m_home' }]] });
      return;
    }
    if (data === 'confirm_tudo') {
      await tgAnswer(cb.id, '...');
      const keys = await redisKeys('ASHEO-*');
      for (const k of keys) await redisDel(k);
      await tgEdit(chatId, msgId, `💣 ${keys.length} removidas.`, { inline_keyboard: [[{ text:'🔙', callback_data:'m_home' }]] });
      return;
    }
    if (data.startsWith('c_')) {
      const k = data.substring(2), l = await redisGet(k);
      if (!l) { await tgAnswer(cb.id, '❌'); return; }
      await tgAnswer(cb.id);
      const resta = l.ilimitada ? '∞' : humanTime((l.expiraEm||0) - Date.now());
      await tgEdit(chatId, msgId, `🔍 <b>DETALHES</b>\n\n🔑 <code>${k}</code>\n\n${PACOTES[l.plano]?.emoji||'📦'} ${l.planoNome}\n💰 ${l.preco}\n📅 ${formatDate(l.criadaEm)}\n⏰ ${l.ilimitada?'Nunca':formatDate(l.expiraEm)}\n⌛ ${resta}\n\n🔗 ${l.installId?`<code>${l.installId}</code>`:'Não vinculada'}\n📌 ${l.ativa?'🟢':'🔴'}`, { inline_keyboard: [[{ text: l.installId?'🔓':'🔗', callback_data: l.installId?`dv_${k}`:`v_${k}` }], [{ text:'❌', callback_data:`rv_${k}` }, { text:'🗑️', callback_data:`dl_${k}` }], [{ text:'🔙', callback_data:'m_home' }]] });
      return;
    }
    if (data.startsWith('v_')) { const k = data.substring(2); await tgAnswer(cb.id); await tgEdit(chatId, msgId, `🔗 <code>/activate &lt;installId&gt; ${k}</code>`, { inline_keyboard: [[{ text:'🔙', callback_data:`c_${k}` }]] }); return; }
    if (data.startsWith('dv_')) { const k = data.substring(3); const l = await redisGet(k); if (l) { l.installId = null; l.ativadaEm = null; await redisSet(k, JSON.stringify(l)); } await tgAnswer(cb.id, '🔓'); await tgEdit(chatId, msgId, `✅ Desvinculada`, { inline_keyboard: [[{ text:'🔙', callback_data:`c_${k}` }]] }); return; }
    if (data.startsWith('rv_')) { const k = data.substring(3); const l = await redisGet(k); if (l) { l.ativa = false; await redisSet(k, JSON.stringify(l)); } await tgAnswer(cb.id, '❌'); await tgEdit(chatId, msgId, `❌ Revogada`, { inline_keyboard: [[{ text:'🔙', callback_data:`c_${k}` }]] }); return; }
    if (data.startsWith('dl_')) { const k = data.substring(3); await redisDel(k); await tgAnswer(cb.id, '🗑️'); await tgEdit(chatId, msgId, `🗑️ Deletada`, { inline_keyboard: [[{ text:'🔙', callback_data:'m_home' }]] }); return; }
    await tgAnswer(cb.id);
  } catch (e) { log('ERRO','Callback: '+e.message); await tgAnswer(cb.id, '❌ '+e.message); }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id, userId = String(msg.from.id);
  const texto = (msg.text || '').trim();
  const args = texto.replace(/\n/g,' ').split(' ').filter(a => a.length > 0);
  const cmd = (args[0] || '').toLowerCase();
  if (userId !== String(OWNER_ID)) {
    if (cmd === '/start' || cmd === '/contacto') {
      await tgSend(chatId, `👋 <b>Bem-vindo!</b>`, { inline_keyboard: [[{ text:'📞 CONTACTAR ADMIN', callback_data:'m_contacto' }]] });
      return;
    }
    return;
  }
  try {
    if (cmd === '/start' || cmd === '/menu') { await cmdStart(chatId); return; }
    if (cmd === '/gerar') {
      const kb = { inline_keyboard: [] };
      const entries = Object.entries(PACOTES);
      for (let i = 0; i < entries.length; i += 2) {
        const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome}`, callback_data:`g_${entries[i][0]}` }];
        if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome}`, callback_data:`g_${entries[i+1][0]}` });
        kb.inline_keyboard.push(linha);
      }
      await tgSend(chatId, `🔑 <b>GERAR</b>`, kb);
      return;
    }
    if (cmd === '/listar') {
      const keys = await redisKeys('ASHEO-*');
      if (keys.length === 0) { await tgSend(chatId, `📭 Nenhuma.`); return; }
      let txt = `📋 <b>LICENÇAS (${keys.length})</b>\n\n`;
      for (let i = 0; i < Math.min(keys.length, 30); i++) {
        const l = await redisGet(keys[i]); if (!l) continue;
        const exp = l.ilimitada ? '∞' : humanTime((l.expiraEm||0) - Date.now());
        txt += `${l.ativa?'🟢':'🔴'} <code>${keys[i]}</code>\n     ${l.planoNome} • ${exp}\n`;
      }
      await tgSend(chatId, txt);
      return;
    }
    if (cmd === '/status') {
      const k = args[1];
      if (!k) { await tgSend(chatId, `⚠️ /status &lt;chave&gt;`); return; }
      const l = await redisGet(k);
      if (!l) { await tgSend(chatId, `❌`); return; }
      const resta = l.ilimitada ? '∞' : humanTime((l.expiraEm||0) - Date.now());
      await tgSend(chatId, `🔍 <b>STATUS</b>\n\n🔑 <code>${k}</code>\n\n${PACOTES[l.plano]?.emoji||'📦'} ${l.planoNome}\n💰 ${l.preco}\n📅 ${formatDate(l.criadaEm)}\n⏰ ${l.ilimitada?'Nunca':formatDate(l.expiraEm)}\n⌛ ${resta}\n🔗 ${l.installId?`<code>${l.installId}</code>`:'Não vinculada'}\n📌 ${l.ativa?'🟢':'🔴'}`);
      return;
    }
    if (cmd === '/activate') {
      const chave = args[args.length-1], installId = args.slice(1, args.length-1).join(' ');
      if (!installId || !chave) { await tgSend(chatId, `⚠️ /activate &lt;id&gt; &lt;chave&gt;`); return; }
      const l = await redisGet(chave);
      if (!l) { await tgSend(chatId, `❌`); return; }
      if (l.installId) { await tgSend(chatId, `⚠️ Já vinculada.`); return; }
      l.installId = installId; l.ativadaEm = Date.now();
      await redisSet(chave, JSON.stringify(l));
      await tgSend(chatId, `✅ Vinculada!\n\n🔑 <code>${chave}</code>\n🔗 <code>${installId}</code>`);
      return;
    }
    if (cmd === '/desvincular') { const k = args[1]; if (!k) { await tgSend(chatId, `⚠️`); return; } const l = await redisGet(k); if (!l) { await tgSend(chatId, `❌`); return; } l.installId = null; l.ativadaEm = null; await redisSet(k, JSON.stringify(l)); await tgSend(chatId, `🔓`); return; }
    if (cmd === '/revogar') { const k = args[1]; if (!k) { await tgSend(chatId, `⚠️`); return; } const l = await redisGet(k); if (!l) { await tgSend(chatId, `❌`); return; } l.ativa = false; await redisSet(k, JSON.stringify(l)); await tgSend(chatId, `❌`); return; }
    if (cmd === '/deletar') { const k = args[1]; if (!k) { await tgSend(chatId, `⚠️`); return; } await redisDel(k); await tgSend(chatId, `🗑️`); return; }
    if (cmd === '/deletarativas') { const keys = await redisKeys('ASHEO-*'); let n = 0; for (const k of keys) { const l = await redisGet(k); if (l && l.ativa) { await redisDel(k); n++; } } await tgSend(chatId, `🗑️ ${n}`); return; }
    if (cmd === '/deletartudo') { const keys = await redisKeys('ASHEO-*'); for (const k of keys) await redisDel(k); await tgSend(chatId, `💣 ${keys.length}`); return; }
    if (cmd === '/stats') { const keys = await redisKeys('ASHEO-*'); let ativas=0, exp=0, vinc=0, unli=0; for (const k of keys) { const l = await redisGet(k); if (!l) continue; if (l.ativa) ativas++; if (!l.ilimitada && l.expiraEm < Date.now()) exp++; if (l.installId) vinc++; if (l.ilimitada) unli++; } await tgSend(chatId, `📊 <b>STATS</b>\n\n🔑 ${keys.length}\n🟢 ${ativas}\n🔴 ${exp}\n🔗 ${vinc}\n🔥 ${unli}`); return; }
    await tgSend(chatId, `❓ Use /start.`);
  } catch (e) { log('ERRO','Message: '+e.message); }
}

app.post('/telegram-webhook', async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  try {
    if (update.callback_query) return handleCallback(update.callback_query);
    if (update.message && update.message.text) return handleMessage(update.message);
  } catch (e) { log('ERRO','Webhook: '+e.message); }
});

// ═══════════════════════════════════════════════════════════════
// API COMPLETA v5.1
// ═══════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.json({ ok: true, service: 'mozlince-license-api', version: '5.1', status: 'live' }));

app.get('/v1/health', (req, res) => res.json({ ok: true, status: 'healthy', uptime: Math.floor(process.uptime()), version: '5.1', timestamp: new Date().toISOString() }));

app.get('/v1/version', (req, res) => res.json({ ok: true, version: '5.1', api: 'v1', minClientVersion: '1.0.0', timestamp: new Date().toISOString() }));

app.get('/v1/status', (req, res) => res.json({ ok: true, service: 'mozlince-license-api', version: '5.1', hora: new Date().toISOString() }));

// /v1/bootstrap — COM SOURCE PREMIUM
app.get('/v1/bootstrap', (req, res) => {
  const auth = validateBearer(req);
  log('BOOT', `Bootstrap de ${auth.ok ? auth.decoded.sub : '(sem auth)'}`);
  res.json({
    ok: true,
    version: '5.1',
    apiVersion: 'v1',
    issuedAt: new Date().toISOString(),
    serverTime: Date.now(),

    // 🔥 Fonte premium — corrige o buildFreeEntitlement
    source: 'premium',
    sourceType: 'server',
    isFounder: true,
    tier: 'premium',
    kind: 'premium',

    config: {
      apiBase: 'https://mozlince.onrender.com',
      featuresEnabled: true,
      premiumEnabled: true,
      syncEnabled: true,
      gatewayMode: 'default',
      telemetryEnabled: false,
      retryAfterMs: 5000,
      heartbeatMs: 60000
    },
    flags: {
      bootstrapReady: true,
      exclusiveEnabled: true,
      rulesEnabled: true,
      premium: true
    },
    endpoints: {
      activate: '/v1/activate',
      featureActivate: '/v1/feature/activate',
      deactivate: '/v1/deactivate',
      verify: '/v1/verify',
      bootstrap: '/v1/bootstrap',
      rules: '/v1/rules',
      exclusive: '/v1/exclusive/manifest',
      exclusiveSync: '/v1/exclusive/sync',
      gateways: '/v1/gateways',
      campaign: '/v1/campaign',
      dashboard: '/v1/dashboard',
      health: '/v1/health',
      version: '/v1/version'
    },
    features: mapFeatures(true),
    capabilities: mapCapabilities(true),
    limits: { ...PREMIUM_LIMITS },
    scope: PREMIUM_SCOPE
  });
});

app.get('/v1/rules', (req, res) => {
  const auth = validateBearer(req);
  const isPremium = auth.ok && (auth.decoded.tier === 'premium' || auth.decoded.scope);
  log('API', `Rules pedidas (auth=${auth.ok}, premium=${isPremium})`);
  res.json({
    ok: true, version: 3, updatedAt: new Date().toISOString(),
    source: 'premium', tier: 'premium',
    scope: isPremium ? PREMIUM_SCOPE : ['free'],
    rules: isPremium ? RULES : RULES.slice(0, 1),
    serverTime: Date.now()
  });
});

app.get('/v1/exclusive/manifest', (req, res) => {
  const auth = validateBearer(req);
  log('API', `Exclusive manifest (auth=${auth.ok})`);
  res.json({
    ok: true,
    source: 'premium', tier: 'premium',
    manifest: {
      version: '1.6.2', version_name: '1.6.2',
      generatedAt: new Date().toISOString(), minVersion: '1.0.0',
      exclusiveFeatures: Object.keys(PREMIUM_FEATURES),
      rules: RULES, gateways: GATEWAYS,
      signature: crypto.randomBytes(64).toString('hex')
    },
    cachedAt: Date.now(), expiresAt: Date.now() + (23 * 3600 * 1000)
  });
});

app.get('/v1/exclusive/sync', (req, res) => {
  const auth = validateBearer(req);
  log('API', `Exclusive sync (auth=${auth.ok})`);
  res.json({
    ok: true, source: 'premium', tier: 'premium',
    manifest: { version: '1.6.2', generatedAt: new Date().toISOString(), rules: RULES, gateways: GATEWAYS, signature: crypto.randomBytes(64).toString('hex') },
    cachedAt: Date.now()
  });
});

app.get('/v1/gateways', (req, res) => {
  const auth = validateBearer(req);
  log('API', `Gateways (auth=${auth.ok})`);
  res.json({ ok: true, source: 'premium', tier: 'premium', version: 1, gateways: GATEWAYS, serverTime: Date.now() });
});

app.get('/v1/campaign', (req, res) => {
  const auth = validateBearer(req);
  log('API', `Campaign (auth=${auth.ok})`);
  res.json({ ok: true, source: 'premium', tier: 'premium', campaigns: CAMPAIGNS, serverTime: Date.now() });
});

app.get('/v1/dashboard', (req, res) => {
  const auth = validateBearer(req);
  log('API', `Dashboard (auth=${auth.ok})`);
  res.json({
    ok: true,
    source: 'premium', sourceType: 'server', isFounder: true,
    dashboard: {
      tier: auth.ok && auth.decoded.tier === 'premium' ? 'premium' : 'free',
      source: auth.ok && auth.decoded.tier === 'premium' ? 'premium' : 'free',
      seat: auth.ok ? 1 : 0, seats: auth.ok ? 1 : 0,
      installId: auth.ok ? auth.decoded.sub : null,
      expiresAt: auth.ok ? auth.decoded.exp * 1000 : null,
      features: auth.ok ? mapFeatures(true) : mapFeatures(false),
      capabilities: auth.ok ? mapCapabilities(true) : mapCapabilities(false),
      limits: auth.ok ? PREMIUM_LIMITS : FREE_LIMITS,
      scope: auth.ok ? PREMIUM_SCOPE : ['free']
    },
    serverTime: Date.now()
  });
});

app.get('/v1/premium/definitions', (req, res) => {
  res.json({
    ok: true, source: 'premium', tier: 'premium',
    features: PREMIUM_FEATURES, capabilities: PREMIUM_CAPABILITIES,
    premiumLimits: PREMIUM_LIMITS, freeLimits: FREE_LIMITS,
    scope: PREMIUM_SCOPE, version: '1.6.2'
  });
});

app.get('/v1/planos', (req, res) => {
  res.json({ ok: true, planos: Object.entries(PACOTES).map(([id,p]) => ({ id, nome:p.nome, dias:p.dias, preco:p.preco, emoji:p.emoji })) });
});

// ═══════════════════════════════════════════════
// /v1/activate — ATIVAÇÃO
// ═══════════════════════════════════════════════
app.post('/v1/activate', async (req, res) => {
  const inicio = Date.now();
  const { installId, licenseKey, clientTag } = req.body || {};
  log('INFO', `Activate: installId=${installId ? installId.substring(0,12)+'...' : '?'} | key=${licenseKey ? normalizeKey(licenseKey).substring(0,18)+'...' : '(vazia)'}`);

  // MODO 1: Feature activation (Bearer)
  if (!licenseKey && !installId) {
    const auth = validateBearer(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: 'missing_auth' });
    const feature = (req.body && req.body.feature) || req.query.feature;
    if (!feature) return res.status(400).json({ ok: false, error: 'missing_feature' });
    if (!PREMIUM_FEATURES[feature]) return res.status(404).json({ ok: false, error: 'unknown_feature' });

    const scope = auth.decoded.scope || [];
    const hasScope = Array.isArray(scope) ? scope.includes(feature) : String(scope).includes(feature);
    if (!hasScope && auth.decoded.tier !== 'premium') return res.status(403).json({ ok: false, error: 'feature_not_in_scope' });

    const now = Math.floor(Date.now()/1000);
    const token = jwt.sign({
      sub: auth.decoded.sub, installId: auth.decoded.sub, feature,
      kind: 'feature', type: 'feature', tier: 'premium',
      source: 'premium', isFounder: true,
      scope: [feature, 'premium'],
      iat: now, nbf: now - 5, exp: now + 300, jti: crypto.randomUUID()
    }, PRIVATE_KEY, { algorithm: 'ES256' });
    log('FEAT', `✅ ${feature} | ${auth.decoded.sub} | ${Date.now()-inicio}ms`);
    return res.json({ ok: true, token, feature, expires_in: 300, exp: now + 300 });
  }

  // MODO 2: Ativação normal
  if (!installId || typeof installId !== 'string' || installId.length < 5) return res.status(400).json({ error: 'missing_installId' });
  if (!PRIVATE_KEY) return res.status(500).json({ error: 'server_misconfigured' });
  if (!licenseKey || typeof licenseKey !== 'string' || !licenseKey.toUpperCase().startsWith('ASHEO-')) return res.status(401).json({ error: 'missing_license' });

  const keyNorm = normalizeKey(licenseKey);
  const lic = await redisGet(keyNorm);
  if (!lic) { log('WARN', `NAO ENCONTRADA: ${keyNorm.substring(0,18)}...`); return res.status(404).json({ error: 'invalid_license' }); }
  if (!lic.ativa) return res.status(403).json({ error: 'revoked' });

  if (!lic.installId) {
    lic.installId = installId; lic.ativadaEm = Date.now();
    await redisSet(keyNorm, JSON.stringify(lic));
    log('OK', `Vinculada: ${keyNorm.substring(0,18)}... -> ${installId}`);
  } else if (lic.installId !== installId) {
    return res.status(403).json({ error: 'already_used' });
  }
  if (!lic.ilimitada && Date.now() > lic.expiraEm) return res.status(403).json({ error: 'expired' });

  try {
    const token = signToken(buildClaims(installId, lic));
    log('ATIV', `✅ ${installId.substring(0,12)}... | ${keyNorm.substring(0,18)}... | ${Date.now()-inicio}ms`);
    return res.json({
      token,
      tier: 'premium', kind: 'premium',
      source: 'premium', sourceType: 'server', isFounder: true,
      seat: 1, seats: 1, gwPass: null,
      plan: 'premium', planDisplayName: 'Premium',
      expires_in: lic.ilimitada ? -1 : Math.floor((lic.expiraEm - Date.now())/1000),
      licenseKey: keyNorm
    });
  } catch (e) { return res.status(500).json({ error: 'internal', message: e.message }); }
});

app.post('/v1/feature/activate', async (req, res) => {
  req.body = req.body || {};
  return app._router.handle(Object.assign(req, { url: '/v1/activate', method: 'POST' }), res, () => {});
});
app.get('/v1/feature/activate', async (req, res) => {
  const auth = validateBearer(req);
  if (!auth.ok) return res.status(401).json({ ok: false, error: 'missing_bearer' });
  const feature = req.query.feature;
  if (!feature) return res.status(400).json({ ok: false, error: 'missing_feature' });
  if (!PREMIUM_FEATURES[feature]) return res.status(404).json({ ok: false, error: 'unknown_feature' });
  const now = Math.floor(Date.now()/1000);
  const token = jwt.sign({
    sub: auth.decoded.sub, installId: auth.decoded.sub, feature,
    kind: 'feature', type: 'feature', tier: 'premium',
    source: 'premium', isFounder: true,
    scope: [feature, 'premium'],
    iat: now, nbf: now - 5, exp: now + 300, jti: crypto.randomUUID()
  }, PRIVATE_KEY, { algorithm: 'ES256' });
  res.json({ ok: true, token, feature, expires_in: 300, exp: now + 300 });
});

app.post('/v1/deactivate', async (req, res) => {
  const { installId, licenseKey } = req.body || {};
  if (licenseKey) {
    const lic = await redisGet(licenseKey);
    if (lic && lic.installId === installId) {
      lic.installId = null; lic.ativadaEm = null;
      await redisSet(licenseKey, JSON.stringify(lic));
    }
  }
  res.json({ ok: true, message: 'Desativado' });
});

app.post('/v1/verify', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'missing_token' });
  try {
    const decoded = jwt.verify(token, PUBLIC_KEY || PRIVATE_KEY, { algorithms: ['ES256'] });
    return res.json({ ok: true, valido: true, dados: decoded });
  } catch (e) { return res.status(401).json({ ok: false, valido: false, erro: e.message }); }
});

app.post('/verificar-licenca', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ erro: 'Token obrigatorio' });
  try { const decoded = jwt.verify(token, PUBLIC_KEY || PRIVATE_KEY, { algorithms: ['ES256'] }); res.json({ valido: true, dados: decoded }); }
  catch (err) { res.status(401).json({ valido: false, erro: err.message }); }
});

// ═══════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log('SYS', `🚀 Servidor Mozlince v5.1 na porta ${PORT}`);
  log('SYS', `Chave: ${ORIGEM}`);
  log('SYS', `Redis: ${UPSTASH_URL ? 'OK' : 'FALTA'}`);
  log('SYS', `Telegram: ${TELEGRAM_TOKEN ? 'OK' : 'FALTA'}`);
  log('SYS', `Features: ${Object.keys(PREMIUM_FEATURES).length} | Scope: ${PREMIUM_SCOPE.length} itens`);
  log('SYS', `source: 'premium' integrado no JWT, bootstrap e responses`);
  log('SYS', `Rotas: /v1/bootstrap /v1/rules /v1/exclusive/manifest /v1/exclusive/sync`);
  log('SYS', `       /v1/gateways /v1/campaign /v1/dashboard /v1/health /v1/version`);
  log('SYS', `       /v1/activate /v1/feature/activate /v1/deactivate /v1/verify`);
});

process.on('uncaughtException', e => log('ERRO','Uncaught: '+e.message));
process.on('unhandledRejection', e => log('ERRO','Rejection: '+e));
