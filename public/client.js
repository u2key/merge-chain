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
    skinPickerEl.innerHTML = SKIN_OPTIONS.map((skin, idx) => {
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
      const res = await fetch('/api/leaderboard');
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
      // サーバーに登録
      const res = await fetch('/api/player/register', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name, skin: currentSkin})
      });
      const {token, player} = await res.json();
      currentToken = token;
      localStorage.setItem(STORAGE_KEY_TOKEN, token);

      // ゲーム画面へ遷移
      lobbyEl.classList.add('hidden');
      gameScreenEl.classList.remove('hidden');
      resizeCanvas();

      // Socket.io で接続（トークンをクエリパラメータで送信）
      socket = io({query: {token}});
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

  // マウス移動で入力をサーバーへ送る
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    const p = gameState.snakes.find(x => x.id === playerId);
    if (!p || !socket) return;
    const worldX = p.head.x + (mouse.x - canvas.width/2);
    const worldY = p.head.y + (mouse.y - canvas.height/2);
    socket.emit('input', { x: worldX, y: worldY });
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
      for (let i=0;i<s.segments.length;i++){
        const seg = s.segments[i];
        const x = seg.x - offsetX, y = seg.y - offsetY;
        const isWeak = (i >= 9) && ((i % 10) === 9 || (i % 10) === 0 || (i % 10) === 1);
        ctx.beginPath(); ctx.fillStyle = isWeak ? '#ff4d4d' : s.color; ctx.arc(x,y,8,0,Math.PI*2); ctx.fill();
      }
      const sx = s.head.x - offsetX, sy = s.head.y - offsetY;
      ctx.beginPath(); ctx.fillStyle = s.color; ctx.arc(sx, sy, 10, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.fillText(s.name, sx + 12, sy - 12);
    }
  }

  // 初期化
  initLobby();
})();

