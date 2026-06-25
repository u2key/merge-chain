// client.js: Canvas描画 + 入力送信 + ステート受信
(() => {
  const socket = io();
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  function resizeCanvas(){
    canvas.width = Math.min(window.innerWidth, 1200);
    canvas.height = Math.min(window.innerHeight-20, 800);
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  let world = {w:2000, h:2000};
  let playerId = null;
  let state = {snakes:[], foods:[]};
  let mouse = {x: canvas.width/2, y: canvas.height/2};

  socket.on('init', (data) => { playerId = data.id; world = data.world; console.log('init', data); });
  socket.on('state', s => { state = s; draw(); updateScoreboard(); });

  // マウス移動で入力をサーバーへ送る（ワールド座標に変換して送信）
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left; mouse.y = e.clientY - rect.top;
    const p = state.snakes.find(x => x.id === playerId);
    if (!p) return;
    const worldX = p.head.x + (mouse.x - canvas.width/2);
    const worldY = p.head.y + (mouse.y - canvas.height/2);
    socket.emit('input', { x: worldX, y: worldY });
  });

  // スコアボード更新
  const scoreEl = document.getElementById('scoreboard');
  function updateScoreboard(){
    const arr = [...state.snakes].sort((a,b)=> (b.segments.length) - (a.segments.length)).slice(0,10);
    scoreEl.innerHTML = '<strong>Leaderboard</strong>' + arr.map(s => {
      const len = s.segments.length;
      const name = s.name + (s.id===playerId ? ' (You)' : '');
      return `<div class="row"><span class="dot" style="background:${s.color}"></span>${name}: ${len}</div>`;
    }).join('');
  }

  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const p = state.snakes.find(s => s.id === playerId && s.alive);
    const centerX = p ? p.head.x : world.w/2;
    const centerY = p ? p.head.y : world.h/2;
    const offsetX = centerX - canvas.width/2;
    const offsetY = centerY - canvas.height/2;

    // 背景
    ctx.fillStyle = '#080a0b'; ctx.fillRect(0,0,canvas.width,canvas.height);

    // エサを描画
    for (let f of state.foods){
      const x = f.x - offsetX, y = f.y - offsetY;
      if (x < -20 || x > canvas.width+20 || y < -20 || y > canvas.height+20) continue;
      ctx.beginPath(); ctx.fillStyle = '#ffd700'; ctx.arc(x,y,f.r,0,Math.PI*2); ctx.fill();
    }

    // スネークを描画
    for (let s of state.snakes){
      // 胴体
      for (let i=0;i<s.segments.length;i++){
        const seg = s.segments[i];
        const x = seg.x - offsetX, y = seg.y - offsetY;
        // 千切れる判定（クライアントも同じルールで表示）
        // サーバーと同様: インデックスが 9,10,11 / 19,20,21 ... の箇所を強調表示
        const isWeak = (i >= 9) && ((i % 10) === 9 || (i % 10) === 0 || (i % 10) === 1);
        ctx.beginPath(); ctx.fillStyle = isWeak ? '#ff4d4d' : s.color; ctx.arc(x,y,8,0,Math.PI*2); ctx.fill();
      }
      // 頭
      const hx = s.head.x - offsetX, hy = s.head.y - offsetY;
      ctx.beginPath(); ctx.fillStyle = s.color; ctx.arc(hx, hy, 10, 0, Math.PI*2); ctx.fill();
      // 名前
      ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.fillText(s.name, hx+12, hy-12);
    }
  }

  // 初期描画
  draw();
})();
