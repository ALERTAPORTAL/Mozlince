const URL = 'https://mozlince.onrender.com';
(async () => {
  console.log('\n🔍 Testando servidor Render...\n');
  
  const r1 = await fetch(`${URL}/v1/health`);
  console.log('1) Health:', await r1.json());
  
  const r2 = await fetch(`${URL}/api/v1/planos`);
  const planos = await r2.json();
  console.log('2) Planos:', planos.planos?.length || 0, 'disponíveis');
  
  console.log('\n✅ Se respondeu os 2, o Render está OK.');
  console.log('👉 Agora gera uma chave no TELEGRAM e ativa.\n');
})();
