const express = require('express');
const cors    = require('cors');
const app     = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ─── State (server-side) ─────────────────────────────────────────
let irStatus = [0, 0, 0, 0];
let spotState = [
  { state: 'free', bookedAt: null },
  { state: 'free', bookedAt: null },
  { state: 'free', bookedAt: null },
  { state: 'free', bookedAt: null },
];
let pendingCmds = [];

const EXPIRE_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  spotState.forEach((sp, i) => {
    if (sp.state === 'booked' && sp.bookedAt && (now - sp.bookedAt) >= EXPIRE_MS) {
      console.log(`Spot ${i} reservation expired`);
      sp.state = 'free';
      sp.bookedAt = null;
      pendingCmds.push({ spot: i, action: 'open' });
    }
  });
}, 15000);

// ─── ESP32 sync ──────────────────────────────────────────────────
app.post('/esp/sync', (req, res) => {
  const { spots } = req.body;
  if (Array.isArray(spots)) {
    spots.forEach((occupied, i) => {
      irStatus[i] = occupied;
      if (!occupied && spotState[i].state === 'parked') {
        spotState[i].state = 'free';
        spotState[i].bookedAt = null;
      }
      if (occupied && spotState[i].state === 'booked') {
        spotState[i].state = 'parked';
      }
      if (occupied && spotState[i].state === 'free') {
        spotState[i].state = 'parked';
      }
    });
  }
  const cmds = [...pendingCmds];
  pendingCmds = [];
  res.json({ commands: cmds });
});

// ─── Browser: get full status ─────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    spots: irStatus,
    states: spotState.map(sp => ({ state: sp.state, bookedAt: sp.bookedAt }))
  });
});

// ─── Browser: reserve ────────────────────────────────────────────
app.post('/api/reserve', (req, res) => {
  const { spot } = req.body;
  if (spot === undefined || spot < 0 || spot > 3)
    return res.status(400).json({ error: 'Bad spot' });
  if (spotState[spot].state !== 'free')
    return res.status(409).json({ error: 'Spot not free' });
  spotState[spot].state = 'booked';
  spotState[spot].bookedAt = Date.now();
  pendingCmds.push({ spot, action: 'close' });
  res.json({ ok: true, bookedAt: spotState[spot].bookedAt });
});

// ─── Browser: arrive ─────────────────────────────────────────────
app.post('/api/arrive', (req, res) => {
  const { spot } = req.body;
  if (spot === undefined || spot < 0 || spot > 3)
    return res.status(400).json({ error: 'Bad spot' });
  spotState[spot].state = 'parked';
  pendingCmds.push({ spot, action: 'open' });
  res.json({ ok: true });
});

// ─── Browser: cancel / leave ─────────────────────────────────────
app.post('/api/release', (req, res) => {
  const { spot } = req.body;
  if (spot === undefined || spot < 0 || spot > 3)
    return res.status(400).json({ error: 'Bad spot' });
  spotState[spot].state = 'free';
  spotState[spot].bookedAt = null;
  pendingCmds.push({ spot, action: 'open' });
  res.json({ ok: true });
});

app.get('/api/gate', (req, res) => {
  const spot   = parseInt(req.query.spot);
  const action = req.query.action;
  if (isNaN(spot) || spot < 0 || spot > 3) return res.status(400).send('Bad spot');
  pendingCmds.push({ spot, action });
  res.send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SmartPark server running on port ${PORT}`));
