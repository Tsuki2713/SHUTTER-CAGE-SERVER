const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

// ==============================
// SHUTTER & CAGE
// Multiplayer Server
// ==============================

const MAX_PLAYERS = 5;
const HUMAN_MAX = 4;

// ルーム一覧
const rooms = new Map();

// ==============================
// HTTPサーバー
// ==============================

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("SHUTTER & CAGE SERVER ONLINE");
});

// ==============================
// WebSocketサーバー
// ==============================

const wss = new WebSocket.Server({
  server: httpServer
});

// ==============================
// ルームコード生成
// ==============================

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code;

  do {
    code = "";

    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));

  return code;
}

// ==============================
// プレイヤーID生成
// ==============================

function generatePlayerId() {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).substring(2, 8)
  );
}

// ==============================
// ルーム内のプレイヤー一覧
// ==============================

function getPlayerList(room) {
  return room.players.map(player => ({
    id: player.id,
    name: player.name,
    role: player.role,
    ready: player.ready
  }));
}

// ==============================
// 送信
// ==============================

function send(ws, data) {
  if (!ws) return;

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ==============================
// ルーム全員に送信
// ==============================

function broadcast(room, data) {
  for (const player of room.players) {
    send(player.ws, data);
  }
}

// ==============================
// ロビー情報送信
// ==============================

function sendLobby(room) {
  broadcast(room, {
    type: "lobby",
    roomCode: room.code,
    players: getPlayerList(room),
    hostId: room.hostId,
    gameStarted: room.gameStarted
  });
}

// ==============================
// ゲーム状態送信
// ==============================

function sendGameState(room) {
  const players = room.players.map(player => ({
    id: player.id,
    name: player.name,
    role: player.role,
    floor: player.floor,
    x: player.x,
    y: player.y,
    z: player.z,
    rotationY: player.rotationY,
    alive: player.alive
  }));

  broadcast(room, {
    type: "game_state",
    players: players,
    trapParts: room.trapParts,
    trapPlaced: room.trapPlaced,
    trapPosition: room.trapPosition,
    gameTime: room.gameTime,
    gameEnded: room.gameEnded,
    winner: room.winner
  });
}

// ==============================
// ルーム作成
// ==============================

function createRoom(ws, name) {
  const code = generateRoomCode();
  const id = generatePlayerId();

  const player = {
    id: id,
    ws: ws,
    name: name || "Player",
    role: "human",
    ready: false,

    floor: 1,

    x: 0,
    y: 1.7,
    z: 0,

    rotationY: 0,

    alive: true
  };

  const room = {
    code: code,

    hostId: id,

    players: [player],

    gameStarted: false,

    gameEnded: false,

    winner: null,

    gameTime: 0,

    startTime: null,

    trapParts: {},

    trapPlaced: false,

    trapPosition: null
  };

  rooms.set(code, room);

  ws.playerId = id;
  ws.roomCode = code;

  send(ws, {
    type: "room_created",
    roomCode: code,
    playerId: id,
    role: "human"
  });

  sendLobby(room);

  console.log(
    `[CREATE] room=${code} player=${player.name}`
  );
}

// ==============================
// ルーム参加
// ==============================

function joinRoom(ws, code, name) {
  code = String(code || "").toUpperCase().trim();

  const room = rooms.get(code);

  if (!room) {
    send(ws, {
      type: "error",
      message: "ルームが見つかりません。"
    });

    return;
  }

  if (room.gameStarted) {
    send(ws, {
      type: "error",
      message: "このゲームはすでに開始されています。"
    });

    return;
  }

  if (room.players.length >= MAX_PLAYERS) {
    send(ws, {
      type: "error",
      message: "このルームは満員です。"
    });

    return;
  }

  const id = generatePlayerId();

  const player = {
    id: id,
    ws: ws,
    name: name || `Player${room.players.length + 1}`,
    role: "human",
    ready: false,

    floor: 1,

    x: 0,
    y: 1.7,
    z: 0,

    rotationY: 0,

    alive: true
  };

  room.players.push(player);

  ws.playerId = id;
  ws.roomCode = code;

  send(ws, {
    type: "room_joined",
    roomCode: code,
    playerId: id,
    role: "human"
  });

  sendLobby(room);

  console.log(
    `[JOIN] room=${code} player=${player.name}`
  );
}

// ==============================
// プレイヤー取得
// ==============================

function getPlayer(room, playerId) {
  return room.players.find(
    player => player.id === playerId
  );
}

// ==============================
// ゲーム開始
// ==============================

function startGame(room) {
  if (!room) return;

  if (room.gameStarted) {
    return;
  }

  if (room.players.length < 2) {
    broadcast(room, {
      type: "error",
      message: "ゲーム開始には2人以上必要です。"
    });

    return;
  }

  // 全員を一度人間に戻す
  for (const player of room.players) {
    player.role = "human";
    player.alive = true;
  }

  // ランダムに1人を鬼にする
  const killerIndex = Math.floor(
    Math.random() * room.players.length
  );

  room.players[killerIndex].role = "killer";

  room.gameStarted = true;
  room.gameEnded = false;
  room.winner = null;
  room.startTime = Date.now();
  room.gameTime = 0;

  room.trapParts = {};
  room.trapPlaced = false;
  room.trapPosition = null;

  // 初期位置
  for (const player of room.players) {
    player.floor = 1;
    player.x = 0;
    player.y = 1.7;
    player.z = 0;
    player.rotationY = 0;
  }

  broadcast(room, {
    type: "game_started",
    roomCode: room.code,
    players: getPlayerList(room)
  });

  sendGameState(room);

  console.log(
    `[START] room=${room.code} killer=${room.players[killerIndex].name}`
  );
}

// ==============================
// プレイヤー移動情報
// ==============================

function updatePlayer(room, player, data) {
  if (!room || !player) return;

  if (!room.gameStarted) {
    return;
  }

  if (room.gameEnded) {
    return;
  }

  if (!player.alive) {
    return;
  }

  if (typeof data.floor === "number") {
    player.floor = data.floor;
  }

  if (typeof data.x === "number") {
    player.x = data.x;
  }

  if (typeof data.y === "number") {
    player.y = data.y;
  }

  if (typeof data.z === "number") {
    player.z = data.z;
  }

  if (typeof data.rotationY === "number") {
    player.rotationY = data.rotationY;
  }
}

// ==============================
// 罠設置
// ==============================

function placeTrap(room, player, data) {
  if (!room || !player) return;

  if (player.role !== "human") {
    return;
  }

  if (!player.alive) {
    return;
  }

  if (room.trapPlaced) {
    return;
  }

  room.trapPlaced = true;

  room.trapPosition = {
    floor: player.floor,
    x: player.x,
    y: player.y,
    z: player.z
  };

  broadcast(room, {
    type: "trap_placed",
    playerId: player.id,
    position: room.trapPosition
  });

  console.log(
    `[TRAP] room=${room.code} player=${player.name}`
  );
}

// ==============================
// プレイヤー死亡
// ==============================

function killPlayer(room, player) {
  if (!player || !player.alive) {
    return;
  }

  player.alive = false;

  broadcast(room, {
    type: "player_killed",
    playerId: player.id
  });

  checkWinCondition(room);
}

// ==============================
// 勝敗判定
// ==============================

function checkWinCondition(room) {
  if (!room || !room.gameStarted) {
    return;
  }

  const humans = room.players.filter(
    player => player.role === "human"
  );

  const aliveHumans = humans.filter(
    player => player.alive
  );

  if (aliveHumans.length === 0) {
    endGame(room, "killer");
    return;
  }

  if (room.trapPlaced) {
    // 罠による勝利判定はクライアント側から通知可能
  }
}

// ==============================
// ゲーム終了
// ==============================

function endGame(room, winner) {
  if (!room || room.gameEnded) {
    return;
  }

  room.gameEnded = true;
  room.winner = winner;

  if (room.startTime) {
    room.gameTime =
      Math.floor((Date.now() - room.startTime) / 1000);
  }

  broadcast(room, {
    type: "game_over",
    winner: winner,
    gameTime: room.gameTime
  });

  console.log(
    `[END] room=${room.code} winner=${winner}`
  );
}// ==============================
// WebSocket接続
// ==============================

wss.on("connection", ws => {
  console.log("[CONNECT] new client");

  ws.playerId = null;
  ws.roomCode = null;

  // ============================
  // メッセージ受信
  // ============================

  ws.on("message", raw => {
    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch (error) {
      send(ws, {
        type: "error",
        message: "不正なデータです。"
      });

      return;
    }

    // ----------------------------
    // ルーム作成
    // ----------------------------

    if (data.type === "create_room") {
      createRoom(ws, data.name);
      return;
    }

    // ----------------------------
    // ルーム参加
    // ----------------------------

    if (data.type === "join_room") {
      joinRoom(
        ws,
        data.roomCode,
        data.name
      );

      return;
    }

    // ----------------------------
    // 自分のルーム
    // ----------------------------

    const room = rooms.get(ws.roomCode);

    if (!room) {
      send(ws, {
        type: "error",
        message: "ルームに参加していません。"
      });

      return;
    }

    const player = getPlayer(
      room,
      ws.playerId
    );

    if (!player) {
      send(ws, {
        type: "error",
        message: "プレイヤー情報が見つかりません。"
      });

      return;
    }

    // ----------------------------
    // ゲーム開始
    // ----------------------------

    if (data.type === "start_game") {
      if (room.hostId !== player.id) {
        send(ws, {
          type: "error",
          message: "ホストだけがゲームを開始できます。"
        });

        return;
      }

      startGame(room);
      return;
    }

    // ----------------------------
    // プレイヤー準備
    // ----------------------------

    if (data.type === "ready") {
      player.ready = !!data.ready;

      sendLobby(room);
      return;
    }

    // ----------------------------
    // プレイヤー移動
    // ----------------------------

    if (data.type === "player_update") {
      updatePlayer(
        room,
        player,
        data
      );

      return;
    }

    // ----------------------------
    // 罠設置
    // ----------------------------

    if (data.type === "place_trap") {
      placeTrap(
        room,
        player,
        data
      );

      return;
    }

    // ----------------------------
    // 人間プレイヤーを捕まえる
    // ----------------------------

    if (data.type === "kill_player") {
      if (player.role !== "killer") {
        return;
      }

      const target = getPlayer(
        room,
        data.targetId
      );

      if (!target) {
        return;
      }

      if (target.role !== "human") {
        return;
      }

      killPlayer(
        room,
        target
      );

      sendGameState(room);

      return;
    }

    // ----------------------------
    // 鬼が罠にかかった
    // ----------------------------

    if (data.type === "killer_trapped") {
      if (player.role !== "human") {
        return;
      }

      if (!room.trapPlaced) {
        return;
      }

      endGame(
        room,
        "humans"
      );

      return;
    }

    // ----------------------------
    // ゲーム状態要求
    // ----------------------------

    if (data.type === "request_state") {
      sendLobby(room);

      if (room.gameStarted) {
        sendGameState(room);
      }

      return;
    }
  });

  // ============================
  // 切断
  // ============================

  ws.on("close", () => {
    console.log(
      `[DISCONNECT] ${ws.playerId || "unknown"}`
    );

    const room = rooms.get(ws.roomCode);

    if (!room) {
      return;
    }

    const playerIndex =
      room.players.findIndex(
        player => player.id === ws.playerId
      );

    if (playerIndex === -1) {
      return;
    }

    const disconnected =
      room.players[playerIndex];

    room.players.splice(
      playerIndex,
      1
    );

    // --------------------------
    // 誰もいなくなったら
    // --------------------------

    if (room.players.length === 0) {
      rooms.delete(room.code);

      console.log(
        `[ROOM DELETE] ${room.code}`
      );

      return;
    }

    // --------------------------
    // ホストが抜けたら
    // 次のプレイヤーをホストにする
    // --------------------------

    if (room.hostId === disconnected.id) {
      room.hostId =
        room.players[0].id;
    }

    // --------------------------
    // ゲーム中に鬼が抜けた場合
    // --------------------------

    if (
      room.gameStarted &&
      disconnected.role === "killer" &&
      !room.gameEnded
    ) {
      endGame(
        room,
        "humans"
      );
    }

    // --------------------------
    // ゲーム中に人間が抜けた場合
    // --------------------------

    if (
      room.gameStarted &&
      disconnected.role === "human"
    ) {
      checkWinCondition(room);
    }

    sendLobby(room);

    if (room.gameStarted) {
      sendGameState(room);
    }
  });

  // ============================
  // エラー
  // ============================

  ws.on("error", error => {
    console.error(
      "[WEBSOCKET ERROR]",
      error
    );
  });
});

// ==============================
// ゲーム時間更新
// ==============================

setInterval(() => {
  for (const room of rooms.values()) {
    if (
      !room.gameStarted ||
      room.gameEnded ||
      !room.startTime
    ) {
      continue;
    }

    room.gameTime =
      Math.floor(
        (Date.now() - room.startTime) / 1000
      );

    // 定期的に状態を送信
    sendGameState(room);
  }
}, 1000);

// ==============================
// サーバー起動
// ==============================

httpServer.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "================================"
    );

    console.log(
      " SHUTTER & CAGE SERVER"
    );

    console.log(
      " Multiplayer Server ONLINE"
    );

    console.log(
      ` Port: ${PORT}`
    );

    console.log(
      "================================"
    );
  }
);