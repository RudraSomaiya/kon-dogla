# Kon Dogla? — Full Stack Game Specification

---

## Overview

**Game Name:** Kon Dogla? ("Who's the Liar?")  
**Type:** Real-time multiplayer word imposter game  
**Architecture:** Node.js + Express + Socket.io server (hosted locally, exposed via Cloudflare Tunnel)  
**Frontend:** Stitch-generated React/HTML app  
**Config:** `config.json` (game settings) + `.env` (secrets like admin name)

---

## File Structure

```
kon-dogla/
├── server.js              # Main server entry point
├── .env                   # Secret config (ADMIN_NAME, PORT)
├── config.json            # Game configuration (editable in-app by admin)
├── package.json
└── public/                # Frontend build output (from Stitch)
    └── index.html (+ assets)
```

---

## Environment Variables (`.env`)

```env
PORT=3000
ADMIN_NAME=malik-khud          # Entering this name in room join grants admin/config access
```

> The `ADMIN_NAME` can only be changed by editing `.env` directly. It is never exposed to the client.

---

## Config File (`config.json`)

```json
{
  "numImposters": 1,
  "revealResultOnElimination": true,
  "discussionTimerSeconds": 120,
  "votingTimerSeconds": 60,
  "minPlayers": 3,
  "words": [
    { "word": "Pizza", "hint": "It's Italian and round" },
    { "word": "Cricket", "hint": "Played with a bat and ball" },
    { "word": "Mango", "hint": "King of fruits" },
    { "word": "Monsoon", "hint": "Wet season" },
    { "word": "Chai", "hint": "Hot beverage" }
  ]
}
```

- All fields are editable via the in-game admin config panel (if `ADMIN_NAME` is used).
- Changes made in-app write back to `config.json` on the server.

---

## Game Flow / State Machine

```
LOBBY → WORD_REVEAL → DISCUSSION → VOTING → ELIMINATION → (loop or GAME_OVER)
```

### States:
| State | Description |
|---|---|
| `LOBBY` | Players join, host waits, config can be edited |
| `WORD_REVEAL` | Each player sees their envelope with word or hint |
| `DISCUSSION` | Timer runs, players speak IRL/Discord |
| `VOTING` | Players submit votes for who they think is the imposter |
| `ELIMINATION` | Eliminated player revealed; imposter or not shown |
| `GAME_OVER` | All imposters found, or only imposters remain |

---

## Data Models

### Player
```json
{
  "id": "socket_id",
  "name": "Aryan",
  "color": "#FF6B6B",
  "isHost": true,
  "isAdmin": false,
  "isAlive": true,
  "isImposter": false,
  "hasSeenCard": false,
  "vote": null
}
```

### Room
```json
{
  "code": "KDOG",
  "hostId": "socket_id",
  "state": "LOBBY",
  "players": [...],
  "currentWord": "Pizza",
  "currentHint": "It's Italian and round",
  "round": 1,
  "eliminatedPlayers": [],
  "firstSpeaker": null
}
```

---

## REST API Endpoints

### `POST /api/room/create`
Creates a new room.

**Request Body:**
```json
{
  "playerName": "Aryan",
  "color": "#FF6B6B"
}
```

**Response:**
```json
{
  "roomCode": "KDOG",
  "playerId": "socket_id",
  "isHost": true,
  "isAdmin": false
}
```

---

### `POST /api/room/join`
Joins an existing room.

**Request Body:**
```json
{
  "roomCode": "KDOG",
  "playerName": "Priya",
  "color": "#6BFFB8"
}
```

**Response:**
```json
{
  "roomCode": "KDOG",
  "playerId": "socket_id",
  "isHost": false,
  "isAdmin": true
}
```
> `isAdmin: true` is returned silently when `playerName` matches `ADMIN_NAME` from `.env`. The client should then show the config panel access button in the lobby.

---

### `GET /api/config`
Returns current config (admin only — validated server-side by socket session).

### `POST /api/config`
Updates config.json. Admin only.

**Request Body:** Full config JSON object.

---

## Socket.io Events

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `join-room` | `{ roomCode, playerName, color }` | Player joins room socket channel |
| `start-game` | `{ roomCode }` | Host starts game (host only) |
| `player-ready` | `{ roomCode }` | Player has seen their word/role card |
| `submit-vote` | `{ roomCode, targetId }` | Player submits vote |
| `update-config` | `{ roomCode, config }` | Admin updates config (admin only) |

---

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `room-update` | `{ players, state, roomCode }` | Sent on any player join/leave |
| `game-started` | `{ yourRole, word?, hint?, firstSpeaker }` | Individual payload per socket. `word` for normal players, `hint` for imposters |
| `player-ready-update` | `{ readyCount, totalCount }` | Broadcast when a player marks ready |
| `all-players-ready` | `{ firstSpeaker: { name, color } }` | All players have seen cards — discussion begins |
| `discussion-tick` | `{ secondsRemaining }` | Timer countdown (every second) |
| `voting-started` | `{ players: [...alive players] }` | Voting phase begins |
| `voting-tick` | `{ secondsRemaining }` | Voting timer |
| `elimination-result` | `{ eliminatedPlayer, wasImposter, continueGame }` | Result after votes tallied |
| `game-over` | `{ reason, imposters, winners, liarText }` | Game ends. `liarText` is the pre-built "Liar! Liar!..." string |
| `config-updated` | `{ config }` | Broadcast config change to all in room |
| `error` | `{ message }` | Error (room not found, game already started, etc.) |

---

## Server Logic Notes

### Imposter Assignment
- On `start-game`, server picks `numImposters` players randomly from alive list.
- Server picks a random word from `config.json` words list.
- Each player receives their `game-started` event individually:
  - Normal player: `{ yourRole: "player", word: "Pizza" }`
  - Imposter: `{ yourRole: "imposter", hint: "It's Italian and round" }`

### First Speaker Selection
- Server picks a random alive player (can be the imposter) and sends their `name` and `color` in `all-players-ready`.

### Voting Trigger
- During discussion phase, any player can emit `go-to-vote` (for themselves only) — server responds with `voting-started` to just that socket, moving them to voting early
- When discussion timer hits 0, server emits `voting-started` to all players still in discussion, forcing them into voting
- Voting is mandatory — no skip

### Voting & Elimination
- Tied votes: random elimination among tied players.
- After elimination:
  - If `revealResultOnElimination: true` → send `wasImposter: true/false`
  - If `revealResultOnElimination: false` → send `wasImposter: null` (hidden)
- Check game-over conditions:
  - All imposters eliminated → innocents win
  - Imposters ≥ innocents remaining → imposters win

### Game Over Copy (server sends `reason` field)
- Innocents win (1 imposter): `"Liar! Liar! Priya's pants on fire! 🔥"`
- Innocents win (2+ imposters): `"Liar! Liar! Priya & Rohan's pants on fire! 🔥🔥"` — server joins names with ` & `
- Imposters win: `"Kon Dogla... sabka 😈"`

Server constructs the `liarText` string and includes it in the `game-over` payload.
- On `update-config`, server checks if the socket's player name matches `process.env.ADMIN_NAME`.
- Never send `ADMIN_NAME` to client.

---

## Terminal Logging (Server-side)

On `start-game`, server logs:
```
╔══════════════════════════════════════╗
║        KON DOGLA? — ROUND 1         ║
╠══════════════════════════════════════╣
║  WORD:     Pizza                     ║
║  HINT:     It's Italian and round    ║
╠══════════════════════════════════════╣
║  PLAYERS & ROLES:                    ║
║  Aryan   [#FF6B6B]  → INNOCENT       ║
║  Priya   [#6BFFB8]  → IMPOSTER 👺   ║
║  Rohan   [#FFD93D]  → INNOCENT       ║
╠══════════════════════════════════════╣
║  FIRST SPEAKER: Rohan                ║
╚══════════════════════════════════════╝
```

---

## Frontend Screens & Expected Data

### 1. Home Screen
No data needed. Two buttons: Create Room, Join Room.

### 2. Create/Join Room Screen
- Color picker (hex value)
- Name input
- Room code input (join only)
- Submits to `POST /api/room/create` or `POST /api/room/join`

### 3. Lobby Screen
- Displays `roomCode` prominently (for sharing)
- Shows list of `players` (name + color dot)
- Host sees "Start Game" button (disabled until `minPlayers` met)
- Admin sees "Config ⚙" button
- Listens to `room-update` socket event

### 4. Admin Config Panel
- Number inputs: `numImposters`, `discussionTimerSeconds`, `votingTimerSeconds`
- Toggle: `revealResultOnElimination`
- Word list editor: add/remove/edit `{ word, hint }` pairs
- Save button → emits `update-config`

### 5. Word Reveal Screen
- Receives `game-started` event data
- Shows player's own envelope card (name + color)
- **Hold-to-reveal mechanic** (mousedown/touchstart → show word inside card)
- **Release mechanic** (mouseup/touchend → hide word, show "I'm Ready" button)
- "I'm Ready" → emits `player-ready`
- Shows `readyCount / totalCount` from `player-ready-update`
- When `all-players-ready` fires → transition to Discussion screen

### 6. Discussion Screen
- Shows `firstSpeaker` highlighted with name and color (big reveal)
- Countdown timer from `discussion-tick`
- List of alive players
- "Go to Vote" button (host only, or auto on timer end)

### 7. Voting Screen
- Grid/list of alive players (name + color)
- Each player selects one to vote for → emits `submit-vote`
- Can't vote for yourself
- Vote lock-in animation
- Countdown from `voting-tick`

### 8. Elimination Screen
- Dramatic reveal of who was eliminated
- If `revealResultOnElimination: true`: show "Was Imposter 👺" or "Was Innocent 😇"
- If `false`: show "???" with no reveal
- Continue button → next round (host triggers)

### 9. Game Over Screen
- Win/loss screen
- Reveal all imposters (names + colors)
- "Play Again" → resets room to LOBBY state

---

## Cloudflare Tunnel Setup (for host)

```bash
# Install cloudflared if not already done
# Then run:
cloudflared tunnel --url http://localhost:3000
```
Share the generated `https://xxxx.trycloudflare.com` URL with players.

---

## Dependencies (`package.json`)

```json
{
  "dependencies": {
    "express": "^4.18.0",
    "socket.io": "^4.6.0",
    "dotenv": "^16.0.0",
    "cors": "^2.8.5"
  }
}
```

---
