# ETF スクリーナー

初心者でも「このETFが割安か割高か」が一目でわかる、自然言語で自己進化する ETF 分析ツール。

## 機能（フェーズ1）

- 5 つの必須スライダー（経費率 / AUM / 配当利回り / 1 年リターン / ベータ）
- 🟢🟡🔴 の信号機で割安・割高を判定（理由つき）
- 8 カテゴリ切替（米国全体 / 日本全体 / テクノロジー / ヘルスケア / 金融 / 高配当 / 新興国 / 債券）
- 常設チャットで指標を動的に追加・削除・フィルタ変更・質問
- ETF 詳細ページ（判定理由 / 全指標 / 5 年価格チャート / 構成セクター）

## セットアップ

推奨環境: **Python 3.11 または 3.12**（widest wheel 対応）。
3.13/3.14 でも動きますが、ビルド時に wheel が無いライブラリがあるとソースコンパイルを要求されます。

```powershell
# 1) 依存関係 (必ず python -m pip を使う。バイナリホイールのみに限定)
python -m pip install --upgrade pip
python -m pip install --only-binary=:all: -r requirements.txt

# 2) 環境変数 (.env をコピーして編集)
copy .env.example .env
# .env の ANTHROPIC_API_KEY=sk-ant-... を埋める

# 3) 初回データ取得 (数分かかります, 103 銘柄)
python -m scripts.update_data

# 4) 起動 (streamlit コマンドが PATH に無い場合は python -m streamlit で起動)
python -m streamlit run app.py
```

API キーが未設定でもアプリは起動し、基本機能は使えます（チャットはルールベースのスタブ応答になります）。

### トラブルシュート

#### ① `pandas` や `numpy` のビルドで `vswhere.exe` が無いと言われる
Python 3.14 などでビルド済み wheel が存在しない場合に発生します。対策:

```powershell
# 方法A: 最新の wheel を拾わせる (requirements.txt は >= 指定済み)
python -m pip install --only-binary=:all: --upgrade pandas numpy

# 方法B: Python 3.12 を Microsoft Store から入れてそちらで仮想環境を作る
py -3.12 -m venv .venv
.venv\Scripts\activate
python -m pip install --only-binary=:all: -r requirements.txt
```

#### ② `streamlit` が「用語として認識されません」
`pip install` が途中で失敗すると PATH にスクリプトが登録されません。下記で回避:

```powershell
python -m streamlit run app.py
```

もしくは

```powershell
python -m pip install --only-binary=:all: streamlit
# インストール先 (Scripts フォルダ) を PATH に追加
```

#### ③ OneDrive 配下で SQLite が固まる
本プロジェクトは OneDrive 同期フォルダ内で動きますが、ファイルロックで警告が出ることがあります。
回避するには `.env` に `DB_PATH=%USERPROFILE%\etf_data.db` のようにローカル保存先を指定してください。

## ディレクトリ

```
etf-screener/
├── app.py                 Streamlit エントリポイント
├── requirements.txt
├── render.yaml            Render (web + cron) デプロイ設定
├── data/
│   ├── etf_list.csv       初期 103 銘柄
│   └── etf_data.db        SQLite (自動生成)
├── src/
│   ├── config.py          パスと環境変数
│   ├── data_fetcher.py    yfinance からの取得
│   ├── database.py        SQLite CRUD
│   ├── signal_logic.py    信号機判定
│   ├── claude_client.py   Claude API (意図解析 + 会話)
│   └── indicator_manager.py  自然言語で追加された指標の保存/取得
└── scripts/
    └── update_data.py     毎日の取得ジョブ
```

## 信号機ルール（仕様書 3.3）

- 🟢 **割安**: PER が 5 年平均より 10% 以上低く、経費率 ≤ 0.2%、直近 3 ヶ月 -5% 以上の下落
- 🔴 **割高**: PER が 5 年平均より 10% 以上高く、直近 1 年で 30% 以上上昇
- 🟡 **中立**: 上記以外

## デプロイ

### Railway （推奨）

本リポジトリにはあらかじめ `railway.toml` / `Procfile` / `nixpacks.toml` / `runtime.txt` / `start.sh` を同梱しています。

1. **GitHub にリポジトリを push** （プライベートでも OK）
2. Railway ダッシュボードで `New Project` → `Deploy from GitHub repo` で本リポジトリを選択
3. **Service Settings** で次の値を設定
   - Root Directory: `etf-screener`（モノレポでない場合は不要）
   - Build Command: 空（nixpacks.toml が自動で実行）
   - Start Command: `bash start.sh`（railway.toml で自動設定）
4. **Variables** タブで以下を追加
   - `ANTHROPIC_API_KEY` = `sk-ant-...`
   - `ANTHROPIC_MODEL` = `claude-sonnet-4-5`
   - `DB_PATH` = `/data/etf_data.db`
5. **Volumes** タブで Volume を作成し `/data` にマウント（SQLite 永続化用、無料 0.5GB で十分）
6. **Networking** タブで `Generate Domain` を押して公開 URL を発行
7. Deploy が完了すると `https://etf-screener-production-xxxx.up.railway.app` のような URL でアクセス可能

初回デプロイ時に `start.sh` が DB を初期化し、メトリクスが空なら裏で `update_data.py` を走らせて 103 銘柄を取得します（数分）。
ブラウザでアクセス直後は空でも、リロードすれば徐々に埋まっていきます。

### Render （オリジナル仕様）

`render.yaml` を Blueprint で読み込めばそのままデプロイ可能。`ANTHROPIC_API_KEY` を Render UI で設定してください。

## 既知の制約 / TODO

- `avg_per_5y` は `forwardPE` を簡易代替としている。本格運用時は PER 履歴を DB で積み上げる。
- ETF 構成銘柄 / セクター情報は yfinance で取れない銘柄が多い。
- フェーズ 2〜3（お気に入り / 価格アラート / 動的 UI / ポートフォリオシミュレーション）は未実装。
