const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization,x-asheo-install,x-asheo-ts,x-asheo-sig,x-asheo-build,x-asheo-nonce');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const C = { r:'\x1b[0m', b:'\x1b[1m', g:'\x1b[32m', y:'\x1b[33m', red:'\x1b[31m', c:'\x1b[36m', m:'\x1b[35m', bl:'\x1b[34m', gr:'\x1b[90m' };
function log(t, m) {
  const ts = new Date().toISOString().replace('T',' ').substring(0,19);
  const cores = { INFO:C.c, OK:C.g, WARN:C.y, ERRO:C.red, SYS:C.m, ATIV:C.bl };
  console.log(`${C.gr}[${ts}]${C.r} ${cores[t]||C.r}${C.b}[${t}]${C.r} ${m}`);
}

const PLANOS = {
  '3d':   { nome:'3 Dias',    dias:3,   preco:2.99,   tag:'STARTER' },
  '7d':   { nome:'7 Dias',    dias:7,   preco:4.99,   tag:'BASICO' },
  '15d':  { nome:'15 Dias',   dias:15,  preco:7.99,   tag:'PADRAO' },
  '30d':  { nome:'1 Mes',     dias:30,  preco:12.99,  tag:'PRO' },
  '90d':  { nome:'3 Meses',   dias:90,  preco:29.99,  tag:'PREMIUM' },
  '1a':   { nome:'1 Ano',     dias:365, preco:79.99,  tag:'ELITE' },
  'unli': { nome:'Ilimitado', dias:null,preco:149.99, tag:'MASTER' }
};

let PRIVATE_KEY = null;
(function initKey() {
  let pem = process.env.JWT_PRIVATE_KEY_PEM || '';
  if (!pem) { log('ERRO','JWT_PRIVATE_KEY_PEM nao configurada'); return; }
  try {
    if (!pem.includes('BEGIN')) { log('SYS','Decodificando Base64...'); pem = Buffer.from(pem,'base64').toString('utf8'); }
    pem = pem.replace(/\\n/g,'\n').trim();
    PRIVATE_KEY = crypto.createPrivateKey(pem);
    log('OK','Chave privada ES256 carregada');
  } catch (e) { log('ERRO','Chave invalida: ' + e.message); }
})();

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function signEntitlement(claims) {
  if (!PRIVATE_KEY) throw new Error('Chave privada nao inicializada');
  const h = b64url(JSON.stringify({ alg:'ES256', typ:'JWT' }));
  const p = b64url(JSON.stringify(claims));
  const data = h + '.' + p;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: PRIVATE_KEY, dsaEncoding: 'ieee-p1363' });
  return data + '.' + b64url(sig);
}

app.get('/', (req, res) => {
  res.json({ ok:true, service:'mozlince-license-api', version:'2.0-premium', status: PRIVATE_KEY?'live':'misconfigured', planos: Object.keys(PLANOS).length, uptime: Math.floor(process.uptime())+'s' });
});

app.get('/v1/planos', (req, res) => {
  const lista = Object.entries(PLANOS).map(([id,p]) => ({ id, nome:p.nome, dias:p.dias, preco:p.preco, tag:p.tag, ilimitado:p.dias===null }));
  res.json({ ok:true, planos: lista });
});

app.post('/v1/activate', (req, res) => {
  const inicio = Date.now();
  const { installId, licenseKey } = req.body || {};
  if (!installId) { log('WARN','Ativacao sem installId'); return res.status(400).json({ error:'missing_installId', message:'installId obrigatorio.' }); }
  if (!licenseKey || !licenseKey.startsWith('ASHEO-')) { log('WARN','Chave invalida: '+licenseKey); return res.status(401).json({ error:'invalid_license', message:'Use formato ASHEO-XXXX-XXXX-XXXX-XXXX' }); }
  if (!PRIVATE_KEY) { log('ERRO','Servidor sem chave privada'); return res.status(500).json({ error:'server_misconfigured', message:'JWT_PRIVATE_KEY_PEM nao configurada' }); }
  try {
    const now = Math.floor(Date.now()/1000);
    const expTs = now + 3600;
    const token = signEntitlement({
      sub: installId, iss:'mozlince-license-api', aud:'mozlince-client',
      tier:'premium', kind:'premium', plan:'pro', planDisplayName:'Pro',
      iat: now, nbf: now-5, exp: expTs,
      jti: crypto.randomUUID(), secret: crypto.randomBytes(32).toString('hex')
    });
    log('ATIV', `${installId} | ${licenseKey.substring(0,18)}... | ${Date.now()-inicio}ms`);
    res.json({ ok:true, token, tier:'premium', seat:1, seats:1, gwPass:null, expires_in:3600, expires_at: new Date(expTs*1000).toISOString(), issued_at: new Date(now*1000).toISOString(), installId });
  } catch (e) {
    log('ERRO','activate: '+e.message);
    res.status(500).json({ error:'internal', message:e.message });
  }
});

app.post('/v1/deactivate', (req, res) => {
  const { installId } = req.body || {};
  log('WARN','Desativacao: ' + (installId||'sem id'));
  res.json({ ok:true, message:'Desativado.' });
});

app.post('/v1/verify', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error:'missing_token' });
  try {
    const [,p] = token.split('.');
    const payload = JSON.parse(Buffer.from(p.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString());
    const agora = Math.floor(Date.now()/1000);
    res.json({ ok: payload.exp>agora && payload.nbf<=agora, expira_em: payload.exp-agora+'s', sub: payload.sub, tier: payload.tier });
  } catch (e) { res.status(400).json({ ok:false, error:'invalid_token', message:e.message }); }
});

app.get('/v1/status', (req, res) => {
  res.json({ ok:true, versao:'2.0-premium', chave_carregada: !!PRIVATE_KEY, uptime: Math.floor(process.uptime()), memoria_mb: Math.round(process.memoryUsage().rss/1024/1024), node: process.version, hora: new Date().toISOString() });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  log('SYS', 'Servidor Mozlince na porta ' + PORT);
  log('SYS', 'Planos: ' + Object.keys(PLANOS).length);
  if (!PRIVATE_KEY) log('WARN', 'Configure JWT_PRIVATE_KEY_PEM no Render!');
});

process.on('uncaughtException', e => log('ERRO','Uncaught: '+e.message));
process.on('unhandledRejection', e => log('ERRO','Rejection: '+e));
