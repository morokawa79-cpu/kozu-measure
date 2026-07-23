// ===== 公図 計測ツール =====

// Electron（file:プロトコル）ではvendorのローカルワーカー、ブラウザではCDNを使用
pdfjsLib.GlobalWorkerOptions.workerSrc =
  (window.location.protocol === 'file:')
    ? 'vendor/pdf.worker.min.js'
    : 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// 日本語CAD系PDF（測量図・公図など）の文字を正しく描画するためのCMap／標準フォント設定。
// Electron（file:プロトコル）ではローカルのカスタムプロトコル、ブラウザではCDNを使用。
const _isElectron = typeof window !== 'undefined' && window.location.protocol === 'file:';
const PDFJS_OPTS = _isElectron ? {
  cMapUrl: 'pdfres://cmaps/',
  cMapPacked: true,
  standardFontDataUrl: 'pdfres://fonts/',
} : {
  cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/',
};

const COLORS = ['#f87171','#60a5fa','#34d399','#fbbf24','#a78bfa','#fb923c','#38bdf8','#f472b6'];

// ===== 状態 =====
const App = {
  // PDF / 画像
  pdf: null, pdfBytes: null,
  pageNum: 1, pageCount: 0,
  renderScale: 4,
  pageWidthPt: 0, pageHeightPt: 0,
  pdfOffscreen: document.createElement('canvas'),
  pdfReady: false,
  isImageMode: false,  // true = Googleマップ画像モード

  // 縮尺
  mapScale: null,
  mpp: null,

  // ビューポート
  vx: 0, vy: 0, vz: 1,
  panning: false, panSX: 0, panSY: 0, panVX: 0, panVY: 0,

  // モード
  mode: 'distance',
  pts: [],
  mx: 0, my: 0,

  // 計測・アノテーション
  items: [],    // 距離・折れ線・面積・矢印
  texts: [],    // メモテキスト・引出線
  nextId: 1,

  // Undo/Redo スタック
  undoStack: [],  // [{items, texts}]
  redoStack: [],

  showSideLengths: true,

  // キャリブレーション
  calibrating: false, calibPts: [],

  // 移動モード
  draggingId: null,
  dragLabelKey: null,
  dragIsText: false,
  dragOffX: 0, dragOffY: 0,
  dragPending: false,
  dragStartSX: 0, dragStartSY: 0,

  // 計測アイテム丸ごとドラッグ（図形移動モード）
  draggingItemId: null,
  dragItemStartX: 0, dragItemStartY: 0,
  dragItemOrigPts: null,
  dragItemOrigLabelPos: null,
  dragItemOrigSegLabelPos: null,

  // ラベルヒットボックス (render中に更新)
  labelBoxes: [],

  // メモ入力
  pendingTextPos: null,
  pendingCalloutTip: null,  // 引出線の先端座標
  editingTextId: null,      // 編集中のテキストID

  // 計測・矢印の使用色
  strokeColor: '#f87171',

  // 線ツール（実線/破線/点線・色・太さ）
  lineStyle: 'solid',   // 'solid' | 'dashed' | 'dotted'
  lineColor: '#1a1a1a',
  lineWidth: 2,         // px（キャンバス座標基準の太さ係数）

  // テキストオプション（メモパネルで選択）
  textOptions: { fontSize: 14, fontFamily: 'gothic', color: '#1a1a1a', bgColor: 'rgba(255,255,220,0.92)', boxStyle: 'box', vertical: false, rotation: 0 },

  // カラーピッカー
  cpTargetId: null,
  cpTargetIsText: false,

  // 印刷
  printSize: 'A3',

  // 用紙モード（サイズはPDF座標系に合わせる: points × renderScale）
  paperMode: false,
  paperSize: 'A4',
  paperW: 3368,  // A4横: 842pt × renderScale(4)
  paperH: 2380,  // A4横: 595pt × renderScale(4)

  // ===== 分譲地モード =====
  appMode: 'subdivision',  // 常に分譲地モード
  lots: [],                // 区画データ
  lotNextNum: 1,           // 次の区画番号
  lotPts: [],              // 描画中の頂点リスト（面積ツールと同じ方式）
  gridSnap: true,          // グリッドスナップ（デフォルトON）
  lotTool: 'draw',         // 'draw' | 'road' | 'split' | 'split-all' | 'merge'
  mergeSelect: [],         // 合筆モードで選択中の区画ID
  lotStrokeColor: '#fff0bd',
  lotBorderColor: '#a46a08',   // 区画の線の色（グローバル）
  lotFillOpacity: 0.58,      // 区画塗り色の不透明度（0〜1）
  lotTextScale: 1.4,         // ラベル文字サイズ倍率（番号・面積）
  lotEdgeScale: 1.0,         // 寸法線テキストサイズ倍率
  subMeasureScale: 0.9,      // 測定・注記テキストサイズ倍率
  lotShowEdgeLengths: true,  // 辺の長さ表示ON/OFF
  divGuideN: 2,              // 均等分割数
  divGuides: [],             // [{id,p1,p2,n}]
  draggingLotId: null,
  dragLotOffX: 0, dragLotOffY: 0,
  draggingLotLabelId: null,
  draggingRoadLabelPart: null,
  dragLotLabelOffX: 0, dragLotLabelOffY: 0,
  draggingEdgeLabelLotId: null,  // 寸法テキストドラッグ中の区画ID
  draggingEdgeLabelEdge: -1,     // 寸法テキストドラッグ中の辺インデックス
  dragEdgeLabelOffX: 0, dragEdgeLabelOffY: 0,
  parallelBase: null,    // {p1,p2} 平行線のベース
  parallelFlip: 1,       // +1 or -1
  parallelCount: 0,      // 「作成」ボタン用カウンター
  parallelDivCount: 0,   // 「分割線として引く」ボタン用カウンター（独立）
  snapPt: null,          // スナッププレビュー座標
  snapType: null,        // 'vertex'|'intersection'|'grid'|null
  splitTargetId: null,   // 分割対象の区画ID
  imageRotation: 0,      // 背景画像の回転角度（0/90/180/270）
  bgScale: 1.0,          // 下絵のみのスケール
  bgOffsetX: 0,          // 下絵のみのX位置オフセット（canvas座標）
  bgOffsetY: 0,          // 下絵のみのY位置オフセット（canvas座標）
  bgRotation: 0,         // 下絵のみの回転角度（度）
  bgLocked: true,        // v1.4: 下絵調整の誤操作防止
  cornerCutLotId: null,  // 隅切り対象の区画ID
  cornerCutIdx: -1,      // 隅切り対象の頂点インデックス
  dragLotOrigPoints: null, // ドラッグ開始時の区画頂点コピー
  dragLotOrigCen: null,    // ドラッグ開始時の重心
  moveAllDragging: false,  // 全体移動ドラッグ中
  moveAllStartX: 0, moveAllStartY: 0,  // 開始キャンバス座標
  moveAllOrigLots: null,   // 開始時の区画データコピー
  moveAllOrigItems: null,  // 開始時の計測データコピー
  moveAllOrigTexts: null,  // 開始時のテキストデータコピー

  // 約表記
  useYaku: false,
  yakuDecimal: 1,
  yakuAdjust: 0,

  // 用紙情報（タイトルブロック）
  paperInfo: { title: '', date: '', author: '' },

  // 北マーク
  northArrowAngle: 0,
  northArrowSize: 1.0,
  editingNorthArrowId: null,

  // スタンプ（家屋・駐車場）
  stampWM: 10,
  stampHM: 8,
  stampAngle: 0,
  stampShowDims: true,
  editingStampId: null,

  // 配置前プレビュー（表示専用。保存データやヒット判定には含めない）
  placementPreviewInside: false,

  // コピー＆ペースト
  lastClicked: null,   // { type: 'lot'|'text'|'item', id }
  clipboardData: null, // { type, data }

  // 右パネル「選択中の書式」の対象（回転UI用）
  selectedFormat: null, // { kind: 'text'|'lot-label'|'road-label'|'stamp'|'north', id }

  // 区画番号表示
  showLotNumbers: true,

  // 頂点移動
  draggingVertex: null,     // { itemId, ptIndex } 計測アイテムの頂点
  draggingLotVertex: null,  // { lotId, ptIndex } 区画の頂点

  // ラベル編集
  editingLabelItem: null,    // 編集中の計測アイテム（null = 区画辺編集）
  editingLabelKey: null,     // 'main' | 'seg0' | 'seg1' ...
  editingLotId: null,        // 区画辺/中央ラベル編集中の区画ID
  editingLotEdgeIdx: null,   // 区画辺編集中の辺インデックス
  editingLotCenterKey: null, // 区画中央ラベル編集キー ('area' | 'tsubo')
  _editingLabelColor: '',    // ラベル編集中の選択色（''=自動）
  _hoverLabelKey: null,      // ホバー中ラベルのkey（itemId_labelKey形式）

  dirty: true,
};

let canvas, ctx;
let _stampEditSession = null;
let _northEditSession = null;
let _memoEditSession = null;

function notifyAppState(reason = 'state') {
  document.dispatchEvent(new CustomEvent('kozu:statechange', { detail: { reason } }));
}

function notifyProjectLifecycle(type, detail = {}) {
  document.dispatchEvent(new CustomEvent(`kozu:project-${type}`, { detail }));
}

// 角度UIと保存値で共通の正規形を使う。315°→-45°、270°→-90°。
// canonical range は [-180, 180)（UIの許容範囲は -180..180）。
function normalizeObjectAngle(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const normalized = ((numeric + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function syncAngleControls(numberInput, sliderInput, value) {
  const angle = normalizeObjectAngle(value);
  if (numberInput) {
    numberInput.min = '-180';
    numberInput.max = '180';
    numberInput.value = String(angle);
  }
  if (sliderInput) {
    sliderInput.min = '-180';
    sliderInput.max = '180';
    sliderInput.value = String(angle);
  }
  return angle;
}

// オーバーレイバーをツールバー直下に配置（DOMContentLoaded外から呼べるようモジュールレベルで定義）
function positionOverlayBar(barEl) {
  const tb = document.getElementById('toolbar');
  if (tb && barEl) barEl.style.top = tb.getBoundingClientRect().bottom + 'px';
}

// ===== 初期化 =====
window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', () => {
    resizeCanvas();
    // オーバーレイバーの位置を再計算
    ['paper-info-bar', 'bg-adjust-bar'].forEach(id => {
      const b = document.getElementById(id);
      if (b && !b.classList.contains('hidden')) positionOverlayBar(b);
    });
  });
  bindEvents();
  setAppMode('subdivision');
  setScaleDisplay('縮尺: 未設定');  // ボタンラベルを初期化
  renderLoop();
});

function resizeCanvas() {
  const c = document.getElementById('canvas-container');
  canvas.width = c.clientWidth;
  // The beta UI reserves a real row for the canvas toolbar instead of
  // floating it over the drawing surface. Keep the canvas bitmap and its CSS
  // box the same size so pointer coordinates remain exact.
  const toolbarHeight = document.getElementById('next-canvas-toolbar')?.getBoundingClientRect().height || 0;
  canvas.height = Math.max(1, c.clientHeight - toolbarHeight);
  App.dirty = true;
}

// ===== 下絵管理 =====
function clearBackground() {
  App.pdfReady = false;
  App.pdfBytes = null;
  App.pdf = null;
  App.bgScale = 1.0; App.bgOffsetX = 0; App.bgOffsetY = 0;
  const hasDrawings = App.lots.length > 0 || App.items.length > 0 || App.texts.length > 0;
  document.getElementById('drop-zone').style.display = hasDrawings ? 'none' : '';
  App.dirty = true;
}

async function replaceBgPDF(file) {
  try {
    const buf = await file.arrayBuffer();
    App.pdfBytes = new Uint8Array(buf);
    App.isImageMode = false;
    App.pdf = await pdfjsLib.getDocument({ data: App.pdfBytes, ...PDFJS_OPTS }).promise;
    App.pageCount = App.pdf.numPages;
    App.pageNum = 1;
    App.bgScale = 1.0; App.bgOffsetX = 0; App.bgOffsetY = 0;
    document.getElementById('page-nav').classList.remove('hidden');
    // 縮尺・図形は保持したまま背景のみ更新
    const page = await App.pdf.getPage(1);
    const vp = page.getViewport({ scale: App.renderScale });
    App.pdfOffscreen.width = vp.width; App.pdfOffscreen.height = vp.height;
    App.pageWidthPt = page.view[2];
    App.pageHeightPt = page.view[3];
    await page.render({ canvasContext: App.pdfOffscreen.getContext('2d'), viewport: vp }).promise;
    App.pdfReady = true;
    document.getElementById('drop-zone').style.display = 'none';
    App.dirty = true;
    notifyProjectLifecycle('background-loaded', { name: file.name, kind: 'pdf' });
  } catch (e) {
    notifyProjectLifecycle('error', { action: 'background-load', message: e.message });
    showToast('PDFを読み込めませんでした: ' + e.message, 4000);
  }
}

// ===== PDF / 画像ロード =====
async function loadPDF(file) {
  try {
    const buf = await file.arrayBuffer();
    App.pdfBytes = new Uint8Array(buf);
    App.isImageMode = false;
    App.pdf = await pdfjsLib.getDocument({ data: App.pdfBytes, ...PDFJS_OPTS }).promise;
    App.pageCount = App.pdf.numPages;
    App.pageNum = 1;
    document.getElementById('page-nav').classList.remove('hidden');
    await renderPDFPage(1);
    notifyProjectLifecycle('loaded', { name: file.name, kind: 'pdf' });
  } catch (e) {
    notifyProjectLifecycle('error', { action: 'load', message: e.message });
    showToast('PDFを読み込めませんでした: ' + e.message, 4000);
  }
}

async function loadImage(file, keepDrawings = false) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    App.pdfOffscreen.width = img.width;
    App.pdfOffscreen.height = img.height;
    App.pageWidthPt = img.width;
    App.pageHeightPt = img.height;
    App.pdfOffscreen.getContext('2d').drawImage(img, 0, 0);
    App.pdfReady = true;
    App.isImageMode = true;
    App.pdfBytes = null;
    App.bgScale = 1.0; App.bgOffsetX = 0; App.bgOffsetY = 0;
    if (!keepDrawings) {
      App.mapScale = null; App.mpp = null;
      setScaleDisplay('縮尺未設定 — スケールバーで「縮尺設定」してください');
      clearMeasurements(false);
    }
    document.getElementById('drop-zone').style.display = 'none';
    fitToView();
    App.dirty = true;
    URL.revokeObjectURL(url);
    notifyProjectLifecycle(keepDrawings ? 'background-loaded' : 'loaded', { name: file.name, kind: 'image' });
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    notifyProjectLifecycle('error', { action: keepDrawings ? 'background-load' : 'load', message: '画像を開けませんでした' });
    showToast('画像を読み込めませんでした', 4000);
  };
  img.src = url;
}

async function renderPDFPage(num, skipRescale = false) {
  // 前のレンダリングが残っていればキャンセル（連続読み込み・ページ送り時の競合で文字が落ちる問題対策）
  if (App._renderTask) { try { App._renderTask.cancel(); } catch (e) {} App._renderTask = null; }
  const page = await App.pdf.getPage(num);
  const vp = page.getViewport({ scale: App.renderScale });
  App.pdfOffscreen.width = vp.width;
  App.pdfOffscreen.height = vp.height;
  App.pageWidthPt = page.view[2];
  App.pageHeightPt = page.view[3];

  const _ctx = App.pdfOffscreen.getContext('2d');
  _ctx.clearRect(0, 0, App.pdfOffscreen.width, App.pdfOffscreen.height);
  const _task = page.render({ canvasContext: _ctx, viewport: vp });
  App._renderTask = _task;
  try {
    await _task.promise;
  } catch (e) {
    if (e && e.name === 'RenderingCancelledException') return; // キャンセルは正常終了扱い
    throw e;
  }
  App._renderTask = null;
  App.pdfReady = true;

  const detected = await detectScale(page);
  if (detected) {
    setMapScale(detected, skipRescale);
    setScaleDisplay(`縮尺 1/${detected} (自動検出)`);
  } else {
    App.mpp = null;
    setScaleDisplay('縮尺不明 — 縮尺設定ボタンで設定を');
  }

  document.getElementById('drop-zone').style.display = 'none';
  fitToView();
  updatePageInfo();
  App.dirty = true;
}

async function detectScale(page) {
  try {
    const tc = await page.getTextContent();
    const text = tc.items.map(i => i.str).join('');
    const pats = [
      /縮尺[　\s]*1[\/／]([0-9,，]+)/,
      /S[=＝][　\s]*1[\/／]([0-9,，]+)/,
      /1[\/／]([0-9,，]{2,6})/,
      /1[：:]([0-9,，]{2,6})/,
    ];
    for (const p of pats) {
      const m = text.match(p);
      if (m) {
        const v = parseInt(m[1].replace(/[,，]/g, ''));
        if (v >= 50 && v <= 100000) return v;
      }
    }
  } catch (_) {}
  return null;
}

// ===== 縮尺変更時に全座標をリスケール =====
function rescaleAll(factor) {
  if (!factor || Math.abs(factor - 1) < 1e-9) return;
  const sc = p => ({ x: p.x * factor, y: p.y * factor });
  App.lots.forEach(lot => {
    if (lot.points) lot.points = lot.points.map(sc);
    if (lot.labelOffX != null) { lot.labelOffX *= factor; lot.labelOffY *= factor; }
    if (lot.edgeLabelOffsets) {
      Object.keys(lot.edgeLabelOffsets).forEach(k => {
        const o = lot.edgeLabelOffsets[k]; o.dx *= factor; o.dy *= factor;
      });
    }
  });
  App.items.forEach(item => {
    if (item.points) item.points = item.points.map(sc);
    if (item.x1 != null) { item.x1 *= factor; item.y1 *= factor; item.x2 *= factor; item.y2 *= factor; }
    if (item.tipX != null) { item.tipX *= factor; item.tipY *= factor; }
    if (item.labelPos) { item.labelPos.x *= factor; item.labelPos.y *= factor; }
    if (item.segLabelPos) item.segLabelPos = item.segLabelPos.map(p => p ? sc(p) : p);
    if (item.offsetX != null) { item.offsetX *= factor; item.offsetY *= factor; }
  });
  App.texts.forEach(t => {
    t.x *= factor; t.y *= factor;
    if (t.tipX != null) { t.tipX *= factor; t.tipY *= factor; }
  });
  if (App.divGuides) App.divGuides.forEach(g => { g.p1 = sc(g.p1); g.p2 = sc(g.p2); });
}

// ===== 縮尺 =====
function setMapScale(scale, skipRescale = false) {
  const oldMpp = App.mpp;
  const newMpp = (25.4 * scale) / (72 * App.renderScale * 1000);
  if (!skipRescale && oldMpp && Math.abs(oldMpp - newMpp) > 1e-12) {
    rescaleAll(oldMpp / newMpp);
  }
  App.mapScale = scale;
  App.mpp = newMpp;
}

function showToast(msg, duration = 2000) {
  let el = document.getElementById('_toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '_toast';
    el.style.cssText = 'position:fixed;bottom:42px;left:50%;max-width:min(560px,calc(100vw - 24px));box-sizing:border-box;transform:translateX(-50%);background:#1d4ed8;color:#fff;padding:9px 16px;border-radius:8px;font-size:13px;line-height:1.45;text-align:center;white-space:normal;z-index:9999;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,0.28);transition:opacity 0.3s';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._tid);
  el._tid = setTimeout(() => { el.style.opacity = '0'; }, duration);
}

function escapeHtmlText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showInlineConfirm(message, { confirmLabel = '実行する', onConfirm } = {}) {
  document.getElementById('_action-confirm')?.remove();
  const panel = document.createElement('div');
  panel.id = '_action-confirm';
  panel.setAttribute('role', 'alertdialog');
  panel.setAttribute('aria-modal', 'false');
  panel.style.cssText = 'position:fixed;z-index:10000;right:12px;bottom:40px;left:12px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;max-width:720px;margin:0 auto;padding:12px 14px;border:1px solid #f5c2c7;border-radius:10px;color:#842029;background:#fff5f5;box-shadow:0 12px 30px rgba(15,23,42,.22);font-size:12px;line-height:1.45';
  const text = document.createElement('div');
  text.style.cssText = 'min-width:min(280px,100%);flex:1 1 360px';
  text.textContent = message;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'やめる';
  cancel.style.cssText = 'min-height:34px;padding:0 12px;border:1px solid #cbd5e1;border-radius:6px;color:#475569;background:#fff;font-weight:700;cursor:pointer';
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.textContent = confirmLabel;
  confirm.style.cssText = 'min-height:34px;padding:0 13px;border:1px solid #dc2626;border-radius:6px;color:#fff;background:#dc2626;font-weight:700;cursor:pointer';
  const close = () => panel.remove();
  cancel.addEventListener('click', close);
  confirm.addEventListener('click', () => {
    close();
    onConfirm?.();
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  });
  panel.append(text, cancel, confirm);
  document.body.append(panel);
  cancel.focus({ preventScroll: true });
}

function setScaleDisplay(text) {
  const el = document.getElementById('scale-display');
  el.textContent = text;
  const isUnset = !App.mpp;
  el.classList.toggle('unset', isUnset);
}

// ===== ビューポート =====
function fitToView() {
  if (App.paperMode) { fitPaperToView(); return; }
  if (!App.pdfReady) return;
  const cw = canvas.width, ch = canvas.height;
  const pw = App.pdfOffscreen.width, ph = App.pdfOffscreen.height;
  const z = Math.min(cw / pw, ch / ph) * 0.92;
  App.vz = z;
  App.vx = (cw - pw * z) / 2;
  App.vy = (ch - ph * z) / 2;
  updateZoomInfo();
  App.dirty = true;
}

// 全図形を用紙の中央に移動（用紙モード切り替え時に呼ぶ）
function centerDrawingsOnPaper() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const addPt = (x, y) => {
    if (x == null || y == null || !isFinite(x) || !isFinite(y)) return;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  App.lots.forEach(l => { if (l.points) l.points.forEach(p => addPt(p.x, p.y)); });
  App.items.forEach(i => {
    if (i.points) i.points.forEach(p => addPt(p.x, p.y));
    if (i.tipX != null) addPt(i.tipX, i.tipY);
    if (i.labelPos) addPt(i.labelPos.x, i.labelPos.y);
  });
  App.texts.forEach(t => {
    addPt(t.x, t.y);
    if (t.tipX != null) addPt(t.tipX, t.tipY);
  });
  if (!isFinite(minX)) return; // 図形なし

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // 用紙中央（タイトルブロック分を考慮して少し上寄り）
  const px = App.paperW / 2;
  const py = App.paperH * 0.44;
  const dx = px - cx;
  const dy = py - cy;

  App.lots.forEach(l => {
    if (l.points) l.points.forEach(p => { p.x += dx; p.y += dy; });
  });
  App.items.forEach(i => {
    if (i.points) i.points.forEach(p => { p.x += dx; p.y += dy; });
    if (i.tipX != null) { i.tipX += dx; i.tipY += dy; }
    if (i.labelPos) { i.labelPos.x += dx; i.labelPos.y += dy; }
    if (i.segLabelPos) i.segLabelPos.forEach(p => { if (p) { p.x += dx; p.y += dy; } });
  });
  App.texts.forEach(t => {
    t.x += dx; t.y += dy;
    if (t.tipX != null) { t.tipX += dx; t.tipY += dy; }
  });
}

function fitPaperToView() {
  const cw = canvas.width, ch = canvas.height;
  const pw = App.paperW, ph = App.paperH;
  const z = Math.min(cw / pw, ch / ph) * 0.92;
  App.vz = z;
  App.vx = (cw - pw * z) / 2;
  App.vy = (ch - ph * z) / 2;
  updateZoomInfo();
  App.dirty = true;
}

// 用紙フレーム描画（canvas座標系）
function drawBgImage() {
  const ox = App.bgOffsetX || 0, oy = App.bgOffsetY || 0;
  const sc = App.bgScale || 1.0;
  const rot = App.imageRotation || 0;
  const bgRot = App.bgRotation || 0;
  const W = App.pdfOffscreen.width, H = App.pdfOffscreen.height;
  ctx.save();
  ctx.translate(ox, oy);
  if (sc !== 1.0) ctx.scale(sc, sc);
  // 微調整回転（画像中心を軸に）
  if (bgRot !== 0) {
    const cx = W / 2, cy = H / 2;
    ctx.translate(cx, cy);
    ctx.rotate(bgRot * Math.PI / 180);
    ctx.translate(-cx, -cy);
  }
  // 90°スナップ回転
  if (rot === 0) {
    ctx.drawImage(App.pdfOffscreen, 0, 0);
  } else {
    const r = rot * Math.PI / 180;
    ctx.save();
    if (rot === 90)  { ctx.translate(H, 0); }
    if (rot === 180) { ctx.translate(W, H); }
    if (rot === 270) { ctx.translate(0, W); }
    ctx.rotate(r);
    ctx.drawImage(App.pdfOffscreen, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function drawPaperFrame() {
  const pw = App.paperW, ph = App.paperH;
  const rs = App.renderScale || 4;  // 座標系スケール係数
  const lw = 1 / App.vz;

  // 白背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pw, ph);

  // 外枠
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = lw * 2;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.rect(5*rs, 5*rs, pw - 10*rs, ph - 10*rs); ctx.stroke();

  // タイトルブロック高さ（rs倍でスケール）
  const tbH = 50 * rs;
  // 内枠（製図枠）
  const mL = 22*rs, mT = 12*rs, mR = 10*rs, mB = 10*rs + tbH;
  ctx.strokeStyle = '#1e3a5f';
  ctx.lineWidth = lw * 1.5;
  ctx.beginPath(); ctx.rect(mL, mT, pw - mL - mR, ph - mT - mB); ctx.stroke();

  // タイトルブロック（下部）
  const tbY = ph - 10*rs - tbH;
  const tbX = mL;
  const tbW = pw - mL - mR;
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = lw;

  // タイトルブロック外枠
  ctx.beginPath(); ctx.rect(tbX, tbY, tbW, tbH); ctx.stroke();

  // メタ情報エリア（右側）
  const metaW = Math.min(210*rs, tbW * 0.35);
  const metaX = tbX + tbW - metaW;
  ctx.beginPath(); ctx.moveTo(metaX, tbY); ctx.lineTo(metaX, tbY + tbH); ctx.stroke();
  const rowH = tbH / 3;
  [1, 2].forEach(i => {
    ctx.beginPath();
    ctx.moveTo(metaX, tbY + rowH * i);
    ctx.lineTo(tbX + tbW, tbY + rowH * i);
    ctx.stroke();
  });
  // ラベルフィールド区切り線
  const lblW = 28 * rs;
  [0,1,2].forEach(i => {
    ctx.beginPath();
    ctx.moveTo(metaX + lblW, tbY + rowH * i);
    ctx.lineTo(metaX + lblW, tbY + rowH * (i + 1));
    ctx.stroke();
  });

  // テキスト（ラベル）
  ctx.fillStyle = '#94a3b8';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const fsLbl = pfs(4.5) * rs;
  ctx.font = `${fsLbl}px 'Segoe UI', sans-serif`;
  ['縮尺', '日付', '作成者'].forEach((lbl, i) => {
    ctx.fillText(lbl, metaX + lblW / 2, tbY + rowH * i + rowH / 2);
  });
  // メタ情報の値
  const pi = App.paperInfo || {};
  const scaleText = App.mapScale ? `1/${App.mapScale}` : '';
  const dateText = pi.date ? pi.date.replace(/-/g, '/') : '';
  const authorText = pi.author || '';
  const valueX = metaX + lblW + (metaW - lblW) / 2;
  const fsVal = pfs(5) * rs;
  ctx.font = `${fsVal}px 'Segoe UI', sans-serif`;
  ctx.fillStyle = '#1e293b';
  [scaleText, dateText, authorText].forEach((val, i) => {
    if (val) ctx.fillText(val, valueX, tbY + rowH * i + rowH / 2);
  });
  // 図面名称エリア
  const titleText = pi.title || '';
  if (titleText) {
    ctx.fillStyle = '#1e3a5f';
    ctx.font = `bold ${pfs(7) * rs}px 'Segoe UI', sans-serif`;
    ctx.fillText(titleText, tbX + (tbW - metaW) / 2, tbY + tbH / 2);
  } else {
    ctx.fillStyle = '#cbd5e1';
    ctx.font = `${pfs(6) * rs}px 'Segoe UI', sans-serif`;
    ctx.fillText('図 面 名 称', tbX + (tbW - metaW) / 2, tbY + tbH / 2);
  }

  // ページサイズ表示（右下隅）
  ctx.fillStyle = '#94a3b8';
  ctx.font = `${pfs(4) * rs}px 'Segoe UI', sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(App.paperSize + '横', pw - 12*rs, ph - 12*rs);
}

function s2c(sx, sy) {
  return { x: (sx - App.vx) / App.vz, y: (sy - App.vy) / App.vz };
}

function getRel(e) {
  const r = canvas.getBoundingClientRect();
  return { sx: e.clientX - r.left, sy: e.clientY - r.top };
}

// ===== レンダーループ =====
function renderLoop() {
  if (App.dirty) { render(); App.dirty = false; }
  requestAnimationFrame(renderLoop);
}

function render() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const lightWorkspace = document.body.classList.contains('ui-v2');
  ctx.fillStyle = lightWorkspace
    ? (App.paperMode ? '#cbd3df' : '#e8ecf2')
    : (App.paperMode ? '#64748b' : '#0f172a');
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(App.vx, App.vy);
  ctx.scale(App.vz, App.vz);

  if (App.paperMode) {
    drawPaperFrame();
  }
  if (App.pdfReady && !App.paperMode) {
    drawBgImage();
  }

  // ラベルヒットボックスをリセット
  App.labelBoxes = [];

  drawLotsLayer();  // モードに関わらず常に描画
  App.items.forEach(item => drawItem(item, item.color));
  App.texts.forEach(t => drawTextAnnotation(t));
  drawPlacementPreview();
  if (App.pts.length > 0 || App.calibrating) drawInProgress();
  if (App.appMode === 'subdivision' && (App.lotTool === 'split' || App.lotTool === 'split-all')) {
    drawSplitPreview(); // Phase1（区画選択中）もPhase2（線描画中）も常に呼ぶ
  }
  if (App.appMode === 'subdivision' && App.lotTool === 'corner-cut' && App.cornerCutLotId !== null) {
    drawCornerCutHighlight();
  }
  if (App.lotPts.length > 0) {
    drawLotInProgress();
  }
  if (App.appMode === 'subdivision' && App.lotTool === 'parallel') drawParallelPreview();

  drawSelectionHighlight();

  ctx.restore();

  // 統一文字エディタを選択要素に追従させる
  if (App.selectedFormat && App.mode === 'select') positionTextEditor();
}

// フォントサイズヘルパー: キャンバス座標系のサイズ（地図と比例・印刷と一致）
// x2: 典型的なフィットページズーム(~0.5)で従来と同じ画面サイズになる係数
function pfs(base) { return base * 2; }

const FONT_FAMILIES = Object.freeze({
  gothic: "'Yu Gothic UI', 'Yu Gothic', 'Segoe UI', sans-serif",
  meiryo: "Meiryo, 'Segoe UI', sans-serif",
  mincho: "'Yu Mincho', 'BIZ UDPMincho', 'MS PMincho', serif",
  maru: "'BIZ UDPGothic', 'Yu Gothic UI', Meiryo, sans-serif",
});

function normalizeFontFamily(value) {
  return Object.prototype.hasOwnProperty.call(FONT_FAMILIES, value) ? value : 'gothic';
}

function canvasFontFamily(value) {
  return FONT_FAMILIES[normalizeFontFamily(value)];
}

function roadVisualStyle(fillColor) {
  const styles = {
    '#cbd5e1': { borderColor: '#596777', fillOpacity: 0.48 },
    '#e2e8f0': { borderColor: '#64748b', fillOpacity: 0.48 },
    '#94a3b8': { borderColor: '#475569', fillOpacity: 0.42 },
    '#64748b': { borderColor: '#334155', fillOpacity: 0.40 },
    '#f8fafc': { borderColor: '#94a3b8', fillOpacity: 0.52 },
    '#7dd3fc': { borderColor: '#0e7490', fillOpacity: 0.48 },
    '#bae6fd': { borderColor: '#0e7490', fillOpacity: 0.48 },
    '#fbbf24': { borderColor: '#a16207', fillOpacity: 0.42 },
    '#fca5a5': { borderColor: '#b91c1c', fillOpacity: 0.42 },
  };
  return styles[fillColor] || { borderColor: '#596777', fillOpacity: 0.48 };
}

// ===== 計測描画 =====
function drawItem(item, color) {
  if (item.points.length < 2) return;

  // 矢印・線は専用描画
  if (item.type === 'arrow') { drawArrowItem(item, color); return; }
  if (item.type === 'line')  { drawLineItem(item, color); return; }

  const lw = 2 / App.vz;
  // 平行線は常にグレー点線
  if (item.isParallel) {
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1 / App.vz;
    ctx.setLineDash([6 / App.vz, 4 / App.vz]);
    ctx.beginPath();
    ctx.moveTo(item.points[0].x, item.points[0].y);
    for (let i = 1; i < item.points.length; i++) ctx.lineTo(item.points[i].x, item.points[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.moveTo(item.points[0].x, item.points[0].y);
  for (let i = 1; i < item.points.length; i++) ctx.lineTo(item.points[i].x, item.points[i].y);
  if (item.type === 'area') {
    ctx.closePath();
    ctx.fillStyle = color + '28';
    ctx.fill();
  }
  ctx.stroke();

  // 確定済み図形の点は普段は表示しない。頂点編集時だけ小さな白抜きハンドルにする。
  if (App.mode === 'vertex-edit') {
    item.points.forEach(p => drawEditHandle(p.x, p.y, color));
  }

  const fs = pfs(13) * (App.subMeasureScale || 1.0) * (item.labelScale || 1);

  if (item.type === 'distance') {
    const lp = item.labelPos || midPt(item.points[0], item.points[1]);
    const lbl = item.customLabel != null ? item.customLabel : item.label;
    drawLabel(lp.x, lp.y, lbl, color, fs, item.id, 'main', item.labelRotation, item.labelFontFamily);

  } else if (item.type === 'polyline') {
    for (let i = 0; i < item.points.length - 1; i++) {
      const rawLbl = (item.segValues && item.segValues[i] != null)
        ? formatEdge(item.segValues[i]) : (item.segLabels && item.segLabels[i]);
      const lbl = (item.customSegLabels && item.customSegLabels[i] != null)
        ? item.customSegLabels[i] : rawLbl;
      if (lbl) {
        const lp = (item.segLabelPos && item.segLabelPos[i]) || midPt(item.points[i], item.points[i + 1]);
        drawLabel(lp.x, lp.y - 10 / App.vz, lbl, color, fs, item.id, 'seg' + i, item.labelRotation, item.labelFontFamily);
      }
    }
    if (item.label) {
      const last = item.points[item.points.length - 1];
      const lp = item.labelPos || { x: last.x, y: last.y - 16 / App.vz };
      const lbl = item.customLabel != null ? item.customLabel : ('合計: ' + item.label);
      drawLabel(lp.x, lp.y, lbl, color, fs, item.id, 'main', item.labelRotation, item.labelFontFamily);
    }

  } else if (item.type === 'area') {
    const lp = item.labelPos || centroid(item.points);
    const lbl = item.customLabel != null ? item.customLabel : item.label;
    drawLabel(lp.x, lp.y, lbl, color, fs, item.id, 'main', item.labelRotation, item.labelFontFamily);
    if (App.showSideLengths && item.segLabels) {
      for (let i = 0; i < item.points.length; i++) {
        const j = (i + 1) % item.points.length;
        const mid = midPt(item.points[i], item.points[j]);
        const lp2 = (item.segLabelPos && item.segLabelPos[i]) || { x: mid.x, y: mid.y - 10 / App.vz };
        const rawLbl = (item.segValues && item.segValues[i] != null)
          ? formatEdge(item.segValues[i]) : (item.segLabels && item.segLabels[i]);
        const segLbl = (item.customSegLabels && item.customSegLabels[i] != null)
          ? item.customSegLabels[i] : rawLbl;
        if (segLbl) drawLabel(lp2.x, lp2.y, segLbl, color, fs * 0.88, item.id, 'seg' + i, item.labelRotation, item.labelFontFamily);
      }
    }
  }
}

// ===== 線描画（実線/破線/点線・色・太さ） =====
function drawLineItem(item, color) {
  const pts = item.points;
  if (!pts || pts.length < 2) return;
  const lw = (item.lineWidth || 2);
  ctx.strokeStyle = item.color || color || '#1a1a1a';
  ctx.lineWidth = lw / App.vz;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ls = item.lineStyle || 'solid';
  if (ls === 'dashed')      ctx.setLineDash([lw * 3 / App.vz, lw * 2 / App.vz]);
  else if (ls === 'dotted') ctx.setLineDash([lw * 0.1 / App.vz, lw * 2 / App.vz]);
  else                      ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}

// ===== 矢印描画 =====
function drawArrowItem(item, color) {
  const p1 = item.points[0], p2 = item.points[1];
  const lw = 2.5 / App.vz;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.setLineDash([]);

  // 線
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  // 矢頭
  const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const hs = pfs(14);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(p2.x, p2.y);
  ctx.lineTo(p2.x - hs * Math.cos(angle - 0.4), p2.y - hs * Math.sin(angle - 0.4));
  ctx.lineTo(p2.x - hs * Math.cos(angle + 0.4), p2.y - hs * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();

  if (App.mode === 'vertex-edit') drawEditHandle(p1.x, p1.y, color);
}

// ===== テキスト・引出線描画 =====
function drawLotTable(t) {
  const fs = pfs(t.fontSize || 11);
  const fontFamily = canvasFontFamily(t.fontFamily);
  ctx.textBaseline = 'middle';

  const cellPadX = fs * 0.35;   // フォントに比例（ズームで伸びない）
  const lineH = fs * 1.7;
  const titleH = t.title ? lineH * 1.2 : 0;

  // 列幅を計測
  ctx.font = `bold ${fs}px ${fontFamily}`;
  const allRows = [t.headers, ...t.rows, t.totalRow];
  const colCount = t.headers.length;
  const colWidths = t.headers.map((_, ci) =>
    allRows.reduce((m, row) => Math.max(m, ctx.measureText(row[ci] || '').width + cellPadX * 2), 0)
  );
  // タイトルが列幅を超える場合は最終列を拡張
  if (t.title) {
    ctx.font = `bold ${fs * 1.05}px ${fontFamily}`;
    const tw = ctx.measureText(t.title).width + cellPadX * 4;
    const curW = colWidths.reduce((a, b) => a + b, 0);
    if (tw > curW) colWidths[colWidths.length - 1] += tw - curW;
    ctx.font = `bold ${fs}px ${fontFamily}`;
  }
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const totalH = titleH + lineH * (allRows.length + 1);
  const x = t.x, y = t.y;
  const tblY = y + titleH; // テーブル本体の開始Y
  const tblRot = (t.rotation || 0) * Math.PI / 180;
  ctx.save();
  if (tblRot) { const tcx = x + totalW / 2, tcy = y + totalH / 2; ctx.translate(tcx, tcy); ctx.rotate(tblRot); ctx.translate(-tcx, -tcy); }

  // 背景
  ctx.fillStyle = t.bgColor || 'rgba(255,255,255,0.95)';
  roundRect(ctx, x, y, totalW, totalH, 4 / App.vz);
  ctx.fill();

  // タイトル行
  if (t.title) {
    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(x, y, totalW, titleH);
    ctx.font = `bold ${fs * 1.05}px ${fontFamily}`;
    ctx.fillStyle = '#bfdbfe';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t.title, x + totalW / 2, y + titleH / 2);
  }

  // ヘッダー行背景
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(x, tblY, totalW, lineH);

  // 合計行背景
  const totalRowY = tblY + lineH * (allRows.length - 1 + 0.5);
  ctx.fillStyle = t.totalRowColor || '#dbeafe';
  ctx.fillRect(x, totalRowY - lineH * 0.1, totalW, lineH);

  // グリッド線
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 0.8 / App.vz;
  ctx.setLineDash([]);

  // 横線
  for (let ri = 0; ri <= allRows.length; ri++) {
    const rowY = ri === allRows.length ? totalRowY + lineH * 0.9 : tblY + ri * lineH;
    if (ri === allRows.length - 1) {
      ctx.lineWidth = 1.2 / App.vz;
      ctx.strokeStyle = '#475569';
    } else {
      ctx.lineWidth = 0.8 / App.vz;
      ctx.strokeStyle = '#94a3b8';
    }
    ctx.beginPath();
    ctx.moveTo(x, rowY);
    ctx.lineTo(x + totalW, rowY);
    ctx.stroke();
  }

  // 縦線
  ctx.lineWidth = 0.8 / App.vz;
  ctx.strokeStyle = '#94a3b8';
  let colX = x;
  for (let ci = 0; ci <= colCount; ci++) {
    ctx.beginPath();
    ctx.moveTo(colX, tblY);
    ctx.lineTo(colX, tblY + totalH - titleH - lineH * 0.5);
    ctx.stroke();
    if (ci < colCount) colX += colWidths[ci];
  }

  // テキスト描画
  allRows.forEach((row, ri) => {
    const isHeader = ri === 0;
    const isTotal = ri === allRows.length - 1;
    ctx.fillStyle = isHeader ? '#334155' : isTotal ? (t.totalTextColor || '#1e40af') : '#1a1a1a';
    ctx.font = (isHeader || isTotal) ? `bold ${fs}px ${fontFamily}`
                                     : `${fs}px ${fontFamily}`;
    let cx2 = x;
    row.forEach((cell, ci) => {
      const cellY = ri === allRows.length - 1
        ? totalRowY + lineH * 0.4
        : tblY + ri * lineH + lineH * 0.5;
      // 1列目は名称なので左寄せ、数値列は右寄せ
      const isNumCol = ci > 0 || !t.title;
      if (isNumCol && ci > 0) {
        ctx.textAlign = 'right';
        ctx.fillText(cell, cx2 + colWidths[ci] - cellPadX, cellY);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(cell, cx2 + cellPadX, cellY);
      }
      cx2 += colWidths[ci];
    });
  });

  ctx.restore();

  // ヒットボックス
  const scx = x * App.vz + App.vx;
  const scy = y * App.vz + App.vy;
  App.labelBoxes.push({
    itemId: t.id, isText: true,
    sx: scx - 8, sy: scy - 8,
    sw: totalW * App.vz + 16, sh: totalH * App.vz + 16,
    cx: x, cy: y,
  });
}

function drawNorthArrow(t) {
  const sz = pfs(18) * (t.size || 1.0);
  const angle = ((t.angle || 0) * Math.PI) / 180;
  const color = t.color || '#1e293b';
  const cx = t.x, cy = t.y;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  // 背景円
  const cr = sz * 1.25;
  ctx.beginPath(); ctx.arc(0, 0, cr, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 1.5 / App.vz; ctx.stroke();
  // 北三角（塗り）
  ctx.beginPath();
  ctx.moveTo(0, -sz); ctx.lineTo(-sz * 0.36, 0); ctx.lineTo(sz * 0.36, 0);
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  // 南三角（枠のみ）
  ctx.beginPath();
  ctx.moveTo(0, sz); ctx.lineTo(-sz * 0.36, 0); ctx.lineTo(sz * 0.36, 0);
  ctx.closePath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5 / App.vz; ctx.stroke();
  // 中心点
  ctx.beginPath(); ctx.arc(0, 0, sz * 0.07, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  // 「N」ラベル
  const fsN = sz * 0.85;
  ctx.font = `bold ${fsN}px 'Segoe UI', sans-serif`;
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('N', 0, -sz * 1.8);
  ctx.restore();
  // ヒットボックス
  const totalH = (cr + fsN * 1.2) * App.vz;
  const totalW = cr * App.vz;
  const scx = cx * App.vz + App.vx, scy = cy * App.vz + App.vy;
  App.labelBoxes.push({
    itemId: t.id, labelKey: 'northarrow', isText: true,
    cx, cy,
    sx: scx - totalW, sy: scy - totalH, sw: totalW * 2, sh: totalH + cr * App.vz,
  });
}

function drawStamp(t) {
  const mpp = App.mpp;
  const wPx = mpp ? t.wM / mpp : pfs(20) * (t.wM / 5);
  const hPx = mpp ? t.hM / mpp : pfs(12) * (t.hM / 3);
  const angle = ((t.angle || 0) * Math.PI) / 180;
  const isParking = t.textType === 'parking-stamp';
  const borderColor = t.lineColor || (isParking ? '#1d4ed8' : '#78350f');
  const fillColor   = isParking ? 'rgba(219,234,254,0.80)' : 'rgba(254,243,199,0.88)';
  const lineStyle   = t.lineStyle || (isParking ? 'dashed' : 'solid');
  const labelText   = t.label != null ? t.label : (isParking ? 'P' : '家屋');
  const hw = wPx / 2, hh = hPx / 2;

  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(angle);

  // 背景
  ctx.fillStyle = fillColor;
  ctx.fillRect(-hw, -hh, wPx, hPx);

  // ハッチング（家屋）
  if (!isParking) {
    ctx.save();
    ctx.beginPath(); ctx.rect(-hw, -hh, wPx, hPx); ctx.clip();
    ctx.strokeStyle = borderColor + '30';
    ctx.lineWidth = 1 / App.vz;
    const sp = Math.max(pfs(5), Math.min(wPx, hPx) * 0.12);
    for (let d = -wPx - hPx; d < wPx + hPx; d += sp) {
      ctx.beginPath(); ctx.moveTo(d, -hPx); ctx.lineTo(d + hPx * 2, hPx); ctx.stroke();
    }
    ctx.restore();
  }

  // 枠線
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2 / App.vz;
  if (lineStyle === 'dashed') ctx.setLineDash([6 / App.vz, 3 / App.vz]);
  else if (lineStyle === 'dotted') ctx.setLineDash([2 / App.vz, 3 / App.vz]);
  ctx.strokeRect(-hw, -hh, wPx, hPx);
  ctx.setLineDash([]);

  // 駐車場：中央の仕切り線
  if (isParking) {
    ctx.strokeStyle = borderColor + '60';
    ctx.lineWidth = 1 / App.vz;
    ctx.beginPath(); ctx.moveTo(-hw, 0); ctx.lineTo(hw, 0); ctx.stroke();
  }

  // ラベル
  const fsMain = Math.min(pfs(isParking ? 14 : 10), hPx * 0.45, wPx * 0.3);
  ctx.font = `bold ${fsMain}px 'Segoe UI', sans-serif`;
  ctx.fillStyle = borderColor;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (labelText) ctx.fillText(labelText, 0, isParking ? -hh * 0.25 : -hh * 0.18);

  // 寸法テキスト（showDims が false の場合は非表示）
  if (t.showDims !== false) {
    const fsDim = Math.min(pfs(6.5), hPx * 0.22, wPx * 0.18);
    ctx.font = `${fsDim}px 'Segoe UI', sans-serif`;
    ctx.fillText(`${t.wM}m×${t.hM}m`, 0, hh * 0.6);
  }

  ctx.restore();

  // ヒットボックス（回転考慮で対角を半径に）
  const diagR = Math.hypot(wPx, hPx) / 2;
  const scx = t.x * App.vz + App.vx, scy = t.y * App.vz + App.vy;
  App.labelBoxes.push({
    itemId: t.id, labelKey: 'stamp', isText: true,
    cx: t.x, cy: t.y,
    sx: scx - diagR * App.vz, sy: scy - diagR * App.vz,
    sw: diagR * 2 * App.vz, sh: diagR * 2 * App.vz,
  });
}

function getTextAnnotationLayout(text, fs, vertical) {
  const lines = (text || '').split('\n');
  const lineH = fs * 1.4;
  if (!vertical) {
    return {
      vertical: false,
      lines,
      maxW: lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0),
      h: lineH * Math.max(1, lines.length),
      lineH
    };
  }

  const columns = lines.map(line => Array.from(line));
  const allChars = columns.flat();
  const maxCharW = allChars.reduce((m, ch) => Math.max(m, ctx.measureText(ch).width), 0);
  const colW = Math.max(fs * 1.15, maxCharW * 1.12);
  const charH = fs * 1.18;
  const maxChars = Math.max(1, ...columns.map(col => col.length));
  return {
    vertical: true,
    lines,
    columns,
    colW,
    charH,
    maxW: colW * Math.max(1, columns.length),
    h: charH * maxChars,
    lineH
  };
}

function drawTextAnnotation(t) {
  if (t.textType === 'lot-table') { drawLotTable(t); return; }
  if (t.textType === 'north-arrow') { drawNorthArrow(t); return; }
  if (t.textType === 'house-stamp' || t.textType === 'parking-stamp') { drawStamp(t); return; }
  const textColor = t.color || '#1a1a1a';
  const bgColor   = t.bgColor || 'rgba(255,255,220,0.92)';

  // 引出線の場合: 先端→テキストボックスへ線を引く
  if (t.type === 'callout' && t.tipX !== undefined) {
    ctx.strokeStyle = textColor;
    ctx.lineWidth = 1.5 / App.vz;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(t.tipX, t.tipY);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
    // 先端は小さく控えめに表示
    drawDot(t.tipX, t.tipY, 1.8 / App.vz, textColor);
  }

  const fs = pfs(t.fontSize || 14) * (App.subMeasureScale || 1.0);
  ctx.font = `bold ${fs}px ${canvasFontFamily(t.fontFamily)}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const layout = getTextAnnotationLayout(t.text, fs, !!t.vertical);
  const { lines, maxW, h, lineH } = layout;
  const pad = fs * 0.35;
  const x = t.x, y = t.y;

  // 回転（ボックス中心を軸に。引出線の線部分は回さない）
  const rot = (t.rotation || 0) * Math.PI / 180;
  const bcx = x + maxW / 2, bcy = y + h / 2;
  ctx.save();
  if (rot) { ctx.translate(bcx, bcy); ctx.rotate(rot); ctx.translate(-bcx, -bcy); }

  const boxStyle = t.boxStyle || 'box';

  // 背景
  if (boxStyle !== 'none' && bgColor !== 'transparent') {
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.rect(x - pad, y - pad, maxW + pad * 2, h + pad * 2);
    ctx.fill();
  }

  // 枠線
  if (boxStyle === 'box') {
    ctx.strokeStyle = textColor + '88';
    ctx.lineWidth = 1 / App.vz;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.rect(x - pad, y - pad, maxW + pad * 2, h + pad * 2);
    ctx.stroke();
  } else if (boxStyle === 'underline') {
    ctx.strokeStyle = textColor + 'aa';
    ctx.lineWidth = 1.2 / App.vz;
    ctx.setLineDash([]);
    if (layout.vertical) {
      layout.columns.forEach((_, i) => {
        const lx = x + i * layout.colW + layout.colW * 0.86;
        ctx.beginPath();
        ctx.moveTo(lx, y - pad * 0.2);
        ctx.lineTo(lx, y + h + pad * 0.2);
        ctx.stroke();
      });
    } else {
      lines.forEach((_, i) => {
        const ly = y + i * lineH + lineH - pad * 0.2;
        ctx.beginPath();
        ctx.moveTo(x - pad, ly);
        ctx.lineTo(x + maxW + pad, ly);
        ctx.stroke();
      });
    }
  }
  // boxStyle === 'none': 枠なし・背景なし

  // テキスト
  ctx.fillStyle = textColor;
  if (layout.vertical) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    layout.columns.forEach((chars, colIdx) => {
      const cx = x + colIdx * layout.colW + layout.colW / 2;
      chars.forEach((ch, rowIdx) => {
        ctx.fillText(ch, cx, y + rowIdx * layout.charH + layout.charH / 2);
      });
    });
  } else {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineH));
  }

  ctx.restore();

  // ヒットボックス登録（スクリーン座標）
  const scx2 = (x - pad) * App.vz + App.vx;
  const scy2 = (y - pad) * App.vz + App.vy;
  const sw2  = (maxW + pad * 2) * App.vz;
  const sh2  = (h   + pad * 2) * App.vz;
  const hp2  = 8;
  App.labelBoxes.push({
    itemId: t.id, isText: true,
    sx: scx2 - hp2,  sy: scy2 - hp2,
    sw: sw2 + hp2*2, sh: sh2 + hp2*2,
    cx: x, cy: y,
  });
}

const PLACEMENT_PREVIEW_MODES = new Set([
  'text', 'north-arrow', 'house-stamp', 'parking-stamp',
]);

function isPlacementPreviewMode() {
  return PLACEMENT_PREVIEW_MODES.has(App.mode);
}

function hidePlacementPreview() {
  if (!App.placementPreviewInside) return;
  App.placementPreviewInside = false;
  App.dirty = true;
}

function getPlacementPreviewObject() {
  if ((!App.pdfReady && !App.paperMode) || !App.placementPreviewInside || !isPlacementPreviewMode()) return null;
  if (!Number.isFinite(App.mx) || !Number.isFinite(App.my)) return null;

  if (App.mode === 'north-arrow') {
    return {
      id: -1,
      textType: 'north-arrow',
      x: App.mx,
      y: App.my,
      angle: normalizeObjectAngle(App.northArrowAngle),
      size: App.northArrowSize,
      color: '#1e293b',
    };
  }

  if (App.mode === 'house-stamp' || App.mode === 'parking-stamp') {
    // メートル指定の実寸を表示できないため、縮尺未設定時はプレビューしない。
    if (!App.mpp) return null;
    const isParking = App.mode === 'parking-stamp';
    return {
      id: -1,
      textType: App.mode,
      x: App.mx,
      y: App.my,
      angle: normalizeObjectAngle(App.stampAngle),
      wM: App.stampWM,
      hM: App.stampHM,
      label: App.stampLabel != null ? App.stampLabel : (isParking ? 'P' : '家屋'),
      lineStyle: App.stampLineStyle || (isParking ? 'dashed' : 'solid'),
      lineColor: App.stampLineColor || (isParking ? '#1d4ed8' : '#78350f'),
      showDims: App.stampShowDims !== false,
    };
  }

  return {
    id: -1,
    type: 'text',
    text: App.placementText || '文字',
    x: App.mx,
    y: App.my,
    ...App.textOptions,
  };
}

function drawPlacementPreview() {
  const preview = getPlacementPreviewObject();
  if (!preview) return;

  // 既存描画関数を使って完成時と同じ寸法で描く。描画関数が追加する
  // 一時ヒットボックスは直後に破棄し、未配置物をクリック対象にしない。
  const labelBoxCount = App.labelBoxes.length;
  ctx.save();
  ctx.globalAlpha = 0.68;
  drawTextAnnotation(preview);
  ctx.restore();
  App.labelBoxes.length = labelBoxCount;
}

function drawInProgress() {
  const pts = App.calibrating ? App.calibPts : App.pts;
  const cursorPt = App.snapPt || { x: App.mx, y: App.my };
  const preview = [...pts, cursorPt];

  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2 / App.vz;
  ctx.setLineDash([6 / App.vz, 3 / App.vz]);

  ctx.beginPath();
  if (preview.length >= 1) {
    ctx.moveTo(preview[0].x, preview[0].y);
    for (let i = 1; i < preview.length; i++) ctx.lineTo(preview[i].x, preview[i].y);
    if (App.mode === 'area' && App.pts.length >= 2) ctx.lineTo(preview[0].x, preview[0].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  pts.forEach(p => drawDot(p.x, p.y, 2.5 / App.vz, '#d79a16'));

  if (App.mpp && preview.length >= 2 && !App.calibrating) {
    let total = 0;
    for (let i = 0; i < preview.length - 1; i++) total += dist(preview[i], preview[i + 1]);
    const label = formatDist(total * App.mpp);
    const last = preview[preview.length - 1];
    const fs = 12 / App.vz;
    ctx.font = `${fs}px 'Segoe UI', sans-serif`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    ctx.fillRect(last.x + 8 / App.vz, last.y - 22 / App.vz, tw + 8 / App.vz, 18 / App.vz);
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, last.x + 12 / App.vz, last.y - 20 / App.vz);
  }
  // スナップインジケーター
  if (!App.calibrating && App.snapType) {
    const snapColors = { vertex: '#facc15', intersection: '#22d3ee', grid: '#4ade80' };
    drawSnapBox(cursorPt.x, cursorPt.y, snapColors[App.snapType]);
  }
}

function drawDot(x, y, r, color) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.62)';
  ctx.lineWidth = 0.5 / App.vz;
  ctx.stroke();
  ctx.restore();
}

function drawEditHandle(x, y, color) {
  const r = 2.2 / App.vz;
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = color || '#64748b';
  ctx.lineWidth = 1 / App.vz;
  ctx.stroke();
  ctx.restore();
}

// スナップ有効時に□インジケーターを描画
function drawSnapBox(x, y, color) {
  const s = 6 / App.vz;
  ctx.strokeStyle = color || '#facc15';
  ctx.lineWidth = 1.5 / App.vz;
  ctx.setLineDash([]);
  ctx.strokeRect(x - s, y - s, s * 2, s * 2);
}

function drawLabel(x, y, text, color, fontSize, itemId, labelKey, rotation, fontFamily) {
  const _lrot = (App.mode === 'label-edit') ? 0 : (rotation || 0) * Math.PI / 180;
  ctx.save();
  if (_lrot) { ctx.translate(x, y); ctx.rotate(_lrot); ctx.translate(-x, -y); }
  ctx.font = `bold ${fontSize}px ${canvasFontFamily(fontFamily)}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  const pad = fontSize * 0.35;
  const w = tw + pad * 2, h = fontSize + pad * 2;

  // ラベル編集モード中はクリック可能なことを視覚的に示す
  if (App.mode === 'label-edit' && itemId !== undefined) {
    const hovering = App._hoverLabelKey === (itemId + '_' + labelKey);
    ctx.fillStyle = hovering ? 'rgba(59,130,246,0.25)' : 'rgba(59,130,246,0.1)';
    ctx.beginPath();
    ctx.rect(x - w / 2, y - h / 2, w, h);
    ctx.fill();
    ctx.strokeStyle = hovering ? '#3b82f6' : '#93c5fd';
    ctx.lineWidth = (hovering ? 1.5 : 1) / App.vz;
    ctx.setLineDash([3 / App.vz, 3 / App.vz]);
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    ctx.setLineDash([]);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.93)';
    ctx.beginPath();
    ctx.rect(x - w / 2, y - h / 2, w, h);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();

  // ヒットボックスをスクリーン座標で登録（確実にヒットするよう余裕 8px 追加）
  if (itemId !== undefined) {
    const scx = x * App.vz + App.vx;
    const scy = y * App.vz + App.vy;
    const sw  = w * App.vz;
    const sh  = h * App.vz;
    const hp  = 8;
    App.labelBoxes.push({
      itemId, labelKey, isText: false,
      sx: scx - sw/2 - hp, sy: scy - sh/2 - hp,
      sw: sw + hp*2,        sh: sh + hp*2,
      cx: x, cy: y,         // ドラッグ計算用（キャンバス座標）
    });
  }
}

function roundRect(ctx2, x, y, w, h, r) {
  ctx2.beginPath();
  ctx2.moveTo(x + r, y);
  ctx2.lineTo(x + w - r, y);
  ctx2.arcTo(x + w, y, x + w, y + r, r);
  ctx2.lineTo(x + w, y + h - r);
  ctx2.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx2.lineTo(x + r, y + h);
  ctx2.arcTo(x, y + h, x, y + h - r, r);
  ctx2.lineTo(x, y + r);
  ctx2.arcTo(x, y, x + r, y, r);
  ctx2.closePath();
}

// ===== イベント =====
function bindEvents() {
  document.getElementById('btn-open').addEventListener('click', () =>
    document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', e => {
    if (e.target.files[0]) loadPDF(e.target.files[0]);
    e.target.value = '';
  });

  document.getElementById('btn-open-image').addEventListener('click', () =>
    document.getElementById('image-input').click());
  document.getElementById('image-input').addEventListener('change', e => {
    if (e.target.files[0]) loadImage(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('btn-rotate-image').addEventListener('click', () => {
    App.imageRotation = (App.imageRotation + 90) % 360;
    // 回転後のサイズを更新してfitToView
    if (App.imageRotation % 180 !== 0) {
      App.pageWidthPt = App.pdfOffscreen.height;
      App.pageHeightPt = App.pdfOffscreen.width;
    } else {
      App.pageWidthPt = App.pdfOffscreen.width;
      App.pageHeightPt = App.pdfOffscreen.height;
    }
    fitToView();
    App.dirty = true;
  });

  // 下絵管理ボタン
  document.getElementById('btn-bg-clear')?.addEventListener('click', () => {
    if (!App.pdfReady) return;
    showInlineConfirm('下絵（PDF／画像）だけを削除します。作成した区画や文字は残ります。', {
      confirmLabel: '下絵を削除',
      onConfirm: clearBackground,
    });
  });
  document.getElementById('btn-bg-replace-pdf')?.addEventListener('click', () =>
    document.getElementById('bg-replace-pdf-input')?.click());
  document.getElementById('bg-replace-pdf-input')?.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    await replaceBgPDF(f);
    e.target.value = '';
  });
  document.getElementById('btn-bg-replace-img')?.addEventListener('click', () =>
    document.getElementById('bg-replace-img-input')?.click());
  document.getElementById('bg-replace-img-input')?.addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    loadImage(f, true);  // keepDrawings = true
    e.target.value = '';
  });
  document.getElementById('btn-bg-adjust')?.addEventListener('click', () => {
    const bar = document.getElementById('bg-adjust-bar');
    if (bar) {
      const hidden = bar.classList.toggle('hidden');
      if (!hidden) { positionOverlayBar(bar); syncBgAdjUI(); }
    }
  });

  // 下絵調整バー
  function syncBgAdjUI() {
    document.getElementById('bg-scale-slider').value = App.bgScale;
    document.getElementById('bg-scale-val').textContent = Math.round(App.bgScale * 100) + '%';
    document.getElementById('bg-offset-x').value = Math.round(App.bgOffsetX);
    document.getElementById('bg-offset-y').value = Math.round(App.bgOffsetY);
    const rot = Math.round((App.bgRotation || 0) * 10) / 10;
    const rotSlider = document.getElementById('bg-rotation-slider');
    if (rotSlider) rotSlider.value = rot;
    const rotVal = document.getElementById('bg-rotation-val');
    if (rotVal) rotVal.textContent = rot + '°';
    App.dirty = true;
  }
  document.getElementById('bg-scale-slider')?.addEventListener('input', e => {
    App.bgScale = parseFloat(e.target.value);
    document.getElementById('bg-scale-val').textContent = Math.round(App.bgScale * 100) + '%';
    App.dirty = true;
  });
  document.getElementById('bg-rotation-slider')?.addEventListener('input', e => {
    App.bgRotation = parseFloat(e.target.value) || 0;
    const rotVal = document.getElementById('bg-rotation-val');
    if (rotVal) rotVal.textContent = (Math.round(App.bgRotation * 10) / 10) + '°';
    App.dirty = true;
  });
  document.getElementById('bg-offset-x')?.addEventListener('input', e => {
    App.bgOffsetX = parseFloat(e.target.value) || 0; App.dirty = true;
  });
  document.getElementById('bg-offset-y')?.addEventListener('input', e => {
    App.bgOffsetY = parseFloat(e.target.value) || 0; App.dirty = true;
  });
  document.querySelectorAll('.btn-bg-adj').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.field;
      const delta = parseFloat(btn.dataset.delta) || 0;
      const def = field === 'bgScale' ? 1 : 0;
      App[field] = Math.round(((App[field] ?? def) + delta) * 1000) / 1000;
      if (field === 'bgScale') App[field] = Math.max(0.05, App[field]);
      syncBgAdjUI();
    });
  });
  document.getElementById('btn-bg-adj-reset')?.addEventListener('click', () => {
    App.bgScale = 1.0; App.bgOffsetX = 0; App.bgOffsetY = 0; App.bgRotation = 0;
    syncBgAdjUI();
  });
  document.getElementById('btn-bg-adj-close')?.addEventListener('click', () =>
    document.getElementById('bg-adjust-bar')?.classList.add('hidden'));

  // ドラッグ＆ドロップ
  ['drop-zone', 'canvas'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('dragover', e => {
      e.preventDefault();
      document.getElementById('drop-zone').classList.add('drag-over');
    });
    el.addEventListener('dragleave', () =>
      document.getElementById('drop-zone').classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      document.getElementById('drop-zone').classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (!f) return;
      if (f.type === 'application/pdf') loadPDF(f);
      else if (f.type.startsWith('image/')) loadImage(f);
    });
  });

  // ツールボタン
  document.querySelectorAll('.tool-btn[data-mode]').forEach(btn =>
    btn.addEventListener('click', () => setMode(btn.dataset.mode)));

  // ページ
  document.getElementById('btn-prev').addEventListener('click', () => changePage(-1));
  document.getElementById('btn-next').addEventListener('click', () => changePage(1));

  // 操作ボタン
  document.getElementById('btn-fit').addEventListener('click', fitToView);
  document.getElementById('btn-undo').addEventListener('click', undoLast);
  document.getElementById('btn-redo').addEventListener('click', redoLast);
  document.getElementById('btn-clear').addEventListener('click', () => clearMeasurements(true));
  document.getElementById('btn-save-png').addEventListener('click', saveCanvasPNG);
  document.getElementById('btn-save-json').addEventListener('click', saveProjectJSON);
  document.getElementById('btn-load-json').addEventListener('click', () => document.getElementById('json-input').click());
  document.getElementById('json-input').addEventListener('change', e => { if (e.target.files[0]) loadProjectJSON(e.target.files[0]); e.target.value = ''; });
  document.getElementById('btn-toggle-results').addEventListener('click', () => {
    const r = document.getElementById('results');
    const collapsed = r.classList.toggle('collapsed');
    document.getElementById('btn-toggle-results').textContent = collapsed ? '▶' : '◀';
    requestAnimationFrame(() => resizeCanvas());
  });
  document.getElementById('btn-print').addEventListener('click', openPrintModal);

  // 印刷モーダル
  document.querySelectorAll('.paper-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.paper-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      const size = btn.dataset.size;
      if (App.paperMode) {
        App.paperSize = size;
        const d = getPaperDims(size);
        App.paperW = d.w;
        App.paperH = d.h;
        document.querySelectorAll('.paper-size-btn').forEach(b => b.classList.toggle('active-paper-size', b.dataset.ps === size));
        fitPaperToView();
        App.dirty = true;
      } else {
        App.printSize = size;
      }
    });
  });
  document.getElementById('print-cancel').addEventListener('click', () =>
    document.getElementById('print-modal').classList.add('hidden'));
  document.getElementById('print-go').addEventListener('click', () => {
    document.getElementById('print-modal').classList.add('hidden');
    printMeasurements();
  });

  // 縮尺
  document.getElementById('btn-calibrate').addEventListener('click', () =>
    document.getElementById('calibration-modal').classList.remove('hidden'));
  document.getElementById('btn-cancel-calibration').addEventListener('click', () =>
    document.getElementById('calibration-modal').classList.add('hidden'));
  document.getElementById('btn-apply-scale').addEventListener('click', applyManualScale);
  document.getElementById('btn-start-calibration').addEventListener('click', startCalibration);
  document.getElementById('btn-cancel-calib-dist').addEventListener('click', cancelCalibrationDistance);
  document.getElementById('btn-apply-calibration').addEventListener('click', applyCalibrationDist);

  // IME変換確定のEnterを「適用」と誤認しない。変換後のEnterだけを受け付ける。
  document.getElementById('scale-input').addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); applyManualScale(); }
  });
  document.getElementById('calibration-dist-input').addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); applyCalibrationDist(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelCalibrationDistance(); }
  });

  // scale-display バッジをクリックで縮尺設定を開く
  document.getElementById('scale-display').addEventListener('click', () => {
    document.getElementById('calibration-modal').classList.remove('hidden');
  });

  // 縮尺プリセット（モーダル内）
  document.querySelectorAll('.preset-btn[data-scale]').forEach(btn => {
    btn.addEventListener('click', () => {
      const scale = parseInt(btn.dataset.scale);
      document.querySelectorAll('.preset-btn[data-scale]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('scale-input').value = scale;
      setMapScale(scale);
      setScaleDisplay(`縮尺 1/${scale}`);
      document.getElementById('calibration-modal').classList.add('hidden');
    });
  });

  // 距離プリセット（5m/10m）
  document.querySelectorAll('.dist-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('calibration-dist-input').value = btn.dataset.dist;
      commitCalibrationDist(parseFloat(btn.dataset.dist));
    });
  });

  // Canvas
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', hidePlacementPreview);
  window.addEventListener('mouseup', () => { App.canvasPointerDown = false; }, true);
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    // 入力中は1点戻す、未入力ならキャンセル
    if (App.lotPts.length > 0) { App.lotPts.pop(); App.dirty = true; }
    else if (App.pts.length > 0) { App.pts.pop(); App.dirty = true; }
    else cancelCurrent();
  });

  // メモパネル
  const mi = document.getElementById('memo-input');
  mi.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    // Shift+Enter or Ctrl+Enter で確定、単独Enter は改行（textarea のデフォルト動作）
    if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey)) { e.preventDefault(); commitTextInput(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelTextInput(); }
  });
  document.getElementById('memo-ok').addEventListener('click', commitTextInput);
  document.getElementById('memo-cancel').addEventListener('click', cancelTextInput);
  document.getElementById('memo-x')?.addEventListener('click', cancelTextInput);
  document.getElementById('memo-delete')?.addEventListener('click', deleteMemoEditor);

  // メモパネル：文字サイズスライダー
  document.getElementById('text-size-slider')?.addEventListener('input', e => {
    App.textOptions.fontSize = parseInt(e.target.value);
    const v = document.getElementById('text-size-val');
    if (v) v.textContent = e.target.value;
  });
  const memoRotationSlider = document.getElementById('text-rotation-slider');
  const memoRotationInput = document.getElementById('text-rotation-input');
  memoRotationSlider?.addEventListener('input', () => {
    const value = Math.max(-180, Math.min(180, parseFloat(memoRotationSlider.value) || 0));
    App.textOptions.rotation = value;
    if (memoRotationInput) memoRotationInput.value = value;
  });
  memoRotationInput?.addEventListener('input', () => {
    const value = Math.max(-180, Math.min(180, parseFloat(memoRotationInput.value) || 0));
    App.textOptions.rotation = value;
    if (memoRotationSlider) memoRotationSlider.value = value;
  });
  memoRotationInput?.addEventListener('change', () => {
    const value = Math.max(-180, Math.min(180, parseFloat(memoRotationInput.value) || 0));
    memoRotationInput.value = value;
    App.textOptions.rotation = value;
    if (memoRotationSlider) memoRotationSlider.value = value;
  });

  // ヘルプバーの閉じるボタン
  document.getElementById('help-bar-close')?.addEventListener('click', () => {
    document.getElementById('help-bar')?.classList.add('hidden');
    document.getElementById('btn-help-toggle')?.classList.remove('help-active');
  });
  // ヘルプバートグルボタン
  document.getElementById('btn-help-toggle')?.addEventListener('click', () => {
    const bar = document.getElementById('help-bar');
    const btn = document.getElementById('btn-help-toggle');
    if (bar) {
      const hidden = bar.classList.toggle('hidden');
      btn?.classList.toggle('help-active', !hidden);
    }
  });

  // メモパネル：文字色スウォッチ
  document.querySelectorAll('#text-color-swatches .color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      App.textOptions.color = sw.dataset.color;
      document.querySelectorAll('#text-color-swatches .color-swatch').forEach(s => s.classList.remove('active-swatch'));
      sw.classList.add('active-swatch');
    });
  });

  // メモパネル：背景色スウォッチ
  document.querySelectorAll('#text-bg-swatches .color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      App.textOptions.bgColor = sw.dataset.bg;
      document.querySelectorAll('#text-bg-swatches .color-swatch').forEach(s => s.classList.remove('active-swatch'));
      sw.classList.add('active-swatch');
    });
  });

  // カラーピッカーポップアップ
  document.querySelectorAll('.cp-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      const col = sw.dataset.c;
      const target = App.cpTargetIsText
        ? App.texts.find(x => x.id === App.cpTargetId)
        : App.items.find(x => x.id === App.cpTargetId);
      if (!target || target.color === col) {
        document.getElementById('color-picker-popup').classList.add('hidden');
        return;
      }
      saveState();
      if (App.cpTargetIsText) {
        target.color = col;
      } else {
        target.color = col;
      }
      document.getElementById('color-picker-popup').classList.add('hidden');
      updateResults();
      updateFormatPanel();
      App.dirty = true;
    });
  });

  // 使用色ピッカー（サイドバー）
  document.querySelectorAll('.sc-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      App.strokeColor = sw.dataset.sc;
      document.querySelectorAll('.sc-swatch').forEach(s => s.classList.remove('active-sc'));
      sw.classList.add('active-sc');
    });
  });

  // カラーピッカーを外クリックで閉じる
  document.addEventListener('click', (e) => {
    const popup = document.getElementById('color-picker-popup');
    if (!popup.classList.contains('hidden') && !popup.contains(e.target)) {
      popup.classList.add('hidden');
    }
  });

  // クリップボードから画像貼り付け (Ctrl+V)
  window.addEventListener('paste', e => {
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith('image/')) {
        loadImage(item.getAsFile());
        break;
      }
    }
  });

  // キーボード
  window.addEventListener('keydown', e => {
    // 日本語IMEの変換確定中はグローバルショートカットを動かさない
    if (e.isComposing || e.keyCode === 229) return;
    const activeElement = document.activeElement;
    const onInput = !!activeElement?.closest?.('input, textarea, select, [contenteditable="true"]')
      || !!activeElement?.isContentEditable;
    const modalOpen = ['lot-edit-modal','calibration-modal','calibration-dist-modal','print-modal','corner-cut-modal'].some(
      id => !document.getElementById(id)?.classList.contains('hidden'));
    const transactionalEditorOpen = ['lot-edit-modal', 'memo-panel', 'stamp-edit-panel', 'north-arrow-edit-panel', 'label-edit-overlay'].some(id => {
      const editor = document.getElementById(id);
      return editor && !editor.classList.contains('hidden');
    });
    if (e.key === 'Escape') {
      // 距離入力は選択した2点も含めて完全にキャンセルする
      if (!document.getElementById('calibration-dist-modal')?.classList.contains('hidden')) {
        cancelCalibrationDistance();
        return;
      }
      cancelCurrent();
      cancelTextInput();
    }
    // Transactional editors own their pending state. Do not let a global
    // history/delete shortcut mutate the canvas behind an open editor.
    // Focused form controls keep their native text editing and undo behavior.
    const historyShortcut = (e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase());
    if (!onInput && transactionalEditorOpen
      && ((e.key === 'Delete' || e.key === 'Backspace') || historyShortcut)) {
      e.preventDefault();
      return;
    }
    if (!onInput && !modalOpen && (e.key === 'Delete' || e.key === 'Backspace')) undoLast();
    if (!onInput && e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undoLast(); }
    if (!onInput && e.key === 'y' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); redoLast(); }
    if (!onInput && e.key === 'Escape') { App.lotPts = []; App.mergeSelect = []; App.splitTargetId = null; App.cornerCutLotId = null; App.cornerCutIdx = -1; updateSplitUI(); render(); App.dirty = false; notifyAppState('cancel'); }

    // コピー
    if (!onInput && !modalOpen && e.key === 'c' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const lc = App.lastClicked;
      if (!lc) { showToast('コピー対象を先にクリックしてください'); return; }
      let copied = false;
      if (lc.type === 'lot') {
        const lot = App.lots.find(l => l.id === lc.id);
        if (lot) { App.clipboardData = { type: 'lot', data: JSON.parse(JSON.stringify(lot)) }; copied = true; }
      } else if (lc.type === 'text') {
        const t = App.texts.find(x => x.id === lc.id);
        if (t) { App.clipboardData = { type: 'text', data: JSON.parse(JSON.stringify(t)) }; copied = true; }
      } else if (lc.type === 'item') {
        const item = App.items.find(x => x.id === lc.id);
        if (item) { App.clipboardData = { type: 'item', data: JSON.parse(JSON.stringify(item)) }; copied = true; }
      }
      if (copied) showToast('コピーしました（Ctrl+V で貼り付け）');
    }

    // ペースト
    if (!onInput && !modalOpen && e.key === 'v' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const cb = App.clipboardData;
      if (!cb) return;
      saveState();
      const off = 40 / App.vz;  // canvas座標でのオフセット量
      if (cb.type === 'lot') {
        const newLot = JSON.parse(JSON.stringify(cb.data));
        newLot.id = App.nextId++;
        if (newLot.type === 'lot') newLot.lotNum = App.lotNextNum++;
        if (newLot.points) newLot.points = newLot.points.map(p => ({ x: p.x + off, y: p.y + off }));
        // ラベル位置は重心からの相対値なので、形状をずらしてもそのまま引き継ぐ。
        App.lots.push(newLot);
        App.lastClicked = { type: 'lot', id: newLot.id };
        updateLotPanel();
      } else if (cb.type === 'text') {
        const newT = JSON.parse(JSON.stringify(cb.data));
        newT.id = App.nextId++;
        newT.x += off; newT.y += off;
        if (newT.tipX != null) { newT.tipX += off; newT.tipY += off; }
        App.texts.push(newT);
        App.lastClicked = { type: 'text', id: newT.id };
        updateResults();
      } else if (cb.type === 'item') {
        const newItem = JSON.parse(JSON.stringify(cb.data));
        newItem.id = App.nextId++;
        if (newItem.points) newItem.points = newItem.points.map(p => ({ x: p.x + off, y: p.y + off }));
        if (newItem.x1 != null) { newItem.x1 += off; newItem.y1 += off; newItem.x2 += off; newItem.y2 += off; }
        if (newItem.tipX != null) { newItem.tipX += off; newItem.tipY += off; }
        App.items.push(newItem);
        App.lastClicked = { type: 'item', id: newItem.id };
        updateResults();
      }
      App.dirty = true;
      showToast('貼り付けました');
    }
  });

  // ===== 分譲地モード イベント =====
  document.getElementById('btn-lot-draw').addEventListener('click', () => setLotTool('draw'));
  document.getElementById('btn-road-draw').addEventListener('click', () => setLotTool('road'));
  document.getElementById('btn-lot-split').addEventListener('click', () => setLotTool('split'));
  document.getElementById('btn-lot-split-all').addEventListener('click', () => setLotTool('split-all'));
  document.getElementById('btn-lot-merge').addEventListener('click', () => setLotTool('merge'));

  // 選択分割クリアボタン
  document.getElementById('btn-split-clear').addEventListener('click', clearSplitTarget);

  // キャンバス右クリックで選択分割の区画選択を解除
  canvas.addEventListener('contextmenu', (e) => {
    if (App.appMode === 'subdivision' && App.lotTool === 'split' && App.splitTargetId !== null) {
      e.preventDefault();
      clearSplitTarget();
    }
  });

  // 分譲地内の計測ツール
  document.getElementById('sub-btn-distance').addEventListener('click', () => setSubMeasureMode('distance'));
  document.getElementById('sub-btn-polyline').addEventListener('click', () => setSubMeasureMode('polyline'));
  document.getElementById('sub-btn-area').addEventListener('click', () => setSubMeasureMode('area'));
  document.getElementById('sub-btn-parallel').addEventListener('click', () => setLotTool('parallel'));

  // 平行線パネル
  document.getElementById('parallel-dist').addEventListener('input', () => { App.dirty = true; });
  document.getElementById('parallel-flip').addEventListener('click', () => { App.parallelFlip *= -1; App.parallelCount = 0; App.parallelDivCount = 0; App.dirty = true; });
  document.getElementById('parallel-create').addEventListener('click', createParallelLine);
  document.getElementById('btn-clear-parallel').addEventListener('click', () => {
    saveState();
    App.items = App.items.filter(i => !i.isParallel);
    App.parallelBase = null;
    App.parallelCount = 0;
    App.parallelDivCount = 0;
    document.getElementById('parallel-create').disabled = true;
    App.dirty = true;
  });

  document.getElementById('btn-toggle-edge-lengths')?.addEventListener('click', () => {
    App.lotShowEdgeLengths = !App.lotShowEdgeLengths;
    updateGlobalDisplayButtons();
    App.dirty = true;
  });
  document.getElementById('btn-stamp-list').addEventListener('click', stampLotList);
  document.getElementById('btn-renumber-lots').addEventListener('click', renumberLots);
  // オーバーレイ外クリックで閉じる（残留オーバーレイによる入力ブロック防止）
  document.getElementById('calibration-modal').addEventListener('click', e => {
    if (e.target.id === 'calibration-modal')
      document.getElementById('calibration-modal').classList.add('hidden');
  });
  document.getElementById('calibration-dist-modal').addEventListener('click', e => {
    if (e.target.id === 'calibration-dist-modal')
      cancelCalibrationDistance();
  });
  document.getElementById('print-modal').addEventListener('click', e => {
    if (e.target.id === 'print-modal')
      document.getElementById('print-modal').classList.add('hidden');
  });
  document.getElementById('corner-cut-modal').addEventListener('click', e => {
    if (e.target.id === 'corner-cut-modal') {
      document.getElementById('corner-cut-modal').classList.add('hidden');
      App.cornerCutLotId = null; App.cornerCutIdx = -1;
    }
  });
  document.getElementById('lot-edit-modal').addEventListener('click', e => {
    if (e.target.id === 'lot-edit-modal') cancelLotEdit();
  });
  document.getElementById('lot-text-scale-slider')?.addEventListener('input', e => {
    App.lotTextScale = parseFloat(e.target.value);
    const disp = document.getElementById('lot-text-scale-val');
    if (disp) disp.textContent = parseFloat(e.target.value).toFixed(1) + '×';
    App.dirty = true;
  });
  // モーダルの文字大きさスライダー（この区画だけ）
  document.getElementById('modal-lot-text-scale')?.addEventListener('input', e => {
    const v = parseFloat(e.target.value) || 1.0;
    const mlv = document.getElementById('modal-lot-text-scale-val');
    if (mlv) mlv.textContent = v.toFixed(1) + '×';
    const lot = App.lots.find(l => l.id === _editingLotId);
    if (lot && _editingLotKind !== 'road') {
      lot.labelScale = v;
      App.dirty = true;
    }
  });
  // モーダルの寸法大きさスライダー（この区画だけ）
  document.getElementById('modal-lot-edge-scale')?.addEventListener('input', e => {
    const v = parseFloat(e.target.value) || 1.0;
    const mev = document.getElementById('modal-lot-edge-scale-val');
    if (mev) mev.textContent = v.toFixed(1) + '×';
    const lot = App.lots.find(l => l.id === _editingLotId);
    if (lot && _editingLotKind !== 'road') {
      lot.edgeScale = v;
      App.dirty = true;
    }
  });
  document.getElementById('edge-scale-slider')?.addEventListener('input', e => {
    App.lotEdgeScale = parseFloat(e.target.value);
    const disp = document.getElementById('edge-scale-val');
    if (disp) disp.textContent = parseFloat(e.target.value).toFixed(1) + '×';
    App.dirty = true;
  });
  document.getElementById('lot-fill-opacity-slider')?.addEventListener('input', e => {
    App.lotFillOpacity = parseInt(e.target.value) / 100;
    const disp = document.getElementById('lot-fill-opacity-val');
    if (disp) disp.textContent = e.target.value + '%';
    const editOpacity = document.getElementById('lot-edit-fill-opacity');
    const editOpacityVal = document.getElementById('lot-edit-fill-opacity-val');
    if (editOpacity && editOpacity.dataset.custom !== '1') {
      editOpacity.value = e.target.value;
      if (editOpacityVal) editOpacityVal.textContent = e.target.value + '%';
    }
    App.dirty = true;
  });
  const onSubMeasureScale = e => {
    App.subMeasureScale = parseFloat(e.target.value);
    const value = document.getElementById('sub-measure-scale-val');
    if (value) value.textContent = parseFloat(e.target.value).toFixed(1) + '×';
    App.dirty = true;
  };
  document.getElementById('sub-measure-scale-slider')?.addEventListener('input', onSubMeasureScale);

  // 分譲地内 矢印・文字・引出線
  document.getElementById('sub-btn-arrow').addEventListener('click', () => setSubMeasureMode('arrow'));
  document.getElementById('sub-btn-text').addEventListener('click', () => setSubMeasureMode('text'));
  document.getElementById('sub-btn-callout').addEventListener('click', () => setSubMeasureMode('callout'));
  document.getElementById('sub-btn-line')?.addEventListener('click', () => setSubMeasureMode('line'));

  // 線設定（線種・色・太さ）
  document.querySelectorAll('.btn-line-style').forEach(btn => {
    btn.addEventListener('click', () => {
      App.lineStyle = btn.dataset.ls;
      document.querySelectorAll('.btn-line-style').forEach(b => {
        const on = b === btn;
        b.classList.toggle('active-line-style', on);
        b.style.background = on ? '#1d4ed8' : '#1e293b';
        b.style.color = on ? '#fff' : '#94a3b8';
        b.style.borderColor = on ? '#3b82f6' : '#334155';
      });
    });
  });
  document.querySelectorAll('.line-color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      App.lineColor = sw.dataset.lc;
      document.querySelectorAll('.line-color-swatch').forEach(s => {
        s.style.outline = s === sw ? '2px solid #60a5fa' : 'none';
        s.classList.toggle('active-line-color', s === sw);
      });
    });
  });
  document.getElementById('line-width-slider')?.addEventListener('input', e => {
    App.lineWidth = parseFloat(e.target.value);
    const v = document.getElementById('line-width-val');
    if (v) v.textContent = parseFloat(e.target.value).toFixed(1);
  });

  // ===== 統一文字エディタ（選択した文字のそばに表示） =====
  const tepText = document.getElementById('tep-text');
  tepText?.addEventListener('input', e => { setSelectedText(e.target.value); });
  // textarea内でEnter改行を許可（確定はフォーカスアウト/閉じる）
  const tepSize = document.getElementById('tep-size');
  const tepSizeNum = document.getElementById('tep-size-num');
  const tepSizeUnit = document.getElementById('tep-size-unit');
  function _tepSizeUpdate(v) {
    setSelectedSize(v);
    const isPx = getSelectedSizeKind() === 'px';
    if (tepSize) tepSize.value = v;
    if (tepSizeNum) { tepSizeNum.value = isPx ? Math.round(v) : parseFloat(v.toFixed(2)); tepSizeNum.step = isPx ? 1 : 0.05; }
    if (tepSizeUnit) tepSizeUnit.textContent = isPx ? 'px' : '×';
  }
  tepSize?.addEventListener('input', e => { _tepSizeUpdate(parseFloat(e.target.value)); });
  tepSizeNum?.addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (isNaN(v) || v <= 0) return;
    setSelectedSize(v);
    if (tepSize) tepSize.value = v;
  });
  document.getElementById('tep-vertical')?.addEventListener('change', e => {
    setSelectedVertical(!!e.target.checked);
  });
  document.getElementById('tep-font')?.addEventListener('change', e => {
    setSelectedFontFamily(e.target.value);
  });
  const tepRot = document.getElementById('tep-rot');
  const tepRotNum = document.getElementById('tep-rot-num');
  tepRot?.addEventListener('input', e => {
    const d = parseInt(e.target.value) || 0;
    setSelectedRotation(d); if (tepRotNum) tepRotNum.value = d; syncRotQuick(d);
  });
  tepRotNum?.addEventListener('input', e => {
    let d = parseInt(e.target.value); if (isNaN(d)) return;
    d = Math.max(-180, Math.min(180, d));
    setSelectedRotation(d); if (tepRot) tepRot.value = d; syncRotQuick(d);
  });
  document.querySelectorAll('.tep-rq').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = parseInt(btn.dataset.a) || 0;
      setSelectedRotation(d);
      if (tepRot) tepRot.value = d; if (tepRotNum) tepRotNum.value = d; syncRotQuick(d);
    });
  });
  document.querySelectorAll('#tep-colors .tep-sw').forEach(sw => {
    sw.addEventListener('click', () => {
      setSelectedColor(sw.dataset.c);
      document.querySelectorAll('#tep-colors .tep-sw').forEach(x => x.classList.toggle('active-tep-sw', x === sw));
    });
  });
  document.getElementById('tep-delete')?.addEventListener('click', deleteSelectedFormat);
  document.getElementById('tep-detail')?.addEventListener('click', openSelectedDetail);
  document.getElementById('tep-done')?.addEventListener('click', () => {
    _fmtEditSaved = false;
    App.selectedFormat = null;
    updateFormatPanel();
    notifyAppState('format-edit-complete');
    App.dirty = true;
  });

  document.getElementById('btn-lot-select').addEventListener('click', () => setLotTool('select'));
  document.getElementById('btn-edge-hide')?.addEventListener('click', () => setLotTool('edge-hide'));
  document.getElementById('btn-lot-delete-tool').addEventListener('click', () => setLotTool('delete'));
  document.getElementById('btn-divguide').addEventListener('click', () => setLotTool('divguide'));
  document.getElementById('btn-corner-cut').addEventListener('click', () => setLotTool('corner-cut'));

  // ツールボタン押下時にサイドバー下部のヘルプ欄を更新
  document.querySelectorAll('[data-help]').forEach(btn => {
    btn.addEventListener('click', () => showToolHelp(btn.dataset.help));
  });

  // 隅切りモーダル
  document.getElementById('corner-cut-cancel').addEventListener('click', () => {
    document.getElementById('corner-cut-modal').classList.add('hidden');
    App.cornerCutLotId = null; App.cornerCutIdx = -1;
  });
  document.getElementById('corner-cut-ok').addEventListener('click', () => {
    applyCornerCut();
    document.getElementById('corner-cut-modal').classList.add('hidden');
  });
  document.getElementById('btn-clear-divguides').addEventListener('click', () => {
    saveState(); App.divGuides = []; App.dirty = true;
  });
  document.querySelectorAll('.divn-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      App.divGuideN = parseInt(btn.dataset.n);
      document.getElementById('div-guide-n').value = App.divGuideN;
      document.querySelectorAll('.divn-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
  document.getElementById('div-guide-n').addEventListener('change', e => {
    const n = Math.max(2, Math.min(20, parseInt(e.target.value) || 2));
    App.divGuideN = n;
    e.target.value = n;
    document.querySelectorAll('.divn-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.n) === n));
  });

  document.getElementById('btn-grid-snap').addEventListener('click', () => {
    App.gridSnap = !App.gridSnap;
    document.getElementById('btn-grid-snap').classList.toggle('toggle-on', App.gridSnap);
    document.getElementById('btn-grid-snap').classList.toggle('toggle-off', !App.gridSnap);
  });

  // 分譲地カラーピッカー
  document.querySelectorAll('#lot-sc-picker .sc-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      App.lotStrokeColor = sw.dataset.sc;
      document.querySelectorAll('#lot-sc-picker .sc-swatch').forEach(s => s.classList.remove('active-sc'));
      sw.classList.add('active-sc');
    });
  });

  // 区画編集モーダル
  document.getElementById('lot-edit-cancel').addEventListener('click', cancelLotEdit);
  document.getElementById('lot-edit-x')?.addEventListener('click', cancelLotEdit);
  document.getElementById('lot-edit-ok').addEventListener('click', commitLotEdit);
  document.querySelectorAll('#lot-edit-kind-switch .next-editor-kind-button').forEach(btn => {
    btn.addEventListener('click', () => setLotEditType(btn.dataset.kind));
  });
  ['lot-edit-area-label', 'lot-edit-tsubo-label', 'lot-edit-price', 'lot-edit-memo', 'lot-edit-top-label'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return;
      const isTextarea = e.target.tagName === 'TEXTAREA';
      // input は Enter で確定、textarea は Shift+Enter / Ctrl+Enter で確定
      if (e.key === 'Enter' && (!isTextarea || e.shiftKey || e.ctrlKey)) {
        e.preventDefault(); commitLotEdit();
      }
    });
    document.getElementById(id).addEventListener('input', syncLotEditPreview);
  });
  document.querySelectorAll('.lot-center-color-swatch').forEach(button => {
    button.addEventListener('click', () => {
      const lot = App.lots.find(item => item.id === _editingLotId);
      const field = button.closest('.lot-center-color-palette')?.dataset.centerField;
      if (!lot || _editingLotKind === 'road' || !['area', 'tsubo'].includes(field)) return;
      const prop = field === 'area' ? 'customAreaLabelColor' : 'customTsuboLabelColor';
      lot[prop] = button.dataset.color || null;
      syncLotCenterColorControls(lot);
      App.dirty = true;
    });
  });
  // 道路テンプレートボタン
  document.querySelectorAll('.road-tmpl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('lot-edit-road-label').value = btn.dataset.text;
      syncRoadEditPreview();
    });
  });
  ['lot-edit-road-label', 'lot-edit-road-width'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', syncRoadEditPreview);
  });
  const roadRotationSlider = document.getElementById('lot-edit-road-rotation');
  const roadRotationNumber = document.getElementById('lot-edit-road-rotation-num');
  roadRotationSlider?.addEventListener('input', () => {
    if (roadRotationNumber) roadRotationNumber.value = roadRotationSlider.value;
    syncRoadEditPreview();
  });
  roadRotationNumber?.addEventListener('input', () => {
    const value = Math.max(-180, Math.min(180, parseFloat(roadRotationNumber.value) || 0));
    if (roadRotationSlider) roadRotationSlider.value = value;
    syncRoadEditPreview();
  });
  roadRotationNumber?.addEventListener('change', () => {
    const value = Math.max(-180, Math.min(180, parseFloat(roadRotationNumber.value) || 0));
    roadRotationNumber.value = value;
    if (roadRotationSlider) roadRotationSlider.value = value;
    syncRoadEditPreview();
  });
  document.getElementById('lot-edit-road-vertical')?.addEventListener('change', syncRoadEditPreview);
  // 道路文字サイズスライダー
  [
    ['lot-edit-road-title-size', 'lot-edit-road-title-size-val', 'roadLabelSize'],
    ['lot-edit-road-width-size', 'lot-edit-road-width-size-val', 'roadWidthLabelSize'],
  ].forEach(([inputId, valueId, prop]) => {
    document.getElementById(inputId)?.addEventListener('input', e => {
      const v = parseFloat(e.target.value) || 1.0;
      document.getElementById(valueId).textContent = v.toFixed(1) + '×';
      const lot = App.lots.find(l => l.id === _editingLotId);
      if (lot && _editingLotKind === 'road') {
        lot[prop] = v;
        App.dirty = true;
      }
    });
  });
  // 道路文字色スウォッチ
  document.querySelectorAll('.road-text-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.road-text-swatch').forEach(s => {
        const isLight = s.dataset.tc === '#f1f5f9';
        s.style.border = isLight ? '2px solid #475569' : '2px solid transparent';
        s.classList.remove('active-road-text');
      });
      sw.style.border = '2px solid #60a5fa';
      sw.classList.add('active-road-text');
      syncRoadEditPreview();
    });
  });
  document.querySelectorAll('.road-width-text-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.road-width-text-swatch').forEach(s =>
        s.classList.toggle('active-road-width-text', s === sw));
      syncRoadEditPreview();
    });
  });
  // 道路塗り色スウォッチ
  document.querySelectorAll('.road-fill-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.road-fill-swatch').forEach(s => {
        const isLight = ['#e2e8f0','#f8fafc','#cbd5e1'].includes(s.dataset.fc);
        s.style.border = isLight ? '2px solid #94a3b8' : '2px solid transparent';
        s.classList.remove('active-road-fill');
      });
      sw.style.border = '2px solid #60a5fa';
      sw.classList.add('active-road-fill');
      const section = document.getElementById('lot-edit-road-section');
      if (section) section.dataset.styleChanged = '1';
      syncRoadEditPreview();
    });
  });
  document.getElementById('lot-edit-price').addEventListener('input', e => {
    const digits = e.target.value.replace(/[^0-9]/g, '');
    const cursor = e.target.selectionStart;
    const prevLen = e.target.value.length;
    e.target.value = digits ? Number(digits).toLocaleString() : '';
    // カーソル位置補正
    const delta = e.target.value.length - prevLen;
    try { e.target.setSelectionRange(cursor + delta, cursor + delta); } catch(_) {}
    syncLotEditPreview();
  });
  document.querySelectorAll('#lot-color-swatches .color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('#lot-color-swatches .color-swatch').forEach(s => s.classList.remove('active-swatch'));
      sw.classList.add('active-swatch');
      syncLotEditPreview();
    });
  });
  document.getElementById('lot-edit-fill-opacity')?.addEventListener('input', e => {
    const v = parseInt(e.target.value) || 0;
    e.target.dataset.custom = '1';
    const disp = document.getElementById('lot-edit-fill-opacity-val');
    if (disp) disp.textContent = v + '%';
    syncLotEditPreview();
  });
  document.getElementById('lot-edit-fill-opacity-global')?.addEventListener('click', () => {
    const lot = App.lots.find(l => l.id === _editingLotId);
    const input = document.getElementById('lot-edit-fill-opacity');
    const val = document.getElementById('lot-edit-fill-opacity-val');
    const globalPct = Math.round((App.lotFillOpacity ?? 0.73) * 100);
    if (lot && _editingLotKind !== 'road') delete lot.fillOpacity;
    if (input) {
      input.value = globalPct;
      input.dataset.custom = '0';
    }
    if (val) val.textContent = globalPct + '%';
    App.dirty = true;
  });

  // 区画の線色スウォッチ（モーダル内）
  document.querySelectorAll('#lot-border-swatches .border-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('#lot-border-swatches .border-swatch').forEach(s => {
        s.style.outline = 'none'; s.classList.remove('active-border');
      });
      sw.style.outline = '2px solid #60a5fa';
      sw.classList.add('active-border');
      syncLotEditPreview();
    });
  });

  // 区画ラベル文字色スウォッチ（モーダル内）
  document.querySelectorAll('#lot-label-color-swatches .lotlabel-color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('#lot-label-color-swatches .lotlabel-color-swatch').forEach(s => {
        s.style.outline = 'none'; s.classList.remove('active-lotlabel-color');
      });
      sw.style.outline = '2px solid #60a5fa';
      sw.classList.add('active-lotlabel-color');
      syncLotEditPreview();
    });
  });

  // 寸法文字色スウォッチ（モーダル内）
  document.querySelectorAll('#lot-edgelabel-color-swatches .edgelabel-color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('#lot-edgelabel-color-swatches .edgelabel-color-swatch').forEach(s => {
        s.style.outline = 'none'; s.classList.remove('active-edgelabel-color');
      });
      sw.style.outline = '2px solid #60a5fa';
      sw.classList.add('active-edgelabel-color');
      syncLotEditPreview();
    });
  });

  // 表示設定トグルボタン（モーダル内 — クリック時にこの区画へ即反映）
  const lotDisplayProps = {
    'lot-num-disp-group': 'hideNumber',
    'lot-edge-disp-group': 'edgeDisplay',
    'lot-area-disp-group': 'areaDisplay',
    'lot-yaku-disp-group': 'yakuMode'
  };
  Object.entries(lotDisplayProps).forEach(([groupId, prop]) => {
    document.getElementById(groupId)?.addEventListener('click', e => {
      const btn = e.target.closest('.lot-disp-btn');
      if (!btn) return;
      e.stopPropagation();
      document.querySelectorAll(`#${groupId} .lot-disp-btn`).forEach(b => b.classList.remove('active-disp'));
      btn.classList.add('active-disp');
      const lot = App.lots.find(l => l.id === _editingLotId);
      if (lot && _editingLotKind !== 'road') {
        lot[prop] = btn.dataset.val || null;
        App.dirty = true;
      }
    });
  });

  // 区画の線色スウォッチ（サイドバー - グローバル）
  document.querySelectorAll('#lot-border-color-picker .border-gc-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      App.lotBorderColor = sw.dataset.bc;
      document.querySelectorAll('#lot-border-color-picker .border-gc-swatch').forEach(s => {
        s.style.outline = 'none'; s.classList.remove('active-border-gc');
      });
      sw.style.outline = '2px solid #60a5fa';
      sw.classList.add('active-border-gc');
      App.dirty = true;
    });
  });

  // 文字枠スタイルボタン
  document.querySelectorAll('.box-style-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      App.textOptions.boxStyle = btn.dataset.bs;
      document.querySelectorAll('.box-style-btn').forEach(b => b.classList.remove('active-box-style'));
      btn.classList.add('active-box-style');
    });
  });
  document.getElementById('text-vertical-check')?.addEventListener('change', e => {
    App.textOptions.vertical = !!e.target.checked;
  });

  // 用紙モード切り替えボタン（本図 ↔ 用紙）
  document.getElementById('btn-paper-mode')?.addEventListener('click', togglePaperMode);
  document.getElementById('btn-paper-a4')?.addEventListener('click', () => {
    App.paperSize = 'A4';
    const d = getPaperDims('A4'); App.paperW = d.w; App.paperH = d.h;
    document.querySelectorAll('.paper-size-btn').forEach(b => b.classList.toggle('active-paper-size', b.dataset.ps === 'A4'));
    if (App.paperMode) fitPaperToView();
    App.dirty = true;
  });
  document.getElementById('btn-paper-a3')?.addEventListener('click', () => {
    App.paperSize = 'A3';
    const d = getPaperDims('A3'); App.paperW = d.w; App.paperH = d.h;
    document.querySelectorAll('.paper-size-btn').forEach(b => b.classList.toggle('active-paper-size', b.dataset.ps === 'A3'));
    if (App.paperMode) fitPaperToView();
    App.dirty = true;
  });

  // 頂点編集ボタン（分譲地サイドバー）
  document.getElementById('btn-vertex-edit-sub')?.addEventListener('click', () => {
    setSubMeasureMode('vertex-edit');
  });
  // ラベル編集ボタン（分譲地サイドバー）
  document.getElementById('btn-label-edit-sub')?.addEventListener('click', () => {
    setSubMeasureMode('label-edit');
  });
  // 区画番号ON/OFFトグル
  document.getElementById('btn-show-lot-numbers')?.addEventListener('click', () => {
    App.showLotNumbers = !App.showLotNumbers;
    updateGlobalDisplayButtons();
    App.dirty = true;
  });

  // 約表記トグル
  const applyYakuToggle = () => {
    const btn = document.getElementById('btn-yaku-toggle-sub');
    if (btn) {
      btn.classList.toggle('toggle-on', App.useYaku);
      btn.style.color = App.useYaku ? '#34d399' : '';
      btn.textContent = App.useYaku ? '約 ON' : '約 OFF';
    }
    App.items.forEach(item => {
      if (item.segValues) {
        item.segLabels = item.segValues.map((d, i) =>
          (item.customSegLabels && item.customSegLabels[i] != null) ? item.customSegLabels[i] : formatEdge(d));
      }
    });
    App.dirty = true;
  };
  document.getElementById('btn-yaku-toggle-sub')?.addEventListener('click', () => {
    App.useYaku = !App.useYaku;
    applyYakuToggle();
  });

  // 約小数点セレクタ
  const applyYakuDecimal = (val) => {
    App.yakuDecimal = parseInt(val);
    if (App.useYaku) {
      App.items.forEach(item => {
        if (item.segValues) {
          item.segLabels = item.segValues.map((d, i) =>
            (item.customSegLabels && item.customSegLabels[i] != null) ? item.customSegLabels[i] : formatEdge(d));
        }
      });
    }
    App.dirty = true;
  };
  document.getElementById('yaku-decimal-sel-sub')?.addEventListener('change', e => applyYakuDecimal(e.target.value));

  // 約微調整ボタン
  function applyYakuAdjust(delta) {
    App.yakuAdjust = Math.round((App.yakuAdjust + delta) * 1000) / 1000;
    const disp = document.getElementById('yaku-adj-display');
    if (disp) disp.textContent = App.yakuAdjust === 0 ? '0m' : `${App.yakuAdjust.toFixed(2)}m`;
    if (App.useYaku) {
      App.items.forEach(item => {
        if (item.segValues) {
          item.segLabels = item.segValues.map((d, i) =>
            (item.customSegLabels && item.customSegLabels[i] != null) ? item.customSegLabels[i] : formatEdge(d));
        }
      });
    }
    App.dirty = true;
  }
  document.getElementById('btn-yaku-adj-m01')?.addEventListener('click', () => applyYakuAdjust(-0.1));
  document.getElementById('btn-yaku-adj-m001')?.addEventListener('click', () => applyYakuAdjust(-0.01));
  document.getElementById('btn-yaku-adj-reset')?.addEventListener('click', () => {
    App.yakuAdjust = 0;
    applyYakuAdjust(0);
  });

  // 用紙情報バー
  const syncPaperInfo = () => { App.dirty = true; };
  document.getElementById('paper-title')?.addEventListener('input', e => {
    App.paperInfo.title = e.target.value; syncPaperInfo();
  });
  document.getElementById('paper-date')?.addEventListener('change', e => {
    App.paperInfo.date = e.target.value; syncPaperInfo();
  });
  document.getElementById('paper-author')?.addEventListener('input', e => {
    App.paperInfo.author = e.target.value; syncPaperInfo();
  });
  document.getElementById('btn-paper-date-today')?.addEventListener('click', () => {
    const today = new Date().toISOString().slice(0, 10);
    const el = document.getElementById('paper-date');
    if (el) { el.value = today; App.paperInfo.date = today; syncPaperInfo(); }
  });

  // スタンプツールボタン
  document.getElementById('sub-btn-house-stamp')?.addEventListener('click', () => setSubMeasureMode('house-stamp'));
  document.getElementById('sub-btn-parking-stamp')?.addEventListener('click', () => setSubMeasureMode('parking-stamp'));

  // スタンプ設定パネル（サイドバー）
  document.getElementById('stamp-w-input')?.addEventListener('input', e => {
    App.stampWM = parseFloat(e.target.value) || 1; e.target._userEdited = true;
  });
  document.getElementById('stamp-h-input')?.addEventListener('input', e => {
    App.stampHM = parseFloat(e.target.value) || 1; e.target._userEdited = true;
  });
  document.getElementById('stamp-label-input')?.addEventListener('input', e => { App.stampLabel = e.target.value; });
  document.getElementById('stamp-settings')?.addEventListener('click', e => {
    const btn = e.target.closest('#stamp-dims-toggle');
    if (!btn) return;
    e.stopPropagation();
    App.stampShowDims = !App.stampShowDims;
    btn.textContent = App.stampShowDims ? '寸法 ON' : '寸法 OFF';
    btn.style.background = App.stampShowDims ? '#1d4ed8' : '#1e293b';
    btn.style.color = App.stampShowDims ? '#fff' : '#94a3b8';
    btn.style.borderColor = App.stampShowDims ? '#3b82f6' : '#334155';
  });
  const stampAngleInput = document.getElementById('stamp-angle-input');
  const stampAngleSlider = document.getElementById('stamp-angle-slider');
  const syncStampPlacementAngle = value => {
    App.stampAngle = syncAngleControls(stampAngleInput, stampAngleSlider, value);
  };
  syncStampPlacementAngle(App.stampAngle);
  stampAngleInput?.addEventListener('input', e => {
    if (e.target.value === '') return; // 「-」入力途中は確定しない
    syncStampPlacementAngle(e.target.value);
  });
  stampAngleInput?.addEventListener('change', e => syncStampPlacementAngle(e.target.value));
  stampAngleSlider?.addEventListener('input', e => syncStampPlacementAngle(e.target.value));
  document.querySelectorAll('.btn-stamp-step').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = parseFloat(btn.dataset.delta) || 0;
      syncStampPlacementAngle(App.stampAngle + d);
    });
  });
  document.querySelectorAll('.btn-stamp-line').forEach(btn => {
    btn.addEventListener('click', () => {
      App.stampLineStyle = btn.dataset.ls;
      document.querySelectorAll('.btn-stamp-line').forEach(b => {
        b.classList.remove('active-stamp-line');
        b.style.background = '#1e293b'; b.style.color = '#94a3b8'; b.style.borderColor = '#334155';
      });
      btn.classList.add('active-stamp-line');
      btn.style.background = '#1d4ed8'; btn.style.color = '#fff'; btn.style.borderColor = '#3b82f6';
    });
  });
  document.querySelectorAll('.stamp-color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      App.stampLineColor = sw.dataset.sc;
      document.querySelectorAll('.stamp-color-swatch').forEach(s => s.style.outline = 'none');
      sw.style.outline = '2px solid #60a5fa';
    });
  });

  // スタンプ編集オーバーレイ
  const stampEditAngleInput = document.getElementById('stamp-edit-angle');
  const stampEditAngleSlider = document.getElementById('stamp-edit-angle-slider');
  syncAngleControls(stampEditAngleInput, stampEditAngleSlider, stampEditAngleInput?.value);
  const updateEditingStamp = () => {
    const t = App.texts.find(x => x.id === App.editingStampId);
    if (!t) return;
    t.wM   = parseFloat(document.getElementById('stamp-edit-w')?.value) || t.wM;
    t.hM   = parseFloat(document.getElementById('stamp-edit-h')?.value) || t.hM;
    t.angle = syncAngleControls(stampEditAngleInput, stampEditAngleSlider, stampEditAngleInput?.value);
    t.label    = document.getElementById('stamp-edit-label-text')?.value ?? t.label;
    t.showDims = document.getElementById('stamp-edit-dims-toggle')?.dataset.on !== 'false';
    const activeLine = document.querySelector('.btn-stamp-edit-line.active-stamp-edit-line');
    if (activeLine) t.lineStyle = activeLine.dataset.ls;
    const activeColor = document.querySelector('.stamp-edit-color-swatch.active-stamp-edit-color');
    if (activeColor) t.lineColor = activeColor.dataset.sc;
    App.dirty = true;
  };
  // stamp-edit-panel 内のボタンはイベント委譲で処理（直接リスナーが効かないケース対策）
  document.getElementById('stamp-edit-panel')?.addEventListener('click', e => {
    const kindButton = e.target.closest('#stamp-edit-kind-switch .next-editor-kind-button');
    if (kindButton) {
      e.stopPropagation();
      setStampEditorKind(kindButton.dataset.kind);
      return;
    }
    const btn = e.target.closest('#stamp-edit-dims-toggle');
    if (!btn) return;
    e.stopPropagation();
    const t = App.texts.find(x => x.id === App.editingStampId);
    if (!t) return;
    t.showDims = !(t.showDims !== false);
    const on = t.showDims;
    btn.textContent = on ? '寸法 ON' : '寸法 OFF';
    btn.dataset.on = String(on);
    btn.style.background = on ? '#1d4ed8' : '#1e293b';
    btn.style.color = on ? '#fff' : '#94a3b8';
    btn.style.borderColor = on ? '#3b82f6' : '#334155';
    App.dirty = true;
  });
  document.getElementById('stamp-edit-w')?.addEventListener('input', updateEditingStamp);
  document.getElementById('stamp-edit-h')?.addEventListener('input', updateEditingStamp);
  document.getElementById('stamp-edit-label-text')?.addEventListener('input', updateEditingStamp);
  stampEditAngleInput?.addEventListener('input', e => {
    if (e.target.value === '') return;
    syncAngleControls(stampEditAngleInput, stampEditAngleSlider, e.target.value);
    updateEditingStamp();
  });
  stampEditAngleInput?.addEventListener('change', e => {
    syncAngleControls(stampEditAngleInput, stampEditAngleSlider, e.target.value);
    updateEditingStamp();
  });
  stampEditAngleSlider?.addEventListener('input', e => {
    syncAngleControls(stampEditAngleInput, stampEditAngleSlider, e.target.value);
    updateEditingStamp();
  });
  document.querySelectorAll('.btn-stamp-edit-step').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = parseFloat(btn.dataset.delta) || 0;
      const cur = normalizeObjectAngle(stampEditAngleInput?.value);
      syncAngleControls(stampEditAngleInput, stampEditAngleSlider, cur + d);
      updateEditingStamp();
    });
  });
  document.querySelectorAll('.btn-stamp-edit-line').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-stamp-edit-line').forEach(b => {
        b.classList.remove('active-stamp-edit-line');
        b.style.background = '#0f1a2e'; b.style.color = '#94a3b8'; b.style.borderColor = '#334155';
      });
      btn.classList.add('active-stamp-edit-line');
      btn.style.background = '#1d4ed8'; btn.style.color = '#fff'; btn.style.borderColor = '#3b82f6';
      updateEditingStamp();
    });
  });
  document.querySelectorAll('.stamp-edit-color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.stamp-edit-color-swatch').forEach(s => s.style.outline = 'none');
      sw.style.outline = '2px solid #60a5fa';
      sw.classList.add('active-stamp-edit-color');
      document.querySelectorAll('.stamp-edit-color-swatch').forEach(s => s.classList.remove('active-stamp-edit-color'));
      sw.classList.add('active-stamp-edit-color');
      updateEditingStamp();
    });
  });
  document.getElementById('btn-stamp-edit-ok')?.addEventListener('click', () => {
    commitStampEditor();
  });
  document.getElementById('btn-stamp-edit-cancel')?.addEventListener('click', cancelStampEditor);
  document.getElementById('btn-stamp-edit-x')?.addEventListener('click', cancelStampEditor);
  document.getElementById('btn-stamp-edit-delete')?.addEventListener('click', deleteStampEditor);

  // 北マークツールボタン
  document.getElementById('sub-btn-north-arrow')?.addEventListener('click', () => setSubMeasureMode('north-arrow'));

  // 北マーク設定パネル（サイドバー）
  const northAngleInput = document.getElementById('north-arrow-angle-input');
  const syncNorthPlacementAngle = value => {
    App.northArrowAngle = syncAngleControls(northAngleInput, null, value);
  };
  syncNorthPlacementAngle(App.northArrowAngle);
  northAngleInput?.addEventListener('input', e => {
    if (e.target.value === '') return;
    syncNorthPlacementAngle(e.target.value);
  });
  northAngleInput?.addEventListener('change', e => syncNorthPlacementAngle(e.target.value));
  document.getElementById('north-arrow-size-input')?.addEventListener('input', e => {
    App.northArrowSize = parseFloat(e.target.value) || 1.0;
    document.getElementById('north-arrow-size-val').textContent = App.northArrowSize.toFixed(2).replace(/\.?0+$/, '') + '×';
  });
  document.querySelectorAll('.btn-na-step').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = parseFloat(btn.dataset.delta) || 0;
      syncNorthPlacementAngle(App.northArrowAngle + d);
    });
  });

  // 北マーク編集オーバーレイ
  const naEditAngle = document.getElementById('na-edit-angle');
  const naEditAngleSlider = document.getElementById('na-edit-angle-slider');
  const naEditSize = document.getElementById('na-edit-size');
  syncAngleControls(naEditAngle, naEditAngleSlider, naEditAngle?.value);
  const updateEditingNorthArrow = () => {
    const t = App.texts.find(x => x.id === App.editingNorthArrowId);
    if (!t) return;
    const a = syncAngleControls(naEditAngle, naEditAngleSlider, naEditAngle?.value);
    const s = parseFloat(naEditSize?.value) || 1.0;
    t.angle = a; t.size = s;
    document.getElementById('na-edit-size-val').textContent = s.toFixed(2).replace(/\.?0+$/, '') + '×';
    App.dirty = true;
  };
  naEditAngle?.addEventListener('input', () => {
    if (naEditAngle.value === '') return;
    syncAngleControls(naEditAngle, naEditAngleSlider, naEditAngle.value);
    updateEditingNorthArrow();
  });
  naEditAngle?.addEventListener('change', () => {
    syncAngleControls(naEditAngle, naEditAngleSlider, naEditAngle.value);
    updateEditingNorthArrow();
  });
  naEditAngleSlider?.addEventListener('input', () => {
    syncAngleControls(naEditAngle, naEditAngleSlider, naEditAngleSlider.value);
    updateEditingNorthArrow();
  });
  naEditSize?.addEventListener('input', updateEditingNorthArrow);
  document.querySelectorAll('.btn-na-edit-step').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = parseFloat(btn.dataset.delta) || 0;
      const cur = normalizeObjectAngle(naEditAngle?.value);
      syncAngleControls(naEditAngle, naEditAngleSlider, cur + d);
      updateEditingNorthArrow();
    });
  });
  document.querySelectorAll('.north-edit-color-swatch').forEach(button => {
    button.addEventListener('click', () => {
      const t = App.texts.find(x => x.id === App.editingNorthArrowId);
      if (!t) return;
      t.color = button.dataset.color || '#1e293b';
      document.querySelectorAll('.north-edit-color-swatch').forEach(item =>
        item.classList.toggle('is-active', item === button));
      App.dirty = true;
    });
  });
  document.getElementById('btn-na-edit-ok')?.addEventListener('click', commitNorthArrowEditor);
  document.getElementById('btn-na-edit-cancel')?.addEventListener('click', cancelNorthArrowEditor);
  document.getElementById('btn-na-edit-x')?.addEventListener('click', cancelNorthArrowEditor);
  document.getElementById('btn-na-edit-delete')?.addEventListener('click', deleteNorthArrowEditor);

  // ラベル編集オーバーレイ
  document.getElementById('label-edit-input')?.addEventListener('keydown', e => {
    if ((e.isComposing || e.keyCode === 229)) return;
    if (e.key === 'Enter') { e.preventDefault(); confirmLabelEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelLabelEdit(); }
  });
  document.getElementById('label-edit-ok')?.addEventListener('click', confirmLabelEdit);
  document.getElementById('label-edit-cancel')?.addEventListener('click', cancelLabelEdit);
  document.getElementById('label-edit-x')?.addEventListener('click', cancelLabelEdit);
  // 色スウォッチ選択
  document.getElementById('label-color-row')?.addEventListener('click', e => {
    const btn = e.target.closest('.lec-sw');
    if (!btn) return;
    App._editingLabelColor = btn.dataset.color;
    document.querySelectorAll('.lec-sw').forEach(b => b.classList.toggle('active', b === btn));
  });
}

function getPaperDims(size) {
  // PDF座標系に合わせたサイズ（points × renderScale=4）
  // A4横: 842×595pt, A3横: 1190×842pt
  const rs = App.renderScale || 4;
  if (size === 'A3') return { w: Math.round(1190 * rs), h: Math.round(842 * rs) };
  return { w: Math.round(842 * rs), h: Math.round(595 * rs) };  // A4
}

function getPaperSizeMm(size, landscape) {
  const portrait = size === 'A3' ? { w: 297, h: 420 } : { w: 210, h: 297 };
  return landscape ? { w: portrait.h, h: portrait.w } : portrait;
}

function mm(v) {
  return (Math.round(v * 1000) / 1000).toString();
}

function detectPrintPaperSize() {
  if (App.paperMode) return App.paperSize || 'A4';
  if (!App.isImageMode && App.pageWidthPt && App.pageHeightPt) {
    const shortPt = Math.min(App.pageWidthPt, App.pageHeightPt);
    const longPt = Math.max(App.pageWidthPt, App.pageHeightPt);
    if (Math.abs(shortPt - 595) <= 24 && Math.abs(longPt - 842) <= 24) return 'A4';
    if (Math.abs(shortPt - 842) <= 30 && Math.abs(longPt - 1190) <= 30) return 'A3';
  }
  return App.printSize || 'A3';
}

function syncPrintPaperButtons(size) {
  document.querySelectorAll('.paper-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.size === size);
  });
}

function fitMmToPage(widthPx, heightPx, pageMm) {
  const ratio = widthPx / Math.max(heightPx, 1);
  let w = pageMm.w;
  let h = w / ratio;
  if (h > pageMm.h) {
    h = pageMm.h;
    w = h * ratio;
  }
  return { w, h };
}

function getPrintImageSizeMm(pc, pageMm) {
  if (App.paperMode) return { ...pageMm };
  if (!App.isImageMode && App.pageWidthPt && App.pageHeightPt) {
    return {
      w: App.pageWidthPt * 25.4 / 72,
      h: App.pageHeightPt * 25.4 / 72,
    };
  }
  return fitMmToPage(pc.width, pc.height, pageMm);
}

function buildPrintDocument({ title, dataUrl, pageSize, landscape, pageMm, imageMm, autoPrint }) {
  const cssPageSize = `${pageSize} ${landscape ? 'landscape' : 'portrait'}`;
  const script = autoPrint ? '<script>window.onload = function(){ window.print(); }<\/script>' : '';
  return `<!DOCTYPE html><html lang="ja"><head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
      @page { size: ${cssPageSize}; margin: 0; }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        width: ${mm(pageMm.w)}mm;
        height: ${mm(pageMm.h)}mm;
        overflow: hidden;
        background: #fff;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      img {
        display: block;
        flex: 0 0 auto;
        width: ${mm(imageMm.w)}mm;
        height: ${mm(imageMm.h)}mm;
        object-fit: contain;
      }
    </style>
  </head><body>
    <img src="${dataUrl}">
    ${script}
  </body></html>`;
}

function togglePaperMode() {
  App.paperMode = !App.paperMode;
  const btn = document.getElementById('btn-paper-mode');
  const bar = document.getElementById('paper-info-bar');
  if (App.paperMode) {
    btn.textContent = '本図に戻す';
    btn.classList.add('active-mode');
    const d = getPaperDims(App.paperSize);
    App.paperW = d.w; App.paperH = d.h;
    if (bar) { bar.classList.remove('hidden'); positionOverlayBar(bar); }
    // 用紙モードでは下絵が無くても作図できるようドロップゾーンを隠す
    document.getElementById('drop-zone').style.display = 'none';
    fitPaperToView();
  } else {
    btn.textContent = '📄 作業用紙';
    btn.classList.remove('active-mode');
    if (bar) bar.classList.add('hidden');
    // 下絵も図形も無ければドロップゾーンを戻す
    const hasDrawings = App.lots.length || App.items.length || App.texts.length;
    if (!App.pdfReady && !hasDrawings) document.getElementById('drop-zone').style.display = '';
    if (App.pdfReady) fitToView();
  }
  App.dirty = true;
}

// ===== マウスイベント =====
function beginUndoableDrag(sx, sy) {
  App.dragPending = true;
  App.dragStartSX = sx;
  App.dragStartSY = sy;
}

// スタンプ類は「配置」と「編集」を一続きにする。配置後も作成モードを
// 残すと、編集のためのダブルクリックが追加配置として処理されるため、
// 1個置いた時点で選択モードへ戻し、マウスを離してから編集画面を開く。
function finishOneShotObjectPlacement(textObject, clientX, clientY) {
  if (!textObject) return;
  const isNorth = textObject.textType === 'north-arrow';
  // The v1.4 command bar owns the placement lifecycle. Keep the active
  // command and do not open a floating editor after the placement click.
  if (App.commandShellV14) {
    App.lastClicked = { type: 'text', id: textObject.id };
    App.selectedFormat = { kind: isNorth ? 'north' : 'stamp', id: textObject.id };
    updateResults();
    updateFormatPanel();
    App.dirty = true;
    notifyAppState('placement-complete');
    return;
  }
  setLotTool('select');
  App.lastClicked = { type: 'text', id: textObject.id };
  App.selectedFormat = { kind: isNorth ? 'north' : 'stamp', id: textObject.id };
  updateResults();
  updateFormatPanel();
  App.dirty = true;

  const openEditor = () => {
    if (!App.texts.some(item => item.id === textObject.id)) return;
    if (isNorth) openNorthArrowEditor(textObject.id, clientX, clientY);
    else openStampEditor(textObject.id, clientX, clientY);
  };
  window.addEventListener('mouseup', () => {
    window.setTimeout(openEditor, 0);
  }, { once: true, capture: true });
}

function onMouseDown(e) {
  e.preventDefault();
  if (!App.pdfReady && !App.paperMode) return;
  App.canvasPointerDown = true;
  const { sx, sy } = getRel(e);
  const cp = s2c(sx, sy);

  // コピペ用：左クリックで何かにヒットしたら記録（全モード共通）
  if (e.button === 0) {
    const h = hitLabel(sx, sy);
    if (h) {
      if (h.isLotLabel || h.isLotEdge || h.isLotCenter) {
        App.lastClicked = { type: 'lot', id: h.lotId };
      } else {
        App.lastClicked = { type: h.isText ? 'text' : 'item', id: h.itemId };
      }
    } else {
      const l = hitLot(cp);
      if (l) App.lastClicked = { type: 'lot', id: l.id };
      else {
        const item = hitMeasureItem(cp);
        if (item) App.lastClicked = { type: 'item', id: item.id };
      }
    }
  }

  // キャリブレーション（全モード共通で最優先）
  if (App.calibrating) {
    if (e.button !== 0) return;
    App.calibPts.push(cp);
    App.dirty = true;
    if (App.calibPts.length === 2) {
      App.calibrating = false;
      // Wait until the second canvas click (including mouseup/click) has fully
      // finished before opening the dialog. Showing it during mousedown can
      // make the release land on a distance preset underneath the pointer and
      // apply a value before the user gets a chance to type.
      window.addEventListener('mouseup', () => {
        setTimeout(() => {
          if (App.calibPts.length !== 2 || App.calibrating) return;
          document.getElementById('calibration-dist-modal').classList.remove('hidden');
          notifyAppState('calibration-distance');
        }, 0);
      }, { once: true, capture: true });
    }
    return;
  }

  // ===== 分譲地モード =====
  if (App.appMode === 'subdivision') {
    if (e.button === 1 || (e.button === 0 && e.altKey) || App.mode === 'pan') {
      hidePlacementPreview();
      App.panning = true;
      App.panSX = sx; App.panSY = sy;
      App.panVX = App.vx; App.panVY = App.vy;
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    // 縮尺未設定なら最初の操作でモーダルを開く（select/label-move/pan以外）
    if (!App.mpp && App.lotTool !== 'measure' && App.mode !== 'select' && App.lotTool !== 'label-move') {
      const needsFirstPt = App.lotPts.length === 0 && App.pts.length === 0;
      if (needsFirstPt) {
        document.getElementById('calibration-modal').classList.remove('hidden');
        return;
      }
    }
    // 全体移動モード
    if (App.lotTool === 'move-all') {
      beginUndoableDrag(sx, sy);
      App.moveAllDragging = true;
      App.moveAllStartX = cp.x;
      App.moveAllStartY = cp.y;
      App.moveAllOrigLots  = App.lots.map(l => ({ id: l.id, pts: l.points ? l.points.map(p => ({ ...p })) : null, lox: l.labelOffX || 0, loy: l.labelOffY || 0, elofs: l.edgeLabelOffsets ? JSON.parse(JSON.stringify(l.edgeLabelOffsets)) : null }));
      App.moveAllOrigItems = App.items.map(i => ({ id: i.id, pts: i.points ? i.points.map(p => ({ ...p })) : null, x1: i.x1, y1: i.y1, x2: i.x2, y2: i.y2, tipX: i.tipX, tipY: i.tipY, ox: i.offsetX, oy: i.offsetY }));
      App.moveAllOrigTexts = App.texts.map(t => ({ id: t.id, x: t.x, y: t.y, tipX: t.tipX, tipY: t.tipY }));
      canvas.style.cursor = 'grabbing';
      return;
    }
    // 削除モード
    if (App.lotTool === 'delete') {
      // 見た目の前面にある注記・計測を先に判定する。区画を先に
      // 判定すると、区画内の文字を消すつもりで区画全体が消えていた。
      const hit = hitLabel(sx, sy);
      if (hit && !hit.isLotLabel && !hit.isLotEdge) {
        saveState();
        if (hit.isText) {
          App.texts = App.texts.filter(t => t.id !== hit.itemId);
        } else {
          App.items = App.items.filter(i => i.id !== hit.itemId);
        }
        reconcileSelectionState();
        updateResults();
        App.dirty = true;
        return;
      }
      // 線・矢印などラベルを持たないアイテムの削除
      const delItem = hitMeasureItem(cp);
      if (delItem) {
        saveState();
        App.items = App.items.filter(i => i.id !== delItem.id);
        reconcileSelectionState();
        updateResults();
        App.dirty = true;
        return;
      }
      // 最後に区画本体を判定
      const delLot = hitLot(cp);
      if (delLot) {
        saveState();
        App.lots = App.lots.filter(l => l.id !== delLot.id);
        reconcileSelectionState();
        updateLotPanel(); App.dirty = true;
        return;
      }
      return;
    }
    // 寸法消しモード（辺の寸法をクリックで個別に表示/非表示トグル）
    if (App.lotTool === 'edge-hide') {
      const hit = hitLabel(sx, sy);
      if (hit && hit.isLotEdge) {
        saveState();
        const lot = App.lots.find(l => l.id === hit.lotId);
        if (lot) {
          if (!lot.edgeHidden) lot.edgeHidden = {};
          lot.edgeHidden[hit.edgeIdx] = !lot.edgeHidden[hit.edgeIdx];
        }
        App.dirty = true;
      }
      return;
    }
    // 選択・移動モード。v1.4では「選択」と「移動」を分離し、単なる
    // 選択中に触れただけで図形が動かないようにする。
    if (App.mode === 'select' && App.lotTool !== 'merge' && App.lotTool !== 'corner-cut' && App.lotTool !== 'edge-hide') {
      // ① ラベル類を最優先で掴む（文字を掴めば文字だけ動く）
      const labelHit = hitLabel(sx, sy);
      if (labelHit) {
        if (App.commandShellV14 && !App.selectionMoveEnabled) {
          setSelectedFormatFromHit(labelHit);
          App.lastClicked = labelHit.isLotLabel || labelHit.isLotEdge || labelHit.isLotCenter
            ? { type: 'lot', id: labelHit.lotId }
            : { type: labelHit.isText ? 'text' : 'item', id: labelHit.itemId };
          notifyAppState('selection');
          return;
        }
        beginUndoableDrag(sx, sy);
        if (labelHit.isLotEdge) {
          const lot = App.lots.find(l => l.id === labelHit.lotId);
          if (lot) {
            if (!lot.edgeLabelOffsets) lot.edgeLabelOffsets = {};
            const uo = lot.edgeLabelOffsets[labelHit.edgeIdx] || { dx: 0, dy: 0 };
            App.draggingEdgeLabelLotId = lot.id;
            App.draggingEdgeLabelEdge = labelHit.edgeIdx;
            App.dragEdgeLabelOffX = cp.x - uo.dx;
            App.dragEdgeLabelOffY = cp.y - uo.dy;
          }
        } else if (labelHit.isLotLabel) {
          // 区画ラベルブロック（番号・面積・価格など）
          const lot = App.lots.find(l => l.id === labelHit.lotId);
          if (lot) {
            const cen = centroid(lot.points);
            App.draggingLotLabelId = lot.id;
            App.draggingRoadLabelPart = lot.type === 'road' ? (labelHit.roadLabelPart || 'title') : null;
            App.dragLotLabelOffX = cp.x - labelHit.cx;
            App.dragLotLabelOffY = cp.y - labelHit.cy;
            if (lot.type !== 'road' || App.draggingRoadLabelPart === 'title') {
              App.dragLotLabelOffX = cp.x - (cen.x + (lot.labelOffX || 0));
              App.dragLotLabelOffY = cp.y - (cen.y + (lot.labelOffY || 0));
            }
          }
        } else {
          // 計測ラベル・メモ・引出線・スタンプ・北マーク
          App.draggingId = labelHit.itemId;
          App.dragLabelKey = labelHit.labelKey;
          App.dragIsText = labelHit.isText;
          App.dragOffX = cp.x - labelHit.cx;
          App.dragOffY = cp.y - labelHit.cy;
        }
        setSelectedFormatFromHit(labelHit);
        canvas.style.cursor = 'grabbing';
        return;
      }
      // ラベル以外を掴むときは書式選択を解除
      App.selectedFormat = null;
      updateFormatPanel();
      // ② 区画本体 → 区画ごと移動
      const lot = hitLot(cp);
      if (lot && lot.points) {
        if (App.commandShellV14 && !App.selectionMoveEnabled) {
          App.lastClicked = { type: 'lot', id: lot.id };
          App.selectedFormat = { kind: lot.type === 'road' ? 'road-label' : 'lot-label', id: lot.id };
          updateFormatPanel();
          notifyAppState('selection');
          return;
        }
        beginUndoableDrag(sx, sy);
        App.draggingLotId = lot.id;
        const cen = centroid(lot.points);
        App.dragLotOffX = cp.x - cen.x;
        App.dragLotOffY = cp.y - cen.y;
        App.dragLotOrigPoints = lot.points.map(p => ({ x: p.x, y: p.y }));
        App.dragLotOrigCen = { x: cen.x, y: cen.y };
        canvas.style.cursor = 'grabbing';
      } else {
        // ④ 計測・線アイテム本体 → アイテム丸ごと移動
        const hitItem = hitMeasureItem(cp);
        if (hitItem) {
          if (App.commandShellV14 && !App.selectionMoveEnabled) {
            App.lastClicked = { type: 'item', id: hitItem.id };
            App.selectedFormat = ['distance', 'polyline', 'area'].includes(hitItem.type)
              ? { kind: 'item-label', id: hitItem.id, labelKey: 'main' }
              : { kind: 'item', id: hitItem.id };
            updateFormatPanel();
            notifyAppState('selection');
            return;
          }
          beginUndoableDrag(sx, sy);
          App.draggingItemId = hitItem.id;
          App.dragItemStartX = cp.x;
          App.dragItemStartY = cp.y;
          App.dragItemOrigPts = hitItem.points.map(p => ({ x: p.x, y: p.y }));
          App.dragItemOrigLabelPos = hitItem.labelPos ? { ...hitItem.labelPos } : null;
          App.dragItemOrigSegLabelPos = hitItem.segLabelPos ? hitItem.segLabelPos.map(p => p ? { ...p } : null) : null;
          App.lastClicked = { type: 'item', id: hitItem.id };
          App.selectedFormat = ['distance', 'polyline', 'area'].includes(hitItem.type)
            ? { kind: 'item-label', id: hitItem.id, labelKey: 'main' }
            : { kind: 'item', id: hitItem.id };
          notifyAppState('selection');
          canvas.style.cursor = 'grabbing';
        } else {
          // 空白ドラッグによる全体移動は明示的な「移動」中だけ許可。
          if (App.commandShellV14 && !App.selectionMoveEnabled) {
            App.lastClicked = null;
            App.selectedFormat = null;
            updateFormatPanel();
            notifyAppState('selection');
            return;
          }
          beginUndoableDrag(sx, sy);
          App.moveAllDragging = true;
          App.moveAllStartX = cp.x; App.moveAllStartY = cp.y;
            App.moveAllOrigLots  = App.lots.map(l => ({ id: l.id, pts: l.points ? l.points.map(p => ({...p})) : null, lox: l.labelOffX||0, loy: l.labelOffY||0, elofs: l.edgeLabelOffsets ? JSON.parse(JSON.stringify(l.edgeLabelOffsets)) : null }));
          App.moveAllOrigItems = App.items.map(i => ({ id: i.id, pts: i.points ? i.points.map(p => ({...p})) : null, x1: i.x1, y1: i.y1, x2: i.x2, y2: i.y2, tipX: i.tipX, tipY: i.tipY, ox: i.offsetX, oy: i.offsetY }));
          App.moveAllOrigTexts = App.texts.map(t => ({ id: t.id, x: t.x, y: t.y, tipX: t.tipX, tipY: t.tipY }));
          canvas.style.cursor = 'grabbing';
        }
      }
      return;
    }
    // 文字・寸法移動モード（辺ラベル・計測ラベル・区画ラベルをドラッグ）
    if (App.lotTool === 'label-move') {
      const hit = hitLabel(sx, sy);
      if (hit) {
        beginUndoableDrag(sx, sy);
        if (hit.isLotEdge) {
          // 辺の寸法テキスト移動（旧:edge-label-move統合）
          const lot = App.lots.find(l => l.id === hit.lotId);
          if (lot) {
            if (!lot.edgeLabelOffsets) lot.edgeLabelOffsets = {};
            const uo = lot.edgeLabelOffsets[hit.edgeIdx] || { dx: 0, dy: 0 };
            App.draggingEdgeLabelLotId = lot.id;
            App.draggingEdgeLabelEdge  = hit.edgeIdx;
            App.dragEdgeLabelOffX = cp.x - uo.dx;
            App.dragEdgeLabelOffY = cp.y - uo.dy;
            canvas.style.cursor = 'grabbing';
          }
        } else if (hit.isLotLabel) {
          const lot = App.lots.find(l => l.id === hit.lotId);
          if (lot) {
            const cen = centroid(lot.points);
            App.draggingLotLabelId = lot.id;
            App.draggingRoadLabelPart = lot.type === 'road' ? (hit.roadLabelPart || 'title') : null;
            App.dragLotLabelOffX = cp.x - hit.cx;
            App.dragLotLabelOffY = cp.y - hit.cy;
            if (lot.type !== 'road' || App.draggingRoadLabelPart === 'title') {
              App.dragLotLabelOffX = cp.x - (cen.x + (lot.labelOffX || 0));
              App.dragLotLabelOffY = cp.y - (cen.y + (lot.labelOffY || 0));
            }
            canvas.style.cursor = 'grabbing';
          }
        } else {
          App.draggingId = hit.itemId;
          App.dragLabelKey = hit.labelKey;
          App.dragIsText = hit.isText;
          App.dragOffX = cp.x - hit.cx;
          App.dragOffY = cp.y - hit.cy;
          canvas.style.cursor = 'grabbing';
        }
      } else {
        const lot = hitLot(cp);
        if (lot && lot.points) {
          beginUndoableDrag(sx, sy);
          const cen = centroid(lot.points);
          App.draggingLotLabelId = lot.id;
          App.draggingRoadLabelPart = lot.type === 'road' ? 'title' : null;
          App.dragLotLabelOffX = cp.x - (cen.x + (lot.labelOffX || 0));
          App.dragLotLabelOffY = cp.y - (cen.y + (lot.labelOffY || 0));
          canvas.style.cursor = 'grabbing';
        }
      }
      return;
    }
    // 寸法テキスト移動モード
    if (App.lotTool === 'edge-label-move') {
      if (App.mpp && App.lotShowEdgeLengths) {
        let bestDist = 25 / App.vz, bestLot = null, bestEdge = -1;
        for (const lot of App.lots) {
          if (!lot.points || lot.type === 'road') continue;
          const pts = lot.points;
          const cen = centroid(pts);
          const scale = parseFloat(lot.edgeScale) || App.lotEdgeScale || 1.0;
          const fsE = pfs(7.5) * scale;
          const baseOff = fsE * 0.75;
          for (let i = 0; i < pts.length; i++) {
            const j = (i + 1) % pts.length;
            const p1 = pts[i], p2 = pts[j];
            const dx2 = p2.x - p1.x, dy2 = p2.y - p1.y;
            const len2 = Math.hypot(dx2, dy2) || 1;
            const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
            let nx2 = -dy2 / len2, ny2 = dx2 / len2;
            if ((cen.x - midX) * nx2 + (cen.y - midY) * ny2 > 0) { nx2 = -nx2; ny2 = -ny2; }
            const uo = (lot.edgeLabelOffsets && lot.edgeLabelOffsets[i]) || { dx: 0, dy: 0 };
            const lcx = midX + nx2 * baseOff + uo.dx;
            const lcy = midY + ny2 * baseOff + uo.dy;
            const d = Math.hypot(cp.x - lcx, cp.y - lcy);
            if (d < bestDist) { bestDist = d; bestLot = lot; bestEdge = i; }
          }
        }
        if (bestLot) {
          beginUndoableDrag(sx, sy);
          if (!bestLot.edgeLabelOffsets) bestLot.edgeLabelOffsets = {};
          const uo = bestLot.edgeLabelOffsets[bestEdge] || { dx: 0, dy: 0 };
          App.draggingEdgeLabelLotId = bestLot.id;
          App.draggingEdgeLabelEdge  = bestEdge;
          App.dragEdgeLabelOffX = cp.x - uo.dx;
          App.dragEdgeLabelOffY = cp.y - uo.dy;
          canvas.style.cursor = 'grabbing';
        }
      }
      return;
    }
    // 均等分割ガイドツール
    if (App.lotTool === 'divguide') {
      const dSnap = snapPoint(cp.x, cp.y);
      App.lotPts.push(dSnap.pt);
      if (App.lotPts.length === 2) {
        saveState();
        App.divGuides.push({ id: Date.now(), p1: App.lotPts[0], p2: App.lotPts[1], n: App.divGuideN });
        App.lotPts = [];
      }
      App.dirty = true;
      return;
    }
    if (App.lotTool === 'split-all') {
      // 一括分割: Phase1なし、直接分割線を描く
      const spSnap = snapPoint(cp.x, cp.y);
      App.lotPts.push(spSnap.pt);
      App.dirty = true;
      return;
    }
    if (App.lotTool === 'split') {
      if (App.splitTargetId === null) {
        // Phase 1: 分割する区画を選択（lotPtsには追加しない）
        let smallest = null, smallestArea = Infinity;
        for (const l of App.lots) {
          if (l.points && l.points.length >= 3 && pointInPolygon(cp.x, cp.y, l.points)) {
            const area = shoelace(l.points);
            if (area < smallestArea) { smallestArea = area; smallest = l; }
          }
        }
        // 境界上クリック対応: 10px以内のエッジを持つ区画を検索
        if (!smallest) {
          const tol = 10 / App.vz;
          let minDist = tol;
          for (const l of App.lots) {
            if (!l.points || l.points.length < 3) continue;
            for (let i = 0; i < l.points.length; i++) {
              const a = l.points[i], b = l.points[(i+1) % l.points.length];
              const d = ptSegDist(cp, a, b);
              if (d < minDist) { minDist = d; smallest = l; }
            }
          }
        }
        App.splitTargetId = smallest ? smallest.id : null;
        updateSplitUI();
        // 区画が見つからなければ何もしない
      } else {
        // Phase 2: 分割線を描く
        const spSnap = snapPoint(cp.x, cp.y);
        App.lotPts.push(spSnap.pt);
      }
      App.dirty = true;
      return;
    }
    if (App.lotTool === 'corner-cut') {
      if (App.cornerCutLotId === null) {
        // Phase 1: 区画を選択
        const hit = hitLot(cp);
        if (hit) { App.cornerCutLotId = hit.id; }
      } else {
        // Phase 2: 選択中の区画の頂点を検索してモーダルを開く
        const targetLot = App.lots.find(l => l.id === App.cornerCutLotId);
        if (targetLot && targetLot.points) {
          const tol = 15 / App.vz;
          let bestIdx = -1, bestDist = tol;
          for (let i = 0; i < targetLot.points.length; i++) {
            const d = Math.hypot(targetLot.points[i].x - cp.x, targetLot.points[i].y - cp.y);
            if (d < bestDist) { bestDist = d; bestIdx = i; }
          }
          if (bestIdx >= 0) {
            App.cornerCutIdx = bestIdx;
            document.getElementById('corner-cut-modal').classList.remove('hidden');
          } else {
            // 区画外をクリックしたら選択解除
            App.cornerCutLotId = null;
          }
        }
      }
      App.dirty = true;
      return;
    }
    if (App.lotTool === 'merge') {
      const hit = hitLot(cp);
      if (!hit) return;
      if (App.mergeSelect.includes(hit.id)) {
        // 同じ区画を再クリックで選択解除
        App.mergeSelect = App.mergeSelect.filter(id => id !== hit.id);
      } else {
        App.mergeSelect.push(hit.id);
        if (App.mergeSelect.length === 2) {
          commitMerge();
        }
      }
      App.dirty = true;
      return;
    }
    if (App.lotTool === 'draw' || App.lotTool === 'road') {
      const drSnap = snapPoint(cp.x, cp.y);
      App.lotPts.push(drSnap.pt);
      App.dirty = true;
      return;
    }
    // 平行線ツール
    if (App.lotTool === 'parallel') {
      const plSnap = snapPoint(cp.x, cp.y);
      App.pts.push(plSnap.pt);
      if (App.pts.length === 2) {
        App.parallelBase = { p1: App.pts[0], p2: App.pts[1] };
        App.parallelCount = 0;
        App.parallelDivCount = 0;
        App.pts = [];
        const ud = parseFloat(document.getElementById('parallel-dist').value) || 3;
        document.getElementById('parallel-create').textContent = `作成 (1本目: ${ud}m)`;
        document.getElementById('parallel-create').disabled = false;
      }
      App.dirty = true;
      return;
    }
    // 計測モード（分譲地内）は下の共通処理へ落とす
    if (App.lotTool === 'measure') { /* fall through */ }
    else return;
  }

  // パン
  if (e.button === 1 || (e.button === 0 && e.altKey) || App.mode === 'pan') {
    hidePlacementPreview();
    App.panning = true;
    App.panSX = sx; App.panSY = sy;
    App.panVX = App.vx; App.panVY = App.vy;
    canvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;

  // 削除モード（計測モード）
  if (App.mode === 'delete') {
    const hit = hitLabel(sx, sy);
    if (hit) {
      saveState();
      if (hit.isText) {
        App.texts = App.texts.filter(t => t.id !== hit.itemId);
      } else {
        App.items = App.items.filter(i => i.id !== hit.itemId);
      }
      updateResults();
      App.dirty = true;
    }
    return;
  }

  // 移動モード (select)
  if (App.mode === 'select') {
    const hit = hitLabel(sx, sy);   // スクリーン座標で判定
    if (hit) {
      beginUndoableDrag(sx, sy);
      App.draggingId = hit.itemId;  // itemId が正しいキー
      App.dragLabelKey = hit.labelKey;
      App.dragIsText = hit.isText;
      App.dragOffX = cp.x - hit.cx;
      App.dragOffY = cp.y - hit.cy;
      canvas.style.cursor = 'grabbing';
    }
    return;
  }

  // 頂点編集モード
  if (App.mode === 'vertex-edit') {
    const snapDist = 14 / App.vz;
    // 計測アイテムの頂点チェック
    let best = null, bestD = snapDist;
    for (const item of App.items) {
      if (!item.points) continue;
      for (let i = 0; i < item.points.length; i++) {
        const d = Math.hypot(item.points[i].x - cp.x, item.points[i].y - cp.y);
        if (d < bestD) { bestD = d; best = { isLot: false, itemId: item.id, ptIndex: i }; }
      }
    }
    // 区画の頂点チェック
    for (const lot of App.lots) {
      if (!lot.points) continue;
      for (let i = 0; i < lot.points.length; i++) {
        const d = Math.hypot(lot.points[i].x - cp.x, lot.points[i].y - cp.y);
        if (d < bestD) { bestD = d; best = { isLot: true, lotId: lot.id, ptIndex: i }; }
      }
    }
    if (best) {
      beginUndoableDrag(sx, sy);
      if (best.isLot) {
        App.draggingLotVertex = { lotId: best.lotId, ptIndex: best.ptIndex };
      } else {
        App.draggingVertex = { itemId: best.itemId, ptIndex: best.ptIndex };
      }
      canvas.style.cursor = 'grabbing';
    }
    return;
  }

  // ラベル編集モード（クリック1回で編集）
  if (App.mode === 'label-edit') {
    const hit = hitLabel(sx, sy);
    if (hit) {
      if (hit.isLotEdge) {
        // 区画辺ラベル編集
        const lot = App.lots.find(l => l.id === hit.lotId);
        if (lot) openLotEdgeLabelEditor(lot, hit.edgeIdx, sx, sy);
      } else if (hit.isLotCenter) {
        // 区画中央ラベル編集（㎡/坪）
        const lot = App.lots.find(l => l.id === hit.lotId);
        if (lot) openLotCenterLabelEditor(lot, hit.centerKey, sx, sy);
      } else if (!hit.isText) {
        // 計測アイテムラベル編集
        const item = App.items.find(i => i.id === hit.itemId);
        if (item) openLabelEditor(item, hit.labelKey, sx, sy);
      }
    }
    return;
  }


  // メモモード
  if (App.mode === 'text') {
    hidePlacementPreview();
    showTextInput(sx, sy, cp, App.placementText || '');
    return;
  }

  // 北マークモード
  if (App.mode === 'north-arrow') {
    hidePlacementPreview();
    const existingHit = hitLabel(sx, sy);
    const existingNorth = existingHit?.isText
      ? App.texts.find(t => t.id === existingHit.itemId && t.textType === 'north-arrow')
      : null;
    if (existingNorth) {
      finishOneShotObjectPlacement(existingNorth, e.clientX, e.clientY);
      return;
    }
    if (e.detail > 1) return;
    saveState();
    const northArrow = {
      id: App.nextId++,
      textType: 'north-arrow',
      x: cp.x, y: cp.y,
      angle: normalizeObjectAngle(App.northArrowAngle),
      size: App.northArrowSize,
      color: '#1e293b',
    };
    App.texts.push(northArrow);
    finishOneShotObjectPlacement(northArrow, e.clientX, e.clientY);
    return;
  }

  // スタンプモード（家屋・駐車場）
  if (App.mode === 'house-stamp' || App.mode === 'parking-stamp') {
    hidePlacementPreview();
    const existingHit = hitLabel(sx, sy);
    const existingStamp = existingHit?.isText
      ? App.texts.find(t => t.id === existingHit.itemId
        && (t.textType === 'house-stamp' || t.textType === 'parking-stamp'))
      : null;
    if (existingStamp) {
      finishOneShotObjectPlacement(existingStamp, e.clientX, e.clientY);
      return;
    }
    if (e.detail > 1) return;
    if (!App.mpp) { document.getElementById('calibration-modal').classList.remove('hidden'); return; }
    saveState();
    const isP = App.mode === 'parking-stamp';
    const stamp = {
      id: App.nextId++,
      textType: App.mode,
      x: cp.x, y: cp.y,
      angle: normalizeObjectAngle(App.stampAngle),
      wM: App.stampWM,
      hM: App.stampHM,
      label: App.stampLabel != null ? App.stampLabel : (isP ? 'P' : '家屋'),
      lineStyle: App.stampLineStyle || (isP ? 'dashed' : 'solid'),
      lineColor: App.stampLineColor || (isP ? '#1d4ed8' : '#78350f'),
      showDims: App.stampShowDims !== false,
    };
    App.texts.push(stamp);
    finishOneShotObjectPlacement(stamp, e.clientX, e.clientY);
    return;
  }

  // 引出線モード
  if (App.mode === 'callout') {
    if (App.pts.length === 0) {
      App.pts.push(cp);
      App.dirty = true;
    } else {
      App.pendingCalloutTip = App.pts[0];
      App.pts = [];
      showTextInput(sx, sy, cp, App.placementText || '');
    }
    return;
  }

  // 計測モードで縮尺未設定なら最初のクリック時にモーダルを開く
  const needsScale = ['distance', 'polyline', 'area'].includes(App.mode);
  if (needsScale && !App.mpp && App.pts.length === 0) {
    document.getElementById('calibration-modal').classList.remove('hidden');
    return;
  }

  // 計測（スナップ適用）
  const mSnap = snapPoint(cp.x, cp.y);
  App.pts.push(mSnap.pt);
  App.dirty = true;
  if ((App.mode === 'distance' || App.mode === 'arrow') && App.pts.length === 2) finishMeasurement();
}

function onMouseMove(e) {
  if (!App.pdfReady && !App.paperMode) return;
  const { sx, sy } = getRel(e);

  if (App.panning) {
    hidePlacementPreview();
    App.vx = App.panVX + sx - App.panSX;
    App.vy = App.panVY + sy - App.panSY;
    updateZoomInfo();
    App.dirty = true;
    return;
  }

  const cp = s2c(sx, sy);
  App.mx = cp.x; App.my = cp.y;
  if (isPlacementPreviewMode()) {
    App.placementPreviewInside = true;
    App.dirty = true;
  }
  if (App.dragPending) {
    if (Math.hypot(sx - App.dragStartSX, sy - App.dragStartSY) < 4) return;
    saveState();
    App.dragPending = false;
  }
  // スナッププレビュー更新（全モード共通）
  const _sp = snapPoint(cp.x, cp.y);
  App.snapPt = _sp.pt; App.snapType = _sp.type;

  // 分譲地モード
  if (App.appMode === 'subdivision') {
    if (App.draggingEdgeLabelLotId !== null) {
      const lot = App.lots.find(l => l.id === App.draggingEdgeLabelLotId);
      if (lot) {
        if (!lot.edgeLabelOffsets) lot.edgeLabelOffsets = {};
        lot.edgeLabelOffsets[App.draggingEdgeLabelEdge] = {
          dx: cp.x - App.dragEdgeLabelOffX,
          dy: cp.y - App.dragEdgeLabelOffY,
        };
        App.dirty = true;
      }
      return;
    }
    // 計測アイテム丸ごとドラッグ（図形移動）
    if (App.draggingItemId !== null) {
      const item = App.items.find(i => i.id === App.draggingItemId);
      if (item && App.dragItemOrigPts) {
        const dx = cp.x - App.dragItemStartX;
        const dy = cp.y - App.dragItemStartY;
        item.points = App.dragItemOrigPts.map(p => ({ x: p.x + dx, y: p.y + dy }));
        // ラベル位置もオフセット分だけ移動
        if (App.dragItemOrigLabelPos) {
          item.labelPos = { x: App.dragItemOrigLabelPos.x + dx, y: App.dragItemOrigLabelPos.y + dy };
        }
        if (App.dragItemOrigSegLabelPos) {
          item.segLabelPos = App.dragItemOrigSegLabelPos.map(p => p ? { x: p.x + dx, y: p.y + dy } : null);
        }
      }
      App.dirty = true;
      return;
    }
    // 全体移動ドラッグ
    if (App.moveAllDragging) {
      const dx = cp.x - App.moveAllStartX;
      const dy = cp.y - App.moveAllStartY;
      // 区画
      App.lots.forEach(lot => {
        const orig = App.moveAllOrigLots.find(o => o.id === lot.id);
        if (!orig) return;
        if (lot.points && orig.pts) lot.points.forEach((p, i) => { p.x = orig.pts[i].x + dx; p.y = orig.pts[i].y + dy; });
        lot.labelOffX = orig.lox; lot.labelOffY = orig.loy;
        if (lot.edgeLabelOffsets && orig.elofs) lot.edgeLabelOffsets = JSON.parse(JSON.stringify(orig.elofs));
      });
      // 計測アイテム
      App.items.forEach(item => {
        const orig = App.moveAllOrigItems.find(o => o.id === item.id);
        if (!orig) return;
        if (item.points && orig.pts) item.points.forEach((p, i) => { p.x = orig.pts[i].x + dx; p.y = orig.pts[i].y + dy; });
        if (orig.x1 != null) { item.x1 = orig.x1 + dx; item.y1 = orig.y1 + dy; item.x2 = orig.x2 + dx; item.y2 = orig.y2 + dy; }
        if (orig.tipX != null) { item.tipX = orig.tipX + dx; item.tipY = orig.tipY + dy; }
        if (orig.ox != null) { item.offsetX = orig.ox; item.offsetY = orig.oy; }
      });
      // テキスト
      App.texts.forEach(t => {
        const orig = App.moveAllOrigTexts.find(o => o.id === t.id);
        if (!orig) return;
        t.x = orig.x + dx; t.y = orig.y + dy;
        if (orig.tipX != null) { t.tipX = orig.tipX + dx; t.tipY = orig.tipY + dy; }
      });
      App.dirty = true;
      return;
    }
    if (App.draggingLotLabelId !== null) {
      const lot = App.lots.find(l => l.id === App.draggingLotLabelId);
      if (lot) {
        const cen = centroid(lot.points);
        if (lot.type === 'road' && App.draggingRoadLabelPart === 'width') {
          lot.roadWidthOffX = cp.x - App.dragLotLabelOffX - cen.x;
          lot.roadWidthOffY = cp.y - App.dragLotLabelOffY - cen.y;
        } else {
          lot.labelOffX = cp.x - App.dragLotLabelOffX - cen.x;
          lot.labelOffY = cp.y - App.dragLotLabelOffY - cen.y;
        }
      }
      App.dirty = true;
      return;
    }
    if (App.draggingLotId !== null) {
      const lot = App.lots.find(l => l.id === App.draggingLotId);
      if (lot && lot.points && App.dragLotOrigPoints && App.dragLotOrigCen) {
        let rawDx = (cp.x - App.dragLotOffX) - App.dragLotOrigCen.x;
        let rawDy = (cp.y - App.dragLotOffY) - App.dragLotOrigCen.y;
        // 頂点スナップ: 他の区画の頂点に吸着
        if (App.gridSnap) {
          const snapDist = 12 / App.vz;
          let bestDist = snapDist, bestSdx = 0, bestSdy = 0, found = false;
          for (const other of App.lots) {
            if (other.id === App.draggingLotId || !other.points) continue;
            for (const ov of other.points) {
              for (const ov2 of App.dragLotOrigPoints) {
                const cx = ov2.x + rawDx, cy = ov2.y + rawDy;
                const d = Math.hypot(ov.x - cx, ov.y - cy);
                if (d < bestDist) {
                  bestDist = d; bestSdx = ov.x - cx; bestSdy = ov.y - cy; found = true;
                }
              }
            }
          }
          if (found) { rawDx += bestSdx; rawDy += bestSdy; }
        }
        lot.points = App.dragLotOrigPoints.map(p => ({ x: p.x + rawDx, y: p.y + rawDy }));
      }
      App.dirty = true;
      return;
    }
    // ラベルドラッグ中は共通処理へ落とす
    if (App.mode === 'select' && App.draggingId !== null) { /* fall through */ }
    else {
      if (App.lotPts.length > 0 || App.pts.length > 0 || App.parallelBase) App.dirty = true;
      if (App.lotTool !== 'measure') return;
    }
  }

  // ラベルドラッグ
  if (App.mode === 'select' && App.draggingId !== null) {
    const newX = cp.x - App.dragOffX;
    const newY = cp.y - App.dragOffY;
    if (App.dragIsText) {
      const t = App.texts.find(t => t.id === App.draggingId);
      if (t) { t.x = newX; t.y = newY; }
    } else {
      const item = App.items.find(i => i.id === App.draggingId);
      if (item) {
        if (App.dragLabelKey === 'main') {
          item.labelPos = { x: newX, y: newY };
        } else if (App.dragLabelKey && App.dragLabelKey.startsWith('seg')) {
          const idx = parseInt(App.dragLabelKey.slice(3));
          if (!item.segLabelPos) item.segLabelPos = [];
          item.segLabelPos[idx] = { x: newX, y: newY };
        }
      }
    }
    App.dirty = true;
    return;
  }

  if (App.mpp) {
    const xM = (cp.x * App.mpp).toFixed(2);
    const yM = (cp.y * App.mpp).toFixed(2);
    document.getElementById('coord-display').textContent = `X:${xM}m Y:${yM}m`;
  }

  // 頂点ドラッグ
  if (App.draggingVertex) {
    const item = App.items.find(i => i.id === App.draggingVertex.itemId);
    if (item) {
      item.points[App.draggingVertex.ptIndex] = { x: cp.x, y: cp.y };
      recalcItem(item);
      App.dirty = true;
    }
    return;
  }
  if (App.draggingLotVertex) {
    const lot = App.lots.find(l => l.id === App.draggingLotVertex.lotId);
    if (lot) {
      lot.points[App.draggingLotVertex.ptIndex] = { x: cp.x, y: cp.y };
      // 区画面積を再計算
      const sqm = shoelace(lot.points) * (App.mpp || 0) * (App.mpp || 0);
      if (App.mpp) lot.area = sqm;
      App.dirty = true;
    }
    return;
  }

  // selectモード: 常に再描画してラベルBoxesを最新に保つ
  if (App.mode === 'select') {
    App.dirty = true;
    const hit = hitLabel(sx, sy);   // スクリーン座標で判定
    canvas.style.cursor = App.draggingId !== null ? 'grabbing' : (hit ? 'grab' : 'default');
  }

  // ラベル編集モード: ホバーでカーソル＆ハイライト変更
  if (App.mode === 'label-edit') {
    const hit = hitLabel(sx, sy);
    const newKey = hit ? (hit.isLotEdge
      ? (hit.lotId + '_lotedge' + hit.edgeIdx)
      : hit.isLotCenter
      ? (hit.lotId + '_' + hit.centerKey)
      : (hit.itemId + '_' + hit.labelKey)) : null;
    if (App._hoverLabelKey !== newKey) {
      App._hoverLabelKey = newKey;
      App.dirty = true;
    }
    canvas.style.cursor = hit ? 'pointer' : 'text';
  }

  if (App.pts.length > 0 || App.calibrating) App.dirty = true;
}

function onMouseUp(e) {
  App.canvasPointerDown = false;
  App.dragPending = false;
  if (App.panning) {
    App.panning = false;
    canvas.style.cursor = getCursor();
  }
  if (App.moveAllDragging) {
    App.moveAllDragging = false;
    App.moveAllOrigLots = null; App.moveAllOrigItems = null; App.moveAllOrigTexts = null;
    canvas.style.cursor = 'grab';
    updateLotPanel(); App.dirty = true;
  }
  if (App.draggingItemId !== null) {
    App.draggingItemId = null;
    App.dragItemOrigPts = null;
    App.dragItemOrigLabelPos = null;
    App.dragItemOrigSegLabelPos = null;
    canvas.style.cursor = 'default';
  }
  if (App.draggingId !== null) {
    App.draggingId = null;
    canvas.style.cursor = 'grab';
  }
  if (App.draggingLotId !== null) {
    App.draggingLotId = null;
    canvas.style.cursor = App.mode === 'select' ? 'default' : 'crosshair';
  }
  if (App.draggingLotLabelId !== null) {
    App.draggingLotLabelId = null;
    App.draggingRoadLabelPart = null;
    canvas.style.cursor = App.mode === 'select' ? 'default' : 'crosshair';
  }
  if (App.draggingEdgeLabelLotId !== null) {
    App.draggingEdgeLabelLotId = null;
    App.draggingEdgeLabelEdge = -1;
    canvas.style.cursor = 'crosshair';
  }
  if (App.draggingVertex !== null) {
    App.draggingVertex = null;
    updateResults();
    canvas.style.cursor = 'crosshair';
    App.dirty = true;
  }
  if (App.draggingLotVertex !== null) {
    App.draggingLotVertex = null;
    updateLotPanel();
    canvas.style.cursor = 'crosshair';
    App.dirty = true;
  }
  // ドラッグ終了 → 文字エディタを再表示（ドラッグ中は隠れている）
  if (App.selectedFormat && App.mode === 'select') updateFormatPanel();
}

function restoreEditedText(session) {
  if (!session) return;
  const index = App.texts.findIndex(t => t.id === session.id);
  if (index >= 0) App.texts[index] = JSON.parse(JSON.stringify(session.original));
}

function refreshObjectEditorResult() {
  updateResults();
  updateFormatPanel();
  App.dirty = true;
}

function setStampEditorKind(kind, { mutate = true } = {}) {
  if (!['house-stamp', 'parking-stamp'].includes(kind)) return;
  const stamp = App.texts.find(t => t.id === App.editingStampId);
  if (!stamp) return;
  const previousKind = stamp.textType === 'parking-stamp' ? 'parking-stamp' : 'house-stamp';
  const previousDefault = previousKind === 'parking-stamp' ? 'P' : '家屋';
  const nextDefault = kind === 'parking-stamp' ? 'P' : '家屋';
  if (mutate) {
    stamp.textType = kind;
    if (stamp.label == null || stamp.label === previousDefault) stamp.label = nextDefault;
  }
  const labelInput = document.getElementById('stamp-edit-label-text');
  if (labelInput) labelInput.value = stamp.label ?? '';
  const title = document.getElementById('stamp-edit-label');
  if (title) title.textContent = kind === 'parking-stamp' ? '駐車場スタンプを編集' : '家屋スタンプを編集';
  document.querySelectorAll('#stamp-edit-kind-switch .next-editor-kind-button').forEach(btn => {
    const active = btn.dataset.kind === kind;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  if (mutate) App.dirty = true;
}

function cancelStampEditor() {
  restoreEditedText(_stampEditSession);
  _stampEditSession = null;
  App.editingStampId = null;
  document.getElementById('stamp-edit-panel')?.classList.add('hidden');
  refreshObjectEditorResult();
}

function commitStampEditor() {
  const stamp = App.texts.find(t => t.id === App.editingStampId);
  if (stamp) stamp.angle = normalizeObjectAngle(stamp.angle);
  if (_stampEditSession && stamp && JSON.stringify(stamp) !== JSON.stringify(_stampEditSession.original)) {
    pushHistoryState(_stampEditSession.historyState);
  }
  _stampEditSession = null;
  App.editingStampId = null;
  document.getElementById('stamp-edit-panel')?.classList.add('hidden');
  refreshObjectEditorResult();
}

function deleteStampEditor() {
  if (App.editingStampId == null) return;
  if (_stampEditSession) pushHistoryState(_stampEditSession.historyState);
  else saveState();
  App.texts = App.texts.filter(t => t.id !== App.editingStampId);
  _stampEditSession = null;
  App.editingStampId = null;
  document.getElementById('stamp-edit-panel')?.classList.add('hidden');
  reconcileSelectionState();
  refreshObjectEditorResult();
}

function cancelNorthArrowEditor() {
  restoreEditedText(_northEditSession);
  _northEditSession = null;
  App.editingNorthArrowId = null;
  document.getElementById('north-arrow-edit-panel')?.classList.add('hidden');
  refreshObjectEditorResult();
}

function commitNorthArrowEditor() {
  const north = App.texts.find(t => t.id === App.editingNorthArrowId);
  if (north) north.angle = normalizeObjectAngle(north.angle);
  if (_northEditSession && north && JSON.stringify(north) !== JSON.stringify(_northEditSession.original)) {
    pushHistoryState(_northEditSession.historyState);
  }
  _northEditSession = null;
  App.editingNorthArrowId = null;
  document.getElementById('north-arrow-edit-panel')?.classList.add('hidden');
  refreshObjectEditorResult();
}

function deleteNorthArrowEditor() {
  if (App.editingNorthArrowId == null) return;
  if (_northEditSession) pushHistoryState(_northEditSession.historyState);
  else saveState();
  App.texts = App.texts.filter(t => t.id !== App.editingNorthArrowId);
  _northEditSession = null;
  App.editingNorthArrowId = null;
  document.getElementById('north-arrow-edit-panel')?.classList.add('hidden');
  reconcileSelectionState();
  refreshObjectEditorResult();
}

function hideFloatingEditors(exceptId = '') {
  const stampPanel = document.getElementById('stamp-edit-panel');
  const northPanel = document.getElementById('north-arrow-edit-panel');
  const memoPanel = document.getElementById('memo-panel');
  const labelPanel = document.getElementById('label-edit-overlay');
  if (exceptId !== 'stamp-edit-panel' && stampPanel && !stampPanel.classList.contains('hidden')) cancelStampEditor();
  if (exceptId !== 'north-arrow-edit-panel' && northPanel && !northPanel.classList.contains('hidden')) cancelNorthArrowEditor();
  if (exceptId !== 'memo-panel' && memoPanel && !memoPanel.classList.contains('hidden')) cancelTextInput();
  if (exceptId !== 'label-edit-overlay' && labelPanel && !labelPanel.classList.contains('hidden')) cancelLabelEdit();
  if (exceptId !== 'color-picker-popup') document.getElementById('color-picker-popup')?.classList.add('hidden');
}

function getFloatingEditorSafeRect() {
  const canvasContainer = document.getElementById('canvas-container');
  const rect = canvasContainer?.getBoundingClientRect();
  const margin = 8;
  const fallback = { left: margin, top: margin, right: window.innerWidth - margin, bottom: window.innerHeight - margin };
  if (!rect || rect.width < 220 || rect.height < 180) return fallback;
  return {
    left: Math.max(margin, rect.left + margin),
    top: Math.max(margin, rect.top + margin),
    right: Math.min(window.innerWidth - margin, rect.right - margin),
    bottom: Math.min(window.innerHeight - margin, rect.bottom - margin),
  };
}

function clampFloatingEditorPosition(panel, left, top) {
  const safe = getFloatingEditorSafeRect();
  const rect = panel.getBoundingClientRect();
  const maxLeft = Math.max(safe.left, safe.right - rect.width);
  const maxTop = Math.max(safe.top, safe.bottom - rect.height);
  return {
    left: Math.min(Math.max(left, safe.left), maxLeft),
    top: Math.min(Math.max(top, safe.top), maxTop),
    maxHeight: Math.max(180, safe.bottom - safe.top),
  };
}

function positionCanvasFloatingPanel(panel, clientX, clientY) {
  positionViewportFloatingPanel(panel, clientX + 12, clientY - 20);
}

function positionViewportFloatingPanel(panel, clientX, clientY) {
  if (!panel) return;
  hideFloatingEditors(panel.id);
  if (['memo-panel', 'stamp-edit-panel', 'north-arrow-edit-panel'].includes(panel.id)) {
    document.getElementById('text-editor-pop')?.classList.add('hidden');
  }
  panel.classList.remove('hidden');
  panel.style.visibility = 'hidden';
  panel.style.left = '0px';
  panel.style.top = '0px';
  const safe = getFloatingEditorSafeRect();
  const docked = window.innerWidth <= 900 || window.innerHeight <= 640;
  panel.classList.toggle('is-docked-editor', docked);
  panel.style.maxHeight = Math.max(180, safe.bottom - safe.top) + 'px';
  const rect = panel.getBoundingClientRect();
  const preferredLeft = docked ? safe.right - rect.width : clientX;
  const preferredTop = docked ? safe.top : clientY;
  const pos = clampFloatingEditorPosition(panel, preferredLeft, preferredTop);
  panel.style.left = pos.left + 'px';
  panel.style.top = pos.top + 'px';
  panel.style.visibility = '';
}

function focusFloatingInputAfterPointer(input, { select = false } = {}) {
  if (!input) return;
  const focus = () => {
    if (!input.isConnected || input.closest('.hidden')) return;
    input.focus({ preventScroll: true });
    if (select) input.select?.();
  };
  if (App.canvasPointerDown) {
    window.addEventListener('mouseup', () => {
      App.canvasPointerDown = false;
      requestAnimationFrame(focus);
    }, { once: true, capture: true });
  } else {
    requestAnimationFrame(focus);
  }
}

function openNorthArrowEditor(id, clientX, clientY) {
  const alreadyOpen = _northEditSession?.id === id
    && !document.getElementById('north-arrow-edit-panel')?.classList.contains('hidden');
  if (alreadyOpen) return;
  if (_northEditSession) cancelNorthArrowEditor();
  const t = App.texts.find(x => x.id === id);
  if (!t) return;
  App.editingNorthArrowId = id;
  _northEditSession = {
    id,
    original: JSON.parse(JSON.stringify(t)),
    historyState: captureHistoryState(),
  };
  const panel = document.getElementById('north-arrow-edit-panel');
  if (!panel) return;
  const angleInput = document.getElementById('na-edit-angle');
  const angleSlider = document.getElementById('na-edit-angle-slider');
  const angle = syncAngleControls(angleInput, angleSlider, t.angle);
  t.angle = angle;
  const sz = t.size || 1.0;
  document.getElementById('na-edit-size').value = sz;
  document.getElementById('na-edit-size-val').textContent = sz.toFixed(2).replace(/\.?0+$/, '') + '×';
  const color = t.color || '#1e293b';
  document.querySelectorAll('.north-edit-color-swatch').forEach(button => {
    button.classList.toggle('is-active', button.dataset.color === color);
  });
  positionCanvasFloatingPanel(panel, clientX, clientY);
}

function openStampEditor(id, clientX, clientY) {
  const alreadyOpen = _stampEditSession?.id === id
    && !document.getElementById('stamp-edit-panel')?.classList.contains('hidden');
  if (alreadyOpen) return;
  if (_stampEditSession) cancelStampEditor();
  const t = App.texts.find(x => x.id === id);
  if (!t) return;
  App.editingStampId = id;
  _stampEditSession = {
    id,
    original: JSON.parse(JSON.stringify(t)),
    historyState: captureHistoryState(),
  };
  const panel = document.getElementById('stamp-edit-panel');
  if (!panel) return;
  const isParking = t.textType === 'parking-stamp';
  setStampEditorKind(isParking ? 'parking-stamp' : 'house-stamp', { mutate: false });
  document.getElementById('stamp-edit-w').value = t.wM;
  document.getElementById('stamp-edit-h').value = t.hM;
  const angleInput = document.getElementById('stamp-edit-angle');
  const sl = document.getElementById('stamp-edit-angle-slider');
  const ang = syncAngleControls(angleInput, sl, t.angle);
  t.angle = ang;
  // テキスト
  const labelInp = document.getElementById('stamp-edit-label-text');
  if (labelInp) labelInp.value = t.label != null ? t.label : (isParking ? 'P' : '家屋');
  // 線の種類
  const ls = t.lineStyle || (isParking ? 'dashed' : 'solid');
  document.querySelectorAll('.btn-stamp-edit-line').forEach(b => {
    const active = b.dataset.ls === ls;
    b.classList.toggle('active-stamp-edit-line', active);
    b.style.background = active ? '#1d4ed8' : '#0f1a2e';
    b.style.color = active ? '#fff' : '#94a3b8';
    b.style.borderColor = active ? '#3b82f6' : '#334155';
  });
  // 線の色
  const lc = t.lineColor || (isParking ? '#1d4ed8' : '#78350f');
  document.querySelectorAll('.stamp-edit-color-swatch').forEach(sw => {
    const active = sw.dataset.sc === lc;
    sw.classList.toggle('active-stamp-edit-color', active);
    sw.style.outline = active ? '2px solid #60a5fa' : 'none';
  });
  // 寸法トグル
  const dimsBtn = document.getElementById('stamp-edit-dims-toggle');
  if (dimsBtn) {
    const on = t.showDims !== false;
    dimsBtn.textContent = on ? '寸法 ON' : '寸法 OFF';
    dimsBtn.dataset.on = String(on);
    dimsBtn.style.background = on ? '#1d4ed8' : '#1e293b';
    dimsBtn.style.color = on ? '#fff' : '#94a3b8';
    dimsBtn.style.borderColor = on ? '#3b82f6' : '#334155';
  }
  positionCanvasFloatingPanel(panel, clientX, clientY);
}

function onDblClick(e) {
  if (!App.pdfReady && !App.paperMode) return;
  const { sx, sy } = getRel(e);
  const cp = s2c(sx, sy);

  // スタンプ編集（全モード共通）
  const hitS = hitLabel(sx, sy);
  if (hitS && hitS.isText) {
    const st = App.texts.find(x => x.id === hitS.itemId &&
      (x.textType === 'house-stamp' || x.textType === 'parking-stamp'));
    if (st) { openStampEditor(st.id, e.clientX, e.clientY); return; }
  }

  // 北マーク編集（全モード共通で最優先）
  const hitN = hitLabel(sx, sy);
  if (hitN && hitN.isText) {
    const nt = App.texts.find(x => x.id === hitN.itemId && x.textType === 'north-arrow');
    if (nt) { openNorthArrowEditor(nt.id, e.clientX, e.clientY); return; }
  }

  // 分譲地モード
  if (App.appMode === 'subdivision') {
    if ((App.lotTool === 'split' || App.lotTool === 'split-all') && App.lotPts.length >= 2) {
      App.lotPts.pop();
      const polyline = [...App.lotPts];
      App.lotPts = [];
      if (polyline.length >= 2) splitAllLotsByPolyline(polyline, App.lotTool === 'split-all');
      App.dirty = true;
      return;
    }
    if ((App.lotTool === 'draw' || App.lotTool === 'road') && App.lotPts.length >= 2) {
      const candidate = [...App.lotPts];
      const last = candidate[candidate.length - 1];
      const prev = candidate[candidate.length - 2];
      if (last && prev && dist(last, prev) <= 8 / App.vz) candidate.pop();
      App.lotPts = candidate;
      if (candidate.length >= 3) confirmLotDraw();
      else App.dirty = true;
      return;
    }
    // 計測モードのダブルクリックは共通処理へ落とす
    if (App.lotTool === 'measure') { /* fall through */ }
    else {
      // 選択・移動ツール: メモ・引出線をダブルクリックで編集（スタンプ/北マークは冒頭で処理済み）
      if (App.mode === 'select') {
        const hit = hitS || hitLabel(sx, sy);
        // 区画・道路ラベルは本体から離して配置できるため、ポリゴンの
        // ヒット判定より先にラベルから統合エディタへ到達できるようにする。
        // 個別ラベル編集モードでは従来どおり1クリック編集を優先する。
        if (hit && (hit.isLotLabel || hit.isLotEdge || hit.isLotCenter)) {
          openLotEditor(hit.lotId);
          return;
        }
        if (hit && hit.isText) {
          const t = App.texts.find(t => t.id === hit.itemId);
          if (t && !t.textType) {  // 通常メモ・引出線のみ
            openMemoEditor(t.id, e.clientX, e.clientY);
            return;
          }
        }
      }
      const lot = hitLot(cp);
      if (lot) openLotEditor(lot.id);
      return;
    }
  }

  // selectモード: テキストをダブルクリックで編集
  if (App.mode === 'select') {
    const hit = hitLabel(sx, sy);   // スクリーン座標で判定
    if (hit && hit.isText) {
      const t = App.texts.find(t => t.id === hit.itemId);
      if (t && !t.textType) openMemoEditor(t.id, e.clientX, e.clientY);
    }
    return;
  }

  if ((App.mode === 'polyline' || App.mode === 'area' || App.mode === 'line') && App.pts.length >= 2) {
    App.pts.pop();
    finishMeasurement();
  }
}

function onWheel(e) {
  e.preventDefault();
  if (!App.pdfReady && !App.paperMode) return;
  const { sx, sy } = getRel(e);

  // lot-table 上ならフォントサイズ変更（ズームせず）
  const hit = hitLabel(sx, sy);
  if (hit && hit.isText) {
    const t = App.texts.find(t => t.id === hit.itemId && t.textType === 'lot-table');
    if (t) {
      const delta = e.deltaY < 0 ? 1 : -1;
      t.fontSize = Math.max(6, Math.min(30, (t.fontSize || 11) + delta));
      App.dirty = true;
      return;
    }
  }

  // 通常ズーム
  const f = e.deltaY < 0 ? 1.12 : 0.89;
  const newZ = Math.max(0.05, Math.min(30, App.vz * f));
  App.vx = sx - (sx - App.vx) * newZ / App.vz;
  App.vy = sy - (sy - App.vy) * newZ / App.vz;
  App.vz = newZ;
  updateZoomInfo();
  App.dirty = true;
}

// ===== ラベルヒット判定（スクリーン座標で比較）=====
function hitLabel(sx, sy) {
  for (const box of [...App.labelBoxes].reverse()) {
    if (sx >= box.sx && sx <= box.sx + box.sw &&
        sy >= box.sy && sy <= box.sy + box.sh) {
      return box;
    }
  }
  return null;
}

// ===== モード =====
function setMode(mode) {
  if (blockToolSwitchDuringCalibration()) return;
  cancelCurrent();
  App._hoverLabelKey = null;
  App.mode = mode;
  document.querySelectorAll('.tool-btn[data-mode]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.mode === mode));
  canvas.style.cursor = getCursor();
  updateHint();
  notifyAppState('tool');
}

function getCursor() {
  if (App.mode === 'pan') return 'grab';
  if (App.mode === 'select') return 'default';
  if (App.mode === 'vertex-edit') return 'crosshair';
  if (App.mode === 'label-edit') return 'text';
  if (App.mode === 'text' || App.mode === 'callout') return 'crosshair';
  return 'crosshair';
}

function cancelCurrent() {
  hidePlacementPreview();
  App.pts = [];
  App.lotPts = [];
  App.calibPts = [];
  App.calibrating = false;
  App.draggingId = null;
  App.draggingLotLabelId = null;
  App.draggingRoadLabelPart = null;
  App.draggingVertex = null;
  App.draggingLotVertex = null;
  cancelLabelEdit();
  App.dirty = true;
}

// ===== ラベル編集 =====
function showLabelEditOverlay(currentText, sx, sy, showColor, currentColor) {
  const overlay = document.getElementById('label-edit-overlay');
  const input = document.getElementById('label-edit-input');
  const colorRow = document.getElementById('label-color-row');
  if (!overlay || !input || !colorRow) {
    showToast('ラベル編集画面を開けませんでした', 3000);
    cancelLabelEdit();
    return;
  }
  const canvasRect = canvas.getBoundingClientRect();
  positionViewportFloatingPanel(overlay, canvasRect.left + sx + 12, canvasRect.top + sy - 20);
  input.value = currentText;
  focusFloatingInputAfterPointer(input, { select: true });
  // 色選択行の表示/非表示
  colorRow.style.display = showColor ? 'flex' : 'none';
  if (showColor) {
    App._editingLabelColor = currentColor || '';
    document.querySelectorAll('.lec-sw').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === App._editingLabelColor);
    });
  }
}

function openLabelEditor(item, labelKey, sx, sy) {
  App.editingLabelItem = item;
  App.editingLabelKey = labelKey;
  App.editingLotId = null;
  App.editingLotEdgeIdx = null;

  let currentText = '';
  if (labelKey === 'main') {
    if (item.type === 'polyline') {
      currentText = item.customLabel != null ? item.customLabel : ('合計: ' + item.label);
    } else {
      currentText = item.customLabel != null ? item.customLabel : item.label;
    }
  } else {
    const idx = parseInt(labelKey.replace('seg', ''));
    const rawLbl = (item.segValues && item.segValues[idx] != null)
      ? formatEdge(item.segValues[idx]) : (item.segLabels && item.segLabels[idx]);
    currentText = (item.customSegLabels && item.customSegLabels[idx] != null)
      ? item.customSegLabels[idx] : (rawLbl || '');
  }
  showLabelEditOverlay(currentText, sx, sy);
}

function openLotCenterLabelEditor(lot, centerKey, sx, sy) {
  App.editingLabelItem = null; App.editingLabelKey = null;
  App.editingLotId = lot.id;
  App.editingLotEdgeIdx = null;
  App.editingLotCenterKey = centerKey;
  const sqm = App.mpp ? shoelace(lot.points) * App.mpp * App.mpp : null;
  let currentText = '', currentColor = '';
  if (centerKey === 'area') {
    currentText  = lot.customAreaLabel  != null ? lot.customAreaLabel  : (sqm ? sqm.toFixed(1) + '㎡' : '');
    currentColor = lot.customAreaLabelColor  || '';
  } else {
    currentText  = lot.customTsuboLabel != null ? lot.customTsuboLabel : (sqm ? (sqm * 0.3025).toFixed(1) + '坪' : '');
    currentColor = lot.customTsuboLabelColor || '';
  }
  showLabelEditOverlay(currentText, sx, sy, true, currentColor);
}

function openLotEdgeLabelEditor(lot, edgeIdx, sx, sy) {
  App.editingLabelItem = null;
  App.editingLabelKey = null;
  App.editingLotId = lot.id;
  App.editingLotEdgeIdx = edgeIdx;
  App.editingLotCenterKey = null;

  let currentText = '', currentColor = '';
  if (lot.customEdgeLabels && lot.customEdgeLabels[edgeIdx] != null) {
    currentText = lot.customEdgeLabels[edgeIdx];
  } else if (App.mpp) {
    const p1 = lot.points[edgeIdx];
    const p2 = lot.points[(edgeIdx + 1) % lot.points.length];
    currentText = formatEdge(dist(p1, p2) * App.mpp);
  }
  currentColor = (lot.customEdgeLabelColors && lot.customEdgeLabelColors[edgeIdx]) || '';
  showLabelEditOverlay(currentText, sx, sy, true, currentColor);
}

function confirmLabelEdit() {
  const input = document.getElementById('label-edit-input');
  if (!input) {
    showToast('ラベル編集を確定できませんでした', 3000);
    cancelLabelEdit();
    return;
  }
  const val = input.value.trim();
  const historyState = captureHistoryState();
  const historyStateJson = JSON.stringify(historyState);

  const colorVal = App._editingLabelColor || null; // ''→null（自動）

  if (App.editingLotId !== null && App.editingLotEdgeIdx !== null) {
    // 区画辺ラベル
    const lot = App.lots.find(l => l.id === App.editingLotId);
    if (lot) {
      if (!lot.customEdgeLabels) lot.customEdgeLabels = {};
      lot.customEdgeLabels[App.editingLotEdgeIdx] = val === '' ? null : val;
      if (!lot.customEdgeLabelColors) lot.customEdgeLabelColors = {};
      lot.customEdgeLabelColors[App.editingLotEdgeIdx] = colorVal;
    }
  } else if (App.editingLotId !== null && App.editingLotCenterKey !== null) {
    // 区画中央ラベル（㎡/坪）
    const lot = App.lots.find(l => l.id === App.editingLotId);
    if (lot) {
      if (App.editingLotCenterKey === 'area') {
        lot.customAreaLabel = val === '' ? null : val;
        lot.customAreaLabelColor = colorVal;
      }
      if (App.editingLotCenterKey === 'tsubo') {
        lot.customTsuboLabel = val === '' ? null : val;
        lot.customTsuboLabelColor = colorVal;
      }
    }
  } else if (App.editingLabelItem) {
    // 計測アイテムラベル
    const item = App.editingLabelItem;
    const key = App.editingLabelKey;
    if (key === 'main') {
      item.customLabel = val === '' ? null : val;
    } else {
      const idx = parseInt(key.replace('seg', ''));
      if (!item.customSegLabels) item.customSegLabels = {};
      item.customSegLabels[idx] = val === '' ? null : val;
    }
  }

  if (JSON.stringify(captureHistoryState()) !== historyStateJson) {
    pushHistoryState(historyState);
  }

  App.editingLabelItem = null;
  App.editingLabelKey = null;
  App.editingLotId = null;
  App.editingLotCenterKey = null;
  App.editingLotEdgeIdx = null;
  const _leo = document.getElementById('label-edit-overlay');
  if (_leo) _leo.classList.add('hidden');
  App.dirty = true;
}

// v1.4 command boundary ---------------------------------------------------
//
// The legacy UI had two independent tool states (`mode` and `lotTool`) and
// several editors kept their draft values after the visible tool changed.
// A command change must be a hard boundary: keep the document and viewport,
// but discard every in-progress gesture/editor/placement.  The v1.4 shell
// calls this before activating any command.
function resetCommandSession(options = {}) {
  const preserveSelection = options.preserveSelection === true;

  // Editors modify a live object while open.  Use their own cancel paths so a
  // half-edited object is restored instead of being silently committed.
  if (typeof _lotEditSession !== 'undefined' && _lotEditSession) cancelLotEdit();
  if (_memoEditSession) cancelTextInput();
  if (_stampEditSession) cancelStampEditor();
  if (_northEditSession) cancelNorthArrowEditor();

  cancelCurrent();
  App.parallelBase = null;
  App.parallelFlip = 1;
  App.parallelCount = 0;
  App.parallelDivCount = 0;
  App.mergeSelect = [];
  App.splitTargetId = null;
  App.cornerCutLotId = null;
  App.cornerCutIdx = -1;
  App.snapPt = null;
  App.snapType = null;
  App.pendingTextPos = null;
  App.pendingCalloutTip = null;
  App.editingTextId = null;
  App.cpTargetId = null;
  App.cpTargetIsText = false;
  App.editingLabelItem = null;
  App.editingLabelKey = null;
  App._editingLabelColor = '';
  App._hoverLabelKey = null;
  App.editingStampId = null;
  App.editingNorthArrowId = null;
  App.editingLotId = null;
  App.editingLotEdgeIdx = null;
  App.editingLotCenterKey = null;
  App.draggingId = null;
  App.draggingItemId = null;
  App.draggingLotId = null;
  App.draggingLotLabelId = null;
  App.draggingRoadLabelPart = null;
  App.draggingEdgeLabelLotId = null;
  App.draggingEdgeLabelEdge = -1;
  App.draggingVertex = null;
  App.draggingLotVertex = null;
  App.dragItemOrigPts = null;
  App.dragItemOrigLabelPos = null;
  App.dragItemOrigSegLabelPos = null;
  App.dragLotOrigPoints = null;
  App.dragLotOrigCen = null;
  App.moveAllDragging = false;
  App.moveAllOrigLots = null;
  App.moveAllOrigItems = null;
  App.moveAllOrigTexts = null;
  App.panning = false;
  App.canvasPointerDown = false;
  App.dragPending = false;
  App.placementPreviewInside = false;

  if (!preserveSelection) {
    App.lastClicked = null;
    App.selectedFormat = null;
  }

  [
    'calibration-modal', 'calibration-dist-modal', 'corner-cut-modal',
    'lot-edit-modal', 'memo-panel', 'stamp-edit-panel',
    'north-arrow-edit-panel', 'label-edit-overlay', 'color-picker-popup',
  ].forEach(id => document.getElementById(id)?.classList.add('hidden'));
  document.getElementById('bg-adjust-bar')?.classList.add('hidden');
  updateSplitUI();
  updateFormatPanel();
  updateHint();
  App.dirty = true;
  notifyAppState('command-reset');
}

function cancelLabelEdit() {
  App.editingLabelItem = null;
  App.editingLabelKey = null;
  App.editingLotId = null;
  App.editingLotEdgeIdx = null;
  App.editingLotCenterKey = null;
  const overlay = document.getElementById('label-edit-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function updateGlobalDisplayButtons() {
  const edgeBtn = document.getElementById('btn-toggle-edge-lengths');
  if (edgeBtn) {
    edgeBtn.classList.toggle('toggle-on', App.lotShowEdgeLengths);
    edgeBtn.style.color = App.lotShowEdgeLengths ? '#34d399' : '';
    edgeBtn.textContent = App.lotShowEdgeLengths ? '辺寸法 表示' : '辺寸法 非表示';
  }
  const numBtn = document.getElementById('btn-show-lot-numbers');
  if (numBtn) {
    numBtn.classList.toggle('toggle-on', App.showLotNumbers);
    numBtn.style.color = App.showLotNumbers ? '#34d399' : '';
    numBtn.textContent = App.showLotNumbers ? '番号 表示' : '番号 非表示';
  }
}

function updateLotEditGlobalDisplayControls() {
  updateGlobalDisplayButtons();
}

// ===== 選択中の書式（回転）パネル =====
function setSelectedFormatFromHit(labelHit) {
  _fmtEditSaved = false; // 新しい選択 = 新しい編集セッション（undoまとめ用）
  if (!labelHit) { App.selectedFormat = null; updateFormatPanel(); return; }
  if (labelHit.isLotEdge) {
    // 区画の辺の寸法（辺沿いの自動回転＋追加オフセット）
    App.selectedFormat = { kind: 'lot-edge', id: labelHit.lotId, edge: labelHit.edgeIdx };
  } else if (labelHit.isLotLabel) {
    const lot = App.lots.find(l => l.id === labelHit.lotId);
    App.selectedFormat = (lot && lot.type === 'road')
      ? { kind: labelHit.roadLabelPart === 'width' ? 'road-width-label' : 'road-label', id: labelHit.lotId }
      : { kind: 'lot-label', id: labelHit.lotId };
  } else if (labelHit.isText) {
    const t = App.texts.find(x => x.id === labelHit.itemId);
    if (!t) { App.selectedFormat = null; updateFormatPanel(); return; }
    if (t.textType === 'north-arrow') App.selectedFormat = { kind: 'north', id: t.id };
    else if (t.textType === 'house-stamp' || t.textType === 'parking-stamp') App.selectedFormat = { kind: 'stamp', id: t.id };
    else if (t.textType === 'lot-table') App.selectedFormat = { kind: 'table', id: t.id };
    else App.selectedFormat = { kind: 'text', id: t.id }; // メモ・引出線
  } else {
    // 計測ラベル（距離・折れ線・面積の数字）
    const it = App.items.find(x => x.id === labelHit.itemId);
    App.selectedFormat = it ? { kind: 'item-label', id: it.id, labelKey: labelHit.labelKey || 'main' } : null;
  }
  updateFormatPanel();
}

// ===== 統一文字エディタ: 選択要素アクセサ =====
// 編集セッション中は最初の変更だけ saveState（スライダー連続操作を1 undo にまとめる）
let _fmtEditSaved = false;
function _fmtSaveOnce() { if (!_fmtEditSaved) { saveState(); _fmtEditSaved = true; } }
function _selLot()     { const sf = App.selectedFormat; return sf ? App.lots.find(x => x.id === sf.id)  : null; }
function _selItem()    { const sf = App.selectedFormat; return sf ? App.items.find(x => x.id === sf.id) : null; }
function _selTextObj() { const sf = App.selectedFormat; return sf ? App.texts.find(x => x.id === sf.id) : null; }

function getSelectedRotation() {
  const sf = App.selectedFormat;
  if (!sf) return 0;
  if (sf.kind === 'item') return 0;
  if (sf.kind === 'lot-label')  { const l = _selLot(); return (l && l.labelRotation) || 0; }
  if (sf.kind === 'road-label') { const l = _selLot(); return (l && l.roadLabelRotation) || 0; }
  if (sf.kind === 'road-width-label') { const l = _selLot(); return (l && l.roadLabelRotation) || 0; }
  if (sf.kind === 'lot-edge')   { const l = _selLot(); return (l && l.edgeRotationOffset && l.edgeRotationOffset[sf.edge]) || 0; }
  if (sf.kind === 'item-label') { const it = _selItem(); return (it && it.labelRotation) || 0; }
  const t = _selTextObj();
  if (!t) return 0;
  if (sf.kind === 'stamp' || sf.kind === 'north') return normalizeObjectAngle(t.angle);
  return t.rotation || 0;
}

function setSelectedRotation(deg) {
  const sf = App.selectedFormat;
  if (!sf || sf.kind === 'item') return;
  _fmtSaveOnce();
  if (sf.kind === 'lot-label')  { const l = _selLot(); if (l) l.labelRotation = deg; }
  else if (sf.kind === 'road-label') { const l = _selLot(); if (l) l.roadLabelRotation = deg; }
  else if (sf.kind === 'road-width-label') { const l = _selLot(); if (l) l.roadLabelRotation = deg; }
  else if (sf.kind === 'lot-edge') { const l = _selLot(); if (l) { if (!l.edgeRotationOffset) l.edgeRotationOffset = {}; l.edgeRotationOffset[sf.edge] = deg; } }
  else if (sf.kind === 'item-label') { const it = _selItem(); if (it) it.labelRotation = deg; }
  else {
    const t = _selTextObj();
    if (t) { if (sf.kind === 'stamp' || sf.kind === 'north') t.angle = normalizeObjectAngle(deg); else t.rotation = deg; }
  }
  App.dirty = true;
}

// --- テキスト内容（編集不可の種別は null を返す） ---
function getSelectedText() {
  const sf = App.selectedFormat; if (!sf) return null;
  if (sf.kind === 'lot-label')  { const l = _selLot();  return l ? (l.topLabel || '') : null; }
  if (sf.kind === 'road-label') { const l = _selLot();  return l ? (l.roadLabel !== undefined ? l.roadLabel : '道路') : null; }
  if (sf.kind === 'road-width-label') { const l = _selLot(); return l ? (l.roadWidth != null ? String(l.roadWidth) : '') : null; }
  if (sf.kind === 'item-label') {
    const it = _selItem();
    if (!it) return null;
    if (sf.labelKey?.startsWith('seg')) {
      const index = parseInt(sf.labelKey.slice(3));
      const custom = it.customSegLabels?.[index];
      if (custom != null) return custom;
      if (it.segLabels?.[index] != null) return it.segLabels[index];
      if (it.segValues?.[index] != null) return formatEdge(it.segValues[index]);
      return '';
    }
    return it.customLabel != null ? it.customLabel : (it.label || '');
  }
  if (sf.kind === 'lot-edge')   { const l = _selLot(); if (!l) return null;
    const cv = l.customEdgeLabels && l.customEdgeLabels[sf.edge];
    if (cv != null) return cv;
    if (App.mpp) { const p1 = l.points[sf.edge], p2 = l.points[(sf.edge + 1) % l.points.length]; return formatEdge(dist(p1, p2) * App.mpp); }
    return ''; }
  if (sf.kind === 'text') { const t = _selTextObj(); return t ? (t.text || '') : null; }
  return null; // stamp / north はテキスト編集不可（詳細で）
}
function setSelectedText(str) {
  const sf = App.selectedFormat; if (!sf) return;
  _fmtSaveOnce();
  if (sf.kind === 'lot-label')  { const l = _selLot(); if (l) l.topLabel = str.trim() === '' ? null : str; }
  else if (sf.kind === 'road-label') { const l = _selLot(); if (l) l.roadLabel = str; }
  else if (sf.kind === 'road-width-label') { const l = _selLot(); if (l) l.roadWidth = parseFloat(str.replace(/[^0-9.]/g, '')) || null; }
  else if (sf.kind === 'item-label') {
    const it = _selItem();
    if (it && sf.labelKey?.startsWith('seg')) {
      const index = parseInt(sf.labelKey.slice(3));
      if (!it.customSegLabels) it.customSegLabels = {};
      it.customSegLabels[index] = str.trim() === '' ? null : str;
    } else if (it) {
      it.customLabel = str.trim() === '' ? null : str;
    }
  }
  else if (sf.kind === 'lot-edge')   { const l = _selLot(); if (l) { if (!l.customEdgeLabels) l.customEdgeLabels = {}; l.customEdgeLabels[sf.edge] = str.trim() === '' ? null : str; } }
  else if (sf.kind === 'text') { const t = _selTextObj(); if (t) t.text = str; }
  App.dirty = true;
}

function getSelectedVertical() {
  const sf = App.selectedFormat;
  if (!sf) return null;
  if (sf.kind === 'road-label') return !!_selLot()?.roadVertical;
  if (sf.kind !== 'text') return null;
  const t = _selTextObj();
  return t ? !!t.vertical : false;
}
function setSelectedVertical(on) {
  const sf = App.selectedFormat;
  _fmtSaveOnce();
  if (sf?.kind === 'road-label') {
    const lot = _selLot();
    if (lot) lot.roadVertical = !!on;
  } else if (sf?.kind === 'text') {
    const t = _selTextObj();
    if (t) t.vertical = !!on;
  }
  App.dirty = true;
}

function getSelectedFontFamily() {
  const sf = App.selectedFormat;
  if (!sf) return null;
  if (sf.kind === 'lot-label') return normalizeFontFamily(_selLot()?.labelFontFamily);
  if (sf.kind === 'road-label') return normalizeFontFamily(_selLot()?.roadLabelFontFamily);
  if (sf.kind === 'road-width-label') return normalizeFontFamily(_selLot()?.roadWidthFontFamily || _selLot()?.roadLabelFontFamily);
  if (sf.kind === 'lot-edge') {
    const lot = _selLot();
    return normalizeFontFamily(lot?.customEdgeFontFamilies?.[sf.edge] || lot?.edgeFontFamily);
  }
  if (sf.kind === 'item-label') return normalizeFontFamily(_selItem()?.labelFontFamily);
  if (sf.kind === 'text' || sf.kind === 'table') return normalizeFontFamily(_selTextObj()?.fontFamily);
  return null;
}

function setSelectedFontFamily(value) {
  const sf = App.selectedFormat;
  if (!sf) return;
  const fontFamily = normalizeFontFamily(value);
  _fmtSaveOnce();
  if (sf.kind === 'lot-label') { const lot = _selLot(); if (lot) lot.labelFontFamily = fontFamily; }
  else if (sf.kind === 'road-label') { const lot = _selLot(); if (lot) lot.roadLabelFontFamily = fontFamily; }
  else if (sf.kind === 'road-width-label') { const lot = _selLot(); if (lot) lot.roadWidthFontFamily = fontFamily; }
  else if (sf.kind === 'lot-edge') {
    const lot = _selLot();
    if (lot) {
      if (!lot.customEdgeFontFamilies) lot.customEdgeFontFamilies = {};
      lot.customEdgeFontFamilies[sf.edge] = fontFamily;
    }
  } else if (sf.kind === 'item-label') { const item = _selItem(); if (item) item.labelFontFamily = fontFamily; }
  else if (sf.kind === 'text' || sf.kind === 'table') { const text = _selTextObj(); if (text) text.fontFamily = fontFamily; }
  App.dirty = true;
}

// --- 大きさ（text=fontSize実px / north=size倍率 / その他=係数 / stamp=詳細で実寸） ---
function getSelectedSizeKind() {
  const sf = App.selectedFormat; if (!sf) return null;
  if (sf.kind === 'item') return null;
  if (sf.kind === 'text' || sf.kind === 'table') return 'px';
  if (sf.kind === 'stamp') return null;
  return 'scale';
}
function getSelectedSize() {
  const sf = App.selectedFormat; if (!sf) return 1;
  if (sf.kind === 'text' || sf.kind === 'table') { const t = _selTextObj(); return t ? (t.fontSize || (sf.kind === 'table' ? 11 : 14)) : 14; }
  if (sf.kind === 'lot-label')  { const l = _selLot();  return l ? (parseFloat(l.labelScale) || App.lotTextScale || 1) : 1; }
  if (sf.kind === 'road-label') { const l = _selLot();  return l ? (l.roadLabelSize || 1) : 1; }
  if (sf.kind === 'road-width-label') { const l = _selLot(); return l ? (l.roadWidthLabelSize || l.roadLabelSize || 1) : 1; }
  if (sf.kind === 'item-label') { const it = _selItem(); return it ? (it.labelScale || 1) : 1; }
  if (sf.kind === 'lot-edge')   { const l = _selLot(); return l ? ((l.customEdgeScales && l.customEdgeScales[sf.edge]) || 1) : 1; }
  if (sf.kind === 'north')      { const t = _selTextObj(); return t ? (t.size || 1) : 1; }
  return 1;
}
function setSelectedSize(v) {
  const sf = App.selectedFormat; if (!sf) return;
  const scale = Math.max(0.3, Math.min(5, Number(v) || 1));
  _fmtSaveOnce();
  if (sf.kind === 'text' || sf.kind === 'table') { const t = _selTextObj(); if (t) t.fontSize = Math.max(6, Math.min(72, v)); }
  else if (sf.kind === 'lot-label')  { const l = _selLot(); if (l) l.labelScale = scale; }
  else if (sf.kind === 'road-label') { const l = _selLot(); if (l) l.roadLabelSize = scale; }
  else if (sf.kind === 'road-width-label') { const l = _selLot(); if (l) l.roadWidthLabelSize = scale; }
  else if (sf.kind === 'item-label') { const it = _selItem(); if (it) it.labelScale = scale; }
  else if (sf.kind === 'lot-edge')   { const l = _selLot(); if (l) { if (!l.customEdgeScales) l.customEdgeScales = {}; l.customEdgeScales[sf.edge] = scale; } }
  else if (sf.kind === 'north')      { const t = _selTextObj(); if (t) t.size = scale; }
  App.dirty = true;
}

// --- 文字色（lot-label=自動色・編集不可は null） ---
function getSelectedColor() {
  const sf = App.selectedFormat; if (!sf) return null;
  if (sf.kind === 'lot-label')  { const l = _selLot(); return l ? (l.labelTextColor || '#1e293b') : null; }
  if (sf.kind === 'road-label') { const l = _selLot(); return l ? (l.roadLabelColor || '#475569') : null; }
  if (sf.kind === 'road-width-label') { const l = _selLot(); return l ? (l.roadWidthLabelColor || l.roadLabelColor || '#475569') : null; }
  if (sf.kind === 'lot-edge')   { const l = _selLot(); return l ? ((l.customEdgeLabelColors && l.customEdgeLabelColors[sf.edge]) || l.edgeLabelColor || '#334155') : null; }
  if (sf.kind === 'item-label') { const it = _selItem(); return it ? (it.color || '#dc2626') : null; }
  if (sf.kind === 'text')       { const t = _selTextObj(); return t ? (t.color || '#1a1a1a') : null; }
  if (sf.kind === 'stamp')      { const t = _selTextObj(); return t ? (t.lineColor || '#78350f') : null; }
  if (sf.kind === 'north')      { const t = _selTextObj(); return t ? (t.color || '#1e293b') : null; }
  return null;
}
function setSelectedColor(c) {
  const sf = App.selectedFormat; if (!sf) return;
  _fmtSaveOnce();
  if (sf.kind === 'lot-label')  { const l = _selLot(); if (l) l.labelTextColor = c; }
  else if (sf.kind === 'road-label') { const l = _selLot(); if (l) l.roadLabelColor = c; }
  else if (sf.kind === 'road-width-label') { const l = _selLot(); if (l) l.roadWidthLabelColor = c; }
  else if (sf.kind === 'lot-edge')   { const l = _selLot(); if (l) { if (!l.customEdgeLabelColors) l.customEdgeLabelColors = {}; l.customEdgeLabelColors[sf.edge] = c; } }
  else if (sf.kind === 'item-label') { const it = _selItem(); if (it) it.color = c; }
  else if (sf.kind === 'text')       { const t = _selTextObj(); if (t) t.color = c; }
  else if (sf.kind === 'stamp')      { const t = _selTextObj(); if (t) t.lineColor = c; }
  else if (sf.kind === 'north')      { const t = _selTextObj(); if (t) t.color = c; }
  App.dirty = true;
}

function getRoadWidthLabelCenter(lot) {
  if (!lot || !lot.points) return null;
  const c = centroid(lot.points);
  const titleScale = parseFloat(lot.roadLabelSize) || 1.0;
  const widthScale = parseFloat(lot.roadWidthLabelSize) || titleScale;
  const fs = pfs(11) * titleScale;
  const fsW = pfs(9) * widthScale;
  const titleX = c.x + (lot.labelOffX || 0);
  const titleY = c.y + (lot.labelOffY || 0);
  const hasCustom = lot.roadWidthOffX != null || lot.roadWidthOffY != null;
  if (hasCustom) return { x: c.x + (lot.roadWidthOffX || 0), y: c.y + (lot.roadWidthOffY || 0) };
  if (lot.roadVertical) return { x: titleX + fs * 1.3, y: titleY };
  const text = lot.roadLabel !== undefined ? lot.roadLabel : '道路';
  const textLines = text.split('\n');
  const totalTextH = Math.max(1, textLines.length) * fs * 1.25;
  const widthOffset = lot.roadWidth ? -(fsW * 0.6) : 0;
  return { x: titleX, y: titleY + totalTextH / 2 + widthOffset + fsW * 0.8 };
}

// --- 選択要素の中心（canvas座標）: ポップアップ位置・ハイライト用 ---
function getSelectedAnchor() {
  const sf = App.selectedFormat; if (!sf) return null;
  if (sf.kind === 'lot-label' || sf.kind === 'road-label') {
    const l = _selLot(); if (!l || !l.points) return null;
    const c = centroid(l.points);
    return { x: c.x + (l.labelOffX || 0), y: c.y + (l.labelOffY || 0) };
  }
  if (sf.kind === 'road-width-label') {
    const l = _selLot();
    return getRoadWidthLabelCenter(l);
  }
  if (sf.kind === 'lot-edge') {
    const l = _selLot(); if (!l || !l.points) return null;
    const i = sf.edge, j = (i + 1) % l.points.length;
    const m = midPt(l.points[i], l.points[j]);
    const uo = (l.edgeLabelOffsets && l.edgeLabelOffsets[i]) || { dx: 0, dy: 0 };
    return { x: m.x + uo.dx, y: m.y + uo.dy };
  }
  if (sf.kind === 'item-label') {
    const it = _selItem(); if (!it || !it.points) return null;
    if (sf.labelKey?.startsWith('seg')) {
      const index = parseInt(sf.labelKey.slice(3));
      const nextIndex = it.type === 'area' ? (index + 1) % it.points.length : index + 1;
      if (!it.points[index] || !it.points[nextIndex]) return null;
      return it.segLabelPos?.[index] || midPt(it.points[index], it.points[nextIndex]);
    }
    return it.labelPos || (it.type === 'area' ? centroid(it.points) : midPt(it.points[0], it.points[it.points.length - 1]));
  }
  if (sf.kind === 'item') {
    const it = _selItem();
    if (!it?.points?.length) return null;
    return it.points.length >= 3 ? centroid(it.points) : midPt(it.points[0], it.points[it.points.length - 1]);
  }
  const t = _selTextObj(); if (!t) return null;
  return { x: t.x, y: t.y };
}

function syncRotQuick(d) {
  document.querySelectorAll('.tep-rq').forEach(b => b.classList.toggle('active-tep-rq', parseInt(b.dataset.a) === d));
}

// 統一文字エディタの内容更新＋表示制御
function updateFormatPanel() {
  const pop = document.getElementById('text-editor-pop');
  if (!pop) return;
  const dedicatedEditorOpen = ['memo-panel', 'stamp-edit-panel', 'north-arrow-edit-panel']
    .some(id => {
      const panel = document.getElementById(id);
      return panel && !panel.classList.contains('hidden');
    });
  if (dedicatedEditorOpen) {
    pop.classList.add('hidden');
    return;
  }
  const sf = App.selectedFormat;
  const dragging = App.draggingId != null || App.draggingLotLabelId != null ||
    App.draggingEdgeLabelLotId != null || App.draggingLotId != null;
  if (!sf || App.mode !== 'select' || dragging) { pop.classList.add('hidden'); return; }

  const tableObject = sf.kind === 'table' ? _selTextObj() : null;
  const kindLabel = sf.kind === 'item-label' && sf.labelKey?.startsWith('seg')
    ? '区間ラベル'
    : sf.kind === 'table'
      ? (tableObject?.title ? '積算表' : '面積表')
      : ({ text: '文字', 'lot-label': '区画ラベル', 'road-label': '道路名', 'road-width-label': '道路幅員', stamp: 'スタンプ', north: '北マーク', 'item-label': '計測ラベル', item: '線・矢印', 'lot-edge': '辺の寸法' }[sf.kind] || '文字');
  document.getElementById('tep-kind').textContent = kindLabel;

  // 線・矢印はキャンバス上での移動と削除だけを扱う。表は描画に効く
  // サイズ・角度を残し、本文・縦書き・色だけを各アクセサで非表示にする。
  const editorBody = pop.querySelector('.tep-body');
  if (editorBody) editorBody.style.display = sf.kind === 'item' ? 'none' : '';
  const formatTabs = pop.querySelector('.v140-format-tabs');
  if (formatTabs) formatTabs.style.display = sf.kind === 'item' ? 'none' : '';

  // テキスト行
  const txt = getSelectedText();
  const textWrap = document.getElementById('tep-text-wrap');
  if (txt === null) { textWrap.style.display = 'none'; }
  else {
    textWrap.style.display = '';
    const ta = document.getElementById('tep-text');
    if (document.activeElement !== ta) ta.value = txt; // 入力中は上書きしない
  }

  // 大きさ行
  const sizeKind = getSelectedSizeKind();
  const sizeWrap = document.getElementById('tep-size-wrap');
  if (!sizeKind) { sizeWrap.style.display = 'none'; }
  else {
    sizeWrap.style.display = '';
    const sl = document.getElementById('tep-size');
    const num = document.getElementById('tep-size-num');
    const unit = document.getElementById('tep-size-unit');
    const sz = getSelectedSize();
    if (sizeKind === 'px') {
      if (sl) { sl.min = 6; sl.max = 72; sl.step = 1; sl.value = sz; }
      if (num) { num.min = 6; num.max = 72; num.step = 1; num.value = Math.round(sz); }
      if (unit) unit.textContent = 'px';
    } else {
      if (sl) { sl.min = 0.3; sl.max = 5; sl.step = 0.05; sl.value = sz; }
      if (num) { num.min = 0.3; num.max = 5; num.step = 0.05; num.value = parseFloat(sz.toFixed(2)); }
      if (unit) unit.textContent = '×';
    }
  }

  const verticalWrap = document.getElementById('tep-vertical-wrap');
  const verticalValue = getSelectedVertical();
  if (verticalWrap) {
    verticalWrap.style.display = verticalValue === null ? 'none' : '';
    const verticalCheck = document.getElementById('tep-vertical');
    if (verticalCheck) verticalCheck.checked = !!verticalValue;
  }

  // 角度
  const deg = Math.round(getSelectedRotation());
  document.getElementById('tep-rot').value = deg;
  document.getElementById('tep-rot-num').value = deg;
  syncRotQuick(deg);

  // 文字色
  const col = getSelectedColor();
  const colorWrap = document.getElementById('tep-color-wrap');
  if (col === null) { colorWrap.style.display = 'none'; }
  else {
    colorWrap.style.display = '';
    document.querySelectorAll('#tep-colors .tep-sw').forEach(s =>
      s.classList.toggle('active-tep-sw', (s.dataset.c || '').toLowerCase() === col.toLowerCase()));
  }

  // 対象種別ごとの専用編集画面へ進む。
  document.getElementById('tep-detail').style.display =
    ['text', 'lot-label', 'road-label', 'road-width-label', 'stamp', 'north'].includes(sf.kind) ? '' : 'none';
  const deleteButton = document.getElementById('tep-delete');
  if (deleteButton) {
    const deleteLabels = {
      'lot-label': 'この文字を消す', 'road-label': 'この文字を消す', 'road-width-label': '幅員表示を消す',
      'lot-edge': 'この寸法を非表示', 'item-label': 'この計測を削除',
      text: 'この注記を削除', stamp: 'このスタンプを削除', north: 'この方位記号を削除',
      table: 'この表を削除', item: 'この図形を削除'
    };
    deleteButton.textContent = `🗑 ${deleteLabels[sf.kind] || 'この項目を削除'}`;
  }

  const fontWrap = document.getElementById('tep-font-wrap');
  const fontValue = getSelectedFontFamily();
  if (fontWrap) {
    fontWrap.style.display = fontValue === null ? 'none' : '';
    const fontSelect = document.getElementById('tep-font');
    if (fontSelect && fontValue !== null) fontSelect.value = fontValue;
  }

  pop.classList.remove('hidden');
  positionTextEditor();
}

// サイドバー固定のため位置計算不要
function positionTextEditor() {}

// 選択中ハイライト（render内・ワールド座標系で呼ぶ）
function drawSelectionHighlight() {
  if (App.mode !== 'select') return;
  const selected = App.lastClicked;
  ctx.save();
  const drawPath = (points, closed) => {
    if (!points?.length) return false;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    if (closed) ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(37,99,235,0.18)';
    ctx.lineWidth = 5 / App.vz;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(37,99,235,0.68)';
    ctx.lineWidth = 1 / App.vz;
    ctx.stroke();
    return true;
  };

  let shapeHighlighted = false;
  if (selected?.type === 'lot') {
    const lot = App.lots.find(item => item.id === selected.id);
    shapeHighlighted = drawPath(lot?.points, true);
  } else if (selected?.type === 'item') {
    const item = App.items.find(value => value.id === selected.id);
    shapeHighlighted = drawPath(item?.points, item?.type === 'area');
  }

  const needsAnchor = App.selectedFormat && (!shapeHighlighted ||
    ['lot-edge', 'road-width-label', 'item-label', 'text', 'table', 'stamp', 'north'].includes(App.selectedFormat.kind));
  if (needsAnchor) {
    const anc = getSelectedAnchor();
    if (anc) {
      const r = 4 / App.vz;
      ctx.strokeStyle = 'rgba(37,99,235,0.62)';
      ctx.lineWidth = 1 / App.vz;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(anc.x, anc.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// 「削除」: 文字系は要素削除、ラベル系は文字だけ消す
function deleteSelectedFormat() {
  const sf = App.selectedFormat;
  if (!sf) return;
  saveState();
  if (sf.kind === 'item-label') {
    const item = _selItem();
    if (item && sf.labelKey?.startsWith('seg')) {
      const index = parseInt(sf.labelKey.slice(3));
      if (!item.customSegLabels) item.customSegLabels = {};
      item.customSegLabels[index] = '';
    } else if (item) {
      item.customLabel = '';
    }
  }
  else if (sf.kind === 'item') App.items = App.items.filter(x => x.id !== sf.id);
  else if (sf.kind === 'text' || sf.kind === 'stamp' || sf.kind === 'north' || sf.kind === 'table') App.texts = App.texts.filter(x => x.id !== sf.id);
  else if (sf.kind === 'lot-label')  { const l = _selLot(); if (l) l.topLabel = null; }
  else if (sf.kind === 'road-label') { const l = _selLot(); if (l) l.roadLabel = ''; }
  else if (sf.kind === 'road-width-label') { const l = _selLot(); if (l) l.roadWidth = null; }
  else if (sf.kind === 'lot-edge')   { const l = _selLot(); if (l) { if (!l.edgeHidden) l.edgeHidden = {}; l.edgeHidden[sf.edge] = true; } }
  App.selectedFormat = null;
  reconcileSelectionState();
  updateFormatPanel();
  if (typeof updateLotPanel === 'function') updateLotPanel();
  if (typeof updateResults === 'function') updateResults();
  App.dirty = true;
}

function selectedKindForTextObject(textObject) {
  if (!textObject) return 'text';
  if (textObject.textType === 'north-arrow') return 'north';
  if (textObject.textType === 'house-stamp' || textObject.textType === 'parking-stamp') return 'stamp';
  if (textObject.textType === 'lot-table') return 'table';
  return 'text';
}

// 結果一覧と右プロパティから同じ選択状態を作るための共通入口。
function selectObjectReference(ref) {
  if (!ref || ref.id == null) return null;
  _fmtEditSaved = false;
  let object = null;
  if (ref.type === 'lot') {
    object = App.lots.find(item => item.id === ref.id);
    if (object) {
      // 隅切りは道路と同じ配列に保持するが、道路名・幅員を持つ編集対象ではない。
      App.selectedFormat = object.type === 'road' && object.lotNum === 0
        ? null
        : { kind: object.type === 'road' ? 'road-label' : 'lot-label', id: object.id };
    }
  } else if (ref.type === 'text') {
    object = App.texts.find(item => item.id === ref.id);
    if (object) App.selectedFormat = { kind: selectedKindForTextObject(object), id: object.id };
  } else if (ref.type === 'item') {
    object = App.items.find(item => item.id === ref.id);
    if (object) {
      const hasEditableLabel = ['distance', 'polyline', 'area'].includes(object.type);
      App.selectedFormat = hasEditableLabel
        ? { kind: 'item-label', id: object.id, labelKey: 'main' }
        : { kind: 'item', id: object.id };
    }
  }
  if (!object) return null;
  App.lastClicked = { type: ref.type, id: object.id };
  updateFormatPanel();
  notifyAppState('selection');
  return object;
}

function getTextObjectClientPoint(textObject) {
  const canvasRect = canvas.getBoundingClientRect();
  if (!textObject) {
    return { x: canvasRect.left + canvasRect.width / 2, y: canvasRect.top + canvasRect.height / 2 };
  }
  return {
    x: canvasRect.left + App.vx + textObject.x * App.vz,
    y: canvasRect.top + App.vy + textObject.y * App.vz,
  };
}

function activateUniversalSelectionTool() {
  const selectionButton = document.getElementById('btn-lot-select');
  if (selectionButton) selectionButton.click();
  else setLotTool('select');
}

// 結果一覧・右プロパティ・統一文字エディタの詳細ボタンから利用する。
// 戻り値は専用編集画面を開いたかどうか（false は選択ツールへ移っただけ）。
function openObjectDetail(ref, clientX, clientY) {
  const object = selectObjectReference(ref);
  if (!object) return false;
  if (ref.type === 'lot') {
    if (object.type === 'road' && object.lotNum === 0) {
      activateUniversalSelectionTool();
      return false;
    }
    openLotEditor(object.id);
    return true;
  }
  if (ref.type === 'text') {
    const kind = selectedKindForTextObject(object);
    if (kind === 'table') {
      activateUniversalSelectionTool();
      return false;
    }
    const point = getTextObjectClientPoint(object);
    const x = Number.isFinite(clientX) ? clientX : point.x;
    const y = Number.isFinite(clientY) ? clientY : point.y;
    if (kind === 'stamp') openStampEditor(object.id, x, y);
    else if (kind === 'north') openNorthArrowEditor(object.id, x, y);
    else if (typeof openMemoEditor === 'function') openMemoEditor(object.id, x, y);
    return true;
  }
  activateUniversalSelectionTool();
  return false;
}

// 「詳細…」: 既存の編集モーダル/パネルを開く
function openSelectedDetail() {
  const sf = App.selectedFormat;
  if (!sf) return;
  const isLot = sf.kind.startsWith('lot') || sf.kind.startsWith('road');
  const isText = ['text', 'stamp', 'north', 'table'].includes(sf.kind);
  openObjectDetail({ type: isLot ? 'lot' : isText ? 'text' : 'item', id: sf.id });
}

function updateGlobalLotColorControls() {
  document.querySelectorAll('#lot-sc-picker .sc-swatch').forEach(swatch => {
    swatch.classList.toggle('active-sc', swatch.dataset.sc === App.lotStrokeColor);
  });
  document.querySelectorAll('#lot-border-color-picker .border-gc-swatch').forEach(swatch => {
    const active = swatch.dataset.bc === App.lotBorderColor;
    swatch.classList.toggle('active-border-gc', active);
    swatch.style.outline = active ? '2px solid #60a5fa' : 'none';
  });
}

function updateHint() {
  if (App.appMode === 'subdivision') {
    const subHints = {
      draw: 'クリックで頂点追加　ダブルクリックで区画確定　既存頂点に近づくと吸着',
      road: 'クリックで頂点追加　ダブルクリックで道路確定　既存頂点に近づくと吸着',
      split: App.splitTargetId !== null ? (App.lotPts.length > 0 ? `${App.lotPts.length}点　ダブルクリックで分割確定` : '分割線の始点をクリック') : '分割したい区画をクリック',
      'split-all': App.lotPts.length > 0 ? `${App.lotPts.length}点　ダブルクリックで一括分割確定` : 'クリックで折れ線を描く → ダブルクリックで全区画を一括分割',
      divguide: App.lotPts.length === 0 ? `${App.divGuideN}等分ガイド：始点をクリック` : '終点をクリックしてガイドを確定',
      merge: App.mergeSelect.length === 0 ? '合筆する1つ目の区画をクリック' : '合筆する2つ目の区画をクリック（再クリックで選択解除）',
      'corner-cut': App.cornerCutLotId === null ? '隅切りする区画をクリックして選択' : '切り取りたい頂点をクリック',
    };
    const modeHints = { select: '区画をドラッグで移動　ダブルクリックで編集', pan: 'ドラッグで移動　ホイールでズーム', 'label-move': '区画ラベル・辺の寸法・計測ラベルをドラッグで移動　区画ダブルクリックで属性編集' };
    document.getElementById('hint-text').textContent = modeHints[App.lotTool] || subHints[App.lotTool] || modeHints[App.mode] || '';
    return;
  }
  const hints = {
    distance: '2点クリックで直線距離を計測　　右クリック/Escでキャンセル',
    polyline: 'クリックで点を追加　ダブルクリックで確定　　右クリック/Escでキャンセル',
    area: 'クリックで多角形を描く　ダブルクリックで確定して面積を算出',
    pan: 'ドラッグで移動　マウスホイールでズーム',
    select: 'ラベル・メモをドラッグで移動　メモをダブルクリックで編集',
    text: 'クリックしてメモを追加',
    arrow: '始点→終点の2点クリックで矢印を描く',
    callout: '1点目: 矢印の先端　2点目: テキスト位置',
    'vertex-edit': '頂点をドラッグして移動',
    'label-edit': 'ラベル・寸法をクリックして編集（空欄でリセット）',
    delete: 'クリックして計測・注記を削除',
  };
  document.getElementById('hint-text').textContent = hints[App.mode] || '';
}

function updateZoomInfo() {
  const pct = Math.round(App.vz * 100) + '%';
  const sub = document.getElementById('zoom-info-sub');
  if (sub) sub.textContent = pct;
}

// ===== 計測確定 =====
function finishMeasurement() {
  // 矢印・線は縮尺不要（他は onMouseDown 側で事前チェック済み）
  if (!App.mpp && App.mode !== 'arrow' && App.mode !== 'line') {
    App.pts = [];
    App.dirty = true;
    return;
  }

  const pts = [...App.pts];
  App.pts = [];
  const color = App.strokeColor;
  let item = null;

  if (App.mode === 'line' && pts.length >= 2) {
    item = { id: App.nextId++, type: 'line', points: pts,
      color: App.lineColor, lineStyle: App.lineStyle, lineWidth: App.lineWidth };

  } else if (App.mode === 'arrow' && pts.length === 2) {
    item = { id: App.nextId++, type: 'arrow', points: pts, color, label: '' };

  } else if (App.mode === 'distance' && pts.length === 2) {
    const d = dist(pts[0], pts[1]) * App.mpp;
    item = { id: App.nextId++, type: 'distance', points: pts, color,
      label: formatDist(d), value: d, labelPos: null };

  } else if (App.mode === 'polyline' && pts.length >= 2) {
    let total = 0;
    const segValues = [];
    const segLabels = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const d = dist(pts[i], pts[i + 1]) * App.mpp;
      segValues.push(d);
      segLabels.push(formatEdge(d));
      total += d;
    }
    item = { id: App.nextId++, type: 'polyline', points: pts, color,
      label: formatDist(total), value: total, segValues, segLabels, labelPos: null, segLabelPos: [] };

  } else if (App.mode === 'area' && pts.length >= 3) {
    const sqm = shoelace(pts) * App.mpp * App.mpp;
    const tsubo = sqm * 0.3025;
    const segValues = [];
    const segLabels = [];
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const d = dist(pts[i], pts[j]) * App.mpp;
      segValues.push(d);
      segLabels.push(formatEdge(d));
    }
    item = { id: App.nextId++, type: 'area', points: pts, color,
      label: `${sqm.toFixed(2)}㎡ / ${tsubo.toFixed(2)}坪`,
      value: sqm, segValues, segLabels, labelPos: null, segLabelPos: [] };
  }

  if (item) { saveState(); App.items.push(item); updateResults(); }
  App.dirty = true;
}

// ===== Undo / Redo =====
function reconcileSelectionState() {
  const hasId = (list, id) => id != null && list.some(item => item.id === id);
  if (App.lastClicked) {
    const exists = App.lastClicked.type === 'lot' ? hasId(App.lots, App.lastClicked.id)
      : App.lastClicked.type === 'text' ? hasId(App.texts, App.lastClicked.id)
      : hasId(App.items, App.lastClicked.id);
    if (!exists) App.lastClicked = null;
  }
  if (App.selectedFormat) {
    const kind = App.selectedFormat.kind || '';
    const exists = kind.startsWith('lot') || kind.startsWith('road')
      ? hasId(App.lots, App.selectedFormat.id)
      : (kind === 'text' || kind === 'stamp' || kind === 'north' || kind === 'table')
        ? hasId(App.texts, App.selectedFormat.id)
        : hasId(App.items, App.selectedFormat.id);
    if (!exists) App.selectedFormat = null;
  }
  if (!hasId(App.texts, App.editingTextId)) App.editingTextId = null;
  if (!hasId(App.texts, App.editingStampId)) App.editingStampId = null;
  if (!hasId(App.texts, App.editingNorthArrowId)) App.editingNorthArrowId = null;
  if (!hasId(App.lots, App.editingLotId)) {
    App.editingLotId = null;
    App.editingLotEdgeIdx = null;
    App.editingLotCenterKey = null;
  }
  App.draggingId = null;
  App.draggingItemId = null;
  App.draggingLotId = null;
  App.draggingLotLabelId = null;
  App.draggingEdgeLabelLotId = null;
  App.draggingVertex = null;
  App.draggingLotVertex = null;
  App.dragPending = false;
  updateFormatPanel();
  notifyAppState('selection');
}

function captureHistoryState() {
  return {
    items: JSON.parse(JSON.stringify(App.items)),
    texts: JSON.parse(JSON.stringify(App.texts)),
    lots: JSON.parse(JSON.stringify(App.lots)),
    lotNextNum: App.lotNextNum,
    divGuides: JSON.parse(JSON.stringify(App.divGuides)),
  };
}

function pushHistoryState(state) {
  if (!state) return;
  App.undoStack.push(state);
  App.redoStack = [];
}

function saveState() {
  pushHistoryState(captureHistoryState());
}

function undoLast() {
  if (App.pts.length > 0) { App.pts.pop(); App.dirty = true; return; }
  if (App.lotPts.length > 0) { App.lotPts.pop(); App.dirty = true; return; }
  if (App.undoStack.length === 0) return;
  App.redoStack.push({
    items: JSON.parse(JSON.stringify(App.items)),
    texts: JSON.parse(JSON.stringify(App.texts)),
    lots: JSON.parse(JSON.stringify(App.lots)),
    lotNextNum: App.lotNextNum,
    divGuides: JSON.parse(JSON.stringify(App.divGuides)),
  });
  const prev = App.undoStack.pop();
  App.items = prev.items;
  App.texts = prev.texts;
  App.lots = prev.lots || [];
  App.lotNextNum = prev.lotNextNum || App.lotNextNum;
  App.divGuides = prev.divGuides || [];
  reconcileSelectionState();
  updateResults();
  updateLotPanel();
  App.dirty = true;
}

function redoLast() {
  if (App.redoStack.length === 0) return;
  App.undoStack.push({
    items: JSON.parse(JSON.stringify(App.items)),
    texts: JSON.parse(JSON.stringify(App.texts)),
    lots: JSON.parse(JSON.stringify(App.lots)),
    lotNextNum: App.lotNextNum,
    divGuides: JSON.parse(JSON.stringify(App.divGuides)),
  });
  const next = App.redoStack.pop();
  App.items = next.items;
  App.texts = next.texts;
  App.lots = next.lots || [];
  App.lotNextNum = next.lotNextNum || App.lotNextNum;
  App.divGuides = next.divGuides || [];
  reconcileSelectionState();
  updateResults();
  updateLotPanel();
  App.dirty = true;
}

function clearMeasurements(confirm_) {
  const hasData = App.items.length > 0 || App.texts.length > 0 || App.lots.length > 0;
  if (confirm_ && hasData) {
    showInlineConfirm('すべての計測・区画・文字・スタンプを削除します。この操作は元に戻せません。', {
      confirmLabel: 'すべて削除',
      onConfirm: () => clearMeasurements(false),
    });
    return;
  }
  App.items = [];
  App.texts = [];
  App.lots = [];
  App.pts = [];
  App.nextId = 1;
  App.lotNextNum = 1;
  updateResults();
  updateLotPanel();
  App.dirty = true;
}

// ===== メモ入力 =====
function showTextInput(sx, sy, cp, existingText = '') {
  const calloutTip = App.pendingCalloutTip
    ? { x: App.pendingCalloutTip.x, y: App.pendingCalloutTip.y }
    : null;
  if (_memoEditSession) cancelTextInput();
  App.editingTextId = null;
  App.pendingTextPos = cp;
  App.pendingCalloutTip = calloutTip;
  _memoEditSession = {
    kind: 'new',
    originalOptions: JSON.parse(JSON.stringify(App.textOptions)),
    historyState: captureHistoryState(),
  };
  const rect = canvas.getBoundingClientRect();
  showTextInputAt(rect.left + sx + 12, rect.top + sy - 10, existingText);
}

function openMemoEditor(id, clientX, clientY) {
  const textObject = App.texts.find(item => item.id === id);
  if (!textObject || textObject.textType) return;
  const panel = document.getElementById('memo-panel');
  if (_memoEditSession?.kind === 'edit' && _memoEditSession.id === id
      && panel && !panel.classList.contains('hidden')) return;
  if (_memoEditSession) cancelTextInput();

  const originalOptions = JSON.parse(JSON.stringify(App.textOptions));
  _memoEditSession = {
    kind: 'edit',
    id,
    original: JSON.parse(JSON.stringify(textObject)),
    originalOptions,
    historyState: captureHistoryState(),
  };
  App.editingTextId = id;
  App.pendingTextPos = { x: textObject.x, y: textObject.y };
  App.pendingCalloutTip = null;
  App.textOptions = {
    fontSize: textObject.fontSize || 14,
    fontFamily: normalizeFontFamily(textObject.fontFamily),
    color: textObject.color || '#1a1a1a',
    bgColor: textObject.bgColor || 'rgba(255,255,220,0.92)',
    boxStyle: textObject.boxStyle || 'box',
    vertical: !!textObject.vertical,
    rotation: parseFloat(textObject.rotation) || 0,
  };

  const rect = canvas.getBoundingClientRect();
  const x = Number.isFinite(clientX) ? clientX : rect.left + App.vx + textObject.x * App.vz;
  const y = Number.isFinite(clientY) ? clientY : rect.top + App.vy + textObject.y * App.vz;
  showTextInputAt(x + 12, y - 10, textObject.text || '');
}

function showTextInputAt(clientX, clientY, existingText = '') {
  const panel = document.getElementById('memo-panel');
  const input = document.getElementById('memo-input');
  if (!panel || !input) return;
  syncMemoPanelUI();
  input.value = existingText;
  positionViewportFloatingPanel(panel, clientX, clientY);
  focusFloatingInputAfterPointer(input, { select: !!existingText });
}

// メモパネルのUI（ボタン・スウォッチ）をApp.textOptionsと同期
function syncMemoPanelUI() {
  const { fontSize, color, bgColor, boxStyle, vertical, rotation = 0 } = App.textOptions;
  const slider = document.getElementById('text-size-slider');
  if (slider) { slider.value = fontSize; }
  const val = document.getElementById('text-size-val');
  if (val) val.textContent = fontSize;
  document.querySelectorAll('#text-color-swatches .color-swatch').forEach(b => {
    b.classList.toggle('active-swatch', b.dataset.color === color);
  });
  document.querySelectorAll('#text-bg-swatches .color-swatch').forEach(b => {
    b.classList.toggle('active-swatch', b.dataset.bg === bgColor);
  });
  document.querySelectorAll('.box-style-btn').forEach(b => {
    b.classList.toggle('active-box-style', b.dataset.bs === (boxStyle || 'box'));
  });
  const verticalCheck = document.getElementById('text-vertical-check');
  if (verticalCheck) verticalCheck.checked = !!vertical;
  const rotationValue = Math.max(-180, Math.min(180, parseFloat(rotation) || 0));
  const rotationSlider = document.getElementById('text-rotation-slider');
  const rotationInput = document.getElementById('text-rotation-input');
  if (rotationSlider) rotationSlider.value = rotationValue;
  if (rotationInput) rotationInput.value = rotationValue;
  const isEditing = _memoEditSession?.kind === 'edit' && App.editingTextId != null;
  document.getElementById('memo-delete')?.classList.toggle('hidden', !isEditing);
  const title = document.getElementById('memo-panel-title');
  if (title) title.textContent = isEditing ? '文字・メモを編集' : '文字・メモを追加';
}

function commitTextInput() {
  const input = document.getElementById('memo-input');
  const text = input.value.trim();
  if (!text) {
    showToast('文字を入力してください。削除する場合は「削除」を押してください', 3500);
    input.focus({ preventScroll: true });
    return;
  }
  if (!App.pendingTextPos) {
    showToast('配置位置を確認できませんでした。いったんキャンセルして置き直してください', 4000);
    return;
  }

  const session = _memoEditSession;
  const historyState = session?.historyState || captureHistoryState();
  const opts = App.textOptions;
  let changed = false;
  if (App.editingTextId !== null) {
    const t = App.texts.find(x => x.id === App.editingTextId);
    if (!t) {
      showToast('編集対象が見つかりませんでした', 3000);
      cancelTextInput();
      return;
    }
    t.text = text;
    t.fontSize = opts.fontSize;
    t.fontFamily = normalizeFontFamily(opts.fontFamily);
    t.color = opts.color;
    t.bgColor = opts.bgColor;
    t.boxStyle = opts.boxStyle || 'box';
    t.vertical = !!opts.vertical;
    t.rotation = parseFloat(opts.rotation) || 0;
    changed = !session?.original || JSON.stringify(t) !== JSON.stringify(session.original);
  } else if (App.pendingCalloutTip) {
    App.texts.push({
      id: App.nextId++,
      type: 'callout',
      tipX: App.pendingCalloutTip.x, tipY: App.pendingCalloutTip.y,
      x: App.pendingTextPos.x, y: App.pendingTextPos.y,
      text, fontSize: opts.fontSize, fontFamily: normalizeFontFamily(opts.fontFamily),
      color: opts.color, bgColor: opts.bgColor, boxStyle: opts.boxStyle || 'box',
      vertical: !!opts.vertical, rotation: parseFloat(opts.rotation) || 0,
    });
    changed = true;
  } else {
    App.texts.push({
      id: App.nextId++,
      x: App.pendingTextPos.x, y: App.pendingTextPos.y,
      text, fontSize: opts.fontSize, fontFamily: normalizeFontFamily(opts.fontFamily),
      color: opts.color, bgColor: opts.bgColor, boxStyle: opts.boxStyle || 'box',
      vertical: !!opts.vertical, rotation: parseFloat(opts.rotation) || 0,
    });
    changed = true;
  }
  if (changed) pushHistoryState(historyState);

  const restoreOptions = session?.kind === 'edit' ? session.originalOptions : null;
  document.getElementById('memo-panel').classList.add('hidden');
  input.value = '';
  App.editingTextId = null;
  App.pendingTextPos = null;
  App.pendingCalloutTip = null;
  _memoEditSession = null;
  if (restoreOptions) App.textOptions = JSON.parse(JSON.stringify(restoreOptions));
  reconcileSelectionState();
  updateResults();
  updateFormatPanel();
  App.dirty = App.dirty || changed;
}

function cancelTextInput() {
  const session = _memoEditSession;
  if (session?.kind === 'edit' && session.original) restoreEditedText(session);
  if (session?.originalOptions) {
    App.textOptions = JSON.parse(JSON.stringify(session.originalOptions));
  }
  document.getElementById('memo-panel').classList.add('hidden');
  document.getElementById('memo-input').value = '';
  App.pendingTextPos = null;
  App.pendingCalloutTip = null;
  App.editingTextId = null;
  _memoEditSession = null;
  reconcileSelectionState();
  updateResults();
  updateFormatPanel();
  App.dirty = true;
}

function deleteMemoEditor() {
  const session = _memoEditSession;
  const id = App.editingTextId;
  if (id == null || session?.kind !== 'edit') return;
  pushHistoryState(session.historyState || captureHistoryState());
  App.texts = App.texts.filter(item => item.id !== id);
  if (session.originalOptions) {
    App.textOptions = JSON.parse(JSON.stringify(session.originalOptions));
  }
  document.getElementById('memo-panel')?.classList.add('hidden');
  document.getElementById('memo-input').value = '';
  App.pendingTextPos = null;
  App.pendingCalloutTip = null;
  App.editingTextId = null;
  _memoEditSession = null;
  reconcileSelectionState();
  updateResults();
  updateFormatPanel();
  App.dirty = true;
}

// ===== 結果リスト =====
function updateResults() {
  const list = document.getElementById('results-list');
  const empty = document.getElementById('results-empty');
  if (!list || !empty) return;
  list.innerHTML = '';

  const typeLabel = {
    distance: '直線距離', polyline: '折れ線距離', area: '面積',
    text: 'メモ', line: '線', arrow: '矢印', callout: '引出線'
  };
  const truncate = (value, max = 28) => {
    const text = String(value ?? '');
    return text.slice(0, max) + (text.length > max ? '…' : '');
  };
  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const measureRows = App.items.map(item => ({
    id: item.id,
    refType: 'item',
    title: typeLabel[item.type] || item.type || '計測',
    label: item.label || '',
    color: item.color || '#dc2626',
    colorEditable: true,
  }));

  const annotationRows = App.texts.map(textObject => {
    const kind = selectedKindForTextObject(textObject);
    if (kind === 'stamp') {
      const isParking = textObject.textType === 'parking-stamp';
      const fallback = isParking ? 'P' : '家屋';
      const dimensions = textObject.wM != null && textObject.hM != null
        ? ` · ${textObject.wM}m × ${textObject.hM}m` : '';
      return {
        id: textObject.id, refType: 'text',
        title: isParking ? '駐車場スタンプ' : '家屋スタンプ',
        label: `${textObject.label != null ? textObject.label : fallback}${dimensions}`,
        color: textObject.lineColor || (isParking ? '#1d4ed8' : '#78350f'),
        editKind: 'stamp', editLabel: 'スタンプを編集',
      };
    }
    if (kind === 'north') {
      return {
        id: textObject.id, refType: 'text', title: '北マーク', label: '方位記号 N',
        color: textObject.color || '#1e293b', editKind: 'north', editLabel: '北マークを編集',
      };
    }
    if (kind === 'table') {
      const isAccumulation = !!textObject.title;
      return {
        id: textObject.id, refType: 'text',
        title: isAccumulation ? '積算表' : '面積表',
        label: textObject.title || `${textObject.rows?.length || 0} 行の面積一覧`,
        color: '#64748b', isTable: true,
      };
    }
    const text = textObject.text || '';
    return {
      id: textObject.id, refType: 'text',
      title: typeLabel[textObject.type] || 'メモ', label: truncate(text),
      color: textObject.color || '#fbbf24', colorEditable: true,
      editKind: 'memo', editLabel: '文字・注記を編集',
    };
  });

  // 空表示は App の総数ではなく、実際にこの一覧へ描画する行で判定する。
  const rows = [...measureRows, ...annotationRows];
  if (rows.length === 0) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  rows.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'result-item';
    div.dataset.id = String(item.id);
    div.dataset.refType = item.refType;
    const isText = item.refType === 'text';
    const editBtn = item.editKind
      ? `<button class="btn-edit-text" data-id="${item.id}" data-edit-kind="${item.editKind}" title="${escapeHtml(item.editLabel)}" aria-label="${escapeHtml(item.editLabel)}">✏</button>`
      : '';
    const dotAttrs = item.colorEditable
      ? `data-id="${item.id}" data-istext="${isText}" title="色を変更" style="background:${escapeHtml(item.color)};cursor:pointer"`
      : `title="${item.isTable ? '選択ツールで移動・削除' : '詳細編集で色を変更'}" style="background:${escapeHtml(item.color)}"`;
    const deleteLabel = item.isTable ? '表を削除'
      : item.editKind === 'stamp' ? 'スタンプを削除'
        : item.editKind === 'north' ? '北マークを削除'
          : isText ? '注記を削除' : '計測を削除';
    div.innerHTML = `
      <div class="result-header">
        <span class="result-dot" ${dotAttrs}></span>
        <span class="result-title">${escapeHtml(item.title)}</span>
        ${editBtn}
        <button class="btn-delete" data-id="${item.id}" data-istext="${isText}" title="${deleteLabel}" aria-label="${deleteLabel}">✕</button>
      </div>
      <div class="result-value">${escapeHtml(item.label)}</div>
    `;
    list.appendChild(div);
  });

  // 削除ボタン
  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = parseInt(btn.dataset.id);
      saveState();
      if (btn.dataset.istext === 'true') {
        App.texts = App.texts.filter(t => t.id !== id);
      } else {
        App.items = App.items.filter(i => i.id !== id);
      }
      reconcileSelectionState();
      updateResults();
      App.dirty = true;
    });
  });

  // 注記ごとの専用編集画面。表には編集ボタンを付けず、移動・削除だけにする。
  list.querySelectorAll('.btn-edit-text').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = parseInt(btn.dataset.id);
      openObjectDetail({ type: 'text', id }, event.clientX, event.clientY);
    });
  });

  // 行自体をクリックすると右プロパティとキャンバス選択を同じ対象へ揃える。
  list.querySelectorAll('.result-item[data-id][data-ref-type]').forEach(row => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('button, .result-dot[data-id]')) return;
      selectObjectReference({ type: row.dataset.refType, id: parseInt(row.dataset.id) });
    });
  });

  // カラードット → カラーピッカー
  list.querySelectorAll('.result-dot[data-id]').forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      App.cpTargetId     = parseInt(dot.dataset.id);
      App.cpTargetIsText = dot.dataset.istext === 'true';
      const popup = document.getElementById('color-picker-popup');
      positionViewportFloatingPanel(popup, e.clientX + 4, e.clientY + 4);
    });
  });
}

// ===== ページ移動 =====
function updatePageInfo() {
  document.getElementById('page-info').textContent = `${App.pageNum} / ${App.pageCount}`;
  document.getElementById('btn-prev').disabled = App.pageNum <= 1;
  document.getElementById('btn-next').disabled = App.pageNum >= App.pageCount;
}

async function applyPageChange(p) {
  hidePlacementPreview();
  App.pageNum = p;
  App.pdfReady = false;
  clearMeasurements(false);
  await renderPDFPage(p);
}

async function changePage(delta) {
  const p = App.pageNum + delta;
  if (p < 1 || p > App.pageCount) return;
  const hasPageData = App.lots.length > 0 || App.texts.length > 0 || App.items.length > 0;
  if (hasPageData) {
    showInlineConfirm('ページを切り替えると、現在の区画・文字・スタンプ・計測は削除されます。', {
      confirmLabel: '削除して切り替え',
      onConfirm: () => { void applyPageChange(p); },
    });
    return;
  }
  await applyPageChange(p);
}

// ===== 縮尺設定 =====
function normalizeJapaneseNumber(value) {
  return String(value ?? '')
    .trim()
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[．。・，]/g, '.')
    .replace(/[／]/g, '/')
    .replace(/,/g, '')
    .replace(/[ｍＭm]/g, '')
    .replace(/[\s　]+/g, '');
}

function readPositiveNumber(input, { integer = false, allowScaleNotation = false } = {}) {
  let normalized = normalizeJapaneseNumber(input.value);
  if (allowScaleNotation && normalized.includes('/')) normalized = normalized.split('/').pop();
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) {
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return null;
  }
  input.removeAttribute('aria-invalid');
  const result = integer ? Math.round(value) : value;
  input.value = integer ? String(result) : String(result);
  return result;
}

function applyManualScale() {
  const input = document.getElementById('scale-input');
  const val = readPositiveNumber(input, { integer: true, allowScaleNotation: true });
  if (val === null) { showToast('正しい縮尺を入力してください（例：500）'); return; }
  setMapScale(val);
  setScaleDisplay(`縮尺 1/${val} (手動設定)`);
  document.getElementById('calibration-modal').classList.add('hidden');
  showToast(`縮尺 1/${val} を適用しました`);
  notifyAppState('scale');
}

function blockToolSwitchDuringCalibration() {
  if (!App.calibrating) return false;
  showToast('縮尺合わせ中です。先に「作業を中止」または Esc で解除してください');
  notifyAppState('calibration-blocked');
  return true;
}

function startCalibration() {
  document.getElementById('calibration-modal').classList.add('hidden');
  App.calibrating = true;
  App.calibPts = [];
  App.dirty = true;
  document.getElementById('hint-text').textContent = '縮尺設定：距離が分かる2点の両端をクリックしてください';
  showToast('図面上の基準にする2点をクリックしてください');
  notifyAppState('calibration-start');
}

function applyCalibrationDist() {
  const input = document.getElementById('calibration-dist-input');
  const d = readPositiveNumber(input);
  if (d === null) { showToast('0より大きい距離を入力してください'); return; }
  commitCalibrationDist(d);
}

function cancelCalibrationDistance() {
  document.getElementById('calibration-dist-modal').classList.add('hidden');
  const input = document.getElementById('calibration-dist-input');
  input.value = '';
  input.removeAttribute('aria-invalid');
  App.calibPts = [];
  App.calibrating = false;
  App.dirty = true;
  updateHint();
  notifyAppState('calibration-cancel');
}

function commitCalibrationDist(d) {
  if (App.calibPts.length < 2) {
    showToast('基準点が失われました。もう一度2点を選択してください');
    cancelCalibrationDistance();
    return;
  }
  const px = dist(App.calibPts[0], App.calibPts[1]);
  if (px === 0) { showToast('2点が同じ位置です。離れた2点を選択してください'); return; }
  const oldMpp = App.mpp;
  const newMpp = d / px;
  if (oldMpp && Math.abs(oldMpp - newMpp) > 1e-12) rescaleAll(oldMpp / newMpp);
  App.mpp = newMpp;
  App.mapScale = Math.round(App.mpp * 72 * App.renderScale * 1000 / 25.4);
  setScaleDisplay(`縮尺 1/${App.mapScale} (キャリブレーション)`);
  document.getElementById('calibration-dist-modal').classList.add('hidden');
  document.getElementById('calibration-dist-input').value = '';
  App.calibPts = [];
  App.calibrating = false;
  App.dirty = true;
  showToast(`2点間 ${d}m から縮尺を設定しました`);
  updateHint();
  notifyAppState('calibration-complete');
}

// ===== PNG保存 =====
function saveCanvasPNG() {
  const dt = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `公図_${dt}.png`;
  a.click();
}

// ===== プロジェクトJSON保存 =====
async function saveProjectJSON(options = {}) {
  const closeAfterSave = options?.closeAfter === true;
  notifyProjectLifecycle('saving');
  try {
  const data = {
    version: 3,
    savedAt: new Date().toISOString(),
    mpp: App.mpp,
    mapScale: App.mapScale,
    vx: App.vx, vy: App.vy, vz: App.vz,
    pageNum: App.pageNum,
    isImageMode: App.isImageMode,
    bgScale: App.bgScale, bgOffsetX: App.bgOffsetX, bgOffsetY: App.bgOffsetY, bgRotation: App.bgRotation, bgLocked: App.bgLocked,
    lots: App.lots,
    lotNextNum: App.lotNextNum,
    lotStrokeColor: App.lotStrokeColor,
    lotBorderColor: App.lotBorderColor,
    lotFillOpacity: App.lotFillOpacity,
    lotShowEdgeLengths: App.lotShowEdgeLengths,
    lotTextScale: App.lotTextScale,
    lotEdgeScale: App.lotEdgeScale,
    subMeasureScale: App.subMeasureScale,
    showSideLengths: App.showSideLengths,
    useYaku: App.useYaku,
    yakuDecimal: App.yakuDecimal,
    yakuAdjust: App.yakuAdjust,
    showLotNumbers: App.showLotNumbers,
    paperMode: App.paperMode,
    paperSize: App.paperSize,
    paperW: App.paperW, paperH: App.paperH,
    paperInfo: App.paperInfo,
    items: App.items,
    texts: App.texts,
    nextId: App.nextId,
    pdfBase64: null,
  };
  // PDFバイナリをBase64に変換して含める
  if (App.pdfBytes) {
    const bytes = App.pdfBytes;
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    data.pdfBase64 = btoa(binary);
  } else if (App.pdfReady && App.isImageMode) {
    // 画像モードはオフスクリーンキャンバスからPNGとして保存
    data.imageDataUrl = App.pdfOffscreen.toDataURL('image/png');
  }
  const dt = new Date().toISOString().slice(0, 10);
  const fileName = `kozu-project-${dt}.json`;
  const contents = JSON.stringify(data);
  let savedName = fileName;

  if (closeAfterSave && window.electronAPI?.saveProjectBeforeClose) {
    const result = await window.electronAPI.saveProjectBeforeClose({ fileName, contents });
    savedName = result?.fileName || fileName;
  } else {
    const blob = new Blob([contents], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  notifyProjectLifecycle('saved', { name: savedName });
  return true;
  } catch (err) {
    console.error(err);
    notifyProjectLifecycle('error', { action: 'save', message: err.message });
    showToast('保存ファイルを作成できませんでした: ' + err.message, 4000);
    return false;
  }
}

// ===== プロジェクトJSON読み込み =====
function loadProjectJSON(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      // PDF / 画像を復元
      if (data.pdfBase64) {
        const binary = atob(data.pdfBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        App.pdfBytes = bytes;
        App.isImageMode = false;
        App.pdf = await pdfjsLib.getDocument({ data: bytes, ...PDFJS_OPTS }).promise;
        App.pageCount = App.pdf.numPages;
        App.pageNum = data.pageNum || 1;
        document.getElementById('page-nav').classList.remove('hidden');
        await renderPDFPage(App.pageNum, true); // skipRescale: JSON読み込み時はリスケール不要
      } else if (data.imageDataUrl) {
        await new Promise(resolve => {
          const img = new Image();
          img.onload = () => {
            App.pdfOffscreen.width = img.width;
            App.pdfOffscreen.height = img.height;
            App.pageWidthPt = img.width;
            App.pageHeightPt = img.height;
            App.pdfOffscreen.getContext('2d').drawImage(img, 0, 0);
            App.pdfReady = true;
            App.isImageMode = true;
            App.pdfBytes = null;
            document.getElementById('drop-zone').style.display = 'none';
            resolve();
          };
          img.src = data.imageDataUrl;
        });
      }
      // メタデータ復元
      if (data.mpp != null)      App.mpp = data.mpp;
      if (data.mapScale != null) App.mapScale = data.mapScale;
      App.bgScale    = data.bgScale    ?? 1.0;
      App.bgOffsetX  = data.bgOffsetX  ?? 0;
      App.bgOffsetY  = data.bgOffsetY  ?? 0;
      App.bgRotation = data.bgRotation ?? 0;
      App.bgLocked   = data.bgLocked !== false;
      if (data.vx != null) { App.vx = data.vx; App.vy = data.vy; App.vz = data.vz; }
      App.lots       = data.lots       || [];
      App.lotNextNum = data.lotNextNum || 1;
      if (data.lotStrokeColor) App.lotStrokeColor = data.lotStrokeColor;
      if (data.lotBorderColor) App.lotBorderColor = data.lotBorderColor;
      if (data.lotFillOpacity != null) {
        App.lotFillOpacity = data.lotFillOpacity;
        const lo = document.getElementById('lot-fill-opacity-slider');
        const lov = document.getElementById('lot-fill-opacity-val');
        if (lo) lo.value = Math.round(App.lotFillOpacity * 100);
        if (lov) lov.textContent = Math.round(App.lotFillOpacity * 100) + '%';
      }
      if (data.lotShowEdgeLengths != null) App.lotShowEdgeLengths = !!data.lotShowEdgeLengths;
      if (data.lotTextScale != null) App.lotTextScale = Number(data.lotTextScale) || 1.4;
      if (data.lotEdgeScale != null) App.lotEdgeScale = Number(data.lotEdgeScale) || 1;
      if (data.subMeasureScale != null) App.subMeasureScale = Number(data.subMeasureScale) || 0.9;
      if (data.showSideLengths != null) App.showSideLengths = !!data.showSideLengths;
      if (data.useYaku != null) App.useYaku = !!data.useYaku;
      if (data.yakuDecimal != null) App.yakuDecimal = Math.max(0, Math.min(2, Number(data.yakuDecimal) || 0));
      if (data.yakuAdjust != null) App.yakuAdjust = Number(data.yakuAdjust) || 0;
      if (data.showLotNumbers != null) App.showLotNumbers = !!data.showLotNumbers;
      updateGlobalDisplayButtons();
      updateGlobalLotColorControls();
      if (data.paperMode != null) {
        App.paperMode = data.paperMode;
        App.paperSize = data.paperSize || 'A4';
        // 保存データが古い場合はrenderScaleから再計算
        const d = getPaperDims(App.paperSize);
        App.paperW = (data.paperW && data.paperW > 1000) ? data.paperW : d.w;
        App.paperH = (data.paperH && data.paperH > 700)  ? data.paperH : d.h;
        const bar = document.getElementById('paper-info-bar');
        if (bar) { bar.classList.toggle('hidden', !App.paperMode); if (App.paperMode) positionOverlayBar(bar); }
        const pmBtn = document.getElementById('btn-paper-mode');
        if (pmBtn) { pmBtn.textContent = App.paperMode ? '本図に戻す' : '📄 作業用紙'; pmBtn.classList.toggle('active-mode', App.paperMode); }
      }
      if (data.paperInfo) {
        App.paperInfo = data.paperInfo;
        const ti = document.getElementById('paper-title');
        const da = document.getElementById('paper-date');
        const au = document.getElementById('paper-author');
        if (ti) ti.value = App.paperInfo.title || '';
        if (da) da.value = App.paperInfo.date || '';
        if (au) au.value = App.paperInfo.author || '';
      }
      App.items      = data.items      || [];
      App.texts      = data.texts      || [];
      const allIds = [...App.lots, ...App.items, ...App.texts].map(x => x.id || 0);
      App.nextId = allIds.length > 0 ? Math.max(...allIds) + 1 : 1;
      updateResults();
      updateLotPanel();
      if (App.mpp && App.mapScale) setScaleDisplay(`縮尺 1/${App.mapScale}`);
      else if (App.mpp) setScaleDisplay(`縮尺設定済`);
      updateZoomInfo();
      App.dirty = true;
      notifyProjectLifecycle('loaded', { name: file.name, kind: 'project' });
      notifyAppState('project-loaded');
    } catch (err) {
      console.error(err);
      notifyProjectLifecycle('error', { action: 'load', message: err.message });
      showToast('作業データを読み込めませんでした: ' + err.message, 4000);
    }
  };
  reader.readAsText(file);
}

// ===== PDF書き込み保存 =====
async function savePDF() {
  if (!App.pdfBytes) {
    showToast('PDF保存はPDFファイルのみ対応しています。画像の場合は「印刷」からPDFとして保存してください。', 5000);
    return;
  }
  if (App.items.length === 0 && App.texts.length === 0) { showToast('計測データがありません', 3000); return; }

  try {
    const { PDFDocument, rgb, StandardFonts } = PDFLib;
    const pdfDoc = await PDFDocument.load(App.pdfBytes);
    const page = pdfDoc.getPages()[App.pageNum - 1];
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const { width, height } = page.getSize();
    const sx = width / App.pdfOffscreen.width;
    const sy = height / App.pdfOffscreen.height;

    const hexRgb = hex => rgb(
      parseInt(hex.slice(1,3),16)/255,
      parseInt(hex.slice(3,5),16)/255,
      parseInt(hex.slice(5,7),16)/255
    );

    const toPdf = (p) => ({ x: p.x * sx, y: height - p.y * sy });
    const safeText = t => t.replace(/[^\x00-\x7F]/g, '?');

    App.items.forEach(item => {
      const color = hexRgb(item.color);
      const pp = item.points.map(toPdf);

      for (let i = 0; i < pp.length - 1; i++) {
        page.drawLine({ start: pp[i], end: pp[i+1], thickness: 1.5, color });
      }
      if (item.type === 'area') {
        page.drawLine({ start: pp[pp.length-1], end: pp[0], thickness: 1.5, color });
      }

      const fs = 7;
      if (item.type === 'distance') {
        const lp = item.labelPos ? toPdf(item.labelPos) : midPdf(pp[0], pp[1]);
        page.drawText(safeText(item.label), { x: lp.x, y: lp.y + 2, size: fs, font, color });

      } else if (item.type === 'polyline') {
        item.segLabels.forEach((lbl, i) => {
          const lp = (item.segLabelPos && item.segLabelPos[i])
            ? toPdf(item.segLabelPos[i]) : midPdf(pp[i], pp[i+1]);
          page.drawText(safeText(lbl), { x: lp.x, y: lp.y + 2, size: fs, font, color });
        });
        const last = pp[pp.length-1];
        page.drawText(safeText('Total:' + item.label), { x: last.x, y: last.y + 6, size: fs, font, color });

      } else if (item.type === 'area') {
        const lp = item.labelPos ? toPdf(item.labelPos) : centroid(pp);
        page.drawText(safeText(item.label), { x: lp.x - 15, y: lp.y, size: fs, font, color });
        if (App.showSideLengths && item.segLabels) {
          item.segLabels.forEach((lbl, i) => {
            const j = (i+1) % pp.length;
            const lp2 = (item.segLabelPos && item.segLabelPos[i])
              ? toPdf(item.segLabelPos[i]) : midPdf(pp[i], pp[j]);
            page.drawText(safeText(lbl), { x: lp2.x, y: lp2.y + 2, size: fs, font, color });
          });
        }
      }
    });

    // メモ (ASCIIのみ)
    App.texts.forEach(t => {
      const p = toPdf({ x: t.x, y: t.y });
      const lines = t.text.split('\n');
      lines.forEach((line, i) => {
        page.drawText(safeText(line), { x: p.x, y: p.y - i * 9, size: 8, font, color: rgb(0.1,0.1,0) });
      });
    });

    const bytes = await pdfDoc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `公図_計測済み_${getDateTimeStr()}.pdf`; a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    showToast('PDF保存エラー: ' + e.message, 5000);
    console.error(e);
  }
}

// ===== 印刷モーダルを開く =====
function openPrintModal() {
  if (!App.pdfReady && !App.paperMode) { showToast('先に図面を開いてください', 3000); return; }
  const size = detectPrintPaperSize();
  App.printSize = size;
  syncPrintPaperButtons(size);
  document.getElementById('print-modal').classList.remove('hidden');
}

// ===== 印刷 =====
async function printMeasurements() {
  // 計測線・ラベルを合成した画像を作成
  const pc = document.createElement('canvas');
  const origCtx = ctx;
  const sv = [App.vz, App.vx, App.vy];

  if (App.paperMode) {
    // 用紙モード: 用紙フレーム + 図形を描画
    pc.width = App.paperW;
    pc.height = App.paperH;
    ctx = pc.getContext('2d');
    App.vz = 1; App.vx = 0; App.vy = 0;
    drawPaperFrame();
    App.labelBoxes = [];
    App.lots.forEach(lot => drawLot(lot));
    App.lots.forEach(lot => drawLotEdgeLabels(lot));
    App.items.forEach(item => drawItem(item, item.color));
    App.texts.forEach(t => drawTextAnnotation(t));
  } else {
    // 本図モード: PDF + 図形を描画
    pc.width = App.pdfOffscreen.width;
    pc.height = App.pdfOffscreen.height;
    ctx = pc.getContext('2d');
    if (App.pdfReady) drawBgImage();
    App.vz = 1; App.vx = 0; App.vy = 0;
    App.labelBoxes = [];
    App.lots.forEach(lot => drawLot(lot));
    App.lots.forEach(lot => drawLotEdgeLabels(lot));
    App.items.forEach(item => drawItem(item, item.color));
    App.texts.forEach(t => drawTextAnnotation(t));
  }

  ctx = origCtx;
  [App.vz, App.vx, App.vy] = sv;

  const dataUrl = pc.toDataURL('image/png');
  const pageSize = App.paperMode ? (App.paperSize || 'A4') : (App.printSize || detectPrintPaperSize());
  const landscape = App.paperMode
    ? true
    : (App.pageWidthPt && App.pageHeightPt ? App.pageWidthPt >= App.pageHeightPt : pc.width >= pc.height);
  const pageMm = getPaperSizeMm(pageSize, landscape);
  const imageMm = getPrintImageSizeMm(pc, pageMm);
  const title = `公図_${getDateTimeStr()}`;
  const html = buildPrintDocument({ title, dataUrl, pageSize, landscape, pageMm, imageMm, autoPrint: false });

  if (window.electronAPI && typeof window.electronAPI.printDrawing === 'function') {
    try {
      await window.electronAPI.printDrawing({
        html,
        pageSize,
        landscape,
        marginType: 'none',
      });
    } catch (e) {
      showToast('印刷エラー: ' + (e.message || e), 5000);
      console.error(e);
    }
    return;
  }

  const win = window.open('', '_blank');
  if (!win) { showToast('印刷画面を開けませんでした。ポップアップの許可を確認してください。', 5000); return; }

  win.document.write(buildPrintDocument({ title, dataUrl, pageSize, landscape, pageMm, imageMm, autoPrint: true }));
  win.document.close();
}

// ===== ユーティリティ =====
function getDateTimeStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
function midPt(a, b) { return { x: (a.x+b.x)/2, y: (a.y+b.y)/2 }; }
function midPdf(a, b) { return { x: (a.x+b.x)/2, y: (a.y+b.y)/2 }; }
function centroid(pts) {
  return { x: pts.reduce((s,p)=>s+p.x,0)/pts.length, y: pts.reduce((s,p)=>s+p.y,0)/pts.length };
}
function shoelace(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i+1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}
function formatDist(m) {
  if (m >= 1000) return (m/1000).toFixed(3)+'km';
  if (m >= 1) return m.toFixed(2)+'m';
  return (m*100).toFixed(1)+'cm';
}

function formatEdge(m) {
  return formatEdgeLot(m, null);
}

// 区画ごとのyakuMode対応版（lot=nullのとき全体設定を使用）
function formatEdgeLot(m, lot) {
  const yakuOn = lot && lot.yakuMode === 'on'  ? true
               : lot && lot.yakuMode === 'off' ? false
               : App.useYaku;
  if (!yakuOn) return formatDist(m);
  const adj = App.yakuAdjust || 0;
  const ma = Math.max(0, m + adj);
  const p = App.yakuDecimal;
  const f = Math.pow(10, p);
  if (ma >= 1000) return `約${(Math.floor(ma / 1000 * f) / f).toFixed(p)}km`;
  if (ma >= 1)    return `約${(Math.floor(ma * f) / f).toFixed(p)}m`;
  return `約${(Math.floor(ma * 100 * f) / f).toFixed(p)}cm`;
}

// ===== 計測アイテム再計算（頂点移動後）=====
function recalcItem(item) {
  if (!App.mpp) return;
  if (item.type === 'distance') {
    const d = dist(item.points[0], item.points[1]) * App.mpp;
    item.value = d;
    if (!item.customLabel) item.label = formatDist(d);
  } else if (item.type === 'polyline') {
    let total = 0;
    const segValues = [];
    for (let i = 0; i < item.points.length - 1; i++) {
      const d = dist(item.points[i], item.points[i + 1]) * App.mpp;
      segValues.push(d);
      total += d;
    }
    item.segValues = segValues;
    if (!item.customLabel) item.label = formatDist(total);
    item.value = total;
    // segLabels はカスタムでなければ再生成
    item.segLabels = segValues.map((d, i) =>
      (item.customSegLabels && item.customSegLabels[i] != null) ? item.customSegLabels[i] : formatEdge(d));
  } else if (item.type === 'area') {
    const sqm = shoelace(item.points) * App.mpp * App.mpp;
    const tsubo = sqm * 0.3025;
    const segValues = [];
    for (let i = 0; i < item.points.length; i++) {
      const j = (i + 1) % item.points.length;
      segValues.push(dist(item.points[i], item.points[j]) * App.mpp);
    }
    item.segValues = segValues;
    item.value = sqm;
    if (!item.customLabel) item.label = `${sqm.toFixed(2)}㎡ / ${tsubo.toFixed(2)}坪`;
    item.segLabels = segValues.map((d, i) =>
      (item.customSegLabels && item.customSegLabels[i] != null) ? item.customSegLabels[i] : formatEdge(d));
  }
}

// ===== 分譲地ツール =====

function setAppMode(mode) {
  // 常に分譲地モード固定
  App.appMode = 'subdivision';
  const rm = document.getElementById('results-measure');
  const rs = document.getElementById('results-subdivision');
  rm.classList.remove('hidden');
  rm.style.flex = '0 0 auto';
  rm.style.maxHeight = '45%';
  rm.style.overflow = 'auto';
  rs.classList.remove('hidden');
  if (App.mode !== 'pan') {
    App.mode = 'draw'; canvas.style.cursor = 'crosshair';
  }
  requestAnimationFrame(() => { resizeCanvas(); });
  updateHint();
  App.dirty = true;
}

function showToolHelp(text) {
  if (!text) return;
  const barText = document.getElementById('help-bar-text');
  if (barText) barText.textContent = text;
  // ヘルプバーが閉じていれば表示状態を更新（非表示のままにする）
}

function clearSplitTarget() {
  App.splitTargetId = null;
  App.lotPts = [];
  document.getElementById('split-clear-row')?.classList.add('hidden');
  render();
}

function updateSplitUI() {
  const hasTarget = App.splitTargetId !== null;
  document.getElementById('split-clear-row')?.classList.toggle('hidden', !hasTarget);
}

function setLotTool(tool) {
  if (blockToolSwitchDuringCalibration()) return;
  hidePlacementPreview();
  App.lotTool = tool;
  App.lotPts = [];
  App.pts = [];
  App.parallelBase = null;
  App.mergeSelect = [];
  // 選択分割以外のツールに切り替えたらクリアUIをリセット
  if (tool !== 'split') { App.splitTargetId = null; updateSplitUI(); }
  App.mode = (tool === 'select' || tool === 'label-move' || tool === 'move-all' || tool === 'merge' || tool === 'corner-cut' || tool === 'delete' || tool === 'edge-hide') ? 'select' : 'draw';
  canvas.style.cursor = tool === 'delete' ? 'not-allowed' : (tool === 'edge-hide' ? 'pointer' : 'crosshair');
  document.getElementById('btn-divguide')?.classList.toggle('active', tool === 'divguide');
  document.getElementById('divguide-panel')?.classList.toggle('hidden', tool !== 'divguide');
  document.getElementById('btn-lot-draw').classList.toggle('active', tool === 'draw');
  document.getElementById('btn-road-draw').classList.toggle('active', tool === 'road');
  document.getElementById('btn-lot-split').classList.toggle('active', tool === 'split');
  document.getElementById('btn-lot-split-all')?.classList.toggle('active', tool === 'split-all');
  document.getElementById('btn-lot-merge').classList.toggle('active', tool === 'merge');
  document.getElementById('btn-corner-cut')?.classList.toggle('active', tool === 'corner-cut');
  document.getElementById('sub-btn-parallel').classList.toggle('active', tool === 'parallel');
  document.getElementById('parallel-panel').classList.toggle('hidden', tool !== 'parallel');
  document.getElementById('parallel-create').disabled = true;
  [
    'sub-btn-distance', 'sub-btn-polyline', 'sub-btn-area',
    'sub-btn-arrow', 'sub-btn-text', 'sub-btn-callout', 'sub-btn-line',
    'sub-btn-north-arrow', 'sub-btn-house-stamp', 'sub-btn-parking-stamp',
    'btn-vertex-edit-sub', 'btn-label-edit-sub',
  ].forEach(id =>
    document.getElementById(id)?.classList.remove('active'));
  document.getElementById('line-settings')?.classList.add('hidden');
  document.getElementById('north-arrow-settings')?.classList.add('hidden');
  document.getElementById('stamp-settings')?.classList.add('hidden');
  document.getElementById('btn-lot-delete-tool')?.classList.toggle('active', tool === 'delete');
  document.getElementById('btn-lot-select')?.classList.toggle('active', tool === 'select');
  document.getElementById('btn-edge-hide')?.classList.toggle('active', tool === 'edge-hide');
  if (tool !== 'select') App.selectedFormat = null;
  updateFormatPanel();
  updateHint();
  App.dirty = true;
  notifyAppState('tool');
}

function setSubMeasureMode(mode) {
  if (blockToolSwitchDuringCalibration()) return;
  hidePlacementPreview();
  App.lotPts = [];
  App.pts = [];
  App.parallelBase = null;
  App._hoverLabelKey = null;
  App.lotTool = 'measure';
  App.mode = mode;
  canvas.style.cursor = 'crosshair';
  ['btn-lot-draw','btn-road-draw','btn-lot-split','sub-btn-parallel'].forEach(id =>
    document.getElementById(id)?.classList.remove('active'));
  document.getElementById('parallel-panel').classList.add('hidden');
  document.querySelectorAll('#tools-subdivision .btn-lot-tool').forEach(b => b.classList.remove('active'));
  ['distance','polyline','area','arrow','text','callout','line','north-arrow','house-stamp','parking-stamp','vertex-edit','label-edit'].forEach(m => {
    const id = (m === 'vertex-edit') ? 'btn-vertex-edit-sub'
             : (m === 'label-edit')  ? 'btn-label-edit-sub'
             : `sub-btn-${m}`;
    document.getElementById(id)?.classList.toggle('active', m === mode);
  });
  // パネル表示切替
  document.getElementById('line-settings')?.classList.toggle('hidden', mode !== 'line');
  document.getElementById('north-arrow-settings')?.classList.toggle('hidden', mode !== 'north-arrow');
  const showStamp = mode === 'house-stamp' || mode === 'parking-stamp';
  document.getElementById('stamp-settings')?.classList.toggle('hidden', !showStamp);
  if (showStamp) {
    const label = document.getElementById('stamp-settings-label');
    if (label) label.textContent = mode === 'parking-stamp'
      ? '配置前の初期設定 — 駐車場'
      : '配置前の初期設定 — 家屋';
    // モード切替時のデフォルト値をセット
    const defs = mode === 'parking-stamp' ? [5, 2.5] : [10, 8];
    const wInp = document.getElementById('stamp-w-input');
    const hInp = document.getElementById('stamp-h-input');
    if (wInp && !wInp._userEdited) { wInp.value = defs[0]; App.stampWM = defs[0]; }
    if (hInp && !hInp._userEdited) { hInp.value = defs[1]; App.stampHM = defs[1]; }
  }
  App.selectedFormat = null;
  updateFormatPanel();
  updateHint();
  App.dirty = true;
  notifyAppState('tool');
}

function snapToGrid(val) {
  if (!App.gridSnap || !App.mpp) return val;
  // 画面上で約8pxになるグリッドを動的に選択（ズームに応じて粒度が変わる）
  const targetPx = 8;
  const rawGridM = (targetPx / App.vz) * App.mpp;
  const niceGrids = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50];
  const gridM = niceGrids.find(g => g >= rawGridM) || niceGrids[niceGrids.length - 1];
  const gridPx = gridM / App.mpp;
  return Math.round(val / gridPx) * gridPx;
}

function circleNum(n) {
  if (n >= 1 && n <= 20) return String.fromCodePoint(0x2460 + n - 1);
  if (n >= 21 && n <= 35) return String.fromCodePoint(0x3251 + n - 21);
  if (n >= 36 && n <= 50) return String.fromCodePoint(0x32B1 + n - 36);
  return '(' + n + ')';
}

function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (((yi > py) !== (yj > py)) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// 計測アイテムのライン部分にヒットしているか（図形移動用）
function hitMeasureItem(cp) {
  const hitR = 10 / App.vz;
  for (let k = App.items.length - 1; k >= 0; k--) {
    const item = App.items[k];
    if (!item.points || item.points.length < 2 || item.isParallel) continue;
    const pts = item.points;
    // 端点の円ドットにヒット
    for (const p of pts) {
      if (Math.hypot(cp.x - p.x, cp.y - p.y) < hitR * 2) return item;
    }
    // 線分にヒット
    const segCount = item.type === 'area' ? pts.length : pts.length - 1;
    for (let i = 0; i < segCount; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
      if (distToSegment(cp.x, cp.y, p1.x, p1.y, p2.x, p2.y) < hitR) return item;
    }
  }
  return null;
}

function hitLot(cp) {
  for (let i = App.lots.length - 1; i >= 0; i--) {
    const l = App.lots[i];
    if (l.points && l.points.length >= 3 && pointInPolygon(cp.x, cp.y, l.points)) return l;
  }
  return null;
}


function confirmLotDraw() {
  const pts = [...App.lotPts];
  App.lotPts = [];
  if (pts.length < 3) { App.dirty = true; return; }
  saveState();
  if (App.lotTool === 'road') {
    const defaults = App.commandDefaults?.road || {};
    App.lots.push({
      id: App.nextId++, type: 'road', points: pts,
      color: defaults.color || '#cbd5e1',
      borderColor: defaults.borderColor || '#64748b',
      fillOpacity: Number.isFinite(defaults.fillOpacity) ? defaults.fillOpacity : 0.48,
      roadLabel: defaults.roadLabel ?? '公道',
      roadWidth: Number(defaults.roadWidth) || 4,
    });
  } else {
    const defaults = App.commandDefaults?.lot || {};
    App.lots.push({
      id: App.nextId++, type: 'lot', points: pts,
      lotNum: App.lotNextNum++, price: '', memo: '',
      color: defaults.color || App.lotStrokeColor || '#fff0bd',
      borderColor: defaults.borderColor || App.lotBorderColor || '#a46a08',
      fillOpacity: Number.isFinite(defaults.fillOpacity) ? defaults.fillOpacity : App.lotFillOpacity,
    });
  }
  updateLotPanel();
  App.dirty = true;
}

function drawLotsLayer() {
  drawDivGuides();
  App.lots.forEach(lot => drawLot(lot));
  App.lots.forEach(lot => drawLotEdgeLabels(lot));
}

function drawDivGuides() {
  if (!App.divGuides || App.divGuides.length === 0) return;
  App.divGuides.forEach(g => {
    const dx = g.p2.x - g.p1.x;
    const dy = g.p2.y - g.p1.y;
    // ガイド線（破線）
    ctx.save();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1 / App.vz;
    ctx.setLineDash([4 / App.vz, 4 / App.vz]);
    ctx.beginPath();
    ctx.moveTo(g.p1.x, g.p1.y);
    ctx.lineTo(g.p2.x, g.p2.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // 端点マーカー
    [g.p1, g.p2].forEach(pt => {
      const r = 3 / App.vz;
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2); ctx.fill();
    });
    // 等分点マーカー（×印）
    for (let i = 1; i < g.n; i++) {
      const px = g.p1.x + dx * i / g.n;
      const py = g.p1.y + dy * i / g.n;
      const cs = 5 / App.vz;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5 / App.vz;
      ctx.beginPath();
      ctx.moveTo(px - cs, py - cs); ctx.lineTo(px + cs, py + cs);
      ctx.moveTo(px + cs, py - cs); ctx.lineTo(px - cs, py + cs);
      ctx.stroke();
      // 距離ラベル（縮尺設定済み時）
      if (App.mpp) {
        const segLen = Math.sqrt(dx * dx + dy * dy) / g.n * App.mpp;
        const fs = 9 / App.vz;
        ctx.font = `${fs}px 'Segoe UI',sans-serif`;
        ctx.fillStyle = '#ef4444';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(segLen.toFixed(2) + 'm', px, py - cs - 2 / App.vz);
      }
    }
    ctx.restore();
  });
}

function drawLot(lot) {
  const pts = lot.points;
  if (!pts || pts.length < 2) return;
  const isRoad = lot.type === 'road';
  ctx.setLineDash([]);

  // ポリゴン描画
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  const fillOpacity = isRoad ? (lot.fillOpacity ?? 0.48) : (lot.fillOpacity ?? App.lotFillOpacity ?? 0.58);
  const opHex = Math.round(fillOpacity * 255).toString(16).padStart(2, '0');
  ctx.fillStyle = isRoad ? (lot.color || '#cbd5e1') + opHex : (lot.color || '#fff0bd') + opHex;
  ctx.fill();
  const isMergeSelected = App.lotTool === 'merge' && App.mergeSelect.includes(lot.id);
  ctx.strokeStyle = isMergeSelected ? '#f59e0b'
    : (isRoad ? (lot.borderColor || '#64748b')
               : (lot.borderColor || App.lotBorderColor || '#1d4ed8'));
  ctx.lineWidth = (isMergeSelected ? 3 : 1.5) / App.vz;
  ctx.stroke();

  // 吸着のON/OFFと点表示を分離。確定済み頂点は編集時だけ控えめに示す。
  if (App.mode === 'vertex-edit') {
    const dotColor = isRoad ? (lot.borderColor || '#94a3b8') : (lot.borderColor || App.lotBorderColor || '#1d4ed8');
    pts.forEach(p => drawEditHandle(p.x, p.y, dotColor));
  }

  const mpp = App.mpp;
  const cen = centroid(pts);

  if (isRoad) {
    const titleScale = parseFloat(lot.roadLabelSize) || 1.0;
    const widthScale = parseFloat(lot.roadWidthLabelSize) || titleScale;
    const fs = pfs(11) * titleScale;
    const fsW = pfs(9) * widthScale;
    const text = lot.roadLabel !== undefined ? lot.roadLabel : '道路';
    const titleX = cen.x + (lot.labelOffX || 0);
    const titleY = cen.y + (lot.labelOffY || 0);
    const widthHasCustomPos = lot.roadWidthOffX != null || lot.roadWidthOffY != null;
    const textColor = lot.roadLabelColor || '#475569';
    const widthColor = lot.roadWidthLabelColor || textColor;
    const titleFont = canvasFontFamily(lot.roadLabelFontFamily);
    const widthFont = canvasFontFamily(lot.roadWidthFontFamily || lot.roadLabelFontFamily);
    const roadRot = (App.mode === 'label-edit') ? 0 : (lot.roadLabelRotation || 0) * Math.PI / 180;
    const textLines = text.split('\n');
    let titleBox = null;
    let widthBox = null;

    ctx.save();
    if (roadRot) { ctx.translate(titleX, titleY); ctx.rotate(roadRot); ctx.translate(-titleX, -titleY); }
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (lot.roadVertical && text.length > 0) {
      const chars = [...text];
      const lineH = fs * 1.3;
      const totalH = chars.length * lineH;
      ctx.font = `bold ${fs}px ${titleFont}`;
      chars.forEach((ch, i) => {
        ctx.fillText(ch, titleX, titleY - totalH / 2 + lineH * (i + 0.5));
      });
      titleBox = { cx: titleX, cy: titleY, w: fs * 1.35, h: Math.max(lineH, totalH) };
      // 幅員（縦書きで右横に並べる）
      if (lot.roadWidth) {
        const wChars = [...`幅員${lot.roadWidth}m`];
        const wLineH = fsW * 1.25;
        const wTotalH = wChars.length * wLineH;
        const widthX = widthHasCustomPos ? cen.x + (lot.roadWidthOffX || 0) : titleX + fs * 1.3;
        const widthY = widthHasCustomPos ? cen.y + (lot.roadWidthOffY || 0) : titleY;
        ctx.fillStyle = widthColor;
        ctx.font = `${fsW}px ${widthFont}`;
        wChars.forEach((ch, i) => {
          ctx.fillText(ch, widthX, widthY - wTotalH / 2 + wLineH * (i + 0.5));
        });
        widthBox = { cx: widthX, cy: widthY, w: fsW * 1.35, h: Math.max(wLineH, wTotalH) };
      }
    } else {
      const lineH = fs * 1.25;
      const totalTextH = textLines.length * lineH;
      const widthOffset = lot.roadWidth ? -(fsW * 0.6) : 0;
      ctx.font = `bold ${fs}px ${titleFont}`;
      let titleW = fs * 2;
      textLines.forEach((line, i) => {
        titleW = Math.max(titleW, ctx.measureText(line || '　').width);
        ctx.fillText(line, titleX, titleY - totalTextH / 2 + lineH * (i + 0.5) + widthOffset);
      });
      titleBox = { cx: titleX, cy: titleY + widthOffset, w: titleW, h: Math.max(lineH, totalTextH) };
      if (lot.roadWidth) {
        const widthText = `幅員 ${lot.roadWidth}m`;
        const defaultWidthX = titleX;
        const defaultWidthY = titleY + totalTextH / 2 + widthOffset + fsW * 0.8;
        const widthX = widthHasCustomPos ? cen.x + (lot.roadWidthOffX || 0) : defaultWidthX;
        const widthY = widthHasCustomPos ? cen.y + (lot.roadWidthOffY || 0) : defaultWidthY;
        ctx.fillStyle = widthColor;
        ctx.font = `${fsW}px ${widthFont}`;
        const widthW = Math.max(fsW * 2, ctx.measureText(widthText).width);
        ctx.fillText(widthText, widthX, widthY);
        widthBox = { cx: widthX, cy: widthY, w: widthW, h: fsW * 1.25 };
      }
    }
    ctx.restore();

    // 道路ラベルのヒットボックス（タイトル・幅員を別々に掴む用）
    if (App.mode !== 'label-edit') {
      const pushRoadBox = (box, part) => {
        if (!box) return;
        const pad = 6;
        App.labelBoxes.push({
          lotId: lot.id, isLotLabel: true, isText: false,
          roadLabelPart: part,
          cx: box.cx, cy: box.cy,
          sx: (box.cx - box.w / 2) * App.vz + App.vx - pad,
          sy: (box.cy - box.h / 2) * App.vz + App.vy - pad,
          sw: box.w * App.vz + pad * 2,
          sh: box.h * App.vz + pad * 2,
        });
      };
      pushRoadBox(titleBox, 'title');
      pushRoadBox(widthBox, 'width');
    }
    return;
  }

  // 面積
  const sqm = mpp ? shoelace(pts) * mpp * mpp : null;
  const ts = parseFloat(lot.labelScale) || App.lotTextScale || 1.0;
  const fsNum = pfs(14) * ts;
  const fsSm  = pfs(9)  * ts;
  const lotLabelFont = canvasFontFamily(lot.labelFontFamily);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  // 面積表示：区画個別設定 > デフォルト表示
  const showArea = lot.areaDisplay === 'hide' ? false : true;
  const areaText  = !showArea ? null
    : lot.customAreaLabel  != null ? lot.customAreaLabel  : (sqm ? sqm.toFixed(1) + '㎡' : null);
  const tsuboText = !showArea ? null
    : lot.customTsuboLabel != null ? lot.customTsuboLabel : (sqm ? (sqm * 0.3025).toFixed(1) + '坪' : null);
  // 色: カスタム色 > 自動（カスタムテキストなら黄色、そうでなければ元色）
  const labelTextColor = lot.labelTextColor || null;
  const areaColor  = lot.customAreaLabelColor  || labelTextColor || (lot.customAreaLabel  != null ? '#f59e0b' : '#1e293b');
  const tsuboColor = lot.customTsuboLabelColor || labelTextColor || (lot.customTsuboLabel != null ? '#f59e0b' : '#475569');

  const topLabelLines = lot.topLabel
    ? lot.topLabel.split('\n').map(t => ({ text: t, fs: fsSm * 1.05, color: labelTextColor || '#334155', editKey: null }))
    : [];
  const lines = [
    ...(App.showLotNumbers && lot.hideNumber !== 'hide' ? [{ text: circleNum(lot.lotNum), fs: fsNum, color: labelTextColor || '#1d4ed8', editKey: null }] : []),
    ...topLabelLines,
    ...(areaText  ? [{ text: areaText,  fs: fsSm,       color: areaColor,  editKey: 'area'  }] : []),
    ...(tsuboText ? [{ text: tsuboText, fs: fsSm,       color: tsuboColor, editKey: 'tsubo' }] : []),
    ...(lot.price ? [{ text: lot.price, fs: fsSm * 0.9, color: labelTextColor || '#b45309',  editKey: null }] : []),
    ...(lot.memo  ? [{ text: lot.memo,  fs: fsSm * 0.85,color: labelTextColor || '#64748b',  editKey: null }] : []),
  ];

  const lx = cen.x + (lot.labelOffX || 0);
  const ly = cen.y + (lot.labelOffY || 0);
  const lineH = fsNum * 1.1;
  const smH   = fsSm * 1.3;
  let totalH = lineH + (lines.length - 1) * smH;
  let lineY = ly - totalH / 2 + lineH / 2;
  // ラベルブロックの回転（label-edit中は正立で扱う）
  const lblRot = (App.mode === 'label-edit') ? 0 : (lot.labelRotation || 0) * Math.PI / 180;
  ctx.save();
  if (lblRot) { ctx.translate(lx, ly); ctx.rotate(lblRot); ctx.translate(-lx, -ly); }
  lines.forEach((ln, i) => {
    ctx.font = `bold ${ln.fs}px ${lotLabelFont}`;
    // ラベル編集モード中はクリック可能ラベルをハイライト
    if (App.mode === 'label-edit' && ln.editKey) {
      const tw = ctx.measureText(ln.text).width;
      const hw = tw / 2 + 6 / App.vz, hh = ln.fs * 0.75;
      const isHov = App._hoverLabelKey === (lot.id + '_' + ln.editKey);
      ctx.fillStyle = isHov ? 'rgba(59,130,246,0.25)' : 'rgba(59,130,246,0.1)';
      ctx.fillRect(lx - hw, lineY - hh, hw * 2, hh * 2);
      ctx.strokeStyle = isHov ? '#3b82f6' : '#93c5fd';
      ctx.lineWidth = (isHov ? 1.5 : 1) / App.vz;
      ctx.setLineDash([3 / App.vz, 3 / App.vz]);
      ctx.strokeRect(lx - hw, lineY - hh, hw * 2, hh * 2);
      ctx.setLineDash([]);
      // ヒットボックス登録（label-editモードのみ）
      const scx2 = lx * App.vz + App.vx, scy2 = lineY * App.vz + App.vy;
      const shw = hw * App.vz + 8, shh = hh * App.vz + 8;
      App.labelBoxes.push({
        itemId: lot.id, labelKey: ln.editKey,
        isText: false, isLotCenter: true,
        lotId: lot.id, centerKey: ln.editKey,
        cx: lx, cy: lineY,
        sx: scx2 - shw, sy: scy2 - shh, sw: shw * 2, sh: shh * 2,
      });
    }
    ctx.fillStyle = ln.color;
    ctx.fillText(ln.text, lx, lineY);
    lineY += i === 0 ? lineH : smH;
  });
  ctx.restore();

  // 区画ラベルブロック全体のヒットボックス（選択・移動で文字を掴む用。label-edit時は個別ラベルを優先するため登録しない）
  if (lines.length > 0 && App.mode !== 'label-edit') {
    let maxW = 0;
    lines.forEach(ln => {
      ctx.font = `bold ${ln.fs}px ${lotLabelFont}`;
      maxW = Math.max(maxW, ctx.measureText(ln.text).width);
    });
    const scx = (lx - maxW / 2) * App.vz + App.vx;
    const scy = (ly - totalH / 2) * App.vz + App.vy;
    App.labelBoxes.push({
      lotId: lot.id, isLotLabel: true, isText: false,
      cx: lx, cy: ly,
      sx: scx - 6, sy: scy - 6,
      sw: maxW * App.vz + 12, sh: totalH * App.vz + 12,
    });
  }
}

function drawLotEdgeLabels(lot) {
  const pts = lot.points;
  if (!pts || pts.length < 2 || lot.type === 'road') return;
  const mpp = App.mpp;
  // 区画個別設定 > グローバル設定
  let showEdges = lot.edgeDisplay === 'show' ? true
                  : lot.edgeDisplay === 'hide' ? false
                  : App.lotShowEdgeLengths;
  if (App.lotTool === 'edge-hide') showEdges = true; // 寸法消しツール中はクリック対象として全辺表示
  if (!mpp || !showEdges) return;
  const cen = centroid(pts);
  const scale = parseFloat(lot.edgeScale) || App.lotEdgeScale || 1.0;
  for (let i = 0; i < pts.length; i++) {
    const fsE = pfs(7.5) * scale * ((lot.customEdgeScales && lot.customEdgeScales[i]) || 1);
    const isHidden = lot.edgeHidden && lot.edgeHidden[i];
    if (isHidden && App.lotTool !== 'edge-hide') continue; // 個別非表示（寸法消しツール中はゴースト表示）
    const j = (i + 1) % pts.length;
    const p1 = pts[i], p2 = pts[j];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    let nx = -uy, ny = ux;
    if ((cen.x - mx) * nx + (cen.y - my) * ny > 0) { nx = -nx; ny = -ny; }
    const offset = fsE * 0.75;
    const userOff = (lot.edgeLabelOffsets && lot.edgeLabelOffsets[i]) || { dx: 0, dy: 0 };
    const lcx = mx + nx * offset + userOff.dx;
    const lcy = my + ny * offset + userOff.dy;
    const edgeText = (lot.customEdgeLabels && lot.customEdgeLabels[i] != null)
      ? lot.customEdgeLabels[i] : formatEdgeLot(len * mpp, lot);
    const scx = lcx * App.vz + App.vx;
    const scy = lcy * App.vz + App.vy;
    const approxTw = edgeText.length * fsE * 0.62;
    const srW = Math.max(24, approxTw / 2 + fsE * 0.5);
    const srH = Math.max(16, fsE * 1.2);
    let angle = Math.atan2(uy, ux);
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
    if (lot.edgeRotationOffset && lot.edgeRotationOffset[i]) angle += lot.edgeRotationOffset[i] * Math.PI / 180; // 辺寸法の追加回転（全文字回転対応）
    const cosA = Math.abs(Math.cos(angle)), sinA = Math.abs(Math.sin(angle));
    const hitHalfW = Math.max(srH, srW * cosA + srH * sinA);
    const hitHalfH = Math.max(srH, srW * sinA + srH * cosA);
    const hitSW = hitHalfW * 2 * App.vz, hitSH = hitHalfH * 2 * App.vz;
    const isHovering = App._hoverLabelKey === (lot.id + '_lotedge' + i);
    ctx.save();
    ctx.translate(lcx, lcy);
    ctx.rotate(angle);
    if (App.mode === 'label-edit') {
      ctx.fillStyle = isHovering ? 'rgba(59,130,246,0.25)' : 'rgba(59,130,246,0.1)';
      ctx.fillRect(-srW, -srH, srW * 2, srH * 2);
      ctx.strokeStyle = isHovering ? '#3b82f6' : '#93c5fd';
      ctx.lineWidth = (isHovering ? 1.5 : 1) / App.vz;
      ctx.setLineDash([3 / App.vz, 3 / App.vz]);
      ctx.strokeRect(-srW, -srH, srW * 2, srH * 2);
      ctx.setLineDash([]);
    }
    // 寸法消しツール中: クリック対象を枠表示（非表示の辺は赤系）
    if (App.lotTool === 'edge-hide') {
      ctx.fillStyle = isHidden ? 'rgba(248,113,113,0.12)' : 'rgba(96,165,250,0.12)';
      ctx.fillRect(-srW, -srH, srW * 2, srH * 2);
      ctx.strokeStyle = isHidden ? '#f87171' : '#60a5fa';
      ctx.lineWidth = 1 / App.vz;
      ctx.setLineDash([3 / App.vz, 3 / App.vz]);
      ctx.strokeRect(-srW, -srH, srW * 2, srH * 2);
      ctx.setLineDash([]);
    }
    const edgeFont = lot.customEdgeFontFamilies?.[i] || lot.edgeFontFamily;
    ctx.font = `${fsE}px ${canvasFontFamily(edgeFont)}`;
    const edgeColor2 = (lot.customEdgeLabelColors && lot.customEdgeLabelColors[i])
      || (lot.customEdgeLabels && lot.customEdgeLabels[i] != null ? '#f59e0b' : (lot.edgeLabelColor || '#334155'));
    ctx.fillStyle = edgeColor2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (isHidden) ctx.globalAlpha = 0.28; // 非表示の辺はゴースト表示
    ctx.fillText(edgeText, 0, 0);
    if (isHidden) {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 1 / App.vz;
      const hwl = srW * 0.7;
      ctx.beginPath(); ctx.moveTo(-hwl, 0); ctx.lineTo(hwl, 0); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    App.labelBoxes.push({
      itemId: lot.id, labelKey: 'lotedge' + i,
      isText: false, isLotEdge: true,
      lotId: lot.id, edgeIdx: i,
      cx: lcx, cy: lcy,
      sx: scx - hitSW / 2, sy: scy - hitSH / 2,
      sw: hitSW, sh: hitSH,
    });
  }
}

function drawLotInProgress() {
  const pts = App.lotPts;
  if (!pts || pts.length === 0) return;
  // 分割ツールは drawSplitPreview が担当するのでここでは描画しない
  if (App.lotTool === 'split' || App.lotTool === 'split-all') return;
  // 分割ガイドプレビュー
  if (App.lotTool === 'divguide') {
    const dgPt = App.snapPt || { x: App.mx, y: App.my };
    ctx.save();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5 / App.vz;
    ctx.setLineDash([4 / App.vz, 4 / App.vz]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(dgPt.x, dgPt.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (App.snapType) {
      const snapColors = { vertex: '#facc15', intersection: '#22d3ee', grid: '#4ade80' };
      drawSnapBox(dgPt.x, dgPt.y, snapColors[App.snapType]);
    }
    ctx.restore();
    return;
  }
  const isRoad = App.lotTool === 'road';
  const defaults = isRoad ? (App.commandDefaults?.road || {}) : (App.commandDefaults?.lot || {});
  const lineColor = defaults.borderColor || (isRoad ? '#596777' : App.lotBorderColor || '#a46a08');
  const fillColor = defaults.color || (isRoad ? '#cbd5e1' : App.lotStrokeColor || '#fff0bd');
  const fillAlpha = Number.isFinite(defaults.fillOpacity) ? defaults.fillOpacity : (isRoad ? 0.48 : App.lotFillOpacity || 0.58);
  const lotSnap = snapPoint(App.mx, App.my);
  const mx = lotSnap.pt.x;
  const my = lotSnap.pt.y;

  // 確定済み辺を実線で描画
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2 / App.vz;
  ctx.setLineDash([]);
  ctx.stroke();

  // マウス位置への破線プレビュー
  ctx.beginPath();
  ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.lineTo(mx, my);
  ctx.setLineDash([6 / App.vz, 3 / App.vz]);
  ctx.strokeStyle = lineColor;
  ctx.stroke();
  ctx.setLineDash([]);

  // 閉じるプレビュー（最初の点への破線）
  if (pts.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(pts[0].x, pts[0].y);
    ctx.setLineDash([3 / App.vz, 4 / App.vz]);
    ctx.globalAlpha = 0.52;
    ctx.strokeStyle = lineColor;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    // ポリゴン内部を半透明塗り
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineTo(mx, my);
    ctx.closePath();
    ctx.save();
    ctx.globalAlpha = Math.max(0.08, Math.min(0.22, fillAlpha * 0.28));
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.restore();
  }

  // 頂点ドット（線の色に連動）
  const dotC = lineColor;
  pts.forEach(p => drawDot(p.x, p.y, 2.4 / App.vz, dotC));
  // マウス位置の点
  drawDot(mx, my, 2 / App.vz, dotC);
  // スナップインジケーター（□）
  if (lotSnap.type === 'vertex') {
    drawSnapBox(mx, my, '#facc15');       // 頂点スナップ：黄色
  } else if (lotSnap.type === 'intersection') {
    drawSnapBox(mx, my, '#22d3ee');       // 交点スナップ：シアン
  } else if (lotSnap.type === 'grid') {
    drawSnapBox(mx, my, '#4ade80');       // グリッドスナップ：緑
  }

  // 各辺の距離ラベル
  if (App.mpp) {
    const allPts = [...pts, { x: mx, y: my }];
    const fsE = 9 / App.vz;
    ctx.font = `${fsE}px ${canvasFontFamily(defaults.edgeFontFamily)}`;
    ctx.fillStyle = lineColor;
    for (let i = 0; i < allPts.length - 1; i++) {
      const a = allPts[i], b = allPts[i + 1];
      const d = Math.hypot(b.x - a.x, b.y - a.y) * App.mpp;
      if (d < 0.01) continue;
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len * 10 / App.vz, ny = dx / len * 10 / App.vz;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(formatEdgeLot(d, null), midX + nx, midY + ny);
    }
  }

  // リアルタイム面積表示（3点以上のとき）
  if (pts.length >= 2 && App.mpp) {
    const preview = [...pts, { x: mx, y: my }];
    const sqm = shoelace(preview) * App.mpp * App.mpp;
    if (sqm > 0) {
      const cen = centroid(preview);
      const label = `${sqm.toFixed(1)}㎡`;
      const fs = 11 / App.vz;
      ctx.font = `bold ${fs}px ${canvasFontFamily(defaults.labelFontFamily)}`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(15,23,42,0.75)';
      ctx.fillRect(cen.x - tw / 2 - 4 / App.vz, cen.y - fs, tw + 8 / App.vz, fs * 1.8);
      ctx.fillStyle = lineColor;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, cen.x, cen.y);
    }
  }
}

// 囲んで分割: プレビュー描画
// ===== 平行線ツール =====
function drawParallelPreview() {
  const base = App.parallelBase;
  const mx = App.mx, my = App.my;

  // ベース未定義: 1点目確定済みなら pts[0] とマウスを線表示
  if (!base) {
    const _sp = App.snapPt || { x: mx, y: my };
    const smx = _sp.x, smy = _sp.y;

    if (App.pts.length === 1) {
      ctx.beginPath();
      ctx.moveTo(App.pts[0].x, App.pts[0].y);
      ctx.lineTo(smx, smy);
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 2 / App.vz;
      ctx.setLineDash([6 / App.vz, 3 / App.vz]);
      ctx.stroke();
      ctx.setLineDash([]);
      drawDot(App.pts[0].x, App.pts[0].y, 2.4 / App.vz, '#a78bfa');
    }
    // □インジケーター
    drawDot(smx, smy, 2 / App.vz, '#a78bfa');
    if (App.snapType === 'vertex') drawSnapBox(smx, smy, '#f59e0b');
    else if (App.snapType === 'intersection') drawSnapBox(smx, smy, '#22d3ee');
    return;
  }

  const { p1, p2 } = base;
  const distM = parseFloat(document.getElementById('parallel-dist').value) || 3;
  const distPx = App.mpp ? distM / App.mpp * App.parallelFlip : 50 * App.parallelFlip;
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;

  const pp1 = { x: p1.x + nx * distPx, y: p1.y + ny * distPx };
  const pp2 = { x: p2.x + nx * distPx, y: p2.y + ny * distPx };

  // ベース線（グレー）
  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
  ctx.strokeStyle = '#64748b'; ctx.lineWidth = 1.5 / App.vz;
  ctx.setLineDash([4 / App.vz, 3 / App.vz]); ctx.stroke(); ctx.setLineDash([]);

  // 平行線プレビュー（紫）
  ctx.beginPath(); ctx.moveTo(pp1.x, pp1.y); ctx.lineTo(pp2.x, pp2.y);
  ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 2 / App.vz;
  ctx.setLineDash([]); ctx.stroke();
  drawDot(pp1.x, pp1.y, 2.2 / App.vz, '#a78bfa');
  drawDot(pp2.x, pp2.y, 2.2 / App.vz, '#a78bfa');

}

function createParallelLine() {
  const base = App.parallelBase;
  if (!base || !App.mpp) return;
  const unitDistM = parseFloat(document.getElementById('parallel-dist').value) || 3;
  App.parallelCount++;
  const totalDistM = unitDistM * App.parallelCount;
  const distPx = totalDistM / App.mpp * App.parallelFlip;
  const { p1, p2 } = base;
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const mx = (p1.x + p2.x) / 2 + nx * distPx;
  const my = (p1.y + p2.y) / 2 + ny * distPx;
  const extend = 5000 / App.mpp;
  const pp1 = { x: mx - ux * extend, y: my - uy * extend };
  const pp2 = { x: mx + ux * extend, y: my + uy * extend };

  saveState();
  App.items.push({
    id: App.nextId++, type: 'polyline',
    points: [pp1, pp2], color: '#94a3b8',
    label: '', value: null, labelPos: null,
    segLabels: [], segLabelPos: [],
    isParallel: true,
  });
  App.pts = [];
  // 次押したときの距離をボタンに表示
  const nextDist = unitDistM * (App.parallelCount + 1);
  document.getElementById('parallel-create').textContent = `作成 (次: ${nextDist}m)`;
  document.getElementById('parallel-create').disabled = false;
  App.dirty = true;
}

// ===== スナップ =====
function snapToLotVertex(cx, cy) {
  const threshold = 10 / App.vz;
  // 区画頂点
  for (const lot of App.lots) {
    if (!lot.points) continue;
    for (const p of lot.points) {
      if (Math.hypot(p.x - cx, p.y - cy) < threshold) return p;
    }
  }
  // 計測アイテム頂点（計測モードでも吸着）
  for (const item of App.items) {
    if (!item.points || item.isParallel) continue; // 平行線の端点（無限遠）は除外
    for (const p of item.points) {
      if (Math.hypot(p.x - cx, p.y - cy) < threshold) return p;
    }
  }
  // 均等分割ガイドの端点・等分点
  for (const g of (App.divGuides || [])) {
    const dx = g.p2.x - g.p1.x, dy = g.p2.y - g.p1.y;
    for (const pt of [g.p1, g.p2]) {
      if (Math.hypot(pt.x - cx, pt.y - cy) < threshold) return pt;
    }
    for (let i = 1; i < g.n; i++) {
      const px = g.p1.x + dx * i / g.n;
      const py = g.p1.y + dy * i / g.n;
      if (Math.hypot(px - cx, py - cy) < threshold) return { x: px, y: py };
    }
  }
  return null;
}

// 全セグメントを取得（交点計算用）。平行線など極端に長い線は除外。
function getAllSegments() {
  const segs = [];
  // 区画の辺
  App.lots.forEach(lot => {
    if (!lot.points || lot.points.length < 2) return;
    for (let i = 0; i < lot.points.length; i++) {
      segs.push([lot.points[i], lot.points[(i + 1) % lot.points.length]]);
    }
  });
  // 計測アイテム（平行線と極端に長い線は除外）
  App.items.forEach(item => {
    if (!item.points || item.points.length < 2) return;
    if (item.isParallel) return; // 平行線は無限長なので除外
    for (let i = 0; i < item.points.length - 1; i++) {
      const a = item.points[i], b = item.points[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      // 画面サイズの50倍以上の線分は除外（誤スナップ防止）
      const screenDiag = Math.hypot(canvas.width, canvas.height) / App.vz;
      if (segLen < screenDiag * 50) segs.push([a, b]);
    }
  });
  return segs;
}

// 2線分の交点（延長率 margin 倍まで許容）
function lineLineIntersect(a1, a2, b1, b2, margin) {
  const dx1 = a2.x - a1.x, dy1 = a2.y - a1.y;
  const dx2 = b2.x - b1.x, dy2 = b2.y - b1.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / denom;
  const u = ((b1.x - a1.x) * dy1 - (b1.y - a1.y) * dx1) / denom;
  const m = margin ?? 0.3; // 線分の30%延長まで交点を許容
  if (t < -m || t > 1 + m || u < -m || u > 1 + m) return null;
  return { x: a1.x + t * dx1, y: a1.y + t * dy1 };
}

// 交点スナップ
function snapToIntersection(cx, cy) {
  const threshold = 12 / App.vz;
  const segs = getAllSegments();
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const pt = lineLineIntersect(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
      if (pt && Math.hypot(pt.x - cx, pt.y - cy) < threshold) return pt;
    }
  }
  return null;
}

// 統一スナップ関数: { pt, type: 'vertex'|'intersection'|null }
// スナップON時も、頂点・交点に近い場合のみ吸着。それ以外はフリー。
function snapPoint(cx, cy) {
  if (!App.gridSnap) return { pt: { x: cx, y: cy }, type: null };
  const vSnap = snapToLotVertex(cx, cy);
  if (vSnap) return { pt: vSnap, type: 'vertex' };
  const iSnap = snapToIntersection(cx, cy);
  if (iSnap) return { pt: iSnap, type: 'intersection' };
  return { pt: { x: cx, y: cy }, type: null };
}

// ===== 隅切り: 選択区画ハイライト =====
function drawCornerCutHighlight() {
  const lot = App.lots.find(l => l.id === App.cornerCutLotId);
  if (!lot || !lot.points || lot.points.length < 3) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(lot.points[0].x, lot.points[0].y);
  lot.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 2.5 / App.vz;
  ctx.setLineDash([6 / App.vz, 4 / App.vz]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ===== 折れ線分割: プレビュー =====
function drawSplitPreview() {
  const pts = App.lotPts;
  const curPt = App.snapPt || { x: App.mx, y: App.my };

  // ターゲット区画をオレンジ枠でハイライト（Phase1/Phase2 両方）
  const targetLot = App.splitTargetId !== null ? App.lots.find(l => l.id === App.splitTargetId) : null;
  if (targetLot && targetLot.points && targetLot.points.length >= 3) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(targetLot.points[0].x, targetLot.points[0].y);
    targetLot.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 3 / App.vz;
    ctx.setLineDash([8 / App.vz, 4 / App.vz]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Phase1: ターゲット選択待ち → カーソル下のホバーヒント表示して終了
  if (!pts || pts.length === 0) {
    if (!targetLot) {
      // ホバー中の区画をグレー破線でヒント表示
      const hovered = App.lots.reduce((best, l) => {
        if (!l.points || l.points.length < 3) return best;
        if (!pointInPolygon(curPt.x, curPt.y, l.points)) return best;
        const a = shoelace(l.points);
        return (!best || a < shoelace(best.points)) ? l : best;
      }, null);
      if (hovered) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(hovered.points[0].x, hovered.points[0].y);
        hovered.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 2 / App.vz;
        ctx.setLineDash([4 / App.vz, 4 / App.vz]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
    return; // Phase1はここで終了
  }
  // Phase2: 分割線プレビュー（以下は既存ロジック）

  // 確定済み折れ線（赤実線）
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2 / App.vz;
  ctx.setLineDash([]);
  ctx.stroke();

  // マウスへの破線プレビュー
  ctx.beginPath();
  ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.lineTo(curPt.x, curPt.y);
  ctx.setLineDash([8 / App.vz, 4 / App.vz]);
  ctx.strokeStyle = '#ef4444';
  ctx.stroke();
  ctx.setLineDash([]);

  // 頂点ドット
  pts.forEach(p => drawDot(p.x, p.y, 2.4 / App.vz, '#ef4444'));
  // スナップインジケーター
  if (App.snapType) {
    const snapColors = { vertex: '#facc15', intersection: '#22d3ee', grid: '#4ade80' };
    drawSnapBox(curPt.x, curPt.y, snapColors[App.snapType]);
  }

  // 各辺の距離ラベル
  if (App.mpp) {
    const allPts = [...pts, curPt];
    const fsE = 9 / App.vz;
    ctx.font = `${fsE}px 'Segoe UI', sans-serif`;
    ctx.fillStyle = '#fca5a5';
    for (let i = 0; i < allPts.length - 1; i++) {
      const a = allPts[i], b = allPts[i + 1];
      const d = Math.hypot(b.x - a.x, b.y - a.y) * App.mpp;
      if (d < 0.01) continue;
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len * 10 / App.vz, ny = dx / len * 10 / App.vz;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.toFixed(2) + 'm', midX + nx, midY + ny);
    }
  }

  // 分割対象区画を赤枠で強調
  const previewLine = [...pts, curPt];
  if (App.lotTool === 'split-all') {
    // 一括分割: 交差する全区画を赤枠
    for (const lot of App.lots) {
      if (!lot.points || lot.points.length < 3) continue;
      if (polylineCrossesPolygon(previewLine, lot.points)) {
        ctx.beginPath();
        ctx.moveTo(lot.points[0].x, lot.points[0].y);
        lot.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2.5 / App.vz;
        ctx.setLineDash([]);
        ctx.stroke();
      }
    }
  } else if (targetLot && targetLot.points) {
    // 単独分割: ターゲット区画のみ
    if (polylineCrossesPolygon(previewLine, targetLot.points)) {
      ctx.beginPath();
      ctx.moveTo(targetLot.points[0].x, targetLot.points[0].y);
      targetLot.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.5 / App.vz;
      ctx.setLineDash([]);
      ctx.stroke();
    }
  }
}

// ===== 折れ線分割: 実行 =====

// 線分-線分 交点（両方ともセグメント内のみ）
function segSegIntersect(p1, p2, p3, p4) {
  const dx1 = p2.x - p1.x, dy1 = p2.y - p1.y;
  const dx2 = p4.x - p3.x, dy2 = p4.y - p3.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p3.x - p1.x) * dy2 - (p3.y - p1.y) * dx2) / denom;
  const u = ((p3.x - p1.x) * dy1 - (p3.y - p1.y) * dx1) / denom;
  if (t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1) {
    return { x: p1.x + t * dx1, y: p1.y + t * dy1, t, u };
  }
  return null;
}

function polylineCrossesPolygon(polyline, polyPts) {
  for (let si = 0; si < polyline.length - 1; si++) {
    for (let ei = 0; ei < polyPts.length; ei++) {
      if (segSegIntersect(polyline[si], polyline[si + 1], polyPts[ei], polyPts[(ei + 1) % polyPts.length])) return true;
    }
  }
  return false;
}

function splitPolygonByPolyline(polyPts, polyline) {
  const n = polyPts.length;
  // 全ての折れ線セグメント × 全てのポリゴン辺 の交点を収集
  const hits = [];
  for (let si = 0; si < polyline.length - 1; si++) {
    for (let ei = 0; ei < n; ei++) {
      const ej = (ei + 1) % n;
      const ip = segSegIntersect(polyline[si], polyline[si + 1], polyPts[ei], polyPts[ej]);
      if (ip) hits.push({ pt: { x: ip.x, y: ip.y }, segIdx: si, t: ip.t, edgeIdx: ei, u: ip.u });
    }
  }
  if (hits.length < 2) return null;
  // 折れ線沿いの順（segIdx → t）でソート
  hits.sort((a, b) => a.segIdx !== b.segIdx ? a.segIdx - b.segIdx : a.t - b.t);

  // 頂点ぴったりの場合、同一物理点への重複ヒットを除去（最初の1つを保持）
  const deduped = [hits[0]];
  for (let k = 1; k < hits.length; k++) {
    const prev = deduped[deduped.length - 1];
    const d = Math.hypot(hits[k].pt.x - prev.pt.x, hits[k].pt.y - prev.pt.y);
    if (d > 0.5) deduped.push(hits[k]);
  }
  if (deduped.length < 2) return null;

  const entry = deduped[0], exit = deduped[deduped.length - 1];

  // entry〜exit 間の折れ線内点列（カット境界）
  const cutPath = [entry.pt];
  for (let i = entry.segIdx + 1; i <= exit.segIdx; i++) cutPath.push(polyline[i]);
  cutPath.push(exit.pt);

  // ポリゴン1: entry → (境界を順方向) → exit → (cutPath逆)
  const poly1 = [{ ...entry.pt }];
  let i = (entry.edgeIdx + 1) % n;
  for (let s = 0; s < n && i !== (exit.edgeIdx + 1) % n; s++) {
    poly1.push({ ...polyPts[i] });
    i = (i + 1) % n;
  }
  poly1.push({ ...exit.pt });
  for (let j = cutPath.length - 2; j >= 1; j--) poly1.push({ ...cutPath[j] });

  // ポリゴン2: exit → (境界を順方向) → entry → (cutPath正)
  const poly2 = [{ ...exit.pt }];
  i = (exit.edgeIdx + 1) % n;
  for (let s = 0; s < n && i !== (entry.edgeIdx + 1) % n; s++) {
    poly2.push({ ...polyPts[i] });
    i = (i + 1) % n;
  }
  poly2.push({ ...entry.pt });
  for (let j = 1; j < cutPath.length - 1; j++) poly2.push({ ...cutPath[j] });

  // 連続する重複頂点を除去（頂点ぴったり分割後の後処理）
  const clean = pts => {
    const r = [pts[0]];
    for (let k = 1; k < pts.length; k++) {
      if (Math.hypot(pts[k].x - r[r.length-1].x, pts[k].y - r[r.length-1].y) > 0.5) r.push(pts[k]);
    }
    return r;
  };
  const c1 = clean(poly1), c2 = clean(poly2);
  if (c1.length < 3 || c2.length < 3) return null;
  return [c1, c2];
}

// 点から線分への最短距離
function ptSegDist(pt, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx*dx + dy*dy;
  if (len2 < 1e-9) return Math.hypot(pt.x - a.x, pt.y - a.y);
  const t = Math.max(0, Math.min(1, ((pt.x - a.x)*dx + (pt.y - a.y)*dy) / len2));
  return Math.hypot(pt.x - a.x - t*dx, pt.y - a.y - t*dy);
}

// ポリゴン境界への最近傍レイキャスト（fromPtから方向(ux,uy)に進んで最初に当たる境界点）
function findRayBoundaryHit(fromPt, ux, uy, polyPts) {
  const n = polyPts.length;
  let bestDist = Infinity, bestPt = null;
  for (let ei = 0; ei < n; ei++) {
    const ej = (ei + 1) % n;
    const p3 = polyPts[ei], p4 = polyPts[ej];
    const dx2 = p4.x - p3.x, dy2 = p4.y - p3.y;
    const denom = ux * dy2 - uy * dx2;
    if (Math.abs(denom) < 1e-9) continue;
    const t = ((p3.x - fromPt.x) * dy2 - (p3.y - fromPt.y) * dx2) / denom;
    const u = ((p3.x - fromPt.x) * ux - (p3.y - fromPt.y) * uy) / denom;
    if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9) {
      if (t < bestDist) { bestDist = t; bestPt = { x: fromPt.x + t * ux, y: fromPt.y + t * uy }; }
    }
  }
  return bestPt;
}

function extendPolylineEnds(pts, extPx) {
  if (pts.length < 2) return pts;
  const r = pts.map(p => ({ ...p }));
  const s = pts[0], s2 = pts[1];
  const d0 = Math.hypot(s2.x - s.x, s2.y - s.y) || 1;
  r[0] = { x: s.x - (s2.x - s.x) / d0 * extPx, y: s.y - (s2.y - s.y) / d0 * extPx };
  const e = pts[pts.length - 1], e2 = pts[pts.length - 2];
  const d1 = Math.hypot(e.x - e2.x, e.y - e2.y) || 1;
  r[r.length - 1] = { x: e.x + (e.x - e2.x) / d1 * extPx, y: e.y + (e.y - e2.y) / d1 * extPx };
  return r;
}

// 共線の中間頂点を除去（合筆後の辺を統合）
function removeCollinearPts(pts, eps = 0.5) {
  if (pts.length <= 3) return pts;
  const result = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length];
    const b = pts[i];
    const c = pts[(i + 1) % pts.length];
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    if (len < 0.001) continue;
    const d = Math.abs((c.x - a.x) * (a.y - b.y) - (a.x - b.x) * (c.y - a.y)) / len;
    if (d > eps) result.push(b);
  }
  return result.length >= 3 ? result : pts;
}

// 相手ポリゴンの頂点が自ポリゴンの辺上にある場合、その頂点を辺に挿入する
function enrichPolygon(pts, otherPts, eps = 3) {
  const result = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    result.push(a);
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.001) continue;
    const onEdge = [];
    for (const p of otherPts) {
      if (Math.hypot(p.x - a.x, p.y - a.y) < eps) continue;
      if (Math.hypot(p.x - b.x, p.y - b.y) < eps) continue;
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
      if (t <= 0 || t >= 1) continue;
      const perpDist = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / Math.sqrt(lenSq);
      if (perpDist < eps) onEdge.push({ p, t });
    }
    onEdge.sort((x, y) => x.t - y.t);
    onEdge.forEach(e => result.push({ ...e.p }));
  }
  return result;
}

// ===== 合筆 =====
function mergeAdjacentPolygons(pts1, pts2, eps = 3) {
  // 辺上の相手頂点を挿入して共有頂点を増やす
  pts1 = enrichPolygon(pts1, pts2, eps);
  pts2 = enrichPolygon(pts2, pts1, eps);
  const n1 = pts1.length, n2 = pts2.length;
  const ptEq = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < eps;
  const inPts2 = p => pts2.some(q => ptEq(p, q));
  const findInPts2 = p => pts2.findIndex(q => ptEq(p, q));

  // pts1 の各頂点が pts2 と共有されているか
  const shared = pts1.map(p => inPts2(p));
  const numShared = shared.filter(Boolean).length;
  if (numShared < 2 || numShared === n1) return null;

  // 共有→非共有 の境界を探す（共有ランの末尾）
  let startNonShared = -1;
  for (let i = 0; i < n1; i++) {
    if (shared[i] && !shared[(i + 1) % n1]) {
      startNonShared = (i + 1) % n1;
      break;
    }
  }
  if (startNonShared < 0) return null;

  // pts1 の非共有部分を収集
  const part1 = [];
  let i = startNonShared;
  while (!shared[i] && part1.length <= n1) {
    part1.push({ ...pts1[i] });
    i = (i + 1) % n1;
  }
  // 共有ラン（カットパス）を収集
  const cutPath = [];
  while (shared[i] && cutPath.length <= n1) {
    cutPath.push({ ...pts1[i] });
    i = (i + 1) % n1;
  }
  if (cutPath.length < 2) return null;

  // pts2 でカットパスの末尾→先頭に向けて非共有部分を収集
  const inCut = p => cutPath.some(q => ptEq(p, q));
  const startIn2 = findInPts2(cutPath[cutPath.length - 1]);
  const endIn2   = findInPts2(cutPath[0]);
  if (startIn2 < 0 || endIn2 < 0) return null;

  const collectPart2 = (dir) => {
    const r = [];
    let j = (startIn2 + dir + n2) % n2;
    for (let s = 0; s < n2; s++, j = (j + dir + n2) % n2) {
      if (j === endIn2) break;
      if (!inCut(pts2[j])) r.push({ ...pts2[j] });
    }
    return r;
  };
  const fwd = collectPart2(1);
  const bwd = collectPart2(-1);
  // どちらの方向が pts2 の非共有部分を含むかを選択
  const part2 = fwd.length >= bwd.length ? fwd : bwd;

  // マージポリゴン構築
  const merged = [
    cutPath[cutPath.length - 1], ...part1, cutPath[0], ...[...part2].reverse()
  ];
  // 連続重複点除去
  const result = [merged[0]];
  for (let k = 1; k < merged.length; k++) {
    if (Math.hypot(merged[k].x - result[result.length-1].x,
                   merged[k].y - result[result.length-1].y) > 0.3) {
      result.push(merged[k]);
    }
  }
  return result.length >= 3 ? result : null;
}

function applyCornerCut() {
  const lot = App.lots.find(l => l.id === App.cornerCutLotId);
  if (!lot || !lot.points || App.cornerCutIdx < 0) return;
  if (!App.mpp) { showToast('先に縮尺を設定してください', 3000); return; }

  const hypotM = parseFloat(document.getElementById('cut-hypotenuse').value) || 2;

  const pts = lot.points;
  const n = pts.length;
  const idx = App.cornerCutIdx;
  const prev = pts[(idx - 1 + n) % n];
  const cur  = pts[idx];
  const next = pts[(idx + 1) % n];

  // コーナーの実角度を計算
  const dx1 = prev.x - cur.x, dy1 = prev.y - cur.y;
  const dx2 = next.x - cur.x, dy2 = next.y - cur.y;
  const len1 = Math.hypot(dx1, dy1), len2 = Math.hypot(dx2, dy2);
  if (len1 < 1e-6 || len2 < 1e-6) return;
  const cosTheta = Math.max(-1, Math.min(1, (dx1*dx2 + dy1*dy2) / (len1 * len2)));
  const theta = Math.acos(cosTheta);
  const sinHalf = Math.sin(theta / 2);
  if (sinHalf < 1e-6) return;

  // 底辺=hypotM となる各辺への距離を計算 (二等辺三角形)
  const legM = hypotM / (2 * sinHalf);
  const legPx = legM / App.mpp;

  const ptA = { x: cur.x + dx1 / len1 * legPx, y: cur.y + dy1 / len1 * legPx };
  const ptB = { x: cur.x + dx2 / len2 * legPx, y: cur.y + dy2 / len2 * legPx };

  saveState();
  // 元の区画: cur頂点をptA→ptBに置き換え
  lot.points = [...pts.slice(0, idx), ptA, ptB, ...pts.slice(idx + 1)];
  // 切り取った三角形（隅切り）：ラベルなし・道路扱い
  App.lots.push({
    id: App.nextId++,
    type: 'road',
    lotNum: 0,
    points: [{ ...ptA }, { ...cur }, { ...ptB }],
    roadLabel: '',
    color: '#cbd5e1',
  });
  App.cornerCutLotId = null;
  App.cornerCutIdx = -1;
  updateLotPanel();
  App.dirty = true;
}

function commitMerge() {
  if (App.mergeSelect.length < 2) return;
  const [id1, id2] = App.mergeSelect;
  const lot1 = App.lots.find(l => l.id === id1);
  const lot2 = App.lots.find(l => l.id === id2);
  if (!lot1 || !lot2 || !lot1.points || !lot2.points) {
    App.mergeSelect = [];
    return;
  }
  const rawMerged = mergeAdjacentPolygons(lot1.points, lot2.points, 3)
                 || mergeAdjacentPolygons(lot2.points, lot1.points, 3)
                 || mergeAdjacentPolygons(lot1.points, lot2.points, 6)
                 || mergeAdjacentPolygons(lot2.points, lot1.points, 6);
  const merged = rawMerged ? removeCollinearPts(rawMerged) : null;
  if (!merged) {
    // 隣接していない場合は選択リセット＋エラー表示
    App.mergeSelect = [];
    App.dirty = true;
    const ht = document.getElementById('hint-text');
    if (ht) { ht.textContent = '⚠ 共有辺が検出できません。隣接する区画を選んでください'; ht.style.color = '#f87171'; setTimeout(() => { ht.textContent = ''; ht.style.color = ''; }, 3000); }
    return;
  }
  saveState();
  // 区画(lot)を優先、どちらも同じtypeなら先に選んだ方(lot1)をベースにする
  const baseLot = (lot1.type === 'lot' && lot2.type !== 'lot') ? lot1
                : (lot2.type === 'lot' && lot1.type !== 'lot') ? lot2
                : lot1;
  const otherLot = baseLot === lot1 ? lot2 : lot1;
  const newLotNum = baseLot.type === 'lot' ? (baseLot.lotNum || otherLot.lotNum || 1)
                  : Math.min(lot1.lotNum ?? 999, lot2.lotNum ?? 999);
  const newLot = {
    ...baseLot,
    points: merged,
    lotNum: newLotNum,
    type: 'lot',
  };
  App.lots = App.lots.filter(l => l.id !== id1 && l.id !== id2);
  App.lots.push(newLot);
  App.mergeSelect = [];
  updateLotPanel();
  render(); // 即時リフレッシュ（残像防止）
  App.dirty = false;
}

function splitAllLotsByPolyline(polyline, splitAll = false) {
  saveState();

  // 一括分割モードはターゲット選択スキップ
  if (splitAll) { App.splitTargetId = null; }

  // 対象区画を確定: 明示セットされていなければ始点・中点から検索
  let targetId = App.splitTargetId;
  App.splitTargetId = null;
  if (targetId === null) {
    const candidates = [polyline[0], polyline[Math.floor(polyline.length / 2)]];
    for (const pt of candidates) {
      let smallest = null, smallestArea = Infinity;
      for (const l of App.lots) {
        if (l.points && l.points.length >= 3 && pointInPolygon(pt.x, pt.y, l.points)) {
          const area = shoelace(l.points);
          if (area < smallestArea) { smallestArea = area; smallest = l; }
        }
      }
      if (smallest) { targetId = smallest.id; break; }
    }
  }
  // 最終フォールバック: ポリラインが交差している最小の区画
  if (targetId === null) {
    let smallest = null, smallestArea = Infinity;
    for (const l of App.lots) {
      if (l.points && l.points.length >= 3 && polylineCrossesPolygon(polyline, l.points)) {
        const area = shoelace(l.points);
        if (area < smallestArea) { smallestArea = area; smallest = l; }
      }
    }
    if (smallest) targetId = smallest.id;
  }
  // 対象が確定できなければ何もしない（単独分割モードのみ）
  if (!splitAll && targetId === null) { return; }

  // まず全区画の分割結果を検証してから反映（途中でエラーなら全件キャンセル）
  const splitPlan = []; // { lot, pts1, pts2 } or { lot, keep:true }
  for (const lot of App.lots) {
    if (!lot.points || lot.points.length < 3) { splitPlan.push({ lot, keep: true }); continue; }
    if (!splitAll && lot.id !== targetId) { splitPlan.push({ lot, keep: true }); continue; }
    if (splitAll && !polylineCrossesPolygon(polyline, lot.points)) { splitPlan.push({ lot, keep: true }); continue; }

    const pn = polyline.length;
    const s = polyline[0], s2 = polyline[1];
    const d0 = Math.hypot(s2.x - s.x, s2.y - s.y) || 1;
    const ux = (s2.x - s.x) / d0, uy = (s2.y - s.y) / d0;
    const e = polyline[pn-1], e2 = polyline[pn-2];
    const d1 = Math.hypot(e.x - e2.x, e.y - e2.y) || 1;
    const uxe = (e.x - e2.x) / d1, uye = (e.y - e2.y) / d1;
    const extTiny = 4;

    const r = polyline.map(p => ({ ...p }));
    if (pointInPolygon(s.x, s.y, lot.points)) {
      const hit = findRayBoundaryHit(s, -ux, -uy, lot.points);
      r[0] = hit ? { x: hit.x - ux * extTiny, y: hit.y - uy * extTiny }
                 : { x: s.x - ux * 200, y: s.y - uy * 200 };
    } else {
      r[0] = { x: s.x - ux * extTiny, y: s.y - uy * extTiny };
    }
    if (pointInPolygon(e.x, e.y, lot.points)) {
      const hit = findRayBoundaryHit(e, uxe, uye, lot.points);
      r[pn-1] = hit ? { x: hit.x + uxe * extTiny, y: hit.y + uye * extTiny }
                    : { x: e.x + uxe * 200, y: e.y + uye * 200 };
    } else {
      r[pn-1] = { x: e.x + uxe * extTiny, y: e.y + uye * extTiny };
    }

    const result = splitPolygonByPolyline(lot.points, r);
    if (!result) { splitPlan.push({ lot, keep: true }); continue; }
    const [pts1, pts2] = result;

    // 分割結果が自己交差していたらエラーで全件キャンセル
    if (!isSimplePolygon(pts1) || !isSimplePolygon(pts2)) {
      undoLast();
      showToast('分割線を区画の端から端まで通してください。現在の線では正しい形状に分割できません。', 5000);
      return;
    }
    splitPlan.push({ lot, pts1, pts2 });
  }

  // 検証OK → 反映
  const newLots = [];
  let splitHappened = false;
  for (const entry of splitPlan) {
    if (entry.keep) { newLots.push(entry.lot); continue; }
    splitHappened = true;
    newLots.push({ ...entry.lot, points: entry.pts1 });
    newLots.push({
      ...entry.lot,
      id: App.nextId++,
      points: entry.pts2,
      lotNum: entry.lot.type === 'lot' ? App.lotNextNum++ : entry.lot.lotNum,
    });
  }
  if (splitHappened) { App.lots = newLots; updateLotPanel(); }
  App.dirty = true;
}

// ポリゴンが自己交差していないか確認（単純ポリゴンかどうか）
function isSimplePolygon(pts) {
  const n = pts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i], a2 = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // 隣接辺はスキップ
      const b1 = pts[j], b2 = pts[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

function segmentsIntersect(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return false;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

// 区画リスト（右パネル）更新
function updateLotPanel() {
  const panel = document.getElementById('lots-panel');
  const emptyEl = document.getElementById('lots-empty');
  const summary = document.getElementById('lot-summary');
  if (!panel) return;

  const lots = App.lots.filter(l => l.type === 'lot');
  const roads = App.lots.filter(l => l.type === 'road');

  if (App.lots.length === 0) {
    panel.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    if (summary) summary.textContent = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const hasMpp = !!App.mpp;

  // 区画テーブル
  let lotSqmTotal = 0;
  let priceTotal = 0;
  let hasPrice = false;

  let rows = lots.map(lot => {
    const sqm = (hasMpp && lot.points && lot.points.length >= 3)
      ? shoelace(lot.points) * App.mpp * App.mpp : null;
    if (sqm) lotSqmTotal += sqm;
    const tsubo = sqm ? (sqm / 3.30579).toFixed(1) : null;
    const sqmStr = sqm ? sqm.toFixed(1) : '-';
    const tsuboStr = tsubo || '-';
    const priceNum = lot.price ? parseInt(lot.price.replace(/[^0-9]/g, '')) : NaN;
    if (!isNaN(priceNum)) { priceTotal += priceNum; hasPrice = true; }
    const priceStr = !isNaN(priceNum) ? priceNum.toLocaleString() : '';
    const memo = lot.memo ? `<div class="lot-memo">${escapeHtmlText(lot.memo)}</div>` : '';
    return `<tr class="lot-data-row" data-id="${lot.id}">
      <td class="lp-num"><span class="lot-num-badge">${circleNum(lot.lotNum)}</span></td>
      <td class="lp-sqm">${sqmStr}</td>
      <td class="lp-tsubo">${tsuboStr}</td>
      <td class="lp-price">${priceStr}</td>
      <td class="lp-actions">
        <button class="btn-lot-edit" data-id="${lot.id}" title="区画の詳細を編集" aria-label="区画の詳細を編集">✏</button>
        <button class="btn-lot-delete" data-id="${lot.id}" title="区画全体を削除" aria-label="区画全体を削除">✕</button>
      </td>
    </tr>${memo ? `<tr><td colspan="5" style="padding:0 4px 4px">${memo}</td></tr>` : ''}`;
  }).join('');

  // 区画計行
  const lotTsuboTotal = hasMpp ? (lotSqmTotal / 3.30579).toFixed(1) : '-';
  rows += `<tr class="lp-subtotal">
    <td>区画計</td>
    <td>${hasMpp ? lotSqmTotal.toFixed(1) : '-'}</td>
    <td>${hasMpp ? lotTsuboTotal : '-'}</td>
    <td>${hasPrice ? priceTotal.toLocaleString() : ''}</td>
    <td></td>
  </tr>`;

  // 道路行
  let roadSqmTotal = 0;
  if (roads.length > 0) {
    rows += roads.map(r => {
      const sqm = (hasMpp && r.points && r.points.length >= 3)
        ? shoelace(r.points) * App.mpp * App.mpp : null;
      if (sqm) roadSqmTotal += sqm;
      const tsubo = sqm ? (sqm / 3.30579).toFixed(1) : null;
      const rawLabel = r.lotNum === 0
        ? '隅切'
        : ((r.roadLabel || '道路').split('\n')[0].trim() || '道路');
      const label = escapeHtmlText(rawLabel);
      const editButton = r.lotNum === 0 ? ''
        : `<button class="btn-lot-edit" data-id="${r.id}" title="道路の詳細を編集" aria-label="道路の詳細を編集">✏</button>`;
      return `<tr class="lp-road-row" data-id="${r.id}">
        <td><span class="lot-num-badge" style="background:#1e293b;color:#64748b;border-color:#334155">${label}</span></td>
        <td>${sqm ? sqm.toFixed(1) : '-'}</td>
        <td>${tsubo || '-'}</td>
        <td></td>
        <td>${editButton}<button class="btn-lot-delete" data-id="${r.id}" title="${label}全体を削除" aria-label="${label}全体を削除">✕</button></td>
      </tr>`;
    }).join('');

    if (hasMpp && roadSqmTotal > 0) {
      rows += `<tr class="lp-subtotal lp-road-row">
        <td>道路計</td>
        <td>${roadSqmTotal.toFixed(1)}</td>
        <td>${(roadSqmTotal / 3.30579).toFixed(1)}</td>
        <td></td><td></td>
      </tr>`;
    }
  }

  // 全体計行
  if (hasMpp && (lotSqmTotal > 0 || roadSqmTotal > 0)) {
    const grandTotal = lotSqmTotal + roadSqmTotal;
    rows += `<tr class="lp-grand-total">
      <td>全体計</td>
      <td>${grandTotal.toFixed(1)}</td>
      <td>${(grandTotal / 3.30579).toFixed(1)}</td>
      <td>${hasPrice ? priceTotal.toLocaleString() : ''}</td>
      <td></td>
    </tr>`;
  }

  panel.innerHTML = `<table class="lot-table">
    <thead><tr>
      <th>区画</th><th>㎡</th><th>坪</th><th>万円</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  if (summary) summary.innerHTML = '';

  panel.querySelectorAll('.btn-lot-edit').forEach(btn => {
    btn.addEventListener('click', () => openLotEditor(parseInt(btn.dataset.id)));
  });
  panel.querySelectorAll('.btn-lot-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      saveState();
      App.lots = App.lots.filter(l => l.id !== parseInt(btn.dataset.id));
      reconcileSelectionState();
      updateLotPanel(); App.dirty = true;
    });
  });
}

// 区画編集モーダル
let _editingLotId = null;
let _editingLotKind = 'lot';
let _lotEditSession = null;
let _lotEditModalUserMoved = false;

function clampLotEditModalPosition(card, left, top) {
  const pad = 12;
  const w = card.offsetWidth || 400;
  const h = card.offsetHeight || 520;
  return {
    left: Math.max(pad, Math.min(left, window.innerWidth - w - pad)),
    top: Math.max(pad, Math.min(top, window.innerHeight - h - pad)),
  };
}

function setLotEditModalPosition(left, top) {
  const card = document.querySelector('#lot-edit-modal .lot-edit-modal-card');
  if (!card) return;
  const pos = clampLotEditModalPosition(card, left, top);
  card.style.left = pos.left + 'px';
  card.style.top = pos.top + 'px';
}

function positionLotEditModalDefault() {
  const card = document.querySelector('#lot-edit-modal .lot-edit-modal-card');
  if (!card) return;

  if (_lotEditModalUserMoved && card.style.left && card.style.top) {
    setLotEditModalPosition(parseFloat(card.style.left), parseFloat(card.style.top));
    return;
  }

  const toolbar = document.getElementById('toolbar');
  const rightPanel = document.getElementById('results');
  const topBase = toolbar ? toolbar.getBoundingClientRect().bottom + 24 : 72;
  const rightW = rightPanel && !rightPanel.classList.contains('collapsed')
    ? rightPanel.getBoundingClientRect().width
    : 0;
  const cardW = card.offsetWidth || 400;
  const left = window.innerWidth - rightW - cardW - 28;
  setLotEditModalPosition(left, topBase);
}

function setupLotEditModalDrag() {
  const card = document.querySelector('#lot-edit-modal .lot-edit-modal-card');
  const handle = document.getElementById('lot-edit-titlebar') || document.getElementById('lot-edit-title');
  if (!card || !handle) return;

  let dragging = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('.modal-titlebar-close')) return;
    dragging = true;
    _lotEditModalUserMoved = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = parseFloat(card.style.left || card.getBoundingClientRect().left);
    startTop = parseFloat(card.style.top || card.getBoundingClientRect().top);
    handle.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    setLotEditModalPosition(startLeft + e.clientX - startX, startTop + e.clientY - startY);
  });

  const stopDrag = e => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture?.(e.pointerId);
  };
  handle.addEventListener('pointerup', stopDrag);
  handle.addEventListener('pointercancel', stopDrag);
  window.addEventListener('resize', () => {
    if (card.style.left && card.style.top) {
      setLotEditModalPosition(parseFloat(card.style.left), parseFloat(card.style.top));
    }
  });
}

function syncRoadEditPreview() {
  const lot = App.lots.find(l => l.id === _editingLotId);
  if (!lot || _editingLotKind !== 'road') return;

  lot.roadLabel = document.getElementById('lot-edit-road-label')?.value ?? '道路';
  lot.roadVertical = !!document.getElementById('lot-edit-road-vertical')?.checked;
  lot.roadWidth = parseFloat(document.getElementById('lot-edit-road-width')?.value) || null;
  lot.roadLabelSize = parseFloat(document.getElementById('lot-edit-road-title-size')?.value) || 1.0;
  lot.roadWidthLabelSize = parseFloat(document.getElementById('lot-edit-road-width-size')?.value) || lot.roadLabelSize;
  lot.roadLabelRotation = Math.max(-180, Math.min(180,
    parseFloat(document.getElementById('lot-edit-road-rotation')?.value) || 0));

  const selTc = document.querySelector('.road-text-swatch.active-road-text');
  if (selTc) lot.roadLabelColor = selTc.dataset.tc;
  const selWtc = document.querySelector('.road-width-text-swatch.active-road-width-text');
  if (selWtc) {
    if (selWtc.dataset.wtc) lot.roadWidthLabelColor = selWtc.dataset.wtc;
    else delete lot.roadWidthLabelColor;
  }
  const selFc = document.querySelector('.road-fill-swatch.active-road-fill');
  if (selFc) {
    lot.color = selFc.dataset.fc;
    if (document.getElementById('lot-edit-road-section')?.dataset.styleChanged === '1') {
      const style = roadVisualStyle(lot.color);
      lot.borderColor = style.borderColor;
      lot.fillOpacity = style.fillOpacity;
    }
  }

  App.dirty = true;
}

function syncLotEditPreview() {
  const lot = App.lots.find(l => l.id === _editingLotId);
  if (!lot || _editingLotKind === 'road') return;

  const customArea = document.getElementById('lot-edit-area-label')?.value.trim() || '';
  const customTsubo = document.getElementById('lot-edit-tsubo-label')?.value.trim() || '';
  lot.customAreaLabel = customArea === '' ? null : customArea;
  lot.customTsuboLabel = customTsubo === '' ? null : customTsubo;

  const rawPrice = document.getElementById('lot-edit-price')?.value.replace(/[^0-9]/g, '') || '';
  lot.price = rawPrice ? Number(rawPrice).toLocaleString() + '万円' : '';
  lot.memo = document.getElementById('lot-edit-memo')?.value.trim() || '';
  lot.topLabel = document.getElementById('lot-edit-top-label')?.value.trim() || null;

  const sel = document.querySelector('#lot-color-swatches .color-swatch.active-swatch');
  if (sel) lot.color = sel.dataset.lotcolor;
  const fillOpacityInput = document.getElementById('lot-edit-fill-opacity');
  if (fillOpacityInput?.dataset.custom === '1') {
    lot.fillOpacity = (parseInt(fillOpacityInput.value) || 0) / 100;
  }
  const selB = document.querySelector('#lot-border-swatches .border-swatch.active-border');
  if (selB) lot.borderColor = selB.dataset.bc;
  const selLtc = document.querySelector('#lot-label-color-swatches .lotlabel-color-swatch.active-lotlabel-color');
  if (selLtc) lot.labelTextColor = selLtc.dataset.ltc || null;
  const selElc = document.querySelector('#lot-edgelabel-color-swatches .edgelabel-color-swatch.active-edgelabel-color');
  if (selElc) lot.edgeLabelColor = selElc.dataset.elc;

  const textScale = parseFloat(document.getElementById('modal-lot-text-scale')?.value) || 1.0;
  const edgeScale = parseFloat(document.getElementById('modal-lot-edge-scale')?.value) || 1.0;
  lot.labelScale = textScale;
  lot.edgeScale = edgeScale;
  syncLotCenterColorControls(lot);
  App.dirty = true;
}

function loadRoadEditFields(lot) {
  document.getElementById('lot-edit-road-label').value = lot.roadLabel !== undefined ? lot.roadLabel : '道路';
  document.getElementById('lot-edit-road-vertical').checked = !!lot.roadVertical;
  document.getElementById('lot-edit-road-width').value = lot.roadWidth || '';
  const titleSize = parseFloat(lot.roadLabelSize) || 1.0;
  const widthSize = parseFloat(lot.roadWidthLabelSize) || titleSize;
  document.getElementById('lot-edit-road-title-size').value = titleSize;
  document.getElementById('lot-edit-road-title-size-val').textContent = titleSize.toFixed(1) + '×';
  document.getElementById('lot-edit-road-width-size').value = widthSize;
  document.getElementById('lot-edit-road-width-size-val').textContent = widthSize.toFixed(1) + '×';
  const rotation = Math.max(-180, Math.min(180, parseFloat(lot.roadLabelRotation) || 0));
  document.getElementById('lot-edit-road-rotation').value = rotation;
  document.getElementById('lot-edit-road-rotation-num').value = rotation;
  const tc = lot.roadLabelColor || '#475569';
  document.querySelectorAll('.road-text-swatch').forEach(s => {
    s.classList.toggle('active-road-text', s.dataset.tc === tc);
      s.style.border = s.dataset.tc === tc ? '2px solid #60a5fa' : (s.dataset.tc === '#f1f5f9' || s.dataset.tc === '#e2e8f0' ? '2px solid #475569' : '2px solid transparent');
  });
  const widthColor = lot.roadWidthLabelColor || '';
  document.querySelectorAll('.road-width-text-swatch').forEach(s => {
    s.classList.toggle('active-road-width-text', s.dataset.wtc === widthColor);
  });
  const roadColors = [...document.querySelectorAll('.road-fill-swatch')].map(s => s.dataset.fc);
  const fc = roadColors.includes(lot.color) ? lot.color : null;
  document.querySelectorAll('.road-fill-swatch').forEach(s => {
    s.classList.toggle('active-road-fill', s.dataset.fc === fc);
    const isLight = ['#e2e8f0', '#f8fafc', '#cbd5e1'].includes(s.dataset.fc);
    s.style.border = s.dataset.fc === fc ? '2px solid #60a5fa' : (isLight ? '2px solid #94a3b8' : '2px solid transparent');
  });
}

function syncLotCenterColorControls(lot) {
  if (!lot) return;
  const values = {
    area: lot.customAreaLabelColor || '',
    tsubo: lot.customTsuboLabelColor || '',
  };
  document.querySelectorAll('.lot-center-color-palette').forEach(palette => {
    const value = values[palette.dataset.centerField] ?? '';
    palette.querySelectorAll('.lot-center-color-swatch').forEach(button => {
      button.classList.toggle('is-active', button.dataset.color === value);
    });
  });
}

function loadLotEditFields(lot) {
  const sqm = (App.mpp && lot.points && lot.points.length >= 3)
    ? (shoelace(lot.points) * App.mpp * App.mpp).toFixed(1) : null;
  const tsubo = sqm ? (parseFloat(sqm) * 0.3025).toFixed(1) : null;
  const areaEl = document.getElementById('lot-edit-area');
  if (areaEl) areaEl.textContent = sqm ? `計算値: ${sqm}㎡ / ${tsubo}坪` : '縮尺未設定';
  const areaInput = document.getElementById('lot-edit-area-label');
  const tsuboInput = document.getElementById('lot-edit-tsubo-label');
  if (areaInput) {
    areaInput.value = lot.customAreaLabel != null ? lot.customAreaLabel : '';
    areaInput.placeholder = sqm ? `${sqm}㎡` : '計算値なし';
  }
  if (tsuboInput) {
    tsuboInput.value = lot.customTsuboLabel != null ? lot.customTsuboLabel : '';
    tsuboInput.placeholder = tsubo ? `${tsubo}坪` : '計算値なし';
  }
  syncLotCenterColorControls(lot);
  const priceNum = lot.price ? lot.price.replace(/[^0-9]/g, '') : '';
  document.getElementById('lot-edit-price').value = priceNum ? Number(priceNum).toLocaleString() : '';
  document.getElementById('lot-edit-memo').value = lot.memo || '';
  document.getElementById('lot-edit-top-label').value = lot.topLabel || '';
  const lotColors = [...document.querySelectorAll('#lot-color-swatches .color-swatch')].map(sw => sw.dataset.lotcolor);
  const lotColor = lotColors.includes(lot.color) ? lot.color : null;
  document.querySelectorAll('#lot-color-swatches .color-swatch').forEach(sw => {
    sw.classList.toggle('active-swatch', sw.dataset.lotcolor === lotColor);
  });
  const fillOpacity = Math.round((lot.fillOpacity ?? App.lotFillOpacity ?? 0.73) * 100);
  const fillOpacityInput = document.getElementById('lot-edit-fill-opacity');
  const fillOpacityVal = document.getElementById('lot-edit-fill-opacity-val');
  if (fillOpacityInput) {
    fillOpacityInput.value = fillOpacity;
    fillOpacityInput.dataset.custom = lot.fillOpacity != null ? '1' : '0';
  }
  if (fillOpacityVal) fillOpacityVal.textContent = fillOpacity + '%';
  const bc = lot.borderColor || App.lotBorderColor || '#1d4ed8';
  document.querySelectorAll('#lot-border-swatches .border-swatch').forEach(sw => {
    const isSel = sw.dataset.bc === bc;
    sw.style.outline = isSel ? '2px solid #60a5fa' : 'none';
    sw.classList.toggle('active-border', isSel);
  });
  const ltc = lot.labelTextColor || '';
  document.querySelectorAll('#lot-label-color-swatches .lotlabel-color-swatch').forEach(sw => {
    const isSel = sw.dataset.ltc === ltc;
    sw.style.outline = isSel ? '2px solid #60a5fa' : 'none';
    sw.classList.toggle('active-lotlabel-color', isSel);
  });
  const elc = lot.edgeLabelColor || '#334155';
  document.querySelectorAll('#lot-edgelabel-color-swatches .edgelabel-color-swatch').forEach(sw => {
    const isSel = sw.dataset.elc === elc;
    sw.style.outline = isSel ? '2px solid #60a5fa' : 'none';
    sw.classList.toggle('active-edgelabel-color', isSel);
  });
  [['lot-num-disp-group', lot.hideNumber || ''],
   ['lot-edge-disp-group', lot.edgeDisplay || ''],
   ['lot-area-disp-group', lot.areaDisplay || ''],
   ['lot-yaku-disp-group', lot.yakuMode || '']].forEach(([groupId, val]) => {
    document.querySelectorAll(`#${groupId} .lot-disp-btn`).forEach(btn => {
      btn.classList.toggle('active-disp', btn.dataset.val === val);
    });
  });
  const lotTextScale = parseFloat(lot.labelScale) || App.lotTextScale || 1.0;
  const lotEdgeScale = parseFloat(lot.edgeScale) || App.lotEdgeScale || 1.0;
  const mls = document.getElementById('modal-lot-text-scale');
  const mes = document.getElementById('modal-lot-edge-scale');
  if (mls) mls.value = lotTextScale;
  if (mes) mes.value = lotEdgeScale;
  const mlv = document.getElementById('modal-lot-text-scale-val');
  const mev = document.getElementById('modal-lot-edge-scale-val');
  if (mlv) mlv.textContent = lotTextScale.toFixed(1) + '×';
  if (mev) mev.textContent = lotEdgeScale.toFixed(1) + '×';
}

function setLotEditType(type) {
  if (!_lotEditSession || !['lot', 'road'].includes(type)) return;
  const lot = App.lots.find(l => l.id === _editingLotId);
  if (!lot) return;
  const typeChanged = _editingLotKind !== type;
  if (_editingLotKind === 'road') syncRoadEditPreview();
  else syncLotEditPreview();
  _editingLotKind = type;
  _lotEditSession.draftType = type;
  lot.type = type;
  if (typeChanged && type === 'road') {
    lot.color = '#cbd5e1';
    lot.borderColor = '#596777';
    lot.fillOpacity = 0.48;
    lot.roadLabel = lot.roadLabel || '道路';
  } else if (typeChanged && type === 'lot') {
    lot.color = '#fff0bd';
    lot.borderColor = '#a46a08';
    lot.fillOpacity = 0.58;
  }
  if (type === 'lot' && (!lot.lotNum || lot.lotNum < 1)) lot.lotNum = App.lotNextNum;
  document.getElementById('lot-edit-kind-title').textContent = type === 'road' ? '道路' : '区画';
  document.getElementById('lot-edit-num').textContent = type === 'road' ? '' : circleNum(lot.lotNum);
  document.getElementById('lot-edit-lot-sections').classList.toggle('hidden', type === 'road');
  document.getElementById('lot-edit-road-section').classList.toggle('hidden', type !== 'road');
  document.getElementById('lot-edit-lot-scale-controls')?.classList.toggle('hidden', type === 'road');
  document.querySelectorAll('#lot-edit-kind-switch .next-editor-kind-button').forEach(btn => {
    const active = btn.dataset.kind === type;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  if (type === 'road') {
    if (typeChanged) loadRoadEditFields(lot);
    syncRoadEditPreview();
  } else {
    if (typeChanged) loadLotEditFields(lot);
    syncLotEditPreview();
  }
  App.dirty = true;
}

function cancelLotEdit() {
  if (_lotEditSession) {
    const index = App.lots.findIndex(l => l.id === _lotEditSession.id);
    if (index >= 0) App.lots[index] = JSON.parse(JSON.stringify(_lotEditSession.original));
    App.lotNextNum = _lotEditSession.originalLotNextNum;
  }
  _editingLotId = null;
  _lotEditSession = null;
  document.getElementById('lot-edit-modal')?.classList.add('hidden');
  reconcileSelectionState();
  updateLotPanel();
  App.dirty = true;
}

function openLotEditor(id) {
  const lot = App.lots.find(l => l.id === id);
  if (!lot) return;
  if (lot.type === 'road' && lot.lotNum === 0) {
    activateUniversalSelectionTool();
    showToast('隅切りは道路の詳細編集対象ではありません。移動・削除または頂点編集を使ってください。', 3500);
    return;
  }
  _editingLotId = id;
  _editingLotKind = lot.type === 'road' ? 'road' : 'lot';
  _lotEditSession = {
    id,
    original: JSON.parse(JSON.stringify(lot)),
    originalLotNextNum: App.lotNextNum,
    historyState: captureHistoryState(),
    draftType: _editingLotKind,
  };
  const roadSection = document.getElementById('lot-edit-road-section');
  if (roadSection) delete roadSection.dataset.styleChanged;
  updateLotEditGlobalDisplayControls();
  loadRoadEditFields(lot);
  loadLotEditFields(lot);
  setLotEditType(_editingLotKind);
  document.getElementById('lot-edit-modal').classList.remove('hidden');
}

// 区画番号を振り直し
function renumberLots() {
  saveState();
  let n = 1;
  App.lots.filter(l => l.type === 'lot').forEach(l => { l.lotNum = n++; });
  App.lotNextNum = n;
  updateLotPanel();
  App.dirty = true;
}

// 面積リストをキャンバス左上付近にテーブルとして配置
function stampLotList() {
  const lots = App.lots.filter(l => l.type === 'lot');
  if (lots.length === 0) { showToast('面積表にできる区画がありません', 3000); return; }

  const cx = (24 - App.vx) / App.vz;
  const cy = (80 - App.vy) / App.vz;
  saveState();

  let totalSqm = 0;
  let totalPrice = 0;
  let hasPrice = false;
  const rows = lots.map(lot => {
    const sqm = (App.mpp && lot.points && lot.points.length >= 3)
      ? shoelace(lot.points) * App.mpp * App.mpp : null;
    if (sqm) totalSqm += sqm;
    const tsubo = sqm ? (sqm / 3.30579).toFixed(1) : '-';
    const sqmStr = sqm ? sqm.toFixed(1) : '-';
    const priceNum = lot.price ? parseInt(lot.price.replace(/[^0-9]/g, '')) : NaN;
    if (!isNaN(priceNum)) { totalPrice += priceNum; hasPrice = true; }
    const priceStr = !isNaN(priceNum) ? priceNum.toLocaleString() : '';
    return [circleNum(lot.lotNum), sqmStr, tsubo, priceStr];
  });

  const totalRow = [
    '合計',
    totalSqm > 0 ? totalSqm.toFixed(1) : '-',
    totalSqm > 0 ? (totalSqm / 3.30579).toFixed(1) : '-',
    hasPrice ? totalPrice.toLocaleString() : '',
  ];

  App.texts.push({
    id: App.nextId++,
    x: cx, y: cy,
    textType: 'lot-table',
    rows,
    totalRow,
    headers: ['区画', '㎡', '坪', '万円'],
    fontSize: 11,
    color: '#1a1a1a',
    bgColor: 'rgba(255,255,255,0.95)',
  });
  App.dirty = true;
  showToast('面積表を図面に配置しました。選択・移動で位置を調整できます。', 4000);
}

function commitLotEdit() {
  const lot = App.lots.find(l => l.id === _editingLotId);
  const session = _lotEditSession;
  if (!lot || !session) { document.getElementById('lot-edit-modal').classList.add('hidden'); return; }
  const typeChanged = session.original.type !== _editingLotKind;
  lot.type = _editingLotKind;
  if (_editingLotKind === 'lot' && session.original.type === 'road') {
    lot.lotNum = App.lotNextNum++;
  }
  if (_editingLotKind === 'road') {
    lot.roadLabel       = document.getElementById('lot-edit-road-label').value;
    lot.roadVertical    = document.getElementById('lot-edit-road-vertical').checked;
    lot.roadWidth       = parseFloat(document.getElementById('lot-edit-road-width').value) || null;
    lot.roadLabelSize = parseFloat(document.getElementById('lot-edit-road-title-size').value) || 1.0;
    lot.roadWidthLabelSize = parseFloat(document.getElementById('lot-edit-road-width-size').value) || lot.roadLabelSize;
    lot.roadLabelRotation = Math.max(-180, Math.min(180,
      parseFloat(document.getElementById('lot-edit-road-rotation')?.value) || 0));
    const selTc = document.querySelector('.road-text-swatch.active-road-text');
    if (selTc) lot.roadLabelColor = selTc.dataset.tc;
    const selWtc = document.querySelector('.road-width-text-swatch.active-road-width-text');
    if (selWtc) {
      if (selWtc.dataset.wtc) lot.roadWidthLabelColor = selWtc.dataset.wtc;
      else delete lot.roadWidthLabelColor;
    }
    const selFc = document.querySelector('.road-fill-swatch.active-road-fill');
    if (selFc) {
      lot.color = selFc.dataset.fc;
      if (document.getElementById('lot-edit-road-section')?.dataset.styleChanged === '1') {
        const style = roadVisualStyle(lot.color);
        lot.borderColor = style.borderColor;
        lot.fillOpacity = style.fillOpacity;
      }
    }
  } else {
    const customArea = document.getElementById('lot-edit-area-label')?.value.trim() || '';
    const customTsubo = document.getElementById('lot-edit-tsubo-label')?.value.trim() || '';
    lot.customAreaLabel = customArea === '' ? null : customArea;
    lot.customTsuboLabel = customTsubo === '' ? null : customTsubo;
    const rawPrice = document.getElementById('lot-edit-price').value.replace(/[^0-9]/g, '');
    lot.price    = rawPrice ? Number(rawPrice).toLocaleString() + '万円' : '';
    lot.memo     = document.getElementById('lot-edit-memo').value.trim();
    lot.topLabel = document.getElementById('lot-edit-top-label').value.trim() || null;
    const sel = document.querySelector('#lot-color-swatches .color-swatch.active-swatch');
    if (sel) lot.color = sel.dataset.lotcolor;
    const fillOpacityInput = document.getElementById('lot-edit-fill-opacity');
    if (fillOpacityInput?.dataset.custom === '1') {
      lot.fillOpacity = (parseInt(fillOpacityInput.value) || 0) / 100;
    }
    const selB = document.querySelector('#lot-border-swatches .border-swatch.active-border');
    if (selB) lot.borderColor = selB.dataset.bc;
    const selLtc = document.querySelector('#lot-label-color-swatches .lotlabel-color-swatch.active-lotlabel-color');
    if (selLtc) lot.labelTextColor = selLtc.dataset.ltc || null;
    const selElc = document.querySelector('#lot-edgelabel-color-swatches .edgelabel-color-swatch.active-edgelabel-color');
    if (selElc) lot.edgeLabelColor = selElc.dataset.elc;
    lot.labelScale = parseFloat(document.getElementById('modal-lot-text-scale')?.value) || 1.0;
    lot.edgeScale = parseFloat(document.getElementById('modal-lot-edge-scale')?.value) || 1.0;
    // 表示設定
    [['lot-num-disp-group',  'hideNumber'],
     ['lot-edge-disp-group', 'edgeDisplay'],
     ['lot-area-disp-group', 'areaDisplay'],
     ['lot-yaku-disp-group', 'yakuMode']].forEach(([groupId, prop]) => {
      const active = document.querySelector(`#${groupId} .lot-disp-btn.active-disp`);
      const val = active ? active.dataset.val : '';
      lot[prop] = val || null;
    });
  }
  const changed = JSON.stringify(lot) !== JSON.stringify(session.original)
    || App.lotNextNum !== session.originalLotNextNum;
  if (changed) pushHistoryState(session.historyState);
  document.getElementById('lot-edit-modal').classList.add('hidden');
  _editingLotId = null;
  _lotEditSession = null;
  if (typeChanged) App.selectedFormat = null;
  reconcileSelectionState();
  updateLotPanel();
  notifyAppState('lot-edit-commit');
  App.dirty = true;
}

// ===== Electron: アプリ内の終了確認 =====
if (typeof window !== 'undefined' && window.electronAPI) {
  window.electronAPI.onCloseRequested?.(() => {
    const modal = document.getElementById('exit-confirm-modal');
    document.getElementById('exit-confirm-title').textContent = '作業を終了しますか？';
    document.getElementById('exit-confirm-note').textContent = '必要なら作業データを保存してから閉じられます。';
    ['exit-cancel', 'exit-without-save', 'exit-save'].forEach(id => {
      const button = document.getElementById(id);
      if (button) button.disabled = false;
    });
    modal?.classList.remove('hidden');
  });
  window.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('exit-confirm-modal');
    const respond = action => {
      if (action === 'save') {
        document.getElementById('exit-confirm-title').textContent = '作業データを保存しています';
        document.getElementById('exit-confirm-note').textContent = '書き込みが完了すると自動で終了します。画面はそのままお待ちください。';
        ['exit-cancel', 'exit-without-save', 'exit-save'].forEach(id => {
          const button = document.getElementById(id);
          if (button) button.disabled = true;
        });
      } else {
        modal?.classList.add('hidden');
      }
      window.electronAPI.respondToClose?.(action);
    };
    document.getElementById('exit-cancel')?.addEventListener('click', () => respond('cancel'));
    document.getElementById('exit-without-save')?.addEventListener('click', () => respond('discard'));
    document.getElementById('exit-save')?.addEventListener('click', () => respond('save'));
  });
  window.electronAPI.onSaveAndClose(async () => {
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const success = await saveProjectJSON({ closeAfter: true });
    window.electronAPI.saveComplete(success);
  });
}
