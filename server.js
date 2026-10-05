require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const C = { r:'\x1b[0m', b:'\x1b[1m', g:'\x1b[32m', y:'\x1b[33m', red:'\x1b[31m', c:'\x1b[36m', m:'\x1b[35m', bl:'\x1b[34m', gr:'\x1b[90m' };
function log(t, m) {
  const ts = new Date().toISOString().replace('T',' ').substring(0,19);
  const cores = { INFO:C.c, OK:C.g, WARN:C.y, ERRO:C.red, SYS:C.m, ATIV:C.bl, BOT:C.c };
  console.log(`${C.gr}[${ts}]${C.r} ${cores[t]||C.r}${C.b}[${t}]${C.r} ${m}`);
}

// ═══════════════════════════════════════════════
// CHAVES
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
// 🔥 PREMIUM DEFINITIONS — nomes EXATOS da extensão
// Baseado em entitlement.js / premium-gate.js
// ═══════════════════════════════════════════════
const PREMIUM_FEATURES = {
  // Do entitlement.js — FEATURES que a extensão verifica
  browser_mods:         { enabled: true, label: 'Browser Mods',         description: 'Spoof fingerprint and rotate user-agent' },
  rule_ops_lab:         { enabled: true, label: 'Rule Ops Lab',         description: 'Bulk rule ops, presets, conflict scan' },
  live_injection_hud:   { enabled: true, label: 'Live Injection HUD',   description: 'On-page overlay showing each card swap' },
  algo_v2:              { enabled: true, label: 'Algo V2',              description: 'Advanced algorithm v2' },
  exclusive_rules:      { enabled: true, label: 'Exclusive Rules',      description: 'Premium server rules' },
  advanced_automation:  { enabled: true, label: 'Advanced Automation',  description: 'Automation premium' },
  multi_account:        { enabled: true, label: 'Multi Account',        description: 'Multiple accounts support' },
  custom_export:        { enabled: true, label: 'Custom Export',        description: 'Export custom data' },
  api_access:           { enabled: true, label: 'API Access',           description: 'Direct API access' }
};

const PREMIUM_CAPABILITIES = {
  priority_support: { enabled: true, label: 'Priority Support',   description: 'Atendimento prioritário' },
  custom_webhooks:  { enabled: true, label: 'Custom Webhooks',    description: 'Webhooks personalizados' },
  cloud_sync:       { enabled: true, label: 'Cloud Sync',         description: 'Sincronização na cloud' },
  bulk_actions:     { enabled: true, label: 'Bulk Actions',       description: 'Ações em massa' },
  advanced_analytics:{ enabled: true, label: 'Advanced Analytics',description: 'Analytics avançado' }
};

const PREMIUM_LIMITS = {
  max_accounts: Infinity,
  daily_actions: Infinity,
  max_templates: Infinity,
  history_days: Infinity,
  export_limit: Infinity
};

const FREE_LIMITS = {
  max_accounts: 1,
  daily_actions: 20,
  max_templates: 3,
  history_days: 3,
  export_limit: 5
};

// Helper: mapeia features para o formato { nome: true } que a extensão lê
function mapFeatures(enabled) {
  const out = {};
  for (const [k, v] of Object.entries(PREMIUM_FEATURES)) out[k] = enabled ? v.enabled : false;
  return out;
}
function mapCapabilities(enabled) {
  const out = {};
  for (const [k, v] of Object.entries(PREMIUM_CAPABILITIES)) out[k] = enabled ? v.enabled : false;
  return out;
}

// ═══════════════════════════════════════════════
// CHAVES + REDIS
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
  const novo = { ...lic };
  if (!novo.plano && novo.plan) novo.plano = novo.plan === 'premium' ? 'unli' : novo.plan;
  if (!novo.plano) novo.plano = '30d';
  if (!novo.planoNome) {
    const pk = PACOTES[novo.plano];
    novo.planoNome = pk ? pk.nome : (novo.plan === 'premium' ? 'Ilimitado' : 'Premium');
  }
  if (typeof novo.dias !== 'number') novo.dias = typeof novo.days === 'number' ? novo.days : (novo.plano === 'unli' ? 3650 : 30);
  if (!novo.criadaEm && novo.createdAt) novo.criadaEm = novo.createdAt;
  if (!novo.criadaEm) novo.criadaEm = Date.now();
  if (typeof novo.ilimitada !== 'boolean') novo.ilimitada = novo.dias >= 3650;
  if (!novo.expiraEm) novo.expiraEm = novo.ilimitada ? novo.criadaEm + 365*24*60*60*1000*10 : novo.criadaEm + novo.dias * 24*60*60*1000;
  if (typeof novo.ativa !== 'boolean') novo.ativa = typeof novo.active === 'boolean' ? novo.active : true;
  if (!novo.preco) { const pk = PACOTES[novo.plano]; novo.preco = pk ? pk.preco : 'R$ 0,00'; }
  return novo;
}

// ═══════════════════════════════════════════════
// 🔥 JWT — EXATAMENTE o que a extensão espera
// ═══════════════════════════════════════════════
function buildClaims(installId, lic) {
  const now = Math.floor(Date.now()/1000);
  const isUnli = lic && lic.ilimitada;
  const days = lic && lic.dias ? lic.dias : 30;
  const exp = isUnli ? now + (365*24*60*60*10) : now + (days*24*60*60);

  return {
    // ─── Identity ───
    sub: installId,                              // ← extensão verifica isto
    iss: 'mozlince-license-api',
    aud: 'mozlince-client',
    installId: installId,

    // ─── Plano ───
    plan: 'premium',
    planDisplayName: 'Premium',
    tier: 'premium',                             // ← extensão usa para snapshot
    kind: 'premium',
    status: 'active',
    active: true,
    isPremium: true,
    isVerified: true,

    // ─── Features (NOMES REAIS da extensão) ───
    features: mapFeatures(true),

    // ─── Capabilities ───
    capabilities: mapCapabilities(true),

    // ─── Limits (tudo ilimitado) ───
    limits: { ...PREMIUM_LIMITS },

    // ─── Secret para HMAC ───
    secret: 'segredo-' + installId,

    // ─── Timestamps ───
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
function generateLicenseKey() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const blk=()=>{let s='';for(let i=0;i<4;i++)s+=chars[crypto.randomInt(0,chars.length)];return s;};
  return `ASHEO-${blk()}-${blk()}-${blk()}-${blk()}`;
}

// ═══════════════════════════════════════════════
// TELEGRAM
// ═══════════════════════════════════════════════
const TG_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
async function tgSend(chatId, text, keyboard=null) {
  try { const body = { chat_id:chatId, text, parse_mode:'HTML', disable_web_page_preview:true }; if (keyboard) body.reply_markup = keyboard; await fetch(`${TG_API}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); } catch (e) {}
}
async function tgEdit(chatId, messageId, text, keyboard=null) {
  try { const body = { chat_id:chatId, message_id:messageId, text, parse_mode:'HTML', disable_web_page_preview:true }; if (keyboard) body.reply_markup = keyboard; await fetch(`${TG_API}/editMessageText`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); } catch (e) {}
}
async function tgAnswer(id, text='') {
  try { await fetch(`${TG_API}/answerCallbackQuery`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ callback_query_id:id, text }) }); } catch {}
}

// ═══════════════════════════════════════════════
// MENUS DO BOT
// ═══════════════════════════════════════════════
function menuPrincipal() {
  const texto =
    `╔══════════════════════════════════════╗\n` +
    `║   👑 <b>MOZLINCE LICENSE PANEL</b> 👑   ║\n` +
    `║      <i>Premium Edition v4.6</i>         ║\n` +
    `╚══════════════════════════════════════╝\n\n` +
    `🎯 <b>Painel de Controle Premium</b>\n\n` +
    `💎 Features premium integradas\n` +
    `🔐 JWT com capabilities completas\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✨ <b>Selecione uma ação:</b>`;
  return { texto, teclado: { inline_keyboard: [
    [{ text:'🔑 GERAR LICENÇA', callback_data:'m_gerar' }],
    [{ text:'📋 LISTAR', callback_data:'m_listar' }, { text:'📊 STATS', callback_data:'m_stats' }],
    [{ text:'🔗 VINCULAR ID', callback_data:'m_vincular' }, { text:'🔓 DESVINCULAR', callback_data:'m_desvincular' }],
    [{ text:'🔍 CONSULTAR', callback_data:'m_consultar' }],
    [{ text:'❌ REVOGAR', callback_data:'m_revogar' }, { text:'🗑️ DELETAR', callback_data:'m_deletar' }],
    [{ text:'💰 PREÇOS', callback_data:'m_precos' }],
    [{ text:'📞 CONTACTAR', callback_data:'m_contacto' }, { text:'ℹ️ AJUDA', callback_data:'m_ajuda' }],
    [{ text:'⚠️ ZONA DE PERIGO', callback_data:'m_perigo' }]
  ]}};
}

async function cmdStart(chatId, msgId=null) {
  const m = menuPrincipal();
  if (msgId) await tgEdit(chatId, msgId, m.texto, m.teclado);
  else await tgSend(chatId, m.texto, m.teclado);
}

// ═══════════════════════════════════════════════
// HANDLERS DO BOT
// ═══════════════════════════════════════════════
async function handleCallback(cb) {
  const chatId = cb.message.chat.id;
  const msgId = cb.message.message_id;
  const data = cb.data;
  const userId = String(cb.from.id);

  if (userId !== String(OWNER_ID)) {
    await tgAnswer(cb.id, '⛔ Acesso negado.');
    if (data === 'm_contacto') {
      await tgSend(chatId, '📞 <b>Pedido enviado ao administrador.</b>');
      await tgSend(OWNER_ID, `📞 Pedido\n👤 ${cb.from.first_name||'?'}\n💬 <code>${chatId}</code>`);
    }
    return;
  }

  try {
    if (data === 'm_home') { await tgAnswer(cb.id); return cmdStart(chatId, msgId); }

    if (data === 'm_gerar') {
      await tgAnswer(cb.id, '💰 Escolha');
      const kb = { inline_keyboard: [] };
      const entries = Object.entries(PACOTES);
      for (let i = 0; i < entries.length; i += 2) {
        const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome} — ${entries[i][1].preco}`, callback_data:`g_${entries[i][0]}` }];
        if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome} — ${entries[i+1][1].preco}`, callback_data:`g_${entries[i+1][0]}` });
        kb.inline_keyboard.push(linha);
      }
      kb.inline_keyboard.push([{ text:'🔙 Voltar', callback_data:'m_home' }]);
      await tgEdit(chatId, msgId, `🔑 <b>GERAR LICENÇA</b>\n\n💰 Escolha o pacote:`, kb);
      return;
    }

    if (data.startsWith('g_')) {
      const pk = data.substring(2);
      const p = PACOTES[pk];
      if (!p) { await tgAnswer(cb.id, '❌ Pacote inválido'); return; }
      const chave = generateLicenseKey();
      const agora = Date.now();
      const expira = agora + p.dias * 24 * 60 * 60 * 1000;
      await redisSet(chave, JSON.stringify({
        chave, plano:pk, planoNome:p.nome, preco:p.preco, dias:p.dias,
        criadaEm:agora, expiraEm:expira, ilimitada: p.dias>=3650,
        ativa:true, installId:null, ativadaEm:null
      }));
      log('OK', 'Chave gerada: ' + chave);
      await tgAnswer(cb.id, '✅ Licença gerada!');
      await tgEdit(chatId, msgId,
        `✅ <b>LICENÇA GERADA!</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔑 <b>Chave:</b>\n<code>${chave}</code>\n\n` +
        `${p.emoji} <b>Pacote:</b> ${p.nome}\n` +
        `💰 <b>Preço:</b> ${p.preco}\n` +
        `📅 <b>Criada:</b> ${formatDate(agora)}\n` +
        `⏰ <b>Expira:</b> ${p.dias>=3650?'🔥 Nunca':formatDate(expira)}\n` +
        `⌛ <b>Validade:</b> ${p.dias>=3650?'Ilimitada':humanTime(expira-agora)}\n\n` +
        `💡 Use <code>/activate &lt;installId&gt; ${chave}</code>`,
        { inline_keyboard: [
          [{ text:'🔗 VINCULAR AGORA', callback_data:`v_${chave}` }],
          [{ text:'🔍 DETALHES', callback_data:`c_${chave}` }],
          [{ text:'🔙 MENU', callback_data:'m_home' }]
        ]}
      );
      return;
    }

    if (data === 'm_listar') {
      await tgAnswer(cb.id);
      const keys = await redisKeys('ASHEO-*');
      if (keys.length === 0) {
        await tgEdit(chatId, msgId, `📋 <b>LISTA</b>\n\n📭 Nenhuma licença.`, { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] });
        return;
      }
      let txt = `📋 <b>LICENÇAS (${keys.length})</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      for (let i = 0; i < Math.min(keys.length, 25); i++) {
        const k = keys[i]; const lic = await redisGet(k);
        if (!lic) continue;
        const exp = lic.ilimitada ? '∞' : humanTime((lic.expiraEm||0) - Date.now());
        txt += `${lic.ativa?'🟢':'🔴'}${lic.installId?'🔗':'⚪'} <code>${k}</code>\n     ${PACOTES[lic.plano]?.emoji||'📦'} ${lic.planoNome} • ⏰ ${exp}\n\n`;
      }
      if (keys.length > 25) txt += `\n<i>... e mais ${keys.length-25}</i>\n`;
      await tgEdit(chatId, msgId, txt, { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] });
      return;
    }

    if (data === 'm_stats') {
      await tgAnswer(cb.id);
      const keys = await redisKeys('ASHEO-*');
      let ativas=0, expiradas=0, vinculadas=0, ilimitadas=0, receita=0;
      for (const k of keys) {
        const l = await redisGet(k); if (!l) continue;
        if (l.ativa) ativas++;
        if (!l.ilimitada && l.expiraEm < Date.now()) expiradas++;
        if (l.installId) vinculadas++;
        if (l.ilimitada) ilimitadas++;
        if (l.preco) receita += parseFloat(String(l.preco).replace(/[^\d.,]/g,'').replace(',','.')) || 0;
      }
      await tgEdit(chatId, msgId,
        `📊 <b>ESTATÍSTICAS</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔑 <b>Total:</b> ${keys.length}\n` +
        `🟢 <b>Ativas:</b> ${ativas}\n` +
        `🔴 <b>Expiradas:</b> ${expiradas}\n` +
        `🔗 <b>Vinculadas:</b> ${vinculadas}\n` +
        `🔥 <b>Ilimitadas:</b> ${ilimitadas}\n\n` +
        `💰 <b>Receita:</b> R$ ${receita.toFixed(2)}`,
        { inline_keyboard: [[{ text:'🔄 Atualizar', callback_data:'m_stats' }], [{ text:'🔙 Voltar', callback_data:'m_home' }]] }
      );
      return;
    }

    if (data === 'm_vincular') { await tgAnswer(cb.id);
      await tgEdit(chatId, msgId, `🔗 <b>VINCULAR</b>\n\nUse:\n<code>/activate &lt;installId&gt; &lt;chave&gt;</code>`, { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }); return; }
    if (data === 'm_desvincular') { await tgAnswer(cb.id);
      await tgEdit(chatId, msgId, `🔓 <b>DESVINCULAR</b>\n\nUse:\n<code>/desvincular &lt;chave&gt;</code>`, { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }); return; }
    if (data === 'm_consultar') { await tgAnswer(cb.id);
      await tgEdit(chatId, msgId, `🔍 <b>CONSULTAR</b>\n\nUse:\n<code>/status &lt;chave&gt;</code>`, { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }); return; }
    if (data === 'm_revogar') { await tgAnswer(cb.id);
      await tgEdit(chatId, msgId, `❌ <b>REVOGAR</b>\n\nUse:\n<code>/revogar &lt;chave&gt;</code>`, { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }); return; }
    if (data === 'm_deletar') { await tgAnswer(cb.id);
      await tgEdit(chatId, msgId, `🗑️ <b>DELETAR</b>\n\nUse:\n<code>/deletar &lt;chave&gt;</code>`, { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }); return; }

    if (data === 'm_precos') {
      await tgAnswer(cb.id);
      let txt = `💰 <b>TABELA DE PREÇOS</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      for (const [,p] of Object.entries(PACOTES)) txt += `${p.emoji} <b>${p.nome}</b> — <code>${p.preco}</code>\n`;
      txt += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n💎 <i>Todos incluem:</i>\n✅ Browser Mods\n✅ Rule Ops Lab\n✅ Live Injection HUD\n✅ Algo V2\n✅ Suporte prioritário`;
      await tgEdit(chatId, msgId, txt, { inline_keyboard: [[{ text:'📞 COMPRAR', callback_data:'m_contacto' }], [{ text:'🔙 Voltar', callback_data:'m_home' }]] });
      return;
    }

    if (data === 'm_contacto') {
      await tgAnswer(cb.id, '📞 Enviado!');
      await tgEdit(chatId, msgId, `📞 <b>CONTACTAR ADMIN</b>\n\n✅ Pedido enviado!`, { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] });
      if (userId !== String(OWNER_ID)) await tgSend(OWNER_ID, `📞 Pedido\n👤 ${cb.from.first_name||'?'}\n💬 <code>${chatId}</code>`);
      return;
    }

    if (data === 'm_ajuda') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
        `ℹ️ <b>AJUDA</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `<code>/gerar</code> • <code>/listar</code> • <code>/stats</code>\n` +
        `<code>/status &lt;chave&gt;</code>\n` +
        `<code>/activate &lt;id&gt; &lt;chave&gt;</code>\n` +
        `<code>/desvincular &lt;chave&gt;</code>\n` +
        `<code>/revogar &lt;chave&gt;</code>\n` +
        `<code>/deletar &lt;chave&gt;</code>\n` +
        `<code>/deletarativas</code>\n` +
        `<code>/deletartudo</code>`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }
      );
      return;
    }

    if (data === 'm_perigo') {
      await tgAnswer(cb.id, '⚠️ Zona perigosa');
      await tgEdit(chatId, msgId,
        `⚠️ <b>ZONA DE PERIGO</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n🚨 Ações irreversíveis!`,
        { inline_keyboard: [
          [{ text:'🗑️ DELETAR ATIVAS', callback_data:'danger_ativas' }],
          [{ text:'💣 DELETAR TUDO', callback_data:'danger_tudo' }],
          [{ text:'🔙 Voltar', callback_data:'m_home' }]
        ]}
      );
      return;
    }

    if (data === 'danger_ativas') { await tgAnswer(cb.id);
      await tgEdit(chatId, msgId, `⚠️ <b>CONFIRMAR?</b>\n\nDeletar todas as ATIVAS?`,
        { inline_keyboard: [[{ text:'✅ SIM', callback_data:'confirm_ativas' }], [{ text:'❌ Não', callback_data:'m_perigo' }]] }); return; }
    if (data === 'danger_tudo') { await tgAnswer(cb.id);
      await tgEdit(chatId, msgId, `💣 <b>CONFIRMAR?</b>\n\nDeletar TUDO?`,
        { inline_keyboard: [[{ text:'💣 SIM, TUDO', callback_data:'confirm_tudo' }], [{ text:'❌ Não', callback_data:'m_perigo' }]] }); return; }

    if (data === 'confirm_ativas') {
      await tgAnswer(cb.id, 'Deletando...');
      const keys = await redisKeys('ASHEO-*');
      let n = 0;
      for (const k of keys) { const l = await redisGet(k); if (l && l.ativa) { await redisDel(k); n++; } }
      await tgEdit(chatId, msgId, `✅ <b>${n}</b> licenças ativas deletadas.`, { inline_keyboard: [[{ text:'🔙 Menu', callback_data:'m_home' }]] });
      return;
    }
    if (data === 'confirm_tudo') {
      await tgAnswer(cb.id, 'Deletando tudo...');
      const keys = await redisKeys('ASHEO-*');
      for (const k of keys) await redisDel(k);
      await tgEdit(chatId, msgId, `💣 Banco limpo! <b>${keys.length}</b> chaves removidas.`, { inline_keyboard: [[{ text:'🔙 Menu', callback_data:'m_home' }]] });
      return;
    }

    if (data.startsWith('c_')) {
      const k = data.substring(2);
      const l = await redisGet(k);
      if (!l) { await tgAnswer(cb.id, '❌ Não encontrada'); return; }
      await tgAnswer(cb.id);
      const resta = l.ilimitada ? '∞' : humanTime((l.expiraEm||0) - Date.now());
      await tgEdit(chatId, msgId,
        `🔍 <b>DETALHES</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔑 <code>${k}</code>\n\n` +
        `${PACOTES[l.plano]?.emoji||'📦'} ${l.planoNome}\n` +
        `💰 ${l.preco}\n` +
        `📅 ${formatDate(l.criadaEm)}\n` +
        `⏰ ${l.ilimitada?'Nunca':formatDate(l.expiraEm)}\n` +
        `⌛ ${resta}\n\n` +
        `🔗 ${l.installId?`<code>${l.installId}</code>`:'Não vinculada'}\n` +
        `📌 ${l.ativa?'🟢 Ativa':'🔴 Inativa'}`,
        { inline_keyboard: [
          [{ text: l.installId?'🔓 Desvincular':'🔗 Vincular', callback_data: l.installId?`dv_${k}`:`v_${k}` }],
          [{ text:'❌ Revogar', callback_data:`rv_${k}` }, { text:'🗑️ Deletar', callback_data:`dl_${k}` }],
          [{ text:'🔙 Voltar', callback_data:'m_home' }]
        ]}
      );
      return;
    }

    if (data.startsWith('v_')) { const k = data.substring(2); await tgAnswer(cb.id);
      await tgEdit(chatId, msgId, `🔗 <b>VINCULAR</b>\n\n🔑 <code>${k}</code>\n\nUse:\n<code>/activate &lt;installId&gt; ${k}</code>`, { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:`c_${k}` }]] }); return; }

    if (data.startsWith('dv_')) { const k = data.substring(3);
      const l = await redisGet(k); if (l) { l.installId = null; l.ativadaEm = null; await redisSet(k, JSON.stringify(l)); }
      await tgAnswer(cb.id, '🔓 Desvinculada');
      await tgEdit(chatId, msgId, `✅ Desvinculada: <code>${k}</code>`, { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:`c_${k}` }]] }); return; }

    if (data.startsWith('rv_')) { const k = data.substring(3);
      const l = await redisGet(k); if (l) { l.ativa = false; await redisSet(k, JSON.stringify(l)); }
      await tgAnswer(cb.id, '❌ Revogada');
      await tgEdit(chatId, msgId, `❌ Revogada: <code>${k}</code>`, { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:`c_${k}` }]] }); return; }

    if (data.startsWith('dl_')) { const k = data.substring(3);
      await redisDel(k); await tgAnswer(cb.id, '🗑️ Deletada');
      await tgEdit(chatId, msgId, `🗑️ Deletada: <code>${k}</code>`, { inline_keyboard: [[{ text:'🔙 Menu', callback_data:'m_home' }]] }); return; }

    await tgAnswer(cb.id);
  } catch (e) { log('ERRO','Callback: '+e.message); await tgAnswer(cb.id, '❌ Erro: '+e.message); }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const texto = (msg.text || '').trim();
  const args = texto.replace(/\n/g,' ').split(' ').filter(a => a.length > 0);
  const cmd = (args[0] || '').toLowerCase();

  if (userId !== String(OWNER_ID)) {
    if (cmd === '/start' || cmd === '/contacto') {
      await tgSend(chatId, `👋 <b>Bem-vindo!</b>`,
        { inline_keyboard: [[{ text:'📞 CONTACTAR ADMIN', callback_data:'m_contacto' }]] });
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
      await tgSend(chatId, `🔑 <b>GERAR LICENÇA</b>\n\n💰 Escolha:`, kb);
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
      if (!k) { await tgSend(chatId, `⚠️ Use: <code>/status &lt;chave&gt;</code>`); return; }
      const l = await redisGet(k);
      if (!l) { await tgSend(chatId, `❌ Não encontrada.`); return; }
      const resta = l.ilimitada ? '∞' : humanTime((l.expiraEm||0) - Date.now());
      await tgSend(chatId,
        `🔍 <b>STATUS</b>\n\n🔑 <code>${k}</code>\n\n` +
        `${PACOTES[l.plano]?.emoji||'📦'} ${l.planoNome}\n` +
        `💰 ${l.preco}\n` +
        `📅 ${formatDate(l.criadaEm)}\n` +
        `⏰ ${l.ilimitada?'Nunca':formatDate(l.expiraEm)}\n` +
        `⌛ ${resta}\n` +
        `🔗 ${l.installId?`<code>${l.installId}</code>`:'Não vinculada'}\n` +
        `📌 ${l.ativa?'🟢 Ativa':'🔴 Inativa'}`
      );
      return;
    }

    if (cmd === '/activate') {
      const chave = args[args.length-1];
      const installId = args.slice(1, args.length-1).join(' ');
      if (!installId || !chave) { await tgSend(chatId, `⚠️ Use: <code>/activate &lt;id&gt; &lt;chave&gt;</code>`); return; }
      const l = await redisGet(chave);
      if (!l) { await tgSend(chatId, `❌ Chave não encontrada.`); return; }
      if (l.installId) { await tgSend(chatId, `⚠️ Já vinculada a <code>${l.installId}</code>.`); return; }
      l.installId = installId; l.ativadaEm = Date.now();
      await redisSet(chave, JSON.stringify(l));
      await tgSend(chatId, `✅ Vinculada!\n\n🔑 <code>${chave}</code>\n🔗 <code>${installId}</code>`);
      return;
    }

    if (cmd === '/desvincular') {
      const k = args[1];
      if (!k) { await tgSend(chatId, `⚠️ Use: /desvincular &lt;chave&gt;`); return; }
      const l = await redisGet(k);
      if (!l) { await tgSend(chatId, `❌ Não encontrada.`); return; }
      l.installId = null; l.ativadaEm = null;
      await redisSet(k, JSON.stringify(l));
      await tgSend(chatId, `🔓 Desvinculada.`);
      return;
    }

    if (cmd === '/revogar') {
      const k = args[1];
      if (!k) { await tgSend(chatId, `⚠️ Use: /revogar &lt;chave&gt;`); return; }
      const l = await redisGet(k);
      if (!l) { await tgSend(chatId, `❌ Não encontrada.`); return; }
      l.ativa = false; await redisSet(k, JSON.stringify(l));
      await tgSend(chatId, `❌ Revogada.`);
      return;
    }

    if (cmd === '/deletar') {
      const k = args[1];
      if (!k) { await tgSend(chatId, `⚠️ Use: /deletar &lt;chave&gt;`); return; }
      await redisDel(k);
      await tgSend(chatId, `🗑️ Deletada.`);
      return;
    }

    if (cmd === '/deletarativas') {
      const keys = await redisKeys('ASHEO-*');
      let n = 0;
      for (const k of keys) { const l = await redisGet(k); if (l && l.ativa) { await redisDel(k); n++; } }
      await tgSend(chatId, `🗑️ <b>${n}</b> ativas deletadas.`);
      return;
    }

    if (cmd === '/deletartudo') {
      const keys = await redisKeys('ASHEO-*');
      for (const k of keys) await redisDel(k);
      await tgSend(chatId, `💣 Banco limpo! <b>${keys.length}</b> removidas.`);
      return;
    }

    if (cmd === '/stats') {
      const keys = await redisKeys('ASHEO-*');
      let ativas=0, exp=0, vinc=0, unli=0;
      for (const k of keys) { const l = await redisGet(k); if (!l) continue;
        if (l.ativa) ativas++; if (!l.ilimitada && l.expiraEm < Date.now()) exp++;
        if (l.installId) vinc++; if (l.ilimitada) unli++;
      }
      await tgSend(chatId,
        `📊 <b>STATS</b>\n\n🔑 Total: ${keys.length}\n🟢 Ativas: ${ativas}\n🔴 Expiradas: ${exp}\n🔗 Vinculadas: ${vinc}\n🔥 Ilimitadas: ${unli}`
      );
      return;
    }

    await tgSend(chatId, `❓ Use /start.`);
  } catch (e) { log('ERRO','Message: '+e.message); }
}

// ═══════════════════════════════════════════════
// WEBHOOK
// ═══════════════════════════════════════════════
app.post('/telegram-webhook', async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  try {
    if (update.callback_query) return handleCallback(update.callback_query);
    if (update.message && update.message.text) return handleMessage(update.message);
  } catch (e) { log('ERRO','Webhook: '+e.message); }
});

// ═══════════════════════════════════════════════
// API — EXATAMENTE O QUE A EXTENSÃO ESPERA
// ═══════════════════════════════════════════════

app.get('/', (req, res) => {
  res.json({ ok:true, service:'mozlince-license-api', version:'4.6' });
});

app.get('/v1/status', (req, res) => {
  res.json({ ok:true, service:'mozlince-license-api', version:'4.6', hora:new Date().toISOString() });
});

// 🔥 Endpoint que a extensão consulta para saber features/capabilities
app.get('/v1/premium/definitions', (req, res) => {
  res.json({
    ok: true,
    features: PREMIUM_FEATURES,
    capabilities: PREMIUM_CAPABILITIES,
    premiumLimits: PREMIUM_LIMITS,
    freeLimits: FREE_LIMITS,
    version: '1.6.2'
  });
});

app.get('/v1/planos', (req, res) => {
  res.json({ ok:true, planos: Object.entries(PACOTES).map(([id,p]) => ({ id, nome:p.nome, dias:p.dias, preco:p.preco, emoji:p.emoji })) });
});

app.post('/v1/activate', async (req, res) => {
  const inicio = Date.now();
  const { installId, licenseKey, clientTag, deviceLabel, buildFingerprint, installType } = req.body || {};

  log('INFO', `Ativacao: installId=${installId || '?'} | key=${licenseKey ? normalizeKey(licenseKey).substring(0,18)+'...' : '(vazia)'} | client=${clientTag || '?'}`);

  if (!installId || typeof installId !== 'string' || installId.length < 5) {
    return res.status(400).json({ error:'missing_installId', message:'installId obrigatorio' });
  }
  if (!PRIVATE_KEY) {
    return res.status(500).json({ error:'server_misconfigured', message:'Servidor sem chave privada' });
  }
  if (!licenseKey || typeof licenseKey !== 'string' || !licenseKey.toUpperCase().startsWith('ASHEO-')) {
    return res.status(401).json({ error:'missing_license', message:'licenseKey obrigatoria' });
  }

  const keyNorm = normalizeKey(licenseKey);
  const lic = await redisGet(keyNorm);

  if (!lic) {
    log('WARN', `Chave NAO ENCONTRADA no Redis: ${keyNorm.substring(0,18)}...`);
    return res.status(404).json({ error:'invalid_license', message:'Chave nao encontrada no servidor' });
  }

  if (!lic.ativa) {
    log('WARN', `Chave REVOGADA: ${keyNorm.substring(0,18)}...`);
    return res.status(403).json({ error:'revoked', message:'Chave revogada' });
  }

  if (!lic.installId) {
    lic.installId = installId;
    lic.ativadaEm = Date.now();
    await redisSet(keyNorm, JSON.stringify(lic));
    log('OK', `Vinculada: ${keyNorm.substring(0,18)}... -> ${installId}`);
  } else if (lic.installId !== installId) {
    log('WARN', `JA VINCULADA: ${keyNorm.substring(0,18)}...`);
    return res.status(403).json({ error:'already_used', message:'Chave ja vinculada a outro dispositivo' });
  }

  if (!lic.ilimitada && Date.now() > lic.expiraEm) {
    return res.status(403).json({ error:'expired', message:'Chave expirada' });
  }

  try {
    const token = signToken(buildClaims(installId, lic));
    log('ATIV', `✅ ${installId} | ${keyNorm.substring(0,18)}... | ${Date.now()-inicio}ms`);

    return res.json({
      token,                                    // ← extensão espera isto
      tier: 'premium',
      kind: 'premium',
      seat: 1,
      seats: 1,
      gwPass: null,
      plan: 'premium',
      planDisplayName: 'Premium',
      expires_in: lic.ilimitada ? -1 : Math.floor((lic.expiraEm - Date.now())/1000),
      licenseKey: keyNorm
    });
  } catch (e) {
    log('ERRO', 'activate sign: ' + e.message);
    return res.status(500).json({ error:'internal', message:'Erro ao gerar token' });
  }
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
  res.json({ ok:true, message:'Desativado' });
});

app.post('/v1/verify', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error:'missing_token' });
  try {
    const decoded = jwt.verify(token, PUBLIC_KEY || PRIVATE_KEY, { algorithms:['ES256'] });
    return res.json({ valido:true, ok:true, dados:decoded });
  } catch (e) { return res.status(401).json({ valido:false, ok:false, erro:e.message }); }
});

app.post('/v1/feature/activate', async (req, res) => {
  const { installId, feature, licenseKey, nonce } = req.body || {};
  if (!installId || !feature || !licenseKey) return res.status(400).json({ ok:false, error:'missing_params' });
  const lic = await redisGet(licenseKey);
  if (!lic || !lic.ativa) return res.status(403).json({ ok:false, error:'invalid_license' });
  if (lic.installId && lic.installId !== installId) return res.status(403).json({ ok:false, error:'already_used' });

  // Verifica se a feature existe
  if (!PREMIUM_FEATURES[feature]) {
    return res.status(404).json({ ok:false, error:'unknown_feature', message:'Feature nao existe' });
  }

  try {
    const now = Math.floor(Date.now()/1000);
    const token = jwt.sign({
      sub:installId, feature, nonce:nonce||crypto.randomUUID(),
      iat:now, nbf:now-5, exp:now+300, jti:crypto.randomUUID()
    }, PRIVATE_KEY, { algorithm:'ES256' });
    return res.json({ ok:true, token, feature, expires_in:300 });
  } catch (e) { return res.status(500).json({ ok:false, error:'internal' }); }
});

app.get('/v1/rules/sync', (req, res) => {
  const { installId, licenseKey } = req.query;
  if (!installId || !licenseKey) return res.status(401).json({ ok:false, error:'missing_license' });
  res.json({ version:3, updatedAt:new Date().toISOString(), serverRules:[
    { id:'browser_mods', enabled:true, ttl:3600 },
    { id:'rule_ops_lab', enabled:true, ttl:3600 },
    { id:'live_injection_hud', enabled:true, ttl:3600 },
    { id:'algo_v2', enabled:true, ttl:3600 },
    { id:'exclusive_rules', enabled:true, ttl:3600 }
  ], serverTime:Date.now() });
});

app.get('/v1/exclusive/sync', (req, res) => {
  const { installId, licenseKey } = req.query;
  if (!installId || !licenseKey) return res.status(401).json({ ok:false, error:'missing_license' });
  res.json({ manifest:{ version:'1.0.0', generatedAt:new Date().toISOString(),
    rules:[{ id:'exclusive_1', type:'allow', pattern:'https://premium.mozlince.com/*' }],
    gateways:[{ id:'premium-gw', url:'https://premium.mozlince.com/gw', enabled:true }],
    signature:crypto.randomBytes(32).toString('hex')
  }, cachedAt:Date.now() });
});

app.get('/v1/manifest/check', (req, res) => {
  res.json({ ok:true, latest:'1.0.0', minVersion:'1.0.0', channel:req.query.channel||'stable', serverTime:Date.now() });
});

app.get('/v1/gateways/defaults', (req, res) => {
  const { installId, licenseKey } = req.query;
  if (!installId || !licenseKey) return res.status(401).json({ ok:false, error:'missing_license' });
  res.json({ ok:true, version:1, gateways:[
    { id:'default-1', name:'Default', pattern:'https://*.mozlince.com/*', isDefault:true }
  ], serverTime:Date.now() });
});

app.post('/verificar-licenca', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ erro:'Token obrigatorio' });
  try { const decoded = jwt.verify(token, PUBLIC_KEY || PRIVATE_KEY, { algorithms:['ES256'] }); res.json({ valido:true, dados:decoded }); }
  catch (err) { res.status(401).json({ valido:false, erro:err.message }); }
});

// ═══════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log('SYS', `Servidor Mozlince v4.6 na porta ${PORT}`);
  log('SYS', `Chave: ${ORIGEM}`);
  log('SYS', `Redis: ${UPSTASH_URL ? 'OK' : 'FALTA'}`);
  log('SYS', `Telegram: ${TELEGRAM_TOKEN ? 'OK' : 'FALTA'}`);
  log('SYS', `Features premium: ${Object.keys(PREMIUM_FEATURES).length}`);
  log('SYS', `Capabilities: ${Object.keys(PREMIUM_CAPABILITIES).length}`);
  log('SYS', `Rotas: /v1/activate /v1/premium/definitions /v1/feature/activate`);
});

process.on('uncaughtException', e => log('ERRO','Uncaught: '+e.message));
process.on('unhandledRejection', e => log('ERRO','Rejection: '+e));
