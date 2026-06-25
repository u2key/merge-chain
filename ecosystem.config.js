// pm2 ecosystem.config.js
// レンタルサーバーで使う場合の推奨設定
// 
// 使い方:
// pm2 start ecosystem.config.js
// pm2 save  # 再起動後に自動起動するよう保存
// pm2 startup  # 初回のみ実行

module.exports = {
  apps: [
    {
      name: 'merge-chain',
      script: './server.js',
      instances: 1,  // シングルインスタンス（ポート競合回避）
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,  // Nginx がここに接続
      },
      
      // エラーログ
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // メモリ上限（レンタルサーバーは制限が厳しい場合がある）
      max_memory_restart: '500M',
      
      // クラッシュ時の自動再起動
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      
      // グレースフルシャットダウン
      kill_timeout: 5000,
      wait_ready: false,
    }
  ]
};
