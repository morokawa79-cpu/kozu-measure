// ===== 公図 計測ツール =====

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

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

  // ラベルヒットボックス (render中に更新)
  labelBoxes: [],

  // メモ入力
  pendingTextPos: null,
  pendingCalloutTip: null,  // 引出線の先端座標
  editingTextId: null,      // 編集中のテキストID

  // 計測・矢印の使用色
  strokeColor: '#f87171',

  // テキストオプション（メモパネルで選択）
  textOptions: { fontSize: 14, color: '#1a1a1a', bgColor: 'rgba(255,255,220,0.92)', boxStyle: 'box' },

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
  appMode: 'measure',      // 'measure' | 'subdivision'
  lots: [],                // 区画データ
  lotNextNum: 1,           // 次の区画番号
  lotPts: [],              // 描画中の頂点リスト（面積ツールと同じ方式）
  gridSnap: true,          // グリッドスナップ（デフォルトON）
  lotTool: 'draw',         // 'draw' | 'road' | 'split' | 'split-all' | 'merge'
  mergeSelect: [],         // 合筆モードで選択中の区画ID
  lotStrokeColor: '#bfdbfe',
  lotBorderColor: '#1d4ed8',   // 区画の線の色（グローバル）
  lotFillOpacity: 0.73,      // 区画塗り色の不透明度（0〜1）
  lotTextScale: 1.4,         // ラベル文字サイズ倍率（番号・面積）
  lotEdgeScale: 1.0,         // 寸法線テキストサイズ倍率
  subMeasureScale: 0.9,      // 測定・注記テキストサイズ倍率
  lotShowEdgeLengths: true,  // 辺の長さ表示ON/OFF
  divGuideN: 2,              // 均等分割数
  divGuides: [],             // [{id,p1,p2,n}]
  draggingLotId: null,
  dragLotOffX: 0, dragLotOffY: 0,
  draggingLotLabelId: null,
  dragLotLabelOffX: 0, dragLotLabelOffY: 0,
  draggingEdgeLabelLotId: null,  // 寸法テキストドラッグ中の区画ID
  draggingEdgeLabelEdge: -1,     // 寸法テキストドラッグ中の辺インデックス
  dragEdgeLabelOffX: 0, dragEdgeLabelOffY: 0,
  draggingSetbackId: null,       // セットバックテキストドラッグ中の区画ID
  dragSetbackOffX: 0, dragSetbackOffY: 0,
  parallelBase: null,    // {p1,p2} 平行線のベース
  parallelFlip: 1,       // +1 or -1
  parallelCount: 0,      // 「作成」ボタン用カウンター
  parallelDivCount: 0,   // 「分割線として引く」ボタン用カウンター（独立）
  snapPt: null,          // スナッププレビュー座標
  snapType: null,        // 'vertex'|'intersection'|'grid'|null
  splitTargetId: null,   // 分割対象の区画ID
  imageRotation: 0,      // 背景画像の回転角度（0/90/180/270）
  cornerCutLotId: null,  // 隅切り対象の区画ID
  cornerCutIdx: -1,      // 隅切り対象の頂点インデックス
  dragLotOrigPoints: null, // ドラッグ開始時の区画頂点コピー
  dragLotOrigCen: null,    // ドラッグ開始時の重心
  moveAllDragging: false,  // 全体移動ドラッグ中
  moveAllStartX: 0, moveAllStartY: 0,  // 開始キャンバス座標
  moveAllOrigLots: null,   // 開始時の区画データコピー
  moveAllOrigItems: null,  // 開始時の計測データコピー
  moveAllOrigTexts: null,  // 開始時のテキストデータコピー

  dirty: true,
};

let canvas, ctx;

// ===== 初期化 =====
window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  bindEvents();
  setMode('distance');
  setScaleDisplay('縮尺: 未設定');  // ボタンラベルを初期化
  renderLoop();
});

function resizeCanvas() {
  const c = document.getElementById('canvas-container');
  canvas.width = c.clientWidth;
  canvas.height = c.clientHeight;
  App.dirty = true;
}

// ===== PDF / 画像ロード =====
async function loadPDF(file) {
  try {
    const buf = await file.arrayBuffer();
    App.pdfBytes = new Uint8Array(buf);
    App.isImageMode = false;
    App.pdf = await pdfjsLib.getDocument({ data: App.pdfBytes }).promise;
    App.pageCount = App.pdf.numPages;
    App.pageNum = 1;
    document.getElementById('page-nav').classList.remove('hidden');
    await renderPDFPage(1);
  } catch (e) { alert('PDF読み込みエラー: ' + e.message); }
}

async function loadImage(file) {
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
    App.mapScale = null; App.mpp = null;
    setScaleDisplay('縮尺未設定 — スケールバーで「縮尺設定」してください');
    document.getElementById('drop-zone').style.display = 'none';
    clearMeasurements(false);
    fitToView();
    App.dirty = true;
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

async function renderPDFPage(num) {
  const page = await App.pdf.getPage(num);
  const vp = page.getViewport({ scale: App.renderScale });
  App.pdfOffscreen.width = vp.width;
  App.pdfOffscreen.height = vp.height;
  App.pageWidthPt = page.view[2];
  App.pageHeightPt = page.view[3];

  await page.render({ canvasContext: App.pdfOffscreen.getContext('2d'), viewport: vp }).promise;
  App.pdfReady = true;

  const detected = await detectScale(page);
  if (detected) {
    setMapScale(detected);
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

// ===== 縮尺 =====
function setMapScale(scale) {
  App.mapScale = scale;
  App.mpp = (25.4 * scale) / (72 * App.renderScale * 1000);
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
  // 図面名称エリア
  ctx.fillStyle = '#cbd5e1';
  ctx.font = `${pfs(6) * rs}px 'Segoe UI', sans-serif`;
  ctx.fillText('図 面 名 称', tbX + (tbW - metaW) / 2, tbY + tbH / 2);

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
  if (!App.pdfReady && !App.paperMode) {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, W, H);
    return;
  }
  ctx.fillStyle = App.paperMode ? '#64748b' : '#0f172a';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(App.vx, App.vy);
  ctx.scale(App.vz, App.vz);

  if (App.paperMode) {
    drawPaperFrame();
  }
  if (App.pdfReady && !App.paperMode) {
    if (App.imageRotation === 0) {
      ctx.drawImage(App.pdfOffscreen, 0, 0);
    } else {
      const W = App.pdfOffscreen.width, H = App.pdfOffscreen.height;
      const r = App.imageRotation * Math.PI / 180;
      ctx.save();
      if (App.imageRotation === 90)  { ctx.translate(H, 0); }
      if (App.imageRotation === 180) { ctx.translate(W, H); }
      if (App.imageRotation === 270) { ctx.translate(0, W); }
      ctx.rotate(r);
      ctx.drawImage(App.pdfOffscreen, 0, 0);
      ctx.restore();
    }
  }

  // ラベルヒットボックスをリセット
  App.labelBoxes = [];

  drawLotsLayer();  // モードに関わらず常に描画
  App.items.forEach(item => drawItem(item, item.color));
  App.texts.forEach(t => drawTextAnnotation(t));
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

  ctx.restore();
}

// フォントサイズヘルパー: キャンバス座標系のサイズ（地図と比例・印刷と一致）
// x2: 典型的なフィットページズーム(~0.5)で従来と同じ画面サイズになる係数
function pfs(base) { return base * 2; }

// ===== 計測描画 =====
function drawItem(item, color) {
  if (item.points.length < 2) return;

  // 矢印は専用描画
  if (item.type === 'arrow') { drawArrowItem(item, color); return; }

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

  item.points.forEach(p => drawDot(p.x, p.y, 4 / App.vz, color));

  const fs = pfs(13) * (App.subMeasureScale || 1.0);

  if (item.type === 'distance') {
    const lp = item.labelPos || midPt(item.points[0], item.points[1]);
    drawLabel(lp.x, lp.y, item.label, color, fs, item.id, 'main');

  } else if (item.type === 'polyline') {
    for (let i = 0; i < item.points.length - 1; i++) {
      if (item.segLabels && item.segLabels[i]) {
        const lp = (item.segLabelPos && item.segLabelPos[i]) || midPt(item.points[i], item.points[i + 1]);
        drawLabel(lp.x, lp.y - 10 / App.vz, item.segLabels[i], color, fs, item.id, 'seg' + i);
      }
    }
    if (item.label) {
      const last = item.points[item.points.length - 1];
      const lp = item.labelPos || { x: last.x, y: last.y - 16 / App.vz };
      drawLabel(lp.x, lp.y, '合計: ' + item.label, color, fs, item.id, 'main');
    }

  } else if (item.type === 'area') {
    const lp = item.labelPos || centroid(item.points);
    drawLabel(lp.x, lp.y, item.label, color, fs, item.id, 'main');
    if (App.showSideLengths && item.segLabels) {
      for (let i = 0; i < item.points.length; i++) {
        const j = (i + 1) % item.points.length;
        const mid = midPt(item.points[i], item.points[j]);
        const lp2 = (item.segLabelPos && item.segLabelPos[i]) || { x: mid.x, y: mid.y - 10 / App.vz };
        drawLabel(lp2.x, lp2.y, item.segLabels[i], color, fs * 0.88, item.id, 'seg' + i);
      }
    }
  }
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

  drawDot(p1.x, p1.y, 3.5 / App.vz, color);
}

// ===== テキスト・引出線描画 =====
function drawLotTable(t) {
  const fs = pfs(t.fontSize || 11);
  ctx.textBaseline = 'middle';

  const cellPadX = fs * 0.35;   // フォントに比例（ズームで伸びない）
  const lineH = fs * 1.7;
  const titleH = t.title ? lineH * 1.2 : 0;

  // 列幅を計測
  ctx.font = `bold ${fs}px 'Segoe UI', sans-serif`;
  const allRows = [t.headers, ...t.rows, t.totalRow];
  const colCount = t.headers.length;
  const colWidths = t.headers.map((_, ci) =>
    allRows.reduce((m, row) => Math.max(m, ctx.measureText(row[ci] || '').width + cellPadX * 2), 0)
  );
  // タイトルが列幅を超える場合は最終列を拡張
  if (t.title) {
    ctx.font = `bold ${fs * 1.05}px 'Segoe UI', sans-serif`;
    const tw = ctx.measureText(t.title).width + cellPadX * 4;
    const curW = colWidths.reduce((a, b) => a + b, 0);
    if (tw > curW) colWidths[colWidths.length - 1] += tw - curW;
    ctx.font = `bold ${fs}px 'Segoe UI', sans-serif`;
  }
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const totalH = titleH + lineH * (allRows.length + 1);
  const x = t.x, y = t.y;
  const tblY = y + titleH; // テーブル本体の開始Y

  // 背景
  ctx.fillStyle = t.bgColor || 'rgba(255,255,255,0.95)';
  roundRect(ctx, x, y, totalW, totalH, 4 / App.vz);
  ctx.fill();

  // タイトル行
  if (t.title) {
    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(x, y, totalW, titleH);
    ctx.font = `bold ${fs * 1.05}px 'Segoe UI', sans-serif`;
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
    ctx.font = (isHeader || isTotal) ? `bold ${fs}px 'Segoe UI', sans-serif`
                                     : `${fs}px 'Segoe UI', sans-serif`;
    let cx2 = x;
    row.forEach((cell, ci) => {
      const cellY = ri === allRows.length - 1
        ? totalRowY + lineH * 0.4
        : tblY + ri * lineH + lineH * 0.5;
      // 1列目は左寄せ（kaitori用）、数値列は右寄せ
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

function drawTextAnnotation(t) {
  if (t.textType === 'lot-table') { drawLotTable(t); return; }
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
    // 先端に小円
    drawDot(t.tipX, t.tipY, 3.5 / App.vz, textColor);
  }

  const fs = pfs(t.fontSize || 14) * (App.subMeasureScale || 1.0);
  ctx.font = `bold ${fs}px 'Segoe UI', sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const lines = (t.text || '').split('\n');
  const maxW = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  const lineH = fs * 1.4;
  const h = lineH * lines.length;
  const pad = fs * 0.35;
  const x = t.x, y = t.y;

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
    lines.forEach((_, i) => {
      const ly = y + i * lineH + lineH - pad * 0.2;
      ctx.beginPath();
      ctx.moveTo(x - pad, ly);
      ctx.lineTo(x + maxW + pad, ly);
      ctx.stroke();
    });
  }
  // boxStyle === 'none': 枠なし・背景なし

  // テキスト
  ctx.fillStyle = textColor;
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineH));

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

  pts.forEach(p => drawDot(p.x, p.y, 5 / App.vz, '#fbbf24'));

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
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1 / App.vz;
  ctx.stroke();
}

// スナップ有効時に□インジケーターを描画
function drawSnapBox(x, y, color) {
  const s = 6 / App.vz;
  ctx.strokeStyle = color || '#facc15';
  ctx.lineWidth = 1.5 / App.vz;
  ctx.setLineDash([]);
  ctx.strokeRect(x - s, y - s, s * 2, s * 2);
}

function drawLabel(x, y, text, color, fontSize, itemId, labelKey) {
  ctx.font = `bold ${fontSize}px 'Segoe UI', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  const pad = fontSize * 0.35;
  const w = tw + pad * 2, h = fontSize + pad * 2;

  ctx.fillStyle = 'rgba(255,255,255,0.93)';
  ctx.beginPath();
  ctx.rect(x - w / 2, y - h / 2, w, h);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);

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


  // 1点戻す (サイドバー)
  document.getElementById('btn-undo-side').addEventListener('click', undoLast);

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
      App.printSize = btn.dataset.size;
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
  document.getElementById('btn-cancel-calib-dist').addEventListener('click', () =>
    document.getElementById('calibration-dist-modal').classList.add('hidden'));
  document.getElementById('btn-apply-calibration').addEventListener('click', applyCalibrationDist);

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
    if (e.key === 'Enter') { e.preventDefault(); commitTextInput(); }
    if (e.key === 'Escape') cancelTextInput();
  });
  document.getElementById('memo-ok').addEventListener('click', commitTextInput);
  document.getElementById('memo-cancel').addEventListener('click', cancelTextInput);

  // メモパネル：文字サイズスライダー
  document.getElementById('text-size-slider')?.addEventListener('input', e => {
    App.textOptions.fontSize = parseInt(e.target.value);
    const v = document.getElementById('text-size-val');
    if (v) v.textContent = e.target.value;
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
      if (App.cpTargetIsText) {
        const t = App.texts.find(x => x.id === App.cpTargetId);
        if (t) { t.color = col; }
      } else {
        const item = App.items.find(x => x.id === App.cpTargetId);
        if (item) { item.color = col; }
      }
      document.getElementById('color-picker-popup').classList.add('hidden');
      updateResults();
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
    if (e.key === 'Escape') { cancelCurrent(); cancelTextInput(); }
    const tag = document.activeElement?.tagName;
    const onInput = tag === 'INPUT' || tag === 'TEXTAREA';
    const modalOpen = ['kaitori-modal','lot-edit-modal','calibration-modal'].some(
      id => !document.getElementById(id)?.classList.contains('hidden'));
    if (!onInput && !modalOpen && (e.key === 'Delete' || e.key === 'Backspace')) undoLast();
    if (!onInput && e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undoLast(); }
    if (!onInput && e.key === 'y' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); redoLast(); }
    if (!onInput && e.key === 'Escape') { App.lotPts = []; App.mergeSelect = []; App.splitTargetId = null; App.cornerCutLotId = null; App.cornerCutIdx = -1; updateSplitUI(); render(); App.dirty = false; }
  });

  // ===== 分譲地モード イベント =====
  document.getElementById('btn-mode-measure').addEventListener('click', () => setAppMode('measure'));
  document.getElementById('btn-mode-subdivision').addEventListener('click', () => setAppMode('subdivision'));

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

  document.getElementById('btn-toggle-edge-lengths').addEventListener('click', () => {
    App.lotShowEdgeLengths = !App.lotShowEdgeLengths;
    const btn = document.getElementById('btn-toggle-edge-lengths');
    btn.classList.toggle('toggle-on', App.lotShowEdgeLengths);
    btn.style.color = App.lotShowEdgeLengths ? '#34d399' : '';
    App.dirty = true;
  });
  document.getElementById('btn-stamp-list').addEventListener('click', stampLotList);
  document.getElementById('btn-renumber-lots').addEventListener('click', renumberLots);
  document.getElementById('btn-kaitori').addEventListener('click', openKaitoriModal);
  document.getElementById('kaitori-close').addEventListener('click', () =>
    document.getElementById('kaitori-modal').classList.add('hidden'));
  document.getElementById('kaitori-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('kaitori-modal'))
      document.getElementById('kaitori-modal').classList.add('hidden');
  });
  ['kai-sqm','kai-tsubo-price','kai-kosei','kai-sokuryo','kai-kaitai',
   'kai-other1','kai-other2','kai-margin'].forEach(id => {
    document.getElementById(id).addEventListener('input', calcKaitori);
  });
  document.getElementById('kai-stamp').addEventListener('click', stampKaitori);
  document.getElementById('kai-clear').addEventListener('click', () => {
    ['kai-sqm','kai-tsubo-price','kai-kosei','kai-sokuryo','kai-kaitai',
     'kai-other1','kai-other2'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('kai-margin').value = '15';
    calcKaitori();
  });
  document.getElementById('lot-text-scale-slider')?.addEventListener('input', e => {
    App.lotTextScale = parseFloat(e.target.value);
    const disp = document.getElementById('lot-text-scale-val');
    if (disp) disp.textContent = parseFloat(e.target.value).toFixed(1) + '×';
    App.dirty = true;
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
    App.dirty = true;
  });
  const onSubMeasureScale = e => {
    App.subMeasureScale = parseFloat(e.target.value);
    ['sub-measure-scale-val', 'measure-text-scale-val'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = parseFloat(e.target.value).toFixed(1) + '×';
    });
    ['sub-measure-scale-slider', 'measure-text-scale-slider'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el !== e.target) el.value = e.target.value;
    });
    App.dirty = true;
  };
  document.getElementById('sub-measure-scale-slider')?.addEventListener('input', onSubMeasureScale);
  document.getElementById('measure-text-scale-slider')?.addEventListener('input', onSubMeasureScale);

  // 分譲地内 矢印・文字・引出線
  document.getElementById('sub-btn-arrow').addEventListener('click', () => setSubMeasureMode('arrow'));
  document.getElementById('sub-btn-text').addEventListener('click', () => setSubMeasureMode('text'));
  document.getElementById('sub-btn-callout').addEventListener('click', () => setSubMeasureMode('callout'));

  document.getElementById('btn-lot-select').addEventListener('click', () => setLotTool('select'));
  document.getElementById('btn-lot-label-move').addEventListener('click', () => setLotTool('label-move'));
  document.getElementById('btn-edge-label-move').addEventListener('click', () => setLotTool('edge-label-move'));
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
    document.getElementById('btn-measure-snap').classList.toggle('toggle-on', App.gridSnap);
    document.getElementById('btn-measure-snap').classList.toggle('toggle-off', !App.gridSnap);
  });

  document.getElementById('btn-measure-snap').addEventListener('click', () => {
    App.gridSnap = !App.gridSnap;
    document.getElementById('btn-measure-snap').classList.toggle('toggle-on', App.gridSnap);
    document.getElementById('btn-measure-snap').classList.toggle('toggle-off', !App.gridSnap);
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
  document.getElementById('lot-edit-cancel').addEventListener('click', () =>
    document.getElementById('lot-edit-modal').classList.add('hidden'));
  document.getElementById('lot-edit-ok').addEventListener('click', commitLotEdit);
  ['lot-edit-price', 'lot-edit-memo'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commitLotEdit(); }
    });
  });
  // 道路テンプレートボタン
  document.querySelectorAll('.road-tmpl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('lot-edit-road-label').value = btn.dataset.text;
    });
  });
  // 道路文字サイズスライダー
  document.getElementById('lot-edit-road-label-size').addEventListener('input', e => {
    document.getElementById('lot-edit-road-label-size-val').textContent = parseFloat(e.target.value).toFixed(1) + '×';
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
  });
  document.querySelectorAll('#lot-color-swatches .color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('#lot-color-swatches .color-swatch').forEach(s => s.classList.remove('active-swatch'));
      sw.classList.add('active-swatch');
    });
  });

  // 区画の線色スウォッチ（モーダル内）
  document.querySelectorAll('#lot-border-swatches .border-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('#lot-border-swatches .border-swatch').forEach(s => {
        s.style.outline = 'none'; s.classList.remove('active-border');
      });
      sw.style.outline = '2px solid #60a5fa';
      sw.classList.add('active-border');
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

  // 全体移動ツール
  document.getElementById('btn-move-all')?.addEventListener('click', () => setLotTool('move-all'));
}

function getPaperDims(size) {
  // PDF座標系に合わせたサイズ（points × renderScale=4）
  // A4横: 842×595pt, A3横: 1190×842pt
  const rs = App.renderScale || 4;
  if (size === 'A3') return { w: Math.round(1190 * rs), h: Math.round(842 * rs) };
  return { w: Math.round(842 * rs), h: Math.round(595 * rs) };  // A4
}

function togglePaperMode() {
  App.paperMode = !App.paperMode;
  const btn = document.getElementById('btn-paper-mode');
  if (App.paperMode) {
    btn.textContent = '本図に戻す';
    btn.classList.add('active-mode');
    const d = getPaperDims(App.paperSize);
    App.paperW = d.w; App.paperH = d.h;
    fitPaperToView();
  } else {
    btn.textContent = '📄 用紙';
    btn.classList.remove('active-mode');
    if (App.pdfReady) fitToView();
  }
  App.dirty = true;
}

// ===== マウスイベント =====
function onMouseDown(e) {
  if (!App.pdfReady && !App.paperMode) return;
  const { sx, sy } = getRel(e);
  const cp = s2c(sx, sy);

  // ===== 分譲地モード =====
  if (App.appMode === 'subdivision') {
    if (e.button === 1 || (e.button === 0 && e.altKey) || App.mode === 'pan') {
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
      saveState();
      App.moveAllDragging = true;
      App.moveAllStartX = cp.x;
      App.moveAllStartY = cp.y;
      App.moveAllOrigLots  = App.lots.map(l => ({ id: l.id, pts: l.points ? l.points.map(p => ({ ...p })) : null, lox: l.labelOffX || 0, loy: l.labelOffY || 0, sbx: l.setbackOffX || 0, sby: l.setbackOffY || 0, elofs: l.edgeLabelOffsets ? JSON.parse(JSON.stringify(l.edgeLabelOffsets)) : null }));
      App.moveAllOrigItems = App.items.map(i => ({ id: i.id, pts: i.points ? i.points.map(p => ({ ...p })) : null, x1: i.x1, y1: i.y1, x2: i.x2, y2: i.y2, tipX: i.tipX, tipY: i.tipY, ox: i.offsetX, oy: i.offsetY }));
      App.moveAllOrigTexts = App.texts.map(t => ({ id: t.id, x: t.x, y: t.y, tipX: t.tipX, tipY: t.tipY }));
      canvas.style.cursor = 'grabbing';
      return;
    }
    // 削除モード
    if (App.lotTool === 'delete') {
      saveState();
      // 区画削除
      const delLot = hitLot(cp);
      if (delLot) {
        App.lots = App.lots.filter(l => l.id !== delLot.id);
        updateLotPanel(); App.dirty = true;
        return;
      }
      // 計測アイテム削除
      const hit = hitLabel(sx, sy);
      if (hit) {
        if (hit.isText) {
          App.texts = App.texts.filter(t => t.id !== hit.itemId);
        } else {
          App.items = App.items.filter(i => i.id !== hit.itemId);
        }
        updateResults();
        App.dirty = true;
        return;
      }
      return;
    }
    // 区画移動モード
    if (App.mode === 'select' && App.lotTool !== 'label-move' && App.lotTool !== 'merge' && App.lotTool !== 'corner-cut' && App.lotTool !== 'edge-label-move') {
      const lot = hitLot(cp);
      if (lot && lot.points) {
        saveState();
        App.draggingLotId = lot.id;
        const cen = centroid(lot.points);
        App.dragLotOffX = cp.x - cen.x;
        App.dragLotOffY = cp.y - cen.y;
        App.dragLotOrigPoints = lot.points.map(p => ({ x: p.x, y: p.y }));
        App.dragLotOrigCen = { x: cen.x, y: cen.y };
        canvas.style.cursor = 'grabbing';
      } else {
        // 計測ラベル・テキストの移動
        const hit = hitLabel(sx, sy);
        if (hit) {
          saveState();
          App.draggingId = hit.itemId;
          App.dragLabelKey = hit.labelKey;
          App.dragIsText = hit.isText;
          App.dragOffX = cp.x - hit.cx;
          App.dragOffY = cp.y - hit.cy;
          canvas.style.cursor = 'grabbing';
        }
      }
      return;
    }
    // 文字移動モード（計測ラベルを優先してヒット判定、次にセットバック・区画ラベル）
    if (App.lotTool === 'label-move') {
      const hit = hitLabel(sx, sy);
      if (hit) {
        saveState();
        App.draggingId = hit.itemId;
        App.dragLabelKey = hit.labelKey;
        App.dragIsText = hit.isText;
        App.dragOffX = cp.x - hit.cx;
        App.dragOffY = cp.y - hit.cy;
        canvas.style.cursor = 'grabbing';
      } else {
        // セットバックテキストのヒットテスト
        const hitR = 20 / App.vz;
        let sbHit = null;
        for (const rl of App.lots) {
          if (!rl.points || !rl.setback || rl.type !== 'road') continue;
          const rcen = centroid(rl.points);
          const scale = rl.roadLabelSize || 1.0;
          const sbDef = pfs(11) * scale * 2.8;
          const sbX = rcen.x + (rl.setbackOffX || 0);
          const sbY = rcen.y + (rl.setbackOffY != null ? rl.setbackOffY : sbDef);
          if (Math.hypot(cp.x - sbX, cp.y - sbY) < hitR) { sbHit = rl; break; }
        }
        if (sbHit) {
          saveState();
          const rcen = centroid(sbHit.points);
          const scale = sbHit.roadLabelSize || 1.0;
          const sbDef = pfs(11) * scale * 2.8;
          if (sbHit.setbackOffY == null) sbHit.setbackOffY = sbDef;
          App.draggingSetbackId = sbHit.id;
          App.dragSetbackOffX = cp.x - (rcen.x + (sbHit.setbackOffX || 0));
          App.dragSetbackOffY = cp.y - (rcen.y + sbHit.setbackOffY);
          canvas.style.cursor = 'grabbing';
        } else {
          const lot = hitLot(cp);
          if (lot && lot.points) {
            saveState();
            const cen = centroid(lot.points);
            App.draggingLotLabelId = lot.id;
            App.dragLotLabelOffX = cp.x - (cen.x + (lot.labelOffX || 0));
            App.dragLotLabelOffY = cp.y - (cen.y + (lot.labelOffY || 0));
            canvas.style.cursor = 'grabbing';
          }
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
          const scale = App.lotEdgeScale || 1.0;
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
          saveState();
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
      App.draggingId = hit.itemId;  // itemId が正しいキー
      App.dragLabelKey = hit.labelKey;
      App.dragIsText = hit.isText;
      App.dragOffX = cp.x - hit.cx;
      App.dragOffY = cp.y - hit.cy;
      canvas.style.cursor = 'grabbing';
    }
    return;
  }

  // キャリブレーション
  if (App.calibrating) {
    App.calibPts.push(cp);
    App.dirty = true;
    if (App.calibPts.length === 2) {
      App.calibrating = false;
      document.getElementById('calibration-dist-modal').classList.remove('hidden');
      document.getElementById('calibration-dist-input').focus();
    }
    return;
  }

  // メモモード
  if (App.mode === 'text') {
    showTextInput(sx, sy, cp);
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
      showTextInput(sx, sy, cp);
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
    App.vx = App.panVX + sx - App.panSX;
    App.vy = App.panVY + sy - App.panSY;
    updateZoomInfo();
    App.dirty = true;
    return;
  }

  const cp = s2c(sx, sy);
  App.mx = cp.x; App.my = cp.y;
  // スナッププレビュー更新（全モード共通）
  const _sp = snapPoint(cp.x, cp.y);
  App.snapPt = _sp.pt; App.snapType = _sp.type;

  // 分譲地モード
  if (App.appMode === 'subdivision') {
    if (App.draggingSetbackId !== null) {
      const lot = App.lots.find(l => l.id === App.draggingSetbackId);
      if (lot) {
        const cen = centroid(lot.points);
        lot.setbackOffX = cp.x - App.dragSetbackOffX - cen.x;
        lot.setbackOffY = cp.y - App.dragSetbackOffY - cen.y;
        App.dirty = true;
      }
      return;
    }
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
        lot.setbackOffX = orig.sbx; lot.setbackOffY = orig.sby;
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
        lot.labelOffX = cp.x - App.dragLotLabelOffX - cen.x;
        lot.labelOffY = cp.y - App.dragLotLabelOffY - cen.y;
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

  // selectモード: 常に再描画してラベルBoxesを最新に保つ
  if (App.mode === 'select') {
    App.dirty = true;
    const hit = hitLabel(sx, sy);   // スクリーン座標で判定
    canvas.style.cursor = App.draggingId !== null ? 'grabbing' : (hit ? 'grab' : 'default');
  }

  if (App.pts.length > 0 || App.calibrating) App.dirty = true;
}

function onMouseUp(e) {
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
    canvas.style.cursor = App.mode === 'select' ? 'default' : 'crosshair';
  }
  if (App.draggingEdgeLabelLotId !== null) {
    App.draggingEdgeLabelLotId = null;
    App.draggingEdgeLabelEdge = -1;
    canvas.style.cursor = 'crosshair';
  }
  if (App.draggingSetbackId !== null) {
    App.draggingSetbackId = null;
    canvas.style.cursor = 'crosshair';
  }
}

function onDblClick(e) {
  if (!App.pdfReady && !App.paperMode) return;
  const { sx, sy } = getRel(e);
  const cp = s2c(sx, sy);

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
      App.lotPts.pop();
      confirmLotDraw();
      return;
    }
    // 計測モードのダブルクリックは共通処理へ落とす
    if (App.lotTool === 'measure') { /* fall through */ }
    else {
      // label-moveツール時: テキスト注記をダブルクリックで編集
      if (App.lotTool === 'label-move') {
        const hit = hitLabel(sx, sy);
        if (hit && hit.isText) {
          const t = App.texts.find(t => t.id === hit.itemId);
          if (t) {
            App.editingTextId = t.id;
            App.textOptions.fontSize = t.fontSize || 14;
            App.textOptions.color    = t.color    || '#1a1a1a';
            App.textOptions.bgColor  = t.bgColor  || 'rgba(255,255,220,0.92)';
            App.textOptions.boxStyle = t.boxStyle  || 'box';
            App.pendingTextPos = { x: t.x, y: t.y };
            showTextInput(sx, sy, { x: t.x, y: t.y }, t.text);
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
      if (t) {
        App.editingTextId = t.id;
        App.textOptions.fontSize = t.fontSize || 14;
        App.textOptions.color    = t.color    || '#1a1a1a';
        App.textOptions.bgColor  = t.bgColor  || 'rgba(255,255,220,0.92)';
        App.textOptions.boxStyle = t.boxStyle  || 'box';
        App.pendingTextPos = { x: t.x, y: t.y };
        showTextInput(sx, sy, { x: t.x, y: t.y }, t.text);
      }
    }
    return;
  }

  if ((App.mode === 'polyline' || App.mode === 'area') && App.pts.length >= 2) {
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
  cancelCurrent();
  App.mode = mode;
  document.querySelectorAll('.tool-btn[data-mode]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.mode === mode));
  canvas.style.cursor = getCursor();
  updateHint();
}

function getCursor() {
  if (App.mode === 'pan') return 'grab';
  if (App.mode === 'select') return 'default';
  if (App.mode === 'text' || App.mode === 'callout') return 'crosshair';
  return 'crosshair';
}

function cancelCurrent() {
  App.pts = [];
  App.lotPts = [];
  App.calibPts = [];
  App.calibrating = false;
  App.draggingId = null;
  App.dirty = true;
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
    const modeHints = { select: '区画をドラッグで移動　ダブルクリックで編集', pan: 'ドラッグで移動　ホイールでズーム', 'label-move': '区画ラベル・計測ラベルをドラッグで移動' };
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
  };
  document.getElementById('hint-text').textContent = hints[App.mode] || '';
}

function updateZoomInfo() {
  const pct = Math.round(App.vz * 100) + '%';
  document.getElementById('zoom-info').textContent = pct;
  const sub = document.getElementById('zoom-info-sub');
  if (sub) sub.textContent = pct;
}

// ===== 計測確定 =====
function finishMeasurement() {
  // 矢印は縮尺不要（他は onMouseDown 側で事前チェック済み）
  if (!App.mpp && App.mode !== 'arrow') {
    App.pts = [];
    App.dirty = true;
    return;
  }

  const pts = [...App.pts];
  App.pts = [];
  const color = App.strokeColor;
  let item = null;

  if (App.mode === 'arrow' && pts.length === 2) {
    item = { id: App.nextId++, type: 'arrow', points: pts, color, label: '' };

  } else if (App.mode === 'distance' && pts.length === 2) {
    const d = dist(pts[0], pts[1]) * App.mpp;
    item = { id: App.nextId++, type: 'distance', points: pts, color,
      label: formatDist(d), value: d, labelPos: null };

  } else if (App.mode === 'polyline' && pts.length >= 2) {
    let total = 0;
    const segLabels = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const d = dist(pts[i], pts[i + 1]) * App.mpp;
      segLabels.push(formatDist(d));
      total += d;
    }
    item = { id: App.nextId++, type: 'polyline', points: pts, color,
      label: formatDist(total), value: total, segLabels, labelPos: null, segLabelPos: [] };

  } else if (App.mode === 'area' && pts.length >= 3) {
    const sqm = shoelace(pts) * App.mpp * App.mpp;
    const tsubo = sqm * 0.3025;
    const segLabels = [];
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      segLabels.push(formatDist(dist(pts[i], pts[j]) * App.mpp));
    }
    item = { id: App.nextId++, type: 'area', points: pts, color,
      label: `${sqm.toFixed(2)}㎡ / ${tsubo.toFixed(2)}坪`,
      value: sqm, segLabels, labelPos: null, segLabelPos: [] };
  }

  if (item) { saveState(); App.items.push(item); updateResults(); }
  App.dirty = true;
}

// ===== Undo / Redo =====
function saveState() {
  App.undoStack.push({
    items: JSON.parse(JSON.stringify(App.items)),
    texts: JSON.parse(JSON.stringify(App.texts)),
    lots: JSON.parse(JSON.stringify(App.lots)),
    lotNextNum: App.lotNextNum,
    divGuides: JSON.parse(JSON.stringify(App.divGuides)),
  });
  App.redoStack = [];
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
  updateResults();
  updateLotPanel();
  App.dirty = true;
}

function clearMeasurements(confirm_) {
  const hasData = App.items.length > 0 || App.texts.length > 0 || App.lots.length > 0;
  if (confirm_ && hasData) {
    if (!confirm('すべての計測・区画・メモをクリアしますか？')) return;
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
  App.pendingTextPos = cp;
  const rect = canvas.getBoundingClientRect();
  showTextInputAt(rect.left + sx + 12, rect.top + sy - 10, existingText);
}

function showTextInputAt(clientX, clientY, existingText = '') {
  const panel = document.getElementById('memo-panel');
  const input = document.getElementById('memo-input');
  let px = clientX, py = clientY;
  if (px + 280 > window.innerWidth)  px = window.innerWidth - 290;
  if (py + 200 > window.innerHeight) py = py - 200;
  if (py < 0) py = 4;
  panel.style.left = px + 'px';
  panel.style.top  = py + 'px';
  panel.classList.remove('hidden');
  syncMemoPanelUI();
  input.value = existingText;
  setTimeout(() => { input.focus(); if (existingText) input.select(); }, 50);
}

// メモパネルのUI（ボタン・スウォッチ）をApp.textOptionsと同期
function syncMemoPanelUI() {
  const { fontSize, color, bgColor, boxStyle } = App.textOptions;
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
}

function commitTextInput() {
  const input = document.getElementById('memo-input');
  const text = input.value.trim();
  if (text && App.pendingTextPos) {
    saveState();
    const opts = App.textOptions;
    if (App.editingTextId !== null) {
      // 既存テキストを更新
      const t = App.texts.find(x => x.id === App.editingTextId);
      if (t) {
        t.text = text;
        t.fontSize = opts.fontSize;
        t.color = opts.color;
        t.bgColor = opts.bgColor;
        t.boxStyle = opts.boxStyle || 'box';
      }
      App.editingTextId = null;
    } else if (App.pendingCalloutTip) {
      // 引出線
      App.texts.push({
        id: App.nextId++,
        type: 'callout',
        tipX: App.pendingCalloutTip.x, tipY: App.pendingCalloutTip.y,
        x: App.pendingTextPos.x, y: App.pendingTextPos.y,
        text, fontSize: opts.fontSize,
        color: opts.color, bgColor: opts.bgColor, boxStyle: opts.boxStyle || 'box',
      });
      App.pendingCalloutTip = null;
    } else {
      // 通常メモ
      App.texts.push({
        id: App.nextId++,
        x: App.pendingTextPos.x, y: App.pendingTextPos.y,
        text, fontSize: opts.fontSize,
        color: opts.color, bgColor: opts.bgColor, boxStyle: opts.boxStyle || 'box',
      });
    }
    updateResults();
  }
  document.getElementById('memo-panel').classList.add('hidden');
  input.value = '';
  App.pendingTextPos = null;
  App.pendingCalloutTip = null;
  App.dirty = true;
}

function cancelTextInput() {
  document.getElementById('memo-panel').classList.add('hidden');
  document.getElementById('memo-input').value = '';
  App.pendingTextPos = null;
  App.pendingCalloutTip = null;
  App.editingTextId = null;
}

// ===== 結果リスト =====
function updateResults() {
  const list = document.getElementById('results-list');
  const empty = document.getElementById('results-empty');
  list.innerHTML = '';
  const total = App.items.length + App.texts.length;

  if (total === 0) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  const typeLabel = { distance: '直線距離', polyline: '折れ線距離', area: '面積', text: 'メモ', arrow: '矢印', callout: '引出線' };

  const measureItems = App.items.map((item, i) => ({ ...item, _isText: false }));
  const textItems    = App.texts.map(t => ({
    ...t,
    type: t.type || 'text',
    label: t.text.slice(0, 20) + (t.text.length > 20 ? '…' : ''),
    color: t.color || '#fbbf24',
    _isText: true,
  }));

  [...measureItems, ...textItems].forEach((item) => {
    const div = document.createElement('div');
    div.className = 'result-item';
    const editBtn = item._isText
      ? `<button class="btn-edit-text" data-id="${item.id}" title="編集">✏</button>`
      : '';
    div.innerHTML = `
      <div class="result-header">
        <span class="result-dot" style="background:${item.color};cursor:pointer" data-id="${item.id}" data-istext="${item._isText}" title="色を変更"></span>
        <span class="result-title">${typeLabel[item.type] || item.type}</span>
        ${editBtn}
        <button class="btn-delete" data-id="${item.id}" data-istext="${item._isText}">✕</button>
      </div>
      <div class="result-value">${item.label}</div>
    `;
    list.appendChild(div);
  });

  // 削除ボタン
  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      saveState();
      if (btn.dataset.istext === 'true') {
        App.texts = App.texts.filter(t => t.id !== id);
      } else {
        App.items = App.items.filter(i => i.id !== id);
      }
      updateResults();
      App.dirty = true;
    });
  });

  // テキスト編集ボタン
  list.querySelectorAll('.btn-edit-text').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      const t = App.texts.find(x => x.id === id);
      if (!t) return;
      App.editingTextId = id;
      // テキストオプションを現在の値に合わせる
      App.textOptions.fontSize = t.fontSize || 14;
      App.textOptions.color    = t.color    || '#1a1a1a';
      App.textOptions.bgColor  = t.bgColor  || 'rgba(255,255,220,0.92)';
      App.textOptions.boxStyle = t.boxStyle  || 'box';
      syncMemoPanelUI();
      // キャンバス中央付近に表示
      const cx = canvas.getBoundingClientRect().left + canvas.width / 2;
      const cy = canvas.getBoundingClientRect().top  + canvas.height / 2;
      App.pendingTextPos = { x: t.x, y: t.y };
      showTextInputAt(cx, cy, t.text);
    });
  });

  // カラードット → カラーピッカー
  list.querySelectorAll('.result-dot[data-id]').forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      App.cpTargetId     = parseInt(dot.dataset.id);
      App.cpTargetIsText = dot.dataset.istext === 'true';
      const popup = document.getElementById('color-picker-popup');
      popup.style.left = (e.clientX + 4) + 'px';
      popup.style.top  = (e.clientY + 4) + 'px';
      popup.classList.remove('hidden');
    });
  });
}

// ===== ページ移動 =====
function updatePageInfo() {
  document.getElementById('page-info').textContent = `${App.pageNum} / ${App.pageCount}`;
  document.getElementById('btn-prev').disabled = App.pageNum <= 1;
  document.getElementById('btn-next').disabled = App.pageNum >= App.pageCount;
}

async function changePage(delta) {
  const p = App.pageNum + delta;
  if (p < 1 || p > App.pageCount) return;
  App.pageNum = p;
  App.pdfReady = false;
  clearMeasurements(false);
  await renderPDFPage(p);
}

// ===== 縮尺設定 =====
function applyManualScale() {
  const val = parseInt(document.getElementById('scale-input').value);
  if (!val || val <= 0) { alert('正しい縮尺を入力してください'); return; }
  setMapScale(val);
  setScaleDisplay(`縮尺 1/${val} (手動設定)`);
  document.getElementById('calibration-modal').classList.add('hidden');
}

function startCalibration() {
  document.getElementById('calibration-modal').classList.add('hidden');
  App.calibrating = true;
  App.calibPts = [];
  App.dirty = true;
  alert('地図上の2点をクリックしてください（距離がわかる2点の両端）');
}

function applyCalibrationDist() {
  const d = parseFloat(document.getElementById('calibration-dist-input').value);
  if (!d || d <= 0) { alert('正しい距離を入力してください'); return; }
  commitCalibrationDist(d);
}

function commitCalibrationDist(d) {
  if (App.calibPts.length < 2) { alert('先に2点をクリックしてください'); return; }
  const px = dist(App.calibPts[0], App.calibPts[1]);
  if (px === 0) { alert('2点が同じ位置です'); return; }
  App.mpp = d / px;
  App.mapScale = Math.round(App.mpp * 72 * App.renderScale * 1000 / 25.4);
  setScaleDisplay(`縮尺 1/${App.mapScale} (キャリブレーション)`);
  document.getElementById('calibration-dist-modal').classList.add('hidden');
  document.getElementById('calibration-dist-input').value = '';
  App.calibPts = [];
  App.dirty = true;
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
async function saveProjectJSON() {
  const data = {
    version: 3,
    savedAt: new Date().toISOString(),
    mpp: App.mpp,
    mapScale: App.mapScale,
    vx: App.vx, vy: App.vy, vz: App.vz,
    pageNum: App.pageNum,
    isImageMode: App.isImageMode,
    lots: App.lots,
    lotNextNum: App.lotNextNum,
    lotBorderColor: App.lotBorderColor,
    paperMode: App.paperMode,
    paperSize: App.paperSize,
    paperW: App.paperW, paperH: App.paperH,
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
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const dt = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url; a.download = `kozu-project-${dt}.json`; a.click();
  URL.revokeObjectURL(url);
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
        App.pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        App.pageCount = App.pdf.numPages;
        App.pageNum = data.pageNum || 1;
        document.getElementById('page-nav').classList.remove('hidden');
        await renderPDFPage(App.pageNum);
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
      if (data.vx != null) { App.vx = data.vx; App.vy = data.vy; App.vz = data.vz; }
      App.lots       = data.lots       || [];
      App.lotNextNum = data.lotNextNum || 1;
      if (data.lotBorderColor) App.lotBorderColor = data.lotBorderColor;
      if (data.paperMode != null) {
        App.paperMode = data.paperMode;
        App.paperSize = data.paperSize || 'A4';
        // 保存データが古い場合はrenderScaleから再計算
        const d = getPaperDims(App.paperSize);
        App.paperW = (data.paperW && data.paperW > 1000) ? data.paperW : d.w;
        App.paperH = (data.paperH && data.paperH > 700)  ? data.paperH : d.h;
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
    } catch (err) { alert('読み込みに失敗しました: ' + err.message); }
  };
  reader.readAsText(file);
}

// ===== PDF書き込み保存 =====
async function savePDF() {
  if (!App.pdfBytes) {
    alert('PDF保存はPDFファイルのみ対応しています。\n画像の場合は「印刷」からPDFとして保存してください。');
    return;
  }
  if (App.items.length === 0 && App.texts.length === 0) { alert('計測データがありません'); return; }

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
    alert('PDF保存エラー: ' + e.message);
    console.error(e);
  }
}

// ===== 印刷モーダルを開く =====
function openPrintModal() {
  if (!App.pdfReady) { alert('ファイルを開いてください'); return; }
  document.getElementById('print-modal').classList.remove('hidden');
}

// ===== 印刷 =====
function printMeasurements() {
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
    App.items.forEach(item => drawItem(item, item.color));
    App.texts.forEach(t => drawTextAnnotation(t));
  } else {
    // 本図モード: PDF + 図形を描画
    pc.width = App.pdfOffscreen.width;
    pc.height = App.pdfOffscreen.height;
    ctx = pc.getContext('2d');
    ctx.drawImage(App.pdfOffscreen, 0, 0);
    App.vz = 1; App.vx = 0; App.vy = 0;
    App.labelBoxes = [];
    App.lots.forEach(lot => drawLot(lot));
    App.items.forEach(item => drawItem(item, item.color));
    App.texts.forEach(t => drawTextAnnotation(t));
  }

  ctx = origCtx;
  [App.vz, App.vx, App.vy] = sv;

  const dataUrl = pc.toDataURL('image/png');
  // 用紙モードは用紙サイズ横向き・余白なし、本図モードはA3
  const size = App.paperMode ? `${App.paperSize} landscape` : (App.printSize || 'A3');
  const pageMargin = App.paperMode ? '0' : '10mm';

  const win = window.open('', '_blank');
  if (!win) { alert('ポップアップをブロックしています。許可してください。'); return; }

  win.document.write(`<!DOCTYPE html><html lang="ja"><head>
    <meta charset="UTF-8">
    <title>公図_${getDateTimeStr()}</title>
    <style>
      @page { size: ${size}; margin: ${pageMargin}; }
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
      img { width: 100%; height: 100%; object-fit: contain; display: block; page-break-after: avoid; }
    </style>
  </head><body>
    <img src="${dataUrl}">
    <script>window.onload = function(){ window.print(); }<\/script>
  </body></html>`);
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

// ===== 分譲地ツール =====

function setAppMode(mode) {
  App.appMode = mode;
  const isSub = mode === 'subdivision';
  document.getElementById('tools').classList.toggle('hidden', isSub);
  document.getElementById('tools-subdivision').classList.toggle('hidden', !isSub);
  // 計測パネル: 両モードで表示（分譲地では高さを制限）
  const rm = document.getElementById('results-measure');
  const rs = document.getElementById('results-subdivision');
  rm.classList.remove('hidden');
  rm.style.flex = isSub ? '0 0 auto' : '1';
  rm.style.maxHeight = isSub ? '45%' : '';
  rm.style.overflow = isSub ? 'auto' : '';
  rs.classList.toggle('hidden', !isSub);
  document.getElementById('btn-mode-measure').classList.toggle('active-mode', !isSub);
  document.getElementById('btn-mode-subdivision').classList.toggle('active-mode', isSub);
  if (isSub && App.mode !== 'pan') {
    App.mode = 'draw'; canvas.style.cursor = 'crosshair';
  } else if (!isSub) {
    // 分譲地モードで'draw'になっているので計測モードに戻す
    const measureModes = ['distance','polyline','area','pan','select','text','callout','arrow'];
    if (!measureModes.includes(App.mode)) setMode('distance');
  }
  // サイドバーの幅変化でキャンバスサイズが変わるため再計算（座標ズレ防止）
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
  App.lotTool = tool;
  App.lotPts = [];
  App.pts = [];
  App.parallelBase = null;
  App.mergeSelect = [];
  // 選択分割以外のツールに切り替えたらクリアUIをリセット
  if (tool !== 'split') { App.splitTargetId = null; updateSplitUI(); }
  App.mode = (tool === 'select' || tool === 'label-move' || tool === 'move-all' || tool === 'merge' || tool === 'corner-cut' || tool === 'edge-label-move' || tool === 'delete') ? 'select' : 'draw';
  canvas.style.cursor = tool === 'delete' ? 'not-allowed' : (tool === 'move-all' ? 'grab' : 'crosshair');
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
  ['sub-btn-distance','sub-btn-polyline','sub-btn-area'].forEach(id =>
    document.getElementById(id)?.classList.remove('active'));
  document.getElementById('btn-edge-label-move')?.classList.toggle('active', tool === 'edge-label-move');
  document.getElementById('btn-lot-delete-tool')?.classList.toggle('active', tool === 'delete');
  document.getElementById('btn-lot-select')?.classList.toggle('active', tool === 'select');
  document.getElementById('btn-lot-label-move')?.classList.toggle('active', tool === 'label-move');
  document.getElementById('btn-move-all')?.classList.toggle('active', tool === 'move-all');
  updateHint();
  App.dirty = true;
}

function setSubMeasureMode(mode) {
  App.lotPts = [];
  App.pts = [];
  App.parallelBase = null;
  App.lotTool = 'measure';
  App.mode = mode;
  canvas.style.cursor = 'crosshair';
  ['btn-lot-draw','btn-road-draw','btn-lot-split','sub-btn-parallel'].forEach(id =>
    document.getElementById(id)?.classList.remove('active'));
  document.getElementById('parallel-panel').classList.add('hidden');
  document.querySelectorAll('#tools-subdivision .btn-lot-tool').forEach(b => b.classList.remove('active'));
  ['distance','polyline','area','arrow','text','callout'].forEach(m =>
    document.getElementById(`sub-btn-${m}`)?.classList.toggle('active', m === mode));
  updateHint();
  App.dirty = true;
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
  if (pts.length < 2) { App.dirty = true; return; }
  saveState();
  if (App.lotTool === 'road') {
    App.lots.push({ id: App.nextId++, type: 'road', points: pts, color: '#94a3b8' });
  } else {
    App.lots.push({
      id: App.nextId++, type: 'lot', points: pts,
      lotNum: App.lotNextNum++, price: '', memo: '', color: App.lotStrokeColor,
    });
  }
  updateLotPanel();
  App.dirty = true;
}

function drawLotsLayer() {
  drawDivGuides();
  App.lots.forEach(lot => drawLot(lot));
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
  const opHex = Math.round((App.lotFillOpacity ?? 0.73) * 255).toString(16).padStart(2, '0');
  ctx.fillStyle = isRoad ? (lot.color || '#94a3b8') + opHex : (lot.color || '#bfdbfe') + opHex;
  ctx.fill();
  const isMergeSelected = App.lotTool === 'merge' && App.mergeSelect.includes(lot.id);
  ctx.strokeStyle = isMergeSelected ? '#f59e0b'
    : (isRoad ? (lot.borderColor || '#64748b')
               : (lot.borderColor || App.lotBorderColor || '#1d4ed8'));
  ctx.lineWidth = (isMergeSelected ? 3 : 1.5) / App.vz;
  ctx.stroke();

  // 頂点ドット（スナップON時のみ表示）
  if (App.gridSnap) pts.forEach(p => drawDot(p.x, p.y, 2.5 / App.vz, isRoad ? '#94a3b8' : '#60a5fa'));

  const mpp = App.mpp;
  const cen = centroid(pts);

  if (isRoad) {
    const scale = lot.roadLabelSize || 1.0;
    const fs = pfs(11) * scale;
    const fsW = pfs(9) * scale;
    const text = lot.roadLabel !== undefined ? lot.roadLabel : '道路';
    const lx = cen.x + (lot.labelOffX || 0);
    const ly = cen.y + (lot.labelOffY || 0);
    const textColor = lot.roadLabelColor || '#475569';
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (lot.roadVertical && text.length > 0) {
      const chars = [...text];
      const lineH = fs * 1.3;
      const totalH = chars.length * lineH;
      ctx.font = `bold ${fs}px 'Segoe UI', sans-serif`;
      chars.forEach((ch, i) => {
        ctx.fillText(ch, lx, ly - totalH / 2 + lineH * (i + 0.5));
      });
      // 幅員（縦書きで右横に並べる）
      if (lot.roadWidth) {
        const wChars = [...`幅員${lot.roadWidth}m`];
        const wLineH = fsW * 1.25;
        const wTotalH = wChars.length * wLineH;
        ctx.font = `${fsW}px 'Segoe UI', sans-serif`;
        wChars.forEach((ch, i) => {
          ctx.fillText(ch, lx + fs * 1.3, ly - wTotalH / 2 + wLineH * (i + 0.5));
        });
      }
    } else {
      ctx.font = `bold ${fs}px 'Segoe UI', sans-serif`;
      ctx.fillText(text, lx, lot.roadWidth ? ly - fsW * 0.7 : ly);
      if (lot.roadWidth) {
        ctx.font = `${fsW}px 'Segoe UI', sans-serif`;
        ctx.fillText(`幅員 ${lot.roadWidth}m`, lx, ly + fs * 0.8);
      }
    }
    // セットバック表示
    if (lot.setback) {
      const sbDef = fs * 2.8;
      const sbX = cen.x + (lot.setbackOffX || 0);
      const sbY = cen.y + (lot.setbackOffY != null ? lot.setbackOffY : sbDef);
      const fsSb = pfs(9) * scale;
      ctx.font = `bold ${fsSb}px 'Segoe UI', sans-serif`;
      ctx.fillStyle = '#dc2626';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('☒ 要セットバック', sbX, sbY);
    }
    return;
  }

  // 面積
  const sqm = mpp ? shoelace(pts) * mpp * mpp : null;
  const ts = App.lotTextScale || 1.0;
  const fsNum = pfs(14) * ts;
  const fsSm  = pfs(9)  * ts;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  const lines = [
    { text: circleNum(lot.lotNum), fs: fsNum, color: '#1d4ed8' },
    ...(sqm ? [
      { text: sqm.toFixed(1) + '㎡', fs: fsSm, color: '#1e293b' },
      { text: (sqm * 0.3025).toFixed(1) + '坪', fs: fsSm, color: '#475569' },
    ] : []),
    ...(lot.price ? [{ text: lot.price, fs: fsSm * 0.9, color: '#b45309' }] : []),
    ...(lot.memo  ? [{ text: lot.memo,  fs: fsSm * 0.85, color: '#64748b' }] : []),
  ];

  const lx = cen.x + (lot.labelOffX || 0);
  const ly = cen.y + (lot.labelOffY || 0);
  const lineH = fsNum * 1.1;
  const smH   = fsSm * 1.3;
  let totalH = lineH + (lines.length - 1) * smH;
  let cy = ly - totalH / 2 + lineH / 2;
  lines.forEach((ln, i) => {
    ctx.font = `bold ${ln.fs}px 'Segoe UI', sans-serif`;
    ctx.fillStyle = ln.color;
    ctx.fillText(ln.text, lx, cy);
    cy += i === 0 ? lineH : smH;
  });

  // 辺の寸法テキスト（辺と平行・辺の外側にオフセット）
  if (mpp && App.lotShowEdgeLengths) {
    const scale = App.lotEdgeScale || 1.0;
    const fsE = pfs(7.5) * scale;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const p1 = pts[i], p2 = pts[j];
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      // 辺の外向き法線（重心から離れる方向）
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      let nx = -uy, ny = ux;
      if ((cen.x - mx) * nx + (cen.y - my) * ny > 0) { nx = -nx; ny = -ny; }
      // テキストの高さ分だけ外側にずらして辺と被らないようにする
      const offset = fsE * 0.75;
      const userOff = (lot.edgeLabelOffsets && lot.edgeLabelOffsets[i]) || { dx: 0, dy: 0 };
      ctx.save();
      ctx.translate(mx + nx * offset + userOff.dx, my + ny * offset + userOff.dy);
      let angle = Math.atan2(uy, ux);
      if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
      ctx.rotate(angle);
      ctx.font = `${fsE}px 'Segoe UI', sans-serif`;
      ctx.fillStyle = '#334155';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((len * mpp).toFixed(2) + 'm', 0, 0);
      ctx.restore();
    }
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
  const lotSnap = snapPoint(App.mx, App.my);
  const mx = lotSnap.pt.x;
  const my = lotSnap.pt.y;

  // 確定済み辺を実線で描画
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = isRoad ? '#94a3b8' : '#3b82f6';
  ctx.lineWidth = 2 / App.vz;
  ctx.setLineDash([]);
  ctx.stroke();

  // マウス位置への破線プレビュー
  ctx.beginPath();
  ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.lineTo(mx, my);
  ctx.setLineDash([6 / App.vz, 3 / App.vz]);
  ctx.strokeStyle = isRoad ? '#94a3b8' : '#3b82f6';
  ctx.stroke();
  ctx.setLineDash([]);

  // 閉じるプレビュー（最初の点への破線）
  if (pts.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(pts[0].x, pts[0].y);
    ctx.setLineDash([3 / App.vz, 4 / App.vz]);
    ctx.strokeStyle = isRoad ? 'rgba(148,163,184,0.5)' : 'rgba(59,130,246,0.5)';
    ctx.stroke();
    ctx.setLineDash([]);

    // ポリゴン内部を半透明塗り
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineTo(mx, my);
    ctx.closePath();
    ctx.fillStyle = isRoad ? 'rgba(148,163,184,0.15)' : 'rgba(59,130,246,0.1)';
    ctx.fill();
  }

  // 頂点ドット
  pts.forEach(p => drawDot(p.x, p.y, 4 / App.vz, isRoad ? '#94a3b8' : '#3b82f6'));
  // マウス位置の点
  drawDot(mx, my, 3 / App.vz, isRoad ? '#94a3b8' : '#60a5fa');
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
    ctx.font = `${fsE}px 'Segoe UI', sans-serif`;
    ctx.fillStyle = isRoad ? '#cbd5e1' : '#93c5fd';
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

  // リアルタイム面積表示（3点以上のとき）
  if (pts.length >= 2 && App.mpp) {
    const preview = [...pts, { x: mx, y: my }];
    const sqm = shoelace(preview) * App.mpp * App.mpp;
    if (sqm > 0) {
      const cen = centroid(preview);
      const label = `${sqm.toFixed(1)}㎡`;
      const fs = 11 / App.vz;
      ctx.font = `bold ${fs}px 'Segoe UI', sans-serif`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(15,23,42,0.75)';
      ctx.fillRect(cen.x - tw / 2 - 4 / App.vz, cen.y - fs, tw + 8 / App.vz, fs * 1.8);
      ctx.fillStyle = '#60a5fa';
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
      drawDot(App.pts[0].x, App.pts[0].y, 4 / App.vz, '#a78bfa');
    }
    // □インジケーター
    drawDot(smx, smy, 3 / App.vz, '#a78bfa');
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
  drawDot(pp1.x, pp1.y, 3 / App.vz, '#a78bfa');
  drawDot(pp2.x, pp2.y, 3 / App.vz, '#a78bfa');

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
  // 頂点を丸でハイライト
  const r = 5 / App.vz;
  lot.points.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#f97316';
    ctx.fill();
  });
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
  pts.forEach(p => drawDot(p.x, p.y, 4 / App.vz, '#ef4444'));
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
  if (!App.mpp) { alert('縮尺を設定してください'); return; }

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
      alert('分割結果が正しくない形状になります。\n分割線を区画の端から端まで通してください。');
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
    const memo = lot.memo ? `<div class="lot-memo">${lot.memo}</div>` : '';
    return `<tr class="lot-data-row" data-id="${lot.id}">
      <td class="lp-num"><span class="lot-num-badge">${circleNum(lot.lotNum)}</span></td>
      <td class="lp-sqm">${sqmStr}</td>
      <td class="lp-tsubo">${tsuboStr}</td>
      <td class="lp-price">${priceStr}</td>
      <td class="lp-actions">
        <button class="btn-lot-edit" data-id="${lot.id}">✏</button>
        <button class="btn-lot-delete" data-id="${lot.id}">✕</button>
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
      const label = r.lotNum === 0 ? '隅切' : '道路';
      return `<tr class="lp-road-row">
        <td><span class="lot-num-badge" style="background:#1e293b;color:#64748b;border-color:#334155">${label}</span></td>
        <td>${sqm ? sqm.toFixed(1) : '-'}</td>
        <td>${tsubo || '-'}</td>
        <td></td>
        <td><button class="btn-lot-delete" data-id="${r.id}">✕</button></td>
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
      updateLotPanel(); App.dirty = true;
    });
  });
}

// 区画編集モーダル
let _editingLotId = null;

function openLotEditor(id) {
  const lot = App.lots.find(l => l.id === id);
  if (!lot) return;
  _editingLotId = id;
  const isRoad = lot.type === 'road';
  // タイトル
  document.getElementById('lot-edit-num').textContent = isRoad ? '道路' : circleNum(lot.lotNum);
  // セクション表示切替
  document.getElementById('lot-edit-lot-sections').classList.toggle('hidden', isRoad);
  document.getElementById('lot-edit-road-section').classList.toggle('hidden', !isRoad);
  if (isRoad) {
    document.getElementById('lot-edit-road-label').value = lot.roadLabel !== undefined ? lot.roadLabel : '道路';
    document.getElementById('lot-edit-road-vertical').checked = !!lot.roadVertical;
    document.getElementById('lot-edit-road-setback').checked = !!lot.setback;
    document.getElementById('lot-edit-road-width').value = lot.roadWidth || '';
    const ls = lot.roadLabelSize || 1.0;
    document.getElementById('lot-edit-road-label-size').value = ls;
    document.getElementById('lot-edit-road-label-size-val').textContent = ls.toFixed(1) + '×';
    const tc = lot.roadLabelColor || '#475569';
    document.querySelectorAll('.road-text-swatch').forEach(s => {
      s.classList.toggle('active-road-text', s.dataset.tc === tc);
      s.style.border = s.dataset.tc === tc ? '2px solid #60a5fa' : (s.dataset.tc === '#f1f5f9' || s.dataset.tc === '#e2e8f0' ? '2px solid #475569' : '2px solid transparent');
    });
    const fc = lot.color || '#94a3b8';
    document.querySelectorAll('.road-fill-swatch').forEach(s => {
      s.classList.toggle('active-road-fill', s.dataset.fc === fc);
      const isLight = s.dataset.fc === '#e2e8f0' || s.dataset.fc === '#f8fafc' || s.dataset.fc === '#cbd5e1';
      s.style.border = s.dataset.fc === fc ? '2px solid #60a5fa' : (isLight ? '2px solid #94a3b8' : '2px solid transparent');
    });
  } else {
    const sqm = (App.mpp && lot.points && lot.points.length >= 3)
      ? (shoelace(lot.points) * App.mpp * App.mpp).toFixed(1) : null;
    const areaEl = document.getElementById('lot-edit-area');
    if (areaEl) areaEl.textContent = sqm ? `${sqm}㎡ / ${(sqm * 0.3025).toFixed(1)}坪` : '縮尺未設定';
    const priceNum = lot.price ? lot.price.replace(/[^0-9]/g, '') : '';
    document.getElementById('lot-edit-price').value = priceNum ? Number(priceNum).toLocaleString() : '';
    document.getElementById('lot-edit-memo').value = lot.memo || '';
    document.querySelectorAll('#lot-color-swatches .color-swatch').forEach(sw => {
      sw.classList.toggle('active-swatch', sw.dataset.lotcolor === lot.color);
    });
    // 線の色
    const bc = lot.borderColor || App.lotBorderColor || '#1d4ed8';
    document.querySelectorAll('#lot-border-swatches .border-swatch').forEach(sw => {
      const isSel = sw.dataset.bc === bc;
      sw.style.outline = isSel ? '2px solid #60a5fa' : 'none';
      sw.classList.toggle('active-border', isSel);
    });
  }
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
  if (lots.length === 0) { alert('区画がありません'); return; }

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
  alert('面積リストを図面に配置しました。「移動」ツールで位置を調整できます。');
}

// ===== 買取積算を図面にスタンプ =====
function stampKaitori() {
  const g = id => document.getElementById(id);
  const sqm  = parseFloat(g('kai-sqm').value) || 0;
  const tsubo = sqm / 3.30579;
  const tsuboPrice   = parseFloat(g('kai-tsubo-price').value) || 0;
  const salePrice    = Math.round(tsubo * tsuboPrice);
  const koseiPerTsubo = parseFloat(g('kai-kosei').value) || 0;
  const kosei   = Math.round(tsubo * koseiPerTsubo);
  const sokuryo = parseFloat(g('kai-sokuryo').value) || 0;
  const kaitai  = parseFloat(g('kai-kaitai').value) || 0;
  const chukai  = Math.round(salePrice * 0.03 + 6);
  const other1  = parseFloat(g('kai-other1').value) || 0;
  const other2  = parseFloat(g('kai-other2').value) || 0;
  const marginRate = parseFloat(g('kai-margin').value) || 0;
  const profit  = Math.round(salePrice * marginRate / 100);
  const expTotal = kosei + sokuryo + kaitai + chukai + other1 + other2;
  const kaitori = salePrice - expTotal - profit;

  const rows = [
    ['土地面積', `${tsubo.toFixed(1)}坪 (${sqm.toFixed(1)}㎡)`],
    ['販売想定(坪単価)', `${tsuboPrice.toLocaleString()}万円/坪`],
    ['想定売価', `${salePrice.toLocaleString()}万円`],
    koseiPerTsubo > 0 ? ['造成費(坪単価)', `${koseiPerTsubo}万/坪→${kosei.toLocaleString()}万円`] : null,
    sokuryo > 0 ? ['測量費', `${sokuryo.toLocaleString()}万円`] : null,
    kaitai  > 0 ? ['解体費', `${kaitai.toLocaleString()}万円`]  : null,
    ['仲介手数料(自動)', `${chukai.toLocaleString()}万円`],
    other1  > 0 ? ['その他①', `${other1.toLocaleString()}万円`] : null,
    other2  > 0 ? ['その他②', `${other2.toLocaleString()}万円`] : null,
    ['経費合計', `${expTotal.toLocaleString()}万円`],
    [`粗利(${marginRate}%)`, `${profit.toLocaleString()}万円`],
  ].filter(Boolean);

  const cx = (24 - App.vx) / App.vz;
  const cy = (80 - App.vy) / App.vz;
  saveState();
  App.texts.push({
    id: App.nextId++,
    x: cx, y: cy,
    textType: 'lot-table',
    title: '買取価格積算',
    headers: ['項目', '金額'],
    rows,
    totalRow: ['買取価格', `${kaitori.toLocaleString()}万円`],
    totalRowColor: '#dcfce7',
    totalTextColor: '#15803d',
    fontSize: 11,
    color: '#1a1a1a',
    bgColor: 'rgba(255,255,255,0.97)',
  });
  document.getElementById('kaitori-modal').classList.add('hidden');
  App.dirty = true;
}

function commitLotEdit() {
  const lot = App.lots.find(l => l.id === _editingLotId);
  if (!lot) { document.getElementById('lot-edit-modal').classList.add('hidden'); return; }
  saveState();
  if (lot.type === 'road') {
    lot.roadLabel    = document.getElementById('lot-edit-road-label').value;
    lot.roadVertical = document.getElementById('lot-edit-road-vertical').checked;
    lot.setback      = document.getElementById('lot-edit-road-setback').checked;
    lot.roadWidth    = parseFloat(document.getElementById('lot-edit-road-width').value) || null;
    lot.roadLabelSize = parseFloat(document.getElementById('lot-edit-road-label-size').value) || 1.0;
    const selTc = document.querySelector('.road-text-swatch.active-road-text');
    lot.roadLabelColor = selTc ? selTc.dataset.tc : '#475569';
    const selFc = document.querySelector('.road-fill-swatch.active-road-fill');
    lot.color = selFc ? selFc.dataset.fc : '#94a3b8';
  } else {
    const rawPrice = document.getElementById('lot-edit-price').value.replace(/[^0-9]/g, '');
    lot.price = rawPrice ? Number(rawPrice).toLocaleString() + '万円' : '';
    lot.memo  = document.getElementById('lot-edit-memo').value.trim();
    const sel = document.querySelector('#lot-color-swatches .color-swatch.active-swatch');
    if (sel) lot.color = sel.dataset.lotcolor;
    const selB = document.querySelector('#lot-border-swatches .border-swatch.active-border');
    if (selB) lot.borderColor = selB.dataset.bc;
  }
  document.getElementById('lot-edit-modal').classList.add('hidden');
  updateLotPanel(); App.dirty = true;
}

// ===== 買取価格積算 =====
function openKaitoriModal() {
  // 総面積を自動セット
  const lots = App.lots.filter(l => l.type === 'lot');
  let totalSqm = 0;
  if (App.mpp) {
    lots.forEach(l => {
      if (l.points && l.points.length >= 3) totalSqm += shoelace(l.points) * App.mpp * App.mpp;
    });
  }
  if (totalSqm > 0) {
    document.getElementById('kai-sqm').value = totalSqm.toFixed(2);
  }
  calcKaitori();
  document.getElementById('kaitori-modal').classList.remove('hidden');
}

function calcKaitori() {
  const sqm = parseFloat(document.getElementById('kai-sqm').value) || 0;
  const tsubo = sqm / 3.30579;
  document.getElementById('kai-tsubo').textContent = tsubo.toFixed(2) + '坪';

  const tsuboPrice = parseFloat(document.getElementById('kai-tsubo-price').value) || 0;
  const salePrice = Math.round(tsubo * tsuboPrice);
  document.getElementById('kai-sale-price').textContent = salePrice.toLocaleString() + '万円';

  const koseiPerTsubo = parseFloat(document.getElementById('kai-kosei').value) || 0;
  const kosei = Math.round(tsubo * koseiPerTsubo);
  document.getElementById('kai-kosei-total').textContent = kosei.toLocaleString() + '万円';
  const sokuryo = parseFloat(document.getElementById('kai-sokuryo').value) || 0;
  const kaitai  = parseFloat(document.getElementById('kai-kaitai').value) || 0;
  const chukaiRaw = salePrice * 0.03 + 6;
  const chukai = Math.round(chukaiRaw);
  document.getElementById('kai-chukai').textContent = chukai.toLocaleString() + '万円';
  const other1 = parseFloat(document.getElementById('kai-other1').value) || 0;
  const other2 = parseFloat(document.getElementById('kai-other2').value) || 0;
  const expTotal = kosei + sokuryo + kaitai + chukai + other1 + other2;
  document.getElementById('kai-exp-total').textContent = expTotal.toLocaleString() + '万円';

  const marginRate = parseFloat(document.getElementById('kai-margin').value) || 0;
  const profit = Math.round(salePrice * marginRate / 100);
  document.getElementById('kai-profit').textContent = profit.toLocaleString() + '万円';

  const kaitori = salePrice - expTotal - profit;
  document.getElementById('kai-result').textContent = kaitori.toLocaleString() + '万円';
}

// 自動生成フォームの値を同期
