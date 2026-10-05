/* ═══════════════════════════════════════════════════════════════
   ⚡ MOZLINCE NEBULA PREMIUM v6.0 — License Server
   © Asheo Systems — Todas rotas /v1/* + /api/v1/* + aliases legados
   ═══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');

const app = express();

/* ── CORS universal (chrome-extension + background.js) ── */
const ALLOWED_HEADERS = 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Install-Id, X-Client-Tag, X-License-Key, X-Request-Id';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Request-Id');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Powered-By', 'Mozlince-Nebula/6.0');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '512kb' }));

/* ── Logger com paleta Nebula ── */
const C = {
  r:'\x1b[0m', b:'\x1b[1m', d:'\x1b[2m',
  cyan:'\x1b[38;5;51m', purple:'\x1b[38;5;141m', gold:'\x1b[38;5;220m',
  green:'\x1b[38;5;46m', red:'\x1b[38;5;196m', orange:'\x1b[38;5;208m',
  blue:'\x1b[38;5;39m', pink:'\x1b[38;5;213m', gray:'\x1b[38;5;245m',
  mint:'\x1b[38;5;121m', violet:'\x1b[38;5;99m'
};
const TAGS = {
  INFO:C.cyan, OK:C.green, WARN:C.orange, ERRO:C.red, SYS:C.purple, ATIV:C.blue,
  BOT:C.cyan, FEAT:C.pink, BOOT:C.mint, API:C.gold, ALIAS:C.violet, DBG:C.gray,
  AUTH:C.pink, RATE:C.orange, CACHE:C.violet, TG:C.cyan
};
function log(t, m) {
  const ts = new Date().toISOString().replace('T',' ').substring(0,19);
  const tag = TAGS[t] || C.gray;
  console.log(`${C.gray}${ts}${C.r} ${tag}${C.b}▸ ${t.padEnd(5)}${C.r} ${m}`);
}
function banner() {
  const g = C.purple, c = C.cyan, gold = C.gold, r = C.r, b = C.b;
  console.log(`\n${g}╔══════════════════════════════════════════════════════════╗${r}`);
  console.log(`${g}║${r}  ${c}${b}⚡ MOZLINCE${r} ${gold}${b}NEBULA PREMIUM${r} ${g}· ${r}v${gold}6.0${r}                ${g}║${r}`);
  console.log(`${g}║${r}  ${C.gray}License & Entitlement Engine — Asheo Systems${r}        ${g}║${r}`);
  console.log(`${g}╚══════════════════════════════════════════════════════════╝${r}\n`);
}

/* ═══════════════════════════════════════════════
   CHAVES ES256
   ═══════════════════════════════════════════════ */
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
  }
  if (!PUBLIC_KEY) {
    let pu = process.env.EC_PUBLIC_KEY || process.env.JWT_PUBLIC_KEY_PEM || '';
    if (pu) {
      if (!pu.includes('BEGIN')) { try { pu = Buffer.from(pu.trim(),'base64').toString('utf8'); } catch {} }
      PUBLIC_KEY = pu.replace(/\\n/g,'\n').trim();
    }
  }
  if (PRIVATE_KEY) {
    try {
      const k = crypto.createPrivateKey(PRIVATE_KEY);
      const jwk = crypto.createPublicKey(k).export({ format:'jwk' });
      if (!PUBLIC_KEY) {
        PUBLIC_KEY = crypto.createPublicKey(k).export({ type:'spki', format:'pem' });
        log('OK', 'Public key derivada da privada');
      }
      log('OK', `Chave privada OK (${ORIGEM})`);
      log('DBG', `JWK.x = ${jwk.x}`);
      log('DBG', `JWK.y = ${jwk.y}`);
      if (jwk.x === 'aTAr_kSTrfocOkpAHlVSDc71E1pc5Pd5KgnE-ggBr_4' && jwk.y === 'GFrU897XAPvrxqcRhlwoAwpooKHl69-0YrBaJbfwAT4') {
        log('OK', '✅ Chave CORRESPONDE à extensão Mozlince!');
      } else {
        log('WARN', '⚠️ Chave diferente da extensão — tokens serão rejeitados');
      }
    } catch (e) { log('ERRO','Chave privada inválida: '+e.message); PRIVATE_KEY = null; }
  } else { log('ERRO','Nenhuma chave privada encontrada'); }
})();

/* ═══════════════════════════════════════════════
   ENV
   ═══════════════════════════════════════════════ */
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID;

/* ═══════════════════════════════════════════════
   PREMIUM DEFINITIONS
   ═══════════════════════════════════════════════ */
const PREMIUM_FEATURES = {
  browser_mods:       { enabled: true, label: 'Browser Mods',        description: 'Spoof fingerprint and rotate user-agent.' },
  rule_ops_lab:       { enabled: true, label: 'Rule Ops Lab',        description: 'Bulk rule ops, presets, conflict scan.' },
  live_injection_hud: { enabled: true, label: 'Live Injection HUD',  description: 'On-page overlay showing each card swap.' },
  algo_v2:            { enabled: true, label: 'Algo V2' },
  exclusive_rules:    { enabled: true, label: 'Exclusive Rules' },
  advanced_automation:{ enabled: true, label: 'Advanced Automation' },
  multi_account:      { enabled: true, label: 'Multi Account' },
  custom_export:      { enabled: true, label: 'Custom Export' },
  api_access:         { enabled: true, label: 'API Access' }
};
const PREMIUM_CAPABILITIES = {
  priority_support:   { enabled: true, label: 'Priority Support' },
  custom_webhooks:    { enabled: true, label: 'Custom Webhooks' },
  cloud_sync:         { enabled: true, label: 'Cloud Sync' },
  bulk_actions:       { enabled: true, label: 'Bulk Actions' },
  advanced_analytics: { enabled: true, label: 'Advanced Analytics' }
};
const PREMIUM_LIMITS = { max_accounts: -1, daily_actions: -1, max_templates: -1, history_days: -1, export_limit: -1 };
const FREE_LIMITS    = { max_accounts: 1,  daily_actions: 20, max_templates: 3,  history_days: 3,  export_limit: 5 };
const PREMIUM_SCOPE  = ['bypasser','cardfiller','cvv','premium','browserMods','persona','rules','gateways','exclusive'];

function mapFeatures(on)    { const o={}; for (const [k,v] of Object.entries(PREMIUM_FEATURES))     o[k]=on?v.enabled:false; return o; }
function mapCapabilities(on){ const o={}; for (const [k,v] of Object.entries(PREMIUM_CAPABILITIES)) o[k]=on?v.enabled:false; return o; }

/* ═══════════════════════════════════════════════
   REDIS (Upstash REST) com URL-encode correto
   ═══════════════════════════════════════════════ */
function normalizeKey(key) {
  if (!key || typeof key !== 'string') return '';
  return key.trim().toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9\-]/g,'');
}
async function redisSet(key, value) {
  const k = encodeURIComponent(normalizeKey(key));
  const res = await fetch(`${UPSTASH_URL}/set/${k}`, {
    method:'POST',
    headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}`, 'Content-Type':'text/plain' },
    body: typeof value === 'string' ? value : JSON.stringify(value)
  });
  return res.json();
}
async function redisGet(key) {
  const k = encodeURIComponent(normalizeKey(key));
  if (!k) return null;
  const res = await fetch(`${UPSTASH_URL}/get/${k}`, { headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } });
  const data = await res.json();
  if (!data.result) return null;
  try { return migrarLicenca(JSON.parse(data.result)); } catch { return null; }
}
async function redisDel(key) {
  const k = encodeURIComponent(normalizeKey(key));
  await fetch(`${UPSTASH_URL}/del/${k}`, { method:'POST', headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } });
}
async function redisKeys(pattern='ASHEO-*') {
  const p = encodeURIComponent(pattern);
  const res = await fetch(`${UPSTASH_URL}/keys/${p}`, { headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } });
  const data = await res.json();
  return (data.result || []).filter(k => typeof k === 'string');
}

/* ═══════════════════════════════════════════════
   PACOTES
   ═══════════════════════════════════════════════ */
const PACOTES = {
  '3d':   { nome:'3 Dias',    dias:3,    preco:'R$ 2,99',   emoji:'🥉', cor:'bronze' },
  '7d':   { nome:'7 Dias',    dias:7,    preco:'R$ 4,99',   emoji:'🥈', cor:'silver' },
  '15d':  { nome:'15 Dias',   dias:15,   preco:'R$ 7,99',   emoji:'🥇', cor:'gold'   },
  '30d':  { nome:'1 Mês',     dias:30,   preco:'R$ 12,99',  emoji:'💎', cor:'diamond'},
  '90d':  { nome:'3 Meses',   dias:90,   preco:'R$ 29,99',  emoji:'👑', cor:'royal'  },
  '1a':   { nome:'1 Ano',     dias:365,  preco:'R$ 79,99',  emoji:'🏆', cor:'legend' },
  'unli': { nome:'ILIMITADO', dias:3650, preco:'R$ 149,99', emoji:'🔥', cor:'inferno'}
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

/* ═══════════════════════════════════════════════
   JWT
   ═══════════════════════════════════════════════ */
function buildClaims(installId, lic) {
  const now = Math.floor(Date.now()/1000);
  const isUnli = lic && lic.ilimitada;
  const days = lic && lic.dias ? lic.dias : 30;
  const exp = isUnli ? now + (365*24*60*60*10) : now + (days*24*60*60);
  return {
    sub: installId, iss: 'asheo.api', aud: 'mozlince-client', installId,
    plan: 'premium', planDisplayName: 'Premium', tier: 'premium', kind: 'premium',
    status: 'active', active: true, isPremium: true, isVerified: true,
    source: 'premium', sourceType: 'server', isFounder: true,
    scope: PREMIUM_SCOPE,
    features: mapFeatures(true), capabilities: mapCapabilities(true),
    limits: { ...PREMIUM_LIMITS },
    secret: 'segredo-' + installId,
    iat: now, nbf: now - 5, exp, jti: crypto.randomUUID()
  };
}
function signToken(claims) {
  if (!PRIVATE_KEY) throw new Error('Chave privada nao inicializada');
  return jwt.sign(claims, PRIVATE_KEY, { algorithm:'ES256' });
}
function formatDate(ts) {
  if (!ts) return 'Nunca';
  return new Date(ts).toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function humanTime(ms) {
  if (ms <= 0) return '❌ Expirada';
  const s = Math.floor(ms/1000);
  const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function progressBar(pct, size=10) {
  const cheio = Math.round(pct * size / 100);
  const vazio = size - cheio;
  return '█'.repeat(Math.max(0,cheio)) + '░'.repeat(Math.max(0,vazio));
}
function generateLicenseKey() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const blk=()=>{let s='';for(let i=0;i<4;i++)s+=chars[crypto.randomInt(0,chars.length)];return s;};
  return `ASHEO-${blk()}-${blk()}-${blk()}-${blk()}`;
}
function validateBearer(req) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return { ok: false, error: 'missing_bearer' };
  const token = auth.substring(7);
  try {
    const decoded = jwt.verify(token, PUBLIC_KEY || PRIVATE_KEY, { algorithms: ['ES256'], clockTolerance: 30 });
    return { ok: true, decoded };
  } catch (e) { return { ok: false, error: e.message }; }
}

/* ═══════════════════════════════════════════════
   GATEWAYS · RULES · CAMPAIGNS
   ═══════════════════════════════════════════════ */
const GATEWAYS = [
  { id:'default-stripe',    name:'Stripe',       pattern:'https://js.stripe.com/*',                enabled:true, isDefault:true },
  { id:'default-checkout',  name:'Checkout.com', pattern:'https://*.checkout.com/*',               enabled:true, isDefault:true },
  { id:'default-adyen',     name:'Adyen',        pattern:'https://*.adyen.com/*',                  enabled:true, isDefault:true },
  { id:'default-braintree', name:'Braintree',    pattern:'https://*.braintreegateway.com/*',       enabled:true, isDefault:true }
];
const RULES = [
  { id:'bypasser',  name:'Bypasser',      enabled:true, gateway:'*', priority:1 },
  { id:'cardfiller',name:'Card Filler',   enabled:true, gateway:'*', priority:2 },
  { id:'cvv',       name:'CVV Handler',   enabled:true, gateway:'*', priority:3 },
  { id:'premium',   name:'Premium Rules', enabled:true, gateway:'*', priority:10 }
];
const CAMPAIGNS = [
  { id:'default-1', name:'Default Campaign', enabled:true, createdAt:new Date().toISOString() }
];

/* ═══════════════════════════════════════════════
   TELEGRAM — Layout NEBULA v6.0
   ═══════════════════════════════════════════════ */
const TG_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
async function tgSend(chatId, text, keyboard=null) {
  try {
    const body = { chat_id:chatId, text, parse_mode:'HTML', disable_web_page_preview:true };
    if (keyboard) body.reply_markup = keyboard;
    await fetch(`${TG_API}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  } catch (e) { log('TG','send erro: '+e.message); }
}
async function tgEdit(chatId, messageId, text, keyboard=null) {
  try {
    const body = { chat_id:chatId, message_id:messageId, text, parse_mode:'HTML', disable_web_page_preview:true };
    if (keyboard) body.reply_markup = keyboard;
    await fetch(`${TG_API}/editMessageText`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  } catch (e) { log('TG','edit erro: '+e.message); }
}
async function tgAnswer(id, text='') {
  try {
    await fetch(`${TG_API}/answerCallbackQuery`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ callback_query_id:id, text }) });
  } catch {}
}

/* ───── Layouts ───── */
const UI = {
  header: () =>
    `<b>╭━━━『 ⚡ <i>MOZLINCE NEBULA</i> ⚡ 』━━━╮</b>\n` +
    `<b>┃</b>  <i>Premium License Engine</i>  <b>┃</b>\n` +
    `<b>┃</b>  <code>v6.0 · Asheo Systems</code>  <b>┃</b>\n` +
    `<b>╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯</b>`,
  divider: '━━━━━━━━━━━━━━━━━━━━━━━━━━',
  btn: (emoji, label) => `${emoji} ${label}`
};

function menuPrincipal() {
  const hora = new Date().toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' });
  return {
    texto:
`${UI.header()}

<b>🎛️ PAINEL DE CONTROLE</b>
<code>${UI.divider}</code>
<b>🕐</b> ${hora} · <b>🌐</b> Online · <b>🔐</b> ES256
<code>${UI.divider}</code>

<i>Selecione uma operação abaixo:</i>`,
    teclado: { inline_keyboard: [
      [{ text:'⚡ GERAR LICENÇA',   callback_data:'m_gerar' }],
      [{ text:'📋 Minhas Chaves',   callback_data:'m_listar' }, { text:'📊 Estatísticas', callback_data:'m_stats' }],
      [{ text:'🔗 Vincular',        callback_data:'m_vincular' }, { text:'🔓 Desvincular', callback_data:'m_desvincular' }],
      [{ text:'🔍 Consultar',       callback_data:'m_consultar' }],
      [{ text:'💰 Tabela de Preços', callback_data:'m_precos' }],
      [{ text:'📞 Suporte',         callback_data:'m_contacto' }, { text:'ℹ️ Ajuda', callback_data:'m_ajuda' }],
      [{ text:'⚠️ Zona de Perigo',  callback_data:'m_perigo' }]
    ]}
  };
}

async function cmdStart(chatId, msgId=null) {
  const m = menuPrincipal();
  if (msgId) await tgEdit(chatId, msgId, m.texto, m.teclado);
  else await tgSend(chatId, m.texto, m.teclado);
}

/* ───── Callback handler ───── */
async function handleCallback(cb) {
  const chatId = cb.message.chat.id, msgId = cb.message.message_id, data = cb.data, userId = String(cb.from.id);
  const isOwner = userId === String(OWNER_ID);

  /* suporte para não-owner */
  if (!isOwner && data === 'm_contacto') {
    await tgAnswer(cb.id, '📞 Enviado!');
    await tgSend(OWNER_ID, `📞 <b>Novo Pedido</b>\n👤 ${cb.from.first_name||'?'} ${cb.from.last_name||''}\n🆔 <code>${chatId}</code>`);
    return;
  }
  if (!isOwner) { await tgAnswer(cb.id, '⛔ Acesso restrito'); return; }

  try {
    /* HOME */
    if (data === 'm_home') { await tgAnswer(cb.id); return cmdStart(chatId, msgId); }

    /* GERAR */
    if (data === 'm_gerar') {
      await tgAnswer(cb.id, '💰 Escolha o plano');
      const kb = { inline_keyboard: [] };
      const entries = Object.entries(PACOTES);
      for (let i = 0; i < entries.length; i += 2) {
        const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome} · ${entries[i][1].preco}`, callback_data:`g_${entries[i][0]}` }];
        if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome} · ${entries[i+1][1].preco}`, callback_data:`g_${entries[i+1][0]}` });
        kb.inline_keyboard.push(linha);
      }
      kb.inline_keyboard.push([{ text:'🔙 Voltar ao Menu', callback_data:'m_home' }]);
      const texto =
`<b>╭──『 ⚡ GERAR LICENÇA 』──╮</b>
<code>${UI.divider}</code>
<i>Escolha o plano desejado:</i>

<b>🥉 3d</b>  · R$ 2,99
<b>🥈 7d</b>  · R$ 4,99
<b>🥇 15d</b> · R$ 7,99
<b>💎 30d</b> · R$ 12,99
<b>👑 90d</b> · R$ 29,99
<b>🏆 1a</b>  · R$ 79,99
<b>🔥 unli</b> · R$ 149,99

<code>${UI.divider}</code>`;
      await tgEdit(chatId, msgId, texto, kb);
      return;
    }

    /* Gerar chave específica */
    if (data.startsWith('g_')) {
      const pk = data.substring(2), p = PACOTES[pk];
      if (!p) { await tgAnswer(cb.id, '❌ Plano inválido'); return; }
      const chave = generateLicenseKey(), agora = Date.now(), expira = agora + p.dias*24*60*60*1000;
      await redisSet(chave, JSON.stringify({
        chave, plano:pk, planoNome:p.nome, preco:p.preco, dias:p.dias,
        criadaEm:agora, expiraEm:expira, ilimitada: p.dias>=3650,
        ativa:true, installId:null, ativadaEm:null
      }));
      log('OK', `Chave gerada: ${chave}`);
      await tgAnswer(cb.id, '✅ Gerada!');

      const progresso = p.dias>=3650 ? '∞ ILIMITADO' : progressBar(100);
      const texto =
`<b>╭──『 ✅ LICENÇA GERADA 』──╮</b>
<code>${UI.divider}</code>
<b>🔑 Chave:</b>
<code>${chave}</code>
<code>${UI.divider}</code>
<b>${p.emoji} Plano:</b>  ${p.nome}
<b>💰 Preço:</b>  ${p.preco}
<b>📅 Emitida:</b> ${formatDate(agora)}
<b>⏰ Expira:</b>  ${p.dias>=3650?'Nunca':formatDate(expira)}
<b>⌛ Duração:</b> ${p.dias>=3650?'Ilimitada':humanTime(expira-agora)}
<code>${UI.divider}</code>
<b>${progresso}</b>
<code>${UI.divider}</code>
<i>Compartilhe a chave com o cliente.</i>`;
      await tgEdit(chatId, msgId, texto, { inline_keyboard: [
        [{ text:'🔍 Ver Detalhes', callback_data:`c_${chave}` }],
        [{ text:'📋 Copiar Chave',  callback_data:`copy_${chave}` }],
        [{ text:'🔙 Menu Principal', callback_data:'m_home' }]
      ]});
      return;
    }

    /* COPY (feedback visual) */
    if (data.startsWith('copy_')) {
      await tgAnswer(cb.id, '👆 Toque na chave para copiar');
      return;
    }

    /* LISTAR */
    if (data === 'm_listar') {
      await tgAnswer(cb.id, '📋 Carregando...');
      const keys = await redisKeys('ASHEO-*');
      if (keys.length === 0) {
        await tgEdit(chatId, msgId,
`<b>📋 MINHAS LICENÇAS</b>
<code>${UI.divider}</code>
<i>Nenhuma licença cadastrada.</i>`,
          { inline_keyboard: [[{ text:'⚡ Gerar Agora', callback_data:'m_gerar' }],[{ text:'🔙 Voltar', callback_data:'m_home' }]] });
        return;
      }
      let txt = `<b>📋 MINHAS LICENÇAS</b>  <code>(${keys.length})</code>\n<code>${UI.divider}</code>\n`;
      for (let i = 0; i < Math.min(keys.length, 20); i++) {
        const l = await redisGet(keys[i]); if (!l) continue;
        const exp = l.ilimitada ? '∞' : humanTime((l.expiraEm||0) - Date.now());
        const statusIcon = l.ativa ? '🟢' : '🔴';
        const linkIcon   = l.installId ? '🔗' : '⚪';
        txt += `${statusIcon}${linkIcon} <code>${keys[i]}</code>\n`;
        txt += `     <i>${l.planoNome} · ${exp}</i>\n`;
      }
      if (keys.length > 20) txt += `\n<i>… +${keys.length-20} chaves ocultas</i>`;
      await tgEdit(chatId, msgId, txt, { inline_keyboard: [
        [{ text:'🔄 Atualizar', callback_data:'m_listar' }],
        [{ text:'🔙 Voltar',    callback_data:'m_home' }]
      ]});
      return;
    }

    /* STATS */
    if (data === 'm_stats') {
      await tgAnswer(cb.id, '📊 Calculando...');
      const keys = await redisKeys('ASHEO-*');
      let ativas=0, expiradas=0, vinc=0, unli=0, receita=0;
      for (const k of keys) {
        const l = await redisGet(k); if (!l) continue;
        if (l.ativa) ativas++;
        if (!l.ilimitada && l.expiraEm < Date.now()) expiradas++;
        if (l.installId) vinc++;
        if (l.ilimitada) unli++;
        if (l.preco) receita += parseFloat(String(l.preco).replace(/[^\d.,]/g,'').replace(',','.')) || 0;
      }
      const taxa = keys.length ? Math.round((ativas/keys.length)*100) : 0;
      const texto =
`<b>╭──『 📊 ESTATÍSTICAS 』──╮</b>
<code>${UI.divider}</code>
<b>🔑 Total:</b>     <code>${keys.length}</code>
<b>🟢 Ativas:</b>    <code>${ativas}</code>
<b>🔴 Expiradas:</b> <code>${expiradas}</code>
<b>🔗 Vinculadas:</b><code>${vinc}</code>
<b>🔥 Ilimitadas:</b><code>${unli}</code>
<code>${UI.divider}</code>
<b>💰 Receita:</b> R$ ${receita.toFixed(2)}
<b>📈 Taxa ativa:</b> ${taxa}%  <code>${progressBar(taxa)}</code>
<code>${UI.divider}</code>`;
      await tgEdit(chatId, msgId, texto, { inline_keyboard: [
        [{ text:'🔄 Atualizar', callback_data:'m_stats' }],
        [{ text:'🔙 Voltar',    callback_data:'m_home' }]
      ]});
      return;
    }

    /* VINCULAR / DESVINCULAR / CONSULTAR */
    if (data === 'm_vincular') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
`<b>🔗 VINCULAR LICENÇA</b>
<code>${UI.divider}</code>
<i>Envie o comando no chat:</i>

<code>/activate &lt;installId&gt; &lt;chave&gt;</code>

<b>Exemplo:</b>
<code>/activate abc123-def456 ASHEO-XXXX-XXXX-XXXX-XXXX</code>`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] });
      return;
    }
    if (data === 'm_desvincular') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
`<b>🔓 DESVINCULAR LICENÇA</b>
<code>${UI.divider}</code>
<code>/desvincular &lt;chave&gt;</code>`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] });
      return;
    }
    if (data === 'm_consultar') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
`<b>🔍 CONSULTAR LICENÇA</b>
<code>${UI.divider}</code>
<code>/status &lt;chave&gt;</code>`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] });
      return;
    }

    /* PREÇOS */
    if (data === 'm_precos') {
      await tgAnswer(cb.id);
      let txt = `<b>╭──『 💰 TABELA DE PREÇOS 』──╮</b>\n<code>${UI.divider}</code>\n\n`;
      for (const [,p] of Object.entries(PACOTES)) {
        txt += `<b>${p.emoji}</b> ${p.nome.padEnd(12)} <b>→</b> <code>${p.preco}</code>\n`;
      }
      txt += `\n<code>${UI.divider}</code>\n<i>Pagamento via PIX/cripto.</i>`;
      await tgEdit(chatId, msgId, txt, { inline_keyboard: [
        [{ text:'📞 Falar com Suporte', callback_data:'m_contacto' }],
        [{ text:'⚡ Gerar Agora',       callback_data:'m_gerar' }],
        [{ text:'🔙 Voltar',            callback_data:'m_home' }]
      ]});
      return;
    }

    /* CONTACTO */
    if (data === 'm_contacto') {
      await tgAnswer(cb.id, '📞');
      await tgEdit(chatId, msgId,
`<b>╭──『 📞 SUPORTE 』──╮</b>
<code>${UI.divider}</code>
<b>✉️ Telegram:</b> @asheo_support
<b>💬 Resposta:</b> até 24h
<code>${UI.divider}</code>
<i>Descreva seu problema com detalhes.</i>`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] });
      return;
    }

    /* AJUDA */
    if (data === 'm_ajuda') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
`<b>╭──『 ℹ️ AJUDA 』──╮</b>
<code>${UI.divider}</code>
<b>📋 Comandos disponíveis:</b>

<code>/start</code>        — Abre o menu
<code>/gerar</code>        — Gera nova licença
<code>/listar</code>       — Lista licenças
<code>/stats</code>        — Estatísticas
<code>/status &lt;k&gt;</code>   — Consulta chave
<code>/activate &lt;i&gt; &lt;k&gt;</code> — Vincula
<code>/desvincular &lt;k&gt;</code> — Desvincula
<code>/revogar &lt;k&gt;</code>  — Revoga
<code>/deletar &lt;k&gt;</code>  — Deleta

<code>${UI.divider}</code>`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] });
      return;
    }

    /* PERIGO */
    if (data === 'm_perigo') {
      await tgAnswer(cb.id, '⚠️ Zona crítica');
      await tgEdit(chatId, msgId,
`<b>╭──『 ⚠️ ZONA DE PERIGO 』──╮</b>
<code>${UI.divider}</code>
<b>🔴 Estas ações são IRREVERSÍVEIS</b>
<code>${UI.divider}</code>
<i>Escolha com cuidado:</i>`,
        { inline_keyboard: [
          [{ text:'🗑️ Deletar Ativas', callback_data:'danger_ativas' }],
          [{ text:'💣 Deletar TUDO',   callback_data:'danger_tudo' }],
          [{ text:'🔙 Voltar',         callback_data:'m_home' }]
        ]});
      return;
    }
    if (data === 'danger_ativas') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
`<b>⚠️ CONFIRMAR EXCLUSÃO</b>
<code>${UI.divider}</code>
Todas as licenças <b>ativas</b> serão deletadas.`,
        { inline_keyboard: [
          [{ text:'✅ SIM, deletar', callback_data:'confirm_ativas' }],
          [{ text:'❌ Cancelar',     callback_data:'m_perigo' }]
        ]});
      return;
    }
    if (data === 'danger_tudo') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
`<b>💣 CONFIRMAR EXCLUSÃO TOTAL</b>
<code>${UI.divider}</code>
<b>⚠️ ISSO DELETA TUDO</b>`,
        { inline_keyboard: [
          [{ text:'💣 SIM, deletar TUDO', callback_data:'confirm_tudo' }],
          [{ text:'❌ Cancelar',          callback_data:'m_perigo' }]
        ]});
      return;
    }
    if (data === 'confirm_ativas') {
      await tgAnswer(cb.id, '⏳ Processando...');
      const keys = await redisKeys('ASHEO-*'); let n = 0;
      for (const k of keys) { const l = await redisGet(k); if (l && l.ativa) { await redisDel(k); n++; } }
      await tgEdit(chatId, msgId, `✅ <b>${n}</b> licenças ativas removidas.`, { inline_keyboard: [[{ text:'🔙 Menu', callback_data:'m_home' }]] });
      return;
    }
    if (data === 'confirm_tudo') {
      await tgAnswer(cb.id, '💣 Destruindo...');
      const keys = await redisKeys('ASHEO-*');
      for (const k of keys) await redisDel(k);
      await tgEdit(chatId, msgId, `💣 <b>${keys.length}</b> registros apagados.`, { inline_keyboard: [[{ text:'🔙 Menu', callback_data:'m_home' }]] });
      return;
    }

    /* DETALHES */
    if (data.startsWith('c_')) {
      const k = data.substring(2), l = await redisGet(k);
      if (!l) { await tgAnswer(cb.id, '❌ Não encontrada'); return; }
      await tgAnswer(cb.id);
      const resta = l.ilimitada ? '∞' : humanTime((l.expiraEm||0) - Date.now());
      const pct = l.ilimitada ? 100 : Math.max(0, Math.min(100, Math.round(((l.expiraEm-Date.now())/(l.dias*86400000))*100)));
      const texto =
`<b>╭──『 🔍 DETALHES 』──╮</b>
<code>${UI.divider}</code>
<b>🔑 Chave:</b> <code>${k}</code>
<code>${UI.divider}</code>
<b>${PACOTES[l.plano]?.emoji||'📦'} Plano:</b> ${l.planoNome}
<b>💰 Preço:</b> ${l.preco}
<b>📅 Emitida:</b> ${formatDate(l.criadaEm)}
<b>⏰ Expira:</b> ${l.ilimitada?'Nunca':formatDate(l.expiraEm)}
<b>⌛ Restante:</b> ${resta}
<code>${UI.divider}</code>
<b>🔗 Install:</b> ${l.installId?`<code>${l.installId}</code>`:'<i>não vinculada</i>'}
<b>📌 Status:</b> ${l.ativa?'🟢 Ativa':'🔴 Revogada'}
<code>${UI.divider}</code>
<code>${progressBar(pct)} ${pct}%</code>`;
      await tgEdit(chatId, msgId, texto, { inline_keyboard: [
        [{ text: l.installId?'🔓 Desvincular':'🔗 Vincular', callback_data: l.installId?`dv_${k}`:`v_${k}` }],
        [{ text:'❌ Revogar', callback_data:`rv_${k}` }, { text:'🗑️ Deletar', callback_data:`dl_${k}` }],
        [{ text:'🔙 Menu',   callback_data:'m_home' }]
      ]});
      return;
    }
    if (data.startsWith('v_')) { const k = data.substring(2); await tgAnswer(cb.id); await tgEdit(chatId, msgId,
      `<b>🔗 VINCULAR</b>\n<code>/activate &lt;installId&gt; ${k}</code>`,
      { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:`c_${k}` }]] }); return; }
    if (data.startsWith('dv_')) {
      const k = data.substring(3), l = await redisGet(k);
      if (l) { l.installId = null; l.ativadaEm = null; await redisSet(k, JSON.stringify(l)); }
      await tgAnswer(cb.id, '🔓 Desvinculada');
      await tgEdit(chatId, msgId, `✅ Licença desvinculada.`, { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:`c_${k}` }]] });
      return;
    }
    if (data.startsWith('rv_')) {
      const k = data.substring(3), l = await redisGet(k);
      if (l) { l.ativa = false; await redisSet(k, JSON.stringify(l)); }
      await tgAnswer(cb.id, '❌ Revogada');
      await tgEdit(chatId, msgId, `❌ Licença revogada.`, { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:`c_${k}` }]] });
      return;
    }
    if (data.startsWith('dl_')) {
      const k = data.substring(3);
      await redisDel(k);
      await tgAnswer(cb.id, '🗑️ Deletada');
      await tgEdit(chatId, msgId, `🗑️ Licença deletada.`, { inline_keyboard: [[{ text:'🔙 Menu', callback_data:'m_home' }]] });
      return;
    }

    await tgAnswer(cb.id);
  } catch (e) {
    log('ERRO', 'Callback: ' + e.message);
    try { await tgAnswer(cb.id, '❌ Erro interno'); } catch {}
  }
}

/* ───── Message handler ───── */
async function handleMessage(msg) {
  const chatId = msg.chat.id, userId = String(msg.from.id);
  const texto = (msg.text || '').trim();
  const args = texto.replace(/\n/g,' ').split(' ').filter(a => a.length > 0);
  const cmd = (args[0] || '').toLowerCase();
  const isOwner = userId === String(OWNER_ID);

  if (!isOwner) {
    if (cmd === '/start' || cmd === '/contacto' || cmd === '/ajuda') {
      await tgSend(chatId,
`<b>👋 Bem-vindo ao Mozlince Nebula</b>
<code>${UI.divider}</code>
<i>Se deseja adquirir uma licença, clique abaixo:</i>`,
        { inline_keyboard: [[{ text:'📞 CONTACTAR SUPORTE', callback_data:'m_contacto' }]] });
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
      await tgSend(chatId, `<b>⚡ GERAR LICENÇA</b>`, kb);
      return;
    }

    if (cmd === '/listar') {
      const keys = await redisKeys('ASHEO-*');
      if (keys.length === 0) { await tgSend(chatId, `📭 Nenhuma licença.`); return; }
      let txt = `<b>📋 LICENÇAS (${keys.length})</b>\n<code>${UI.divider}</code>\n`;
      for (let i = 0; i < Math.min(keys.length, 30); i++) {
        const l = await redisGet(keys[i]); if (!l) continue;
        const exp = l.ilimitada ? '∞' : humanTime((l.expiraEm||0) - Date.now());
        txt += `${l.ativa?'🟢':'🔴'} <code>${keys[i]}</code> — <i>${l.planoNome} · ${exp}</i>\n`;
      }
      await tgSend(chatId, txt);
      return;
    }

    if (cmd === '/status') {
      const k = args[1];
      if (!k) { await tgSend(chatId, `⚠️ Uso: <code>/status &lt;chave&gt;</code>`); return; }
      const l = await redisGet(k);
      if (!l) { await tgSend(chatId, `❌ Não encontrada`); return; }
      const resta = l.ilimitada ? '∞' : humanTime((l.expiraEm||0) - Date.now());
      await tgSend(chatId,
`<b>🔍 STATUS</b>
<code>${UI.divider}</code>
<b>🔑</b> <code>${k}</code>
<b>${PACOTES[l.plano]?.emoji||'📦'} ${l.planoNome}</b>
💰 ${l.preco}
📅 ${formatDate(l.criadaEm)}
⏰ ${l.ilimitada?'Nunca':formatDate(l.expiraEm)}
⌛ ${resta}
🔗 ${l.installId?`<code>${l.installId}</code>`:'não vinculada'}
📌 ${l.ativa?'🟢 Ativa':'🔴 Revogada'}`);
      return;
    }

    if (cmd === '/activate') {
      const chave = args[args.length-1], installId = args.slice(1, args.length-1).join(' ');
      if (!installId || !chave) { await tgSend(chatId, `⚠️ /activate &lt;id&gt; &lt;chave&gt;`); return; }
      const l = await redisGet(chave);
      if (!l) { await tgSend(chatId, `❌ Chave inválida`); return; }
      if (l.installId) { await tgSend(chatId, `⚠️ Já vinculada a <code>${l.installId}</code>`); return; }
      l.installId = installId; l.ativadaEm = Date.now();
      await redisSet(chave, JSON.stringify(l));
      await tgSend(chatId, `✅ <b>Vinculada!</b>\n🔑 <code>${chave}</code>\n🔗 <code>${installId}</code>`);
      return;
    }

    if (cmd === '/desvincular') {
      const k = args[1];
      if (!k) { await tgSend(chatId, `⚠️ Uso: /desvincular &lt;chave&gt;`); return; }
      const l = await redisGet(k);
      if (!l) { await tgSend(chatId, `❌`); return; }
      l.installId = null; l.ativadaEm = null;
      await redisSet(k, JSON.stringify(l));
      await tgSend(chatId, `🔓 Desvinculada`);
      return;
    }

    if (cmd === '/revogar') {
      const k = args[1];
      if (!k) { await tgSend(chatId, `⚠️`); return; }
      const l = await redisGet(k);
      if (!l) { await tgSend(chatId, `❌`); return; }
      l.ativa = false;
      await redisSet(k, JSON.stringify(l));
      await tgSend(chatId, `❌ Revogada`);
      return;
    }

    if (cmd === '/deletar') {
      const k = args[1];
      if (!k) { await tgSend(chatId, `⚠️`); return; }
      await redisDel(k);
      await tgSend(chatId, `🗑️ Deletada`);
      return;
    }

    if (cmd === '/stats') {
      const keys = await redisKeys('ASHEO-*');
      let ativas=0, exp=0, vinc=0, unli=0;
      for (const k of keys) {
        const l = await redisGet(k); if (!l) continue;
        if (l.ativa) ativas++;
        if (!l.ilimitada && l.expiraEm < Date.now()) exp++;
        if (l.installId) vinc++;
        if (l.ilimitada) unli++;
      }
      await tgSend(chatId,
`<b>📊 ESTATÍSTICAS</b>
<code>${UI.divider}</code>
🔑 Total: <code>${keys.length}</code>
🟢 Ativas: <code>${ativas}</code>
🔴 Expiradas: <code>${exp}</code>
🔗 Vinculadas: <code>${vinc}</code>
🔥 Ilimitadas: <code>${unli}</code>`);
      return;
    }

    await tgSend(chatId, `❓ Comando desconhecido. Use /start`);
  } catch (e) { log('ERRO', 'Message: ' + e.message); }
}

app.post('/telegram-webhook', async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  try {
    if (update.callback_query) return handleCallback(update.callback_query);
    if (update.message && update.message.text) return handleMessage(update.message);
  } catch (e) { log('ERRO', 'Webhook: ' + e.message); }
});

/* ═══════════════════════════════════════════════
   API REST — v6.0 (todas as rotas + aliases)
   ═══════════════════════════════════════════════ */

/* ── Health / Version / Status ── */
const healthHandler = (req, res) => res.json({
  ok: true, status: 'healthy', uptime: Math.floor(process.uptime()),
  version: '6.0', codename: 'Nebula', timestamp: new Date().toISOString()
});
app.get('/', (req, res) => res.json({ ok: true, service: 'mozlince-nebula', version: '6.0', status: 'live' }));
app.get('/v1/health', healthHandler);
app.get('/api/v1/health', healthHandler);
app.get('/health', healthHandler);

const versionHandler = (req, res) => res.json({
  ok: true, version: '6.0', codename: 'Nebula', api: 'v1',
  minClientVersion: '1.0.0', timestamp: new Date().toISOString()
});
app.get('/v1/version', versionHandler);
app.get('/api/v1/version', versionHandler);

const statusHandler = (req, res) => res.json({
  ok: true, service: 'mozlince-nebula', version: '6.0', hora: new Date().toISOString()
});
app.get('/v1/status', statusHandler);
app.get('/api/v1/status', statusHandler);

/* ── Bootstrap ── */
function bootstrapHandler(req, res) {
  const auth = validateBearer(req);
  log('BOOT', `Bootstrap (auth=${auth.ok})`);
  res.json({
    ok: true, version: '6.0', codename: 'Nebula', apiVersion: 'v1',
    issuedAt: new Date().toISOString(), serverTime: Date.now(),
    source: 'premium', sourceType: 'server', isFounder: true, tier: 'premium', kind: 'premium',
    config: {
      apiBase: 'https://mozlince.onrender.com',
      featuresEnabled: true, premiumEnabled: true, syncEnabled: true,
      gatewayMode: 'default', telemetryEnabled: false,
      retryAfterMs: 5000, heartbeatMs: 60000
    },
    flags: { bootstrapReady: true, exclusiveEnabled: true, rulesEnabled: true, premium: true },
    endpoints: {
      activate:'/v1/activate', featureActivate:'/v1/feature/activate', deactivate:'/v1/deactivate',
      verify:'/v1/verify', bootstrap:'/v1/bootstrap', rules:'/v1/rules',
      exclusive:'/v1/exclusive/manifest', exclusiveSync:'/v1/exclusive/sync',
      gateways:'/v1/gateways', campaign:'/v1/campaign', dashboard:'/v1/dashboard',
      health:'/v1/health', version:'/v1/version'
    },
    features: mapFeatures(true), capabilities: mapCapabilities(true),
    limits: { ...PREMIUM_LIMITS }, scope: PREMIUM_SCOPE
  });
}
app.get('/v1/bootstrap', bootstrapHandler);
app.get('/api/v1/bootstrap', bootstrapHandler);

/* ── Rules ── */
function rulesHandler(req, res) {
  const auth = validateBearer(req);
  const isPremium = auth.ok && (auth.decoded.tier === 'premium' || auth.decoded.scope);
  log('API', `Rules (auth=${auth.ok}, premium=${isPremium})`);
  res.json({
    ok: true, version: 3, updatedAt: new Date().toISOString(),
    source: 'premium', tier: 'premium',
    scope: isPremium ? PREMIUM_SCOPE : ['free'],
    rules: isPremium ? RULES : RULES.slice(0, 1),
    serverTime: Date.now()
  });
}
app.get('/v1/rules', rulesHandler);
app.get('/api/v1/rules', rulesHandler);
app.get('/v1/rules/sync', rulesHandler);
app.get('/api/v1/sync', rulesHandler);

/* ── Exclusive ── */
function exclusiveHandler(req, res) {
  const auth = validateBearer(req);
  log('API', `Exclusive manifest (auth=${auth.ok})`);
  res.json({
    ok: true, source: 'premium', tier: 'premium',
    manifest: {
      version: '1.6.2', version_name: '1.6.2',
      generatedAt: new Date().toISOString(), minVersion: '1.0.0',
      exclusiveFeatures: Object.keys(PREMIUM_FEATURES),
      rules: RULES, gateways: GATEWAYS,
      signature: crypto.randomBytes(64).toString('hex')
    },
    cachedAt: Date.now(),
    expiresAt: Date.now() + (23 * 3600 * 1000)
  });
}
app.get('/v1/exclusive/manifest', exclusiveHandler);
app.get('/api/v1/manifest', exclusiveHandler);

function exclusiveSyncHandler(req, res) {
  const auth = validateBearer(req);
  res.json({
    ok: true, source: 'premium', tier: 'premium',
    manifest: {
      version: '1.6.2', generatedAt: new Date().toISOString(),
      rules: RULES, gateways: GATEWAYS,
      signature: crypto.randomBytes(64).toString('hex')
    },
    cachedAt: Date.now()
  });
}
app.get('/v1/exclusive/sync', exclusiveSyncHandler);
app.get('/api/v1/exclusive/sync', exclusiveSyncHandler);

/* ── Gateways ── */
function gatewaysHandler(req, res) {
  res.json({ ok: true, source: 'premium', tier: 'premium', version: 1, gateways: GATEWAYS, serverTime: Date.now() });
}
app.get('/v1/gateways', gatewaysHandler);
app.get('/api/v1/gateways', gatewaysHandler);

/* ── Campaign ── */
function campaignHandler(req, res) {
  res.json({ ok: true, source: 'premium', tier: 'premium', campaigns: CAMPAIGNS, serverTime: Date.now() });
}
app.get('/v1/campaign', campaignHandler);
app.get('/api/v1/campaign', campaignHandler);

/* ── Dashboard ── */
function dashboardHandler(req, res) {
  const auth = validateBearer(req);
  const ok = auth.ok && auth.decoded.tier === 'premium';
  res.json({
    ok: true, source: ok ? 'premium' : 'free', sourceType: 'server', isFounder: true,
    dashboard: {
      tier: ok ? 'premium' : 'free',
      source: ok ? 'premium' : 'free',
      seat: auth.ok ? 1 : 0,
      seats: auth.ok ? 1 : 0,
      installId: auth.ok ? auth.decoded.sub : null,
      expiresAt: auth.ok ? auth.decoded.exp * 1000 : null,
      features: ok ? mapFeatures(true) : mapFeatures(false),
      capabilities: ok ? mapCapabilities(true) : mapCapabilities(false),
      limits: ok ? PREMIUM_LIMITS : FREE_LIMITS,
      scope: ok ? PREMIUM_SCOPE : ['free']
    },
    serverTime: Date.now()
  });
}
app.get('/v1/dashboard', dashboardHandler);
app.get('/api/v1/dashboard', dashboardHandler);

/* ── Entitlement ── */
function entitlementHandler(req, res) {
  const auth = validateBearer(req);
  if (!auth.ok) return res.status(401).json({ ok: false, error: 'missing_bearer' });
  res.json({
    ok: true, source: 'premium', sourceType: 'server', isFounder: true,
    tier: 'premium', kind: 'premium', active: true, isPremium: true, isVerified: true,
    installId: auth.decoded.sub, plan: 'premium', planDisplayName: 'Premium',
    scope: PREMIUM_SCOPE, features: mapFeatures(true), capabilities: mapCapabilities(true),
    limits: { ...PREMIUM_LIMITS }, exp: auth.decoded.exp * 1000,
    serverTime: Date.now()
  });
}
app.get('/v1/entitlement', entitlementHandler);
app.get('/api/v1/entitlement', entitlementHandler);

/* ── Premium definitions ── */
function premiumDefHandler(req, res) {
  res.json({
    ok: true, source: 'premium', tier: 'premium',
    features: PREMIUM_FEATURES, capabilities: PREMIUM_CAPABILITIES,
    premiumLimits: PREMIUM_LIMITS, freeLimits: FREE_LIMITS,
    scope: PREMIUM_SCOPE, version: '6.0'
  });
}
app.get('/v1/premium/definitions', premiumDefHandler);
app.get('/api/v1/premium/definitions', premiumDefHandler);

/* ── Planos ── */
function planosHandler(req, res) {
  res.json({
    ok: true,
    planos: Object.entries(PACOTES).map(([id,p]) => ({ id, nome:p.nome, dias:p.dias, preco:p.preco, emoji:p.emoji }))
  });
}
app.get('/v1/planos', planosHandler);
app.get('/api/v1/planos', planosHandler);

/* ── Manifest check / update ── */
function manifestCheckHandler(req, res) {
  res.json({ ok: true, latest: '1.6.2', minVersion: '1.0.0', channel: req.query.channel || 'stable', serverTime: Date.now() });
}
app.get('/v1/manifest/check', manifestCheckHandler);
app.get('/api/v1/update', manifestCheckHandler);
app.get('/api/v1/manifest', manifestCheckHandler);

/* ── Packs ── */
function packsHandler(req, res) {
  const id = req.params.id;
  res.json({
    ok: true,
    pack: { id, version: '1.0.0', data: null, signature: crypto.randomBytes(32).toString('hex') },
    serverTime: Date.now()
  });
}
app.get('/v1/packs/:id', packsHandler);
app.get('/api/v1/packs/:id', packsHandler);

/* ── Telemetry ── */
function telemetryHandler(req, res) {
  log('API', 'Telemetry recebida (ignorada)');
  res.json({ ok: true, received: true, serverTime: Date.now() });
}
app.post('/v1/telemetry', telemetryHandler);
app.post('/api/v1/telemetry', telemetryHandler);

/* ═══════════════════════════════════════════════
   ACTIVATE
   ═══════════════════════════════════════════════ */
async function activateHandler(req, res) {
  const inicio = Date.now();
  const { installId, licenseKey, clientTag } = req.body || {};
  log('INFO', `Activate: installId=${installId ? installId.substring(0,12)+'...' : '?'} | key=${licenseKey ? normalizeKey(licenseKey).substring(0,18)+'...' : '(vazia)'} | tag=${clientTag || '?'}`);

  /* MODO 1: Feature activation */
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
      kind: 'feature', type: 'feature', tier: 'premium', source: 'premium', isFounder: true,
      scope: [feature, 'premium'],
      iat: now, nbf: now - 5, exp: now + 300, jti: crypto.randomUUID()
    }, PRIVATE_KEY, { algorithm: 'ES256' });
    log('FEAT', `✅ ${feature} | ${auth.decoded.sub} | ${Date.now()-inicio}ms`);
    return res.json({ ok: true, token, feature, expires_in: 300, exp: now + 300 });
  }

  /* MODO 2: Ativação normal */
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
      token, tier: 'premium', kind: 'premium', source: 'premium', sourceType: 'server', isFounder: true,
      seat: 1, seats: 1, gwPass: null,
      plan: 'premium', planDisplayName: 'Premium',
      expires_in: lic.ilimitada ? -1 : Math.floor((lic.expiraEm - Date.now())/1000),
      licenseKey: keyNorm
    });
  } catch (e) { return res.status(500).json({ error: 'internal', message: e.message }); }
}
app.post('/v1/activate', activateHandler);
app.post('/api/v1/activate', activateHandler);
app.post('/api/v1/license/activate', activateHandler);

/* ── Feature activate ── */
async function featureActivateHandler(req, res) {
  const auth = validateBearer(req);
  if (!auth.ok) return res.status(401).json({ ok: false, error: 'missing_bearer' });
  const feature = (req.body && req.body.feature) || req.query.feature;
  if (!feature) return res.status(400).json({ ok: false, error: 'missing_feature' });
  if (!PREMIUM_FEATURES[feature]) return res.status(404).json({ ok: false, error: 'unknown_feature' });
  const now = Math.floor(Date.now()/1000);
  const token = jwt.sign({
    sub: auth.decoded.sub, installId: auth.decoded.sub, feature,
    kind: 'feature', type: 'feature', tier: 'premium', source: 'premium', isFounder: true,
    scope: [feature, 'premium'],
    iat: now, nbf: now - 5, exp: now + 300, jti: crypto.randomUUID()
  }, PRIVATE_KEY, { algorithm: 'ES256' });
  res.json({ ok: true, token, feature, expires_in: 300, exp: now + 300 });
}
app.post('/v1/feature/activate', featureActivateHandler);
app.get('/v1/feature/activate', featureActivateHandler);
app.post('/api/v1/feature/activate', featureActivateHandler);
app.get('/api/v1/feature/activate', featureActivateHandler);

/* ── Deactivate ── */
async function deactivateHandler(req, res) {
  const { installId, licenseKey } = req.body || {};
  if (licenseKey) {
    const lic = await redisGet(licenseKey);
    if (lic && lic.installId === installId) {
      lic.installId = null; lic.ativadaEm = null;
      await redisSet(licenseKey, JSON.stringify(lic));
    }
  }
  res.json({ ok: true, message: 'Desativado' });
}
app.post('/v1/deactivate', deactivateHandler);
app.post('/api/v1/deactivate', deactivateHandler);
app.post('/api/v1/license/deactivate', deactivateHandler);

/* ── Verify ── */
function verifyHandler(req, res) {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'missing_token' });
  try {
    const decoded = jwt.verify(token, PUBLIC_KEY || PRIVATE_KEY, { algorithms: ['ES256'], clockTolerance: 30 });
    return res.json({ ok: true, valido: true, dados: decoded });
  } catch (e) { return res.status(401).json({ ok: false, valido: false, erro: e.message }); }
}
app.post('/v1/verify', verifyHandler);
app.post('/api/v1/verify', verifyHandler);
app.post('/api/v1/license/verify', verifyHandler);
app.post('/verificar-licenca', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ erro: 'Token obrigatorio' });
  try {
    const decoded = jwt.verify(token, PUBLIC_KEY || PRIVATE_KEY, { algorithms: ['ES256'], clockTolerance: 30 });
    res.json({ valido: true, dados: decoded });
  } catch (err) { res.status(401).json({ valido: false, erro: err.message }); }
});

/* ── Heartbeat ── */
function heartbeatHandler(req, res) {
  const auth = validateBearer(req);
  if (!auth.ok) return res.status(401).json({ ok: false, error: 'missing_bearer' });
  res.json({ ok: true, alive: true, serverTime: Date.now(), expiresAt: auth.decoded.exp * 1000 });
}
app.post('/v1/heartbeat', heartbeatHandler);
app.get('/v1/heartbeat', heartbeatHandler);
app.post('/api/v1/heartbeat', heartbeatHandler);
app.get('/api/v1/heartbeat', heartbeatHandler);

/* ═══════════════════════════════════════════════
   404 fallback
   ═══════════════════════════════════════════════ */
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'not_found', path: req.path });
});

/* ═══════════════════════════════════════════════
   START
   ═══════════════════════════════════════════════ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  banner();
  log('SYS', `🚀 Servidor Mozlince Nebula v6.0 na porta ${PORT}`);
  log('SYS', `Chave: ${ORIGEM}`);
  log('SYS', `Redis: ${UPSTASH_URL ? 'OK' : 'FALTA'}`);
  log('SYS', `Telegram: ${TELEGRAM_TOKEN ? 'OK' : 'FALTA'}`);
  log('SYS', `Features: ${Object.keys(PREMIUM_FEATURES).length} | Scope: ${PREMIUM_SCOPE.length} itens`);
  log('ALIAS', `✅ Rotas /v1/... E /api/v1/... (compatibilidade dupla)`);
  log('ALIAS', `✅ /api/v1/license/activate, /api/v1/license/deactivate, /api/v1/license/verify`);
  log('ALIAS', `✅ /api/v1/entitlement, /api/v1/manifest, /api/v1/sync, /api/v1/update`);
  log('ALIAS', `✅ /api/v1/telemetry, /api/v1/packs/:id, /api/v1/heartbeat`);
  log('ALIAS', `🎨 Layout Nebula: cards, progressBar, badges`);
});

process.on('uncaughtException', e => log('ERRO','Uncaught: '+e.message));
process.on('unhandledRejection', e => log('ERRO','Rejection: '+e));
