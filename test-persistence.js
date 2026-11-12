const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');
const port = 31917, url = `http://127.0.0.1:${port}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const emit = (s, event, data) => new Promise((resolve, reject) => s.timeout(3000).emit(event, data, (err, value) => err ? reject(err) : resolve(value)));
const connect = () => new Promise((resolve, reject) => { const s = io(url, { reconnection: false }); s.once('connect', () => resolve(s)); s.once('connect_error', reject); });
async function ready() { for (let i = 0; i < 60; i++) { try { if ((await fetch(url + '/health')).ok) return; } catch {} await wait(100); } throw Error('Server did not start'); }
(async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'noir-rooms-'));
  const store = path.join(directory, 'rooms.json');
  let server, host, reconnected;
  const start = () => spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), DATABASE_URL: '', ROOM_STORE_FILE: store }, stdio: 'ignore' });
  try {
    server = start(); await ready(); host = await connect();
    const state = { hostId: 'host', gameMode: 'holdem', maxSeats: 4, players: [{ id: 'host', name: 'Host', cards: [{ uid: 'card', rank: 'A' }] }], holdem: { phase: 'flop', pot: 250 } };
    assert.equal((await emit(host, 'create_room', { roomCode: 'PERSIST', state })).ok, true);
    for (let i = 0; i < 40; i++) { try { if (JSON.parse(await readFile(store, 'utf8'))[0]?.state?.holdem?.pot === 250) break; } catch {} if (i === 39) throw Error('Room was not saved'); await wait(50); }
    host.disconnect(); server.kill(); await new Promise(resolve => server.once('exit', resolve));
    server = start(); await ready(); reconnected = await connect();
    const result = await emit(reconnected, 'reconnect_session', { roomCode: 'PERSIST', playerId: 'host' });
    assert.equal(result.ok, true); assert.equal(result.state.holdem.pot, 250); assert.equal(result.state.players[0].cards[0].rank, 'A');
    console.log('Room state survived server restart');
  } finally { host?.disconnect(); reconnected?.disconnect(); if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } await rm(directory, { recursive: true, force: true }); }
})().catch(err => { console.error(err); process.exitCode = 1; });
