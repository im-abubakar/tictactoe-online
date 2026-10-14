'use strict';
// Automated tests: starts the real server on a random port and plays simulated games over real WebSockets.
const assert = require('assert');
const WebSocket = require('ws');
const { createServer } = require('./server');
const { newGame, applyMove } = require('./game');

let passed = 0;
const ok = name => { passed++; console.log('  ✓ ' + name); };

// ---- helpers ----
function client(port) {
  const ws = new WebSocket('ws://localhost:' + port);
  ws.inbox = [];
  ws.on('message', d => { ws.inbox.push(JSON.parse(d)); if (ws.waiter) ws.waiter(); });
  ws.opened = new Promise(r => ws.on('open', r));
  return ws;
}
// Wait for the next message that matches a predicate (scanning anything already received first).
function next(ws, pred = () => true, ms = 1500) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timed out waiting for a message')), ms);
    const check = () => {
      const i = ws.inbox.findIndex(pred);
      if (i >= 0) { clearTimeout(t); ws.waiter = null; return resolve(ws.inbox.splice(i, 1)[0]); }
      ws.waiter = check;
    };
    check();
  });
}
const send = (ws, m) => ws.send(JSON.stringify(m));
const isState = m => m.type === 'state';
const isError = m => m.type === 'error';

// ---- 1. Pure game rules ----
function testRules() {
  console.log('Game rules');
  let g = newGame();
  assert.strictEqual(applyMove(g, 'O', 0).ok, false); ok('O cannot move first');
  assert.strictEqual(applyMove(g, 'X', 0).ok, true);
  assert.strictEqual(applyMove(g, 'O', 0).ok, false); ok('cannot play on a taken cell');
  assert.strictEqual(applyMove(g, 'O', 9).ok, false);
  assert.strictEqual(applyMove(g, 'O', '3').ok, false);
  assert.strictEqual(applyMove(g, 'O', 1.5).ok, false); ok('rejects out-of-range and non-integer cells');
  g = newGame(); [[ 'X', 0 ], [ 'O', 3 ], [ 'X', 1 ], [ 'O', 4 ], [ 'X', 2 ]].forEach(([p, c]) => applyMove(g, p, c));
  assert.strictEqual(g.status, 'won'); assert.strictEqual(g.winner, 'X'); assert.deepStrictEqual(g.line, [0, 1, 2]);
  assert.strictEqual(applyMove(g, 'O', 5).ok, false); ok('detects a win and then locks the board');
  g = newGame(); [0, 1, 2, 4, 3, 5, 7, 6, 8].forEach((c, i) => applyMove(g, i % 2 ? 'O' : 'X', c));
  assert.strictEqual(g.status, 'draw'); ok('detects a draw');
  g = newGame(); [[ 'X', 2 ], [ 'O', 0 ], [ 'X', 4 ], [ 'O', 1 ], [ 'X', 6 ]].forEach(([p, c]) => applyMove(g, p, c));
  assert.deepStrictEqual(g.line, [2, 4, 6]); ok('detects diagonal wins');
}

// ---- 2. Over the network ----
async function testNetwork() {
  const server = createServer();
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  console.log('Room setup');
  const a = client(port), b = client(port); await Promise.all([a.opened, b.opened]);
  send(a, { type: 'create' });
  let s = await next(a, isState);
  assert.strictEqual(s.you, 'X'); assert.strictEqual(s.status, 'waiting'); assert.match(s.code, /^[A-Z]{4}$/); ok('create gives X a 4-letter code and a waiting state');
  const code = s.code;

  send(b, { type: 'join', code: 'ZZZZ' });
  assert.match((await next(b, isError)).message, /not found/i); ok('joining an unknown room fails');

  send(b, { type: 'join', code: code.toLowerCase() });
  const sb = await next(b, isState), sa = await next(a, isState);
  assert.strictEqual(sb.you, 'O'); assert.strictEqual(sa.status, 'playing'); ok('join (case-insensitive) starts the game for both players');

  const c = client(port); await c.opened;
  send(c, { type: 'join', code });
  assert.match((await next(c, isError)).message, /full/i); ok('a third player is rejected');

  console.log('Move validation (done on the server)');
  send(b, { type: 'move', cell: 0 });
  assert.match((await next(b, isError)).message, /not your turn/i); ok("O cannot move on X's turn");
  send(a, { type: 'move', cell: 4 });
  s = await next(a, isState); await next(b, isState);
  assert.strictEqual(s.board[4], 'X'); assert.strictEqual(s.turn, 'O'); ok('a valid move is applied and broadcast to both');
  send(b, { type: 'move', cell: 4 });
  assert.match((await next(b, isError)).message, /taken/i); ok('a taken cell is rejected');
  send(a, { type: 'move', cell: 99 }); send(a, { type: 'move', cell: 'DROP TABLE' });
  await next(a, isError); await next(a, isError); ok('garbage input is rejected without crashing the server');
  a.send('this is not json'); assert.match((await next(a, isError)).message, /invalid/i); ok('malformed JSON is handled');

  console.log('A full game');
  for (const [, ws, cell] of [['O', b, 0], ['X', a, 1], ['O', b, 3], ['X', a, 7]]) { send(ws, { type: 'move', cell }); await next(a, isState); await next(b, isState); }
  const finalGame = server.rooms.get(code).game;
  assert.strictEqual(finalGame.status, 'won'); assert.strictEqual(finalGame.winner, 'X'); ok('X wins with a column and the room records it');
  send(b, { type: 'move', cell: 8 });
  assert.match((await next(b, isError)).message, /over/i); ok('no moves are accepted after the game ends');

  send(a, { type: 'noop' });
  assert.match((await next(a, isError)).message, /unknown/i); ok('unknown message types are rejected');

  console.log('Disconnects');
  b.close();
  await next(a, m => m.type === 'opponent_left');
  assert.strictEqual(server.rooms.size, 0); ok('opponent leaving notifies the other player and cleans up the room');

  send(a, { type: 'create' }); const again = await next(a, isState);
  assert.strictEqual(again.status, 'waiting'); ok('the remaining player can start a new game');
  a.close(); c.close();
  await new Promise(r => setTimeout(r, 100));
  assert.strictEqual(server.rooms.size, 0); ok('rooms are removed when everyone disconnects');

  console.log('Static files');
  const http = require('http');
  const get = p => new Promise(r => http.get({ port, path: p }, res => { let d = ''; res.on('data', x => d += x); res.on('end', () => r({ code: res.statusCode, body: d })); }));
  assert.strictEqual((await get('/')).code, 200); assert.match((await get('/')).body, /Tic-Tac-Toe Online/); ok('serves the game page');
  assert.strictEqual((await get('/nope.html')).code, 404); ok('unknown files return 404');
  const traversal = await new Promise(r => { const q = require('net').connect(port, 'localhost', () => q.write('GET /../server.js HTTP/1.1\r\nHost: x\r\n\r\n')); let d = ''; q.on('data', x => d += x); q.on('end', () => r(d)); setTimeout(() => { q.destroy(); r(d); }, 300); });
  assert.ok(!traversal.includes('createServer'), 'path traversal must not leak source files'); ok('path traversal (/../server.js) does not leak source code');

  server.close(); process.exit(0);
}

testRules();
testNetwork().then(() => {}, err => { console.error('\nFAILED:', err.message); process.exit(1); });
process.on('exit', code => { if (code === 0) console.log('\nAll ' + passed + ' checks passed.'); });
