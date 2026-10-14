# Tic-Tac-Toe Online

A two-player Tic-Tac-Toe game over WebSockets. The server owns the game; browsers only send intentions and draw what the server says.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000 in two browser tabs (or two devices on the same Wi-Fi, using your computer's IP address).
Click **Create a game** in one, then enter the 4-letter code in the other, or open the invite link.

## Run the tests

```bash
npm test
```

## How it works

| File | Job |
|---|---|
| `game.js` | Pure rules: validate a move, detect win/draw. No networking. |
| `server.js` | HTTP static files + WebSocket rooms. Validates every message. |
| `public/index.html` | The browser client. Sends `create`, `join`, `move`, `leave`; renders `state`. |
| `test.js` | Plays simulated games over real WebSockets. |

### Messages

Client to server: `{type:"create"}`, `{type:"join", code}`, `{type:"move", cell}`, `{type:"leave"}`

Server to client: `{type:"state", code, you, board, turn, status, winner, line, players}`, `{type:"error", message}`, `{type:"opponent_left"}`
