const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function testar() {
  console.log('Buscando todas as chaves ASHEO-*...\n');
  const res = await fetch(`${UPSTASH_URL}/keys/ASHEO-*`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  const data = await res.json();
  console.log('Chaves encontradas:', data.result);
  
  if (data.result && data.result.length > 0) {
    const k = data.result[0];
    console.log('\nBuscando valor da chave:', k);
    const res2 = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(k)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    const data2 = await res2.json();
    console.log('Valor:', data2.result);
  }
}
testar();
