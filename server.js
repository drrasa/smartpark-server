const express = require('express');
const cors    = require('cors');
const app     = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ─── State ───────────────────────────────────────────────────────
let irStatus = [0, 0, 0, 0];
let spotState = [
  { state: 'free', bookedAt: null, manualParked: false },
  { state: 'free', bookedAt: null, manualParked: false },
  { state: 'free', bookedAt: null, manualParked: false },
  { state: 'free', bookedAt: null, manualParked: false },
];
let pendingCmds = [];

const EXPIRE_MS = 30 * 60 * 1000;

// Auto-expire reservations
setInterval(() => {
  const now = Date.now();
  spotState.forEach((sp, i) => {
    if (sp.state === 'booked' && sp.bookedAt && (now - sp.bookedAt) >= EXPIRE_MS) {
      console.log(`Spot ${i} reservation expired`);
      sp.state = 'free';
      sp.bookedAt = null;
      sp.manualParked = false;
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
      const sp = spotState[i];

      if (sp.manualParked) {
        // User clicked "I am here" — ignore IR until they click "Leave"
        // Only free it if IR confirms car is gone AND user clicks leave
        return;
      }

      if (occupied && sp.state === 'booked') {
        // Car arrived at booked spot
        sp.state = 'parked';
      }
      if (!occupied && sp.state === 'parked') {
        // Car physically left
        sp.state = 'free';
        sp.bookedAt = null;
      }
      if (occupied && sp.state === 'free') {
        // Unknown car pulled in
        sp.state = 'parked';
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
  spotState[spot].manualParked = false;
  pendingCmds.push({ spot, action: 'close' });
  res.json({ ok: true, bookedAt: spotState[spot].bookedAt });
});

// ─── Browser: arrive ─────────────────────────────────────────────
// Sets manualParked = true so IR cannot override the parked state
app.post('/api/arrive', (req, res) => {
  const { spot } = req.body;
  if (spot === undefined || spot < 0 || spot > 3)
    return res.status(400).json({ error: 'Bad spot' });
  spotState[spot].state = 'parked';
  spotState[spot].manualParked = true;  // ← key fix
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
  spotState[spot].manualParked = false;  // ← allow IR again
  pendingCmds.push({ spot, action: 'open' });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SmartPark server running on port ${PORT}`));
