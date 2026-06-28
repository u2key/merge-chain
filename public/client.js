// client.js: ロビー画面とゲーム画面の統合
(() => {
  // LocalStorage でトークン管理
  const STORAGE_KEY_TOKEN = 'merge-chain-token';
  const STORAGE_KEY_NAME = 'merge-chain-name';
  const STORAGE_KEY_SKIN = 'merge-chain-skin';

  // 初期データ
  const SKIN_OPTIONS = [
    '#1abc9c', '#3498db', '#9b59b6', '#e67e22', '#e74c3c',
    '#f1c40f', '#16a085', '#2c3e50', '#7f8c8d', '#27ae60'
  ];

  let currentToken = localStorage.getItem(STORAGE_KEY_TOKEN);
  let currentName = localStorage.getItem(STORAGE_KEY_NAME) || 'Player';
  let currentSkin = localStorage.getItem(STORAGE_KEY_SKIN) || SKIN_OPTIONS[0];
  let socket = null;

  // DOM 要素
  const lobbyEl = document.getElementById('lobby');
  const gameScreenEl = document.getElementById('gameScreen');
  const playerNameInput = document.getElementById('playerName');
  const skinPickerEl = document.getElementById('skinPicker');
  const playBtn = document.getElementById('playBtn');
  const leaderboardEl = document.getElementById('leaderboard');
  const scoreboardEl = document.getElementById('scoreboard');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // ゲーム状態
  let world = {w:2000, h:2000};
  let playerId = null;
  let gameState = {snakes:[], foods:[]};
  let mouse = {x: canvas.width/2, y: canvas.height/2};
  let currentScore = 0;

  function resizeCanvas(){
    canvas.width = Math.min(window.innerWidth, 1200);
    canvas.height = Math.min(window.innerHeight-20, 800);
  }
  window.addEventListener('resize', resizeCanvas);

  // ロビー画面の初期化
  function initLobby(){
    playerNameInput.value = currentName;
    skinPickerEl.innerHTML = '';
    SKIN_OPTIONS.forEach((skin) => {
      const el = document.createElement('div');
      el.className = 'skin-option' + (skin === currentSkin ? ' selected' : '');
      el.style.background = skin;
      el.dataset.skin = skin;
      el.onclick = () => selectSkin(skin);
      skinPickerEl.appendChild(el);
    });
    fetchLeaderboard();
  }

  // 蛇の色選択
  function selectSkin(skin){
    currentSkin = skin;
    document.querySelectorAll('.skin-option').forEach(el => {
      el.classList.toggle('selected', el.dataset.skin === skin);
    });
  }

  // ランキング取得・表示
  async function fetchLeaderboard(){
    try {
      const res = await fetch('./api/leaderboard');
      const {leaderboard} = await res.json();
      leaderboardEl.innerHTML = leaderboard.map((p, i) => {
        return `<div class="leaderboard-item">
          <span class="leaderboard-rank">#${i+1}</span>
          <span class="leaderboard-name">${p.name}</span>
          <span class="leaderboard-score">${p.maxScore}</span>
        </div>`;
      }).join('');
    } catch (e){ console.error('Failed to fetch leaderboard:', e); }
  }

  // プレイボタンのクリック
  playBtn.onclick = async () => {
    const name = playerNameInput.value.trim() || currentName;
    currentName = name;
    localStorage.setItem(STORAGE_KEY_NAME, name);
    localStorage.setItem(STORAGE_KEY_SKIN, currentSkin);

    try {
      let token = currentToken;
      let isRegistered = false;

      // 既存のトークンがあれば更新を試みる
      if (token) {
        const updateRes = await fetch('./api/player/update', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({name, skin: currentSkin})
        });
        if (updateRes.ok) {
          isRegistered = true;
        }
      }

      // トークンがない、またはサーバー上で無効化されていた場合は新規登録
      if (!isRegistered) {
        const res = await fetch('./api/player/register', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({name, skin: currentSkin})
        });
        const data = await res.json();
        token = data.token;
        currentToken = token;
        localStorage.setItem(STORAGE_KEY_TOKEN, token);
      }

      // ゲーム画面へ遷移
      lobbyEl.classList.add('hidden');
      gameScreenEl.classList.remove('hidden');
      resizeCanvas();

      // Socket.io で接続（トークンをクエリパラメータで送信）
      // リバースプロキシのサブディレクトリ環境でも動作するように path を自動判定
      const basePath = new URL('.', window.location.href).pathname;
      socket = io({
        path: basePath + 'socket.io',
        query: {token}
      });
      attachSocketEvents();
    } catch (e){ console.error('Failed to register:', e); alert('Registration failed'); }
  };

  function attachSocketEvents(){
    socket.on('init', (data) => {
      playerId = data.id;
      world = data.world;
      console.log('Game initialized:', data);
    });

    socket.on('state', (s) => {
      gameState = s;
      currentScore = gameState.snakes.find(x => x.id === playerId)?.segments.length || 0;
      drawGame();
      updateScoreboard();
      sendInput();
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      // リロードまたはロビーに戻る
      setTimeout(() => {
        lobbyEl.classList.remove('hidden');
        gameScreenEl.classList.add('hidden');
      }, 2000);
    });
  }

  // 入力をサーバーへ送る関数
  function sendInput() {
    const p = gameState.snakes.find(x => x.id === playerId);
    if (!p || !socket) return;
    
    // 画面中央（蛇の頭）からマウスへのベクトル
    const dx = mouse.x - canvas.width / 2;
    const dy = mouse.y - canvas.height / 2;
    const mag = Math.sqrt(dx*dx + dy*dy) || 1;
    
    // カーソルの方向に向かって常に一定速度で進み続けるように、
    // 現在の頭の位置から十分遠い場所をターゲット座標として送信する
    const targetDist = 1000;
    const worldX = p.head.x + (dx / mag) * targetDist;
    const worldY = p.head.y + (dy / mag) * targetDist;
    
    socket.emit('input', { x: worldX, y: worldY });
  }

  // マウス移動時にも入力を更新
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    sendInput();
  });

  // ゲーム終了時にスコアを報告
  function reportScore(){
    if (socket && currentScore > 0){
      socket.emit('game-end', {score: currentScore});
    }
  }
  window.addEventListener('beforeunload', reportScore);

  // スコアボード更新
  function updateScoreboard(){
    const arr = [...gameState.snakes]
      .filter(s => s.alive)
      .sort((a,b)=> (b.segments.length) - (a.segments.length))
      .slice(0,10);
    scoreboardEl.innerHTML = '<strong>Live Leaderboard</strong>' + arr.map(s => {
      const len = s.segments.length;
      const name = s.name + (s.id===playerId ? ' (You)' : '');
      return `<div class="row"><span class="dot" style="background:${s.color}"></span>${name}: ${len}</div>`;
    }).join('');
  }

  // 蛇のベース色と同系色（赤など）の場合、弱点を見やすくするための色を返す
  function getWeakColor(hex) {
    if (!hex || hex[0] !== '#') return '#ff4d4d';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    
    // デフォルトの弱点色 #ff4d4d (255, 77, 77) との距離を計算
    const dist = Math.sqrt(Math.pow(r - 255, 2) + Math.pow(g - 77, 2) + Math.pow(b - 77, 2));
    
    // 色が近すぎる（赤やオレンジ系）場合は黒っぽい色にする
    if (dist < 120) {
      return '#222222';
    }
    return '#ff4d4d';
  }

  // Canvas 描画
  function drawGame(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const p = gameState.snakes.find(s => s.id === playerId && s.alive);
    const centerX = p ? p.head.x : world.w/2;
    const centerY = p ? p.head.y : world.h/2;
    const offsetX = centerX - canvas.width/2;
    const offsetY = centerY - canvas.height/2;

    ctx.fillStyle = '#080a0b';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // エサ
    for (let f of gameState.foods){
      const x = f.x - offsetX, y = f.y - offsetY;
      if (x < -20 || x > canvas.width+20 || y < -20 || y > canvas.height+20) continue;
      ctx.beginPath(); ctx.fillStyle = '#ffd700'; ctx.arc(x,y,f.r,0,Math.PI*2); ctx.fill();
    }

    // スネーク
    for (let s of gameState.snakes){
      const weakColor = getWeakColor(s.color);
      for (let i=0;i<s.segments.length;i++){
        const seg = s.segments[i];
        const x = seg.x - offsetX, y = seg.y - offsetY;
        const isWeak = (i >= 9) && ((i % 10) === 9 || (i % 10) === 0 || (i % 10) === 1);
        ctx.beginPath(); ctx.fillStyle = isWeak ? weakColor : s.color; ctx.arc(x,y,8,0,Math.PI*2); ctx.fill();
      }
      const sx = s.head.x - offsetX, sy = s.head.y - offsetY;
      ctx.beginPath(); ctx.fillStyle = s.color; ctx.arc(sx, sy, 10, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.fillText(s.name, sx + 12, sy - 12);
    }
  }

  // 初期化
  initLobby();
})();

