/*
  server.js
  Node.js + socket.io サーバー
  - サーバーが全てのスネーク（プレイヤー + NPC）とエサを管理
  - 千切る判定と強奪あるいは即死処理はサーバーで行い、全クライアントへ同期する
  - ロビー API: トークン認証、プレイヤー登録・更新、ランキング取得
  - プレイヤーデータは players.json に永続化
*/

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 25562;
const PLAYERS_FILE = __dirname + '/data/players.json';

app.use(express.static(__dirname + '/public'));
app.use(express.json());

// データディレクトリが無ければ作成
if (!fs.existsSync(__dirname + '/data')) {
  fs.mkdirSync(__dirname + '/data', { recursive: true });
}

// プレイヤーデータ: { token -> {name, skin, maxScore, createdAt, updatedAt} }
let playersDB = {};
function loadPlayers(){
  if (fs.existsSync(PLAYERS_FILE)){
    try { playersDB = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
    catch (e){ playersDB = {}; }
  } else { playersDB = {}; }
}
function savePlayers(){
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(playersDB, null, 2), 'utf8');
}
loadPlayers();

// ワールド／ゲームパラメータ
const WORLD_W = 2000;
const WORLD_H = 2000;
const TICK_MS = 50; // サーバー更新間隔（ms）
const PLAYER_SPEED = 160; // px/sec
const NPC_SPEED = 120;
const SEGMENT_SPACING = 10;
const INITIAL_SEGMENTS = 24;
const MIN_NPCS = 5;
const START_FOOD = 80;
const MAX_FOOD = 200;
const FOOD_RADIUS = 6;
const SEGMENT_RADIUS = 8;
const EAT_DISTANCE = SEGMENT_RADIUS + FOOD_RADIUS;

let snakes = {}; // id -> snake
let foods = [];
let nextFoodId = 1;
let nextSnakeId = 1;

function randRange(a,b){ return Math.random()*(b-a)+a; }
function dist(a,b){ const dx=a.x-b.x; const dy=a.y-b.y; return Math.sqrt(dx*dx+dy*dy); }
function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }

function createSnake({id,type='npc',name,color,x,y,len=INITIAL_SEGMENTS}){
  const snake = {
    id,
    type,
    name,
    color,
    head: {x,y},
    segments: [],
    speed: type === 'player' ? PLAYER_SPEED : NPC_SPEED,
    target: {x:x+1, y:y},
    alive: true,
    lastSeen: Date.now(),
    respawnAt: null,
  };
  for (let i=0;i<len;i++){
    snake.segments.push({x: x - (i+1)*SEGMENT_SPACING, y: y});
  }
  snakes[id] = snake;
  return snake;
}

function spawnFood(n) {
  for (let i=0;i<n;i++){
    foods.push({
      id: nextFoodId++,
      x: Math.floor(randRange(30, WORLD_W-30)),
      y: Math.floor(randRange(30, WORLD_H-30)),
      r: FOOD_RADIUS,
    });
  }
}

function spawnNPC(){
  const id = 'npc' + (nextSnakeId++);
  createSnake({
    id,
    type: 'npc',
    name: 'NPC ' + id,
    color: randomColor(),
    x: randRange(100, WORLD_W-100),
    y: randRange(100, WORLD_H-100),
    len: Math.floor(INITIAL_SEGMENTS * randRange(0.6,1.2))
  });
}

function randomColor(){
  const list = ['#1abc9c','#3498db','#9b59b6','#e67e22','#e74c3c','#f1c40f','#16a085','#2c3e50','#7f8c8d'];
  return list[Math.floor(Math.random()*list.length)];
}

function spawnFoodFromSnake(snake) {
  const parts = [ {...snake.head}, ...snake.segments.map(s=>({...s})) ];
  parts.forEach(p => {
    foods.push({
      id: nextFoodId++,
      x: clamp(p.x + randRange(-8,8), 0, WORLD_W),
      y: clamp(p.y + randRange(-8,8), 0, WORLD_H),
      r: FOOD_RADIUS,
    });
  });
}

// 初期生成
spawnFood(START_FOOD);
for (let i=0;i<MIN_NPCS;i++) spawnNPC();

// 千切れる判定（最重要）
// 仕様: インデックスが 9,10,11 / 19,20,21 / 29,30,31 ... のように、
// "10の倍数、その前後1つ" に該当する箇所が弱点となる
// 「インデックスは0始まり」のため、最初の弱点は index >= 9 から始める
function isWeakIndex(idx){
  if (idx < 9) return false;
  const m = idx % 10;
  return (m === 9 || m === 0 || m === 1);
}

// メインループ
setInterval(tick, TICK_MS);

function killSnakeAndScatter(snake){
  spawnFoodFromSnake(snake);
  if (snake.type === 'player'){
    // プレイヤーはリスポーン扱いにして、すぐに削除しない
    snake.alive = false;
    snake.segments = [];
    snake.respawnAt = Date.now() + 3000; // 3秒後にリスポーン
    snake.head.x = randRange(100, WORLD_W-100);
    snake.head.y = randRange(100, WORLD_H-100);
  } else {
    // NPC は完全に削除
    delete snakes[snake.id];
  }
}

function maintainNPCs(){
  let count = Object.values(snakes).filter(s => s.type==='npc' && s.alive).length;
  while (count < MIN_NPCS){ spawnNPC(); count++; }
}

function tick(){
  // NPC AI: 近いエサに向かう
  const foodSnapshot = foods;
  for (const id in snakes){
    const s = snakes[id];
    if (!s || !s.alive) continue;
    if (s.type === 'npc'){
      if (foodSnapshot.length > 0){
        let nearest = foodSnapshot[0];
        let nd = dist(s.head, nearest);
        for (let f of foodSnapshot){ const d = dist(s.head,f); if (d < nd){ nd = d; nearest = f; } }
        s.target.x = nearest.x + randRange(-5,5);
        s.target.y = nearest.y + randRange(-5,5);
      } else {
        s.target.x = s.head.x + randRange(-100,100);
        s.target.y = s.head.y + randRange(-100,100);
      }
    }
  }

  const snakeList = Object.values(snakes);
  // 移動更新
  for (let s of snakeList){
    if (!s || !s.alive) continue;
    const dx = s.target.x - s.head.x;
    const dy = s.target.y - s.head.y;
    const mag = Math.sqrt(dx*dx + dy*dy) || 1;
    const moveDist = s.speed * (TICK_MS / 1000);
    s.head.x += (dx / mag) * Math.min(moveDist, mag);
    s.head.y += (dy / mag) * Math.min(moveDist, mag);
    // ラップ処理
    if (s.head.x < 0) s.head.x += WORLD_W;
    if (s.head.x > WORLD_W) s.head.x -= WORLD_W;
    if (s.head.y < 0) s.head.y += WORLD_H;
    if (s.head.y > WORLD_H) s.head.y -= WORLD_H;
    // 胴体追従
    let prevX = s.head.x; let prevY = s.head.y;
    for (let i=0;i<s.segments.length;i++){
      const seg = s.segments[i];
      const dxs = prevX - seg.x; const dys = prevY - seg.y;
      const d = Math.sqrt(dxs*dxs + dys*dys) || 1;
      if (d > SEGMENT_SPACING){
        const ang = Math.atan2(dys, dxs);
        seg.x = prevX - Math.cos(ang) * SEGMENT_SPACING;
        seg.y = prevY - Math.sin(ang) * SEGMENT_SPACING;
      }
      prevX = seg.x; prevY = seg.y;
    }
  }

  // 食べる判定
  for (let s of snakeList){
    if (!s || !s.alive) continue;
    for (let i = foods.length -1; i >= 0; i--){
      const f = foods[i];
      if (dist(s.head, f) <= EAT_DISTANCE){
        const last = s.segments.length ? s.segments[s.segments.length -1] : {x: s.head.x, y:s.head.y};
        s.segments.push({x: last.x, y: last.y});
        foods.splice(i,1);
      }
    }
  }

  // 衝突判定（頭 vs 他の蛇の胴体） — サーバーで処理
  for (let aIdx = 0; aIdx < snakeList.length; aIdx++){
    const attacker = snakeList[aIdx];
    if (!attacker || !attacker.alive) continue;
    let attackedSomeone = false;
    for (let bIdx = 0; bIdx < snakeList.length; bIdx++){
      const target = snakeList[bIdx];
      if (!target || !target.alive) continue;
      if (attacker.id === target.id) continue;
      for (let segIdx = 0; segIdx < target.segments.length; segIdx++){
        const seg = target.segments[segIdx];
        if (dist(attacker.head, seg) <= SEGMENT_RADIUS * 1.0){
          if (isWeakIndex(segIdx)){
            // 分岐A: 千切れるポイント（弱点）
            // 衝突された側の胴体を segIdx から末尾まで切り離す
            // 切り離されたパーツを攻撃側の末尾に連結（強奪）
            const stolen = target.segments.splice(segIdx);
            attacker.segments = attacker.segments.concat(stolen);
            attackedSomeone = true;
            break;
          } else {
            // 分岐B: 千切れないポイント（鉄壁）
            // 攻撃側が即死 → その蛇の全パーツはエサとして散らばる
            killSnakeAndScatter(attacker);
            attackedSomeone = true;
            break;
          }
        }
      }
      if (attackedSomeone) break;
    }
  }

  // リスポーン処理
  const now = Date.now();
  for (const id in snakes){
    const s = snakes[id];
    if (!s) continue;
    if (!s.alive && s.respawnAt && now >= s.respawnAt){
      s.alive = true; s.respawnAt = null; s.segments = [];
      for (let i=0;i<8;i++) s.segments.push({x: s.head.x - (i+1)*SEGMENT_SPACING, y: s.head.y});
    }
  }

  maintainNPCs();
  if (foods.length < 40) spawnFood(30);
  if (foods.length > MAX_FOOD) foods = foods.slice(0, MAX_FOOD);

  // マルチプレイ同期: 各プレイヤーに対して周囲オブジェクトのみを送信
  // （ネットワーク最適化: 視野範囲外のスネーク・エサは送信しない）
  // 視野範囲: プレイヤー周囲 800px（画面幅相当 + マージン）
  const VIEW_RANGE = 800;
  
  for (const playerId in snakes) {
    const playerSnake = snakes[playerId];
    if (!playerSnake || playerSnake.type !== 'player') continue;
    
    // プレイヤーの周囲スネークをフィルタリング
    const visibleSnakes = Object.values(snakes)
      .filter(s => {
        // プレイヤー自身は必ず表示
        if (s.id === playerSnake.id) return true;
        
        const dx = s.head.x - playerSnake.head.x;
        const dy = s.head.y - playerSnake.head.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        // スネークの胴体の長さを考慮した有効な視野範囲
        // 頭が遠くても、胴体が長い場合は画面内に収まる可能性があるため
        const effectiveViewRange = VIEW_RANGE + (s.segments.length * SEGMENT_SPACING);
        
        return dist <= effectiveViewRange;
      })
      .map(s => ({
        id: s.id,
        type: s.type,
        name: s.name,
        color: s.color,
        head: {x: s.head.x, y: s.head.y},
        segments: s.segments.map(p => ({x:p.x, y:p.y})),
        alive: s.alive,
      }));
    
    // プレイヤー周囲のエサをフィルタリング
    const visibleFoods = foods.filter(f => {
      const dx = f.x - playerSnake.head.x;
      const dy = f.y - playerSnake.head.y;
      const distSq = dx*dx + dy*dy;
      return distSq <= VIEW_RANGE * VIEW_RANGE;
    }).map(f => ({id: f.id, x: f.x, y: f.y, r: f.r}));
    
    // プレイヤー固有の state を送信
    const snapshot = {
      time: Date.now(),
      snakes: visibleSnakes,
      foods: visibleFoods
    };
    
    // このプレイヤーのソケットのみに送信（broadcast ではなく個別送信）
    io.to(playerSnake.socketId || playerId).emit('state', snapshot);
  }
}

// REST API エンドポイント: ロビー画面用

// トークン認証ミドルウェア
function authToken(req, res, next){
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !playersDB[token]) return res.status(401).json({error: 'Invalid token'});
  req.token = token;
  req.player = playersDB[token];
  next();
}

// POST /api/player/register: 新規登録または既存トークンで即座にプレイを開始
app.post('/api/player/register', (req,res) => {
  const { name, skin } = req.body;
  if (!name || typeof name !== 'string' || !skin) return res.status(400).json({error: 'Missing name or skin'});
  const token = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  playersDB[token] = {
    name: name.substring(0,20), // 最大20文字
    skin: skin,
    maxScore: 0,
    createdAt: now,
    updatedAt: now,
  };
  savePlayers();
  res.json({ token, player: playersDB[token] });
});

// PUT /api/player/update: プレイヤー情報を更新（名前、スキン、最高スコア）
app.put('/api/player/update', authToken, (req,res) => {
  const { name, skin, maxScore } = req.body;
  if (name) req.player.name = name.substring(0,20);
  if (skin) req.player.skin = skin;
  if (typeof maxScore === 'number') req.player.maxScore = Math.max(req.player.maxScore, maxScore);
  req.player.updatedAt = new Date().toISOString();
  savePlayers();
  res.json({player: req.player});
});

// GET /api/leaderboard: トップ100プレイヤーのランキング
app.get('/api/leaderboard', (req,res) => {
  const list = Object.values(playersDB)
    .sort((a,b) => b.maxScore - a.maxScore)
    .slice(0, 100)
    .map(p => ({name: p.name, maxScore: p.maxScore}));
  res.json({leaderboard: list});
});

// GET /api/player: 現在のプレイヤー情報を取得
app.get('/api/player', authToken, (req,res) => {
  res.json({player: req.player});
});

// ソケット接続ハンドラ
io.on('connection', (socket) => {
  console.log('client connected:', socket.id);
  const token = socket.handshake.query.token;
  let player = token && playersDB[token] ? playersDB[token] : null;
  const pid = 'player' + (nextSnakeId++);
  const playerName = player?.name || 'Player ' + pid;
  const playerSkin = player?.skin || randomColor();
  createSnake({
    id: pid,
    type: 'player',
    name: playerName,
    color: playerSkin,
    x: randRange(200, WORLD_W-200),
    y: randRange(200, WORLD_H-200),
    len: 18
  });
  // socketId をスネークに紐付け（tick() で周囲フィルタリング時に使用）
  snakes[pid].socketId = socket.id;
  socket.data.snakeId = pid;
  socket.data.token = token;
  socket.emit('init', { id: pid, world: {w: WORLD_W, h: WORLD_H}, player: player });

  // クライアントからの入力（ワールド座標）を受け取り、サーバー側で移動ターゲットとして利用する
  socket.on('input', (data) => {
    const s = snakes[socket.data.snakeId];
    if (!s) return;
    if (typeof data.x === 'number' && typeof data.y === 'number'){
      s.target.x = clamp(data.x, 0, WORLD_W);
      s.target.y = clamp(data.y, 0, WORLD_H);
      s.lastSeen = Date.now();
    }
  });

  // ゲーム終了時にスコアを報告（スコア = 蛇の体長）
  socket.on('game-end', (data) => {
    const token = socket.data.token;
    if (token && playersDB[token] && typeof data.score === 'number'){
      playersDB[token].maxScore = Math.max(playersDB[token].maxScore, data.score);
      playersDB[token].updatedAt = new Date().toISOString();
      savePlayers();
    }
  });

  socket.on('disconnect', () => {
    const sid = socket.data.snakeId;
    const s = snakes[sid];
    if (s){ spawnFoodFromSnake(s); delete snakes[sid]; }
    console.log('client disconnected:', socket.id);
  });
});

server.listen(PORT, () => { console.log('Server listening on port', PORT); });
