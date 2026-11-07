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
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA / client-side routing
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

// In-Memory Room Store: roomCode -> { roomCode, state, updatedAt }
const rooms = new Map();

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
      socket.data.playerId = (state && state.myPlayerId) || null;

      rooms.set(code, {
        roomCode: code,
        state: state || {},
        updatedAt: Date.now()
      });

      console.log(`[Room Created] ${code} by socket ${socket.id}`);
      if (typeof ack === 'function') ack({ ok: true, roomCode: code });
    } catch (err) {
      console.error('[create_room error]', err);
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  // 2. Join Room
  socket.on('join_room', (data, ack) => {
    try {
      const { roomCode, player } = data || {};
      const code = (roomCode || '').trim().toUpperCase();
      if (!code) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Room code required' });
        return;
      }

      let roomEntry = rooms.get(code);
      if (!roomEntry) {
        // If not found in memory, create container so players can initialize
        roomEntry = { roomCode: code, state: null, updatedAt: Date.now() };
        rooms.set(code, roomEntry);
      }

      socket.join(code);
      socket.data.roomCode = code;
      socket.data.playerId = player ? player.id : null;

      // Alert other room participants that player joined
      socket.to(code).emit('player_connected', { player, roomCode: code });

      console.log(`[Player Joined] ${player ? player.name : socket.id} -> Room ${code}`);
      if (typeof ack === 'function') {
        ack({ ok: true, roomCode: code, state: roomEntry.state });
      }
    } catch (err) {
      console.error('[join_room error]', err);
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  // 3. State Synchronization across all devices
  socket.on('sync_state', (data) => {
    try {
      const { roomCode, state } = data || {};
      if (!roomCode || !state) return;
      const code = roomCode.toUpperCase();

      let roomEntry = rooms.get(code);
      if (!roomEntry) {
        roomEntry = { roomCode: code, state, updatedAt: Date.now() };
        rooms.set(code, roomEntry);
      } else {
        roomEntry.state = state;
        roomEntry.updatedAt = Date.now();
      }

      // Broadcast state to all other players in this room
      socket.to(code).emit('room_sync', { roomCode: code, state });
    } catch (err) {
      console.error('[sync_state error]', err);
    }
  });

  // 4. Synchronized Table FX (Chip tosses, card flips, win blasts)
  socket.on('sync_fx', (data) => {
    try {
      const { roomCode, fx } = data || {};
      if (!roomCode || !fx) return;
      socket.to(roomCode.toUpperCase()).emit('table_fx', fx);
    } catch (err) {}
  });

  // 5. Leave Room
  socket.on('leave_room', (data) => {
    const code = (data && data.roomCode) || socket.data.roomCode;
    if (code) {
      socket.leave(code);
      socket.to(code).emit('player_disconnected', {
        socketId: socket.id,
        playerId: socket.data.playerId
      });
      console.log(`[Player Left] ${socket.id} from Room ${code}`);
    }
  });

  // 6. Disconnect
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (code) {
      socket.to(code).emit('player_disconnected', {
        socketId: socket.id,
        playerId: socket.data.playerId
      });
      console.log(`[Socket Disconnected] ${socket.id} (was in Room ${code})`);
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NOIR Live Server with Socket.IO running at http://localhost:${PORT}`);
});
