const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('    // Game delays retain their remaining time');
const end = html.indexOf('    // =========================================================================\n    // TIER 1: HOST AUTHORITY ACTION DISPATCHER', start);
assert(start >= 0 && end > start);
let now = 0, nextId = 0;
const pending = new Map();
const context = { Date: { now: () => now }, setTimeout(fn, delay) { const id = ++nextId; pending.set(id, { fn, due: now + delay }); return id; }, clearTimeout(id) { pending.delete(id); } };
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);
function advance(ms) { now += ms; for (const [id, timer] of [...pending]) if (timer.due <= now) { pending.delete(id); timer.fn(); } }
vm.runInContext('var fired = 0; setGameTimeout(() => fired++, 1000);', context);
advance(400); vm.runInContext('pauseGameClock()', context); advance(5000);
assert.equal(context.fired, 0);
vm.runInContext('resumeGameClock()', context); advance(599); assert.equal(context.fired, 0); advance(1); assert.equal(context.fired, 1);
vm.runInContext('pauseGameClock(); var cancelled = setGameTimeout(() => fired++, 10); clearGameTimeout(cancelled); resumeGameClock()', context);
advance(20); assert.equal(context.fired, 1);
const resultsStart = html.indexOf('    function beginHandResults()');
const resultsEnd = html.indexOf('    function renderHandResult()', resultsStart);
assert(resultsStart >= 0 && resultsEnd > resultsStart);
context.state = { players: [{ id: 'a', name: 'A', chips: 1000 }, { id: 'b', name: 'B', chips: 1000 }] };
vm.runInContext(html.slice(resultsStart, resultsEnd), context);
vm.runInContext("beginHandResults(); state.players[0].chips += 100; state.players[1].chips -= 100; finishHandResults('Winner');", context);
assert.equal(context.state.handResult.players[0].change, 100);
assert.equal(context.state.handResult.players[1].change, -100);
console.log('Pausable game clock and hand result checks passed');

