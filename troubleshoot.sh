#!/bin/bash
# troubleshoot.sh - Nginx + pm2 + Socket.io の 502 診断スクリプト

set -e

echo "=== Merge-Chain 502 Diagnosis ==="
echo

echo "1. pm2 プロセス確認"
pm2 status merge-chain || echo "ERROR: pm2 でプロセスが見つかりません"
echo

echo "2. localhost:3000 がリスン中か確認"
if lsof -i :3000 >/dev/null 2>&1; then
  echo "✓ ポート 3000 でリスン中"
  lsof -i :3000 | head -3
else
  echo "✗ ERROR: ポート 3000 がリッスンしていません。pm2 が起動していることを確認してください"
  echo "  修正: pm2 start ecosystem.config.js"
fi
echo

echo "3. サーバーが HTTP 応答するか確認"
if curl -s http://localhost:3000/api/leaderboard | head -c 50; then
  echo ""
  echo "✓ サーバーが 3000 でレスポンスしています"
else
  echo "✗ ERROR: localhost:3000 が応答しません"
fi
echo

echo "4. Nginx が動作しているか確認"
if pgrep -x nginx >/dev/null; then
  echo "✓ Nginx が動作中"
else
  echo "✗ WARNING: Nginx が停止しています"
  echo "  修正: sudo systemctl start nginx"
fi
echo

echo "5. Nginx 設定が正しいか確認"
if sudo nginx -t 2>&1 | grep -q "successful"; then
  echo "✓ Nginx 設定は正常"
else
  echo "✗ ERROR: Nginx 設定に問題があります。以下を実行:"
  echo "  sudo nginx -t"
fi
echo

echo "6. Nginx エラーログを確認"
echo "最新のエラー:"
sudo tail -n 5 /var/log/nginx/error.log 2>/dev/null || echo "(ログファイルが見つかりません)"
echo

echo "7. pm2 ログを確認"
echo "最新のエラー:"
pm2 logs merge-chain --lines 5 --nostream 2>/dev/null || echo "(pm2 ログが見つかりません)"
echo

echo "=== 診断完了 ==="
echo
echo "推奨チェック項目:"
echo "  □ Nginx の upstream が localhost:3000 を指している"
echo "  □ Nginx に 'Upgrade' と 'Connection' ヘッダが設定されている"
echo "  □ pm2 が ecosystem.config.js で PORT=3000 で起動している"
echo "  □ ファイアウォールがポート 3000 をブロックしていない"
