# 土地区画作成工房

公図・測量図・建築図面などのPDFや画像を下絵として読み込み、区画、道路、計測、注記、図面出力を行うWindowsデスクトップアプリです。

## 現在の版

- バージョン: 2.1.0-alpha.10
- 対応OS: Windows 64bit
- 実行基盤: Electron

## alpha.10 の主な改善

- 区画・道路・水路の作図時と選択後を、種類別の固定メニューバーへ統一
- 独自ポップアップを極力使わず、入力終了時に自動確定する操作へ統一
- ゴシック・明朝・均等と、名称・幅員・面積・坪・辺寸法の文字設定を整理
- ページごとの縮尺を、直接設定と2点校正の間でいつでも再編集可能に変更
- 作業ファイルの保存・読込、種類固有設定、分割後IDを保護
- A4・A3縦横のPDF実寸と、300dpi PNGの物理解像度を検証

## 開発時の起動

```powershell
npm install
npm start
```

## 確認

```powershell
npm run qa:v210
node qa-v210-interaction.cjs
```

alpha.10 は総合QA 299 / 299項目、実操作QA 21 / 21項目に合格しています。

## Windowsインストーラー作成

```powershell
npm run dist:v210
```

生成先は `dist-installer-v210` です。配布物はGit管理対象外です。

## 主な構成

- `index-v210.html`: v2.1画面
- `jww-v210.css`: v2.1スタイル
- `v210/`: 作図・表示・入出力処理
- `main-v210.js`: Electronメイン処理
- `preload-v210.js`: Electron連携
- `electron-builder-v210.yml`: Windows配布設定
- `qa-v210.cjs`: 総合QA
- `qa-v210-interaction.cjs`: 実操作QA

詳細は `CHANGELOG.md`、`V210_FULL_FEATURE_SPEC.md`、`V210_OPERATION_SPEC.md` を参照してください。
