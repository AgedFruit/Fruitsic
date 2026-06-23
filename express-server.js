const express = require('express');

function startExpressServer({ port, getStatus, getSettings, updateSettings }) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.get('/status', (_req, res) => {
    res.json(getStatus());
  });

  app.get('/settings', (_req, res) => {
    res.json(getSettings());
  });

  app.post('/settings', (req, res) => {
    const next = updateSettings(req.body || {});
    res.json(next);
  });

  const server = app.listen(port, () => {
    console.log(`[Express] listening at http://localhost:${port}`);
  });

  return server;
}

module.exports = { startExpressServer };