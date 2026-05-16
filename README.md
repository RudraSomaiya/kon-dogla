# 👺 Kon Dogla? — Real-Time Multiplayer Word Imposter Game

> *"Who's the Liar?"* — A party game built for IRL chaos.

Kon Dogla? is a real-time, multiplayer word-imposter party game inspired by Spyfall. Players receive a secret word and must discuss it naturally — but one (or more) among them is a **Dogla** (liar) who has only a vague hint. Vote out the imposters before they fool everyone.

---

## ✨ Features

- 🃏 **Hold-to-Reveal** envelope mechanic — peek at your role card without others seeing
- 🎤 **First Speaker reveal** — dramatic spotlight shows who kicks off discussion
- ⏱️ **Live countdown timers** for discussion and voting phases
- 🗳️ **Real-time voting** — go to vote mid-discussion or wait for the timer
- 💀 **Elimination reveal** — configurable: show the result or keep everyone guessing
- 👺 **Game Over screens** — cinematic Innocents Win / Imposters Win endings
- ⚙️ **Admin Config Panel** — live-edit word lists, timers, imposter count in-game
- 🌐 **Cloudflare Tunnel** ready — share a public URL, no port-forwarding needed
- 📱 **Mobile-first** glassmorphic UI — neon/dark design system

---

## 🖥️ Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express |
| Real-time | Socket.io |
| Frontend | Vanilla HTML/CSS/JS (SPA) |
| Styling | Tailwind CSS (CDN) + custom CSS |
| Config | `config.json` + `.env` |
| Tunnel | Cloudflare Tunnel (`cloudflared`) |

---

## 📁 Project Structure

```
kon-dogla/
├── server.js           # Express + Socket.io backend
├── .env                # Secrets (PORT, ADMIN_NAME)
├── config.json         # Live game configuration
├── package.json
└── public/
    └── index.html      # Full SPA — all screens in one file
```

---

## 🚀 Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
PORT=3000
ADMIN_NAME=your-secret-admin-name
```

> `ADMIN_NAME` is the display name that grants in-game admin/config access. Keep it secret.

### 3. Configure the game

Edit `config.json` to set up default game parameters and your word list:

```json
{
  "numImposters": 1,
  "revealResultOnElimination": true,
  "discussionTimerSeconds": 120,
  "votingTimerSeconds": 60,
  "minPlayers": 3,
  "words": [
    { "word": "Pizza",    "hint": "It's Italian and round" },
    { "word": "Cricket",  "hint": "Played with a bat and ball" },
    { "word": "Mango",    "hint": "King of fruits" },
    { "word": "Monsoon",  "hint": "Wet season" },
    { "word": "Chai",     "hint": "Hot beverage" }
  ]
}
```

### 4. Start the server

```bash
npm run dev
```

The game runs at **http://localhost:3000**

---

## 🌐 Playing Over the Internet (Cloudflare Tunnel)

To let friends join from outside your network without port-forwarding:

```bash
# Install cloudflared (one-time)
# https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/

# Then expose your local server:
cloudflared tunnel --url http://localhost:3000
```

Share the generated `https://xxxx.trycloudflare.com` URL with all players.

---

## 🎮 How to Play

### Setup
1. **Host** opens the game URL, enters a name + colour, clicks **Create Room**
2. A 4-letter room code is displayed in the lobby — share it with friends
3. **Players** join via **Join Room** using the code
4. Host clicks **START GAME** (requires at least 3 players)

### Game Loop

```
LOBBY → WORD REVEAL → DISCUSSION → VOTING → ELIMINATION → (loop or GAME OVER)
```

| Phase | What happens |
|---|---|
| **Word Reveal** | Each player holds their envelope to peek at their secret word (or hint if they're the Dogla) |
| **Discussion** | A random first speaker is revealed. Players take turns saying one clue word. Anyone can go to vote early. |
| **Voting** | Players vote for who they think is the Dogla. Tied votes → random elimination. |
| **Elimination** | Eliminated player is revealed. Optionally shows if they were the Dogla or innocent. |
| **Game Over** | All Doglas caught → Innocents Win 🏆 / Doglas outnumber innocents → Imposters Win 😈 |

### Win Conditions
- **Innocents win** — all imposters are eliminated
- **Imposters win** — imposters equal or outnumber the remaining innocents

---

## ⚙️ Admin Panel

Join the game with the name set in `ADMIN_NAME` (`.env`) to unlock the **Config ⚙** button in the lobby.

In-game editable settings:
- Number of imposters
- Discussion timer (seconds)
- Voting timer (seconds)
- Reveal result on elimination (toggle)
- Custom word list (add / edit / remove word+hint pairs)

Changes apply immediately and persist to `config.json`.

---

## 🔌 Socket.io Event Reference

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `join-room` | `{ roomCode, playerName, color }` | Join a room's socket channel |
| `start-game` | `{ roomCode }` | Host starts the round |
| `player-ready` | `{ roomCode }` | Player has seen their card |
| `go-to-vote` | `{ roomCode }` | Player moves to voting early |
| `submit-vote` | `{ roomCode, targetId }` | Submit a vote for a player |
| `play-again` | `{ roomCode }` | Host resets the room for a new game |
| `update-config` | `{ roomCode, config }` | Admin saves new config (server-validated) |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `room-update` | `{ players, state, roomCode }` | Lobby refresh |
| `game-started` | `{ yourRole, word?, hint?, firstSpeaker }` | Individual role payload per player |
| `player-ready-update` | `{ readyCount, totalCount }` | Word reveal progress |
| `all-players-ready` | `{ firstSpeaker }` | Triggers discussion screen |
| `discussion-tick` | `{ secondsRemaining }` | Discussion countdown |
| `voting-started` | `{ players }` | Triggers voting screen |
| `voting-tick` | `{ secondsRemaining }` | Voting countdown |
| `elimination-result` | `{ eliminatedPlayer, wasImposter, continueGame }` | Elimination reveal |
| `game-over` | `{ reason, imposters, winners, liarText, word }` | Game end |
| `config-updated` | `{ config }` | Config change broadcast |
| `error` | `{ message }` | Error feedback |

---

## 🛠️ REST API

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/room/create` | Create a new room |
| `POST` | `/api/room/join` | Join an existing room |
| `GET` | `/api/config` | Fetch current config |
| `POST` | `/api/config` | Save config (admin only) |

---

## 🧩 Screens

| Screen | Description |
|---|---|
| Home | Landing page — Create or Join |
| Create Room | Name + colour picker → create |
| Join Room | Name + colour + 4-letter code → join |
| Lobby | Player grid, room code, host controls |
| Admin Config | Live game settings editor |
| Word Reveal | Hold-to-reveal envelope + ready button |
| Discussion | First speaker spotlight + countdown + Vote button |
| Voting | Player list, tap to vote, live count |
| Elimination | Dramatic result reveal |
| Game Over | Winner screen, imposter reveal, play again |

---

## 📦 Dependencies

```json
{
  "express": "^4.18.0",
  "socket.io": "^4.6.0",
  "dotenv": "^16.0.0",
  "cors": "^2.8.5"
}
```

---

## 🔒 Security Notes

- `ADMIN_NAME` is **never** sent to the client — all admin actions are re-validated server-side
- Players cannot vote for themselves — enforced on both client and server
- Role assignment (word/hint) is sent individually per socket — no player ever receives another's role

---

## 📝 License

Built for fun. Play responsibly. Blame the Dogla.
