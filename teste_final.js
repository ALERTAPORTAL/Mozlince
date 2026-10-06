const URL   = 'https://civil-duckling-181798.upstash.io';
const TOKEN = 'gQAAAAAAAsYmAAIgcDJjMGYyNzUxZTNkNzU0NjY4YmY1ZTc5NjM1M2ZlMjM4MWE0MjM3NzE';

(async () => {
  console.log('\n═══════════════════════════════════════');
  console.log('  TESTE REDIS UPSTASH — civil-duckling');
  console.log('═══════════════════════════════════════\n');

  try {
    console.log('📡 Teste 1: Ping...');
    const rPing = await fetch(`${URL}/ping`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const dPing = await rPing.json();
    console.log('   →', JSON.stringify(dPing));

    console.log('\n📋 Teste 2: Buscar chaves ASHEO-*...');
    const rKeys = await fetch(`${URL}/keys/ASHEO-*`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const dKeys = await rKeys.json();
    const chaves = dKeys.result || [];
    console.log('   → Encontradas:', chaves.length);
    
    if (chaves.length === 0) {
      console.log('\n❌ NENHUMA chave ASHEO-* neste Redis!');
      console.log('   → As chaves geradas NUNCA chegaram aqui.');
      console.log('   → O bot que gera está usando OUTRO Redis (ou nenhum).');
    } else {
      console.log('\n✅ Chaves encontradas:');
      for (const k of chaves) {
        const rV = await fetch(`${URL}/get/${encodeURIComponent(k)}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
        const dV = await rV.json();
        console.log('   •', k);
        console.log('     ', dV.result);
      }
    }

    console.log('\n🔍 Teste 3: TODAS as chaves no Redis...');
    const rAll = await fetch(`${URL}/keys/*`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const dAll = await rAll.json();
    const todas = dAll.result || [];
    console.log('   → Total:', todas.length);
    if (todas.length > 0) {
      console.log('   → Lista completa:');
      todas.forEach(k => console.log('      -', k));
    }

  } catch (e) {
    console.log('\n❌ ERRO:', e.message);
  }

  console.log('\n═══════════════════════════════════════\n');
})();
