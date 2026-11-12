const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('    function evaluate7CardPoker('), end = html.indexOf('    function startHoldemHand()', start);
assert(start >= 0 && end > start);
const context = { RANK_VALUE: { '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, '10':10, J:11, Q:12, K:13, A:14 } };
vm.createContext(context); vm.runInContext(html.slice(start,end), context);
const cards = text => text.split(' ').map(x => ({ rank: x.slice(0,-1), suit: x.slice(-1) }));
const rank = text => context.evaluate7CardPoker(cards(text));
assert(rank('AS AD KC QH 9S 4C 2D').score > rank('AH AC KD JH 9C 4D 2S').score, 'pair kickers break ties');
assert(rank('AS KS 9S 5S 3S 2H 4D').score > rank('AH KH 8H 5H 3H 2S 4C').score, 'flush kickers break ties');
assert.equal(rank('AS 2D 3C 4H 5S 9D 10C').label, 'Straight');
assert(rank('AS 2D 3C 4H 5S 9D 10C').score < rank('2S 3D 4C 5H 6S 9D 10C').score, 'wheel is five high');
assert.equal(rank('AS AD AC KS KD KC 2S').label, 'Full House');
assert.equal(rank('10S JS QS KS AS 2D 3C').label, 'Royal Flush');
const board = cards('2C 3D 7H 9S JC');
const players = [
  { id:'a', cards:cards('AS AD'), pokerCommitted:100, pokerFolded:false },
  { id:'b', cards:cards('KS KD'), pokerCommitted:300, pokerFolded:false },
  { id:'c', cards:cards('QS QD'), pokerCommitted:300, pokerFolded:false }
];
let result = context.calculateHoldemPayouts(players, board, 0);
assert.deepEqual(Array.from(result.payouts), [300,400,0], 'short stack wins main pot and next hand wins side pot');
players[2].pokerFolded = true;
result = context.calculateHoldemPayouts(players, board, 0);
assert.deepEqual(Array.from(result.payouts), [300,400,0], 'folded contribution stays in pots');
players[1].pokerCommitted = 400; players[2].pokerCommitted = 300;
result = context.calculateHoldemPayouts(players, board, 0);
assert.deepEqual(Array.from(result.payouts), [300,500,0], 'uncalled excess returned');
const splitBoard = cards('AS KS QS JS 10S');
const split = [ {cards:cards('2C 3C'),pokerCommitted:5}, {cards:cards('4C 5C'),pokerCommitted:5}, {cards:cards('6C 7C'),pokerCommitted:5,pokerFolded:true} ];
result = context.calculateHoldemPayouts(split, splitBoard, 0);
assert.deepEqual(Array.from(result.payouts), [7,8,0], 'odd chip goes to first winner clockwise from dealer');
assert.equal(result.payouts.reduce((a,b)=>a+b,0),15);
console.log('Holdem ranking, side-pot, tie and chip conservation checks passed');
const startShowdown = html.indexOf('    function resolveHoldemShowdown()');
const endShowdown = html.indexOf('    function pokerActionFold(', startShowdown);
assert(startShowdown >= 0 && endShowdown > startShowdown);
Object.assign(context, { clearTurnCountdown() {}, triggerSyncedFx() {}, finishHandResults(text) { context.resultText = text; }, broadcastRoomState() { context.broadcasts++; }, renderAll() {}, broadcasts:0 });
context.state = { players: [
  { id:'a', name:'Alice', cards:cards('AS AD'), chips:0, pokerCommitted:100, pokerFolded:false },
  { id:'b', name:'Bob', cards:cards('KS KD'), chips:0, pokerCommitted:300, pokerFolded:false },
  { id:'c', name:'Cara', cards:cards('QS QD'), chips:0, pokerCommitted:300, pokerFolded:false }
], holdem:{ pot:700, community:board, dealerIdx:0, phase:'river' } };
vm.runInContext(html.slice(startShowdown, endShowdown), context);
vm.runInContext('resolveHoldemShowdown()', context);
assert.deepEqual(Array.from(context.state.players, p => p.chips), [300,400,0]);
assert.match(context.resultText, /Main pot Alice, One Pair/);
assert.match(context.resultText, /Side pot Bob, One Pair/);
assert.equal(context.broadcasts, 1);
console.log('Showdown settles and broadcasts main and side pots');
const guide = (hole, board, folded = false) => context.describeHoldemHand(cards(hole), board ? cards(board) : [], folded);
assert.equal(guide('AS KH', '').label, 'Ace-high starting hand');
assert.equal(guide('AS AH', '').level, 2);
assert.equal(guide('AS AH', '').category, 'One Pair');
assert.match(guide('AH KH', 'QH 3H 9C').draw, /Flush draw/);
assert.match(guide('8S 9H', '10C JS 2D').draw, /Straight draw/);
assert.equal(guide('AH KH', 'QH 3H 9C 2D 7S').draw, '', 'no draws when there are no cards left to come');
assert.equal(guide('AS KH', '', true).level, 0, 'folded hand is not rated');
assert.equal(context.describeHoldemHand([{ rank:'A', suit:'S', hidden:true }], []).level, 0);
console.log('Hand guide, draw and folded-hand checks passed');
const rankings = html.slice(html.indexOf('<div id="holdemRankingsPanel"'), html.indexOf('<!-- GAME CONTROLS 1:'));
const rows = [...rankings.matchAll(/<li data-hand-rank="([^"]+)">([\s\S]*?)<\/li>/g)];
assert.equal(rows.length, 10, 'all ten ranking examples are present');
for (const [, name, row] of rows) assert.equal((row.match(/class="ranking-card(?: red)?"/g) || []).length, 5, `${name} has five example cards`);
assert.match(rankings, /not your chance of winning/);
console.log('Ranking examples each contain five cards');
