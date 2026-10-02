require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const privateKey = process.env.PRIVATE_KEY.replace(/\\n/g, '\n');
const publicKey = process.env.PUBLIC_KEY.replace(/\\n/g, '\n');

app.get('/', (req, res) => {
  res.json({ status: 'Servidor de licencas rodando!' });
});

app.post('/gerar-licenca', (req, res) => {
  const { userId, installId } = req.body;

  if (!userId && !installId) {
    return res.status(400).json({ erro: 'userId ou installId e obrigatorio' });
  }

  const payload = {
    installId: installId || userId,
    status: 'active',
    plan: 'premium',
    active: true,
    tier: 'premium',
    features: {
      advanced_automation: true,
      multi_account: true,
      cloud_sync: true,
      priority_support: true,
      custom_export: true,
      api_access: true
    },
    deviceSecret: 'segredo-do-dispositivo-' + (installId || userId),
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 30)
  };

  const token = jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: '30d'
  });

  res.json({
    token,
    deviceSecret: payload.deviceSecret,
    status: 'active',
    plan: 'premium',
    features: payload.features
  });
});

app.post('/verificar-licenca', (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ erro: 'Token e obrigatorio' });
  }

  try {
    const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
    res.json({ valido: true, dados: decoded });
  } catch (err) {
    res.status(401).json({ valido: false, erro: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
