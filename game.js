'use strict';
// Pure game rules. No networking in here, so it is easy to test and reuse.

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],   // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8],   // columns
  [0, 4, 8], [2, 4, 6],              // diagonals
];

function newGame() {
  return { board: Array(9).fill(null), turn: 'X', status: 'playing', winner: null, line: null };
}

// Returns { winner, line } for a win, { draw: true } for a full board, or null if the game goes on.
function getResult(board) {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], line: [a, b, c] };
  }
  return board.every(Boolean) ? { draw: true } : null;
}

// Validates and applies a move. The SERVER calls this; a client can never skip these checks.
function applyMove(game, player, cell) {
  if (game.status !== 'playing') return { ok: false, error: 'The game is over.' };
  if (player !== game.turn) return { ok: false, error: "It's not your turn." };
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return { ok: false, error: 'Invalid cell.' };
  if (game.board[cell]) return { ok: false, error: 'That cell is already taken.' };

  game.board[cell] = player;
  const result = getResult(game.board);
  if (result && result.winner) { game.status = 'won'; game.winner = result.winner; game.line = result.line; }
  else if (result && result.draw) game.status = 'draw';
  else game.turn = player === 'X' ? 'O' : 'X';
  return { ok: true };
}

module.exports = { newGame, applyMove, getResult, LINES };
