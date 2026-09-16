const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const MAX_PLAYERS = 5;

// ルーム
const rooms = new Map();

// ========================================
// HTTP
// ========================================

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("SHUTTER & CAGE SERVER ONLINE");
});

// ========================================
// WebSocket
// ========================================

const wss = new WebSocket.Server({
  server
});

// ========================================
// ルームコード
// ========================================

function makeRoomCode() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code;

  do {
    code = "";

    for (let i = 0; i < 6; i++) {
      code += chars[
        Math.floor(Math.random() * chars.length)
      ];
    }

  } while (rooms.has(code));

  return code;
}

// ========================================
// プレイヤーID
// ========================================

function makePlayerId() {
  return (
    Date.now().toString(36) +
    Math.random()
      .toString(36)
      .substring(2, 9)
  );
}

// ========================================
// 送信
// ========================================

function send(ws, data) {

  if (
    ws &&
    ws.readyState === WebSocket.OPEN
  ) {
    ws.send(
      JSON.stringify(data)
    );
  }

}

// ========================================
// ルーム全員に送信
// ========================================

function broadcast(room, data) {

  for (const player of room.players) {
    send(player.ws, data);
  }

}

// ========================================
// プレイヤー一覧
// ========================================

function playerList(room) {

  return room.players.map(player => ({
    id: player.id,
    name: player.name,
    role: player.role,
    alive: player.alive,
    floor: player.floor,
    x: player.x,
    y: player.y,
    z: player.z,
    yaw: player.yaw,
    pitch: player.pitch,
    ready: player.ready
  }));

}

// ========================================
// ロビー状態
// ========================================

function sendRoomState(room) {

  broadcast(room, {
    type: "roomState",

    roomCode: room.code,

    hostId: room.hostId,

    players: playerList(room),

    items: room.items,

    trap: room.trap,

    gameStarted: room.gameStarted
  });

}

// ========================================
// プレイヤー検索
// ========================================

function findPlayer(room, id) {

  return room.players.find(
    p => p.id === id
  );

}

// ========================================
// ルーム作成
// ========================================

function createRoom(ws, name) {

  const roomCode =
    makeRoomCode();

  const playerId =
    makePlayerId();

  const player = {

    id: playerId,

    ws: ws,

    name:
      String(name || "Player")
        .substring(0, 16),

    role: "human",

    ready: false,

    alive: true,

    floor: 0,

    x: -10,

    y: 1.7,

    z: 0,

    yaw: -Math.PI / 2,

    pitch: 0

  };

  const room = {

    code: roomCode,

    hostId: playerId,

    players: [player],

    gameStarted: false,

    gameEnded: false,

    winner: null,

    startTime: 0,

    items:
      Array(10).fill(false),

    trap: null

  };

  rooms.set(
    roomCode,
    room
  );

  ws.roomCode =
    roomCode;

  ws.playerId =
    playerId;

  // 自分に通知
  send(ws, {

    type: "roomCreated",

    roomCode: roomCode,

    playerId: playerId

  });

  sendRoomState(room);

  console.log(
    `[ROOM CREATE] ${roomCode}`
  );

}

// ========================================
// ルーム参加
// ========================================

function joinRoom(
  ws,
  roomCode,
  name
) {

  const code =
    String(roomCode || "")
      .trim()
      .toUpperCase();

  const room =
    rooms.get(code);

  if (!room) {

    send(ws, {
      type: "error",
      message:
        "ルームが見つかりません。"
    });

    return;

  }

  if (room.gameStarted) {

    send(ws, {
      type: "error",
      message:
        "すでにゲームが開始されています。"
    });

    return;

  }

  if (
    room.players.length >=
    MAX_PLAYERS
  ) {

    send(ws, {
      type: "error",
      message:
        "このルームは満員です。"
    });

    return;

  }

  const playerId =
    makePlayerId();

  const player = {

    id: playerId,

    ws: ws,

    name:
      String(
        name ||
        `Player${room.players.length + 1}`
      ).substring(0, 16),

    role: "human",

    ready: false,

    alive: true,

    floor: 0,

    x: -10,

    y: 1.7,

    z: 0,

    yaw: -Math.PI / 2,

    pitch: 0

  };

  room.players.push(
    player
  );

  ws.roomCode =
    room.code;

  ws.playerId =
    playerId;

  send(ws, {

    type: "roomJoined",

    roomCode: room.code,

    playerId: playerId

  });

  sendRoomState(room);

  console.log(
    `[ROOM JOIN] ${room.code} ${player.name}`
  );

}

// ========================================
// ゲーム開始
// ========================================

function startGame(room) {

  if (!room) return;

  if (room.gameStarted) {
    return;
  }

  if (room.players.length < 2) {

    broadcast(room, {
      type: "error",
      message:
        "2人以上でゲームを開始できます。"
    });

    return;

  }

  // 全員を人間に戻す
  for (
    const player of room.players
  ) {

    player.role = "human";

    player.alive = true;

    player.ready = false;

  }

  // ランダムで鬼を1人
  const killerIndex =
    Math.floor(
      Math.random() *
      room.players.length
    );

  room.players[
    killerIndex
  ].role = "killer";

  room.gameStarted = true;

  room.gameEnded = false;

  room.winner = null;

  room.startTime =
    Date.now();

  room.items =
    Array(10).fill(false);

  room.trap = null;

  // 初期位置
  for (
    const player of room.players
  ) {

    player.floor = 0;

    player.x =
      player.role === "killer"
        ? 15
        : -10;

    player.y = 1.7;

    player.z =
      player.role === "killer"
        ? -15
        : 0;

    player.yaw =
      -Math.PI / 2;

    player.pitch = 0;

  }

  // プレイヤーごとに
  // 自分の役割を送る
  for (
    const player of room.players
  ) {

    send(player.ws, {

      type: "gameStarted",

      playerId: player.id,

      role: player.role,

      players:
        playerList(room)

    });

  }

  sendPlayersState(room);

  console.log(
    `[GAME START] ${room.code}`
  );

}

// ========================================
// プレイヤー状態
// ========================================

function sendPlayersState(room) {

  broadcast(room, {

    type: "playersState",

    players:
      playerList(room)

  });

}

// ========================================
// 距離
// ========================================

function distance(a, b) {

  const dx =
    a.x - b.x;

  const dz =
    a.z - b.z;

  return Math.sqrt(
    dx * dx +
    dz * dz
  );

}

// ========================================
// 勝敗判定
// ========================================

function checkWin(room) {

  if (
    !room.gameStarted ||
    room.gameEnded
  ) {
    return;
  }

  // 罠がある場合
  // 鬼が罠に近づいたら人間勝利
  if (room.trap) {

    const killer =
      room.players.find(
        p => p.role === "killer"
      );

    if (
      killer &&
      killer.alive &&
      killer.floor === room.trap.floor &&
      distance(
        killer,
        room.trap
      ) < 1.8
    ) {

      endGame(
        room,
        "humans"
      );

      return;

    }

  }

  // 生きている人間
  const humans =
    room.players.filter(
      p =>
        p.role === "human" &&
        p.alive
    );

  if (humans.length === 0) {

    endGame(
      room,
      "killer"
    );

  }

}

// ========================================
// ゲーム終了
// ========================================

function endGame(
  room,
  winner
) {

  if (
    room.gameEnded
  ) {
    return;
  }

  room.gameEnded = true;

  room.winner =
    winner;

  let elapsed = 0;

  if (room.startTime) {

    elapsed =
      Math.floor(
        (Date.now() -
          room.startTime) /
        1000
      );

  }

  broadcast(room, {

    type: "gameOver",

    winner: winner,

    elapsedTime: elapsed

  });

  console.log(
    `[GAME END] ${room.code} winner=${winner}`
  );

}// ========================================
// WebSocket接続
// ========================================

wss.on("connection", ws => {

  console.log(
    "[CONNECT] client connected"
  );

  ws.roomCode = null;
  ws.playerId = null;

  // ======================================
  // メッセージ受信
  // ======================================

  ws.on("message", raw => {

    let data;

    try {

      data =
        JSON.parse(
          raw.toString()
        );

    } catch (error) {

      send(ws, {
        type: "error",
        message:
          "通信データを読み取れませんでした。"
      });

      return;
    }

    // ====================================
    // 部屋を作る
    // ====================================

    if (
      data.type === "createRoom"
    ) {

      createRoom(
        ws,
        data.name
      );

      return;
    }

    // ====================================
    // 部屋に参加
    // ====================================

    if (
      data.type === "joinRoom"
    ) {

      joinRoom(
        ws,
        data.roomCode,
        data.name
      );

      return;
    }

    // ====================================
    // ルーム確認
    // ====================================

    const room =
      rooms.get(
        ws.roomCode
      );

    if (!room) {

      send(ws, {
        type: "error",
        message:
          "ルームに参加していません。"
      });

      return;
    }

    const player =
      findPlayer(
        room,
        ws.playerId
      );

    if (!player) {

      send(ws, {
        type: "error",
        message:
          "プレイヤー情報がありません。"
      });

      return;
    }

    // ====================================
    // 準備OK
    // ====================================

    if (
      data.type === "ready"
    ) {

      player.ready =
        !!data.ready;

      sendRoomState(room);

      return;
    }

    // ====================================
    // ゲーム開始
    // ====================================

    if (
      data.type === "startGame"
    ) {

      if (
        room.hostId !==
        player.id
      ) {

        send(ws, {
          type: "error",
          message:
            "ホストだけがゲームを開始できます。"
        });

        return;
      }

      startGame(room);

      return;
    }

    // ====================================
    // プレイヤー状態
    // ====================================

    if (
      data.type === "state"
    ) {

      if (
        !room.gameStarted ||
        room.gameEnded
      ) {
        return;
      }

      if (
        typeof data.x === "number"
      ) {
        player.x =
          data.x;
      }

      if (
        typeof data.y === "number"
      ) {
        player.y =
          data.y;
      }

      if (
        typeof data.z === "number"
      ) {
        player.z =
          data.z;
      }

      if (
        typeof data.yaw === "number"
      ) {
        player.yaw =
          data.yaw;
      }

      if (
        typeof data.pitch === "number"
      ) {
        player.pitch =
          data.pitch;
      }

      if (
        typeof data.floor === "number"
      ) {
        player.floor =
          Math.max(
            0,
            Math.min(
              4,
              Math.floor(data.floor)
            )
          );
      }

      checkWin(room);

      return;
    }

    // ====================================
    // 罠設置
    // ====================================

    if (
      data.type === "placeTrap"
    ) {

      if (
        !room.gameStarted ||
        room.gameEnded
      ) {
        return;
      }

      if (
        player.role !== "human"
      ) {
        return;
      }

      if (room.trap) {
        return;
      }

      room.trap = {

        floor:
          player.floor,

        x:
          player.x,

        y:
          player.y,

        z:
          player.z

      };

      broadcast(room, {

        type: "trapPlaced",

        trap: room.trap

      });

      checkWin(room);

      return;
    }

    // ====================================
    // アイテム取得
    // ====================================

    if (
      data.type === "collectItem"
    ) {

      if (
        !room.gameStarted ||
        room.gameEnded
      ) {
        return;
      }

      if (
        player.role !== "human"
      ) {
        return;
      }

      const index =
        Number(data.index);

      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= 10
      ) {
        return;
      }

      // すでに取得済み
      if (
        room.items[index]
      ) {
        return;
      }

      room.items[index] =
        true;

      broadcast(room, {

        type: "itemCollected",

        index: index,

        items:
          room.items

      });

      return;
    }

    // ====================================
    // 鬼が人間を捕まえる
    // ====================================

    if (
      data.type === "killPlayer"
    ) {

      if (
        !room.gameStarted ||
        room.gameEnded
      ) {
        return;
      }

      // 鬼以外は実行不可
      if (
        player.role !== "killer"
      ) {
        return;
      }

      const target =
        findPlayer(
          room,
          data.targetId
        );

      if (!target) {
        return;
      }

      if (
        target.role !== "human" ||
        !target.alive
      ) {
        return;
      }

      // 同じ階のみ
      if (
        target.floor !==
        player.floor
      ) {
        return;
      }

      // 距離チェック
      if (
        distance(
          player,
          target
        ) > 2.2
      ) {
        return;
      }

      target.alive =
        false;

      broadcast(room, {

        type: "playerCaught",

        playerId:
          target.id

      });

      checkWin(room);

      sendPlayersState(room);

      return;
    }

    // ====================================
    // 鬼が罠にかかった
    // ====================================

    if (
      data.type === "killerTrapped"
    ) {

      if (
        !room.gameStarted ||
        room.gameEnded
      ) {
        return;
      }

      if (
        player.role !== "human"
      ) {
        return;
      }

      const killer =
        room.players.find(
          p =>
            p.role === "killer"
        );

      if (!killer) {
        return;
      }

      if (
        !room.trap
      ) {
        return;
      }

      if (
        killer.floor !==
        room.trap.floor
      ) {
        return;
      }

      if (
        distance(
          killer,
          room.trap
        ) > 2.5
      ) {
        return;
      }

      endGame(
        room,
        "humans"
      );

      return;
    }

    // ====================================
    // 鬼スタン
    // ====================================

    if (
      data.type === "killerStunned"
    ) {

      if (
        player.role !== "human"
      ) {
        return;
      }

      broadcast(room, {

        type: "killerStunned",

        until:
          Date.now() +
          3000

      });

      return;
    }

    // ====================================
    // ドア状態
    // ====================================

    if (
      data.type === "door"
    ) {

      if (
        !room.gameStarted
      ) {
        return;
      }

      const index =
        Number(data.index);

      if (
        !Number.isInteger(index)
      ) {
        return;
      }

      broadcast(room, {

        type: "door",

        index: index,

        open:
          !!data.open

      });

      return;
    }

    // ====================================
    // 現在状態を要求
    // ====================================

    if (
      data.type === "requestState"
    ) {

      sendRoomState(room);

      if (
        room.gameStarted
      ) {

        sendPlayersState(
          room
        );

      }

      return;
    }

  });

  // ======================================
  // 切断
  // ======================================

  ws.on("close", () => {

    console.log(
      "[DISCONNECT]",
      ws.playerId
    );

    const room =
      rooms.get(
        ws.roomCode
      );

    if (!room) {
      return;
    }

    const index =
      room.players.findIndex(
        p =>
          p.id ===
          ws.playerId
      );

    if (index === -1) {
      return;
    }

    const leaving =
      room.players[index];

    room.players.splice(
      index,
      1
    );

    // ====================================
    // 部屋が空になった
    // ====================================

    if (
      room.players.length === 0
    ) {

      rooms.delete(
        room.code
      );

      console.log(
        `[ROOM DELETE] ${room.code}`
      );

      return;
    }

    // ====================================
    // ホスト変更
    // ====================================

    if (
      room.hostId ===
      leaving.id
    ) {

      room.hostId =
        room.players[0].id;

    }

    // ====================================
    // 鬼が抜けた
    // ====================================

    if (
      room.gameStarted &&
      leaving.role === "killer" &&
      !room.gameEnded
    ) {

      endGame(
        room,
        "humans"
      );

    }

    // ====================================
    // 人間が抜けた
    // ====================================

    if (
      room.gameStarted &&
      leaving.role === "human"
    ) {

      checkWin(room);

    }

    sendRoomState(
      room
    );

    if (
      room.gameStarted
    ) {

      sendPlayersState(
        room
      );

    }

  });

  // ======================================
  // WebSocketエラー
  // ======================================

  ws.on("error", error => {

    console.error(
      "[WS ERROR]",
      error
    );

  });

});

// ========================================
// 定期的にプレイヤー状態を配信
// ========================================

setInterval(() => {

  for (
    const room of rooms.values()
  ) {

    if (
      !room.gameStarted ||
      room.gameEnded
    ) {
      continue;
    }

    sendPlayersState(
      room
    );

    checkWin(room);

  }

}, 100);

// ========================================
// サーバー起動
// ========================================

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      " SHUTTER & CAGE"
    );

    console.log(
      " MULTIPLAYER SERVER ONLINE"
    );

    console.log(
      ` PORT: ${PORT}`
    );

    console.log(
      "================================"
    );

  }
);