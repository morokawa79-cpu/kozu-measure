(() => {
  'use strict';

  const VERSION = '2.0.0-alpha.2';
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }
  const DEFAULT_STYLE = Object.freeze({
    fill: '#fff0bd',
    stroke: '#9a6700',
    opacity: 0.52,
    showArea: true,
    showLengths: false,
    approximate: false,
    decimals: 2,
  });
  const DEFAULT_LABEL_STYLE = Object.freeze({
    font: 'gothic',
    size: 13,
    color: '#3d310d',
    angle: 0,
    vertical: false,
    offsetX: 0,
    offsetY: 0,
  });
  const DEFAULT_DIMENSION_STYLE = Object.freeze({
    size: 10.5,
    color: '#38424c',
    offset: 10,
    rotate: true,
  });
  const FONT_PRESETS = Object.freeze({
    gothic: { label: 'ゴシック', css: '"Yu Gothic UI",Meiryo,sans-serif' },
    meiryo: { label: 'メイリオ', css: 'Meiryo,"Yu Gothic UI",sans-serif' },
    mincho: { label: '明朝', css: '"Yu Mincho",YuMincho,serif' },
  });
  const SHAPE_PRESETS = Object.freeze([
    { key: 'yellow', label: '薄黄', fill: '#fff0bd', stroke: '#9a6700' },
    { key: 'green', label: '薄緑', fill: '#d8f0dd', stroke: '#37754b' },
    { key: 'blue', label: '薄青', fill: '#d9e9f5', stroke: '#315f83' },
    { key: 'pink', label: '薄桃', fill: '#f6dfca', stroke: '#9b542b' },
  ]);
  const TEXT_COLORS = Object.freeze([
    { label: '濃茶', value: '#3d310d' },
    { label: '黒', value: '#17202a' },
    { label: '灰', value: '#4b5563' },
    { label: '青', value: '#15579b' },
    { label: '赤', value: '#a82121' },
    { label: '緑', value: '#176b48' },
  ]);
  const PDFJS_OPTIONS = {
    cMapUrl: 'pdfres://cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'pdfres://standard_fonts/',
  };
  const PDF_RENDER_SCALE = 4;
  const HISTORY_LIMIT = 100;

  const $ = (id) => document.getElementById(id);
  const canvas = $('drawing-canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const stage = $('drawing-stage');
  const controls = $('command-controls');
  const commandName = $('command-name');
  const underlayInput = $('underlay-input');
  const projectInput = $('project-input');
  const underlayCanvas = document.createElement('canvas');
  const underlayCtx = underlayCanvas.getContext('2d');

  const state = {
    command: 'underlay',
    commandEpoch: 0,
    view: { x: 18, y: 18, zoom: 1 },
    pointer: { x: 0, y: 0, worldX: 0, worldY: 0, inside: false },
    underlay: {
      ready: false,
      visible: true,
      opacity: 0.68,
      type: null,
      name: '',
      pdf: null,
      pdfBytes: null,
      page: 1,
      pages: 0,
      renderTask: null,
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    },
    lots: [],
    nextId: 1,
    nextNum: 1,
    mpp: null,
    selectedId: null,
    draft: [],
    calibrationPoints: [],
    calibrationDistance: '',
    hoverSnap: null,
    drag: null,
    labelDrag: null,
    panning: null,
    spaceDown: false,
    style: { ...DEFAULT_STYLE },
    gridVisible: false,
    helpMode: false,
    pendingConfirm: null,
    history: [],
    future: [],
    dirty: false,
    documentName: '無題',
    drawQueued: false,
    noticeTimer: 0,
    noticeMessage: '',
    noticeType: 'info',
  };

  const COMMAND_LABELS = {
    select: '選択',
    parcel: '区画',
    vertex: '頂点編集',
    delete: '消去',
    underlay: '下絵',
    calibrate: '縮尺設定',
    label: '文字調整',
    dimension: '寸法調整',
  };
  const SELECTION_COMMANDS = Object.freeze(['select', 'vertex', 'label', 'dimension', 'delete']);

  const clone = (value) => {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  };

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const safeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const samePoint = (a, b, tolerance = 1e-6) => !!a && !!b && distance(a, b) <= tolerance;
  const activeLot = () => state.lots.find((lot) => lot.id === state.selectedId) || null;

  function interactionSnapshot() {
    return {
      lots: clone(state.lots),
      nextId: state.nextId,
      nextNum: state.nextNum,
      mpp: state.mpp,
    };
  }

  function restoreSnapshot(snapshot) {
    state.lots = clone(snapshot.lots || []);
    state.nextId = snapshot.nextId || 1;
    state.nextNum = snapshot.nextNum || 1;
    state.mpp = snapshot.mpp ?? null;
    state.selectedId = null;
    resetTransient();
    setDirty(true);
    updateChrome();
    renderControls();
    scheduleDraw();
  }

  function pushHistory(snapshot = interactionSnapshot()) {
    state.history.push(snapshot);
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
    state.future.length = 0;
  }

  function undo() {
    if (!state.history.length) {
      notice('これ以上戻れません');
      return;
    }
    state.future.push(interactionSnapshot());
    restoreSnapshot(state.history.pop());
  }

  function redo() {
    if (!state.future.length) {
      notice('これ以上進めません');
      return;
    }
    state.history.push(interactionSnapshot());
    restoreSnapshot(state.future.pop());
  }

  function setDirty(value) {
    state.dirty = !!value;
    $('dirty-mark').hidden = !state.dirty;
  }

  function setDocumentName(name) {
    state.documentName = name || '無題';
    $('document-name').textContent = state.documentName;
  }

  function resetTransient({ keepSelection = false } = {}) {
    state.commandEpoch += 1;
    state.draft = [];
    state.calibrationPoints = [];
    state.calibrationDistance = '';
    state.hoverSnap = null;
    state.drag = null;
    state.labelDrag = null;
    state.panning = null;
    if (!keepSelection) state.selectedId = null;
  }

  function setCommand(command, options = {}) {
    if (!COMMAND_LABELS[command]) return;
    const preserveSelection = options.keepSelection === true ||
      (SELECTION_COMMANDS.includes(state.command) && SELECTION_COMMANDS.includes(command));
    resetTransient({ keepSelection: preserveSelection });
    state.helpMode = false;
    state.pendingConfirm = null;
    state.command = command;
    commandName.textContent = COMMAND_LABELS[command];
    document.querySelectorAll('[data-command]').forEach((button) => {
      button.classList.toggle('active', button.dataset.command === command && button.closest('.tool-rail'));
    });
    canvas.dataset.cursor = commandCursor(command);
    renderControls();
    updateStatus();
    canvas.focus({ preventScroll: true });
    scheduleDraw();
  }

  function commandCursor(command = state.command) {
    if (['select', 'dimension'].includes(command)) return 'select';
    if (command === 'label') return 'label';
    if (command === 'vertex') return 'vertex';
    return 'crosshair';
  }

  function updateChrome() {
    $('status-count').textContent = `区画 ${state.lots.length}`;
    $('status-scale').textContent = state.mpp ? `縮尺 ${state.mpp.toFixed(4)} m/px` : '縮尺 未設定';
    $('status-zoom').textContent = `${Math.round(state.view.zoom * 100)}%`;
    $('empty-guide').hidden = state.underlay.ready || state.lots.length > 0;
    setDocumentName(state.documentName);
  }

  function iconMarkup(name) {
    return `<svg class="mini-icon" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
  }

  function checkMarkup(label, key, value, title = '') {
    return `<label class="check-control"${title ? ` title="${escapeHtml(title)}"` : ''}><input type="checkbox" data-check="${key}" ${value ? 'checked' : ''}><span>${escapeHtml(label)}</span></label>`;
  }

  function shapePreset(currentFill) {
    return SHAPE_PRESETS.find((preset) => preset.fill.toLowerCase() === String(currentFill || '').toLowerCase()) || SHAPE_PRESETS[0];
  }

  function shapeMarkup(scope, currentFill) {
    const current = shapePreset(currentFill);
    const options = SHAPE_PRESETS.map((preset) => `<option value="${preset.key}" ${preset.key === current.key ? 'selected' : ''}>${preset.label}</option>`).join('');
    return `<span class="control-label">塗り</span><span class="color-chip" style="--chip:${current.fill}"></span><select class="ctrl-select compact" data-style-preset="${scope}" title="区画の塗り色">${options}</select>`;
  }

  function textColorMarkup(field, current) {
    const options = TEXT_COLORS.map((item) => `<option value="${item.value}" ${item.value.toLowerCase() === String(current || '').toLowerCase() ? 'selected' : ''}>${item.label}</option>`).join('');
    return `<span class="color-chip" style="--chip:${escapeHtml(current)}"></span><select class="ctrl-select compact" data-field="${field}" title="文字色">${options}</select>`;
  }

  function fontMarkup(current) {
    return `<select class="ctrl-select font-select" data-field="label-font" title="書体">${Object.entries(FONT_PRESETS).map(([key, value]) => `<option value="${key}" ${key === current ? 'selected' : ''}>${value.label}</option>`).join('')}</select>`;
  }

  function mergedLabelStyle(lot) {
    return { ...DEFAULT_LABEL_STYLE, ...(lot?.labelStyle || {}) };
  }

  function mergedDimensionStyle(lot) {
    return { ...DEFAULT_DIMENSION_STYLE, ...(lot?.dimensionStyle || {}) };
  }

  function renderControls() {
    if (state.helpMode) {
      controls.innerHTML = `<div class="control-group"><strong>基本操作</strong>　L=任意点　R=頂点・辺の読取　ホイール=拡大縮小　中ドラッグ=移動　Enter=確定　Backspace=1点戻す　Esc=取消</div><div class="control-group"><button class="ctrl-btn primary" type="button" data-action="close-help">閉じる</button></div>`;
      return;
    }
    if (state.pendingConfirm) {
      controls.innerHTML = `<div class="control-group"><strong>未保存の変更があります</strong></div><div class="control-group"><button class="ctrl-btn" type="button" data-action="cancel-pending">中止</button><button class="ctrl-btn danger" type="button" data-action="confirm-pending">保存せず続ける</button></div>`;
      return;
    }

    const selected = activeLot();
    if (state.command === 'parcel') {
      controls.innerHTML = `
        <div class="control-group"><span class="control-label">点</span><strong>${state.draft.length}</strong><button class="ctrl-btn" type="button" data-action="back-point" ${state.draft.length ? '' : 'disabled'}>${iconMarkup('back')}戻す</button><button class="ctrl-btn" type="button" data-action="clear-draft" ${state.draft.length ? '' : 'disabled'}>${iconMarkup('cancel')}取消</button><button class="ctrl-btn primary" type="button" data-action="finish-draft" ${state.draft.length >= 3 ? '' : 'disabled'}>${iconMarkup('check')}確定</button></div>
        <div class="control-group">${shapeMarkup('draft', state.style.fill)}</div>
        <div class="control-group checks">${checkMarkup('面積', 'showArea', state.style.showArea)}${checkMarkup('辺長', 'showLengths', state.style.showLengths)}${checkMarkup('約', 'approximate', state.style.approximate)}</div>`;
    } else if (state.command === 'select') {
      controls.innerHTML = selected ? `
        <div class="control-group"><label class="control-label" for="selected-label">名称</label><input id="selected-label" class="ctrl-input wide" data-field="selected-label" value="${escapeHtml(selected.label || '')}"></div>
        <div class="control-group">${shapeMarkup('selected', selected.style.fill)}</div>
        <div class="control-group checks">${checkMarkup('面積', 'selected-showArea', selected.showArea)}${checkMarkup('辺長', 'selected-showLengths', selected.showLengths)}${checkMarkup('約', 'selected-approximate', selected.approximate)}</div>
        <div class="control-group action-strip"><button class="ctrl-btn" type="button" data-action="edit-vertex">${iconMarkup('vertex')}頂点</button><button class="ctrl-btn" type="button" data-action="edit-label">${iconMarkup('text')}文字</button><button class="ctrl-btn" type="button" data-action="edit-dimension">${iconMarkup('dimension')}寸法</button><button class="ctrl-btn danger icon-only" type="button" data-action="delete-selected" title="区画を消去">${iconMarkup('delete')}</button></div>` :
        `<div class="control-group"><strong>図面上の区画を選択</strong>　(L)区画選択　(R)読取点から選択</div>`;
    } else if (state.command === 'vertex') {
      controls.innerHTML = selected ? `
        <div class="control-group"><strong>${escapeHtml(selected.label || `区画 ${selected.number || ''}`)}</strong>　頂点をドラッグして修正</div>
        <div class="control-group"><button class="ctrl-btn primary" type="button" data-action="vertex-done">${iconMarkup('check')}編集終了</button></div>` :
        `<div class="control-group"><strong>頂点を編集する区画を選択</strong>　選択後、頂点をドラッグ</div>`;
    } else if (state.command === 'label') {
      const labelStyle = mergedLabelStyle(selected);
      controls.innerHTML = selected ? `
        <div class="control-group"><label class="control-label" for="selected-label">文字</label><input id="selected-label" class="ctrl-input wide" data-field="selected-label" value="${escapeHtml(selected.label || '')}"></div>
        <div class="control-group"><span class="control-label">書体</span>${fontMarkup(labelStyle.font)}</div>
        <div class="control-group"><label class="control-label">大きさ</label><input class="ctrl-input number-small" type="number" min="6" max="72" step="1" data-field="label-size" value="${labelStyle.size}"></div>
        <div class="control-group"><span class="control-label">色</span>${textColorMarkup('label-color', labelStyle.color)}</div>
        <div class="control-group"><label class="control-label">角度</label><input class="ctrl-input number-small" type="number" min="-180" max="180" step="1" data-field="label-angle" value="${labelStyle.angle}">°${checkMarkup('縦', 'label-vertical', labelStyle.vertical)}</div>
        <div class="control-group"><button class="ctrl-btn" type="button" data-action="center-label">中心へ戻す</button></div>` :
        `<div class="control-group"><strong>文字を調整する区画を選択</strong>　区画内をクリックして選択</div>`;
    } else if (state.command === 'dimension') {
      const dimensionStyle = mergedDimensionStyle(selected);
      controls.innerHTML = selected ? `
        <div class="control-group checks">${checkMarkup('表示', 'selected-showLengths', selected.showLengths)}${checkMarkup('約', 'selected-approximate', selected.approximate)}${checkMarkup('辺に沿う', 'dimension-rotate', dimensionStyle.rotate)}</div>
        <div class="control-group"><label class="control-label">小数</label><select class="ctrl-select compact" data-field="dimension-decimals">${[0, 1, 2, 3].map((value) => `<option value="${value}" ${value === Number(selected.decimals ?? 2) ? 'selected' : ''}>${value}桁</option>`).join('')}</select></div>
        <div class="control-group"><label class="control-label">大きさ</label><input class="ctrl-input number-small" type="number" min="6" max="40" step="0.5" data-field="dimension-size" value="${dimensionStyle.size}"></div>
        <div class="control-group"><span class="control-label">色</span>${textColorMarkup('dimension-color', dimensionStyle.color)}</div>
        <div class="control-group"><label class="control-label">離れ</label><input class="ctrl-input number-small" type="number" min="0" max="60" step="1" data-field="dimension-offset" value="${dimensionStyle.offset}">px</div>` :
        `<div class="control-group"><strong>寸法を調整する区画を選択</strong>　区画内をクリックして選択</div>`;
    } else if (state.command === 'delete') {
      controls.innerHTML = `<div class="control-group"><strong>消去する区画を指示</strong>　(L)消去　Ctrl+Zで戻せます</div>`;
    } else if (state.command === 'underlay') {
      const u = state.underlay;
      controls.innerHTML = `
        <div class="control-group"><button class="ctrl-btn primary" type="button" data-action="open-underlay">${iconMarkup('open')}下絵を開く</button><button class="ctrl-btn" type="button" data-action="toggle-underlay" ${u.ready ? '' : 'disabled'}>${u.visible ? '非表示' : '表示'}</button></div>
        <div class="control-group"><span class="control-label">濃さ</span><span class="stepper"><button type="button" data-action="opacity-down" ${u.ready ? '' : 'disabled'}>−</button><output>${Math.round(u.opacity * 100)}%</output><button type="button" data-action="opacity-up" ${u.ready ? '' : 'disabled'}>＋</button></span></div>
        ${u.type === 'pdf' ? `<div class="control-group"><button class="ctrl-btn" type="button" data-action="prev-page" ${u.page <= 1 ? 'disabled' : ''}>前頁</button><strong>${u.page} / ${u.pages}</strong><button class="ctrl-btn" type="button" data-action="next-page" ${u.page >= u.pages ? 'disabled' : ''}>次頁</button></div>` : ''}
        <div class="control-group"><button class="ctrl-btn" type="button" data-action="fit" ${u.ready || state.lots.length ? '' : 'disabled'}>全体表示</button></div>`;
    } else if (state.command === 'calibrate') {
      const count = state.calibrationPoints.length;
      controls.innerHTML = `
        <div class="control-group"><strong>${count === 0 ? '1/3 始点' : count === 1 ? '2/3 終点' : '3/3 実距離'}</strong></div>
        ${count >= 2 ? `<div class="control-group"><label class="control-label" for="calibration-distance">実距離</label><input id="calibration-distance" class="ctrl-input" data-field="calibration-distance" inputmode="decimal" value="${escapeHtml(state.calibrationDistance)}"><span>m</span><button class="ctrl-btn primary" type="button" data-action="apply-calibration">適用</button></div>` : ''}
        <div class="control-group"><button class="ctrl-btn" type="button" data-action="cancel-calibration">${iconMarkup('cancel')}取消</button>${state.mpp ? `<span class="control-label optional">現在 ${state.mpp.toFixed(4)} m/px</span>` : ''}</div>`;
      if (count >= 2) {
        const focusDistance = () => {
          if (state.command !== 'calibrate' || state.calibrationPoints.length !== 2) return;
          const input = $('calibration-distance');
          if (input && document.activeElement !== input) {
            input.focus({ preventScroll: true });
            input.select();
          }
        };
        queueMicrotask(focusDistance);
        requestAnimationFrame(focusDistance);
        setTimeout(focusDistance, 0);
      }
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function updateStatus() {
    let message = '';
    if (state.command === 'parcel') {
      message = state.draft.length
        ? `区画作図 ${state.draft.length}点｜次の頂点　(L)任意点　(R)読取点　Enter 閉じる　Backspace 1点戻す　Esc 中止`
        : '区画作図｜始点を指示　(L)任意点　(R)読取点　Esc 選択へ';
    } else if (state.command === 'select') {
      message = activeLot() ? '区画を選択中｜上のバーで名称・色を編集　E 頂点編集　D 消去' : '区画を選択してください　(L)選択　(R)読取選択';
    } else if (state.command === 'vertex') {
      message = activeLot() ? '頂点をドラッグしてください　中ドラッグ 移動　ホイール 拡大縮小　Esc 終了' : '頂点編集する区画を選択してください';
    } else if (state.command === 'label') {
      message = activeLot() ? '文字属性を上のバーで調整｜区画内をドラッグすると文字位置を移動' : '文字を調整する区画を選択してください';
    } else if (state.command === 'dimension') {
      message = activeLot() ? '辺寸法を上のバーで調整｜表示・約・小数桁・大きさ・色・向きを設定' : '寸法を調整する区画を選択してください';
    } else if (state.command === 'delete') {
      message = '消去する区画を指示してください　(L)消去　Ctrl+Z 戻る　Esc 選択へ';
    } else if (state.command === 'underlay') {
      message = state.underlay.ready ? '下絵操作｜濃さ・ページを調整　表示位置は変えません　F 全体表示' : '下絵を開くか、作図領域へPDF・画像をドロップしてください';
    } else if (state.command === 'calibrate') {
      const count = state.calibrationPoints.length;
      message = count === 0 ? '縮尺設定｜基準線の始点　(L)任意点　(R)読取点' : count === 1 ? '縮尺設定｜基準線の終点　(L)任意点　(R)読取点' : '縮尺設定｜上の実距離欄にm単位で入力してEnter';
    }
    const status = $('status-message');
    status.textContent = state.noticeMessage || message;
    status.classList.toggle('notice-info', !!state.noticeMessage && state.noticeType !== 'error');
    status.classList.toggle('notice-error', !!state.noticeMessage && state.noticeType === 'error');
    updateChrome();
  }

  function notice(message, type = 'info', duration = 2400) {
    clearTimeout(state.noticeTimer);
    state.noticeMessage = String(message || '');
    state.noticeType = type;
    updateStatus();
    state.noticeTimer = window.setTimeout(() => {
      state.noticeMessage = '';
      state.noticeType = 'info';
      updateStatus();
    }, duration);
  }

  function scheduleDraw() {
    if (state.drawQueued) return;
    state.drawQueued = true;
    requestAnimationFrame(() => {
      state.drawQueued = false;
      draw();
    });
  }

  function resizeCanvas() {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.dataset.dpr = String(dpr);
      scheduleDraw();
    }
  }

  function canvasSize() {
    const dpr = finite(canvas.dataset.dpr, 1) || 1;
    return { width: canvas.width / dpr, height: canvas.height / dpr, dpr };
  }

  function screenToWorld(x, y) {
    return { x: (x - state.view.x) / state.view.zoom, y: (y - state.view.y) / state.view.zoom };
  }

  function worldToScreen(point) {
    return { x: point.x * state.view.zoom + state.view.x, y: point.y * state.view.zoom + state.view.y };
  }

  function eventPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function draw() {
    const { width, height, dpr } = canvasSize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#9aa1a9';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(state.view.x, state.view.y);
    ctx.scale(state.view.zoom, state.view.zoom);
    drawUnderlay(ctx);
    if (state.gridVisible) drawGrid(ctx, width, height);
    drawLots(ctx, { zoom: state.view.zoom, selection: true });
    drawTransient(ctx, state.view.zoom);
    ctx.restore();
  }

  function drawUnderlay(target) {
    if (!state.underlay.ready || !state.underlay.visible) return;
    const u = state.underlay;
    target.save();
    target.globalAlpha = u.opacity;
    target.translate(u.x, u.y);
    target.scale(u.scale, u.scale);
    if (u.rotation) {
      target.translate(underlayCanvas.width / 2, underlayCanvas.height / 2);
      target.rotate(u.rotation * Math.PI / 180);
      target.translate(-underlayCanvas.width / 2, -underlayCanvas.height / 2);
    }
    target.drawImage(underlayCanvas, 0, 0);
    target.restore();
  }

  function drawGrid(target, screenWidth, screenHeight) {
    const zoom = state.view.zoom;
    const minGap = 35;
    let step = 10;
    while (step * zoom < minGap) step *= 2;
    while (step * zoom > minGap * 2.5) step /= 2;
    const topLeft = screenToWorld(0, 0);
    const bottomRight = screenToWorld(screenWidth, screenHeight);
    target.save();
    target.strokeStyle = 'rgba(45,72,94,.13)';
    target.lineWidth = 1 / zoom;
    target.beginPath();
    for (let x = Math.floor(topLeft.x / step) * step; x <= bottomRight.x; x += step) {
      target.moveTo(x, topLeft.y);
      target.lineTo(x, bottomRight.y);
    }
    for (let y = Math.floor(topLeft.y / step) * step; y <= bottomRight.y; y += step) {
      target.moveTo(topLeft.x, y);
      target.lineTo(bottomRight.x, y);
    }
    target.stroke();
    target.restore();
  }

  function drawLots(target, options = {}) {
    const zoom = options.zoom || 1;
    for (const lot of state.lots) drawLot(target, lot, zoom, options.selection !== false);
  }

  function drawLot(target, lot, zoom, allowSelection) {
    if (!lot.points?.length) return;
    const style = lot.style || DEFAULT_STYLE;
    target.save();
    target.beginPath();
    target.moveTo(lot.points[0].x, lot.points[0].y);
    for (let i = 1; i < lot.points.length; i += 1) target.lineTo(lot.points[i].x, lot.points[i].y);
    target.closePath();
    target.globalAlpha = clamp(style.opacity ?? DEFAULT_STYLE.opacity, 0.08, 0.95);
    target.fillStyle = style.fill || DEFAULT_STYLE.fill;
    target.fill();
    target.globalAlpha = 1;
    target.lineWidth = 1.5 / zoom;
    target.strokeStyle = style.stroke || DEFAULT_STYLE.stroke;
    target.stroke();

    if (allowSelection && lot.id === state.selectedId) {
      target.setLineDash([5 / zoom, 3 / zoom]);
      target.lineWidth = 1.2 / zoom;
      target.strokeStyle = '#0a65b8';
      target.stroke();
      target.setLineDash([]);
    }

    drawLotLabel(target, lot, zoom);

    if (lot.showLengths && state.mpp) drawEdgeLengths(target, lot, zoom);
    if (allowSelection && state.command === 'vertex' && lot.id === state.selectedId) drawVertexHandles(target, lot, zoom);
    if (allowSelection && state.command === 'label' && lot.id === state.selectedId) drawLabelHandle(target, lot, zoom);
    target.restore();
  }

  function drawLotLabel(target, lot, zoom) {
    const labelStyle = mergedLabelStyle(lot);
    const center = polygonCentroid(lot.points);
    const anchor = {
      x: center.x + finite(labelStyle.offsetX, 0),
      y: center.y + finite(labelStyle.offsetY, 0),
    };
    const size = clamp(finite(labelStyle.size, DEFAULT_LABEL_STYLE.size), 6, 72) / zoom;
    const font = FONT_PRESETS[labelStyle.font]?.css || FONT_PRESETS.gothic.css;
    const areaText = lot.showArea !== false && state.mpp
      ? `${lot.approximate ? '約' : ''}${formatArea(polygonArea(lot.points) * state.mpp * state.mpp)}㎡`
      : '';
    target.save();
    target.translate(anchor.x, anchor.y);
    target.rotate(clamp(finite(labelStyle.angle, 0), -180, 180) * Math.PI / 180);
    target.textAlign = 'center';
    target.textBaseline = 'middle';
    target.fillStyle = labelStyle.color || DEFAULT_LABEL_STYLE.color;
    target.font = `600 ${size}px ${font}`;
    const label = String(lot.label || `区画 ${lot.number || ''}`);
    if (labelStyle.vertical) {
      const chars = Array.from(label);
      const lineHeight = size * 1.08;
      const nameHeight = Math.max(lineHeight, chars.length * lineHeight);
      const areaGap = areaText ? size * 0.95 : 0;
      const totalHeight = nameHeight + areaGap;
      chars.forEach((char, index) => target.fillText(char, 0, -totalHeight / 2 + lineHeight / 2 + index * lineHeight));
      if (areaText) {
        target.font = `500 ${size * 0.82}px ${font}`;
        target.fillText(areaText, 0, totalHeight / 2 - size * 0.35);
      }
    } else {
      const lines = [label, ...(areaText ? [areaText] : [])];
      const lineHeight = size * 1.2;
      lines.forEach((line, index) => {
        target.font = `${index === 0 ? 600 : 500} ${index === 0 ? size : size * 0.86}px ${font}`;
        target.fillText(line, 0, (index - (lines.length - 1) / 2) * lineHeight);
      });
    }
    target.restore();
  }

  function drawLabelHandle(target, lot, zoom) {
    const labelStyle = mergedLabelStyle(lot);
    const center = polygonCentroid(lot.points);
    const anchor = { x: center.x + finite(labelStyle.offsetX, 0), y: center.y + finite(labelStyle.offsetY, 0) };
    target.save();
    if (Math.hypot(anchor.x - center.x, anchor.y - center.y) > 1 / zoom) {
      target.beginPath();
      target.moveTo(center.x, center.y);
      target.lineTo(anchor.x, anchor.y);
      target.setLineDash([3 / zoom, 3 / zoom]);
      target.strokeStyle = '#0a65b8';
      target.lineWidth = 1 / zoom;
      target.stroke();
      target.setLineDash([]);
    }
    target.fillStyle = '#fff';
    target.strokeStyle = '#0a65b8';
    target.lineWidth = 1 / zoom;
    target.fillRect(anchor.x - 2.5 / zoom, anchor.y - 2.5 / zoom, 5 / zoom, 5 / zoom);
    target.strokeRect(anchor.x - 2.5 / zoom, anchor.y - 2.5 / zoom, 5 / zoom, 5 / zoom);
    target.restore();
  }

  function drawEdgeLengths(target, lot, zoom) {
    const dimensionStyle = mergedDimensionStyle(lot);
    const center = polygonCentroid(lot.points);
    target.save();
    target.textAlign = 'center';
    target.textBaseline = 'middle';
    target.font = `${clamp(finite(dimensionStyle.size, 10.5), 6, 40) / zoom}px ${FONT_PRESETS.gothic.css}`;
    target.fillStyle = dimensionStyle.color || DEFAULT_DIMENSION_STYLE.color;
    for (let i = 0; i < lot.points.length; i += 1) {
      const a = lot.points[i];
      const b = lot.points[(i + 1) % lot.points.length];
      const value = distance(a, b) * state.mpp;
      const digits = clamp(Number(lot.decimals ?? 2), 0, 3);
      const text = `${lot.approximate ? '約' : ''}${value.toFixed(digits)}m`;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len;
      let ny = dx / len;
      if ((mx - center.x) * nx + (my - center.y) * ny < 0) { nx *= -1; ny *= -1; }
      const offset = clamp(finite(dimensionStyle.offset, 10), 0, 60) / zoom;
      const tx = mx + nx * offset;
      const ty = my + ny * offset;
      target.save();
      target.translate(tx, ty);
      if (dimensionStyle.rotate !== false) {
        let angle = Math.atan2(dy, dx);
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
        target.rotate(angle);
      }
      target.fillText(text, 0, 0);
      target.restore();
    }
    target.restore();
  }

  function drawDraftLengths(target, points, zoom) {
    if (!state.mpp || points.length < 2) return;
    target.save();
    target.textAlign = 'center';
    target.textBaseline = 'middle';
    target.font = `${DEFAULT_DIMENSION_STYLE.size / zoom}px ${FONT_PRESETS.gothic.css}`;
    target.fillStyle = DEFAULT_DIMENSION_STYLE.color;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      const text = `${state.style.approximate ? '約' : ''}${(len * state.mpp).toFixed(state.style.decimals)}m`;
      const mx = (a.x + b.x) / 2 - dy / len * (DEFAULT_DIMENSION_STYLE.offset / zoom);
      const my = (a.y + b.y) / 2 + dx / len * (DEFAULT_DIMENSION_STYLE.offset / zoom);
      let angle = Math.atan2(dy, dx);
      if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
      target.save();
      target.translate(mx, my);
      target.rotate(angle);
      target.fillText(text, 0, 0);
      target.restore();
    }
    target.restore();
  }

  function drawVertexHandles(target, lot, zoom) {
    target.save();
    for (const point of lot.points) {
      target.beginPath();
      target.arc(point.x, point.y, 3.2 / zoom, 0, Math.PI * 2);
      target.fillStyle = '#f8fbff';
      target.fill();
      target.lineWidth = 1.2 / zoom;
      target.strokeStyle = '#0a65b8';
      target.stroke();
    }
    target.restore();
  }

  function drawTransient(target, zoom) {
    if (state.command === 'parcel' && state.draft.length) {
      target.save();
      target.beginPath();
      target.moveTo(state.draft[0].x, state.draft[0].y);
      for (let i = 1; i < state.draft.length; i += 1) target.lineTo(state.draft[i].x, state.draft[i].y);
      if (state.pointer.inside) target.lineTo(state.pointer.worldX, state.pointer.worldY);
      if (state.draft.length >= 3) target.lineTo(state.draft[0].x, state.draft[0].y);
      target.globalAlpha = 0.34;
      target.fillStyle = state.style.fill;
      if (state.draft.length >= 3) target.fill();
      target.globalAlpha = 1;
      target.lineWidth = 1.4 / zoom;
      target.strokeStyle = state.style.stroke;
      target.stroke();
      for (const point of state.draft) {
        target.beginPath();
        target.arc(point.x, point.y, 2.1 / zoom, 0, Math.PI * 2);
        target.fillStyle = '#0a65b8';
        target.fill();
      }
      if (state.style.showLengths) {
        const previewPoints = state.pointer.inside
          ? [...state.draft, { x: state.pointer.worldX, y: state.pointer.worldY }]
          : [...state.draft];
        drawDraftLengths(target, previewPoints, zoom);
      }
      if (state.draft.length >= 3 && state.mpp) {
        const area = polygonArea([...state.draft, { x: state.pointer.worldX, y: state.pointer.worldY }]) * state.mpp * state.mpp;
        const center = polygonCentroid(state.draft);
        target.font = `600 ${11 / zoom}px "Yu Gothic UI",Meiryo,sans-serif`;
        target.textAlign = 'center';
        target.fillStyle = '#46380e';
        target.fillText(`${formatArea(area)}㎡`, center.x, center.y);
      }
      target.restore();
    }

    if (state.command === 'calibrate' && state.calibrationPoints.length) {
      target.save();
      const a = state.calibrationPoints[0];
      const b = state.calibrationPoints[1] || { x: state.pointer.worldX, y: state.pointer.worldY };
      target.beginPath();
      target.moveTo(a.x, a.y);
      target.lineTo(b.x, b.y);
      target.strokeStyle = '#7a2fa5';
      target.lineWidth = 1.5 / zoom;
      target.stroke();
      [a, ...(state.calibrationPoints[1] ? [state.calibrationPoints[1]] : [])].forEach((point) => {
        target.beginPath();
        target.arc(point.x, point.y, 2.3 / zoom, 0, Math.PI * 2);
        target.fillStyle = '#7a2fa5';
        target.fill();
      });
      target.restore();
    }

    if (state.hoverSnap && ['parcel', 'calibrate'].includes(state.command)) {
      const p = state.hoverSnap.point;
      const size = 5 / zoom;
      target.save();
      target.strokeStyle = '#c11f1f';
      target.lineWidth = 1 / zoom;
      target.beginPath();
      target.moveTo(p.x - size, p.y);
      target.lineTo(p.x + size, p.y);
      target.moveTo(p.x, p.y - size);
      target.lineTo(p.x, p.y + size);
      target.stroke();
      target.restore();
    }
  }

  function polygonArea(points) {
    if (!points || points.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
  }

  function polygonCentroid(points) {
    if (!points?.length) return { x: 0, y: 0 };
    let twiceArea = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const f = a.x * b.y - b.x * a.y;
      twiceArea += f;
      x += (a.x + b.x) * f;
      y += (a.y + b.y) * f;
    }
    if (Math.abs(twiceArea) < 1e-8) {
      return points.reduce((acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }), { x: 0, y: 0 });
    }
    return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
  }

  function formatArea(value) {
    if (!Number.isFinite(value)) return '0';
    if (value >= 1000) return Math.round(value).toLocaleString('ja-JP');
    if (value >= 100) return value.toFixed(1);
    return value.toFixed(2);
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const pi = polygon[i];
      const pj = polygon[j];
      const intersect = ((pi.y > point.y) !== (pj.y > point.y)) &&
        point.x < (pj.x - pi.x) * (point.y - pi.y) / ((pj.y - pi.y) || 1e-12) + pi.x;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function projectToSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (!lenSq) return { point: { ...a }, t: 0, distance: distance(point, a) };
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq, 0, 1);
    const projected = { x: a.x + dx * t, y: a.y + dy * t };
    return { point: projected, t, distance: distance(point, projected) };
  }

  function segmentIntersection(a, b, c, d) {
    const r = { x: b.x - a.x, y: b.y - a.y };
    const s = { x: d.x - c.x, y: d.y - c.y };
    const cross = (u, v) => u.x * v.y - u.y * v.x;
    const den = cross(r, s);
    if (Math.abs(den) < 1e-9) return null;
    const ca = { x: c.x - a.x, y: c.y - a.y };
    const t = cross(ca, s) / den;
    const u = cross(ca, r) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { x: a.x + t * r.x, y: a.y + t * r.y };
  }

  function polygonSelfIntersects(points) {
    const count = points.length;
    if (count < 4) return false;
    for (let i = 0; i < count; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % count];
      for (let j = i + 1; j < count; j += 1) {
        if (j === i || j === i + 1 || (i === 0 && j === count - 1)) continue;
        const c = points[j];
        const d = points[(j + 1) % count];
        if (segmentIntersection(a, b, c, d)) return true;
      }
    }
    return false;
  }

  function allSegments() {
    const segments = [];
    for (const lot of state.lots) {
      for (let i = 0; i < lot.points.length; i += 1) segments.push({ a: lot.points[i], b: lot.points[(i + 1) % lot.points.length], lotId: lot.id });
    }
    for (let i = 1; i < state.draft.length; i += 1) segments.push({ a: state.draft[i - 1], b: state.draft[i], lotId: null });
    return segments;
  }

  function findSnap(point, thresholdPx = 12) {
    const threshold = thresholdPx / state.view.zoom;
    const candidates = [];
    for (const lot of state.lots) {
      lot.points.forEach((p, index) => candidates.push({ point: { ...p }, type: 'vertex', lotId: lot.id, index, distance: distance(point, p) }));
    }
    state.draft.forEach((p, index) => candidates.push({ point: { ...p }, type: 'draft', index, distance: distance(point, p) }));
    const segments = allSegments();
    for (const segment of segments) {
      const projected = projectToSegment(point, segment.a, segment.b);
      candidates.push({ point: projected.point, type: 'edge', lotId: segment.lotId, distance: projected.distance });
    }
    if (segments.length <= 120) {
      for (let i = 0; i < segments.length; i += 1) {
        for (let j = i + 1; j < segments.length; j += 1) {
          const hit = segmentIntersection(segments[i].a, segments[i].b, segments[j].a, segments[j].b);
          if (hit) candidates.push({ point: hit, type: 'intersection', distance: distance(point, hit) });
        }
      }
    }
    const pointCandidate = candidates
      .filter((candidate) => candidate.type !== 'edge')
      .sort((a, b) => a.distance - b.distance)[0];
    if (pointCandidate?.distance <= threshold) return pointCandidate;
    const edgeCandidate = candidates
      .filter((candidate) => candidate.type === 'edge')
      .sort((a, b) => a.distance - b.distance)[0];
    return edgeCandidate?.distance <= threshold ? edgeCandidate : null;
  }

  function findLotAt(point) {
    const edgeTolerance = 7 / state.view.zoom;
    for (let i = state.lots.length - 1; i >= 0; i -= 1) {
      const lot = state.lots[i];
      if (pointInPolygon(point, lot.points)) return lot;
      for (let p = 0; p < lot.points.length; p += 1) {
        if (projectToSegment(point, lot.points[p], lot.points[(p + 1) % lot.points.length]).distance <= edgeTolerance) return lot;
      }
    }
    return null;
  }

  function findVertexAt(point, onlySelected = false) {
    const threshold = 9 / state.view.zoom;
    let result = null;
    let best = Infinity;
    for (const lot of state.lots) {
      if (onlySelected && lot.id !== state.selectedId) continue;
      lot.points.forEach((vertex, index) => {
        const d = distance(point, vertex);
        if (d < threshold && d < best) {
          best = d;
          result = { lot, index, point: vertex };
        }
      });
    }
    return result;
  }

  function addCommandPoint(point, source = 'free') {
    if (state.command === 'parcel') {
      if (state.draft.length >= 3 && samePoint(point, state.draft[0], 0.5 / state.view.zoom)) {
        finishParcel();
        return;
      }
      if (state.draft.length && samePoint(point, state.draft[state.draft.length - 1], 0.2 / state.view.zoom)) {
        notice('同じ点は続けて置けません', 'error');
        return;
      }
      state.draft.push({ x: point.x, y: point.y, source });
      renderControls();
      updateStatus();
      scheduleDraw();
    } else if (state.command === 'calibrate') {
      if (state.calibrationPoints.length >= 2) return;
      state.calibrationPoints.push({ x: point.x, y: point.y });
      if (state.calibrationPoints.length === 2 && distance(state.calibrationPoints[0], state.calibrationPoints[1]) < 1) {
        state.calibrationPoints.pop();
        notice('始点から離れた位置を指示してください', 'error');
      }
      renderControls();
      updateStatus();
      scheduleDraw();
    }
  }

  function finishParcel() {
    if (state.draft.length < 3) {
      notice('区画は3点以上必要です', 'error');
      return;
    }
    const points = state.draft.map(({ x, y }) => ({ x, y }));
    if (polygonSelfIntersects(points)) {
      notice('線が交差しています。1点戻して描き直してください', 'error');
      return;
    }
    if (polygonArea(points) < 1) {
      notice('面積のある区画を描いてください', 'error');
      return;
    }
    pushHistory();
    const lot = {
      id: state.nextId++,
      type: 'lot',
      number: state.nextNum,
      lotNum: state.nextNum,
      label: `区画 ${state.nextNum}`,
      points,
      style: {
        fill: state.style.fill,
        stroke: state.style.stroke,
        opacity: state.style.opacity,
      },
      showArea: state.style.showArea,
      showLengths: state.style.showLengths,
      approximate: state.style.approximate,
      decimals: state.style.decimals,
      labelStyle: { ...DEFAULT_LABEL_STYLE },
      dimensionStyle: { ...DEFAULT_DIMENSION_STYLE },
    };
    state.nextNum += 1;
    state.lots.push(lot);
    state.draft = [];
    setDirty(true);
    renderControls();
    updateStatus();
    scheduleDraw();
    notice(`${lot.label}を作成しました`);
  }

  function clearDraft() {
    state.draft = [];
    renderControls();
    updateStatus();
    scheduleDraw();
  }

  function applyCalibration() {
    if (state.calibrationPoints.length !== 2) {
      notice('先に基準となる2点を指示してください', 'error');
      return;
    }
    const input = $('calibration-distance');
    const value = Number(String(input?.value ?? state.calibrationDistance).replace(',', '.'));
    if (!(value > 0)) {
      notice('実距離をm単位で入力してください', 'error');
      input?.focus();
      input?.select();
      return;
    }
    const pixelDistance = distance(state.calibrationPoints[0], state.calibrationPoints[1]);
    if (!(pixelDistance > 0)) return;
    pushHistory();
    state.mpp = value / pixelDistance;
    state.calibrationDistance = String(value);
    state.calibrationPoints = [];
    setDirty(true);
    updateChrome();
    renderControls();
    updateStatus();
    scheduleDraw();
    canvas.focus({ preventScroll: true });
    notice(`縮尺を設定しました（1px = ${state.mpp.toFixed(5)}m）`);
  }

  function deleteLot(lot) {
    if (!lot) return;
    pushHistory();
    state.lots = state.lots.filter((item) => item.id !== lot.id);
    if (state.selectedId === lot.id) state.selectedId = null;
    setDirty(true);
    renderControls();
    updateStatus();
    scheduleDraw();
    notice('区画を消去しました。Ctrl+Zで戻せます');
  }

  function selectLot(lot) {
    state.selectedId = lot?.id ?? null;
    renderControls();
    updateStatus();
    scheduleDraw();
  }

  function fitView() {
    const bounds = drawingBounds();
    if (!bounds) {
      notice('表示する下絵または区画がありません');
      return;
    }
    const { width, height } = canvasSize();
    const bw = Math.max(1, bounds.maxX - bounds.minX);
    const bh = Math.max(1, bounds.maxY - bounds.minY);
    const zoom = clamp(Math.min((width - 44) / bw, (height - 44) / bh), 0.03, 20);
    state.view.zoom = zoom;
    state.view.x = (width - bw * zoom) / 2 - bounds.minX * zoom;
    state.view.y = (height - bh * zoom) / 2 - bounds.minY * zoom;
    updateChrome();
    scheduleDraw();
  }

  function actualSize() {
    const { width, height } = canvasSize();
    const center = screenToWorld(width / 2, height / 2);
    state.view.zoom = 1;
    state.view.x = width / 2 - center.x;
    state.view.y = height / 2 - center.y;
    updateChrome();
    scheduleDraw();
  }

  function drawingBounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const add = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };
    if (state.underlay.ready) {
      const u = state.underlay;
      add(u.x, u.y);
      add(u.x + underlayCanvas.width * u.scale, u.y + underlayCanvas.height * u.scale);
    }
    state.lots.forEach((lot) => lot.points.forEach((point) => add(point.x, point.y)));
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  }

  function zoomAt(screenPoint, factor) {
    const before = screenToWorld(screenPoint.x, screenPoint.y);
    const next = clamp(state.view.zoom * factor, 0.03, 30);
    if (Math.abs(next - state.view.zoom) < 1e-9) return;
    state.view.zoom = next;
    state.view.x = screenPoint.x - before.x * next;
    state.view.y = screenPoint.y - before.y * next;
    updateChrome();
    scheduleDraw();
  }

  async function loadUnderlayFile(file, options = {}) {
    if (!file) return;
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await loadPdfBytes(bytes, 1, file.name);
      } else {
        const dataUrl = await fileToDataUrl(file);
        await loadImageDataUrl(dataUrl, file.name);
      }
      if (!options.keepDocumentName) setDocumentName(file.name.replace(/\.[^.]+$/, '') || file.name);
      setDirty(true);
      setCommand('underlay');
      updateChrome();
      notice('下絵を読み込みました。表示位置と倍率は変えていません。Fで全体表示できます');
    } catch (error) {
      console.error(error);
      notice(`下絵を開けませんでした: ${error.message}`, 'error', 5000);
    }
  }

  async function loadPdfBytes(bytes, page = 1, name = 'PDF') {
    if (!window.pdfjsLib) throw new Error('PDF読込ライブラリが見つかりません');
    if (state.underlay.renderTask) {
      try { state.underlay.renderTask.cancel(); } catch (_) {}
      state.underlay.renderTask = null;
    }
    const pdf = await pdfjsLib.getDocument({ data: bytes, ...PDFJS_OPTIONS }).promise;
    state.underlay.pdf = pdf;
    state.underlay.pdfBytes = bytes;
    state.underlay.type = 'pdf';
    state.underlay.pages = pdf.numPages;
    state.underlay.name = name;
    await renderPdfPage(clamp(page, 1, pdf.numPages));
  }

  async function renderPdfPage(pageNumber) {
    const u = state.underlay;
    if (!u.pdf) return;
    if (u.renderTask) {
      try { u.renderTask.cancel(); } catch (_) {}
      u.renderTask = null;
    }
    const page = await u.pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
    underlayCanvas.width = Math.ceil(viewport.width);
    underlayCanvas.height = Math.ceil(viewport.height);
    underlayCtx.setTransform(1, 0, 0, 1, 0, 0);
    underlayCtx.clearRect(0, 0, underlayCanvas.width, underlayCanvas.height);
    const task = page.render({ canvasContext: underlayCtx, viewport });
    u.renderTask = task;
    try {
      await task.promise;
    } catch (error) {
      if (error?.name !== 'RenderingCancelledException') throw error;
      return;
    }
    u.renderTask = null;
    u.page = pageNumber;
    u.ready = true;
    u.visible = true;
    updateChrome();
    renderControls();
    scheduleDraw();
  }

  async function loadImageDataUrl(dataUrl, name = '画像') {
    const image = await loadImage(dataUrl);
    underlayCanvas.width = image.naturalWidth || image.width;
    underlayCanvas.height = image.naturalHeight || image.height;
    underlayCtx.setTransform(1, 0, 0, 1, 0, 0);
    underlayCtx.clearRect(0, 0, underlayCanvas.width, underlayCanvas.height);
    underlayCtx.drawImage(image, 0, 0);
    Object.assign(state.underlay, {
      ready: true,
      visible: true,
      type: 'image',
      name,
      pdf: null,
      pdfBytes: null,
      page: 1,
      pages: 1,
      renderTask: null,
    });
    updateChrome();
    renderControls();
    scheduleDraw();
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('ファイルを読めませんでした'));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('画像を展開できませんでした'));
      image.src = url;
    });
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
  }

  function base64ToBytes(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function serializeProject() {
    const data = {
      format: 'kozu-measure',
      version: 4,
      appVersion: VERSION,
      savedAt: new Date().toISOString(),
      background: {
        type: state.underlay.type,
        name: state.underlay.name,
        page: state.underlay.page,
        pages: state.underlay.pages,
        pdfBase64: state.underlay.type === 'pdf' && state.underlay.pdfBytes ? bytesToBase64(state.underlay.pdfBytes) : null,
        imageDataUrl: state.underlay.type === 'image' && state.underlay.ready ? underlayCanvas.toDataURL('image/png') : null,
        opacity: state.underlay.opacity,
        visible: state.underlay.visible,
        x: state.underlay.x,
        y: state.underlay.y,
        scale: state.underlay.scale,
        rotation: state.underlay.rotation,
      },
      calibration: { mpp: state.mpp },
      view: { ...state.view },
      lots: state.lots.map((lot) => ({
        id: lot.id,
        type: 'lot',
        number: lot.number,
        lotNum: lot.number,
        label: lot.label,
        points: lot.points.map((point) => ({ x: point.x, y: point.y })),
        style: {
          fill: lot.style?.fill || DEFAULT_STYLE.fill,
          stroke: lot.style?.stroke || DEFAULT_STYLE.stroke,
          opacity: clamp(finite(lot.style?.opacity, DEFAULT_STYLE.opacity), 0.08, 0.95),
        },
        showArea: lot.showArea !== false,
        showLengths: !!lot.showLengths,
        approximate: !!lot.approximate,
        decimals: clamp(finite(lot.decimals, 2), 0, 3),
        labelStyle: mergedLabelStyle(lot),
        dimensionStyle: mergedDimensionStyle(lot),
      })),
      nextId: state.nextId,
      nextNum: state.nextNum,
    };
    return JSON.stringify(data);
  }

  async function saveProject(options = {}) {
    try {
      const contents = serializeProject();
      const baseName = (state.documentName || 'kozu-project').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      const fileName = `${baseName || 'kozu-project'}.kozu.json`;
      let savedName = fileName;
      if (options.closeAfter && window.electronAPI?.saveProjectBeforeClose) {
        const result = await window.electronAPI.saveProjectBeforeClose({ fileName, contents });
        savedName = result?.fileName || fileName;
      } else {
        downloadBlob(new Blob([contents], { type: 'application/json' }), fileName);
      }
      setDocumentName(savedName.replace(/\.kozu\.json$/i, '').replace(/\.json$/i, ''));
      setDirty(false);
      notice('作業ファイルを保存しました');
      return true;
    } catch (error) {
      console.error(error);
      notice(`保存できませんでした: ${error.message}`, 'error', 5000);
      return false;
    }
  }

  async function openProjectFile(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await importProject(data, file.name);
      notice('作業ファイルを開きました');
    } catch (error) {
      console.error(error);
      notice(`作業ファイルを開けませんでした: ${error.message}`, 'error', 5000);
    }
  }

  async function importProject(data, fileName = '作業ファイル') {
    resetProjectState();
    const bg = data.background || {};
    const pdfBase64 = bg.pdfBase64 || data.pdfBase64;
    const imageDataUrl = bg.imageDataUrl || data.imageDataUrl;
    if (pdfBase64) await loadPdfBytes(base64ToBytes(pdfBase64), bg.page || data.pageNum || 1, bg.name || fileName);
    else if (imageDataUrl) await loadImageDataUrl(imageDataUrl, bg.name || fileName);

    state.underlay.opacity = clamp(finite(bg.opacity, 0.68), 0.1, 1);
    state.underlay.visible = bg.visible !== false;
    state.underlay.x = finite(bg.x ?? data.bgOffsetX, 0);
    state.underlay.y = finite(bg.y ?? data.bgOffsetY, 0);
    state.underlay.scale = clamp(finite(bg.scale ?? data.bgScale, 1), 0.01, 100);
    state.underlay.rotation = finite(bg.rotation ?? data.bgRotation, 0);
    state.mpp = finite(data.calibration?.mpp ?? data.mpp, 0) || null;

    const sourceLots = Array.isArray(data.lots) ? data.lots : [];
    state.lots = sourceLots.map(sanitizeLot).filter(Boolean);
    state.nextId = Math.max(finite(data.nextId, 1), ...state.lots.map((lot) => lot.id + 1), 1);
    state.nextNum = Math.max(finite(data.nextNum ?? data.lotNextNum, 1), ...state.lots.map((lot) => (lot.number || 0) + 1), 1);
    const view = data.view || {};
    state.view.x = finite(view.x ?? data.vx, 18);
    state.view.y = finite(view.y ?? data.vy, 18);
    state.view.zoom = clamp(finite(view.zoom ?? data.vz, 1), 0.03, 30);
    setDocumentName(fileName.replace(/\.kozu\.json$/i, '').replace(/\.json$/i, ''));
    setDirty(false);
    setCommand('select');
    updateChrome();
    scheduleDraw();
  }

  function sanitizeLot(raw, index) {
    if (!raw || raw.type === 'road' || !Array.isArray(raw.points)) return null;
    const points = raw.points.map((point) => ({ x: finite(point?.x, NaN), y: finite(point?.y, NaN) })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (points.length < 3 || polygonArea(points) < 0.01) return null;
    const number = finite(raw.number ?? raw.lotNum, index + 1) || index + 1;
    const oldFill = raw.color && raw.color !== '#cbd5e1' ? raw.color : DEFAULT_STYLE.fill;
    return {
      id: finite(raw.id, index + 1) || index + 1,
      type: 'lot',
      number,
      lotNum: number,
      label: String(raw.label || raw.displayText || `区画 ${number}`),
      points,
      style: {
        fill: raw.style?.fill || oldFill || DEFAULT_STYLE.fill,
        stroke: raw.style?.stroke || raw.borderColor || DEFAULT_STYLE.stroke,
        opacity: clamp(finite(raw.style?.opacity ?? raw.fillOpacity, DEFAULT_STYLE.opacity), 0.08, 0.95),
      },
      showArea: raw.showArea !== false,
      showLengths: !!(raw.showLengths ?? raw.showEdgeLengths),
      approximate: !!(raw.approximate ?? raw.yakuMode === 'on'),
      decimals: clamp(finite(raw.decimals, 2), 0, 3),
      labelStyle: {
        font: FONT_PRESETS[raw.labelStyle?.font] ? raw.labelStyle.font : DEFAULT_LABEL_STYLE.font,
        size: clamp(finite(raw.labelStyle?.size, DEFAULT_LABEL_STYLE.size), 6, 72),
        color: safeColor(raw.labelStyle?.color, DEFAULT_LABEL_STYLE.color),
        angle: clamp(finite(raw.labelStyle?.angle, 0), -180, 180),
        vertical: !!raw.labelStyle?.vertical,
        offsetX: finite(raw.labelStyle?.offsetX, 0),
        offsetY: finite(raw.labelStyle?.offsetY, 0),
      },
      dimensionStyle: {
        size: clamp(finite(raw.dimensionStyle?.size, DEFAULT_DIMENSION_STYLE.size), 6, 40),
        color: safeColor(raw.dimensionStyle?.color, DEFAULT_DIMENSION_STYLE.color),
        offset: clamp(finite(raw.dimensionStyle?.offset, DEFAULT_DIMENSION_STYLE.offset), 0, 60),
        rotate: raw.dimensionStyle?.rotate !== false,
      },
    };
  }

  function resetProjectState() {
    resetTransient();
    state.lots = [];
    state.nextId = 1;
    state.nextNum = 1;
    state.mpp = null;
    state.history = [];
    state.future = [];
    state.view = { x: 18, y: 18, zoom: 1 };
    state.underlay = {
      ready: false, visible: true, opacity: 0.68, type: null, name: '', pdf: null,
      pdfBytes: null, page: 1, pages: 0, renderTask: null, x: 0, y: 0, scale: 1, rotation: 0,
    };
    underlayCanvas.width = 1;
    underlayCanvas.height = 1;
    setDocumentName('無題');
    setDirty(false);
    updateChrome();
    scheduleDraw();
  }

  function requestDestructive(action) {
    if (!state.dirty) {
      action();
      return;
    }
    state.pendingConfirm = action;
    state.helpMode = false;
    renderControls();
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function exportPng() {
    const bounds = drawingBounds();
    if (!bounds) {
      notice('出力する下絵または区画がありません', 'error');
      return;
    }
    const margin = state.underlay.ready ? 0 : 24;
    const width = Math.ceil(bounds.maxX - bounds.minX + margin * 2);
    const height = Math.ceil(bounds.maxY - bounds.minY + margin * 2);
    if (width * height > 120_000_000) {
      notice('出力サイズが大きすぎます。下絵を小さくしてからお試しください', 'error');
      return;
    }
    const out = document.createElement('canvas');
    out.width = Math.max(1, width);
    out.height = Math.max(1, height);
    const outCtx = out.getContext('2d');
    outCtx.fillStyle = '#fff';
    outCtx.fillRect(0, 0, out.width, out.height);
    outCtx.save();
    outCtx.translate(-bounds.minX + margin, -bounds.minY + margin);
    drawUnderlay(outCtx);
    for (const lot of state.lots) drawLot(outCtx, lot, 1, false);
    outCtx.restore();
    const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNGを生成できませんでした');
    downloadBlob(blob, `${state.documentName || '区画図'}.png`);
    notice('PNG画像を出力しました');
  }

  function handleAction(action) {
    closeMenus();
    if (action === 'new') requestDestructive(() => { resetProjectState(); setCommand('underlay'); });
    else if (action === 'open-underlay') underlayInput.click();
    else if (action === 'open-project') requestDestructive(() => projectInput.click());
    else if (action === 'save-project') saveProject();
    else if (action === 'export-png') exportPng().catch((error) => notice(error.message, 'error'));
    else if (action === 'undo') undo();
    else if (action === 'redo') redo();
    else if (action === 'fit') fitView();
    else if (action === 'actual-size') actualSize();
    else if (action === 'toggle-underlay') {
      if (state.underlay.ready) { state.underlay.visible = !state.underlay.visible; setDirty(true); renderControls(); scheduleDraw(); }
    } else if (action === 'toggle-grid') { state.gridVisible = !state.gridVisible; scheduleDraw(); notice(`補助グリッドを${state.gridVisible ? '表示' : '非表示'}にしました`); }
    else if (action === 'reset-style') { state.style = { ...DEFAULT_STYLE }; renderControls(); notice('区画の既定色を標準に戻しました'); }
    else if (action === 'show-help') { state.helpMode = true; renderControls(); }
    else if (action === 'close-help') { state.helpMode = false; renderControls(); }
    else if (action === 'back-point') { state.draft.pop(); renderControls(); updateStatus(); scheduleDraw(); }
    else if (action === 'clear-draft') clearDraft();
    else if (action === 'finish-draft') finishParcel();
    else if (action === 'edit-vertex') setCommand('vertex', { keepSelection: true });
    else if (action === 'edit-label') setCommand('label', { keepSelection: true });
    else if (action === 'edit-dimension') setCommand('dimension', { keepSelection: true });
    else if (action === 'vertex-done') setCommand('select', { keepSelection: true });
    else if (action === 'delete-selected') deleteLot(activeLot());
    else if (action === 'center-label') {
      const lot = activeLot();
      if (!lot) return;
      const labelStyle = mergedLabelStyle(lot);
      if (!labelStyle.offsetX && !labelStyle.offsetY) return;
      pushHistory();
      lot.labelStyle = { ...labelStyle, offsetX: 0, offsetY: 0 };
      setDirty(true);
      renderControls();
      scheduleDraw();
    }
    else if (action === 'cancel-calibration') { state.calibrationPoints = []; state.calibrationDistance = ''; renderControls(); updateStatus(); scheduleDraw(); }
    else if (action === 'apply-calibration') applyCalibration();
    else if (action === 'opacity-down' || action === 'opacity-up') {
      state.underlay.opacity = clamp(state.underlay.opacity + (action === 'opacity-up' ? 0.08 : -0.08), 0.12, 1);
      setDirty(true); renderControls(); scheduleDraw();
    } else if (action === 'prev-page' || action === 'next-page') {
      const delta = action === 'next-page' ? 1 : -1;
      renderPdfPage(clamp(state.underlay.page + delta, 1, state.underlay.pages)).then(() => { setDirty(true); renderControls(); });
    } else if (action === 'cancel-pending') { state.pendingConfirm = null; renderControls(); }
    else if (action === 'confirm-pending') {
      const pending = state.pendingConfirm;
      state.pendingConfirm = null;
      pending?.();
    }
  }

  function handleToggle(key, value) {
    const bool = value === true || value === 'true';
    const selected = activeLot();
    if (key === 'showArea') state.style.showArea = bool;
    else if (key === 'showLengths') state.style.showLengths = bool;
    else if (key === 'approximate') state.style.approximate = bool;
    else if (key === 'selected-showArea' && selected) { pushHistory(); selected.showArea = bool; setDirty(true); }
    else if (key === 'selected-showLengths' && selected) { pushHistory(); selected.showLengths = bool; setDirty(true); }
    else if (key === 'selected-approximate' && selected) { pushHistory(); selected.approximate = bool; setDirty(true); }
    else if (key === 'label-vertical' && selected) {
      pushHistory();
      selected.labelStyle = { ...mergedLabelStyle(selected), vertical: bool };
      setDirty(true);
    } else if (key === 'dimension-rotate' && selected) {
      pushHistory();
      selected.dimensionStyle = { ...mergedDimensionStyle(selected), rotate: bool };
      setDirty(true);
    }
    renderControls();
    scheduleDraw();
  }

  function setStyle(scope, fill, stroke) {
    if (scope === 'draft') {
      state.style.fill = fill;
      state.style.stroke = stroke;
    } else if (scope === 'selected') {
      const lot = activeLot();
      if (!lot) return;
      pushHistory();
      lot.style.fill = fill;
      lot.style.stroke = stroke;
      state.style.fill = fill;
      state.style.stroke = stroke;
      setDirty(true);
    }
    renderControls();
    scheduleDraw();
  }

  function setStylePreset(scope, key) {
    const preset = SHAPE_PRESETS.find((item) => item.key === key);
    if (preset) setStyle(scope, preset.fill, preset.stroke);
  }

  function commitControlField(target) {
    const lot = activeLot();
    const field = target?.dataset?.field;
    if (!lot || !field || field === 'calibration-distance') return;
    let shouldRender = true;
    if (field === 'selected-label') {
      const value = target.value.trim() || `区画 ${lot.number || ''}`;
      if (value === lot.label) return;
      pushHistory();
      lot.label = value;
      shouldRender = false;
    } else if (field === 'label-font') {
      const value = FONT_PRESETS[target.value] ? target.value : DEFAULT_LABEL_STYLE.font;
      if (mergedLabelStyle(lot).font === value) return;
      pushHistory();
      lot.labelStyle = { ...mergedLabelStyle(lot), font: value };
    } else if (field === 'label-size') {
      const value = clamp(finite(target.value, DEFAULT_LABEL_STYLE.size), 6, 72);
      if (mergedLabelStyle(lot).size === value) return;
      pushHistory();
      lot.labelStyle = { ...mergedLabelStyle(lot), size: value };
    } else if (field === 'label-color') {
      const value = safeColor(target.value, DEFAULT_LABEL_STYLE.color);
      if (mergedLabelStyle(lot).color === value) return;
      pushHistory();
      lot.labelStyle = { ...mergedLabelStyle(lot), color: value };
    } else if (field === 'label-angle') {
      const value = clamp(finite(target.value, 0), -180, 180);
      if (mergedLabelStyle(lot).angle === value) return;
      pushHistory();
      lot.labelStyle = { ...mergedLabelStyle(lot), angle: value };
    } else if (field === 'dimension-decimals') {
      const value = clamp(Math.round(finite(target.value, 2)), 0, 3);
      if (Number(lot.decimals ?? 2) === value) return;
      pushHistory();
      lot.decimals = value;
    } else if (field === 'dimension-size') {
      const value = clamp(finite(target.value, DEFAULT_DIMENSION_STYLE.size), 6, 40);
      if (mergedDimensionStyle(lot).size === value) return;
      pushHistory();
      lot.dimensionStyle = { ...mergedDimensionStyle(lot), size: value };
    } else if (field === 'dimension-color') {
      const value = safeColor(target.value, DEFAULT_DIMENSION_STYLE.color);
      if (mergedDimensionStyle(lot).color === value) return;
      pushHistory();
      lot.dimensionStyle = { ...mergedDimensionStyle(lot), color: value };
    } else if (field === 'dimension-offset') {
      const value = clamp(finite(target.value, DEFAULT_DIMENSION_STYLE.offset), 0, 60);
      if (mergedDimensionStyle(lot).offset === value) return;
      pushHistory();
      lot.dimensionStyle = { ...mergedDimensionStyle(lot), offset: value };
    } else {
      return;
    }
    setDirty(true);
    if (shouldRender) renderControls();
    updateStatus();
    scheduleDraw();
  }

  function openMenu(name, trigger) {
    const popup = document.querySelector(`[data-popup="${name}"]`);
    const willOpen = popup?.hidden !== false;
    closeMenus();
    if (popup && willOpen) {
      popup.hidden = false;
      trigger.classList.add('menu-open');
    }
  }

  function closeMenus() {
    document.querySelectorAll('.menu-popup').forEach((popup) => { popup.hidden = true; });
    document.querySelectorAll('.menu-button.menu-open').forEach((button) => button.classList.remove('menu-open'));
  }

  function onPointerDown(event) {
    const screen = eventPoint(event);
    const world = screenToWorld(screen.x, screen.y);
    canvas.focus({ preventScroll: true });
    closeMenus();

    if (event.button === 1 || (event.button === 0 && state.spaceDown)) {
      event.preventDefault();
      state.panning = { pointerId: event.pointerId, startX: screen.x, startY: screen.y, viewX: state.view.x, viewY: state.view.y };
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
      canvas.dataset.cursor = 'panning';
      return;
    }
    if (event.button !== 0) return;

    if (state.command === 'parcel') {
      if (event.detail >= 2) finishParcel();
      else addCommandPoint(world, 'free');
    } else if (state.command === 'calibrate') {
      if (state.calibrationPoints.length < 2) addCommandPoint(world, 'free');
    } else if (state.command === 'select') {
      selectLot(findLotAt(world));
    } else if (state.command === 'dimension') {
      selectLot(findLotAt(world));
    } else if (state.command === 'label') {
      const lot = findLotAt(world);
      selectLot(lot);
      if (lot) {
        const labelStyle = mergedLabelStyle(lot);
        state.labelDrag = {
          pointerId: event.pointerId,
          lotId: lot.id,
          startX: world.x,
          startY: world.y,
          offsetX: finite(labelStyle.offsetX, 0),
          offsetY: finite(labelStyle.offsetY, 0),
          before: interactionSnapshot(),
          moved: false,
        };
        try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
      }
    } else if (state.command === 'delete') {
      deleteLot(findLotAt(world));
    } else if (state.command === 'vertex') {
      const vertex = findVertexAt(world, !!state.selectedId);
      if (vertex) {
        if (state.selectedId !== vertex.lot.id) selectLot(vertex.lot);
        state.drag = { pointerId: event.pointerId, lotId: vertex.lot.id, index: vertex.index, before: interactionSnapshot(), moved: false };
        try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
      } else {
        selectLot(findLotAt(world));
      }
    }
  }

  function onPointerMove(event) {
    const screen = eventPoint(event);
    const world = screenToWorld(screen.x, screen.y);
    Object.assign(state.pointer, { x: screen.x, y: screen.y, worldX: world.x, worldY: world.y, inside: true });
    $('status-coord').textContent = state.mpp
      ? `X ${(world.x * state.mpp).toFixed(2)}m　Y ${(world.y * state.mpp).toFixed(2)}m`
      : `X ${world.x.toFixed(1)}　Y ${world.y.toFixed(1)}`;

    if (state.panning?.pointerId === event.pointerId) {
      state.view.x = state.panning.viewX + screen.x - state.panning.startX;
      state.view.y = state.panning.viewY + screen.y - state.panning.startY;
      scheduleDraw();
      return;
    }
    if (state.drag?.pointerId === event.pointerId) {
      const lot = state.lots.find((item) => item.id === state.drag.lotId);
      if (lot?.points[state.drag.index]) {
        if (!state.drag.moved) {
          state.history.push(state.drag.before);
          if (state.history.length > HISTORY_LIMIT) state.history.shift();
          state.future.length = 0;
          state.drag.moved = true;
        }
        lot.points[state.drag.index] = { x: world.x, y: world.y };
        setDirty(true);
        scheduleDraw();
      }
      return;
    }
    if (state.labelDrag?.pointerId === event.pointerId) {
      const lot = state.lots.find((item) => item.id === state.labelDrag.lotId);
      if (lot) {
        const dx = world.x - state.labelDrag.startX;
        const dy = world.y - state.labelDrag.startY;
        if (!state.labelDrag.moved && Math.hypot(dx, dy) * state.view.zoom >= 1) {
          state.history.push(state.labelDrag.before);
          if (state.history.length > HISTORY_LIMIT) state.history.shift();
          state.future.length = 0;
          state.labelDrag.moved = true;
        }
        if (state.labelDrag.moved) {
          lot.labelStyle = {
            ...mergedLabelStyle(lot),
            offsetX: state.labelDrag.offsetX + dx,
            offsetY: state.labelDrag.offsetY + dy,
          };
          setDirty(true);
          scheduleDraw();
        }
      }
      return;
    }

    state.hoverSnap = ['parcel', 'calibrate'].includes(state.command) ? findSnap(world) : null;
    scheduleDraw();
  }

  function onPointerUp(event) {
    if (state.panning?.pointerId === event.pointerId) {
      state.panning = null;
      try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
      canvas.dataset.cursor = commandCursor();
    }
    if (state.drag?.pointerId === event.pointerId) {
      state.drag = null;
      try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
      renderControls();
      updateStatus();
    }
    if (state.labelDrag?.pointerId === event.pointerId) {
      state.labelDrag = null;
      try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
      renderControls();
      updateStatus();
    }
  }

  function onContextMenu(event) {
    event.preventDefault();
    const screen = eventPoint(event);
    const world = screenToWorld(screen.x, screen.y);
    if (['parcel', 'calibrate'].includes(state.command)) {
      const snap = findSnap(world);
      if (!snap) {
        notice('この近くに読取点がありません', 'error');
        return;
      }
      addCommandPoint(snap.point, 'read');
    } else if (SELECTION_COMMANDS.includes(state.command)) {
      const snap = findSnap(world);
      const lot = snap?.lotId ? state.lots.find((item) => item.id === snap.lotId) : findLotAt(world);
      if (state.command === 'delete') deleteLot(lot);
      else selectLot(lot);
    }
  }

  function onWheel(event) {
    event.preventDefault();
    const screen = eventPoint(event);
    zoomAt(screen, Math.exp(-event.deltaY * 0.0014));
  }

  function isTypingTarget(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
  }

  function onKeyDown(event) {
    if (event.isComposing || event.keyCode === 229) return;
    const typing = isTypingTarget(event.target);
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 's') { event.preventDefault(); saveProject(); return; }
    if (typing) {
      if (event.key === 'Enter' && event.target?.dataset.field === 'calibration-distance') { event.preventDefault(); applyCalibration(); }
      else if (event.key === 'Escape') { event.preventDefault(); canvas.focus({ preventScroll: true }); }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); undo(); return; }
    if ((event.ctrlKey || event.metaKey) && (key === 'y' || (event.shiftKey && key === 'z'))) { event.preventDefault(); redo(); return; }
    if ((event.ctrlKey || event.metaKey) && key === 'n') { event.preventDefault(); handleAction('new'); return; }
    if ((event.ctrlKey || event.metaKey) && key === 'o') { event.preventDefault(); handleAction('open-underlay'); return; }
    if (event.code === 'Space') { state.spaceDown = true; event.preventDefault(); return; }
    if (event.repeat) return;
    if (key === 'q') setCommand('parcel');
    else if (key === 'v') setCommand('select');
    else if (key === 'e') setCommand('vertex', { keepSelection: true });
    else if (key === 't') setCommand('label', { keepSelection: true });
    else if (key === 'm') setCommand('dimension', { keepSelection: true });
    else if (key === 'd') setCommand('delete', { keepSelection: true });
    else if (key === 'b') setCommand('underlay');
    else if (key === 'c') setCommand('calibrate');
    else if (key === 'f') fitView();
    else if (event.key === 'Enter') {
      if (state.command === 'parcel') finishParcel();
      else if (state.command === 'calibrate' && state.calibrationPoints.length === 2) applyCalibration();
    } else if (event.key === 'Backspace' && state.command === 'parcel') {
      event.preventDefault();
      state.draft.pop();
      renderControls(); updateStatus(); scheduleDraw();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (state.command === 'parcel' && state.draft.length) clearDraft();
      else if (state.command === 'calibrate' && state.calibrationPoints.length) { state.calibrationPoints = []; renderControls(); updateStatus(); scheduleDraw(); }
      else setCommand('select');
    }
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const menu = event.target.closest('[data-menu]');
      if (menu) { event.stopPropagation(); openMenu(menu.dataset.menu, menu); return; }
      const command = event.target.closest('[data-command]');
      if (command) { setCommand(command.dataset.command, { keepSelection: SELECTION_COMMANDS.includes(command.dataset.command) }); closeMenus(); return; }
      const action = event.target.closest('[data-action]');
      if (action) { handleAction(action.dataset.action); return; }
      const swatch = event.target.closest('[data-style-scope]');
      if (swatch) { setStyle(swatch.dataset.styleScope, swatch.dataset.fill, swatch.dataset.stroke); return; }
      const toggle = event.target.closest('[data-toggle]');
      if (toggle) { handleToggle(toggle.dataset.toggle, toggle.dataset.value); return; }
      if (!event.target.closest('.menu-popup')) closeMenus();
    });

    controls.addEventListener('input', (event) => {
      if (event.target.dataset.field === 'calibration-distance') state.calibrationDistance = event.target.value;
    });
    controls.addEventListener('change', (event) => {
      if (event.target.dataset.check) handleToggle(event.target.dataset.check, event.target.checked);
      else if (event.target.dataset.stylePreset) setStylePreset(event.target.dataset.stylePreset, event.target.value);
      else commitControlField(event.target);
    });

    underlayInput.addEventListener('change', async () => {
      const file = underlayInput.files?.[0];
      underlayInput.value = '';
      if (file) await loadUnderlayFile(file);
    });
    projectInput.addEventListener('change', async () => {
      const file = projectInput.files?.[0];
      projectInput.value = '';
      if (file) await openProjectFile(file);
    });

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', () => { state.pointer.inside = false; state.hoverSnap = null; scheduleDraw(); });
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', (event) => { event.preventDefault(); if (state.command === 'parcel' && state.draft.length >= 3) finishParcel(); });

    stage.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
    stage.addEventListener('drop', async (event) => {
      event.preventDefault();
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      if (file.name.toLowerCase().endsWith('.json')) requestDestructive(() => openProjectFile(file));
      else await loadUnderlayFile(file);
    });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', (event) => { if (event.code === 'Space') state.spaceDown = false; });
    window.addEventListener('blur', () => { state.spaceDown = false; });
    window.addEventListener('resize', resizeCanvas);
    new ResizeObserver(resizeCanvas).observe(stage);

    window.electronAPI?.onCloseRequested?.(() => {
      if (!state.dirty) { window.electronAPI.respondToClose('discard'); return; }
      $('close-bar').hidden = false;
    });
    window.electronAPI?.onSaveAndClose?.(async () => {
      const success = await saveProject({ closeAfter: true });
      window.electronAPI.saveComplete(success);
    });
    $('close-bar').addEventListener('click', (event) => {
      const choice = event.target.closest('[data-close-choice]')?.dataset.closeChoice;
      if (!choice) return;
      $('close-bar').hidden = true;
      window.electronAPI?.respondToClose?.(choice);
    });
  }

  bindEvents();
  resizeCanvas();
  renderControls();
  updateStatus();
  updateChrome();
  scheduleDraw();

  Object.defineProperty(window, '__KOZU_V2__', {
    value: Object.freeze({
      state,
      setCommand,
      finishParcel,
      applyCalibration,
      fitView,
      undo,
      redo,
      serializeProject,
      importProject,
      scheduleDraw,
    }),
    configurable: false,
    enumerable: false,
    writable: false,
  });
})();
