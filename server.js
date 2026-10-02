require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const privateKey = fs.readFileSync('private.key');

app.get('/', (req, res) => {
  res.json({ status: 'Servidor de licencas rodando!' });
});

app.post('/gerar-licenca', (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ erro: 'userId e obrigatorio' });
  }
  const payload = { userId, tipo: 'licenca-premium' };
  const token = jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: process.env.JWT_EXPIRATION || '30d',
  });
  res.json({ token });
});

app.post('/verificar-licenca', (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ erro: 'Token e obrigatorio' });
  }
  const publicKey = fs.readFileSync('public.key');
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
