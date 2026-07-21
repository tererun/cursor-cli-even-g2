# Cursor CLI for Even G2

Even G2から、Tailscale内のリモートサーバーで動くCursor CLIを音声操作するEven Hubアプリです。

## 構成

```text
Even G2
  ↕ Bluetooth
Even App WebView (@evenrealities/even_hub_sdk)
  ↕ HTTPS + SSE (Tailscale)
Node.js bridge
  ↕ NDJSON / JSON-RPC 2.0 (stdio)
Cursor CLI (`agent acp`)
```

- G2でCursorセッションを選択
- G2マイクのPCM音声をサーバー側のOpenAI互換STTで文字起こし
- Cursor ACPへプロンプトを送信
- 応答・ツール実行状況をSSEでストリーミング
- 上下スワイプで出力ページを移動
- ツール権限、Cursorの質問、プラン承認をG2で回答
- タップで録音開始/終了、実行中はタップで中断、ダブルタップで終了

Cursor CLIにはネットワーク待受機能がないため、`server/` が認証付きHTTP/SSE brokerとしてACPプロセスをセッション単位で管理します。

## 必要環境

- Node.js 22以上
- Even Realities App 2.0.0以上、Even G2
- リモートサーバーとスマホが同じTailscale tailnetに参加
- リモートサーバーにCursor CLIをインストールし、`agent login`済み
- OpenAI互換の音声文字起こしAPI

## リモートサーバー

```bash
npm install
npm run build --workspace server
cp server/.env.example /etc/cursor-g2.env
# /etc/cursor-g2.env を編集
set -a; . /etc/cursor-g2.env; set +a
npm start --workspace server
```

`BRIDGE_TOKEN`には十分長いランダム値を設定してください。`ALLOWED_PROJECT_ROOTS`の外にあるCWDは拒否されます。CursorのAPIキーとSTTキーはサーバーだけに置き、Even Hubアプリへ埋め込まないでください。

### Tailscale HTTPS

bridgeをloopbackで起動し、Tailscale ServeでHTTPS化します。

```bash
tailscale serve --bg https / http://127.0.0.1:3456
tailscale serve status
```

表示されたURL（例 `https://devbox.tail1234.ts.net`）を次の2か所へ設定します。

1. `app/app.json`の`network.whitelist`
2. アプリ起動後、スマホ画面の`Bridge URL`

Even Hubのwhitelistは完全一致で、CORSを代替しません。公開版では`ALLOWED_ORIGINS=*`をWebViewの実際のoriginへ絞ることを推奨します。Tailscale ACLでも接続元を制限してください。

systemd用の雛形は`deploy/cursor-g2.service`にあります。サービスユーザー自身で`agent login`を実行し、プロジェクトと状態保存先へのアクセス権を与えてください。

## Even Hubアプリ

```bash
npm install
npm run dev:app
```

別ターミナルでシミュレータを起動します。

```bash
npm run simulate --workspace app
```

G2マイクをシミュレートする場合は、Simulatorが要求するaudio device IDを指定してください。実機またはQR sideloadでは、アプリのスマホ画面でBridge URLとtokenを入力します。新規セッション作成時のCWDはリモートサーバー上の絶対パスです。

### パッケージ

`app/app.json`のplaceholder URLを実際のTailscale HTTPS originへ変更してから実行します。

```bash
npm run build --workspace app
npm run pack --workspace app
```

生成物は`app/cursor-g2.ehpk`です。

## 操作

| 画面 | 操作 | 動作 |
|---|---|---|
| セッション一覧 | スワイプ | 選択移動 |
| セッション一覧 | タップ | セッション選択、音声入力開始 |
| 応答 | 上下スワイプ | 前後のページ |
| 応答 | タップ | 録音開始/終了。Cursor実行中は中断 |
| 承認・質問 | 選択してタップ | 回答を送信 |
| 任意 | ダブルタップ | システム確認付きで終了 |

録音は発話後約1秒の無音で自動終了します。無音5秒、録音20秒でも終了します。

## API

bridgeはBearer認証付きで以下を公開します。

- `GET /api/sessions`
- `POST /api/sessions`
- `POST /api/prompt`
- `GET /api/events?sessionId=...`（SSE）
- `POST /api/permission-response`
- `POST /api/question-response`
- `POST /api/plan-response`
- `POST /api/interrupt`
- `POST /api/transcribe`

セッションIDとCWDの対応は、既定で`~/.local/state/cursor-g2/sessions.json`に保存されます。bridge再起動後は`session/load`で再開します。

## 開発コマンド

```bash
npm run typecheck
npm test
npm run build
```