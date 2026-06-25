# Nginx + pm2 デプロイガイド

## 502 Bad Gateway の原因と対策

### 主な原因

1. **Nginx が Socket.io のアップグレードヘッダを転送していない**
   - Socket.io は HTTP → WebSocket にアップグレードするため、Nginx が Upgrade/Connection ヘッダを通す必要があります
   - **対策**: nginx.conf.example を参考に `Upgrade` と `Connection` ヘッダを設定

2. **pm2 の PORT と Nginx upstream が一致していない**
   - pm2 が 3000 で起動なのに Nginx が localhost:3001 を指していないか確認
   - **対策**: `pm2 logs merge-chain` でプロセスがどのポートで起動しているか確認

3. **pm2 プロセスが起動していない**
   - **対策**: `pm2 status` でプロセス状態確認、`pm2 start ecosystem.config.js` で再起動

4. **localhost のみリッスンしている**（通常は OK）
   - プロキシ経由なので localhost で OK。0.0.0.0 にする必要はない

### セットアップ手順（レンタルサーバー向け）

```bash
# 1. ローカルで PM2 インストール
npm install -g pm2

# 2. ecosystem.config.js を使って pm2 起動
pm2 start ecosystem.config.js

# 3. pm2 自動起動設定
pm2 save
pm2 startup

# 4. Nginx 設定をコピー・編集
sudo cp nginx.conf.example /etc/nginx/sites-available/merge-chain
sudo nano /etc/nginx/sites-available/merge-chain  # ドメイン名など編集

# 5. Nginx シンボリックリンク作成
sudo ln -s /etc/nginx/sites-available/merge-chain /etc/nginx/sites-enabled/merge-chain

# 6. Nginx テスト・リロード
sudo nginx -t
sudo systemctl reload nginx

# 7. 診断スクリプト実行
./troubleshoot.sh
```

### トラブルシューティング

```bash
# pm2 ログ確認
pm2 logs merge-chain

# Nginx エラーログ確認
sudo tail -f /var/log/nginx/error.log

# ポート確認
lsof -i :3000  # pm2 がここで起動しているか
lsof -i :80    # Nginx が 80 でリッスンしているか

# 診断スクリプト実行
./troubleshoot.sh
```

### よくある設定ミス

❌ **Nginx upstream が指定されていない**
```nginx
proxy_pass http://merge_chain;  # upstream 名を指定しないといけない
```

❌ **WebSocket ヘッダが無い**
```nginx
proxy_set_header Upgrade $http_upgrade;         # 必須
proxy_set_header Connection "upgrade";          # 必須
```

❌ **pm2 が別のポートで起動している**
```bash
# server.js 内で PORT を確認
grep "listen.*PORT" server.js
# または ecosystem.config.js の env.PORT を確認
```

✅ **正しい設定例**
- nginx.conf.example 参照
- ecosystem.config.js 参照

