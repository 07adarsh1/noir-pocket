const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('    function canRebuy(player)');
const end = html.indexOf('    function executeTableAction(', start);
assert(start >= 0 && end > start);
const context = {
  STARTING_CHIPS: 5000,
  state: { inWaitingRoom: false, gameMode: 'blackjack', bj: { phase: 'playing' }, holdem: { phase: 'preflop' }, bluff: { phase: 'playing' }, players: [{ id: 'guest', name: 'Guest', chips: 0, isBot: false }, { id: 'host', name: 'Host', chips: 10, isBot: false }] },
  recordMove() {}, broadcastRoomState() { context.broadcasts++; }, renderAll() {}, broadcasts: 0
};
vm.createContext(context); vm.runInContext(html.slice(start, end), context);
assert.equal(vm.runInContext("rebuyChips('guest')", context), false, 'cannot rebuy during an active hand');
assert.equal(context.state.players[0].chips, 0);
context.state.bj.phase = 'betting';
assert.equal(vm.runInContext("rebuyChips('guest')", context), true);
assert.equal(context.state.players[0].chips, 5000);
assert.equal(context.broadcasts, 1, 'host must broadcast the rebuy');
assert.equal(vm.runInContext("rebuyChips('guest')", context), false, 'cannot repeatedly rebuy');
assert.equal(vm.runInContext("rebuyChips('host')", context), false, 'players with chips cannot rebuy');
context.state.players[0].chips = 0; context.state.gameMode = 'holdem';
assert.equal(vm.runInContext("rebuyChips('guest')", context), false);
context.state.holdem.phase = 'showdown';
assert.equal(vm.runInContext("rebuyChips('guest')", context), true);
assert.equal(context.state.players[0].chips, 5000);
console.log('Rebuy eligibility and synchronized host update checks passed');
const startBlackjack = html.indexOf('    function dealBlackjackRound()');
const endBlackjack = html.indexOf('    function advanceBlackjackTurn()', startBlackjack);
const startPoker = html.indexOf('    function startHoldemHand()');
const endPoker = html.indexOf('    function checkHoldemProgression()', startPoker);
assert(startBlackjack >= 0 && endBlackjack > startBlackjack && startPoker >= 0 && endPoker > startPoker);
Object.assign(context, {
  window: {}, clearGameTimeout() {}, resetAnimationTracking() {},
  buildDeck() { return Array.from({ length: 52 }, (_, i) => ({ uid: String(i), rank: '2' })); },
  popCardFromDeck(deck) { return deck.pop(); }, beginHandResults() {},
  triggerSyncedFx() {}, advanceBlackjackTurn() {}, checkHoldemProgression() {},
  calcBlackjackScore() { return { total: 4 }; }, showToast() {},
});
context.state = { activeSeatIndex: 0, players: [{ id: 'a', chips: 0, bjBet: 100 }, { id: 'b', chips: 50, bjBet: 100 }], bj: { deck: [] } };
vm.runInContext(html.slice(startBlackjack, endBlackjack), context);
vm.runInContext('dealBlackjackRound()', context);
assert.equal(context.state.players[0].bjStatus, 'OUT');
assert.equal(context.state.players[0].cards.length, 0);
assert.equal(context.state.players[1].chips, 0);
context.state = { players: [{ id: 'a', chips: 0 }, { id: 'b', chips: 25 }, { id: 'c', chips: 50 }], holdem: { dealerIdx: 0, smallBlind: 25, bigBlind: 50 } };
vm.runInContext(html.slice(startPoker, endPoker), context);
vm.runInContext('startHoldemHand()', context, { timeout: 1000 });
assert.equal(context.state.players[0].pokerFolded, true);
assert.equal(context.state.players[0].cards.length, 0);
assert.equal(context.state.holdem.pot, 75);
console.log('Broke seats and all-in blinds handled correctly');
