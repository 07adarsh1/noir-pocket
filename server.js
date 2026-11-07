const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve(__dirname);

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURI(req.url.split('?')[0]);

  // Dedicated UptimeRobot / Health Check Endpoint
  if (reqPath === '/health' || reqPath === '/ping') {
    const healthData = JSON.stringify({
      status: 'ok',
      service: 'noir-card-lounge',
      uptime: Math.floor(process.uptime()),
      activeRooms: rooms.size,
      connectedClients: io.engine ? io.engine.clientsCount : 0,
      timestamp: new Date().toISOString()
    });

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(healthData),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*'
    });

    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(healthData);
    }
    return;
  }

  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (readErr, content) => {
        if (readErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=UTF-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

// Attach Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// In-Memory Room Store
// code -> { roomCode, hostSocketId, state, updatedAt, disconnectTimers: Map }
const rooms = new Map();

/**
 * TIER 1: Anti-Cheat Card Secrecy Projection Engine
 * Strips private opponent cards before sending over the network
 */
function maskStateForPlayer(fullState, targetPlayerId, isSpectator = false) {
  if (!fullState || !fullState.players) return fullState;

  // Deep clone to ensure server authoritative state is untouched
  const projected = JSON.parse(JSON.stringify(fullState));

  const isHoldemShowdown = projected.gameMode === 'holdem' && projected.holdem && projected.holdem.phase === 'showdown';
  const isBluffReveal = projected.gameMode === 'bluff' && projected.bluff && projected.bluff.phase === 'challenge_reveal';

  // 1. Mask Opponent Cards
  projected.players = projected.players.map((p) => {
    // Recipient player always sees their own cards (unless they are a spectator)
    if (!isSpectator && p.id === targetPlayerId) {
      return p;
    }

    const maskedP = Object.assign({}, p);

    if (projected.gameMode === 'holdem') {
      if (isHoldemShowdown && !p.pokerFolded) {
        // Showdown: hands are revealed to everyone
        maskedP.cards = p.cards;
      } else {
        // Conceal hole cards
        maskedP.cards = (p.cards || []).map(c => ({
          uid: c.uid,
          hidden: true
        }));
      }
    } else if (projected.gameMode === 'bluff') {
      // In Bluff, opponent cards in hand are always secret
      maskedP.cards = (p.cards || []).map(c => ({
        uid: c.uid,
        hidden: true
      }));
    } else if (projected.gameMode === 'blackjack') {
      // Blackjack player cards are public
      maskedP.cards = p.cards;
    }

    return maskedP;
  });

  // 2. Mask Blackjack Dealer Hole Card
  // Only mask for non-host participants; the host manages the shoe and game engine
  const isHost = Boolean(targetPlayerId && (targetPlayerId === projected.hostId));
  if (!isHost && projected.gameMode === 'blackjack' && projected.bj) {
    if (projected.bj.dealerHoleHidden && Array.isArray(projected.bj.dealerCards) && projected.bj.dealerCards.length > 1) {
      projected.bj.dealerCards = projected.bj.dealerCards.map((c, idx) => {
        if (idx === 1) return { uid: c.uid, hidden: true };
        return c;
      });
    }
  }

  // 3. Mask Bluff Center Pile cards unless in challenge reveal
  if (projected.gameMode === 'bluff' && projected.bluff && projected.bluff.lastPlay) {
    if (!isBluffReveal && Array.isArray(projected.bluff.lastPlay.actualCards)) {
      projected.bluff.lastPlay = Object.assign({}, projected.bluff.lastPlay, {
        actualCards: projected.bluff.lastPlay.actualCards.map(c => ({
          uid: c.uid,
          hidden: true
        }))
      });
    }
  }

  return projected;
}

/**
 * Broadcasts personalized anti-cheat projections to each player and spectator in room
 */
function broadcastMaskedRoomState(code) {
  const roomEntry = rooms.get(code);
  if (!roomEntry || !roomEntry.state) return;

  const socketsInRoom = io.sockets.adapter.rooms.get(code);
  if (!socketsInRoom) return;

  for (const socketId of socketsInRoom) {
    const clientSocket = io.sockets.sockets.get(socketId);
    if (!clientSocket) continue;

    // Do not echo masked state back to the authoring host socket
    if (socketId === roomEntry.hostSocketId) continue;

    const playerId = clientSocket.data.playerId;
    const isSpectator = Boolean(clientSocket.data.isSpectator);
    const masked = maskStateForPlayer(roomEntry.state, playerId, isSpectator);

    clientSocket.emit('room_sync', {
      roomCode: code,
      state: masked
    });
  }
}

io.on('connection', (socket) => {
  // 1. Create Room
  socket.on('create_room', (data, ack) => {
    try {
      const { roomCode, state } = data || {};
      if (!roomCode) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Invalid room code' });
        return;
      }
      const code = roomCode.toUpperCase();
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.playerId = (state && (state.myPlayerId || state.hostId)) || null;
      socket.data.isSpectator = false;

      rooms.set(code, {
        roomCode: code,
        hostSocketId: socket.id,
        state: state || {},
        updatedAt: Date.now(),
        disconnectTimers: {}
      });

      console.log(`[Room Created] ${code} by Host Socket ${socket.id}`);
      if (typeof ack === 'function') ack({ ok: true, roomCode: code });
    } catch (err) {
      console.error('[create_room error]', err);
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  // 2. Join Room (Player or Spectator)
  socket.on('join_room', (data, ack) => {
    try {
      const { roomCode, player, asSpectator } = data || {};
      const code = (roomCode || '').trim().toUpperCase();
      if (!code) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Room code required' });
        return;
      }

      let roomEntry = rooms.get(code);
      if (!roomEntry) {
        roomEntry = {
          roomCode: code,
          hostSocketId: socket.id,
          state: null,
          updatedAt: Date.now(),
          disconnectTimers: {}
        };
        rooms.set(code, roomEntry);
      }

      socket.join(code);
      socket.data.roomCode = code;
      socket.data.playerId = player ? player.id : null;
      socket.data.isSpectator = Boolean(asSpectator);

      // Register player in server authoritative state
      if (!asSpectator && player && roomEntry.state && Array.isArray(roomEntry.state.players)) {
        const existingIdx = roomEntry.state.players.findIndex(p => p.id === player.id);
        if (existingIdx !== -1) {
          roomEntry.state.players[existingIdx].name = player.name || roomEntry.state.players[existingIdx].name;
          roomEntry.state.players[existingIdx].avatar = player.avatar || roomEntry.state.players[existingIdx].avatar;
          roomEntry.state.players[existingIdx].isDisconnected = false;
          if (Array.isArray(player.cards) && player.cards.length > 0) {
            roomEntry.state.players[existingIdx].cards = player.cards;
          }
        } else if (roomEntry.state.players.length < (roomEntry.state.maxSeats || 6)) {
          roomEntry.state.players.push({
            id: player.id,
            name: player.name || ('Player ' + (roomEntry.state.players.length + 1)),
            avatar: player.avatar || '02',
            chips: player.chips || (roomEntry.state.players[0] && roomEntry.state.players[0].chips) || 2500,
            isHost: false,
            isBot: false,
            cards: Array.isArray(player.cards) ? player.cards : [],
            bjBet: 100,
            bjStatus: '',
            pokerBet: 0,
            pokerFolded: false,
            pokerRole: ''
          });
        }
        roomEntry.updatedAt = Date.now();
      }

      // If joining as spectator, register in spectators list
      if (asSpectator && roomEntry.state) {
        roomEntry.state.spectators = roomEntry.state.spectators || [];
        if (!roomEntry.state.spectators.some(s => s.id === player.id)) {
          roomEntry.state.spectators.push({
            id: player.id,
            name: player.name,
            avatar: player.avatar
          });
        }
      }

      // Notify others in room
      socket.to(code).emit('player_connected', {
        player,
        isSpectator: Boolean(asSpectator),
        roomCode: code
      });

      console.log(`[Joined] ${player ? player.name : socket.id} (${asSpectator ? 'Spectator' : 'Player'}) -> Room ${code}`);

      const masked = roomEntry.state ? maskStateForPlayer(roomEntry.state, socket.data.playerId, Boolean(asSpectator)) : null;

      if (typeof ack === 'function') {
        ack({ ok: true, roomCode: code, state: masked, isSpectator: Boolean(asSpectator) });
      }

      broadcastMaskedRoomState(code);
    } catch (err) {
      console.error('[join_room error]', err);
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  // 3. Authoritative State Synchronization (Host sends full authoritative state)
  socket.on('sync_state', (data) => {
    try {
      const { roomCode, state } = data || {};
      if (!roomCode || !state) return;
      const code = roomCode.toUpperCase();

      let roomEntry = rooms.get(code);
      if (!roomEntry) {
        roomEntry = {
          roomCode: code,
          hostSocketId: socket.id,
          state,
          updatedAt: Date.now(),
          disconnectTimers: {}
        };
        rooms.set(code, roomEntry);
      } else {
        // Enforce Host Authority: Only the room host is permitted to overwrite authoritative state
        const isHost = (socket.id === roomEntry.hostSocketId) ||
                       (state.hostId && socket.data.playerId === state.hostId);
        if (!isHost) {
          // Reject state sync from non-host guests so they cannot overwrite unmasked cards with masked cards
          return;
        }
        roomEntry.state = state;
        roomEntry.updatedAt = Date.now();
        // Update host socket id if sender is room host
        if (state.hostId && socket.data.playerId === state.hostId) {
          roomEntry.hostSocketId = socket.id;
        }
      }

      // Distribute anti-cheat masked state to each participant
      broadcastMaskedRoomState(code);
    } catch (err) {
      console.error('[sync_state error]', err);
    }
  });

  // 4. Guest Player Action Forwarding (TIER 1: Host Authority)
  socket.on('player_action', (data) => {
    try {
      const { roomCode, action, payload } = data || {};
      if (!roomCode) return;
      const code = roomCode.toUpperCase();
      const roomEntry = rooms.get(code);
      if (!roomEntry) return;

      // Real-time player rename handler (authoritative server sync)
      if (action === 'rename_player' && payload && payload.name) {
        if (roomEntry.state && Array.isArray(roomEntry.state.players)) {
          const targetPlayerId = payload.playerId || socket.data.playerId;
          const p = roomEntry.state.players.find(x => x.id === targetPlayerId);
          if (p) {
            p.name = String(payload.name).trim().slice(0, 14);
            if (payload.avatar) p.avatar = payload.avatar;
            roomEntry.updatedAt = Date.now();
          }
        }
      }

      const hostSocket = io.sockets.sockets.get(roomEntry.hostSocketId);
      if (hostSocket && hostSocket.id !== socket.id) {
        hostSocket.emit('player_action', {
          senderSocketId: socket.id,
          senderPlayerId: socket.data.playerId,
          action,
          payload
        });
      } else {
        // Broadcast to other peers if host socket changed
        socket.to(code).emit('player_action', {
          senderSocketId: socket.id,
          senderPlayerId: socket.data.playerId,
          action,
          payload
        });
      }
    } catch (e) {
      console.error('[player_action error]', e);
    }
  });

  // 5. Table Chat & Presets (TIER 2)
  socket.on('table_chat', (data) => {
    try {
      const { roomCode, senderName, senderSeat, message } = data || {};
      if (!roomCode || !message) return;
      const code = roomCode.toUpperCase();

      const chatEvent = {
        id: Date.now() + Math.floor(Math.random() * 9999),
        senderName: (senderName || 'Player').slice(0, 24),
        senderSeat: senderSeat !== undefined ? senderSeat : null,
        message: String(message).slice(0, 120),
        time: Date.now()
      };

      // Broadcast to all clients in room including sender confirmation
      io.to(code).emit('table_chat', chatEvent);
    } catch (e) {}
  });

  // 6. Synchronized Table FX (Flights, chips, win pulses)
  socket.on('sync_fx', (data) => {
    try {
      const { roomCode, fx } = data || {};
      if (!roomCode || !fx) return;
      socket.to(roomCode.toUpperCase()).emit('table_fx', fx);
    } catch (err) {}
  });

  // 7. Session Reconnection (TIER 1: Mobile Session Recovery)
  socket.on('reconnect_session', (data, ack) => {
    try {
      const { roomCode, playerId } = data || {};
      const code = (roomCode || '').toUpperCase();
      const roomEntry = rooms.get(code);
      if (!roomEntry || !roomEntry.state) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Room expired or not found' });
        return;
      }

      socket.join(code);
      socket.data.roomCode = code;
      socket.data.playerId = playerId;

      // Find player in room state and clear disconnected status
      const p = (roomEntry.state.players || []).find(pl => pl.id === playerId);
      if (p) {
        p.isDisconnected = false;
        p.disconnectedAt = null;
      }

      // Clear any pending timeout for this player
      if (roomEntry.disconnectTimers && roomEntry.disconnectTimers[playerId]) {
        clearTimeout(roomEntry.disconnectTimers[playerId]);
        delete roomEntry.disconnectTimers[playerId];
      }

      console.log(`[Player Reconnected] ${playerId} -> Room ${code}`);

      // If this player was host, reclaim host socket
      if (roomEntry.state.hostId === playerId) {
        roomEntry.hostSocketId = socket.id;
      }

      const masked = maskStateForPlayer(roomEntry.state, playerId, socket.data.isSpectator);
      if (typeof ack === 'function') ack({ ok: true, state: masked });

      socket.to(code).emit('player_reconnected', { playerId });
      broadcastMaskedRoomState(code);
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  // 8. Leave Room
  socket.on('leave_room', (data) => {
    const code = (data && data.roomCode) || socket.data.roomCode;
    const playerId = (data && data.playerId) || socket.data.playerId;
    if (code) {
      socket.leave(code);
      const roomEntry = rooms.get(code);
      if (roomEntry && roomEntry.state && Array.isArray(roomEntry.state.players) && playerId) {
        roomEntry.state.players = roomEntry.state.players.filter(p => p.id !== playerId);
        roomEntry.updatedAt = Date.now();
      }
      socket.to(code).emit('player_disconnected', {
        socketId: socket.id,
        playerId
      });
      broadcastMaskedRoomState(code);
      console.log(`[Player Left] ${socket.id} (${playerId}) from Room ${code}`);
    }
  });

  // 9. Disconnect with Graceful 45-Second Reconnect Window
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const playerId = socket.data.playerId;

    if (code && playerId) {
      const roomEntry = rooms.get(code);
      if (roomEntry && roomEntry.state) {
        const p = (roomEntry.state.players || []).find(pl => pl.id === playerId);
        if (p && !p.isBot) {
          p.isDisconnected = true;
          p.disconnectedAt = Date.now();

          // Set 45-second grace period before converting to bot
          if (!roomEntry.disconnectTimers) roomEntry.disconnectTimers = {};
          if (roomEntry.disconnectTimers[playerId]) clearTimeout(roomEntry.disconnectTimers[playerId]);

          roomEntry.disconnectTimers[playerId] = setTimeout(() => {
            const freshEntry = rooms.get(code);
            if (!freshEntry || !freshEntry.state) return;
            const targetP = (freshEntry.state.players || []).find(pl => pl.id === playerId);
            if (targetP && targetP.isDisconnected) {
              // Convert to bot so game never hangs
              targetP.isBot = true;
              targetP.name += ' (AI)';
              targetP.isDisconnected = false;
              console.log(`[Player Timed Out] ${playerId} converted to bot in Room ${code}`);
              broadcastMaskedRoomState(code);
            }
          }, 45000);
        }
      }

      socket.to(code).emit('player_disconnected', {
        socketId: socket.id,
        playerId: socket.data.playerId
      });
      console.log(`[Socket Disconnected] ${socket.id} (Room ${code})`);
      broadcastMaskedRoomState(code);
    }
  });
});

// Periodic room cleanup (expire rooms inactive for > 6 hours)
setInterval(() => {
  const cutoff = Date.now() - (6 * 60 * 60 * 1000);
  for (const [code, room] of rooms.entries()) {
    if (room.updatedAt < cutoff) {
      rooms.delete(code);
    }
  }
}, 30 * 60 * 1000);

// Render / Cloud Keep-Alive Service
// If RENDER_EXTERNAL_URL or KEEP_ALIVE_URL is provided, auto-ping /health every 10 minutes
const keepAliveUrl = process.env.RENDER_EXTERNAL_URL || process.env.KEEP_ALIVE_URL;
if (keepAliveUrl) {
  const target = keepAliveUrl.replace(/\/+$/, '') + '/health';
  const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes (Render spins down after 15m)
  console.log(`[Keep-Alive] Initializing auto self-ping service targeting ${target} every 10m`);

  setInterval(() => {
    try {
      const u = new URL(target);
      const client = u.protocol === 'https:' ? require('https') : require('http');
      client.get(target, (res) => {
        console.log(`[Keep-Alive] Pinged ${target} - Status: ${res.statusCode}`);
      }).on('error', (err) => {
        console.warn(`[Keep-Alive] Ping warning:`, err.message);
      });
    } catch (e) {
      console.warn(`[Keep-Alive] URL error:`, e.message);
    }
  }, PING_INTERVAL);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NOIR Live Production Server with Anti-Cheat & Socket.IO running at http://localhost:${PORT}`);
});
