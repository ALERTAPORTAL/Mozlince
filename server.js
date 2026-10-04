require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// ═══════════════════════════════════════════════
// LOGS COLORIDOS
// ═══════════════════════════════════════════════
const C = { r:'\x1b[0m', b:'\x1b[1m', g:'\x1b[32m', y:'\x1b[33m', red:'\x1b[31m', c:'\x1b[36m', m:'\x1b[35m', bl:'\x1b[34m', gr:'\x1b[90m' };
function log(t, m) {
  const ts = new Date().toISOString().replace('T',' ').substring(0,19);
  const cores = { INFO:C.c, OK:C.g, WARN:C.y, ERRO:C.red, SYS:C.m, ATIV:C.bl, SYNC:'\x1b[35m', BOT:'\x1b[36m' };
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
    try { crypto.createPrivateKey(PRIVATE_KEY); log('OK','Chave privada ES256 validada'); }
    catch (e) { log('ERRO','Chave privada invalida: '+e.message); PRIVATE_KEY = null; }
  } else { log('ERRO','Nenhuma chave privada encontrada'); }
})();

// ═══════════════════════════════════════════════
// ENV
// ═══════════════════════════════════════════════
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID;

// ═══════════════════════════════════════════════
// REDIS HELPERS
// ═══════════════════════════════════════════════
async function redisSet(key, value) {
  const res = await fetch(`${UPSTASH_URL}/set/${key}`, { method:'POST', headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}`, 'Content-Type':'application/json' }, body:value });
  return res.json();
}
async function redisGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${key}`, { headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}
async function redisDel(key) {
  await fetch(`${UPSTASH_URL}/del/${key}`, { method:'POST', headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } });
}
async function redisKeys(pattern='*') {
  const res = await fetch(`${UPSTASH_URL}/keys/${pattern}`, { headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } });
  const data = await res.json();
  return data.result || [];
}

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════
function generateLicenseKey() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const blk=()=>{let s='';for(let i=0;i<4;i++)s+=chars[crypto.randomInt(0,chars.length)];return s;};
  return `ASHEO-${blk()}-${blk()}-${blk()}-${blk()}`;
}

function buildClaims(installId, plan, days) {
  const now = Math.floor(Date.now()/1000);
  const isUnli = days >= 3650;
  return {
    sub: installId, iss:'mozlince-license-api', aud:'mozlince-client',
    installId, status:'active', plan, planDisplayName: plan==='premium'?'Premium':plan,
    tier: plan==='premium'?'premium':'free', kind: plan==='premium'?'premium':'free',
    active:true, isPremium:true, isVerified:true,
    features:{advanced_automation:true,multi_account:true,cloud_sync:true,priority_support:true,custom_export:true,api_access:true},
    capabilities:{bulk_actions:true,advanced_analytics:true,custom_webhooks:true},
    limits:{max_accounts:-1,daily_actions:-1,max_templates:-1,history_days:-1,export_limit:-1},
    secret:'segredo-'+installId,
    iat:now, nbf:now-5,
    exp: isUnli ? now+(365*24*60*60*10) : now+(days*24*60*60),
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
  const d = Math.floor(s/86400);
  const h = Math.floor((s%86400)/3600);
  const m = Math.floor((s%3600)/60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ═══════════════════════════════════════════════
// PACOTES / PREÇOS
// ═══════════════════════════════════════════════
const PACOTES = {
  '3d':   { nome:'3 Dias',     dias:3,    preco:'R$ 2,99',   emoji:'🥉' },
  '7d':   { nome:'7 Dias',     dias:7,    preco:'R$ 4,99',   emoji:'🥈' },
  '15d':  { nome:'15 Dias',    dias:15,   preco:'R$ 7,99',   emoji:'🥇' },
  '30d':  { nome:'1 Mês',      dias:30,   preco:'R$ 12,99',  emoji:'💎' },
  '90d':  { nome:'3 Meses',    dias:90,   preco:'R$ 29,99',  emoji:'👑' },
  '1a':   { nome:'1 Ano',      dias:365,  preco:'R$ 79,99',  emoji:'🏆' },
  'unli': { nome:'ILIMITADO',  dias:3650, preco:'R$ 149,99', emoji:'🔥' }
};

// ═══════════════════════════════════════════════
// TELEGRAM HELPERS
// ═══════════════════════════════════════════════
const TG_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

async function tgSend(chatId, text, keyboard=null, parseMode='HTML') {
  try {
    const body = { chat_id: chatId, text, parse_mode: parseMode, disable_web_page_preview: true };
    if (keyboard) body.reply_markup = keyboard;
    await fetch(`${TG_API}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  } catch (e) { log('ERRO', 'tgSend: ' + e.message); }
}

async function tgEdit(chatId, messageId, text, keyboard=null, parseMode='HTML') {
  try {
    const body = { chat_id: chatId, message_id: messageId, text, parse_mode: parseMode, disable_web_page_preview: true };
    if (keyboard) body.reply_markup = keyboard;
    await fetch(`${TG_API}/editMessageText`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  } catch (e) { log('ERRO', 'tgEdit: ' + e.message); }
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
    `║      <i>Premium Edition v4.0</i>         ║\n` +
    `╚══════════════════════════════════════╝\n\n` +
    `🎯 <b>Painel de Controle Premium</b>\n\n` +
    `💎 <i>Sistema completo de licenças com JWT ES256</i>\n` +
    `🔐 <i>Validação em tempo real via Redis</i>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✨ <b>Selecione uma ação:</b>`;

  return {
    texto,
    teclado: { inline_keyboard: [
      [{ text:'🔑 GERAR LICENÇA', callback_data:'m_gerar' }],
      [{ text:'📋 LISTAR LICENÇAS', callback_data:'m_listar' }, { text:'📊 ESTATÍSTICAS', callback_data:'m_stats' }],
      [{ text:'🔗 VINCULAR ID', callback_data:'m_vincular' }, { text:'🔓 DESVINCULAR', callback_data:'m_desvincular' }],
      [{ text:'🔍 CONSULTAR CHAVE', callback_data:'m_consultar' }],
      [{ text:'❌ REVOGAR CHAVE', callback_data:'m_revogar' }, { text:'🗑️ DELETAR CHAVE', callback_data:'m_deletar' }],
      [{ text:'💰 VER PREÇOS', callback_data:'m_precos' }],
      [{ text:'📞 CONTACTAR ADMIN', callback_data:'m_contacto' }, { text:'ℹ️ AJUDA', callback_data:'m_ajuda' }],
      [{ text:'⚠️ ZONA DE PERIGO', callback_data:'m_perigo' }]
    ]}
  };
}

// ═══════════════════════════════════════════════
// HANDLER: /start e menu principal
// ═══════════════════════════════════════════════
async function cmdStart(chatId, msgId=null) {
  const m = menuPrincipal();
  if (msgId) await tgEdit(chatId, msgId, m.texto, m.teclado);
  else await tgSend(chatId, m.texto, m.teclado);
}

// ═══════════════════════════════════════════════
// HANDLER: callback queries
// ═══════════════════════════════════════════════
async function handleCallback(cb) {
  const chatId = cb.message.chat.id;
  const msgId = cb.message.message_id;
  const data = cb.data;
  const userId = String(cb.from.id);

  // ⛔ Admin check (só o admin acessa o painel)
  if (userId !== String(OWNER_ID)) {
    await tgAnswer(cb.id, '⛔ Acesso negado.');
    // Se não for admin e pediu contacto, envia mensagem ao admin
    if (data === 'm_contacto') {
      await tgSend(chatId, '📞 <b>Pedido enviado ao administrador.</b>\n\nEm breve entrará em contacto.');
      await tgSend(OWNER_ID, `📞 <b>Novo pedido de contacto</b>\n\n👤 Chat ID: <code>${chatId}</code>\n📛 Nome: ${cb.from.first_name || '?'}\n🆔 User: @${cb.from.username || 'sem username'}`);
      return;
    }
    return;
  }

  try {
    // ─── MENU PRINCIPAL ───
    if (data === 'm_home') { await tgAnswer(cb.id); return cmdStart(chatId, msgId); }

    // ─── GERAR ───
    if (data === 'm_gerar') {
      await tgAnswer(cb.id, '💰 Escolha o pacote');
      const kb = { inline_keyboard: [] };
      const entries = Object.entries(PACOTES);
      for (let i = 0; i < entries.length; i += 2) {
        const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome} — ${entries[i][1].preco}`, callback_data: `g_${entries[i][0]}` }];
        if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome} — ${entries[i+1][1].preco}`, callback_data: `g_${entries[i+1][0]}` });
        kb.inline_keyboard.push(linha);
      }
      kb.inline_keyboard.push([{ text:'🔙 Voltar', callback_data:'m_home' }]);
      await tgEdit(chatId, msgId,
        `╔══════════════════════════════════════╗\n` +
        `║      🔑 <b>GERAR NOVA LICENÇA</b>      ║\n` +
        `╚══════════════════════════════════════╝\n\n` +
        `💰 <b>Tabela de Preços Premium</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        Object.values(PACOTES).map(p => `${p.emoji} <b>${p.nome}</b> — <code>${p.preco}</code>`).join('\n') +
        `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👇 <b>Selecione um pacote:</b>`,
        kb
      );
      return;
    }

    // ─── GERAR PACOTE ESPECÍFICO ───
    if (data.startsWith('g_')) {
      const pk = data.substring(2);
      const p = PACOTES[pk];
      if (!p) { await tgAnswer(cb.id, '❌ Pacote inválido'); return; }
      const chave = generateLicenseKey();
      const agora = Date.now();
      const expira = agora + p.dias * 24 * 60 * 60 * 1000;
      await redisSet(chave, JSON.stringify({
        chave, plano: pk, planoNome: p.nome, preco: p.preco,
        criadaEm: agora, expiraEm: expira, ilimitada: p.dias >= 3650,
        ativa: true, installId: null, ativadaEm: null
      }));
      await tgAnswer(cb.id, '✅ Licença gerada!');
      await tgEdit(chatId, msgId,
        `✅ <b>LICENÇA GERADA COM SUCESSO!</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🔑 <b>Chave:</b>\n<code>${chave}</code>\n\n` +
        `${p.emoji} <b>Pacote:</b> ${p.nome}\n` +
        `💰 <b>Preço:</b> <code>${p.preco}</code>\n` +
        `📅 <b>Criada:</b> ${formatDate(agora)}\n` +
        `⏰ <b>Expira:</b> ${p.dias >= 3650 ? '🔥 Nunca' : formatDate(expira)}\n` +
        `⌛ <b>Validade:</b> ${p.dias >= 3650 ? 'Ilimitada' : humanTime(expira - agora)}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `💡 Use <code>/activate &lt;installId&gt; ${chave}</code> para vincular.`,
        { inline_keyboard: [
          [{ text:'🔗 VINCULAR AGORA', callback_data:`v_${chave}` }],
          [{ text:'🔍 VER DETALHES', callback_data:`c_${chave}` }],
          [{ text:'🔙 MENU', callback_data:'m_home' }]
        ]}
      );
      return;
    }

    // ─── LISTAR ───
    if (data === 'm_listar') {
      await tgAnswer(cb.id);
      const keys = await redisKeys('ASHEO-*');
      if (keys.length === 0) {
        await tgEdit(chatId, msgId,
          `📋 <b>LISTA DE LICENÇAS</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n📭 Nenhuma licença cadastrada.`,
          { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }
        );
        return;
      }
      let txt = `📋 <b>LICENÇAS CADASTRADAS (${keys.length})</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      for (let i = 0; i < Math.min(keys.length, 25); i++) {
        const k = keys[i];
        const lic = await redisGet(k);
        if (!lic) continue;
        const exp = lic.ilimitada ? '∞' : humanTime((lic.expiraEm || 0) - Date.now());
        const status = lic.ativa ? '🟢' : '🔴';
        const vinculo = lic.installId ? '🔗' : '⚪';
        txt += `${status}${vinculo} <code>${k}</code>\n     ${PACOTES[lic.plano]?.emoji || '📦'} ${lic.planoNome} • ⏰ ${exp}\n\n`;
      }
      if (keys.length > 25) txt += `\n<i>... e mais ${keys.length - 25} licenças</i>\n`;
      await tgEdit(chatId, msgId, txt,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }
      );
      return;
    }

    // ─── ESTATÍSTICAS ───
    if (data === 'm_stats') {
      await tgAnswer(cb.id);
      const keys = await redisKeys('ASHEO-*');
      let ativas = 0, expiradas = 0, vinculadas = 0, ilimitadas = 0, receita = 0;
      for (const k of keys) {
        const l = await redisGet(k);
        if (!l) continue;
        if (l.ativa) ativas++;
        if (!l.ilimitada && l.expiraEm < Date.now()) expiradas++;
        if (l.installId) vinculadas++;
        if (l.ilimitada) ilimitadas++;
        if (l.preco) receita += parseFloat(String(l.preco).replace(/[^\d.,]/g,'').replace(',','.')) || 0;
      }
      await tgEdit(chatId, msgId,
        `📊 <b>ESTATÍSTICAS GERAIS</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔑 <b>Total:</b> <code>${keys.length}</code>\n` +
        `🟢 <b>Ativas:</b> <code>${ativas}</code>\n` +
        `🔴 <b>Expiradas:</b> <code>${expiradas}</code>\n` +
        `🔗 <b>Vinculadas:</b> <code>${vinculadas}</code>\n` +
        `🔥 <b>Ilimitadas:</b> <code>${ilimitadas}</code>\n\n` +
        `💰 <b>Receita estimada:</b> <code>R$ ${receita.toFixed(2)}</code>\n` +
        `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        { inline_keyboard: [[{ text:'🔄 Atualizar', callback_data:'m_stats' }], [{ text:'🔙 Voltar', callback_data:'m_home' }]] }
      );
      return;
    }

    // ─── VINCULAR ID ───
    if (data === 'm_vincular') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
        `🔗 <b>VINCULAR LICENÇA A UM ID</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📝 <b>Como usar:</b>\n\n` +
        `<code>/activate &lt;installId&gt; &lt;chave&gt;</code>\n\n` +
        `💡 <b>Exemplo:</b>\n` +
        `<code>/activate 683d7467-6b80-4bd2-b47c ASHEO-XXXX-XXXX-XXXX-XXXX</code>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }
      );
      return;
    }

    // ─── DESVINCULAR ───
    if (data === 'm_desvincular') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
        `🔓 <b>DESVINCULAR LICENÇA</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📝 <b>Como usar:</b>\n\n` +
        `<code>/desvincular &lt;chave&gt;</code>\n\n` +
        `💡 A chave ficará livre para ser vinculada a outro ID.`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }
      );
      return;
    }

    // ─── CONSULTAR CHAVE ───
    if (data === 'm_consultar') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
        `🔍 <b>CONSULTAR CHAVE</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📝 <b>Como usar:</b>\n\n` +
        `<code>/status &lt;chave&gt;</code>\n\n` +
        `💡 Mostra todos os detalhes da licença.`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }
      );
      return;
    }

    // ─── REVOGAR ───
    if (data === 'm_revogar') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
        `❌ <b>REVOGAR CHAVE</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📝 <b>Como usar:</b>\n\n` +
        `<code>/revogar &lt;chave&gt;</code>\n\n` +
        `⚠️ <b>Aviso:</b> A chave fica inativa permanentemente.`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }
      );
      return;
    }

    // ─── DELETAR ───
    if (data === 'm_deletar') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
        `🗑️ <b>DELETAR CHAVE</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📝 <b>Como usar:</b>\n\n` +
        `<code>/deletar &lt;chave&gt;</code>\n\n` +
        `⚠️ <b>Aviso:</b> Ação irreversível!`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }
      );
      return;
    }

    // ─── PREÇOS ───
    if (data === 'm_precos') {
      await tgAnswer(cb.id);
      let txt = `💰 <b>TABELA DE PREÇOS PREMIUM</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      for (const [k, p] of Object.entries(PACOTES)) {
        txt += `${p.emoji} <b>${p.nome}</b>\n     💵 <code>${p.preco}</code> • ⏰ ${p.dias >= 3650 ? 'Ilimitado' : p.dias + ' dias'}\n\n`;
      }
      txt += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n💎 <i>Todos os pacotes incluem:</i>\n✅ Acesso premium completo\n✅ Multi-dispositivo\n✅ Suporte prioritário\n✅ Atualizações automáticas`;
      await tgEdit(chatId, msgId, txt,
        { inline_keyboard: [[{ text:'🛒 COMPRAR AGORA', callback_data:'m_contacto' }], [{ text:'🔙 Voltar', callback_data:'m_home' }]] }
      );
      return;
    }

    // ─── CONTACTAR ADMIN ───
    if (data === 'm_contacto') {
      await tgAnswer(cb.id, '📞 Pedido enviado!');
      await tgEdit(chatId, msgId,
        `📞 <b>CONTACTAR ADMIN</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `✅ <b>Pedido enviado com sucesso!</b>\n\n` +
        `O administrador foi notificado e entrará\nem contacto contigo em breve.\n\n` +
        `⏰ <b>Tempo médio de resposta:</b> até 24h\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }
      );
      // Notifica o admin (o ID só é usado internamente, nunca exposto)
      await tgSend(OWNER_ID, `📞 <b>Novo pedido de contacto</b>\n\n👤 Nome: ${cb.from.first_name || '?'}\n🆔 User: @${cb.from.username || 'sem username'}\n💬 Chat: <code>${chatId}</code>`);
      return;
    }

    // ─── AJUDA ───
    if (data === 'm_ajuda') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
        `ℹ️ <b>AJUDA E COMANDOS</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔑 <b>GERENCIAR LICENÇAS</b>\n` +
        `<code>/gerar</code> — Gera nova licença\n` +
        `<code>/listar</code> — Lista todas\n` +
        `<code>/status &lt;chave&gt;</code> — Consulta detalhes\n` +
        `<code>/activate &lt;id&gt; &lt;chave&gt;</code> — Vincula\n` +
        `<code>/desvincular &lt;chave&gt;</code> — Desvincula\n` +
        `<code>/revogar &lt;chave&gt;</code> — Revoga\n` +
        `<code>/deletar &lt;chave&gt;</code> — Deleta uma\n` +
        `<code>/deletartudo</code> — Deleta TODAS\n\n` +
        `📊 <b>GESTÃO</b>\n` +
        `<code>/stats</code> — Estatísticas\n` +
        `<code>/menu</code> — Menu principal\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:'m_home' }]] }
      );
      return;
    }

    // ─── ZONA DE PERIGO ───
    if (data === 'm_perigo') {
      await tgAnswer(cb.id, '⚠️ Zona de perigo!');
      await tgEdit(chatId, msgId,
        `⚠️ <b>ZONA DE PERIGO</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🚨 <b>Ações irreversíveis!</b>\n\n` +
        `🗑️ <b>Deletar todas as ATIVAS:</b>\n<code>/deletarativas</code>\n\n` +
        `💣 <b>Deletar TODAS as chaves:</b>\n<code>/deletartudo</code>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `⚠️ <b>Recomenda-se backup antes!</b>`,
        { inline_keyboard: [
          [{ text:'🗑️ DELETAR ATIVAS', callback_data:'danger_ativas' }],
          [{ text:'💣 DELETAR TUDO', callback_data:'danger_tudo' }],
          [{ text:'🔙 Voltar', callback_data:'m_home' }]
        ]}
      );
      return;
    }

    // ─── CONFIRMAÇÕES ZONA DE PERIGO ───
    if (data === 'danger_ativas') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
        `⚠️ <b>CONFIRMAR: DELETAR TODAS AS ATIVAS?</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Todas as licenças ATIVAS serão removidas.\n\n` +
        `Tem certeza?`,
        { inline_keyboard: [
          [{ text:'✅ SIM, DELETAR', callback_data:'confirm_ativas' }],
          [{ text:'❌ Cancelar', callback_data:'m_perigo' }]
        ]}
      );
      return;
    }

    if (data === 'danger_tudo') {
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
        `💣 <b>CONFIRMAR: DELETAR TUDO?</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `⚠️ <b>TODAS as chaves serão removidas!</b>\n\n` +
        `Não há volta atrás. Continuar?`,
        { inline_keyboard: [
          [{ text:'💣 SIM, DELETAR TUDO', callback_data:'confirm_tudo' }],
          [{ text:'❌ Cancelar', callback_data:'m_perigo' }]
        ]}
      );
      return;
    }

    if (data === 'confirm_ativas') {
      await tgAnswer(cb.id, 'Deletando...');
      const keys = await redisKeys('ASHEO-*');
      let deletadas = 0;
      for (const k of keys) {
        const l = await redisGet(k);
        if (l && l.ativa) { await redisDel(k); deletadas++; }
      }
      await tgEdit(chatId, msgId,
        `✅ <b>LICENÇAS ATIVAS DELETADAS</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🗑️ <b>Total removido:</b> <code>${deletadas}</code>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        { inline_keyboard: [[{ text:'🔙 Voltar ao Menu', callback_data:'m_home' }]] }
      );
      return;
    }

    if (data === 'confirm_tudo') {
      await tgAnswer(cb.id, 'Deletando tudo...');
      const keys = await redisKeys('ASHEO-*');
      let deletadas = 0;
      for (const k of keys) { await redisDel(k); deletadas++; }
      await tgEdit(chatId, msgId,
        `💣 <b>BANCO LIMPO COMPLETAMENTE</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🗑️ <b>Total removido:</b> <code>${deletadas}</code>\n\n` +
        `⚠️ Todas as chaves foram apagadas.\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        { inline_keyboard: [[{ text:'🔙 Voltar ao Menu', callback_data:'m_home' }]] }
      );
      return;
    }

    // ─── DETALHES DE CHAVE ESPECÍFICA ───
    if (data.startsWith('c_')) {
      const k = data.substring(2);
      const l = await redisGet(k);
      if (!l) { await tgAnswer(cb.id, '❌ Chave não encontrada'); return; }
      await tgAnswer(cb.id);
      const exp = l.ilimitada ? '🔥 Nunca' : formatDate(l.expiraEm);
      const restaMs = l.ilimitada ? Infinity : (l.expiraEm - Date.now());
      const resta = l.ilimitada ? '∞ Ilimitado' : (restaMs > 0 ? humanTime(restaMs) : '❌ Expirada');
      await tgEdit(chatId, msgId,
        `🔍 <b>DETALHES DA LICENÇA</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔑 <b>Chave:</b>\n<code>${k}</code>\n\n` +
        `${PACOTES[l.plano]?.emoji || '📦'} <b>Pacote:</b> ${l.planoNome}\n` +
        `💰 <b>Preço:</b> ${l.preco}\n` +
        `📅 <b>Criada:</b> ${formatDate(l.criadaEm)}\n` +
        `⏰ <b>Expira:</b> ${exp}\n` +
        `⌛ <b>Restante:</b> ${resta}\n\n` +
        `🔗 <b>Install ID:</b> ${l.installId ? `<code>${l.installId}</code>` : '<i>Não vinculada</i>'}\n` +
        `📌 <b>Status:</b> ${l.ativa ? '🟢 Ativa' : '🔴 Inativa'}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        { inline_keyboard: [
          [{ text: l.installId ? '🔓 Desvincular' : '🔗 Vincular', callback_data: l.installId ? `dv_${k}` : `v_${k}` }],
          [{ text:'❌ Revogar', callback_data:`rv_${k}` }, { text:'🗑️ Deletar', callback_data:`dl_${k}` }],
          [{ text:'🔙 Voltar', callback_data:'m_home' }]
        ]}
      );
      return;
    }

    // ─── VINCULAR RÁPIDO ───
    if (data.startsWith('v_')) {
      const k = data.substring(2);
      await tgAnswer(cb.id);
      await tgEdit(chatId, msgId,
        `🔗 <b>VINCULAR CHAVE</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔑 <code>${k}</code>\n\n` +
        `📝 <b>Envie o comando:</b>\n` +
        `<code>/activate &lt;installId&gt; ${k}</code>`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:`c_${k}` }]] }
      );
      return;
    }

    // ─── DESVINCULAR DIRETO ───
    if (data.startsWith('dv_')) {
      const k = data.substring(3);
      const l = await redisGet(k);
      if (l) { l.installId = null; l.ativadaEm = null; await redisSet(k, JSON.stringify(l)); }
      await tgAnswer(cb.id, '🔓 Desvinculada');
      await tgEdit(chatId, msgId,
        `✅ <b>CHAVE DESVINCULADA</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔑 <code>${k}</code>\n\n` +
        `🔓 Livre para vincular a outro ID.`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:`c_${k}` }]] }
      );
      return;
    }

    // ─── REVOGAR DIRETO ───
    if (data.startsWith('rv_')) {
      const k = data.substring(3);
      const l = await redisGet(k);
      if (l) { l.ativa = false; await redisSet(k, JSON.stringify(l)); }
      await tgAnswer(cb.id, '❌ Revogada');
      await tgEdit(chatId, msgId,
        `❌ <b>CHAVE REVOGADA</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔑 <code>${k}</code>\n\n` +
        `🔴 Status: Inativa`,
        { inline_keyboard: [[{ text:'🔙 Voltar', callback_data:`c_${k}` }]] }
      );
      return;
    }

    // ─── DELETAR DIRETO ───
    if (data.startsWith('dl_')) {
      const k = data.substring(3);
      await redisDel(k);
      await tgAnswer(cb.id, '🗑️ Deletada');
      await tgEdit(chatId, msgId,
        `🗑️ <b>CHAVE DELETADA</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔑 <code>${k}</code>\n\n` +
        `❌ Removida permanentemente.`,
        { inline_keyboard: [[{ text:'🔙 Voltar ao Menu', callback_data:'m_home' }]] }
      );
      return;
    }

    await tgAnswer(cb.id);
  } catch (e) {
    log('ERRO', 'Callback: ' + e.message);
    await tgAnswer(cb.id, '❌ Erro: ' + e.message);
  }
}

// ═══════════════════════════════════════════════
// HANDLER: comandos de texto
// ═══════════════════════════════════════════════
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const texto = (msg.text || '').trim();
  const args = texto.replace(/\n/g,' ').split(' ').filter(a => a.length > 0);
  const cmd = (args[0] || '').toLowerCase();

  // ⛔ Admin check
  if (userId !== String(OWNER_ID)) {
    if (cmd === '/start' || cmd === '/contacto') {
      await tgSend(chatId,
        `👋 <b>Olá!</b>\n\n` +
        `Sou o bot oficial de licenças Mozlince.\n\n` +
        `Para falar com o administrador, toque no botão abaixo:`,
        { inline_keyboard: [[{ text:'📞 CONTACTAR ADMIN', callback_data:'m_contacto' }]] }
      );
      return;
    }
    return;
  }

  try {
    if (cmd === '/start' || cmd === '/menu') { await cmdStart(chatId); return; }

    // ─── /gerar ───
    if (cmd === '/gerar') {
      const kb = { inline_keyboard: [] };
      const entries = Object.entries(PACOTES);
      for (let i = 0; i < entries.length; i += 2) {
        const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome}`, callback_data: `g_${entries[i][0]}` }];
        if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome}`, callback_data: `g_${entries[i+1][0]}` });
        kb.inline_keyboard.push(linha);
      }
      await tgSend(chatId, `🔑 <b>GERAR LICENÇA</b>\n\n💰 Escolha o pacote:`, kb);
      return;
    }

    // ─── /listar ───
    if (cmd === '/listar') {
      const keys = await redisKeys('ASHEO-*');
      if (keys.length === 0) { await tgSend(chatId, `📭 Nenhuma licença.`); return; }
      let txt = `📋 <b>LICENÇAS (${keys.length})</b>\n\n`;
      for (let i = 0; i < Math.min(keys.length, 30); i++) {
        const l = await redisGet(keys[i]);
        if (!l) continue;
        const exp = l.ilimitada ? '∞' : humanTime((l.expiraEm||0) - Date.now());
        txt += `${l.ativa ? '🟢' : '🔴'} <code>${keys[i]}</code>\n     ${l.planoNome} • ${exp}\n`;
      }
      await tgSend(chatId, txt);
      return;
    }

    // ─── /status <chave> ───
    if (cmd === '/status') {
      const k = args[1];
      if (!k) { await tgSend(chatId, `⚠️ Use: <code>/status &lt;chave&gt;</code>`); return; }
      const l = await redisGet(k);
      if (!l) { await tgSend(chatId, `❌ Chave não encontrada.`); return; }
      const resta = l.ilimitada ? '∞ Ilimitado' : humanTime((l.expiraEm||0) - Date.now());
      await tgSend(chatId,
        `🔍 <b>STATUS DA LICENÇA</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔑 <code>${k}</code>\n\n` +
        `${PACOTES[l.plano]?.emoji || '📦'} <b>${l.planoNome}</b>\n` +
        `💰 ${l.preco}\n` +
        `📅 Criada: ${formatDate(l.criadaEm)}\n` +
        `⏰ Expira: ${l.ilimitada ? 'Nunca' : formatDate(l.expiraEm)}\n` +
        `⌛ Restante: ${resta}\n\n` +
        `🔗 ID: ${l.installId ? `<code>${l.installId}</code>` : 'Não vinculada'}\n` +
        `📌 ${l.ativa ? '🟢 Ativa' : '🔴 Inativa'}`,
        { inline_keyboard: [[{ text:'🗑️ DELETAR', callback_data:`dl_${k}` }, { text:'❌ REVOGAR', callback_data:`rv_${k}` }]] }
      );
      return;
    }

    // ─── /activate <id> <chave> ───
    if (cmd === '/activate') {
      const chave = args[args.length-1];
      const installId = args.slice(1, args.length-1).join(' ');
      if (!installId || !chave) { await tgSend(chatId, `⚠️ Use: <code>/activate &lt;id&gt; &lt;chave&gt;</code>`); return; }
      const l = await redisGet(chave);
      if (!l) { await tgSend(chatId, `❌ Chave não encontrada.`); return; }
      if (l.installId) { await tgSend(chatId, `⚠️ Já vinculada a <code>${l.installId}</code>.\nUse /desvincular primeiro.`); return; }
      l.installId = installId; l.ativadaEm = Date.now();
      await redisSet(chave, JSON.stringify(l));
      await tgSend(chatId,
        `✅ <b>VINCULADA COM SUCESSO!</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔑 <code>${chave}</code>\n` +
        `🔗 ID: <code>${installId}</code>\n` +
        `📅 ${formatDate(l.ativadaEm)}`
      );
      return;
    }

    // ─── /desvincular <chave> ───
    if (cmd === '/desvincular') {
      const k = args[1];
      if (!k) { await tgSend(chatId, `⚠️ Use: /desvincular &lt;chave&gt;`); return; }
      const l = await redisGet(k);
      if (!l) { await tgSend(chatId, `❌ Chave não encontrada.`); return; }
      l.installId = null; l.ativadaEm = null;
      await redisSet(k, JSON.stringify(l));
      await tgSend(chatId, `🔓 Desvinculada: <code>${k}</code>`);
      return;
    }

    // ─── /revogar <chave> ───
    if (cmd === '/revogar') {
      const k = args[1];
      if (!k) { await tgSend(chatId, `⚠️ Use: /revogar &lt;chave&gt;`); return; }
      const l = await redisGet(k);
      if (!l) { await tgSend(chatId, `❌ Chave não encontrada.`); return; }
      l.ativa = false;
      await redisSet(k, JSON.stringify(l));
      await tgSend(chatId, `❌ Revogada: <code>${k}</code>`);
      return;
    }

    // ─── /deletar <chave> ───
    if (cmd === '/deletar') {
      const k = args[1];
      if (!k) { await tgSend(chatId, `⚠️ Use: /deletar &lt;chave&gt;`); return; }
      await redisDel(k);
      await tgSend(chatId, `🗑️ Deletada: <code>${k}</code>`);
      return;
    }

    // ─── /deletarativas ───
    if (cmd === '/deletarativas') {
      const keys = await redisKeys('ASHEO-*');
      let n = 0;
      for (const k of keys) { const l = await redisGet(k); if (l && l.ativa) { await redisDel(k); n++; } }
      await tgSend(chatId, `🗑️ Deletadas <b>${n}</b> licenças ativas.`);
      return;
    }

    // ─── /deletartudo ───
    if (cmd === '/deletartudo') {
      const keys = await redisKeys('ASHEO-*');
      for (const k of keys) await redisDel(k);
      await tgSend(chatId, `💣 Banco limpo! <b>${keys.length}</b> licenças removidas.`);
      return;
    }

    // ─── /stats ───
    if (cmd === '/stats') {
      const keys = await redisKeys('ASHEO-*');
      let ativas=0, exp=0, vinc=0, unli=0;
      for (const k of keys) { const l = await redisGet(k); if (!l) continue;
        if (l.ativa) ativas++; if (!l.ilimitada && l.expiraEm < Date.now()) exp++;
        if (l.installId) vinc++; if (l.ilimitada) unli++;
      }
      await tgSend(chatId,
        `📊 <b>ESTATÍSTICAS</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔑 Total: <code>${keys.length}</code>\n` +
        `🟢 Ativas: <code>${ativas}</code>\n` +
        `🔴 Expiradas: <code>${exp}</code>\n` +
        `🔗 Vinculadas: <code>${vinc}</code>\n` +
        `🔥 Ilimitadas: <code>${unli}</code>`
      );
      return;
    }

    // ─── Fallback ───
    await tgSend(chatId, `❓ Comando desconhecido. Use /start para ver o menu.`);
  } catch (e) { log('ERRO', 'Message: ' + e.message); }
}

// ═══════════════════════════════════════════════
// WEBHOOK TELEGRAM
// ═══════════════════════════════════════════════
app.post('/telegram-webhook', async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  try {
    if (update.callback_query) return handleCallback(update.callback_query);
    if (update.message && update.message.text) return handleMessage(update.message);
  } catch (e) { log('ERRO', 'Webhook: ' + e.message); }
});

// ═══════════════════════════════════════════════
// ROTAS API (extensão)
// ═══════════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({ ok:true, service:'mozlince-license-api', version:'4.0-premium', chave:ORIGEM, status:PRIVATE_KEY?'live':'misconfigured' });
});

app.get('/v1/status', (req, res) => {
  res.json({ ok:true, versao:'4.0-premium', chave_carregada:!!PRIVATE_KEY, origem_chave:ORIGEM, uptime:Math.floor(process.uptime()), memoria_mb:Math.round(process.memoryUsage().rss/1024/1024), node:process.version, hora:new Date().toISOString() });
});

app.post('/v1/activate', async (req, res) => {
  const inicio = Date.now();
  const { installId, licenseKey } = req.body || {};
  if (!installId) return res.status(400).json({ error:'missing_installId' });
  if (!PRIVATE_KEY) return res.status(500).json({ error:'server_misconfigured' });

  if (licenseKey && licenseKey.startsWith('ASHEO-')) {
    const lic = await redisGet(licenseKey);
    if (!lic) return res.status(404).json({ error:'invalid_license', message:'Chave nao encontrada' });
    if (!lic.ativa) return res.status(403).json({ error:'revoked', message:'Licenca revogada' });
    if (!lic.installId) { lic.installId = installId; await redisSet(licenseKey, JSON.stringify(lic)); }
    else if (lic.installId !== installId) return res.status(403).json({ error:'already_used', message:'Chave ja vinculada' });
    const expDate = lic.criadaEm + lic.dias * 24*60*60*1000;
    if (lic.dias < 3650 && Date.now() > expDate) return res.status(403).json({ error:'expired' });
    const token = signToken(buildClaims(installId, lic.plano || 'premium', lic.dias || 30));
    log('ATIV', `${installId} | ${licenseKey.substring(0,18)}... | ${Date.now()-inicio}ms`);
    return res.json({ token, tier:'premium', kind:'premium', seat:1, seats:1, gwPass:null, plan:lic.plano||'premium', planDisplayName:'Premium', expires_in:Math.floor((expDate-Date.now())/1000), licenseKey });
  }

  const newKey = generateLicenseKey();
  const token = signToken(buildClaims(installId, 'premium', 30));
  await redisSet(newKey, JSON.stringify({ chave:newKey, plano:'premium', planoNome:'1 Mês', preco:'R$ 12,99', dias:30, criadaEm:Date.now(), expiraEm:Date.now()+30*24*60*60*1000, ilimitada:false, ativa:true, installId, ativadaEm:Date.now() }));
  log('ATIV', `${installId} | NOVA ${newKey.substring(0,18)}...`);
  return res.json({ token, tier:'premium', kind:'premium', seat:1, seats:1, gwPass:null, plan:'premium', planDisplayName:'Premium', expires_in:30*24*60*60, licenseKey:newKey });
});

app.post('/v1/deactivate', async (req, res) => {
  res.json({ ok:true, message:'Desativado' });
});

app.post('/v1/verify', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error:'missing_token' });
  try { const decoded = jwt.verify(token, PUBLIC_KEY || PRIVATE_KEY, { algorithms:['ES256'] }); return res.json({ valido:true, ok:true, dados:decoded }); }
  catch (e) { return res.status(401).json({ valido:false, ok:false, erro:e.message }); }
});

app.get('/v1/planos', (req, res) => {
  res.json({ ok:true, planos: Object.entries(PACOTES).map(([id,p]) => ({ id, nome:p.nome, dias:p.dias, preco:p.preco, emoji:p.emoji })) });
});

app.post('/v1/feature/activate', async (req, res) => {
  const { installId, feature, nonce } = req.body || {};
  if (!installId || !feature) return res.status(400).json({ ok:false, error:'missing_params' });
  try {
    const now = Math.floor(Date.now()/1000);
    const token = jwt.sign({ sub:installId, feature, nonce:nonce||crypto.randomUUID(), iat:now, nbf:now-5, exp:now+300, jti:crypto.randomUUID() }, PRIVATE_KEY, { algorithm:'ES256' });
    return res.json({ ok:true, token, feature, expires_in:300 });
  } catch (e) { return res.status(500).json({ ok:false, error:'internal' }); }
});

app.get('/v1/rules/sync', (req, res) => {
  res.json({ version:3, updatedAt:new Date().toISOString(), serverRules:[
    { id:'premium_automation', enabled:true, ttl:3600 },
    { id:'multi_account', enabled:true, ttl:3600 },
    { id:'cloud_sync', enabled:true, ttl:3600 },
    { id:'bulk_actions', enabled:true, ttl:3600 }
  ], minVersion:'1.0.0', serverTime:Date.now() });
});

app.get('/v1/exclusive/sync', (req, res) => {
  res.json({ manifest:{ version:'1.0.0', generatedAt:new Date().toISOString(),
    rules:[{ id:'exclusive_1', type:'allow', pattern:'https://premium.mozlince.com/*' }],
    gateways:[{ id:'premium-gw', url:'https://premium.mozlince.com/gw', enabled:true }],
    signature:crypto.randomBytes(32).toString('hex')
  }, cachedAt:Date.now() });
});

app.get('/v1/manifest/check', (req, res) => {
  res.json({ ok:true, latest:'1.0.0', minVersion:'1.0.0', channel:req.query.channel||'stable', remoteUrl:'https://mozlince.onrender.com/v1/exclusive/sync', force:false, serverTime:Date.now() });
});

app.get('/v1/gateways/defaults', (req, res) => {
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
  log('SYS', `Servidor Mozlince v4.0 na porta ${PORT}`);
  log('SYS', `Chave: ${ORIGEM}`);
  log('SYS', `Redis: ${UPSTASH_URL ? 'OK' : 'FALTA'}`);
  log('SYS', `Telegram: ${TELEGRAM_TOKEN ? 'OK' : 'FALTA'}`);
  log('SYS', `Admin ID configurado: ${OWNER_ID ? 'SIM (oculto)' : 'NAO'}`);
  log('SYS', `Rotas: /v1/activate /v1/deactivate /v1/verify /v1/status /v1/planos`);
  log('SYS', `Novas: /v1/feature/activate /v1/rules/sync /v1/exclusive/sync /v1/manifest/check /v1/gateways/defaults`);
  log('SYS', `Bot: /telegram-webhook`);
});

process.on('uncaughtException', e => log('ERRO', 'Uncaught: ' + e.message));
process.on('unhandledRejection', e => log('ERRO', 'Rejection: ' + e));
