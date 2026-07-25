# GitHub Pages で公開する手順

ポアンカレ球ビューアはビルド工程のない静的 Web アプリ（HTML + ES Module + Three.js CDN）なので、
ファイルをそのまま GitHub Pages に置くだけで動作します。公開すれば PC でサーバーを立てずに、
iPhone などのスマートフォンからも URL を開くだけで利用できます。

## 前提条件

| 項目 | 内容 |
|------|------|
| リポジトリの公開設定 | **無料プランでは公開（Public）リポジトリのみ** GitHub Pages を使えます。プライベートリポジトリで Pages を使うには GitHub Pro / Team 以上が必要です |
| 閲覧側のブラウザ | importmap を使っているため **iOS 16.4 以降の Safari**、または最新の Chrome / Edge / Firefox |
| 閲覧側のネット接続 | Three.js を CDN から読み込むため、閲覧時にもインターネット接続が必要 |

> **注意**: このリポジトリ（`xaihara-b4/claude-code-book-template`）は現在プライベートです。
> 無料プランのまま公開する場合は、リポジトリを Public に変更するか、
> ポアンカレ球ビューアだけを別の Public リポジトリに切り出してください。
> Public にするとリポジトリ内の**すべてのファイルが誰でも閲覧可能**になる点に注意してください。

## 方法 A: ブランチから直接公開する（最も簡単）

リポジトリ全体を Pages のルートとして公開し、サブフォルダの URL でアプリを開く方法です。

1. GitHub でリポジトリを開き、**Settings → Pages** に移動する
2. 「Build and deployment」の **Source** で **Deploy from a branch** を選ぶ
3. **Branch** で `main`、フォルダで `/ (root)` を選び **Save** を押す
4. 1〜2 分待つと公開される。アプリの URL は次のとおり:

```
https://xaihara-b4.github.io/claude-code-book-template/PoincareSphere/
```

`index.html` は `main.js` を相対パスで読み込んでいるため、サブフォルダ配下でもそのまま動作します。
`server.js` や `package.json` も一緒に公開されますが、動作には影響しません（ローカル実行専用のファイルです）。

## 方法 B: GitHub Actions で PoincareSphere フォルダだけを公開する

リポジトリの他のファイル（ブロック崩しゲームやドキュメントなど）を Pages に含めたくない場合は、
GitHub Actions という自動実行の仕組みを使って、`PoincareSphere/` フォルダの中身**だけ**を
Web サイトとして公開できます。一度設定すれば、以後はファイルを push するたびに自動で公開内容が更新されます。

### 手順 1: GitHub 側の設定を切り替える

1. ブラウザで `claude-code-book-template` リポジトリ
   （https://github.com/xaihara-b4/claude-code-book-template ）を開く
2. 上部タブの **Settings** をクリックし、左メニューの **Pages** を開く
3. 「Build and deployment」の **Source** プルダウンで **GitHub Actions** を選ぶ
   （この時点では何も公開されません。次の手順でワークフローファイルを push すると公開が始まります）

### 手順 2: ワークフローファイルを作成する

「ワークフローファイル」とは、GitHub に自動でやってほしい作業（ここでは
「`PoincareSphere/` フォルダを Web サイトとして公開する」）を書いた設定ファイルです。

置き場所は **`claude-code-book-template` リポジトリのルート**（いちばん上の階層）にある
`.github/workflows/` フォルダの中です。`PoincareSphere` フォルダの**中ではない**ことに注意してください。
つまり、リポジトリ全体では次のような配置になります:

```
claude-code-book-template/          ← リポジトリのルート
├── .github/                        ← 新規作成（先頭のドット . を忘れずに）
│   └── workflows/                  ← 新規作成
│       └── pages.yml               ← 今回作るファイル
├── PoincareSphere/                 ← 公開したいアプリ本体（ここには置かない）
│   ├── index.html
│   ├── main.js
│   └── ...
├── docs/
├── index.html                      ← ブロック崩し（今回は公開されない）
└── ...
```

`.github/workflows/pages.yml` を次の内容で作成します:

```yaml
name: Deploy PoincareSphere to GitHub Pages

on:
  push:
    branches: [main]
    paths: ['PoincareSphere/**']
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: PoincareSphere
      - id: deployment
        uses: actions/deploy-pages@v4
```

### 手順 3: push して公開を確認する

作成したファイルをコミットして `main` ブランチに push します。
コマンドで行う場合は、リポジトリのルート（`claude-code-book-template` フォルダ）で:

```bash
git add .github/workflows/pages.yml
git commit -m "GitHub Pages 公開用ワークフローを追加"
git push
```

push すると GitHub が自動でワークフローを実行します。進行状況はリポジトリ上部の
**Actions** タブで確認でき、「Deploy PoincareSphere to GitHub Pages」に
緑のチェックマークが付けば公開完了です（通常 1〜2 分）。

アプリの URL は次のとおりです。方法 A と違い `PoincareSphere/` フォルダの中身が
サイトの最上位になるため、URL に `/PoincareSphere/` は**付きません**:

```
https://xaihara-b4.github.io/claude-code-book-template/
```

以後は `PoincareSphere/` 配下のファイルを変更して `main` に push するたびに、
自動で再デプロイされて公開内容が更新されます（ワークフロー冒頭の `paths` 設定により、
それ以外のファイルだけを変更した push では実行されません）。

## スマートフォン（iPhone）で使うときの注意

- Safari で上記 URL を開くだけで動作します。メイン 3D ビューは **1 本指ドラッグで回転、ピンチでズーム**できます
- 現在のレイアウトはデスクトップ前提（左パネル固定幅 280px）のため、**縦画面では 3D ビューが非常に狭くなります。横画面での利用を推奨**します
- ホーム画面に追加（共有メニュー →「ホーム画面に追加」）すると、アプリのように全画面で起動できます

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| 404 Not Found | デプロイ完了まで 1〜2 分待つ。方法 A では URL 末尾に `/PoincareSphere/` が付いているか確認する |
| Pages の設定項目が表示されない | リポジトリがプライベートのままになっていないか（無料プランの場合）確認する |
| 画面が真っ黒でエラーになる | ブラウザが importmap に対応しているか確認する（iOS は 16.4 以降）。閲覧側のインターネット接続（CDN アクセス）も確認する |
| push しても更新されない（方法 B） | 変更が `PoincareSphere/` 配下か確認する（それ以外の変更ではワークフローが起動しない）。Actions タブで実行結果を確認する |

## 関連ドキュメント

- ローカルでの起動方法・使い方: [README.md](README.md)
- アプリの仕組みの解説: [../docs/poincare-sphere.md](../docs/poincare-sphere.md)
