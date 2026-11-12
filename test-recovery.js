const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const port = 31876;
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const clients = [];
const connect = () => new Promise((resolve, reject) => {
  const s = io(`http://localhost:${port}`, { reconnection: false });
  clients.push(s); s.once('connect', () => resolve(s)); s.once('connect_error', reject);
});
const emit = (s, event, data) => new Promise((resolve, reject) => s.timeout(3000).emit(event, data, (err, value) => err ? reject(err) : resolve(value)));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  for (let i = 0; ; i++) { try { const r = await fetch(`http://localhost:${port}/health`); if (r.ok) break; } catch {} if (i === 30) throw Error('server did not start'); await wait(100); }
  const host = await connect(), guest = await connect(), stranger = await connect();
  const state = { hostId: 'host', gameMode: 'holdem', maxSeats: 2, players: [{ id: 'host', cards: [{ uid: 'h', rank: 'A' }] }, { id: 'guest', cards: [{ uid: 'g', rank: 'K' }] }] };
  assert.equal((await emit(host, 'create_room', { roomCode: 'TEST', state })).ok, true);
  assert.equal((await emit(stranger, 'create_room', { roomCode: 'TEST', state })).ok, false);
  assert.equal((await emit(stranger, 'join_room', { roomCode: 'MISSING', player: { id: 'x' } })).ok, false);
  assert.equal((await emit(stranger, 'join_room', { roomCode: 'TEST', player: { id: 'x' } })).ok, false);
  const join = await emit(guest, 'join_room', { roomCode: 'TEST', player: { id: 'guest' } });
  assert.equal(join.state.players[0].cards[0].hidden, true);
  host.disconnect(); await wait(100);
  const recovered = await connect();
  const recovery = await emit(recovered, 'reconnect_session', { roomCode: 'TEST', playerId: 'host' });
  assert.equal(recovery.ok, true);
  assert.equal(recovery.state.players[1].cards[0].rank, 'K');
  assert.equal(recovery.state.players[0].isDisconnected, false);
  assert.equal((await emit(stranger, 'reconnect_session', { roomCode: 'TEST', playerId: 'unknown' })).ok, false);
  assert.equal((await fetch(`http://localhost:${port}/server.js`)).status, 404);
  assert.equal((await fetch(`http://localhost:${port}/.git/config`)).status, 404);
  console.log('Room recovery and access checks passed');
})().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => { clients.forEach(s => s.disconnect()); server.kill(); });
