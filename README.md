# Even G2 monorepo

Even G2向けの2つのプロジェクトを同じリポジトリで管理します。

```text
apps/cursor      Cursor CLI を音声で操作する Even Hub アプリ
servers/cursor   Cursor ACP の HTTP/SSE bridge
apps/term        SSH / nvim 端末。BTキーボード入力
servers/term     PTY/SSH bridge（xterm 画面バッファ）
```

どちらも Even Hub WebView がスマホ上で動き、G2 は 576×288 の表示とテンプル操作だけを担当します。bridge は Tailscale 上のリモートサーバーで動かします。

## プロジェクト

| 製品 | 用途 | ポート |
|---|---|---|
| Cursor G2 | 音声で Cursor CLI を操作 | 3456 |
| G2 Term | BTキーボードで SSH / nvim | 3457 |

共通の必要環境:

- Node.js 22以上
- Even Realities App 2.0.0以上、Even G2
- リモートサーバーとスマホが同じ Tailscale tailnet
- 開発時: `npm install`（リポジトリルート）

---

## G2 Term（SSH / BTキーボード / nvim）

G2 を小さな端末として使い、スマホにペアした Bluetooth キーボードで入力します。bridge 側で本物の PTY を開き、`@xterm/headless` で画面を再構成して G2 に送ります。nvim の alternate screen・カーソル・Ctrl / Esc がそのまま通る想定です。

```text
BTキーボード → スマホ WebView（hidden textarea）
Even G2 ← BLE テキストコンテナ（38x12）
スマホ → HTTPS + SSE / POST → servers/term
servers/term → node-pty（ssh -tt / nvim / shell）
```

### リモートサーバー

`node-pty` のビルドに `python3` / `make` / `g++` が必要です。

```bash
npm install
npm run build --workspace @g2-term/server
cp servers/term/.env.example /etc/g2-term.env
# /etc/g2-term.env を編集
set -a; . /etc/g2-term.env; set +a
npm start --workspace @g2-term/server
```

`BRIDGE_TOKEN` には十分長いランダム値を設定してください。`ALLOWED_PROJECT_ROOTS` の外の CWD は拒否します。SSH 先を絞るなら `ALLOWED_SSH_HOSTS` を設定します。ホスト名・ユーザー名・ポートはシェル文字列に連結せず、`ssh -tt -p <port> -l <user> <host>` として渡します。

systemd 雛形は `deploy/g2-term.service` です。サービスユーザーで `ssh` できる鍵 / agent を用意してください。

### Tailscale HTTPS

```bash
tailscale serve --bg https:3457 / http://127.0.0.1:3457
tailscale serve status
```

表示された origin を次へ設定します。

1. `apps/term/app.json` の `network.whitelist`
2. アプリ起動後、スマホ画面の Bridge URL

### Even Hub アプリ

```bash
npm run dev:term-app
npm run simulate --workspace @g2-term/app
```

パッケージ:

```bash
npm run build --workspace @g2-term/app
npm run pack --workspace @g2-term/app
```

生成物は `apps/term/g2-term.ehpk` です。

### BTキーボード

1. キーボードを **スマホ** にペアリングする（G2 本体ではなく Even App の WebView がキーを受ける）
2. G2 Term を前面にする
3. 「キーボードを掴む」を押す。以降 keydown を PTY に送る
4. 日本語 IME は変換確定後にまとめて送る（変換中のキーは送らない）

G2 操作:

| 操作 | 動作 |
|---|---|
| タップ | キーボード再フォーカス |
| 長押し | Escape（nvim を Normal に戻す） |
| 上スワイプ | PageUp |
| 下スワイプ | PageDown |
| ダブルタップ | 終了確認 |

スマホ画面にも Esc / Ctrl+C / Tab / Ctrl+Z ボタンがあります。

### nvim

セッション種類で `nvim（bridgeホスト）` を選ぶか、SSH 先で `nvim` を起動します。PTY は `TERM=xterm-256color`、既定 38×12 です。G2 のテキストコンテナは約 400–500 文字、等幅ではないので、これ以上広げると欠けます。

bridge は `servers/term/share/g2.lua` を `--cmd` で読み、ステータス行と signcolumn を削ります。自分の設定で上書きできます。

```lua
if vim.env.G2_TERM == "1" then
  -- 追加の G2 向け設定
end
```

---

## Cursor G2（音声で Cursor CLI）

Even G2 から、Tailscale 内のリモートサーバーで動く Cursor CLI を音声操作します。

```text
Even G2
  ↕ Bluetooth
Even App WebView (@evenrealities/even_hub_sdk)
  ↕ HTTPS + SSE (Tailscale)
Node.js bridge
  ↕ NDJSON / JSON-RPC 2.0 (stdio)
Cursor CLI (`agent acp`)
```

追加で必要なもの:

- リモートサーバーに Cursor CLI をインストールし、`agent login` 済み
- OpenAI 互換の音声文字起こし API

### リモートサーバー

```bash
npm install
npm run build --workspace @cursor-g2/server
cp servers/cursor/.env.example /etc/cursor-g2.env
# /etc/cursor-g2.env を編集
set -a; . /etc/cursor-g2.env; set +a
npm start --workspace @cursor-g2/server
```

`BRIDGE_TOKEN` には十分長いランダム値を設定してください。`ALLOWED_PROJECT_ROOTS` の外にある CWD は拒否されます。Cursor の API キーと STT キーはサーバーだけに置き、Even Hub アプリへ埋め込まないでください。

### Tailscale HTTPS

```bash
tailscale serve --bg https / http://127.0.0.1:3456
tailscale serve status
```

表示された URL を `apps/cursor/app.json` の `network.whitelist` と、アプリの Bridge URL に設定します。

systemd 雛形は `deploy/cursor-g2.service` です。

### Even Hub アプリ

```bash
npm run dev:cursor-app
npm run simulate --workspace @cursor-g2/app
```

パッケージ:

```bash
npm run build --workspace @cursor-g2/app
npm run pack --workspace @cursor-g2/app
```

生成物は `apps/cursor/cursor-g2.ehpk` です。

### 操作

| 画面 | 操作 | 動作 |
|---|---|---|
| セッション一覧 | スワイプ | 選択移動 |
| セッション一覧 | タップ | セッション選択、音声入力開始 |
| 応答 | 上下スワイプ | 前後のページ |
| 応答 | タップ | 録音開始/終了。Cursor実行中は中断 |
| 承認・質問 | 選択してタップ | 回答を送信 |
| 任意 | ダブルタップ | システム確認付きで終了 |

録音は発話後約1秒の無音で自動終了します。無音5秒、録音20秒でも終了します。

### API

- `GET /api/sessions`
- `POST /api/sessions`
- `POST /api/prompt`
- `GET /api/events?sessionId=...`（SSE）
- `POST /api/permission-response`
- `POST /api/question-response`
- `POST /api/plan-response`
- `POST /api/interrupt`
- `POST /api/transcribe`

セッション ID と CWD の対応は、既定で `~/.local/state/cursor-g2/sessions.json` に保存されます。

---

## 開発コマンド

```bash
npm run typecheck
npm test
npm run build
```
