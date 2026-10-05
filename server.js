/* ═══════════════════════════════════════════════════════════════
   ⚡ MOZLINCE NEBULA PREMIUM v8.0
   © Asheo Systems
   ✨ Fixes:
      • Bug "Never" no 3 dias — lifetime explícito sempre
      • Suporte interativo funcionando (2 vias)
      • Deletar tudo / deletar uma
      • Boas-vindas após ativação (Congratulations)
      • Tradutor PT/EN com seleção manual
      • Chave não exposta em respostas públicas
   ═══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const ALLOWED_HEADERS = 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Install-Id, X-Client-Tag, X-License-Key, X-Request-Id, Accept-Language';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Request-Id');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Powered-By', 'Mozlince-Nebula/8.0');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '512kb' }));

/* ── Logger ── */
const C = { r:'\x1b[0m', b:'\x1b[1m', gray:'\x1b[38;5;245m',
  cyan:'\x1b[38;5;51m', purple:'\x1b[38;5;141m', gold:'\x1b[38;5;220m',
  green:'\x1b[38;5;46m', red:'\x1b[38;5;196m', orange:'\x1b[38;5;208m',
  blue:'\x1b[38;5;39m', pink:'\x1b[38;5;213m', mint:'\x1b[38;5;121m' };
const TAGS = { INFO:C.cyan, OK:C.green, WARN:C.orange, ERRO:C.red, SYS:C.purple,
  ATIV:C.blue, BOT:C.cyan, FEAT:C.pink, BOOT:C.mint, API:C.gold,
  DBG:C.gray, TG:C.cyan, SUPPORT:C.gold, I18N:C.blue };
function log(t, m) {
  const ts = new Date().toISOString().replace('T',' ').substring(0,19);
  console.log(`${C.gray}${ts}${C.r} ${TAGS[t]||C.gray}${C.b}▸ ${t.padEnd(7)}${C.r} ${m}`);
}
function banner() {
  console.log(`\n${C.purple}╔══════════════════════════════════════════════════════════╗${C.r}`);
  console.log(`${C.purple}║${C.r}  ${C.cyan}${C.b}⚡ MOZLINCE${C.r} ${C.gold}${C.b}NEBULA PREMIUM${C.r} · v${C.gold}8.0${C.r}                ${C.purple}║${C.r}`);
  console.log(`${C.purple}║${C.r}  ${C.gray}License Engine · Asheo Systems${C.r}                     ${C.purple}║${C.r}`);
  console.log(`${C.purple}╚══════════════════════════════════════════════════════════╝${C.r}\n`);
}

/* ── Chaves ES256 ── */
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
      if (!PUBLIC_KEY) PUBLIC_KEY = crypto.createPublicKey(k).export({ type:'spki', format:'pem' });
      log('OK', `Chave privada OK (${ORIGEM})`);
      if (jwk.x === 'aTAr_kSTrfocOkpAHlVSDc71E1pc5Pd5KgnE-ggBr_4' && jwk.y === 'GFrU897XAPvrxqcRhlwoAwpooKHl69-0YrBaJbfwAT4') {
        log('OK', '✅ Chave CORRESPONDE à extensão Mozlince!');
      } else { log('WARN', '⚠️ Chave diferente da extensão'); }
    } catch (e) { log('ERRO','Chave inválida: '+e.message); PRIVATE_KEY = null; }
  } else { log('ERRO','Nenhuma chave privada encontrada'); }
})();

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID;

/* ═══════════════════════════════════════════════
   FEATURES / LIMITS / SCOPE
   ═══════════════════════════════════════════════ */
const PREMIUM_FEATURES = {
  browser_mods:{enabled:true,label:'Browser Mods',description:'Spoof fingerprint and rotate user-agent.'},
  rule_ops_lab:{enabled:true,label:'Rule Ops Lab',description:'Bulk rule ops, presets, conflict scan.'},
  live_injection_hud:{enabled:true,label:'Live Injection HUD',description:'On-page overlay showing each card swap.'},
  algo_v2:{enabled:true,label:'Algo V2'},
  exclusive_rules:{enabled:true,label:'Exclusive Rules'},
  advanced_automation:{enabled:true,label:'Advanced Automation'},
  multi_account:{enabled:true,label:'Multi Account'},
  custom_export:{enabled:true,label:'Custom Export'},
  api_access:{enabled:true,label:'API Access'}
};
const PREMIUM_CAPABILITIES = {
  priority_support:{enabled:true,label:'Priority Support'},
  custom_webhooks:{enabled:true,label:'Custom Webhooks'},
  cloud_sync:{enabled:true,label:'Cloud Sync'},
  bulk_actions:{enabled:true,label:'Bulk Actions'},
  advanced_analytics:{enabled:true,label:'Advanced Analytics'}
};
const PREMIUM_LIMITS = { max_accounts:-1, daily_actions:-1, max_templates:-1, history_days:-1, export_limit:-1 };
const FREE_LIMITS    = { max_accounts:1,  daily_actions:20, max_templates:3,  history_days:3,  export_limit:5 };
const PREMIUM_SCOPE  = ['bypasser','cardfiller','cvv','premium','browserMods','persona','rules','gateways','exclusive'];

const mapFeatures    = on => Object.fromEntries(Object.entries(PREMIUM_FEATURES).map(([k,v])=>[k,on?v.enabled:false]));
const mapCapabilities= on => Object.fromEntries(Object.entries(PREMIUM_CAPABILITIES).map(([k,v])=>[k,on?v.enabled:false]));

/* ═══════════════════════════════════════════════
   REDIS
   ═══════════════════════════════════════════════ */
function normalizeKey(k){ if(!k||typeof k!=='string')return ''; return k.trim().toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9\-]/g,''); }
async function redisSet(key, value) {
  const k = encodeURIComponent(normalizeKey(key));
  const r = await fetch(`${UPSTASH_URL}/set/${k}`, {
    method:'POST',
    headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}`, 'Content-Type':'text/plain' },
    body: typeof value === 'string' ? value : JSON.stringify(value)
  });
  return r.json();
}
async function redisGet(key) {
  const k = encodeURIComponent(normalizeKey(key));
  if (!k) return null;
  const r = await fetch(`${UPSTASH_URL}/get/${k}`, { headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } });
  const d = await r.json();
  if (!d.result) return null;
  try { return migrarLicenca(JSON.parse(d.result)); } catch { return null; }
}
async function redisDel(key) {
  const k = encodeURIComponent(normalizeKey(key));
  await fetch(`${UPSTASH_URL}/del/${k}`, { method:'POST', headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } });
}
async function redisKeys(pattern='ASHEO-*') {
  const p = encodeURIComponent(pattern);
  const r = await fetch(`${UPSTASH_URL}/keys/${p}`, { headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } });
  const d = await r.json();
  return (d.result || []).filter(k => typeof k === 'string');
}

/* ═══════════════════════════════════════════════
   PLANOS (USD)
   ═══════════════════════════════════════════════ */
const PACOTES = {
  '3d':   { nome:'3 Dias',    dias:3,     preco:3,   emoji:'🥉', lifetime:false },
  '7d':   { nome:'7 Dias',    dias:7,     preco:5,   emoji:'🥈', lifetime:false },
  '15d':  { nome:'15 Dias',   dias:15,    preco:7,   emoji:'🥇', lifetime:false },
  '30d':  { nome:'30 Dias',   dias:30,    preco:12,  emoji:'💎', lifetime:false },
  '45d':  { nome:'45 Dias',   dias:45,    preco:17,  emoji:'🔷', lifetime:false },
  '90d':  { nome:'3 Meses',   dias:90,    preco:30,  emoji:'👑', lifetime:false },
  '180d': { nome:'6 Meses',   dias:180,   preco:45,  emoji:'⚜️', lifetime:false },
  '1a':   { nome:'1 Ano',     dias:365,   preco:70,  emoji:'🏆', lifetime:false },
  'life': { nome:'LIFETIME',  dias:36500, preco:190, emoji:'🔥', lifetime:true  }
};
const precoFmt = usd => `$${Number(usd).toFixed(2)}`;

/* ═══════════════════════════════════════════════
   MIGRAÇÃO — lifetime SEMPRE explícito
   ═══════════════════════════════════════════════ */
function migrarLicenca(lic) {
  if (!lic || typeof lic !== 'object') return lic;
  const n = { ...lic };
  if (!n.plano && n.plan) n.plano = n.plan === 'premium' ? 'life' : n.plan;
  if (!n.plano) n.plano = '30d';
  const pk = PACOTES[n.plano];
  if (!n.planoNome) n.planoNome = pk ? pk.nome : 'Premium';
  if (typeof n.dias !== 'number') n.dias = pk ? pk.dias : 30;

  // ⚡ v8: lifetime é SEMPRE derivado do plano (nunca do campo antigo ilimitada)
  // Se o plano é 'life' → lifetime true. Senão → false. SEMPRE.
  n.lifetime = n.plano === 'life';
  n.ilimitada = n.lifetime; // campo legado (compat)

  if (!n.criadaEm && n.createdAt) n.criadaEm = n.createdAt;
  if (!n.criadaEm) n.criadaEm = Date.now();
  if (!n.expiraEm || (n.lifetime && n.expiraEm < Date.now() + 50*365*24*60*60*1000)) {
    n.expiraEm = n.lifetime
      ? n.criadaEm + (100 * 365 * 24 * 60 * 60 * 1000)
      : n.criadaEm + (n.dias * 24 * 60 * 60 * 1000);
  }
  if (typeof n.ativa !== 'boolean') n.ativa = typeof n.active === 'boolean' ? n.active : true;
  if (typeof n.preco === 'string') n.preco = parseFloat(n.preco.replace(/[^\d.,]/g,'').replace(',','.')) || 0;
  if (!n.preco) n.preco = pk ? pk.preco : 0;
  n.preco_usd = n.preco;
  n.preco_fmt = precoFmt(n.preco);
  return n;
}

/* ═══════════════════════════════════════════════
   JWT
   ═══════════════════════════════════════════════ */
function buildClaims(installId, lic) {
  const now = Math.floor(Date.now()/1000);
  const isLife = lic && lic.plano === 'life';
  const days = lic && lic.dias ? lic.dias : 30;
  const exp = isLife ? now + (100*365*24*60*60) : now + (days*24*60*60);
  return {
    sub: installId, iss: 'asheo.api', aud: 'mozlince-client', installId,
    plan:'premium', planDisplayName:'Premium', tier:'premium', kind:'premium',
    status:'active', active:true, isPremium:true, isVerified:true,
    source:'premium', sourceType:'server', isFounder:true,
    lifetime: isLife, plano: lic.plano,
    scope: PREMIUM_SCOPE,
    features: mapFeatures(true), capabilities: mapCapabilities(true),
    limits:{...PREMIUM_LIMITS},
    secret:'segredo-'+installId,
    iat: now, nbf: now-5, exp, jti: crypto.randomUUID()
  };
}
function signToken(claims){ if(!PRIVATE_KEY)throw new Error('Chave privada nao inicializada'); return jwt.sign(claims, PRIVATE_KEY, { algorithm:'ES256' }); }
function formatDate(ts){ if(!ts)return 'Nunca'; return new Date(ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
function humanTime(ms){
  if(ms<=0)return '❌ Expirada';
  const s=Math.floor(ms/1000), d=Math.floor(s/86400), h=Math.floor((s%86400)/3600), m=Math.floor((s%3600)/60);
  if(d>0)return `${d}d ${h}h ${m}m`;
  if(h>0)return `${h}h ${m}m`;
  return `${m}m`;
}
function progressBar(pct, size=10){
  const cheio=Math.round(pct*size/100);
  return '█'.repeat(Math.max(0,cheio))+'░'.repeat(Math.max(0,size-cheio));
}
function generateLicenseKey(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b=()=>{let s='';for(let i=0;i<4;i++)s+=chars[crypto.randomInt(0,chars.length)];return s;};
  return `ASHEO-${b()}-${b()}-${b()}-${b()}`;
}
function validateBearer(req){
  const auth=req.headers['authorization']||'';
  if(!auth.startsWith('Bearer '))return {ok:false,error:'missing_bearer'};
  try{ const d=jwt.verify(auth.substring(7),PUBLIC_KEY||PRIVATE_KEY,{algorithms:['ES256'],clockTolerance:30}); return {ok:true,decoded:d}; }
  catch(e){ return {ok:false,error:e.message}; }
}

/* ═══════════════════════════════════════════════
   GATEWAYS · RULES · CAMPAIGNS
   ═══════════════════════════════════════════════ */
const GATEWAYS=[
  {id:'default-stripe',name:'Stripe',pattern:'https://js.stripe.com/*',enabled:true,isDefault:true},
  {id:'default-checkout',name:'Checkout.com',pattern:'https://*.checkout.com/*',enabled:true,isDefault:true},
  {id:'default-adyen',name:'Adyen',pattern:'https://*.adyen.com/*',enabled:true,isDefault:true},
  {id:'default-braintree',name:'Braintree',pattern:'https://*.braintreegateway.com/*',enabled:true,isDefault:true}
];
const RULES=[
  {id:'bypasser',name:'Bypasser',enabled:true,gateway:'*',priority:1},
  {id:'cardfiller',name:'Card Filler',enabled:true,gateway:'*',priority:2},
  {id:'cvv',name:'CVV Handler',enabled:true,gateway:'*',priority:3},
  {id:'premium',name:'Premium Rules',enabled:true,gateway:'*',priority:10}
];
const CAMPAIGNS=[{id:'default-1',name:'Default Campaign',enabled:true,createdAt:new Date().toISOString()}];

/* ═══════════════════════════════════════════════
   I18N — PT/EN
   ═══════════════════════════════════════════════ */
const T = {
  pt: {
    welcome_title:'Bem-vindo ao Mozlince Nebula',
    welcome_desc:'Se deseja adquirir uma licença, clique abaixo:',
    contact:'📞 CONTACTAR SUPORTE',
    support_title:'📞 SUPORTE',
    support_write:'✍️ Escreva sua mensagem agora:',
    support_hint:'(o próximo texto será encaminhado ao suporte)',
    support_exp:'Sessão expira em 10 minutos',
    support_sent:'✅ MENSAGEM ENVIADA',
    support_sent_desc:'Sua mensagem foi encaminhada ao suporte.\n⏱️ Tempo de resposta: até 24h',
    support_cancel:'❌ Cancelar',
    support_cancelled:'❌ Suporte cancelado',
    cancel:'cancelar',
    menu:'🔙 Menu',
    congrats:'🎉 PARABÉNS!',
    congrats_desc:'Sua licença foi ativada com sucesso!\n\n💎 Aproveite todos os recursos Premium.',
    lang_select:'🌐 Escolha seu idioma / Choose your language:',
    lang_saved:'✅ Idioma salvo',
    back:'🔙 Voltar'
  },
  en: {
    welcome_title:'Welcome to Mozlince Nebula',
    welcome_desc:'If you wish to purchase a license, click below:',
    contact:'📞 CONTACT SUPPORT',
    support_title:'📞 SUPPORT',
    support_write:'✍️ Write your message now:',
    support_hint:'(the next text will be forwarded to support)',
    support_exp:'Session expires in 10 minutes',
    support_sent:'✅ MESSAGE SENT',
    support_sent_desc:'Your message was forwarded to support.\n⏱️ Response time: up to 24h',
    support_cancel:'❌ Cancel',
    support_cancelled:'❌ Support cancelled',
    cancel:'cancel',
    menu:'🔙 Menu',
    congrats:'🎉 CONGRATULATIONS!',
    congrats_desc:'Your license was successfully activated!\n\n💎 Enjoy all Premium features.',
    lang_select:'🌐 Choose your language:',
    lang_saved:'✅ Language saved',
    back:'🔙 Back'
  }
};
function t(lang, key) { return (T[lang] || T.pt)[key] || T.pt[key] || key; }

/* ═══════════════════════════════════════════════
   TELEGRAM — helpers + sessões
   ═══════════════════════════════════════════════ */
const SUPPORT_SESSIONS = new Map();
const USER_LANG = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k,v] of SUPPORT_SESSIONS.entries()) if (now - v.ts > 10*60*1000) SUPPORT_SESSIONS.delete(k);
}, 60000);

const TG_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
async function tgSend(chatId, text, keyboard=null) {
  try {
    const body={chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true};
    if(keyboard)body.reply_markup=keyboard;
    await fetch(`${TG_API}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  } catch(e){ log('TG','send erro: '+e.message); }
}
async function tgEdit(chatId, messageId, text, keyboard=null) {
  try {
    const body={chat_id:chatId,message_id:messageId,text,parse_mode:'HTML',disable_web_page_preview:true};
    if(keyboard)body.reply_markup=keyboard;
    await fetch(`${TG_API}/editMessageText`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  } catch(e){ log('TG','edit erro: '+e.message); }
}
async function tgAnswer(id, text='') {
  try { await fetch(`${TG_API}/answerCallbackQuery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query_id:id,text})}); } catch {}
}

/* ── Layout ── */
const UI = {
  header: () =>
    `<b>╭━━━━『 ⚡ <i>MOZLINCE NEBULA</i> ⚡ 』━━━━╮</b>\n` +
    `<b>┃</b>   <i>Premium License Engine</i>   <b>┃</b>\n` +
    `<b>┃</b>  <code>v8.0 · Asheo Systems</code>  <b>┃</b>\n` +
    `<b>╰━━━━━━━━━━━━━━━━━━━━━━━━╯</b>`,
  div: '━'.repeat(22)
};

function menuPrincipal(lang='pt') {
  const hora = new Date().toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' });
  return {
    texto:
`${UI.header()}

<b>🎛️ PAINEL DE CONTROLE</b>
<code>${UI.div}</code>
<b>🕐</b> ${hora}  <b>🌐</b> Online  <b>🔐</b> ES256
<code>${UI.div}</code>

<i>Selecione uma operação:</i>`,
    teclado: { inline_keyboard: [
      [{ text:'⚡  Gerar Licença  ⚡', callback_data:'m_gerar' }],
      [{ text:'📋 Minhas Chaves', callback_data:'m_listar' }, { text:'📊 Estatísticas', callback_data:'m_stats' }],
      [{ text:'🔗 Vincular', callback_data:'m_vincular' }, { text:'🔓 Desvincular', callback_data:'m_desvincular' }],
      [{ text:'🔍 Consultar', callback_data:'m_consultar' }],
      [{ text:'💰  Tabela de Preços  💰', callback_data:'m_precos' }],
      [{ text:'📞  Suporte  📞', callback_data:'m_contacto' }],
      [{ text:'🌐 Idioma / Language', callback_data:'m_lang' }],
      [{ text:'ℹ️ Ajuda', callback_data:'m_ajuda' }, { text:'⚠️ Zona de Perigo', callback_data:'m_perigo' }]
    ]}
  };
}

async function cmdStart(chatId, msgId=null) {
  const lang = USER_LANG.get(String(chatId)) || 'pt';
  const m = menuPrincipal(lang);
  if (msgId) await tgEdit(chatId, msgId, m.texto, m.teclado);
  else await tgSend(chatId, m.texto, m.teclado);
}

/* ═══════════════════════════════════════════════
   CALLBACK HANDLER
   ═══════════════════════════════════════════════ */
async function handleCallback(cb) {
  const chatId = cb.message.chat.id, msgId = cb.message.message_id, data = cb.data, userId = String(cb.from.id);
  const isOwner = userId === String(OWNER_ID);
  const lang = USER_LANG.get(String(chatId)) || 'pt';

  /* ── Idioma (todos podem usar) ── */
  if (data === 'm_lang') {
    await tgAnswer(cb.id);
    const texto = `${UI.header()}\n\n<b>${t(lang,'lang_select')}</b>\n<code>${UI.div}</code>`;
    const kb = { inline_keyboard: [
      [{ text:'🇧🇷 Português', callback_data:'lang_pt' }, { text:'🇺🇸 English', callback_data:'lang_en' }],
      [{ text: t(lang,'back'), callback_data:'m_home' }]
    ]};
    await tgEdit(chatId, msgId, texto, kb);
    return;
  }
  if (data === 'lang_pt' || data === 'lang_en') {
    const novo = data === 'lang_pt' ? 'pt' : 'en';
    USER_LANG.set(String(chatId), novo);
    await tgAnswer(cb.id, t(novo,'lang_saved'));
    // Regenera menu no novo idioma
    const m = menuPrincipal(novo);
    await tgEdit(chatId, msgId, m.texto, m.teclado);
    return;
  }

  /* ── Não-owner: suporte / idioma / boas-vindas ── */
  if (!isOwner) {
    if (data === 'm_contacto') {
      SUPPORT_SESSIONS.set(String(chatId), { step:'waiting', ts: Date.now() });
      await tgAnswer(cb.id, '📝');
      await tgEdit(chatId, msgId,
`<b>${t(lang,'support_title')}</b>
<code>${UI.div}</code>

${t(lang,'support_write')}
<i>${t(lang,'support_hint')}</i>

<code>${UI.div}</code>
⏱️ ${t(lang,'support_exp')}`,
        { inline_keyboard: [[{ text: t(lang,'support_cancel'), callback_data:'m_cancelar_suporte' }]] });
      return;
    }
    if (data === 'm_cancelar_suporte') {
      SUPPORT_SESSIONS.delete(String(chatId));
      await tgAnswer(cb.id, '❌');
      await tgEdit(chatId, msgId,
`<b>${t(lang,'support_cancelled')}</b>

${t(lang,'welcome_desc')}`,
        { inline_keyboard: [[{ text: t(lang,'contact'), callback_data:'m_contacto' }]] });
      return;
    }
    if (data === 'm_home') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
`<b>👋 ${t(lang,'welcome_title')}</b>
<code>${UI.div}</code>

<i>${t(lang,'welcome_desc')}</i>`,
        { inline_keyboard: [
          [{ text: t(lang,'contact'), callback_data:'m_contacto' }],
          [{ text:'🌐 Idioma / Language', callback_data:'m_lang' }]
        ]});
      return;
    }
    await tgAnswer(cb.id, '⛔');
    return;
  }

  /* ═══════ OWNER ═══════ */
  try {
    if (data === 'm_home') { await tgAnswer(cb.id); return cmdStart(chatId, msgId); }

    /* ── GERAR ── */
    if (data === 'm_gerar') {
      await tgAnswer(cb.id, '💰');
      const kb = { inline_keyboard: [] };
      const entries = Object.entries(PACOTES);
      for (let i = 0; i < entries.length; i += 2) {
        const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome} · ${precoFmt(entries[i][1].preco)}`, callback_data:`g_${entries[i][0]}` }];
        if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome} · ${precoFmt(entries[i+1][1].preco)}`, callback_data:`g_${entries[i+1][0]}` });
        kb.inline_keyboard.push(linha);
      }
      kb.inline_keyboard.push([{ text:'🔙 Voltar', callback_data:'m_home' }]);

      let tabela = '';
      for (const [,p] of Object.entries(PACOTES)) tabela += `${p.emoji} <b>${p.nome.padEnd(10)}</b>  <code>${precoFmt(p.preco)}</code>\n`;

      await tgEdit(chatId, msgId,
`<b>╭──『 ⚡ GERAR LICENÇA 』──╮</b>
<code>${UI.div}</code>
<i>Selecione o plano:</i>

${tabela}
<code>${UI.div}</code>`,
        kb);
      return;
    }

    /* ── Gerar chave ── */
    if (data.startsWith('g_')) {
      const pk = data.substring(2), p = PACOTES[pk];
      if (!p) { await tgAnswer(cb.id, '❌'); return; }
      const chave = generateLicenseKey();
      const agora = Date.now();
      const expira = p.lifetime ? (agora + 100*365*24*60*60*1000) : (agora + p.dias*24*60*60*1000);
      // ⚡ v8: lifetime SEMPRE explícito — corrige bug do Never
      await redisSet(chave, JSON.stringify({
        chave, plano: pk, planoNome: p.nome,
        preco: p.preco, preco_usd: p.preco, preco_fmt: precoFmt(p.preco),
        dias: p.dias,
        lifetime: p.lifetime === true,
        ilimitada: p.lifetime === true,
        criadaEm: agora, expiraEm: expira,
        ativa: true, installId: null, ativadaEm: null,
        v: 8
      }));
      log('OK', `Chave ${pk} gerada: ${chave}`);
      await tgAnswer(cb.id, '🎉');

      const restaTxt = p.lifetime ? '∞ LIFETIME' : humanTime(p.dias*24*60*60*1000);
      const barra = p.lifetime ? '██████████' : progressBar(100);

      await tgEdit(chatId, msgId,
`<b>🎉 ${t('pt','congrats')}</b>
<code>${UI.div}</code>
<i>Licença gerada com sucesso!</i>
<code>${UI.div}</code>

<b>🔑 Chave:</b>
<code>${chave}</code>

<code>${UI.div}</code>
<b>${p.emoji}  Plano:</b>    ${p.nome}
<b>💰  Preço:</b>    <code>${precoFmt(p.preco)}</code>
<b>📅  Emitida:</b>  ${formatDate(agora)}
<b>⏰  Expira:</b>   ${p.lifetime ? 'Nunca' : formatDate(expira)}
<b>⌛  Duração:</b>  ${restaTxt}
<b>🔥  Lifetime:</b> ${p.lifetime ? '✅ Sim' : '❌ Não'}
<code>${UI.div}</code>
<b>${barra}</b>`,
        { inline_keyboard: [
          [{ text:'🔍 Ver Detalhes', callback_data:`c_${chave}` }],
          [{ text:'🔙 Menu Principal', callback_data:'m_home' }]
        ]});
      return;
    }

    /* ── LISTAR ── */
    if (data === 'm_listar') {
      await tgAnswer(cb.id, '📋');
      const keys = await redisKeys('ASHEO-*');
      if (keys.length === 0) {
        await tgEdit(chatId, msgId,
`<b>📋 MINHAS LICENÇAS</b>
<code>${UI.div}</code>
<i>Nenhuma licença cadastrada.</i>`,
          { inline_keyboard: [[{ text:'⚡ Gerar', callback_data:'m_gerar' }],[{ text:'🔙', callback_data:'m_home' }]] });
        return;
      }
      let txt = `<b>📋 MINHAS LICENÇAS</b>  <code>(${keys.length})</code>\n<code>${UI.div}</code>\n\n`;
      const inlineKb = [];
      for (let i = 0; i < Math.min(keys.length, 15); i++) {
        const l = await redisGet(keys[i]); if (!l) continue;
        const exp = l.lifetime ? '∞' : humanTime((l.expiraEm||0) - Date.now());
        const emoji = l.lifetime ? '🔥' : (l.ativa ? '🟢' : '🔴');
        txt += `${emoji}${l.installId?'🔗':'⚪'} <code>${keys[i]}</code>\n   <i>${l.planoNome} · ${exp}</i>\n\n`;
        inlineKb.push([{ text:`⚙️ ${keys[i].substring(0,18)}…`, callback_data:`c_${keys[i]}` }]);
      }
      if (keys.length > 15) txt += `<i>… +${keys.length-15} ocultas</i>\n`;
      inlineKb.push([{ text:'🔄 Atualizar', callback_data:'m_listar' }, { text:'🔙 Voltar', callback_data:'m_home' }]);
      await tgEdit(chatId, msgId, txt, { inline_keyboard: inlineKb });
      return;
    }

    /* ── STATS ── */
    if (data === 'm_stats') {
      await tgAnswer(cb.id, '📊');
      const keys = await redisKeys('ASHEO-*');
      let ativas=0, expiradas=0, vinc=0, life=0, receita=0;
      for (const k of keys) {
        const l = await redisGet(k); if (!l) continue;
        if (l.ativa) ativas++;
        if (!l.lifetime && l.expiraEm < Date.now()) expiradas++;
        if (l.installId) vinc++;
        if (l.lifetime) life++;
        if (l.preco) receita += Number(l.preco) || 0;
      }
      const taxa = keys.length ? Math.round((ativas/keys.length)*100) : 0;
      await tgEdit(chatId, msgId,
`<b>╭──『 📊 ESTATÍSTICAS 』──╮</b>
<code>${UI.div}</code>

<b>🔑  Total:</b>      <code>${keys.length}</code>
<b>🟢  Ativas:</b>     <code>${ativas}</code>
<b>🔴  Expiradas:</b>  <code>${expiradas}</code>
<b>🔗  Vinculadas:</b> <code>${vinc}</code>
<b>🔥  Lifetime:</b>   <code>${life}</code>

<code>${UI.div}</code>
<b>💰  Receita:</b> <code>${precoFmt(receita)}</code>
<b>📈  Taxa ativa:</b> ${taxa}%
<code>${progressBar(taxa, 15)}</code>`,
        { inline_keyboard: [
          [{ text:'🔄 Atualizar', callback_data:'m_stats' }, { text:'🔙 Voltar', callback_data:'m_home' }]
        ]});
      return;
    }

    /* ── VINC / DESVINC / CONSULTAR ── */
    if (data === 'm_vincular') { await tgAnswer(cb.id); return tgEdit(chatId, msgId,
      `<b>🔗 VINCULAR</b>\n<code>${UI.div}</code>\n<code>/activate &lt;installId&gt; &lt;chave&gt;</code>`,
      { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }); }
    if (data === 'm_desvincular') { await tgAnswer(cb.id); return tgEdit(chatId, msgId,
      `<b>🔓 DESVINCULAR</b>\n<code>${UI.div}</code>\n<code>/desvincular &lt;chave&gt;</code>`,
      { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }); }
    if (data === 'm_consultar') { await tgAnswer(cb.id); return tgEdit(chatId, msgId,
      `<b>🔍 CONSULTAR</b>\n<code>${UI.div}</code>\n<code>/status &lt;chave&gt;</code>`,
      { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }); }

    /* ── PREÇOS ── */
    if (data === 'm_precos') {
      await tgAnswer(cb.id);
      let txt = `<b>╭──『 💰 TABELA DE PREÇOS 』──╮</b>\n<code>${UI.div}</code>\n\n`;
      for (const [,p] of Object.entries(PACOTES)) txt += `${p.emoji}  <b>${p.nome.padEnd(11)}</b>  →  <code>${precoFmt(p.preco)}</code>\n`;
      txt += `\n<code>${UI.div}</code>\n💵 <i>USD (Dólar Americano)</i>`;
      await tgEdit(chatId, msgId, txt, { inline_keyboard: [
        [{ text:'📞 Suporte', callback_data:'m_contacto' }],
        [{ text:'⚡ Gerar', callback_data:'m_gerar' }, { text:'🔙 Voltar', callback_data:'m_home' }]
      ]});
      return;
    }

    /* ── SUPORTE ── */
    if (data === 'm_contacto') {
      await tgAnswer(cb.id, '📞');
      SUPPORT_SESSIONS.set(String(chatId), { step:'waiting', ts: Date.now() });
      await tgEdit(chatId, msgId,
`<b>${t(lang,'support_title')}</b>
<code>${UI.div}</code>

${t(lang,'support_write')}
<i>${t(lang,'support_hint')}</i>

<code>${UI.div}</code>
⏱️ ${t(lang,'support_exp')}`,
        { inline_keyboard: [[{ text: t(lang,'support_cancel'), callback_data:'m_cancelar_suporte' }]] });
      return;
    }
    if (data === 'm_cancelar_suporte') {
      SUPPORT_SESSIONS.delete(String(chatId));
      await tgAnswer(cb.id, '❌');
      return cmdStart(chatId, msgId);
    }

    /* ── AJUDA ── */
    if (data === 'm_ajuda') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
`<b>╭──『 ℹ️ AJUDA 』──╮</b>
<code>${UI.div}</code>
<b>Comandos:</b>

<code>/start</code>          — Menu
<code>/gerar</code>          — Gerar licença
<code>/listar</code>         — Listar
<code>/stats</code>          — Estatísticas
<code>/status &lt;k&gt;</code>     — Consultar
<code>/activate &lt;i&gt; &lt;k&gt;</code> — Vincular
<code>/desvincular &lt;k&gt;</code> — Desvincular
<code>/revogar &lt;k&gt;</code>    — Revogar
<code>/deletar &lt;k&gt;</code>    — Deletar uma
<code>/deletartudo</code>     — Deletar TUDO
<code>/resp &lt;id&gt; &lt;msg&gt;</code> — Responder suporte
<code>/lang</code>           — Idioma

<code>${UI.div}</code>`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] });
      return;
    }

    /* ── PERIGO ── */
    if (data === 'm_perigo') {
      await tgAnswer(cb.id, '⚠️');
      await tgEdit(chatId, msgId,
`<b>╭──『 ⚠️ ZONA DE PERIGO 』──╮</b>
<code>${UI.div}</code>
<b>🔴 Ações IRREVERSÍVEIS</b>
<code>${UI.div}</code>`,
        { inline_keyboard: [
          [{ text:'🗑️ Deletar Ativas', callback_data:'danger_ativas' }],
          [{ text:'💣 Deletar TUDO',   callback_data:'danger_tudo' }],
          [{ text:'🔙 Voltar',         callback_data:'m_home' }]
        ]});
      return;
    }
    if (data === 'danger_ativas') { await tgAnswer(cb.id); return tgEdit(chatId, msgId,
      `<b>⚠️ CONFIRMAR</b>\n<code>${UI.div}</code>\nDeletar <b>todas as ativas</b>?`,
      { inline_keyboard: [
        [{ text:'✅ SIM', callback_data:'confirm_ativas' }],
        [{ text:'❌ Cancelar', callback_data:'m_perigo' }]
      ]}); }
    if (data === 'danger_tudo') { await tgAnswer(cb.id); return tgEdit(chatId, msgId,
      `<b>💣 CONFIRMAR TUDO</b>\n<code>${UI.div}</code>\n<b>⚠️ DELETA TUDO</b>`,
      { inline_keyboard: [
        [{ text:'💣 SIM, TUDO', callback_data:'confirm_tudo' }],
        [{ text:'❌ Cancelar', callback_data:'m_perigo' }]
      ]}); }
    if (data === 'confirm_ativas') {
      await tgAnswer(cb.id, '⏳');
      const keys = await redisKeys('ASHEO-*'); let n = 0;
      for (const k of keys) { const l = await redisGet(k); if (l && l.ativa) { await redisDel(k); n++; } }
      return tgEdit(chatId, msgId, `✅ <b>${n}</b> licenças ativas removidas.`,
        { inline_keyboard: [[{ text:'🔙 Menu', callback_data:'m_home' }]] });
    }
    if (data === 'confirm_tudo') {
      await tgAnswer(cb.id, '💣');
      const keys = await redisKeys('ASHEO-*');
      for (const k of keys) await redisDel(k);
      return tgEdit(chatId, msgId, `💣 <b>${keys.length}</b> registros apagados.`,
        { inline_keyboard: [[{ text:'🔙 Menu', callback_data:'m_home' }]] });
    }

    /* ── DETALHES ── */
    if (data.startsWith('c_')) {
      const k = data.substring(2), l = await redisGet(k);
      if (!l) { await tgAnswer(cb.id, '❌'); return; }
      await tgAnswer(cb.id);
      const resta = l.lifetime ? '∞ (Lifetime)' : humanTime((l.expiraEm||0) - Date.now());
      const pct = l.lifetime ? 100 : Math.max(0, Math.min(100, Math.round(((l.expiraEm-Date.now())/(l.dias*86400000))*100)));
      const pk = PACOTES[l.plano] || { emoji:'📦' };
      await tgEdit(chatId, msgId,
`<b>╭──『 🔍 DETALHES 』──╮</b>
<code>${UI.div}</code>
<b>🔑 Chave:</b> <code>${k}</code>
<code>${UI.div}</code>
<b>${pk.emoji}  Plano:</b>     ${l.planoNome}
<b>💰  Preço:</b>     <code>${precoFmt(l.preco)}</code>
<b>📅  Emitida:</b>   ${formatDate(l.criadaEm)}
<b>⏰  Expira:</b>    ${l.lifetime ? 'Nunca' : formatDate(l.expiraEm)}
<b>⌛  Restante:</b>  ${resta}
<b>🔥  Lifetime:</b>  ${l.lifetime ? '✅ Sim' : '❌ Não'}
<b>📌  Status:</b>    ${l.ativa?'🟢 Ativa':'🔴 Revogada'}
<b>🔗  Install:</b>   ${l.installId?`<code>${l.installId.substring(0,16)}…</code>`:'<i>não vinculada</i>'}
<code>${UI.div}</code>
<code>${progressBar(pct)}</code> ${pct}%`,
        { inline_keyboard: [
          [{ text: l.installId?'🔓 Desvincular':'🔗 Vincular', callback_data: l.installId?`dv_${k}`:`v_${k}` }],
          [{ text:'❌ Revogar', callback_data:`rv_${k}` }, { text:'🗑️ Deletar', callback_data:`dl_${k}` }],
          [{ text:'🔙 Menu',   callback_data:'m_home' }]
        ]});
      return;
    }
    if (data.startsWith('v_')) { const k = data.substring(2); await tgAnswer(cb.id); return tgEdit(chatId, msgId,
      `<b>🔗 VINCULAR</b>\n<code>/activate &lt;installId&gt; ${k}</code>`,
      { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:`c_${k}` }]] }); }
    if (data.startsWith('dv_')) {
      const k = data.substring(3), l = await redisGet(k);
      if (l) { l.installId = null; l.ativadaEm = null; await redisSet(k, JSON.stringify(l)); }
      await tgAnswer(cb.id, '🔓');
      return tgEdit(chatId, msgId, `✅ Desvinculada.`, { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:`c_${k}` }]] });
    }
    if (data.startsWith('rv_')) {
      const k = data.substring(3), l = await redisGet(k);
      if (l) { l.ativa = false; await redisSet(k, JSON.stringify(l)); }
      await tgAnswer(cb.id, '❌');
      return tgEdit(chatId, msgId, `❌ Revogada.`, { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:`c_${k}` }]] });
    }
    if (data.startsWith('dl_')) {
      const k = data.substring(3);
      await redisDel(k);
      await tgAnswer(cb.id, '🗑️');
      return tgEdit(chatId, msgId, `🗑️ Deletada.`, { inline_keyboard: [[{ text:'🔙 Menu', callback_data:'m_home' }]] });
    }

    await tgAnswer(cb.id);
  } catch (e) {
    log('ERRO', 'Callback: ' + e.message);
    try { await tgAnswer(cb.id, '❌ Erro'); } catch {}
  }
}

/* ═══════════════════════════════════════════════
   MESSAGE HANDLER — suporte + comandos
   ═══════════════════════════════════════════════ */
async function handleMessage(msg) {
  const chatId = msg.chat.id, userId = String(msg.from.id);
  const texto = (msg.text || '').trim();
  const args = texto.replace(/\n/g,' ').split(' ').filter(a=>a.length>0);
  const cmd = (args[0] || '').toLowerCase();
  const isOwner = userId === String(OWNER_ID);
  const lang = USER_LANG.get(String(chatId)) || 'pt';

  /* ── Sessão de suporte ativa? ── */
  const sessao = SUPPORT_SESSIONS.get(String(chatId));
  if (sessao && sessao.step === 'waiting') {
    if (cmd === '/cancelar' || cmd === '/cancel' || cmd === 'cancelar' || cmd === 'cancel') {
      SUPPORT_SESSIONS.delete(String(chatId));
      await tgSend(chatId, `<b>${t(lang,'support_cancelled')}</b>\n\nUse /start.`);
      return;
    }
    SUPPORT_SESSIONS.delete(String(chatId));
    const userInfo = `${msg.from.first_name||''} ${msg.from.last_name||''}`.trim() || 'Sem nome';
    const username = msg.from.username ? `@${msg.from.username}` : 'sem username';

    await tgSend(chatId,
`<b>${t(lang,'support_sent')}</b>
<code>${UI.div}</code>

${t(lang,'support_sent_desc')}

<code>${UI.div}</code>
<i>Você receberá a resposta aqui.</i>`,
      { inline_keyboard: [[{ text: t(lang,'menu'), callback_data:'m_home' }]] });

    if (!isOwner) {
      await tgSend(OWNER_ID,
`<b>📩 NOVA MENSAGEM DE SUPORTE</b>
<code>${UI.div}</code>
<b>👤 Nome:</b> ${userInfo}
<b>🏷️ User:</b> ${username}
<b>🆔 Chat ID:</b> <code>${chatId}</code>
<code>${UI.div}</code>
<b>💬 Mensagem:</b>
${texto}

<code>${UI.div}</code>
<i>Responda com:</i>
<code>/resp ${chatId} sua mensagem</code>`);
    }
    log('SUPPORT', `Msg de ${chatId}: ${texto.substring(0,50)}`);
    return;
  }

  /* ── Não-owner ── */
  if (!isOwner) {
    if (cmd === '/start' || cmd === '/contacto' || cmd === '/contact' || cmd === '/ajuda' || cmd === '/help' || cmd === '/lang') {
      if (cmd === '/lang') {
        await tgSend(chatId,
`<b>🌐 ${t(lang,'lang_select')}</b>`,
          { inline_keyboard: [
            [{ text:'🇧🇷 Português', callback_data:'lang_pt' }, { text:'🇺🇸 English', callback_data:'lang_en' }]
          ]});
        return;
      }
      await tgSend(chatId,
`<b>👋 ${t(lang,'welcome_title')}</b>
<code>${UI.div}</code>
<i>${t(lang,'welcome_desc')}</i>`,
        { inline_keyboard: [
          [{ text: t(lang,'contact'), callback_data:'m_contacto' }],
          [{ text:'🌐 Idioma / Language', callback_data:'m_lang' }]
        ]});
      return;
    }
    return;
  }

  /* ═══════ OWNER ═══════ */
  try {
    if (cmd === '/start' || cmd === '/menu') { await cmdStart(chatId); return; }
    if (cmd === '/lang') {
      await tgSend(chatId,
`<b>🌐 ${t(lang,'lang_select')}</b>`,
        { inline_keyboard: [
          [{ text:'🇧🇷 Português', callback_data:'lang_pt' }, { text:'🇺🇸 English', callback_data:'lang_en' }]
        ]});
      return;
    }

    /* /resp <chatId> <msg> */
    if (cmd === '/resp') {
      const target = args[1];
      const resposta = args.slice(2).join(' ');
      if (!target || !resposta) { await tgSend(chatId, `⚠️ <code>/resp &lt;chatId&gt; &lt;mensagem&gt;</code>`); return; }
      const targetLang = USER_LANG.get(String(target)) || 'pt';
      await tgSend(target,
`<b>📞 RESPOSTA DO SUPORTE</b>
<code>${UI.div}</code>

${resposta}

<code>${UI.div}</code>
<i>Mozlince Nebula Support</i>`,
        { inline_keyboard: [[{ text: t(targetLang,'contact'), callback_data:'m_contacto' }]] });
      await tgSend(chatId, `✅ Resposta enviada para <code>${target}</code>`);
      log('SUPPORT', `Resposta → ${target}`);
      return;
    }

    if (cmd === '/gerar') {
      const kb = { inline_keyboard: [] };
      const entries = Object.entries(PACOTES);
      for (let i = 0; i < entries.length; i += 2) {
        const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome} · ${precoFmt(entries[i][1].preco)}`, callback_data:`g_${entries[i][0]}` }];
        if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome} · ${precoFmt(entries[i+1][1].preco)}`, callback_data:`g_${entries[i+1][0]}` });
        kb.inline_keyboard.push(linha);
      }
      await tgSend(chatId, `<b>⚡ GERAR LICENÇA</b>`, kb);
      return;
    }

    if (cmd === '/listar') {
      const keys = await redisKeys('ASHEO-*');
      if (keys.length === 0) { await tgSend(chatId, `📭 Nenhuma.`); return; }
      let txt = `<b>📋 LICENÇAS (${keys.length})</b>\n<code>${UI.div}</code>\n`;
      for (let i = 0; i < Math.min(keys.length, 30); i++) {
        const l = await redisGet(keys[i]); if (!l) continue;
        const exp = l.lifetime ? '∞' : humanTime((l.expiraEm||0) - Date.now());
        const emoji = l.lifetime ? '🔥' : (l.ativa ? '🟢' : '🔴');
        txt += `${emoji} <code>${keys[i]}</code>\n   <i>${l.planoNome} · ${exp}</i>\n`;
      }
      await tgSend(chatId, txt);
      return;
    }

    if (cmd === '/status') {
      const k = args[1];
      if (!k) { await tgSend(chatId, `⚠️ /status &lt;chave&gt;`); return; }
      const l = await redisGet(k);
      if (!l) { await tgSend(chatId, `❌ Não encontrada`); return; }
      const resta = l.lifetime ? '∞' : humanTime((l.expiraEm||0) - Date.now());
      const pk = PACOTES[l.plano] || { emoji:'📦' };
      await tgSend(chatId,
`<b>🔍 STATUS</b>
<code>${UI.div}</code>
<b>🔑</b> <code>${k}</code>
<b>${pk.emoji} ${l.planoNome}</b>
💰 ${precoFmt(l.preco)}
📅 ${formatDate(l.criadaEm)}
⏰ ${l.lifetime?'Nunca':formatDate(l.expiraEm)}
⌛ ${resta}
🔥 Lifetime: ${l.lifetime?'✅':'❌'}
📌 ${l.ativa?'🟢':'🔴'}`);
      return;
    }

    if (cmd === '/activate') {
      const chave = args[args.length-1], installId = args.slice(1, args.length-1).join(' ');
      if (!installId || !chave) { await tgSend(chatId, `⚠️ /activate &lt;id&gt; &lt;chave&gt;`); return; }
      const l = await redisGet(chave);
      if (!l) { await tgSend(chatId, `❌ Inválida`); return; }
      if (l.installId) { await tgSend(chatId, `⚠️ Já vinculada`); return; }
      l.installId = installId; l.ativadaEm = Date.now();
      await redisSet(chave, JSON.stringify(l));
      await tgSend(chatId, `✅ Vinculada!\n🔑 <code>${chave}</code>\n🔗 <code>${installId}</code>`);
      return;
    }

    if (cmd === '/desvincular') {
      const k = args[1];
      if (!k) { await tgSend(chatId, `⚠️`); return; }
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

    /* ⚡ DELETAR UMA */
    if (cmd === '/deletar') {
      const k = args[1];
      if (!k) { await tgSend(chatId, `⚠️ <code>/deletar &lt;chave&gt;</code>`); return; }
      const l = await redisGet(k);
      if (!l) { await tgSend(chatId, `❌ Não encontrada`); return; }
      await redisDel(k);
      await tgSend(chatId, `🗑️ Deletada: <code>${k}</code>`);
      return;
    }

    /* ⚡ DELETAR TUDO */
    if (cmd === '/deletartudo') {
      const keys = await redisKeys('ASHEO-*');
      for (const k of keys) await redisDel(k);
      await tgSend(chatId, `💣 <b>${keys.length}</b> licenças apagadas.`);
      return;
    }

    if (cmd === '/stats') {
      const keys = await redisKeys('ASHEO-*');
      let ativas=0, exp=0, vinc=0, life=0, receita=0;
      for (const k of keys) {
        const l = await redisGet(k); if (!l) continue;
        if (l.ativa) ativas++;
        if (!l.lifetime && l.expiraEm < Date.now()) exp++;
        if (l.installId) vinc++;
        if (l.lifetime) life++;
        if (l.preco) receita += Number(l.preco) || 0;
      }
      await tgSend(chatId,
`<b>📊 ESTATÍSTICAS</b>
<code>${UI.div}</code>
🔑 Total: <code>${keys.length}</code>
🟢 Ativas: <code>${ativas}</code>
🔴 Expiradas: <code>${exp}</code>
🔗 Vinculadas: <code>${vinc}</code>
🔥 Lifetime: <code>${life}</code>
💰 Receita: <code>${precoFmt(receita)}</code>`);
      return;
    }

    await tgSend(chatId, `❓ Use /start`);
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
   API REST v8.0
   ═══════════════════════════════════════════════ */
const healthHandler = (req,res) => res.json({ok:true,status:'healthy',uptime:Math.floor(process.uptime()),version:'8.0',codename:'Nebula',timestamp:new Date().toISOString()});
app.get('/',(req,res)=>res.json({ok:true,service:'mozlince-nebula',version:'8.0',status:'live'}));
app.get('/v1/health',healthHandler); app.get('/api/v1/health',healthHandler); app.get('/health',healthHandler);

const versionHandler = (req,res)=>res.json({ok:true,version:'8.0',codename:'Nebula',api:'v1',minClientVersion:'1.0.0',timestamp:new Date().toISOString()});
app.get('/v1/version',versionHandler); app.get('/api/v1/version',versionHandler);
const statusHandler = (req,res)=>res.json({ok:true,service:'mozlince-nebula',version:'8.0',hora:new Date().toISOString()});
app.get('/v1/status',statusHandler); app.get('/api/v1/status',statusHandler);

function bootstrapHandler(req,res){
  const auth=validateBearer(req);
  log('BOOT',`Bootstrap (auth=${auth.ok})`);
  res.json({
    ok:true,version:'8.0',codename:'Nebula',apiVersion:'v1',
    issuedAt:new Date().toISOString(),serverTime:Date.now(),
    source:'premium',sourceType:'server',isFounder:true,tier:'premium',kind:'premium',
    config:{apiBase:'https://mozlince.onrender.com',featuresEnabled:true,premiumEnabled:true,syncEnabled:true,gatewayMode:'default',telemetryEnabled:false,retryAfterMs:5000,heartbeatMs:60000},
    flags:{bootstrapReady:true,exclusiveEnabled:true,rulesEnabled:true,premium:true},
    endpoints:{activate:'/v1/activate',featureActivate:'/v1/feature/activate',deactivate:'/v1/deactivate',verify:'/v1/verify',bootstrap:'/v1/bootstrap',rules:'/v1/rules',exclusive:'/v1/exclusive/manifest',exclusiveSync:'/v1/exclusive/sync',gateways:'/v1/gateways',campaign:'/v1/campaign',dashboard:'/v1/dashboard',health:'/v1/health',version:'/v1/version',support:'/v1/support'},
    features:mapFeatures(true),capabilities:mapCapabilities(true),
    limits:{...PREMIUM_LIMITS},scope:PREMIUM_SCOPE
  });
}
app.get('/v1/bootstrap',bootstrapHandler); app.get('/api/v1/bootstrap',bootstrapHandler);

function rulesHandler(req,res){
  const auth=validateBearer(req);
  const isPremium=auth.ok&&(auth.decoded.tier==='premium'||auth.decoded.scope);
  res.json({ok:true,version:3,updatedAt:new Date().toISOString(),source:'premium',tier:'premium',scope:isPremium?PREMIUM_SCOPE:['free'],rules:isPremium?RULES:RULES.slice(0,1),serverTime:Date.now()});
}
app.get('/v1/rules',rulesHandler); app.get('/api/v1/rules',rulesHandler); app.get('/v1/rules/sync',rulesHandler); app.get('/api/v1/sync',rulesHandler);

function exclusiveHandler(req,res){
  const auth=validateBearer(req);
  res.json({ok:true,source:'premium',tier:'premium',manifest:{version:'1.7.0',version_name:'1.7.0',generatedAt:new Date().toISOString(),minVersion:'1.0.0',exclusiveFeatures:Object.keys(PREMIUM_FEATURES),rules:RULES,gateways:GATEWAYS,signature:crypto.randomBytes(64).toString('hex')},cachedAt:Date.now(),expiresAt:Date.now()+(23*3600*1000)});
}
app.get('/v1/exclusive/manifest',exclusiveHandler); app.get('/api/v1/manifest',exclusiveHandler);
function exclusiveSyncHandler(req,res){
  res.json({ok:true,source:'premium',tier:'premium',manifest:{version:'1.7.0',generatedAt:new Date().toISOString(),rules:RULES,gateways:GATEWAYS,signature:crypto.randomBytes(64).toString('hex')},cachedAt:Date.now()});
}
app.get('/v1/exclusive/sync',exclusiveSyncHandler); app.get('/api/v1/exclusive/sync',exclusiveSyncHandler);

function gatewaysHandler(req,res){res.json({ok:true,source:'premium',tier:'premium',version:1,gateways:GATEWAYS,serverTime:Date.now()});}
app.get('/v1/gateways',gatewaysHandler); app.get('/api/v1/gateways',gatewaysHandler);
function campaignHandler(req,res){res.json({ok:true,source:'premium',tier:'premium',campaigns:CAMPAIGNS,serverTime:Date.now()});}
app.get('/v1/campaign',campaignHandler); app.get('/api/v1/campaign',campaignHandler);

function dashboardHandler(req,res){
  const auth=validateBearer(req);
  const ok=auth.ok&&auth.decoded.tier==='premium';
  res.json({ok:true,source:ok?'premium':'free',sourceType:'server',isFounder:true,
    dashboard:{tier:ok?'premium':'free',source:ok?'premium':'free',seat:auth.ok?1:0,seats:auth.ok?1:0,installId:auth.ok?auth.decoded.sub:null,expiresAt:auth.ok?auth.decoded.exp*1000:null,lifetime:auth.ok?auth.decoded.lifetime===true:false,features:ok?mapFeatures(true):mapFeatures(false),capabilities:ok?mapCapabilities(true):mapCapabilities(false),limits:ok?PREMIUM_LIMITS:FREE_LIMITS,scope:ok?PREMIUM_SCOPE:['free']},serverTime:Date.now()});
}
app.get('/v1/dashboard',dashboardHandler); app.get('/api/v1/dashboard',dashboardHandler);

function entitlementHandler(req,res){
  const auth=validateBearer(req);
  if(!auth.ok)return res.status(401).json({ok:false,error:'missing_bearer'});
  res.json({ok:true,source:'premium',sourceType:'server',isFounder:true,tier:'premium',kind:'premium',active:true,isPremium:true,isVerified:true,installId:auth.decoded.sub,plan:'premium',planDisplayName:'Premium',lifetime:auth.decoded.lifetime===true,scope:PREMIUM_SCOPE,features:mapFeatures(true),capabilities:mapCapabilities(true),limits:{...PREMIUM_LIMITS},exp:auth.decoded.exp*1000,serverTime:Date.now()});
}
app.get('/v1/entitlement',entitlementHandler); app.get('/api/v1/entitlement',entitlementHandler);

function premiumDefHandler(req,res){res.json({ok:true,source:'premium',tier:'premium',features:PREMIUM_FEATURES,capabilities:PREMIUM_CAPABILITIES,premiumLimits:PREMIUM_LIMITS,freeLimits:FREE_LIMITS,scope:PREMIUM_SCOPE,version:'8.0'});}
app.get('/v1/premium/definitions',premiumDefHandler); app.get('/api/v1/premium/definitions',premiumDefHandler);

function planosHandler(req,res){res.json({ok:true,currency:'USD',planos:Object.entries(PACOTES).map(([id,p])=>({id,nome:p.nome,dias:p.dias,lifetime:p.lifetime,preco:p.preco,preco_fmt:precoFmt(p.preco),emoji:p.emoji}))});}
app.get('/v1/planos',planosHandler); app.get('/api/v1/planos',planosHandler);

function manifestCheckHandler(req,res){res.json({ok:true,latest:'1.8.0',minVersion:'1.0.0',channel:req.query.channel||'stable',serverTime:Date.now()});}
app.get('/v1/manifest/check',manifestCheckHandler); app.get('/api/v1/update',manifestCheckHandler); app.get('/api/v1/manifest',manifestCheckHandler);

function packsHandler(req,res){const id=req.params.id;res.json({ok:true,pack:{id,version:'1.0.0',data:null,signature:crypto.randomBytes(32).toString('hex')},serverTime:Date.now()});}
app.get('/v1/packs/:id',packsHandler); app.get('/api/v1/packs/:id',packsHandler);

function telemetryHandler(req,res){res.json({ok:true,received:true,serverTime:Date.now()});}
app.post('/v1/telemetry',telemetryHandler); app.post('/api/v1/telemetry',telemetryHandler);

function supportHandler(req,res){
  const {chatId,message}=req.body||{};
  if(!message)return res.status(400).json({ok:false,error:'missing_message'});
  if(chatId) tgSend(OWNER_ID,`<b>📩 SUPORTE (API)</b>\n🆔 <code>${chatId}</code>\n\n${message}`);
  res.json({ok:true,received:true,serverTime:Date.now()});
}
app.post('/v1/support',supportHandler); app.post('/api/v1/support',supportHandler);

/* ── Activate ── */
async function activateHandler(req,res){
  const inicio=Date.now();
  const {installId,licenseKey,clientTag}=req.body||{};
  log('INFO',`Activate: installId=${installId?installId.substring(0,12)+'...':'?'} | key=${licenseKey?normalizeKey(licenseKey).substring(0,18)+'...':'(vazia)'} | tag=${clientTag||'?'}`);

  if(!licenseKey&&!installId){
    const auth=validateBearer(req);
    if(!auth.ok)return res.status(401).json({ok:false,error:'missing_auth'});
    const feature=(req.body&&req.body.feature)||req.query.feature;
    if(!feature)return res.status(400).json({ok:false,error:'missing_feature'});
    if(!PREMIUM_FEATURES[feature])return res.status(404).json({ok:false,error:'unknown_feature'});
    const now=Math.floor(Date.now()/1000);
    const token=jwt.sign({sub:auth.decoded.sub,installId:auth.decoded.sub,feature,kind:'feature',type:'feature',tier:'premium',source:'premium',isFounder:true,scope:[feature,'premium'],iat:now,nbf:now-5,exp:now+300,jti:crypto.randomUUID()},PRIVATE_KEY,{algorithm:'ES256'});
    log('FEAT',`✅ ${feature} | ${auth.decoded.sub} | ${Date.now()-inicio}ms`);
    return res.json({ok:true,token,feature,expires_in:300,exp:now+300});
  }

  if(!installId||typeof installId!=='string'||installId.length<5)return res.status(400).json({error:'missing_installId'});
  if(!PRIVATE_KEY)return res.status(500).json({error:'server_misconfigured'});
  if(!licenseKey||typeof licenseKey!=='string'||!licenseKey.toUpperCase().startsWith('ASHEO-'))return res.status(401).json({error:'missing_license'});

  const keyNorm=normalizeKey(licenseKey);
  const lic=await redisGet(keyNorm);
  if(!lic){log('WARN',`NAO ENCONTRADA: ${keyNorm.substring(0,18)}...`);return res.status(404).json({error:'invalid_license'});}
  if(!lic.ativa)return res.status(403).json({error:'revoked'});

  if(!lic.installId){lic.installId=installId;lic.ativadaEm=Date.now();await redisSet(keyNorm,JSON.stringify(lic));log('OK',`Vinculada: ${keyNorm.substring(0,18)}... -> ${installId}`);}
  else if(lic.installId!==installId)return res.status(403).json({error:'already_used'});
  if(!lic.lifetime&&Date.now()>lic.expiraEm)return res.status(403).json({error:'expired'});

  try{
    const token=signToken(buildClaims(installId,lic));
    log('ATIV',`✅ ${installId.substring(0,12)}... | ${keyNorm.substring(0,18)}... | ${Date.now()-inicio}ms`);
    return res.json({
      token,tier:'premium',kind:'premium',source:'premium',sourceType:'server',isFounder:true,
      seat:1,seats:1,gwPass:null,plan:'premium',planDisplayName:'Premium',
      lifetime:lic.lifetime===true,
      expires_in:lic.lifetime?-1:Math.floor((lic.expiraEm-Date.now())/1000),
      licenseKey:keyNorm,
      // ⚡ v8: mensagem de boas-vindas
      welcome: {
        pt: '🎉 Parabéns! Licença ativada com sucesso.',
        en: '🎉 Congratulations! License successfully activated.'
      }
    });
  }catch(e){return res.status(500).json({error:'internal',message:e.message});}
}
app.post('/v1/activate',activateHandler);
app.post('/api/v1/activate',activateHandler);
app.post('/api/v1/license/activate',activateHandler);

async function featureActivateHandler(req,res){
  const auth=validateBearer(req);
  if(!auth.ok)return res.status(401).json({ok:false,error:'missing_bearer'});
  const feature=(req.body&&req.body.feature)||req.query.feature;
  if(!feature)return res.status(400).json({ok:false,error:'missing_feature'});
  if(!PREMIUM_FEATURES[feature])return res.status(404).json({ok:false,error:'unknown_feature'});
  const now=Math.floor(Date.now()/1000);
  const token=jwt.sign({sub:auth.decoded.sub,installId:auth.decoded.sub,feature,kind:'feature',type:'feature',tier:'premium',source:'premium',isFounder:true,scope:[feature,'premium'],iat:now,nbf:now-5,exp:now+300,jti:crypto.randomUUID()},PRIVATE_KEY,{algorithm:'ES256'});
  res.json({ok:true,token,feature,expires_in:300,exp:now+300});
}
app.post('/v1/feature/activate',featureActivateHandler); app.get('/v1/feature/activate',featureActivateHandler);
app.post('/api/v1/feature/activate',featureActivateHandler); app.get('/api/v1/feature/activate',featureActivateHandler);

async function deactivateHandler(req,res){
  const {installId,licenseKey}=req.body||{};
  if(licenseKey){
    const lic=await redisGet(licenseKey);
    if(lic&&lic.installId===installId){lic.installId=null;lic.ativadaEm=null;await redisSet(licenseKey,JSON.stringify(lic));}
  }
  res.json({ok:true,message:'Desativado'});
}
app.post('/v1/deactivate',deactivateHandler); app.post('/api/v1/deactivate',deactivateHandler); app.post('/api/v1/license/deactivate',deactivateHandler);

function verifyHandler(req,res){
  const {token}=req.body||{};
  if(!token)return res.status(400).json({ok:false,error:'missing_token'});
  try{const d=jwt.verify(token,PUBLIC_KEY||PRIVATE_KEY,{algorithms:['ES256'],clockTolerance:30});return res.json({ok:true,valido:true,dados:d});}
  catch(e){return res.status(401).json({ok:false,valido:false,erro:e.message});}
}
app.post('/v1/verify',verifyHandler); app.post('/api/v1/verify',verifyHandler); app.post('/api/v1/license/verify',verifyHandler);
app.post('/verificar-licenca',(req,res)=>{
  const {token}=req.body;
  if(!token)return res.status(400).json({erro:'Token obrigatorio'});
  try{const d=jwt.verify(token,PUBLIC_KEY||PRIVATE_KEY,{algorithms:['ES256'],clockTolerance:30});res.json({valido:true,dados:d});}
  catch(e){res.status(401).json({valido:false,erro:e.message});}
});

function heartbeatHandler(req,res){
  const auth=validateBearer(req);
  if(!auth.ok)return res.status(401).json({ok:false,error:'missing_bearer'});
  res.json({ok:true,alive:true,serverTime:Date.now(),expiresAt:auth.decoded.exp*1000});
}
app.post('/v1/heartbeat',heartbeatHandler); app.get('/v1/heartbeat',heartbeatHandler);
app.post('/api/v1/heartbeat',heartbeatHandler); app.get('/api/v1/heartbeat',heartbeatHandler);

app.use((req,res)=>{res.status(404).json({ok:false,error:'not_found',path:req.path});});

/* ═══════════════════════════════════════════════
   START
   ═══════════════════════════════════════════════ */
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>{
  banner();
  log('SYS',`🚀 Mozlince Nebula v8.0 na porta ${PORT}`);
  log('SYS',`Chave: ${ORIGEM}`);
  log('SYS',`Redis: ${UPSTASH_URL?'OK':'FALTA'}`);
  log('SYS',`Telegram: ${TELEGRAM_TOKEN?'OK':'FALTA'}`);
  log('SYS',`Planos: ${Object.keys(PACOTES).length} (USD)`);
  log('OK', `✅ Bug "Never" corrigido (lifetime explícito)`);
  log('OK', `✅ Suporte interativo + /resp`);
  log('OK', `✅ Deletar uma / Deletar tudo`);
  log('OK', `✅ Tradutor PT/EN com /lang`);
  log('OK', `✅ Welcome message no /activate`);
});

process.on('uncaughtException',e=>log('ERRO','Uncaught: '+e.message));
process.on('unhandledRejection',e=>log('ERRO','Rejection: '+e));
