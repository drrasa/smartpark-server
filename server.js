const express = require('express');
const cors    = require('cors');
const app     = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ─── State (in-memory) ───────────────────────────────────────────────────────
// irStatus: what the ESP32 last reported   [0,0,0,0]  0=free 1=occupied
// pendingCmds: queue of gate commands waiting for ESP32 to pick up
let irStatus   = [0, 0, 0, 0];
let pendingCmds = [];   // [{spot, action}]

// ─── ESP32 polls this every 2 s ──────────────────────────────────────────────
// ESP32 sends its current IR readings, server replies with pending commands
app.post('/esp/sync', (req, res) => {
  const { spots } = req.body;          // [0,1,0,0]
  if (Array.isArray(spots)) irStatus = spots;

  // send all pending commands then clear queue
  const cmds = [...pendingCmds];
  pendingCmds = [];
  res.json({ commands: cmds });        // [{spot:0,action:'close'}, ...]
});

// ─── Browser polls this every 3 s ────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({ spots: irStatus });
});

// ─── Browser sends a gate command ────────────────────────────────────────────
app.get('/api/gate', (req, res) => {
  const spot   = parseInt(req.query.spot);
  const action = req.query.action;
  if (isNaN(spot) || spot < 0 || spot > 3) return res.status(400).send('Bad spot');
  if (action !== 'open' && action !== 'close') return res.status(400).send('Bad action');

  pendingCmds.push({ spot, action });
  res.send('OK');
});

// ─── Serve the website ───────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SmartPark server running on port ${PORT}`));
