# 土地区画作成工房

公図・測量図・建築図面などのPDFや画像を下絵として読み込み、区画、道路、計測、注記、図面出力を行うWindowsデスクトップアプリです。

## 現在の版

- バージョン: 2.1.0-alpha.8
- 対応OS: Windows 64bit
- 実行基盤: Electron

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
