'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { newGame, applyMove } = require('./game');

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function createServer() {
  // rooms: code -> { code, players: { X: socket, O: socket | null }, game }
  const rooms = new Map();

  // ---- 1. A tiny static file server, so one process serves both the page and the WebSocket ----
  const server = http.createServer((req, res) => {
    let urlPath;
    try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end('Bad request'); }
    if (urlPath === '/') urlPath = '/index.html';
    const file = path.join(PUBLIC, urlPath);
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }   // block ../ path tricks
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });

  // ---- 2. The WebSocket server. maxPayload rejects oversized messages ----
  const wss = new WebSocketServer({ server, maxPayload: 1024 });

  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  function makeCode() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';       // no I or O, so codes are easy to read aloud
    let code;
    do { code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join(''); } while (rooms.has(code));
    return code;
  }

  // Send each player the full, current state. The server is the single source of truth.
  function broadcast(room) {
    const g = room.game;
    const snapshot = {
      type: 'state', code: room.code, board: g.board, turn: g.turn,
      status: room.players.O ? g.status : 'waiting',
      winner: g.winner, line: g.line, players: { X: !!room.players.X, O: !!room.players.O },
    };
    for (const symbol of ['X', 'O']) if (room.players[symbol]) send(room.players[symbol], { ...snapshot, you: symbol });
  }

  function leave(ws) {
    const room = ws.room;
    if (!room) return;
    rooms.delete(room.code);                          // this version ends the room when anyone leaves
    for (const symbol of ['X', 'O']) {
      const other = room.players[symbol];
      if (other && other !== ws) { send(other, { type: 'opponent_left' }); other.room = null; other.symbol = null; }
    }
    ws.room = null; ws.symbol = null;
  }

  // ---- 3. Handle messages from clients. Never trust them: validate everything ----
  function handle(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'error', message: 'Invalid message.' }); }
    if (!msg || typeof msg.type !== 'string') return send(ws, { type: 'error', message: 'Invalid message.' });

    switch (msg.type) {
      case 'create': {
        if (ws.room) return send(ws, { type: 'error', message: 'You are already in a game.' });
        const room = { code: makeCode(), players: { X: ws, O: null }, game: newGame() };
        rooms.set(room.code, room); ws.room = room; ws.symbol = 'X';
        broadcast(room);
        break;
      }
      case 'join': {
        if (ws.room) return send(ws, { type: 'error', message: 'You are already in a game.' });
        const code = String(msg.code || '').trim().toUpperCase().slice(0, 4);
        const room = rooms.get(code);
        if (!room) return send(ws, { type: 'error', message: 'Room not found. Check the code.' });
        if (room.players.O) return send(ws, { type: 'error', message: 'That room is already full.' });
        room.players.O = ws; ws.room = room; ws.symbol = 'O';
        broadcast(room);
        break;
      }
      case 'move': {
        const room = ws.room;
        if (!room) return send(ws, { type: 'error', message: 'Join a game first.' });
        if (!room.players.O) return send(ws, { type: 'error', message: 'Waiting for an opponent.' });
        const result = applyMove(room.game, ws.symbol, msg.cell);     // the rules live in game.js
        if (!result.ok) return send(ws, { type: 'error', message: result.error });
        broadcast(room);
        break;
      }
      case 'leave': leave(ws); break;
      default: send(ws, { type: 'error', message: 'Unknown message type.' });
    }
  }

  wss.on('connection', ws => {
    ws.isAlive = true; ws.room = null; ws.symbol = null;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', raw => handle(ws, raw));
    ws.on('close', () => leave(ws));
    ws.on('error', () => {});
  });

  // Heartbeat: ping everyone every 30s and drop connections that stop answering (closed laptops, dead Wi-Fi).
  const beat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
  }, 30000);
  server.on('close', () => clearInterval(beat));

  server.rooms = rooms;   // exposed for tests
  return server;
}

module.exports = { createServer };

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  createServer().listen(PORT, () => console.log('Tic-Tac-Toe server running at http://localhost:' + PORT));
}
