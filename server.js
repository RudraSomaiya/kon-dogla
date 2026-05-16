require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const ADMIN_NAME = process.env.ADMIN_NAME || 'admin';
const CONFIG_PATH = path.join(__dirname, 'config.json');

// ── In-Memory State ───────────────────────────────────────────────────────────
const rooms = {}; // { [roomCode]: Room }

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function makeRoom(hostId, hostName, hostColor) {
  let code;
  do { code = generateCode(); } while (rooms[code]);
  const isAdmin = hostName === ADMIN_NAME;
  rooms[code] = {
    code,
    hostId,
    state: 'LOBBY',
    players: [{
      id: hostId, name: hostName, color: hostColor,
      isHost: true, isAdmin, isAlive: true, isImposter: false,
      hasSeenCard: false, vote: null
    }],
    currentWord: null, currentHint: null,
    round: 0, eliminatedPlayers: [], firstSpeaker: null,
    discussionTimer: null, votingTimer: null
  };
  return rooms[code];
}

function getRoom(code) { return rooms[code] || null; }
function getPlayer(room, id) { return room.players.find(p => p.id === id) || null; }
function alivePlayers(room) { return room.players.filter(p => p.isAlive); }

// ── Terminal Logging ──────────────────────────────────────────────────────────
function logRound(room, word, hint, firstSpeaker) {
  const bar = '═'.repeat(38);
  const pad = (s, w) => s.padEnd(w);
  console.log(`\n╔${bar}╗`);
  console.log(`║  KON DOGLA? — ROUND ${String(room.round).padEnd(15)} ║`);
  console.log(`╠${bar}╣`);
  console.log(`║  WORD:     ${pad(word, 26)}║`);
  console.log(`║  HINT:     ${pad(hint, 26)}║`);
  console.log(`╠${bar}╣`);
  console.log(`║  PLAYERS & ROLES:                    ║`);
  room.players.forEach(p => {
    const role = p.isImposter ? 'IMPOSTER 👺' : 'INNOCENT   ';
    const line = `  ${p.name.padEnd(9)}[${p.color}]  → ${role}`;
    console.log(`║${line.padEnd(38)}║`);
  });
  console.log(`╠${bar}╣`);
  console.log(`║  FIRST SPEAKER: ${pad(firstSpeaker.name, 21)}║`);
  console.log(`╚${bar}╝\n`);
}

// ── REST API ──────────────────────────────────────────────────────────────────
app.post('/api/room/create', (req, res) => {
  const { playerName, color } = req.body;
  if (!playerName || !color) return res.status(400).json({ error: 'playerName and color required' });
  const room = makeRoom('pending', playerName, color);
  const player = room.players[0];
  res.json({ roomCode: room.code, isHost: true, isAdmin: player.isAdmin });
});

app.post('/api/room/join', (req, res) => {
  const { roomCode, playerName, color } = req.body;
  if (!roomCode || !playerName || !color) return res.status(400).json({ error: 'Missing fields' });
  const room = getRoom(roomCode);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.state !== 'LOBBY') return res.status(400).json({ error: 'Game already started' });
  const isAdmin = playerName === ADMIN_NAME;
  res.json({ roomCode, isHost: false, isAdmin });
});

app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

app.post('/api/config', (req, res) => {
  saveConfig(req.body);
  res.json({ success: true });
});

// SPA fallback
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('join-room', ({ roomCode, playerName, color }) => {
    const room = getRoom(roomCode);
    if (!room) { socket.emit('error', { message: 'Room not found' }); return; }
    if (room.state !== 'LOBBY' && room.state !== 'GAME_OVER') { socket.emit('error', { message: 'Game already started' }); return; }

    const isAdmin = playerName === ADMIN_NAME;
    const isHost = room.players.length === 0;

    // If host placeholder exists (from REST), replace it; otherwise add
    const existing = room.players.find(p => p.name === playerName && !p.socketSet);
    let player;
    if (existing) {
      existing.id = socket.id;
      existing.socketSet = true;
      player = existing;
    } else {
      player = {
        id: socket.id, name: playerName, color,
        isHost, isAdmin, isAlive: true, isImposter: false,
        hasSeenCard: false, vote: null
      };
      room.players.push(player);
    }

    // If this is the original host placeholder (REST-created), update ID
    if (room.hostId === 'pending' && player.isHost) room.hostId = socket.id;

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerId = socket.id;

    io.to(roomCode).emit('room-update', {
      players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, isHost: p.isHost, isAlive: p.isAlive })),
      state: room.state,
      roomCode
    });

    console.log(`${playerName} joined room ${roomCode}`);
  });

  socket.on('start-game', ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) { socket.emit('error', { message: 'Room not found' }); return; }
    if (room.hostId !== socket.id) { socket.emit('error', { message: 'Only host can start' }); return; }

    const cfg = loadConfig();
    const alive = alivePlayers(room);
    if (alive.length < cfg.minPlayers) {
      socket.emit('error', { message: `Need at least ${cfg.minPlayers} players` }); return;
    }

    room.state = 'WORD_REVEAL';
    room.round++;

    // Reset per-round state
    alive.forEach(p => { p.hasSeenCard = false; p.vote = null; p.isImposter = false; });

    // Pick word
    const wordEntry = cfg.words[Math.floor(Math.random() * cfg.words.length)];
    room.currentWord = wordEntry.word;
    room.currentHint = wordEntry.hint;

    // Assign imposters
    const shuffled = [...alive].sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(cfg.numImposters, alive.length - 1); i++) {
      shuffled[i].isImposter = true;
    }

    // Pick first speaker
    room.firstSpeaker = alive[Math.floor(Math.random() * alive.length)];

    logRound(room, room.currentWord, room.currentHint, room.firstSpeaker);

    // Send individual game-started events
    room.players.forEach(p => {
      const playerSocket = io.sockets.sockets.get(p.id);
      if (!playerSocket) return;
      if (p.isImposter) {
        playerSocket.emit('game-started', {
          yourRole: 'imposter',
          hint: room.currentHint,
          firstSpeaker: { name: room.firstSpeaker.name, color: room.firstSpeaker.color }
        });
      } else {
        playerSocket.emit('game-started', {
          yourRole: 'player',
          word: room.currentWord,
          firstSpeaker: { name: room.firstSpeaker.name, color: room.firstSpeaker.color }
        });
      }
    });
  });

  socket.on('player-ready', ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    const player = getPlayer(room, socket.id);
    if (!player) return;
    player.hasSeenCard = true;

    const alive = alivePlayers(room);
    const readyCount = alive.filter(p => p.hasSeenCard).length;
    const totalCount = alive.length;

    io.to(roomCode).emit('player-ready-update', { readyCount, totalCount });

    if (readyCount === totalCount) {
      room.state = 'DISCUSSION';
      io.to(roomCode).emit('all-players-ready', {
        firstSpeaker: { name: room.firstSpeaker.name, color: room.firstSpeaker.color }
      });
      startDiscussionTimer(room);
    }
  });

  socket.on('go-to-vote', ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room || room.state !== 'DISCUSSION') return;
    // Move this specific socket to voting
    socket.emit('voting-started', {
      players: alivePlayers(room).map(p => ({ id: p.id, name: p.name, color: p.color }))
    });
  });

  socket.on('submit-vote', ({ roomCode, targetId }) => {
    const room = getRoom(roomCode);
    if (!room || room.state !== 'VOTING') return;
    const player = getPlayer(room, socket.id);
    if (!player || !player.isAlive) return;
    if (player.id === targetId) return; // can't vote self
    player.vote = targetId;

    const alive = alivePlayers(room);
    const votedCount = alive.filter(p => p.vote !== null).length;
    io.to(roomCode).emit('vote-update', { votedCount, totalCount: alive.length });

    if (votedCount === alive.length) {
      resolveVotes(room);
    }
  });

  socket.on('update-config', ({ roomCode, config }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    const player = getPlayer(room, socket.id);
    if (!player || !player.isAdmin) { socket.emit('error', { message: 'Not authorized' }); return; }
    saveConfig(config);
    io.to(roomCode).emit('config-updated', { config });
  });

  socket.on('next-round', ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    // Reset for next round
    room.state = 'LOBBY';
    room.players.forEach(p => { p.vote = null; p.hasSeenCard = false; });
    io.to(roomCode).emit('room-update', {
      players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, isHost: p.isHost, isAlive: p.isAlive })),
      state: room.state,
      roomCode
    });
  });

  socket.on('play-again', ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    // Full reset
    room.state = 'LOBBY';
    room.round = 0;
    room.eliminatedPlayers = [];
    room.players.forEach(p => { p.isAlive = true; p.isImposter = false; p.vote = null; p.hasSeenCard = false; });
    io.to(roomCode).emit('room-update', {
      players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, isHost: p.isHost, isAlive: p.isAlive })),
      state: room.state,
      roomCode
    });
  });

  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = getRoom(roomCode);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) { delete rooms[roomCode]; return; }
    // Transfer host if needed
    if (room.hostId === socket.id && room.players.length > 0) {
      room.players[0].isHost = true;
      room.hostId = room.players[0].id;
    }
    io.to(roomCode).emit('room-update', {
      players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, isHost: p.isHost, isAlive: p.isAlive })),
      state: room.state,
      roomCode
    });
    console.log(`Socket ${socket.id} left room ${roomCode}`);
  });
});

// ── Game Logic Helpers ────────────────────────────────────────────────────────
function startDiscussionTimer(room) {
  const cfg = loadConfig();
  let secs = cfg.discussionTimerSeconds;
  clearInterval(room.discussionTimer);
  room.discussionTimer = setInterval(() => {
    secs--;
    io.to(room.code).emit('discussion-tick', { secondsRemaining: secs });
    if (secs <= 0) {
      clearInterval(room.discussionTimer);
      startVoting(room);
    }
  }, 1000);
}

function startVoting(room) {
  room.state = 'VOTING';
  const alive = alivePlayers(room);
  alive.forEach(p => { p.vote = null; });
  io.to(room.code).emit('voting-started', {
    players: alive.map(p => ({ id: p.id, name: p.name, color: p.color }))
  });

  const cfg = loadConfig();
  let secs = cfg.votingTimerSeconds;
  clearInterval(room.votingTimer);
  room.votingTimer = setInterval(() => {
    secs--;
    io.to(room.code).emit('voting-tick', { secondsRemaining: secs });
    if (secs <= 0) {
      clearInterval(room.votingTimer);
      resolveVotes(room);
    }
  }, 1000);
}

function resolveVotes(room) {
  clearInterval(room.votingTimer);
  room.state = 'ELIMINATION';
  const alive = alivePlayers(room);

  // Tally votes
  const tally = {};
  alive.forEach(p => { if (p.vote) tally[p.vote] = (tally[p.vote] || 0) + 1; });

  let maxVotes = 0;
  Object.values(tally).forEach(v => { if (v > maxVotes) maxVotes = v; });
  const tied = Object.keys(tally).filter(id => tally[id] === maxVotes);
  const eliminatedId = tied[Math.floor(Math.random() * tied.length)];
  const eliminated = room.players.find(p => p.id === eliminatedId);

  if (!eliminated) {
    // No votes at all - random elimination
    const randPlayer = alive[Math.floor(Math.random() * alive.length)];
    randPlayer.isAlive = false;
    room.eliminatedPlayers.push(randPlayer);
    broadcastElimination(room, randPlayer);
    return;
  }

  eliminated.isAlive = false;
  room.eliminatedPlayers.push(eliminated);

  const cfg = loadConfig();
  const wasImposter = eliminated.isImposter ? true : false;
  const revealResult = cfg.revealResultOnElimination ? wasImposter : null;

  // Check game over
  const stillAlive = alivePlayers(room);
  const aliveImposters = stillAlive.filter(p => p.isImposter);
  const aliveInnocents = stillAlive.filter(p => !p.isImposter);

  const allImpostersGone = aliveImposters.length === 0;
  const impostersWin = aliveImposters.length >= aliveInnocents.length;

  io.to(room.code).emit('elimination-result', {
    eliminatedPlayer: { id: eliminated.id, name: eliminated.name, color: eliminated.color },
    wasImposter: revealResult,
    continueGame: !allImpostersGone && !impostersWin
  });

  if (allImpostersGone || impostersWin) {
    setTimeout(() => triggerGameOver(room, allImpostersGone), 2000);
  }
}

function broadcastElimination(room, eliminated) {
  const cfg = loadConfig();
  const stillAlive = alivePlayers(room);
  const aliveImposters = stillAlive.filter(p => p.isImposter);
  const aliveInnocents = stillAlive.filter(p => !p.isImposter);
  const allImpostersGone = aliveImposters.length === 0;
  const impostersWin = aliveImposters.length >= aliveInnocents.length;

  io.to(room.code).emit('elimination-result', {
    eliminatedPlayer: { id: eliminated.id, name: eliminated.name, color: eliminated.color },
    wasImposter: cfg.revealResultOnElimination ? eliminated.isImposter : null,
    continueGame: !allImpostersGone && !impostersWin
  });

  if (allImpostersGone || impostersWin) {
    setTimeout(() => triggerGameOver(room, allImpostersGone), 2000);
  }
}

function triggerGameOver(room, innocentsWin) {
  room.state = 'GAME_OVER';
  const imposters = room.players.filter(p => p.isImposter);
  let liarText = '';
  if (innocentsWin) {
    const names = imposters.map(p => p.name).join(' & ');
    liarText = `Liar! Liar! ${names}'s pants on fire! ${'🔥'.repeat(imposters.length)}`;
  } else {
    liarText = 'Kon Dogla... sabka 😈';
  }

  const aliveAtEnd = alivePlayers(room);
  io.to(room.code).emit('game-over', {
    reason: innocentsWin ? 'innocents_win' : 'imposters_win',
    imposters: imposters.map(p => ({ id: p.id, name: p.name, color: p.color })),
    winners: innocentsWin
      ? aliveAtEnd.filter(p => !p.isImposter).map(p => ({ id: p.id, name: p.name, color: p.color }))
      : imposters.map(p => ({ id: p.id, name: p.name, color: p.color })),
    liarText,
    word: room.currentWord
  });
}

server.listen(PORT, () => {
  console.log(`\n🎮 Kon Dogla? server running on http://localhost:${PORT}`);
  console.log(`📡 Admin name: [hidden — see .env]\n`);
});
