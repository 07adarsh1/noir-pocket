# noir-pocket

> **NOIR** — Premium Minimalist Multiplayer Card Gaming Lounge. Play **Blackjack**, **Texas Hold'em**, and **Bluff** with friends in real time with synchronized physics, anti-cheat card secrecy, and sleek modern design.

---

## 🌟 Key Features

- **♠️ Three Iconic Card Games:**
  - **Blackjack:** Standard casino rules, split pairs, double down, natural blackjacks, dealer hole-card reveals.
  - **Texas Hold'em:** Preflop, Flop, Turn, River streets, side pots, hand evaluator ranking, raise slider with quick presets.
  - **Bluff:** Fast-paced bluffing card game, claimed ranks, doubt/challenge system, dynamic pile collect physics.
- **🛡️ Anti-Cheat & Network Secrecy:** Opponent hole cards and dealer down cards are stripped over the wire before broadcasting. Private card ranks and suits cannot be snooped via DevTools or packet analysis.
- **👑 Host Authority Architecture:** Single authoritative engine managed by the host socket with zero race conditions.
- **📱 Mobile Reconnection & 45s Grace Window:** Seamlessly restores player state upon Wi-Fi or screen sleep reconnections.
- **⏳ Turn Inactivity Auto-Timers:** 25-second turn countdown rings with auto-action safeguards (Auto-Stand, Auto-Check/Fold, Auto-Pass).
- **💬 Table Chat & Banter:** Live chat input and quick preset reaction buttons with floating speech bubbles over player seats.
- **⚡ Game Pacing Toggle:** Switch between **Cinematic** (~720ms deals, 2.4s bot delays) and **Turbo Fast** (~320ms deals, 850ms bot delays).
- **👀 Spectator Mode:** Full tables allow guests to enter as spectators without taking seats.
- **🤖 UptimeRobot & 24/7 Render Keep-Alive:** Dedicated `/health` and `/ping` endpoints plus built-in auto self-pinging so free-tier servers never sleep.

---

## 🚀 Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/07adarsh1/noir-pocket.git
cd noir-pocket
npm install
```

### 2. Start the Server
```bash
npm start
```
The game will be live at `http://localhost:3000`.

### 3. Run Automated Tests
```bash
npm test
```

---

## 🌐 Deploy to Render

1. Create a new **Web Service** on [Render](https://render.com).
2. Connect this repository (`07adarsh1/noir-pocket`).
3. Set the following settings:
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Health Check Path:** `/health`
4. Set up an **[UptimeRobot](https://uptimerobot.com)** HTTP monitor targeting `https://<your-render-app>.onrender.com/health` every 5 minutes to keep the instance running 24/7.

---

## 📄 License
MIT
