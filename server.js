const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 5;

const rooms = new Map();

app.get("/", (req, res) => {
  res.send("SHUTTER & CAGE multiplayer server is running.");
});

function makeRoomCode() {
  let code;

  do {
    code = crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase();
  } while (rooms.has(code));

  return code;
}

function makePlayerId() {
  return crypto.randomUUID();
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data) {
  for (const player of room.players.values()) {
    send(player.ws, data);
  }
}

function getPublicPlayers(room) {
  return [...room.players.values()].map((player) => ({
    id: player.id,
    name: player.name,
    role: player.role,
    ready: player.ready,
    x: player.x,
    y: player.y,
    z: player.z,
    yaw: player.yaw,
    pitch: player.pitch,
    floor: player.floor,
    alive: player.alive
  }));
}

function sendRoomState(room) {
  broadcast(room, {
    type: "roomState",
    roomCode: room.code,
    hostId: room.hostId,
    started: room.started,
    players: getPublicPlayers(room)
  });
}

function assignRoles(room) {
  const players = [...room.players.values()];

  if (players.length === 0) {
    return;
  }

  for (const player of players) {
    player.role = "human";
  }

  const killer =
    players[Math.floor(Math.random() * players.length)];

  killer.role = "killer";
}

function removePlayer(ws) {
  if (!ws.playerId || !ws.roomCode) {
    return;
  }

  const room = rooms.get(ws.roomCode);

  if (!room) {
    return;
  }

  room.players.delete(ws.playerId);

  if (room.hostId === ws.playerId) {
    const nextPlayer = room.players.values().next().value;
    room.hostId = nextPlayer ? nextPlayer.id : null;
  }

  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }

  sendRoomState(room);
}

wss.on("connection", (ws) => {
  ws.playerId = null;
  ws.roomCode = null;

  send(ws, {
    type: "connected",
    message: "Connected to SHUTTER & CAGE server."
  });

  ws.on("message", (raw) => {
    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch {
      send(ws, {
        type: "error",
        message: "Invalid message."
      });
      return;
    }

    if (data.type === "createRoom") {
      if (ws.roomCode) {
        send(ws, {
          type: "error",
          message: "You are already in a room."
        });
        return;
      }

      const roomCode = makeRoomCode();
      const playerId = makePlayerId();

      const room = {
        code: roomCode,
        hostId: playerId,
        started: false,
        players: new Map()
      };

      const player = {
        id: playerId,
        ws,
        name: String(data.name || "Player").slice(0, 16),
        role: "human",
        ready: false,
        x: 0,
        y: 1.7,
        z: 0,
        yaw: 0,
        pitch: 0,
        floor: 1,
        alive: true
      };

      room.players.set(playerId, player);
      rooms.set(roomCode, room);

      ws.playerId = playerId;
      ws.roomCode = roomCode;

      assignRoles(room);

      send(ws, {
        type: "roomCreated",
        roomCode,
        playerId,
        role: player.role
      });

      sendRoomState(room);
      return;
    }

    if (data.type === "joinRoom") {
      if (ws.roomCode) {
        send(ws, {
          type: "error",
          message: "You are already in a room."
        });
        return;
      }

      const roomCode = String(data.roomCode || "").toUpperCase();
      const room = rooms.get(roomCode);

      if (!room) {
        send(ws, {
          type: "error",
          message: "Room not found."
        });
        return;
      }

      if (room.started) {
        send(ws, {
          type: "error",
          message: "The game has already started."
        });
        return;
      }

      if (room.players.size >= MAX_PLAYERS) {
        send(ws, {
          type: "error",
          message: "Room is full."
        });
        return;
      }

      const playerId = makePlayerId();

      const player = {
        id: playerId,
        ws,
        name: String(data.name || "Player").slice(0, 16),
        role: "human",
        ready: false,
        x: 0,
        y: 1.7,
        z: 0,
        yaw: 0,
        pitch: 0,
        floor: 1,
        alive: true
      };

      room.players.set(playerId, player);

      ws.playerId = playerId;
      ws.roomCode = roomCode;

      assignRoles(room);

      send(ws, {
        type: "roomJoined",
        roomCode,
        playerId,
        role: player.role
      });

      sendRoomState(room);
      return;
    }

    if (data.type === "ready") {
      const room = rooms.get(ws.roomCode);
      const player = room?.players.get(ws.playerId);

      if (!room || !player) {
        return;
      }

      player.ready = Boolean(data.ready);
      sendRoomState(room);
      return;
    }

    if (data.type === "startGame") {
      const room = rooms.get(ws.roomCode);
      const player = room?.players.get(ws.playerId);

      if (!room || !player) {
        return;
      }

      if (room.hostId !== player.id) {
        send(ws, {
          type: "error",
          message: "Only the host can start the game."
        });
        return;
      }

      if (room.players.size < 2) {
        send(ws, {
          type: "error",
          message: "At least 2 players are required."
        });
        return;
      }

      room.started = true;

      for (const roomPlayer of room.players.values()) {
        roomPlayer.alive = true;
      }

      broadcast(room, {
        type: "gameStarted",
        players: getPublicPlayers(room)
      });

      return;
    }

    if (data.type === "state") {
      const room = rooms.get(ws.roomCode);
      const player = room?.players.get(ws.playerId);

      if (!room || !player || !room.started) {
        return;
      }

      if (typeof data.x === "number") player.x = data.x;
      if (typeof data.y === "number") player.y = data.y;
      if (typeof data.z === "number") player.z = data.z;
      if (typeof data.yaw === "number") player.yaw = data.yaw;
      if (typeof data.pitch === "number") player.pitch = data.pitch;
      if (typeof data.floor === "number") player.floor = data.floor;

      broadcast(room, {
        type: "playerState",
        player: {
          id: player.id,
          x: player.x,
          y: player.y,
          z: player.z,
          yaw: player.yaw,
          pitch: player.pitch,
          floor: player.floor,
          alive: player.alive
        }
      });

      return;
    }

    if (data.type === "leaveRoom") {
      removePlayer(ws);
      ws.playerId = null;
      ws.roomCode = null;
      return;
    }
  });

  ws.on("close", () => {
    removePlayer(ws);
  });
});

server.listen(PORT, () => {
  console.log(`SHUTTER & CAGE server running on port ${PORT}`);
});