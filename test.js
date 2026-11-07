const { io } = require('socket.io-client');

async function runTests() {
  console.log('=== NOIR TIER 1 & TIER 2 INTEGRATION VERIFICATION ===\n');
  const SERVER_URL = 'http://localhost:3000';
  const ROOM_CODE = 'ROOM_' + Date.now().toString(36).toUpperCase();

  // 0. UptimeRobot / Health Check Endpoint Test
  const healthRes = await fetch(`${SERVER_URL}/health`);
  const healthJson = await healthRes.json();
  if (healthRes.status === 200 && healthJson.status === 'ok') {
    console.log('[0/5] UptimeRobot /health check OK:', healthJson);
  } else {
    console.error('[FAIL] Health check failed:', healthRes.status, healthJson);
    process.exit(1);
  }

  // 1. Host Connects & Creates Room
  const hostSocket = io(SERVER_URL, { transports: ['websocket'] });
  await new Promise(r => hostSocket.on('connect', r));
  console.log('[1/5] Host connected:', hostSocket.id);

  const initialHostState = {
    roomCode: ROOM_CODE,
    gameMode: 'holdem',
    hostId: 'host_p1',
    myPlayerId: 'host_p1',
    maxSeats: 4,
    players: [
      {
        id: 'host_p1',
        name: 'Alice Host',
        avatar: '01',
        chips: 2500,
        cards: [
          { uid: 'h1', rank: 'A', suit: 'S' },
          { uid: 'h2', rank: 'K', suit: 'H' }
        ],
        pokerFolded: false,
        isBot: false
      }
    ],
    holdem: {
      phase: 'flop',
      community: [
        { uid: 'c1', rank: '10', suit: 'D' },
        { uid: 'c2', rank: 'J', suit: 'C' },
        { uid: 'c3', rank: 'Q', suit: 'S' }
      ],
      pot: 300,
      currentBet: 50,
      turnSeat: 1
    }
  };

  await new Promise(resolve => {
    hostSocket.emit('create_room', { roomCode: ROOM_CODE, state: initialHostState }, resolve);
  });
  console.log('[1/5] Host created room:', ROOM_CODE);

  // 2. Guest Connects and Joins
  const guestSocket = io(SERVER_URL, { transports: ['websocket'] });
  await new Promise(r => guestSocket.on('connect', r));
  console.log('[2/5] Guest connected:', guestSocket.id);

  const guestPlayer = {
    id: 'guest_p2',
    name: 'Bob Guest',
    avatar: '02',
    chips: 2450,
    cards: [
      { uid: 'g1', rank: '9', suit: 'H' },
      { uid: 'g2', rank: '8', suit: 'D' }
    ],
    pokerFolded: false,
    isBot: false
  };

  const joinAck = await new Promise(resolve => {
    guestSocket.emit('join_room', { roomCode: ROOM_CODE, player: guestPlayer }, resolve);
  });
  console.log('[2/5] Guest join acknowledged, ok:', joinAck.ok);

  // Host updates full state with guest
  initialHostState.players.push(guestPlayer);

  // Wait for guest to receive masked room_sync
  const guestStatePromise = new Promise(resolve => {
    guestSocket.on('room_sync', data => {
      if (data.state.players.length === 2) {
        resolve(data.state);
      }
    });
  });

  hostSocket.emit('sync_state', { roomCode: ROOM_CODE, state: initialHostState });
  const guestReceivedState = await guestStatePromise;

  // 3. Verify Anti-Cheat Card Masking (Tier 1.1)
  console.log('\n--- Checking Anti-Cheat Card Masking ---');
  const guestViewOfHost = guestReceivedState.players.find(p => p.id === 'host_p1');
  const guestViewOfSelf = guestReceivedState.players.find(p => p.id === 'guest_p2');

  console.log('Guest view of Host cards:', guestViewOfHost.cards);
  console.log('Guest view of Self cards:', guestViewOfSelf.cards);

  const isHostHidden = guestViewOfHost.cards.every(c => c.hidden === true && c.rank === undefined);
  const isSelfVisible = guestViewOfSelf.cards[0].rank === '9' && guestViewOfSelf.cards[1].rank === '8';

  if (isHostHidden && isSelfVisible) {
    console.log('[PASS] Anti-Cheat verified: Host hole cards masked over network, Guest cards preserved!');
  } else {
    console.error('[FAIL] Anti-Cheat card masking test failed!');
    process.exit(1);
  }

  // 4. Verify Host Authority Player Action Relay (Tier 1.2)
  console.log('\n--- Checking Host Authority Action Relay ---');
  const hostActionPromise = new Promise(resolve => {
    hostSocket.on('player_action', data => {
      resolve(data);
    });
  });

  guestSocket.emit('player_action', {
    roomCode: ROOM_CODE,
    action: 'poker_check_call',
    payload: { seatIdx: 1 }
  });

  const receivedAction = await hostActionPromise;
  if (receivedAction.action === 'poker_check_call' && receivedAction.payload.seatIdx === 1) {
    console.log('[PASS] Guest action routed to Host authority socket cleanly!');
  } else {
    console.error('[FAIL] Action relay failed:', receivedAction);
    process.exit(1);
  }

  // 5. Verify Table Chat & Banter (Tier 2.6)
  console.log('\n--- Checking Table Chat & Banter ---');
  const hostChatPromise = new Promise(resolve => {
    hostSocket.on('table_chat', data => {
      resolve(data);
    });
  });

  guestSocket.emit('table_chat', {
    roomCode: ROOM_CODE,
    senderName: 'Bob Guest',
    senderSeat: 1,
    message: 'All in!'
  });

  const receivedChat = await hostChatPromise;
  if (receivedChat.message === 'All in!' && receivedChat.senderSeat === 1) {
    console.log('[PASS] Table chat received across room members!');
  } else {
    console.error('[FAIL] Table chat failed:', receivedChat);
    process.exit(1);
  }

  // 6. Verify Spectator Mode (Tier 2.9)
  console.log('\n--- Checking Spectator Mode ---');
  const spectatorSocket = io(SERVER_URL, { transports: ['websocket'] });
  await new Promise(r => spectatorSocket.on('connect', r));

  const spectatorAck = await new Promise(resolve => {
    spectatorSocket.emit('join_room', {
      roomCode: ROOM_CODE,
      player: { id: 'spec_p3', name: 'Charlie Spectator', avatar: '03' },
      asSpectator: true
    }, resolve);
  });

  if (spectatorAck.ok && spectatorAck.isSpectator) {
    const specViewOfHost = spectatorAck.state.players.find(p => p.id === 'host_p1');
    const specViewOfGuest = spectatorAck.state.players.find(p => p.id === 'guest_p2');
    const allOpponentsMasked =
      specViewOfHost.cards.every(c => c.hidden === true) &&
      specViewOfGuest.cards.every(c => c.hidden === true);
    if (allOpponentsMasked) {
      console.log('[PASS] Spectator mode verified: Joined as spectator with all active hole cards hidden!');
    } else {
      console.error('[FAIL] Spectator card masking failed!');
      process.exit(1);
    }
  } else {
    console.error('[FAIL] Spectator join failed:', spectatorAck);
    process.exit(1);
  }

  // 7. Verify Mobile Reconnection Grace Window (Tier 1.3)
  console.log('\n--- Checking Mobile Reconnection Grace Window ---');
  guestSocket.disconnect();
  console.log('Guest disconnected. Emulating mobile network sleep for 1.2s...');
  await new Promise(r => setTimeout(r, 1200));

  const reconnSocket = io(SERVER_URL, { transports: ['websocket'] });
  await new Promise(r => reconnSocket.on('connect', r));

  const reconnRes = await new Promise(resolve => {
    reconnSocket.emit('reconnect_session', { roomCode: ROOM_CODE, playerId: 'guest_p2' }, resolve);
  });

  if (reconnRes.ok && reconnRes.state) {
    console.log('[PASS] Reconnected successfully within 45s grace window! State recovered.');
  } else {
    console.error('[FAIL] Reconnection failed:', reconnRes);
    process.exit(1);
  }

  hostSocket.disconnect();
  spectatorSocket.disconnect();
  reconnSocket.disconnect();
  console.log('\n======================================================');
  console.log('>>> ALL TIER 1 & TIER 2 FEATURES FULLY VERIFIED! <<<');
  console.log('======================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
