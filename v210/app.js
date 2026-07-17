(() => {
  'use strict'

  const K = window.KozuV210
  if (!K || !K.DocumentStore || !K.CommandSession || !K.Renderer) {
    throw new Error('v2.1 の core.js / render.js を読み込めませんでした。')
  }

  const $ = (selector, root = document) => root.querySelector(selector)
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]
  const byId = id => document.getElementById(id)
  const page = documentModel => K.activePage(documentModel)
  const deepClone = value => K.clone(value)
  const finite = (value, fallback = 0) => K.finite(value, fallback)
  const LINE_STYLE_KINDS = new Set(['distance', 'polyline', 'area', 'line', 'arrow', 'callout', 'parallel', 'guide'])
  const AUTO_SNAP_COMMANDS = new Set([
    'calibrate', 'lot-draw', 'road-draw', 'distance', 'polyline', 'area', 'line', 'arrow', 'callout',
    'split', 'split-all', 'division-guide', 'lot-division-guide', 'parallel-guide',
    'move', 'copy', 'move-all', 'vertex-edit',
    'text', 'north', 'house', 'parking', 'lot-table'
  ])
  const DOUBLE_CLICK_FINISH_COMMANDS = new Set(['lot-draw', 'road-draw', 'polyline', 'area', 'line', 'split', 'split-all'])
  const TWO_POINT_AUTO_FINISH_COMMANDS = new Set(['distance', 'arrow', 'callout'])
  const AUTO_COMPLETE_COMMANDS = new Set(['distance', 'arrow', 'callout', 'text', 'north', 'house', 'parking', 'lot-table', 'merge', 'division-guide'])
  const SCALE_REQUIRED_COMMANDS = new Set(['lot-draw', 'road-draw', 'distance', 'polyline', 'area', 'corner-cut', 'parallel-guide', 'house', 'parking'])
  const DRAWING_SCALE_PRESETS = new Set([5, 10, 20, 25, 30, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 1000])
  const CENTERABLE_LABEL_KINDS = new Set(['lot', 'road', 'water', 'cutout', 'distance', 'polyline', 'area', 'dimension', 'arrow', 'callout'])
  const COLOR_OPTIONS = Object.freeze({
    ink: [['#172033', '濃紺'], ['#0f172a', '黒'], ['#334155', '灰'], ['#1d4ed8', '青'], ['#b4232d', '赤'], ['#08735c', '緑'], ['#7c3aed', '紫']],
    line: [['#253858', '濃紺'], ['#111827', '黒'], ['#1d4ed8', '青'], ['#b4232d', '赤'], ['#08735c', '緑'], ['#7c3aed', '紫']],
    dimension: [['#334155', '灰'], ['#172033', '濃紺'], ['#1d4ed8', '青'], ['#b4232d', '赤'], ['#08735c', '緑'], ['#7c3aed', '紫']],
    fill: [
      ['#f4dfa1', '淡い黄'], ['#cfe5f5', '淡い青'], ['#d8edcf', '淡い緑'], ['#f6d3b2', '淡い橙'],
      ['#f2cbd2', '淡い赤'], ['#ddd3f2', '淡い紫'], ['#cce9df', '淡い青緑'], ['#e7edc5', '淡い黄緑'],
      ['#f6ddd0', '淡い桃'], ['#e8dccb', '淡い茶'], ['#f1f3f5', 'ごく薄い灰'], ['#d8dde5', '薄灰'],
      ['#c3c9d1', '灰'], ['#adb5bd', '中灰'], ['#8d99a6', '濃灰'], ['#cbd5e1', '青灰'], ['#ffffff', '白']
    ],
    border: [
      ['#987722', '黄土'], ['#427aa1', '青'], ['#477b52', '緑'], ['#b36b31', '橙'], ['#a34f5d', '赤'],
      ['#6b5a9a', '紫'], ['#8d99a6', '中灰'], ['#596579', '道路灰'], ['#3f4a59', '濃い道路灰'], ['#172033', '濃紺']
    ]
  })
  const CSS_UNITS_PER_METER = 96 / 0.0254
  const PDF_UNITS_PER_METER = 72 / 0.0254
  const OUTPUT_DPI = 300
  const PREVIEW_MIN_DPR = 2
  const LABEL_BASE_SIZE = finite(K.DEFAULTS.labelStyle?.fontSize ?? K.DEFAULTS.labelStyle?.size, 14)
  const TEXT_BASE_SIZE = finite(K.DEFAULTS.textStyle?.fontSize ?? K.DEFAULTS.textStyle?.size, 14)
  const METRIC_BASE_SIZE = 12
  const DIMENSION_BASE_SIZE = finite(K.DEFAULTS.dimensionStyle?.fontSize ?? K.DEFAULTS.dimensionStyle?.size, 10)
  const ROAD_WIDTH_BASE_SIZE = 10
  const STANDARD_PREFERENCES = deepClone(K.normalizeDocument(K.createDocument()).preferences)
  const TYPOGRAPHY_PRESETS = Object.freeze({
    small: Object.freeze({ lot: 12, metric: 10, dimension: 9, road: 12, text: 12 }),
    standard: Object.freeze({ lot: 14, metric: 12, dimension: 10, road: 14, text: 14 }),
    large: Object.freeze({ lot: 17, metric: 14, dimension: 12, road: 17, text: 17 })
  })

  const CATEGORY = Object.freeze({
    underlay: { name: '下絵', icon: 'i-underlay' },
    select: { name: '選択', icon: 'i-select' },
    parcel: { name: '区画', icon: 'i-parcel' },
    road: { name: '道路', icon: 'i-road' },
    process: { name: '加工', icon: 'i-process' },
    measure: { name: '計測', icon: 'i-measure' },
    note: { name: '注記', icon: 'i-note' }
  })

  const COMMAND = Object.freeze({
    'underlay-open': { category: 'underlay', name: '下絵', icon: 'i-underlay', template: 'controls-underlay-calibrate', hint: '①下絵を開く　②ページを選ぶ　③そのページの縮尺を設定' },
    'underlay-replace': { category: 'underlay', name: '下絵差替', icon: 'i-replace', template: 'controls-underlay', hint: '現在の位置と倍率を保って下絵を差し替えます' },
    'underlay-page': { category: 'underlay', name: 'ページ', icon: 'i-page', template: 'controls-underlay', hint: 'PDFのページを切り替え、ページごとに縮尺を設定します' },
    'underlay-transform': { category: 'underlay', name: '下絵位置', icon: 'i-adjust', template: 'controls-underlay-adjust', hint: '数値入力またはドラッグで下絵を調整' },
    calibrate: { category: 'underlay', name: 'ページ・縮尺', icon: 'i-underlay', template: 'controls-underlay-calibrate', hint: '現在のページだけに縮尺を設定します。候補選択または2点校正を使用できます' },
    'paper-blank': { category: 'underlay', name: '下絵なし', icon: 'i-blank', template: 'controls-underlay', hint: '下絵なしの用紙へ切り替えます（作成済みの図形は保持します）' },

    select: { category: 'select', name: '選択', icon: 'i-select', hint: '図形を選択。文字・寸法も直接選べます' },
    move: { category: 'select', name: '移動', icon: 'i-move', hint: '対象を選び、移動先を指定' },
    'move-all': { category: 'select', name: '全体移動', icon: 'i-move-all', template: 'controls-move-all', hint: '移動対象を確認し、基準点と移動先を指定' },
    'vertex-edit': { category: 'select', name: '頂点編集', icon: 'i-vertex', hint: '頂点を選び、移動先を指定' },
    'label-edit': { category: 'select', name: '文字・寸法', icon: 'i-label', hint: '文字・寸法を選択して書式を編集' },
    copy: { category: 'select', name: '複写', icon: 'i-copy', hint: '対象を選び、複写位置を指定' },
    delete: { category: 'select', name: '削除', icon: 'i-delete', hint: '削除する図形を選択' },

    'lot-draw': { category: 'parcel', name: '区画', icon: 'i-parcel', template: 'controls-parcel', hint: '頂点クリック　ダブルクリック確定　右クリックで1点戻す' },
    'road-draw': { category: 'road', name: '道路・水路', icon: 'i-road', template: 'controls-road', hint: '外周クリック　ダブルクリック確定' },

    split: { category: 'process', name: '選択分割', icon: 'i-split', template: 'controls-process', hint: '区画を選び、分割線を左クリック。ダブルクリック/Enterで確定' },
    'split-all': { category: 'process', name: '一括分割', icon: 'i-split-all', template: 'controls-process', hint: '全区画を横切る線を左クリック。ダブルクリック/Enterで確定' },
    merge: { category: 'process', name: '合筆', icon: 'i-merge', template: 'controls-process', hint: '隣り合う区画、または区画と隅切りを2つ選択' },
    'corner-cut': { category: 'process', name: '隅切り', icon: 'i-corner', template: 'controls-process', hint: '区画の頂点を選択して確定' },
    'division-guide': { category: 'process', name: '均等ガイド', icon: 'i-guide', template: 'controls-process', hint: '任意の2点間を指定数で等分' },
    'lot-division-guide': { category: 'process', name: '区画等分線', icon: 'i-guide', template: 'controls-process', hint: '区画を選び、基準方向を2点で指定' },
    'parallel-guide': { category: 'process', name: '平行線', icon: 'i-parallel', template: 'controls-process', hint: '基準線の2点を指定' },
    'edge-hide': { category: 'process', name: '辺寸法非表示', icon: 'i-display', template: 'controls-process', hint: '表示を切り替える辺を選択' },

    distance: { category: 'measure', name: '2点距離', icon: 'i-distance', template: 'controls-measure', hint: '始点と終点を指定' },
    polyline: { category: 'measure', name: '折れ線距離', icon: 'i-polyline', template: 'controls-measure', hint: '折れ点を左クリック。ダブルクリック/Enterで確定' },
    area: { category: 'measure', name: '面積計測', icon: 'i-area', template: 'controls-measure', hint: '外周を左クリック。ダブルクリック/Enterで確定' },

    line: { category: 'note', name: '線', icon: 'i-line', template: 'controls-note', hint: '点を順にクリック　ダブルクリック/Enterで確定' },
    arrow: { category: 'note', name: '矢印', icon: 'i-arrow', template: 'controls-note', hint: '始点と矢先を指定' },
    text: { category: 'note', name: '文字', icon: 'i-text', template: 'controls-note', hint: '配置前プレビューを確認して位置を指定' },
    callout: { category: 'note', name: '引出線', icon: 'i-callout', template: 'controls-note', hint: '先端→文字位置の2点を指定' },
    north: { category: 'note', name: '北マーク', icon: 'i-north', template: 'controls-stamp', hint: '配置前プレビューを確認して位置を指定' },
    house: { category: 'note', name: '家屋', icon: 'i-house', template: 'controls-stamp', hint: '幅・奥行・角度を確認して配置' },
    parking: { category: 'note', name: '駐車', icon: 'i-parking', template: 'controls-stamp', hint: '幅・奥行・角度を確認して配置' },
    'lot-table': { category: 'note', name: '面積表', icon: 'i-table', template: 'controls-place-table', hint: '配置前プレビューを確認して位置を指定' },
    'display-settings': { category: 'select', name: '表示設定', icon: 'i-display', template: 'controls-display-settings', hint: '図面全体の表示・吸着を設定' },
    'typography-settings': { category: 'select', name: '文字サイズ設定', icon: 'i-text', template: 'controls-typography-settings', hint: '新規の標準値と既存図形への一括反映を分けて設定' }
  })

  const UI_COMMAND_ALIASES = Object.freeze({
    underlay: 'underlay-open',
    'underlay-replace': 'underlay-replace',
    'underlay-page': 'underlay-page',
    'underlay-adjust': 'underlay-transform',
    'blank-paper': 'paper-blank',
    calibrate: 'calibrate',
    select: 'select', move: 'move', 'move-all': 'move-all', vertex: 'vertex-edit', label: 'label-edit', copy: 'copy', delete: 'delete',
    parcel: 'lot-draw', road: 'road-draw', split: 'split', 'split-all': 'split-all', merge: 'merge', 'corner-cut': 'corner-cut',
    'division-guide': 'division-guide', 'lot-division-guide': 'lot-division-guide', parallel: 'parallel-guide', 'edge-hide': 'edge-hide',
    distance: 'distance', polyline: 'polyline', area: 'area', line: 'line', arrow: 'arrow', text: 'text', callout: 'callout',
    'north-arrow': 'north', 'house-stamp': 'house', 'parking-stamp': 'parking', 'lot-table': 'lot-table', 'display-settings': 'display-settings',
    'typography-settings': 'typography-settings'
  })

  const SHORTCUTS = Object.freeze({
    B: 'underlay-open', V: 'select', P: 'lot-draw', R: 'road-draw',
    X: 'move', 'Shift+X': 'move-all', Z: 'vertex-edit', E: 'label-edit',
    S: 'split', 'Shift+S': 'split-all', G: 'merge', K: 'corner-cut', D: 'division-guide', Q: 'parallel-guide',
    M: 'distance', 'Shift+M': 'polyline', A: 'area', L: 'line', W: 'arrow', T: 'text', O: 'callout',
    N: 'north', U: 'house', I: 'parking', Y: 'lot-table', C: 'calibrate'
  })

  const dom = {
    body: document.body,
    controlBar: byId('control-bar'),
    canvas: byId('drawing-canvas'),
    stage: byId('drawing-stage'),
    dropHint: byId('empty-canvas-hint'),
    commandName: byId('command-name'),
    commandStep: byId('command-step'),
    commandActions: byId('command-actions'),
    commandPages: byId('command-pages'),
    commandControls: byId('command-controls'),
    dirty: byId('dirty-mark'),
    documentName: byId('document-name'),
    statusMessage: byId('status-message'),
    statusCoord: byId('status-coord'),
    statusScale: byId('status-scale'),
    statusZoom: byId('status-zoom'),
    statusSnap: byId('status-snap'),
    statusCount: byId('status-count'),
    underlayInput: byId('underlay-input'),
    replaceInput: byId('underlay-replace-input'),
    projectInput: byId('project-input'),
    closeBar: byId('close-bar'),
    scaleRequiredDialog: byId('scale-required-dialog'),
    registryRows: byId('registry-rows'),
    registrySummary: byId('registry-summary'),
    outputPreview: byId('output-preview-canvas')
  }

  const store = new K.DocumentStore(K.createDocument())
  const session = new K.CommandSession()
  const renderer = new K.Renderer(dom.canvas, { document: store.document, view: { x: 36, y: 32, zoom: 1 } })
  const IO = K.IO || {}
  const desktop = window.kozuDesktop || {}

  const ui = {
    workspace: 'drawing',
    category: 'underlay',
    launcher: false,
    contextPage: '',
    selectedIds: [],
    registryIds: new Set(),
    registryTab: 'lots',
    outputTab: 'export',
    editDraft: null,
    editOriginal: null,
    batchDrafts: [],
    batchOriginals: [],
    batchTouched: new Set(),
    editEdgeIndex: null,
    editSegmentIndex: null,
    segmentPanel: 'text',
    specialPanel: 'primary',
    valueLabelPanel: 'area',
    clipboard: [],
    clipboardPasteCount: 0,
    statusOverride: '',
    statusTimer: 0,
    documentName: '無題',
    output: { includeUnderlay: true, note: '', showTitleFrame: true },
    scaleFlow: { reason: null, returnCommand: null }
  }

  const runtime = {
    view: { x: 36, y: 32, zoom: 1 },
    pointerWorld: null,
    pointerScreen: null,
    hover: null,
    hoverSnap: null,
    edgeHover: null,
    moveSnap: null,
    pan: null,
    spaceDown: false,
    composing: false,
    backgroundRuntime: null,
    backgroundSource: null,
    drag: null,
    resizeObserver: null,
    renderingOutput: false,
    pendingClose: false,
    pendingDestructiveResolve: null,
    fileDragDepth: 0,
    compositionEndedAt: 0
  }

  function parseNumeric(value, fallback = null) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
    const normalized = String(value ?? '')
      .replace(/[０-９]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
      .replace(/[，,]/g, '').replace(/．/g, '.').replace(/[ー−]/g, '-')
      .trim()
    if (!normalized) return fallback
    const result = Number(normalized)
    return Number.isFinite(result) ? result : fallback
  }

  function numericTextValue(value) {
    const normalized = String(value ?? '')
      .replace(/[０-９]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
      .replace(/[，,]/g, '').replace(/[．]/g, '.').replace(/[ー−]/g, '-')
    const match = normalized.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/)
    return match ? parseNumeric(match[0], null) : null
  }

  function toHalfWidthText(value) {
    return String(value ?? '')
      .replace(/[！-～]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
      .replace(/\u3000/g, ' ')
  }

  function normalizeMetricLabelText(value, unit) {
    let text = toHalfWidthText(value).trim()
    if (!text) return ''
    if (unit === '㎡') text = text.replace(/\s*(?:㎡|m\s*[2²]|平方メートル)\s*$/i, '').trimEnd()
    else text = text.replace(/\s*坪\s*$/, '').trimEnd()
    return text ? `${text}${unit}` : ''
  }

  function fontScale(style, baseSize) {
    const explicitSize = Number(style?.size ?? style?.fontSize)
    if (Number.isFinite(explicitSize) && explicitSize > 0) return explicitSize / baseSize
    return Math.max(0.05, finite(style?.scale, 1))
  }

  function metricLabelVisible(object, key) {
    const property = key === 'tsubo' ? 'tsuboLabel' : 'areaLabel'
    const label = object?.[property]
    if (typeof label?.visible === 'boolean') return label.visible
    return key === 'tsubo' ? object?.visibility?.tsubo === true : object?.visibility?.area !== false
  }

  function safeFileName(value, extension = '') {
    let name = String(value || 'kozu-project').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'kozu-project'
    if (extension && !name.toLowerCase().endsWith(extension.toLowerCase())) name += extension
    return name
  }

  function colorSelectMarkup(field, label, palette = 'ink', extraClass = '') {
    const options = (COLOR_OPTIONS[palette] || COLOR_OPTIONS.ink)
      .map(([value, name]) => `<option value="${value}">${name}</option>`).join('')
    return `<label class="field-inline ${extraClass}"><span>${label}</span><select class="ctrl-select color-select" data-field="${field}" data-color-select="${palette}">${options}</select></label>`
  }

  function hasScale(documentModel = store.document) {
    return Number.isFinite(Number(documentModel?.calibration?.mpp)) && Number(documentModel.calibration.mpp) > 0
  }

  function resetAllCalibrations(documentModel) {
    documentModel.calibration = { ...K.createDocument().calibration }
    for (const pageValue of documentModel.pages || []) pageValue.calibration = { ...K.createDocument().calibration }
  }

  function worldUnitsPerMeter(documentModel = store.document) {
    const background = documentModel?.background || {}
    const backgroundScale = Math.max(0.0001, finite(background.scale, 1))
    if (background.type === 'pdf') return PDF_UNITS_PER_METER * backgroundScale
    if (background.type === 'image') {
      const dpi = Number(background.metadata?.dpi)
      return Number.isFinite(dpi) && dpi > 0 ? (dpi / 0.0254) * backgroundScale : null
    }
    return CSS_UNITS_PER_METER
  }

  function mapScaleFromMpp(mpp, documentModel = store.document) {
    const units = worldUnitsPerMeter(documentModel)
    return units && Number(mpp) > 0 ? Number(mpp) * units : null
  }

  function mppFromMapScale(scale, documentModel = store.document) {
    const units = worldUnitsPerMeter(documentModel)
    return units && Number(scale) > 0 ? Number(scale) / units : null
  }

  function resolvedMapScale(documentModel = store.document) {
    const calibration = documentModel?.calibration || {}
    const explicit = Number(calibration.mapScale)
    if (Number.isFinite(explicit) && explicit > 0) return explicit
    const inferred = mapScaleFromMpp(calibration.mpp, documentModel)
    return Number.isFinite(inferred) && inferred > 0 ? inferred : null
  }

  function outputPixelsPerWorldUnit(documentModel = store.document, dpi = 96) {
    const targetDpi = Math.max(1, finite(dpi, 96))
    const mpp = Number(documentModel?.calibration?.mpp)
    const mapScale = resolvedMapScale(documentModel)
    if (Number.isFinite(mpp) && mpp > 0 && Number.isFinite(mapScale) && mapScale > 0) {
      return (mpp / mapScale) * (targetDpi / 0.0254)
    }
    const background = documentModel?.background || {}
    if (background.type === 'pdf') return targetDpi / 72
    const imageDpi = Number(background.metadata?.dpi)
    if (background.type === 'image' && Number.isFinite(imageDpi) && imageDpi > 0) return targetDpi / imageDpi
    return targetDpi / 96
  }

  function roadTypeCode(value) {
    const text = String(value || '')
    if (text === 'water' || text.includes('水路')) return 'water'
    if (text === 'location-designated' || text.includes('位置指定')) return 'location-designated'
    if (text === 'recognized-private' || text.includes('認定外')) return 'recognized-private'
    if (text === 'private' || text.includes('私道')) return 'private'
    if (text === 'public' || text.includes('公道')) return 'public'
    if (['road', 'other'].includes(text)) return text
    return 'road'
  }

  function roadTypeLabel(value, kind = 'road') {
    if (kind === 'water' || value === 'water') return '水路'
    const labels = {
      public: '公道', private: '私道', 'location-designated': '位置指定道路',
      'recognized-private': '認定外道路', road: '道路', other: '道路'
    }
    return labels[String(value || '')] || String(value || '道路')
  }

  function setStatus(message, timeout = 0) {
    ui.statusOverride = String(message || '')
    if (ui.statusTimer) clearTimeout(ui.statusTimer)
    if (timeout > 0) ui.statusTimer = setTimeout(() => { ui.statusOverride = ''; updateStatus() }, timeout)
    updateStatus()
  }

  function currentObject() {
    const id = ui.selectedIds[0]
    return id ? K.objectById(store.document, id)?.object || null : null
  }

  function selectedObjects() {
    return ui.selectedIds.map(id => K.objectById(store.document, id)?.object).filter(Boolean)
  }

  function selectedKind() {
    const objects = selectedObjects()
    if (!objects.length) return null
    return objects.every(object => object.kind === objects[0].kind) ? objects[0].kind : null
  }

  function resetEditDrafts() {
    ui.editDraft = null
    ui.editOriginal = null
    ui.batchDrafts = []
    ui.batchOriginals = []
    ui.batchTouched = new Set()
  }

  function allObjects() {
    const active = page(store.document)
    return active ? [...active.shapes, ...active.entities] : []
  }

  function documentHasWork(documentModel = store.document) {
    const pages = Array.isArray(documentModel?.pages) ? documentModel.pages : []
    return Boolean(
      documentModel?.background?.type ||
      Number(documentModel?.calibration?.mpp) > 0 ||
      pages.some(pageValue => (pageValue.shapes?.length || 0) + (pageValue.entities?.length || 0) > 0)
    )
  }

  function syncEmptyCanvasHint() {
    if (!dom.dropHint) return
    const hintCommands = new Set(['underlay-open', 'calibrate', 'paper-blank', 'select'])
    const hintContext = hintCommands.has(session.command) || String(session.command || '').startsWith('launcher:')
    const empty = !store.document.background?.type && allObjects().length === 0 && session.points.length === 0 && hintContext
    dom.dropHint.hidden = !empty
  }

  function focusCalibrationDistance() {
    const focusInput = () => {
      if (session.command !== 'calibrate' || session.points.length !== 2) return
      const input = $('[data-field="calibration-distance"]', dom.commandControls)
      input?.focus({ preventScroll: true })
      input?.select?.()
    }
    focusInput()
    requestAnimationFrame(focusInput)
    setTimeout(focusInput, 30)
  }

  function captureLotTableRows(documentModel = store.document) {
    const active = page(documentModel)
    const mpp = Math.max(0, finite(documentModel.calibration?.mpp))
    return (active?.shapes || []).filter(shape => shape.kind === 'lot' && shape.visible !== false).map(shape => {
      const area = Number.isFinite(Number(shape.area)) ? Number(shape.area) : (mpp > 0 ? K.polygonArea(shape.points) * mpp * mpp : null)
      return {
        number: shape.number ?? '', label: shape.label || '',
        area, tsubo: area == null ? null : area / K.TSUBO_M2,
        price: shape.price ?? null, memo: shape.memo || ''
      }
    })
  }

  function hitAt(world, partPreference = null) {
    if (!world) return null
    const tolerance = 8 / runtime.view.zoom
    const hit = K.hitTestDocument(store.document, world, tolerance)
    if (!hit || !partPreference) return hit
    if (partPreference === 'vertex' && hit.part !== 'vertex') {
      const active = page(store.document)
      let nearest = null
      for (const object of [...active.shapes, ...active.entities]) {
        ;(object.points || []).forEach((vertex, index) => {
          const d = K.distance(world, vertex)
          if (d <= tolerance && (!nearest || d < nearest.distance)) nearest = { id: object.id, type: object.kind === 'lot' || object.kind === 'road' || object.kind === 'water' || object.kind === 'cutout' ? 'shape' : 'entity', part: 'vertex', index, object, distance: d }
        })
      }
      return nearest || hit
    }
    return hit
  }

  function selectedVertexAt(world) {
    if (!world || !ui.selectedIds.length) return null
    const tolerance = 10 / runtime.view.zoom
    let nearest = null
    for (const id of ui.selectedIds) {
      const found = K.objectById(store.document, id)
      const object = found?.object
      ;(object?.points || []).forEach((vertex, index) => {
        const distance = K.distance(world, vertex)
        if (distance <= tolerance && (!nearest || distance < nearest.distance)) {
          nearest = { id: object.id, type: found.type, part: 'vertex', index, object, distance }
        }
      })
    }
    return nearest
  }

  function selectedLotEdgeAt(world) {
    const lot = ui.selectedIds.length === 1 ? K.objectById(store.document, ui.selectedIds[0])?.object : null
    if (!world || lot?.kind !== 'lot' || !Array.isArray(lot.points) || lot.points.length < 2) return null
    const tolerance = 13 / runtime.view.zoom
    let best = null
    for (let index = 0; index < lot.points.length; index += 1) {
      const start = lot.points[index]
      const end = lot.points[(index + 1) % lot.points.length]
      const nearest = K.nearestPointOnSegment(world, start, end)
      const distance = finite(nearest?.distance, Infinity)
      if (distance <= tolerance && (!best || distance < best.distance)) best = { id: lot.id, index, distance, point: nearest.point }
    }
    return best
  }

  function setLotEdgeVisibility(object, index, visible) {
    if (object?.kind !== 'lot' || !Number.isInteger(index)) return false
    if (!Array.isArray(object.edges) || object.edges.length < (object.points?.length || 0)) {
      object.edges = K.edgeMetadata(store.document, object.points || [], object.edges)
    }
    if (!object.edges[index]) return false
    for (const legacyIndex of Array.isArray(object.hiddenEdges) ? object.hiddenEdges : []) {
      const numericIndex = Number(legacyIndex)
      if (Number.isInteger(numericIndex) && object.edges[numericIndex]) object.edges[numericIndex].hidden = true
    }
    delete object.hiddenEdges
    object.edges[index].hidden = !visible
    return true
  }

  function pointerSnapRequested() {
    if (!AUTO_SNAP_COMMANDS.has(session.command)) return false
    if ((session.command === 'move' || session.command === 'copy') && !session.targetIds.length) return false
    if (session.command === 'vertex-edit' && session.vertexIndex == null) return false
    return true
  }

  function pointerSnapSettings() {
    const settings = { ...(store.document.preferences.snap || {}) }
    if ((session.command === 'move' || session.command === 'copy') && session.targetIds.length && session.points.length) {
      settings.excludeObjectIds = [...session.targetIds]
    } else if (session.command === 'vertex-edit' && session.vertexIndex != null && session.targetIds.length) {
      settings.excludeObjectIds = [...session.targetIds]
    } else if (session.command === 'move-all' && session.points.length) {
      settings.excludeObjectIds = allObjects().map(object => object.id)
    }
    return settings
  }

  function pointFromPointer(event, snapRequested = false) {
    const rect = dom.canvas.getBoundingClientRect()
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const free = renderer.screenToWorld(screen, runtime.view)
    if (!snapRequested) return { screen, world: free, snap: { point: free, type: 'free', distance: 0 } }
    const snap = K.snapPoint(store.document, free, pointerSnapSettings(), 10 / runtime.view.zoom)
    return { screen, world: snap.point, snap }
  }

  function cloneTemplate(id) {
    const template = byId(id)
    return template?.content ? template.content.cloneNode(true) : document.createDocumentFragment()
  }

  function syncWorkspaceLabels() {
    const outputTitle = $('#output-workspace .workspace-title strong')
    if (outputTitle) outputTitle.textContent = '出力'
    $$('[data-workspace-target="output"] .tool-label').forEach(element => { element.textContent = '出力' })
  }

  function installRegistryDock() {
    const panel = byId('registry-workspace')
    const commonRail = byId('common-rail')
    if (!panel || !commonRail || panel.classList.contains('registry-dock')) return
    panel.removeAttribute('data-workspace-panel')
    panel.hidden = false
    panel.classList.add('registry-dock')
    panel.querySelector('[data-workspace-target="drawing"]')?.remove()
    commonRail.before(panel)
  }

  function closeMenus() {
    $$('[data-popup]').forEach(popup => { popup.hidden = true })
    $$('[data-menu]').forEach(button => button.classList.remove('active'))
  }

  function setWorkspace(name) {
    if (name === 'registry') {
      commitPendingEdit()
      renderRegistry()
      byId('registry-search')?.focus({ preventScroll: true })
      setStatus('右側の一覧を表示しています。図面の表示倍率と選択は保持されます', 1800)
      closeMenus()
      return
    }
    const next = ['drawing', 'registry', 'output'].includes(name) ? name : 'drawing'
    const changed = ui.workspace !== next
    if (changed) {
      commitPendingEdit()
      cancelTransient(false)
      if (ui.statusTimer) clearTimeout(ui.statusTimer)
      ui.statusTimer = null
      ui.statusOverride = ''
      ui.selectedIds = []
      ui.contextPage = ''
      ui.launcher = true
      ui.category = 'select'
      session.activate('launcher:select')
      session.category = 'select'
    }
    ui.workspace = next
    dom.body.dataset.workspace = next
    $$('[data-workspace-panel]').forEach(panel => {
      const active = panel.dataset.workspacePanel === next
      panel.hidden = !active
      panel.classList.toggle('is-active', active)
    })
    $$('[data-workspace-target]').forEach(button => button.classList.toggle('active', button.dataset.workspaceTarget === next))
    renderCommandSurface()
    if (next === 'drawing') resizeCanvas()
    if (next === 'registry') renderRegistry()
    if (next === 'output') refreshOutputPreview()
    updateStatus()
    closeMenus()
  }

  function renderWorkspaceCommandSurface() {
    const registry = ui.workspace === 'registry'
    const meta = registry
      ? { name: '一覧', icon: 'i-table', step: '確認', hint: '作成した区画・道路・計測・注記を一覧で確認、編集します' }
      : { name: '出力', icon: 'i-output', step: '設定', hint: '用紙、タイトル枠、書き出し方法を設定します' }
    const icon = $('use', dom.commandName)
    if (icon) icon.setAttribute('href', `#${meta.icon}`)
    const label = $('span', dom.commandName)
    if (label) label.textContent = meta.name
    dom.commandName.disabled = true
    dom.commandStep.innerHTML = `<small>画面</small><strong>${meta.step}</strong>`
    dom.commandActions.replaceChildren()
    const back = document.createElement('button')
    back.className = 'ctrl-btn primary'
    back.type = 'button'
    back.dataset.workspaceTarget = 'drawing'
    back.textContent = '図面へ戻る'
    dom.commandActions.append(back)
    dom.commandPages.hidden = true
    dom.commandPages.replaceChildren()
    dom.commandControls.replaceChildren()
    const instruction = document.createElement('div')
    instruction.className = 'control-group instruction'
    const strong = document.createElement('strong')
    strong.textContent = meta.hint
    instruction.append(strong)
    dom.commandControls.append(instruction)
    $$('[data-category]', byId('category-rail')).forEach(button => button.classList.remove('active'))
  }

  function showLauncher(category = ui.category) {
    if (ui.workspace !== 'drawing') setWorkspace('drawing')
    const selectedCategory = CATEGORY[category] ? category : 'select'
    commitPendingEdit()
    cancelTransient(false)
    ui.category = selectedCategory
    ui.launcher = true
    ui.contextPage = ''
    session.activate(`launcher:${selectedCategory}`)
    session.category = selectedCategory
    ui.selectedIds = []
    resetEditDrafts()
    ui.editEdgeIndex = null
    ui.editSegmentIndex = null
    renderCommandSurface()
    render()
  }

  function defaultForm(command) {
    const documentModel = store.document
    const prefs = documentModel.preferences
    const lot = prefs.lot || {}
    const road = prefs.road || {}
    const line = prefs.line || K.DEFAULTS.lineStyle
    const text = prefs.text || K.DEFAULTS.textStyle
    const measurement = prefs.measurement?.dimensionStyle || K.DEFAULTS.dimensionStyle
    const stampName = command === 'parking' ? 'parking' : command === 'north' ? 'north' : 'house'
    const stamp = prefs.stamp?.[stampName] || {}
    switch (command) {
      case 'underlay-transform': return {
        'underlay-scale': finite(documentModel.background.scale, 1) * 100,
        'underlay-x': finite(documentModel.background.x), 'underlay-y': finite(documentModel.background.y),
        'underlay-angle': finite(documentModel.background.rotation)
      }
      case 'calibrate': {
        const currentScale = resolvedMapScale(documentModel)
        const scaleText = Number.isFinite(currentScale) && currentScale > 0 ? String(Number(currentScale.toFixed(4))) : ''
        return {
          'calibration-distance': '',
          'manual-scale': scaleText,
          'scale-preset': DRAWING_SCALE_PRESETS.has(Number(scaleText)) ? scaleText : ''
        }
      }
      case 'move-all': return { 'move-all-include-underlay': false }
      case 'lot-draw': return {
        fill: lot.style?.fill || K.DEFAULTS.lotStyle.fill,
        stroke: lot.style?.stroke || K.DEFAULTS.lotStyle.stroke,
        'fill-opacity': Math.round(finite(lot.style?.opacity, K.DEFAULTS.lotStyle.opacity) * 100),
        'show-area': lot.showArea !== false, 'show-tsubo': lot.showTsubo !== false, 'show-lengths': lot.showLengths !== false,
        approximate: Boolean(lot.dimensionStyle?.approximate),
        'dimension-decimals': lot.dimensionStyle?.decimals ?? 2,
        'dimension-rounding': lot.dimensionStyle?.rounding || 'round',
        'dimension-adjustment': finite(lot.dimensionStyle?.adjustment)
      }
      case 'road-draw': return {
        'road-type': road.type || '道路', 'road-name': road.name || '道路', 'road-width': finite(road.widthM, 4),
        fill: road.style?.fill || K.DEFAULTS.roadStyle.fill, stroke: road.style?.stroke || K.DEFAULTS.roadStyle.stroke,
        'fill-opacity': Math.round(finite(road.style?.opacity, K.DEFAULTS.roadStyle.opacity) * 100)
      }
      case 'division-guide': case 'lot-division-guide': return { 'division-count': 2 }
      case 'parallel-guide': return { 'parallel-distance': 3, parallelSign: 1, parallelCount: 0 }
      case 'corner-cut': return { 'corner-length': 2 }
      case 'distance': case 'polyline': case 'area': return {
        'line-style': line.lineStyle || 'solid', 'line-width': finite(line.lineWidth, 1.4), color: line.color || '#253858',
        'note-text': '', 'note-size': finite(text.fontSize, TEXT_BASE_SIZE), 'note-angle': 0, 'note-font': text.fontFamily || 'gothic', 'note-vertical': false,
        'dimension-approximate': Boolean(measurement.approximate),
        'dimension-decimals': measurement.decimals ?? measurement.digits ?? 2,
        'dimension-rounding': measurement.rounding || 'round',
        'dimension-adjustment': finite(measurement.adjustment)
      }
      case 'line': case 'arrow': return {
        'line-style': line.lineStyle || 'solid', 'line-width': finite(line.lineWidth, 1.4), color: line.color || '#253858',
        'note-text': '', 'note-size': finite(text.fontSize, TEXT_BASE_SIZE), 'note-angle': 0, 'note-font': text.fontFamily || 'gothic', 'note-vertical': false
      }
      case 'text': case 'callout': return {
        'note-text': command === 'callout' ? '注記' : '文字', 'note-size': finite(text.fontSize, TEXT_BASE_SIZE), 'note-angle': finite(text.rotation),
        'note-font': text.fontFamily || 'gothic', 'note-vertical': Boolean(text.vertical), color: text.color || '#172033',
        'line-style': line.lineStyle || 'solid', 'line-width': finite(line.lineWidth, 1.4)
      }
      case 'north': return {
        'stamp-width': finite(stamp.size, 54), 'stamp-depth': finite(stamp.size, 54),
        'stamp-scale': finite(stamp.scale, 1), 'stamp-text-scale': finite(stamp.textScale, finite(text.fontSize, TEXT_BASE_SIZE) / TEXT_BASE_SIZE),
        'stamp-angle': 0, 'stamp-dimensions': false, 'stamp-label': stamp.label || 'N', color: stamp.textColor || text.color || '#172033'
      }
      case 'house': case 'parking': return {
        'stamp-width': finite(stamp.widthM, command === 'parking' ? 2.5 : 10),
        'stamp-depth': finite(stamp.heightM, command === 'parking' ? 5 : 8), 'stamp-angle': 0,
        'stamp-scale': finite(stamp.scale, 1), 'stamp-text-scale': finite(stamp.textScale, finite(text.fontSize, TEXT_BASE_SIZE) / TEXT_BASE_SIZE),
        'stamp-dimensions': stamp.showDimensions !== false, 'stamp-label': stamp.label || (command === 'parking' ? 'P' : '家屋'),
        color: stamp.textColor || line.color || '#253858',
        'stamp-stroke': stamp.stroke || line.color || '#253858',
        'stamp-fill': stamp.fill || (command === 'parking' ? '#eef4fb' : '#edf2f8'),
        'stamp-hatch': command === 'house' ? stamp.hatch !== false : false,
        'line-style': stamp.lineStyle || line.lineStyle || 'solid'
      }
      case 'lot-table': return { 'table-scale': 1, 'table-angle': 0, 'table-mode': 'dynamic' }
      case 'display-settings': {
        const lots = (page(documentModel)?.shapes || []).filter(shape => shape.kind === 'lot')
        const everyLot = predicate => lots.length === 0 || lots.every(predicate)
        return {
          'global-show-underlay': documentModel.background.visible !== false,
          'global-show-number': everyLot(shape => shape.visibility?.number !== false),
          'global-show-area': everyLot(shape => shape.visibility?.area !== false && shape.areaLabel?.visible !== false),
          'global-show-tsubo': everyLot(shape => shape.visibility?.tsubo !== false && shape.tsuboLabel?.visible !== false),
          'global-show-lengths': everyLot(shape => shape.visibility?.dimensions !== false),
          'snap-grid': Boolean(prefs.snap?.grid), 'snap-vertex': prefs.snap?.vertex !== false,
          'snap-intersection': prefs.snap?.intersection !== false, 'snap-edge': prefs.snap?.edge !== false
        }
      }
      case 'typography-settings': return {
        'typography-lot': finite(prefs.lot?.labelStyle?.fontSize ?? prefs.typography?.lot, 14),
        'typography-metric': finite(prefs.typography?.metric, 12),
        'typography-dimension': finite(prefs.lot?.dimensionStyle?.fontSize ?? prefs.typography?.dimension, 10),
        'typography-road': finite(prefs.road?.labelStyle?.fontSize ?? prefs.typography?.road, 14),
        'typography-text': finite(prefs.text?.fontSize ?? prefs.typography?.text, 14)
      }
      default: return {}
    }
  }

  function activateCommand(rawCommand, options = {}) {
    const command = UI_COMMAND_ALIASES[rawCommand] || rawCommand
    const meta = COMMAND[command]
    if (!meta) return false
    closeScaleRequiredDialog()
    if (ui.workspace !== 'drawing') setWorkspace('drawing')
    commitPendingEdit()
    cancelTransient(false)
    ui.launcher = false
    ui.category = meta.category
    ui.contextPage = ''
    ui.selectedIds = []
    resetEditDrafts()
    ui.editEdgeIndex = null
    ui.editSegmentIndex = null
    session.activate(command, defaultForm(command))
    session.category = meta.category
    if (command === 'paper-blank') {
      store.commit('白紙図面', documentModel => {
        documentModel.background = { ...K.createDocument().background }
        resetAllCalibrations(documentModel)
        documentModel.paper.enabled = true
      })
      runtime.backgroundRuntime = null
      runtime.backgroundSource = null
      renderer.clearBackgroundSources()
    }
    renderCommandSurface()
    render()
    if (options.focusCanvas !== false) dom.canvas.focus({ preventScroll: true })
    return true
  }

  function closeScaleRequiredDialog() {
    const dialog = dom.scaleRequiredDialog
    if (!dialog) return
    if (typeof dialog.close === 'function' && dialog.open) dialog.close()
    else dialog.removeAttribute('open')
  }

  function showScaleRequiredDialog(command) {
    const dialog = dom.scaleRequiredDialog
    if (!dialog) return
    const commandLabel = $('[data-scale-required-command]', dialog)
    const pageLabel = $('[data-scale-required-page]', dialog)
    if (commandLabel) commandLabel.textContent = `「${COMMAND[command]?.name || command}」`
    if (pageLabel) pageLabel.textContent = `${Math.max(1, finite(store.document.background?.currentPage, 1))}ページ`
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal()
    } else dialog.setAttribute('open', '')
  }

  function requestUserCommand(rawCommand, options = {}) {
    const command = UI_COMMAND_ALIASES[rawCommand] || rawCommand
    if (SCALE_REQUIRED_COMMANDS.has(command) && !hasScale()) {
      ui.scaleFlow = { reason: 'required-command', returnCommand: command }
      activateCommand('calibrate', options)
      setStatus(`現在の${Math.max(1, finite(store.document.background?.currentPage, 1))}ページは縮尺未設定です。縮尺を設定するまで「${COMMAND[command]?.name || command}」は開始できません`, 0)
      showScaleRequiredDialog(command)
      return false
    }
    return activateCommand(command, options)
  }

  function completeScaleFlow(message) {
    const returnCommand = ui.scaleFlow.returnCommand
    ui.scaleFlow = { reason: null, returnCommand: null }
    closeScaleRequiredDialog()
    activateCommand(returnCommand || 'select', { focusCanvas: false })
    setStatus(returnCommand ? `${message}　「${COMMAND[returnCommand]?.name || returnCommand}」を開始します` : message, 2400)
    return true
  }

  function cancelTransient(rerender = true) {
    runtime.drag = null
    runtime.hoverSnap = null
    runtime.hover = null
    session.cancel()
    resetEditDrafts()
    runtime.edgeHover = null
    ui.editEdgeIndex = null
    ui.editSegmentIndex = null
    if (rerender) { renderCommandSurface(); render() }
  }

  function commandStepText() {
    const command = session.command
    const points = session.points.length
    const targets = session.targetIds.length
    if (ui.launcher) return { small: 'コマンド', strong: '選択' }
    if (command === 'underlay-open') return { small: '下絵', strong: '未読込' }
    if (command === 'calibrate') {
      if (points === 0) return { small: `ページ ${Math.max(1, finite(store.document.background?.currentPage, 1))}`, strong: hasScale() ? '設定済' : '未設定' }
      return { small: points === 1 ? '2点校正 終点' : '実距離入力', strong: points === 1 ? '2/2' : '確定' }
    }
    if (['lot-draw', 'road-draw', 'polyline', 'area'].includes(command)) return { small: '作図点', strong: String(points) }
    if (command === 'callout') return { small: points === 0 ? '先端' : points === 1 ? '文字位置' : '確定', strong: `${Math.min(points + 1, 2)}/2` }
    if (['distance', 'arrow'].includes(command)) return { small: points === 0 ? '始点' : '終点', strong: points === 0 ? '1/2' : '2/2' }
    if (command === 'line') return { small: '作図点', strong: String(points) }
    if (command === 'split') return { small: targets ? (points < 2 ? '分割線' : 'Enterで確定') : '区画選択', strong: targets ? `${points}点` : '1/2' }
    if (command === 'split-all') return { small: points < 2 ? '分割線' : 'Enterで確定', strong: `${points}点` }
    if (command === 'merge') return targets
      ? { small: '2つ目の区画', strong: '2/2' }
      : { small: '1つ目の区画', strong: '1/2' }
    if (command === 'corner-cut') {
      if (!targets) return { small: '区画選択', strong: '1/3' }
      if (session.vertexIndex == null) return { small: '頂点選択', strong: '2/3' }
      return { small: '実行', strong: '3/3' }
    }
    if (command === 'division-guide') return { small: points ? '終点' : '始点', strong: points ? '2/2' : '1/2' }
    if (command === 'lot-division-guide') {
      if (!targets) return { small: '区画選択', strong: '1/4' }
      if (!points) return { small: '方向始点', strong: '2/4' }
      if (points === 1) return { small: '方向終点', strong: '3/4' }
      return { small: '作成', strong: '4/4' }
    }
    if (command === 'parallel-guide') {
      if (!points) return { small: '基準始点', strong: '1/3' }
      if (points === 1) return { small: '基準終点', strong: '2/3' }
      return { small: '作成', strong: '3/3' }
    }
    if (['move', 'copy'].includes(command)) {
      if (!targets) return { small: '対象選択', strong: '1/3' }
      if (!points) return { small: '基準点', strong: '2/3' }
      return { small: '移動先', strong: '3/3' }
    }
    if (command === 'move-all') return { small: points ? '移動先' : '基準点', strong: points ? '2/2' : '1/2' }
    if (command === 'vertex-edit') return { small: session.vertexIndex == null ? '頂点選択' : '移動先', strong: session.vertexIndex == null ? '1/2' : '2/2' }
    if (['text', 'north', 'house', 'parking', 'lot-table'].includes(command)) return { small: '配置位置', strong: '1/1' }
    return { small: ui.selectedIds.length ? '編集中' : '対象選択', strong: ui.selectedIds.length ? '編集' : '1/1' }
  }

  function addDynamicCommandControls(command) {
    if (command === 'calibrate' || command === 'underlay-open') {
      const hasUnderlay = Boolean(store.document.background?.type)
      const openButton = $('[data-action="open-underlay"]', dom.commandControls)
      const applyButton = $('[data-action="apply-calibration"]', dom.commandControls)
      openButton?.classList.toggle('primary', !hasUnderlay)
      applyButton?.classList.toggle('primary', false)
      const directScaleAvailable = (hasUnderlay || store.document.paper?.enabled) && worldUnitsPerMeter() != null
      $$('[data-direct-scale]', dom.commandControls).forEach(element => { element.hidden = !directScaleAvailable })
      $$('.underlay-calibration-controls', dom.commandControls).forEach(element => { element.hidden = !hasUnderlay })
      if (hasUnderlay && !directScaleAvailable) {
        const warning = document.createElement('span')
        warning.className = 'notice-warning'
        warning.dataset.scaleWarning = ''
        warning.textContent = '画像の解像度が不明です。図面上の2点と実距離から、このページの縮尺を設定してください'
        dom.commandControls.append(warning)
      }
    }
    if (command === 'road-draw') {
      const widthField = $('[data-field="road-width"]', dom.commandControls)?.closest('label')
      widthField?.insertAdjacentHTML('beforebegin', '<label class="field-inline"><span>名称</span><input class="ctrl-input wide" data-field="road-name" type="text" placeholder="道路名称"></label>')
    }
    if (['text', 'callout'].includes(command)) {
      dom.commandControls.insertAdjacentHTML('beforeend', '<label class="field-inline context-optional"><span>書体</span><select class="ctrl-select compact-select" data-field="note-font"><option value="gothic">ゴシック</option><option value="mincho">明朝</option><option value="mono">等幅</option></select></label><label class="check-control context-optional"><input data-field="note-vertical" type="checkbox">縦書き</label>')
    }
    if (['line', 'arrow'].includes(command)) {
      for (const fieldName of ['note-text', 'note-size', 'note-angle']) {
        const field = $(`[data-field="${fieldName}"]`, dom.commandControls)
        const container = field?.closest('label') || field
        if (container) container.hidden = true
      }
      const colorLabel = $('[data-field="color"]', dom.commandControls)?.closest('label')?.querySelector('span')
      if (colorLabel) colorLabel.textContent = '線色'
    }
    if (['line', 'arrow', 'callout'].includes(command)) {
      dom.commandControls.insertAdjacentHTML('beforeend', '<label class="field-inline context-optional"><span>線種</span><select class="ctrl-select compact-select" data-field="line-style"><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option></select></label><label class="field-inline context-optional"><span>太さ</span><input class="ctrl-input number-small" data-field="line-width" type="number" min="0.5" max="10" step="0.5"></label>')
    }
    if (['north', 'house', 'parking'].includes(command)) {
      const appearance = command === 'north'
        ? colorSelectMarkup('color', '色', 'ink')
        : `${colorSelectMarkup('color', '文字色', 'ink')}${colorSelectMarkup('stamp-stroke', '枠線', 'border')}${colorSelectMarkup('stamp-fill', '塗り', 'fill')}${command === 'house' ? '<label class="check-control"><input data-field="stamp-hatch" type="checkbox">斜線</label>' : ''}<label class="field-inline"><span>線種</span><select class="ctrl-select compact-select" data-field="line-style"><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option></select></label>`
      dom.commandControls.insertAdjacentHTML('beforeend', `<label class="field-inline"><span>文字</span><input class="ctrl-input" data-field="stamp-label" type="text"></label><details class="toolbar-dropdown"><summary class="ctrl-btn">表示</summary><div class="toolbar-dropdown-panel">${appearance}</div></details>`)
      if (command === 'north') {
        $$('.stamp-metric-only, .stamp-dimension-only', dom.commandControls).forEach(element => { element.hidden = true })
      }
    }
  }

  function makeInstructionControls(meta) {
    const wrap = document.createElement('div')
    wrap.className = 'control-group instruction'
    const strong = document.createElement('strong')
    strong.textContent = meta.hint
    wrap.append(strong)
    if (['select', 'label-edit'].includes(session.command)) {
      const span = document.createElement('span')
      span.className = 'context-optional'
      span.textContent = '　クリック後、上部で編集'
      wrap.append(span)
    }
    dom.commandControls.append(wrap)
  }

  function showBatchEditor() {
    const objects = ui.batchDrafts.length ? ui.batchDrafts : selectedObjects()
    if (objects.length < 2) return
    const kind = objects.every(object => object.kind === objects[0].kind) ? objects[0].kind : null
    dom.controlBar?.classList.add('object-editing', 'batch-editing')
    const commandLabel = $('span', dom.commandName)
    if (commandLabel) commandLabel.textContent = kind ? '一括編集' : '複数選択'
    const shell = cloneTemplate('controls-object-edit')
    const actionGroup = $('.action-strip', shell)
    const pageGroup = $('.context-pages', shell)
    const deleteButton = $('[data-action="delete-selected"]', shell)
    dom.commandActions.replaceChildren(...(actionGroup ? [...actionGroup.children] : []))
    if (deleteButton) dom.commandActions.append(deleteButton)
    dom.commandPages.replaceChildren(...(pageGroup ? [...pageGroup.children] : []))
    dom.commandPages.hidden = !kind
    dom.commandControls.replaceChildren()
    if (!kind) {
      const notice = document.createElement('div')
      notice.className = 'batch-edit-notice warning'
      notice.innerHTML = `<strong>${objects.length}件・種類混在</strong><span>移動・複写・コピー・削除はまとめて実行できます。書式の一括変更は同じ種類だけを選択してください。</span>`
      dom.commandControls.append(notice)
      return
    }
    const object = objects[0]
    const isShape = ['lot', 'road', 'water', 'cutout'].includes(kind)
    const isRoadLike = kind === 'road' || kind === 'water'
    const isStamp = ['house', 'parking', 'north'].includes(kind)
    const isMeasurement = ['distance', 'polyline', 'area', 'dimension'].includes(kind)
    const hasShapeDimensions = isShape && !isRoadLike
    const hasEditableText = !['line', 'guide', 'parallel', 'lot-table'].includes(kind)
    const hasLineStyle = LINE_STYLE_KINDS.has(kind)
    const allowedPages = new Set(['object-basic'])
    if (hasShapeDimensions || isMeasurement) allowedPages.add('object-dimension')
    if (isRoadLike || isStamp || hasLineStyle) allowedPages.add('object-special')
    if (!allowedPages.has(ui.contextPage)) ui.contextPage = [...allowedPages][0] || ''
    $$('[data-context-page]', dom.commandPages).forEach(button => {
      const visible = allowedPages.has(button.dataset.contextPage)
      button.hidden = !visible
      button.classList.toggle('active', visible && button.dataset.contextPage === ui.contextPage)
      if (visible && button.dataset.contextPage === 'object-special') button.textContent = isRoadLike ? '幅員' : isStamp ? '配置' : '線'
    })
    if (ui.contextPage) dom.commandControls.append(cloneTemplate(`controls-${ui.contextPage}`))
    if (ui.contextPage === 'object-basic') {
      $$('[data-field="object-type"],[data-field="lot-number"]', dom.commandControls).forEach(field => {
        const container = field.closest('label') || field
        container.hidden = true
      })
      const recordDropdown = $('[data-field="object-label"]', dom.commandControls)?.closest('details')
      if (recordDropdown) recordDropdown.hidden = true
      $$('.shape-appearance-only', dom.commandControls).forEach(element => { element.hidden = !isShape })
      $$('.editable-text-only', dom.commandControls).forEach(element => { element.hidden = !hasEditableText })
      $$('.lot-only', dom.commandControls).forEach(element => { element.hidden = kind !== 'lot' })
    }
    if (ui.contextPage === 'object-special') {
      if (isStamp) {
        const metricControls = kind === 'north' ? '' : '<label class="field-inline"><span>幅</span><input class="ctrl-input number-small" data-field="stamp-width" type="number" min="0.1" step="0.1"><em>m</em></label><label class="field-inline"><span>奥行</span><input class="ctrl-input number-small" data-field="stamp-depth" type="number" min="0.1" step="0.1"><em>m</em></label>'
        const appearanceControls = kind === 'north' ? colorSelectMarkup('textColor', '色', 'ink') : `${colorSelectMarkup('textColor', '文字色', 'ink')}${colorSelectMarkup('stamp-stroke', '枠線', 'border')}${colorSelectMarkup('stamp-fill', '塗り', 'fill')}${kind === 'house' ? '<label class="check-control"><input data-field="stamp-hatch" type="checkbox">斜線</label>' : ''}<label class="field-inline"><span>線種</span><select class="ctrl-select compact-select" data-field="stamp-line-style"><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option></select></label>`
        dom.commandControls.insertAdjacentHTML('beforeend', `${metricControls}<label class="field-inline"><span>全体倍率</span><input class="ctrl-input number-small" data-field="stamp-scale" type="number" min="0.2" max="5" step="0.1"><em>倍</em></label><label class="field-inline"><span>文字倍率</span><input class="ctrl-input number-small" data-field="stamp-text-scale" type="number" min="0.3" max="5" step="0.1"><em>倍</em></label><label class="field-inline"><span>角度</span><input class="ctrl-input number-small" data-field="stamp-angle" type="number" step="1"><em>°</em></label>${kind === 'north' ? '' : '<label class="check-control"><input data-field="stamp-dimensions" type="checkbox">寸法</label>'}${appearanceControls}`)
      } else if (hasLineStyle) {
        dom.commandControls.insertAdjacentHTML('beforeend', `<label class="field-inline"><span>線種</span><select class="ctrl-select compact-select" data-field="object-line-style"><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option></select></label><label class="field-inline"><span>太さ</span><input class="ctrl-input number-small" data-field="object-line-width" type="number" min="0.5" max="10" step="0.5"></label>${colorSelectMarkup('object-line-color', '線色', 'line')}`)
      } else if (isRoadLike) {
        const widthPanel = ['primary', 'angle', 'style'].includes(ui.specialPanel) ? ui.specialPanel : 'primary'
        dom.commandControls.insertAdjacentHTML('beforeend', `<div class="control-group nested-tabs"><button class="ctrl-tab ${widthPanel === 'primary' ? 'active' : ''}" type="button" data-special-panel="primary">内容</button><button class="ctrl-tab ${widthPanel === 'angle' ? 'active' : ''}" type="button" data-special-panel="angle">角度</button><button class="ctrl-tab ${widthPanel === 'style' ? 'active' : ''}" type="button" data-special-panel="style">書式</button></div>`)
        if (widthPanel === 'primary') dom.commandControls.insertAdjacentHTML('beforeend', '<label class="field-inline"><span>種類</span><select class="ctrl-select" data-field="road-category"><option>道路</option><option>公道</option><option>私道</option><option>位置指定道路</option><option>認定外道路</option><option>水路</option></select></label><label class="check-control"><input data-field="road-width-visible" type="checkbox">幅員を表示</label><label class="field-inline"><span>幅員</span><input class="ctrl-input number-small" data-field="road-width" type="number" min="0" step="0.1"><em>m</em></label><label class="field-inline"><span>表記</span><input class="ctrl-input wide" data-field="road-width-text" type="text" placeholder="自動: 幅員 4.0m"></label>')
        else if (widthPanel === 'angle') dom.commandControls.insertAdjacentHTML('beforeend', '<label class="field-inline"><span>角度</span><input class="ctrl-input number-small" data-field="road-width-angle" type="number" step="1"><em>°</em></label>')
        else dom.commandControls.insertAdjacentHTML('beforeend', `<label class="field-inline"><span>書体</span><select class="ctrl-select compact-select" data-field="road-width-font"><option value="gothic">ゴシック</option><option value="mincho">明朝</option><option value="mono">等幅</option></select></label><label class="field-inline"><span>大きさ</span><input class="ctrl-input number-small" data-field="road-width-size" type="number" min="0.3" max="5" step="0.1"><em>倍</em></label>${colorSelectMarkup('road-width-color', '色', 'dimension')}`)
      }
    }
    $$('.measurement-only', dom.commandControls).forEach(element => { element.hidden = !isMeasurement })
    $$('.area-only', dom.commandControls).forEach(element => { element.hidden = kind !== 'area' })
    const notice = document.createElement('div')
    notice.className = 'batch-edit-notice'
    notice.innerHTML = `<strong>${objectDisplayName(object).replace(/\s+$/, '')}ほか ${objects.length}件</strong><span>変更した項目だけを全件へ反映します。番号・名称・価格・メモは変えません。</span>`
    dom.commandControls.append(notice)
  }

  function dimensionPartLabel(object, type, index) {
    const part = type === 'edge' ? object.edges?.[index] : object.segments?.[index]
    let suffix = ''
    const from = part?.from || object.points?.[index]
    const to = part?.to || object.points?.[(index + 1) % (object.points?.length || 1)]
    const mpp = Math.max(0, finite(store.document.calibration?.mpp))
    if (mpp > 0 && K.isPoint(from) && K.isPoint(to)) suffix = ` ${Number((K.distance(from, to) * mpp).toFixed(2))}m`
    if (part?.hidden === true) suffix += '（非表示）'
    return `${type === 'edge' ? '辺' : '区間'}${index + 1}${suffix}`
  }

  function makeDimensionTargetControl(object) {
    const edgeCount = object.kind === 'lot' ? Math.max(object.edges?.length || 0, object.points?.length || 0) : 0
    const segmentCount = edgeCount ? 0 : (object.segments?.length || 0)
    if (!(edgeCount || segmentCount)) return null
    const wrap = document.createElement('div')
    wrap.className = 'control-group dimension-target-control'
    const label = document.createElement('span')
    label.className = 'control-label'
    label.textContent = '編集対象'
    const select = document.createElement('select')
    select.className = 'ctrl-select dimension-target-select'
    select.dataset.dimensionTarget = ''
    const all = document.createElement('option')
    all.value = 'all'
    all.textContent = edgeCount ? '全辺共通' : '全体'
    select.append(all)
    const type = edgeCount ? 'edge' : 'segment'
    const count = edgeCount || segmentCount
    for (let index = 0; index < count; index += 1) {
      const option = document.createElement('option')
      option.value = `${type}:${index}`
      option.textContent = dimensionPartLabel(object, type, index)
      select.append(option)
    }
    select.value = Number.isInteger(ui.editEdgeIndex) ? `edge:${ui.editEdgeIndex}` : Number.isInteger(ui.editSegmentIndex) ? `segment:${ui.editSegmentIndex}` : 'all'
    const hint = document.createElement('span')
    hint.className = 'dimension-target-hint context-optional'
    hint.textContent = edgeCount ? '外周辺・寸法文字のクリックでも選択' : '区間寸法のクリックでも選択'
    wrap.append(label, select, hint)
    return wrap
  }

  function appendDimensionPartControls(object) {
    const isEdge = Number.isInteger(ui.editEdgeIndex)
    const isSegment = Number.isInteger(ui.editSegmentIndex)
    if (!(isEdge || isSegment)) return
    // Flattened single row (no nested sub-tabs): matches the "全辺共通" layout —
    // key controls inline, the rest tucked into dropdowns.
    const visibleField = isEdge ? 'edge-visible' : 'segment-visible'
    const textField = isEdge ? 'edge-custom-text' : 'segment-custom-text'
    const rotationField = isEdge ? 'edge-rotation-offset' : 'segment-rotation-offset'
    const visibleLabel = '表示'
    dom.commandControls.insertAdjacentHTML('beforeend', `<label class="check-control"><input data-field="${visibleField}" type="checkbox" checked>${visibleLabel}</label><label class="field-inline"><span>表示文字</span><input class="ctrl-input wide" data-field="${textField}" type="text" placeholder="空欄で自動寸法"></label><button class="ctrl-btn preset-button part-approx-button" type="button" data-action="apply-legacy-approx" data-approx-scope="part">約・切捨て</button><details class="toolbar-dropdown"><summary class="ctrl-btn">数値</summary><div class="toolbar-dropdown-panel"><label class="check-control"><input data-field="part-approximate" type="checkbox">約を付ける</label><label class="field-inline"><span>桁</span><select class="ctrl-select compact-select" data-field="part-decimals"><option value="0">整数</option><option value="1">1桁</option><option value="2">2桁</option></select></label><label class="field-inline"><span>丸め</span><select class="ctrl-select compact-select" data-field="part-rounding"><option value="round">四捨五入</option><option value="floor">切捨て</option><option value="ceil">切上げ</option></select></label><label class="field-inline"><span>寸法値</span><input class="ctrl-input number-small" data-field="part-adjustment" type="number" step="0.01"><em>m</em></label></div></details><details class="toolbar-dropdown"><summary class="ctrl-btn">書式</summary><div class="toolbar-dropdown-panel"><label class="field-inline"><span>書体</span><select class="ctrl-select compact-select" data-field="part-font"><option value="gothic">ゴシック</option><option value="mincho">明朝</option><option value="mono">等幅</option></select></label><label class="field-inline"><span>大きさ</span><input class="ctrl-input number-small" data-field="part-size" type="number" min="0.2" max="5" step="0.1"><em>倍</em></label><label class="field-inline"><span>角度</span><input class="ctrl-input number-small" data-field="${rotationField}" type="number" step="1"><em>°</em></label>${colorSelectMarkup('part-color', '色', 'dimension')}</div></details><button class="ctrl-btn" type="button" data-action="reset-dimension-part-position" title="番号・面積・坪・寸法などの文字は図面上でドラッグして移動できます">自動位置へ戻す</button>`)
  }

  function selectDimensionTarget(value) {
    const id = ui.selectedIds.length === 1 ? ui.selectedIds[0] : null
    if (!id) return
    commitPendingEdit()
    const match = String(value || '').match(/^(edge|segment):(\d+)$/)
    ui.editEdgeIndex = match?.[1] === 'edge' ? Number(match[2]) : null
    ui.editSegmentIndex = match?.[1] === 'segment' ? Number(match[2]) : null
    ui.contextPage = 'object-dimension'
    ui.segmentPanel = 'text'
    selectObject(id, { openEditor: true, preserveSubselection: true })
    if (Number.isInteger(ui.editEdgeIndex)) runtime.edgeHover = { id, index: ui.editEdgeIndex }
    render()
    setStatus(match ? `${match[1] === 'edge' ? '辺' : '区間'} ${Number(match[2]) + 1} の寸法を編集中です` : '全体の寸法設定を編集中です', 1600)
  }

  function showObjectEditor() {
    if (ui.selectedIds.length > 1) { showBatchEditor(); return }
    const object = ui.editDraft || currentObject()
    if (!object) return
    dom.controlBar?.classList.add('object-editing')
    const commandLabel = $('span', dom.commandName)
    if (commandLabel) commandLabel.textContent = '編集'
    const shell = cloneTemplate('controls-object-edit')
    const actionGroup = $('.action-strip', shell)
    const pageGroup = $('.context-pages', shell)
    const vertexButton = $('[data-action="edit-vertices"]', shell)
    const deleteButton = $('[data-action="delete-selected"]', shell)
    dom.commandActions.replaceChildren(...(actionGroup ? [...actionGroup.children] : []))
    if (deleteButton) dom.commandActions.append(deleteButton)
    dom.commandPages.replaceChildren(...(pageGroup ? [...pageGroup.children] : []))
    dom.commandPages.hidden = false
    const isShape = ['lot', 'road', 'water', 'cutout'].includes(object.kind)
    const isLot = object.kind === 'lot'
    const isRoadLike = object.kind === 'road' || object.kind === 'water'
    const hasShapeDimensions = isShape && !isRoadLike
    const isMeasurement = ['distance', 'polyline', 'area', 'dimension'].includes(object.kind)
    const hasLineStyle = LINE_STYLE_KINDS.has(object.kind)
    const hasEditableText = !['line', 'guide', 'parallel', 'lot-table'].includes(object.kind)
    const isSpecial = ['road', 'water', 'house', 'parking', 'north', 'lot-table'].includes(object.kind) || hasLineStyle
    const hasSegmentSelection = Number.isInteger(ui.editEdgeIndex) || Number.isInteger(ui.editSegmentIndex)
    const allowedPages = new Set(['object-basic', 'object-record'])
    if (hasEditableText) allowedPages.add('object-decoration')
    if (isShape) allowedPages.add('object-visibility')
    if (isLot) allowedPages.add('object-values')
    if (hasShapeDimensions || isMeasurement) { allowedPages.add('object-dimension'); allowedPages.add('object-dimension-value') }
    if (isSpecial) allowedPages.add('object-special')
    if (!allowedPages.has(ui.contextPage)) ui.contextPage = 'object-basic'
    const templateId = `controls-${ui.contextPage}`
    dom.commandControls.replaceChildren(cloneTemplate(templateId))
    if (ui.contextPage === 'object-basic' && isShape && vertexButton) dom.commandControls.prepend(vertexButton)
    if (ui.contextPage === 'object-basic' && hasEditableText && !isShape) {
      const labelField = $('[data-field="object-label"]', dom.commandControls)
      const labelControl = labelField?.closest('label')
      if (labelControl) {
        const caption = $('span', labelControl)
        if (caption) caption.textContent = '文字'
        dom.commandControls.prepend(labelControl)
      }
    }
    if (ui.contextPage === 'object-special') {
      if (object.kind === 'house' || object.kind === 'parking') {
        const hatchControl = object.kind === 'house' ? '<label class="check-control"><input data-field="stamp-hatch" type="checkbox">斜線</label>' : ''
        dom.commandControls.insertAdjacentHTML('beforeend', `<label class="field-inline"><span>種類</span><select class="ctrl-select compact-select" data-field="stamp-kind"><option value="house">家屋</option><option value="parking">駐車場</option></select></label><label class="field-inline"><span>文字</span><input class="ctrl-input" data-field="object-label" type="text"></label><label class="field-inline"><span>幅</span><input class="ctrl-input number-small" data-field="stamp-width" type="number" min="0.1" step="0.1"><em>m</em></label><label class="field-inline"><span>奥行</span><input class="ctrl-input number-small" data-field="stamp-depth" type="number" min="0.1" step="0.1"><em>m</em></label><label class="field-inline"><span>全体倍率</span><input class="ctrl-input number-small" data-field="stamp-scale" type="number" min="0.2" max="5" step="0.1"><em>倍</em></label><label class="field-inline"><span>文字倍率</span><input class="ctrl-input number-small" data-field="stamp-text-scale" type="number" min="0.3" max="5" step="0.1"><em>倍</em></label><details class="toolbar-dropdown"><summary class="ctrl-btn">配置詳細</summary><div class="toolbar-dropdown-panel"><label class="field-inline"><span>角度</span><input class="ctrl-input number-small" data-field="stamp-angle" type="number" step="1"><em>°</em></label><label class="check-control"><input data-field="stamp-dimensions" type="checkbox">寸法</label></div></details><details class="toolbar-dropdown"><summary class="ctrl-btn">表示</summary><div class="toolbar-dropdown-panel">${colorSelectMarkup('textColor', '文字色', 'ink')}${colorSelectMarkup('stamp-stroke', '枠線', 'border')}${colorSelectMarkup('stamp-fill', '塗り', 'fill')}${hatchControl}<label class="field-inline"><span>線種</span><select class="ctrl-select compact-select" data-field="stamp-line-style"><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option></select></label></div></details>`)
      } else if (object.kind === 'north') {
        dom.commandControls.insertAdjacentHTML('beforeend', `<label class="field-inline"><span>文字</span><input class="ctrl-input" data-field="object-label" type="text"></label><label class="field-inline"><span>全体倍率</span><input class="ctrl-input number-small" data-field="stamp-scale" type="number" min="0.2" max="5" step="0.1"><em>倍</em></label><label class="field-inline"><span>文字倍率</span><input class="ctrl-input number-small" data-field="stamp-text-scale" type="number" min="0.3" max="5" step="0.1"><em>倍</em></label><label class="field-inline"><span>角度</span><input class="ctrl-input number-small" data-field="stamp-angle" type="number" step="1"><em>°</em></label>${colorSelectMarkup('textColor', '色', 'ink')}`)
      } else if (object.kind === 'lot-table') {
        dom.commandControls.insertAdjacentHTML('beforeend', '<label class="field-inline"><span>倍率</span><input class="ctrl-input number-small" data-field="table-scale" type="number" min="0.3" max="5" step="0.1"><em>倍</em></label><label class="field-inline"><span>角度</span><input class="ctrl-input number-small" data-field="table-angle" type="number" step="1"><em>°</em></label><label class="field-inline"><span>更新</span><select class="ctrl-select" data-field="table-mode"><option value="dynamic">区画変更に追従</option><option value="snapshot">現在値で固定</option></select></label>')
      } else if (hasLineStyle) {
        dom.commandControls.insertAdjacentHTML('beforeend', `<label class="field-inline"><span>線種</span><select class="ctrl-select compact-select" data-field="object-line-style"><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option></select></label><label class="field-inline"><span>太さ</span><input class="ctrl-input number-small" data-field="object-line-width" type="number" min="0.5" max="10" step="0.5"></label>${colorSelectMarkup('object-line-color', '色', 'line')}`)
      } else if (isRoadLike) {
        const widthPanel = ['primary', 'angle', 'style'].includes(ui.specialPanel) ? ui.specialPanel : 'primary'
        dom.commandControls.insertAdjacentHTML('beforeend', `<div class="control-group nested-tabs"><button class="ctrl-tab ${widthPanel === 'primary' ? 'active' : ''}" type="button" data-special-panel="primary">内容</button><button class="ctrl-tab ${widthPanel === 'angle' ? 'active' : ''}" type="button" data-special-panel="angle">角度</button><button class="ctrl-tab ${widthPanel === 'style' ? 'active' : ''}" type="button" data-special-panel="style">書式</button></div>`)
        if (widthPanel === 'primary') dom.commandControls.insertAdjacentHTML('beforeend', '<label class="field-inline"><span>種類</span><select class="ctrl-select" data-field="road-category"><option>道路</option><option>公道</option><option>私道</option><option>位置指定道路</option><option>認定外道路</option><option>水路</option></select></label><label class="check-control"><input data-field="road-width-visible" type="checkbox">幅員を表示</label><label class="field-inline"><span>幅員</span><input class="ctrl-input number-small" data-field="road-width" type="number" min="0" step="0.1"><em>m</em></label><label class="field-inline"><span>表記</span><input class="ctrl-input wide" data-field="road-width-text" type="text" placeholder="自動: 幅員 4.0m"></label>')
        else if (widthPanel === 'angle') dom.commandControls.insertAdjacentHTML('beforeend', '<label class="field-inline"><span>角度</span><input class="ctrl-input number-small" data-field="road-width-angle" type="number" step="1"><em>°</em></label>')
        else dom.commandControls.insertAdjacentHTML('beforeend', `<label class="field-inline"><span>書体</span><select class="ctrl-select compact-select" data-field="road-width-font"><option value="gothic">ゴシック</option><option value="mincho">明朝</option><option value="mono">等幅</option></select></label><label class="field-inline"><span>大きさ</span><input class="ctrl-input number-small" data-field="road-width-size" type="number" min="0.3" max="5" step="0.1"><em>倍</em></label>${colorSelectMarkup('road-width-color', '色', 'dimension')}`)
      }
    }
    if (ui.contextPage === 'object-dimension') {
      if (hasSegmentSelection) dom.commandControls.replaceChildren()
      const targetControl = makeDimensionTargetControl(object)
      if (targetControl) dom.commandControls.prepend(targetControl)
      if (hasSegmentSelection) appendDimensionPartControls(object)
    }
    if (ui.contextPage === 'object-values' && isLot) {
      const panel = ui.valueLabelPanel === 'tsubo' ? 'tsubo' : 'area'
      const prefix = panel === 'tsubo' ? 'tsubo-label' : 'area-label'
      dom.commandControls.insertAdjacentHTML('beforeend', `<div class="control-group value-toggle" aria-label="面積と坪の切替"><button class="ctrl-tab ${panel === 'area' ? 'active' : ''}" type="button" data-value-label-panel="area">㎡ 面積</button><span class="value-switch-arrow" aria-hidden="true">⇔</span><button class="ctrl-tab ${panel === 'tsubo' ? 'active' : ''}" type="button" data-value-label-panel="tsubo">坪表示</button></div><label class="check-control"><input data-field="${prefix}-visible" type="checkbox">表示</label><label class="field-inline value-text-field"><span>表示文字</span><input class="ctrl-input wide" data-field="${prefix}-text" type="text" placeholder="空欄で自動計算">${panel === 'area' ? '<em class="field-warning" data-area-manual-warning hidden>手入力値・坪も更新</em>' : ''}</label><label class="field-inline"><span>大きさ</span><input class="ctrl-input number-small" data-field="${prefix}-size" type="number" min="0.3" max="5" step="0.1"><em>倍</em></label><button class="ctrl-btn" type="button" data-action="reset-value-label-position">${panel === 'tsubo' ? '坪' : '㎡'}を元の位置へ戻す</button>`)
    }
    $$('.shape-page, .text-page', dom.commandPages).forEach(button => { button.hidden = true })
    $$('.lot-value-page', dom.commandPages).forEach(button => { button.hidden = !isLot })
    $$('.dimension-page', dom.commandPages).forEach(button => { button.hidden = !(hasShapeDimensions || isMeasurement) })
    $$('.special-page', dom.commandPages).forEach(button => {
      button.hidden = !isSpecial
      if (!button.hidden) button.textContent = object.kind === 'road' || object.kind === 'water' ? '幅員' : object.kind === 'lot-table' ? '表' : hasLineStyle ? '線' : '配置'
    })
    $$('[data-context-page]', dom.commandPages).forEach(button => button.classList.toggle('active', button.dataset.contextPage === ui.contextPage))
    $$('.lot-only', dom.commandControls).forEach(element => { element.hidden = object.kind !== 'lot' })
    $$('.shape-appearance-only', dom.commandControls).forEach(element => { element.hidden = !isShape })
    $$('.editable-text-only', dom.commandControls).forEach(element => { element.hidden = !hasEditableText })
    $$('.measurement-only', dom.commandControls).forEach(element => { element.hidden = !isMeasurement })
    $$('.area-only', dom.commandControls).forEach(element => { element.hidden = object.kind !== 'area' })
    if (isMeasurement) $$('[data-action="center-label"]', dom.commandControls).forEach(button => { button.textContent = '寸法を自動位置へ戻す' })
    if (!isShape) {
      $$('[data-field="object-type"],[data-field="lot-number"],[data-field="lot-price"],[data-field="fill-opacity"],[data-field="show-number"],[data-field="show-label"],[data-field="show-area"],[data-field="show-tsubo"],[data-field="show-price"],[data-field="show-memo"],[data-field="show-top-label"]', dom.commandControls).forEach(field => {
        const container = field.closest('label') || field
        container.hidden = true
      })
    }
  }

  function renderCommandSurface() {
    dom.controlBar?.classList.remove('object-editing', 'batch-editing')
    if (ui.workspace !== 'drawing') {
      renderWorkspaceCommandSurface()
      return
    }
    dom.commandName.disabled = false
    const categoryInfo = CATEGORY[ui.category] || CATEGORY.select
    const meta = COMMAND[session.command] || { category: ui.category, name: categoryInfo.name, icon: categoryInfo.icon, hint: 'コマンドを選択' }
    const icon = $('use', dom.commandName)
    if (icon) icon.setAttribute('href', `#${meta.icon || categoryInfo.icon}`)
    const label = $('span', dom.commandName)
    if (label) label.textContent = ui.launcher ? categoryInfo.name : meta.name
    const step = commandStepText()
    dom.commandStep.innerHTML = `<small>${step.small}</small><strong>${step.strong}</strong>`
    dom.commandActions.replaceChildren()
    const actionHint = document.createElement('span')
    actionHint.className = 'control-label context-optional'
    actionHint.textContent = ui.launcher ? `${categoryInfo.name}のコマンドを選択` : meta.hint
    dom.commandActions.append(actionHint)
    dom.commandPages.hidden = true
    dom.commandPages.replaceChildren()
    dom.commandControls.replaceChildren()

    if (ui.launcher) {
      const launcher = byId(`launcher-${ui.category}`)
      if (launcher) dom.commandControls.append(launcher.content.cloneNode(true))
      syncControlState()
      syncRail()
      return
    }

    if (ui.selectedIds.length && ['select', 'label-edit'].includes(session.command)) showObjectEditor()
    else if (meta.template) {
      dom.commandControls.append(cloneTemplate(meta.template))
      addDynamicCommandControls(session.command)
    } else makeInstructionControls(meta)

    $$('[data-for-command]', dom.commandControls).forEach(element => {
      const required = String(element.dataset.forCommand || '').split(',').map(value => value.trim()).filter(Boolean).map(value => UI_COMMAND_ALIASES[value] || value)
      element.hidden = !required.includes(session.command)
    })
    initializeFieldControls()
    syncControlState()
    syncRail()
    syncWorkspaceLabels()
  }

  function initializeFieldControls() {
    $$('[data-field]', dom.commandControls).forEach(field => {
      const key = field.dataset.field
      if (!(key in session.form)) return
      if (field.type === 'checkbox') field.checked = Boolean(session.form[key])
      else {
        const value = session.form[key] ?? ''
        if (field.matches('select[data-color-select]') && value && ![...field.options].some(option => option.value === String(value))) {
          const option = document.createElement('option')
          option.value = String(value)
          option.textContent = `現在の色 ${value}`
          field.prepend(option)
        }
        field.value = value
      }
    })
    enhanceColorSelects()
    syncColorSelects()
  }

  function enhanceColorSelects() {
    $$('select[data-color-select]', dom.commandControls).forEach(select => {
      if (select.classList.contains('enhanced-source')) return
      select.classList.add('enhanced-source')
      const picker = document.createElement('span')
      picker.className = 'color-picker'
      picker.dataset.colorField = select.dataset.field
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'color-picker-toggle'
      toggle.dataset.colorPickerToggle = ''
      toggle.innerHTML = '<span class="color-picker-swatch" aria-hidden="true"></span><span class="color-picker-caret" aria-hidden="true">▾</span>'
      const panel = document.createElement('span')
      panel.className = 'color-picker-panel'
      panel.hidden = true
      for (const option of [...select.options]) {
        const choice = document.createElement('button')
        choice.type = 'button'
        choice.className = 'color-picker-choice'
        choice.dataset.colorChoice = option.value
        choice.style.setProperty('--choice-color', option.value)
        choice.title = option.textContent || option.value
        choice.setAttribute('aria-label', option.textContent || option.value)
        panel.append(choice)
      }
      picker.append(toggle, panel)
      select.insertAdjacentElement('afterend', picker)
    })
  }

  function syncColorSelects() {
    $$('select[data-color-select]', dom.commandControls).forEach(select => {
      const value = session.form[select.dataset.field]
      if (value && ![...select.options].some(option => option.value === String(value))) {
        const option = document.createElement('option')
        option.value = String(value)
        option.textContent = `現在の色 ${value}`
        select.prepend(option)
      }
      if (value && select.value !== String(value)) select.value = String(value)
      select.style.setProperty('--selected-color', select.value || '#ffffff')
      select.title = select.selectedOptions?.[0]?.textContent || '色を選択'
      const picker = select.nextElementSibling?.classList?.contains('color-picker') ? select.nextElementSibling : null
      const toggle = picker?.querySelector('[data-color-picker-toggle]')
      if (toggle) {
        toggle.style.setProperty('--selected-color', select.value || '#ffffff')
        toggle.title = `選択中：${select.selectedOptions?.[0]?.textContent || select.value}`
        toggle.setAttribute('aria-label', toggle.title)
      }
      picker?.querySelectorAll('[data-color-choice]').forEach(choice => {
        choice.classList.toggle('active', choice.dataset.colorChoice === select.value)
      })
    })
  }

  function syncRail() {
    $$('[data-category]', byId('category-rail')).forEach(button => button.classList.toggle('active', button.dataset.category === ui.category))
    $$('[data-action="undo"]').forEach(button => { button.disabled = !store.canUndo })
    $$('[data-action="redo"]').forEach(button => { button.disabled = !store.canRedo })
  }

  function canFinishCommand() {
    const command = session.command
    const count = session.points.length
    if (['lot-draw', 'road-draw', 'area'].includes(command)) return count >= 3
    if (command === 'callout') return count === 2
    if (['distance', 'polyline', 'line', 'arrow'].includes(command)) return count >= 2
    if (command === 'calibrate') return count === 2 && parseNumeric(session.form['calibration-distance']) > 0
    if (command === 'underlay-transform') return true
    if (command === 'split') return session.targetIds.length === 1 && count >= 2
    if (command === 'split-all') return count >= 2
    if (command === 'merge') return session.targetIds.length === 2
    if (command === 'corner-cut') return Boolean(store.document.calibration.mpp) && session.targetIds.length === 1 && Number.isInteger(session.vertexIndex)
    if (command === 'division-guide') return count === 2
    if (command === 'lot-division-guide') return session.targetIds.length === 1 && count === 2
    if (command === 'parallel-guide') return Boolean(store.document.calibration.mpp) && count === 2
    if (['text', 'north', 'house', 'parking', 'lot-table'].includes(command)) return Boolean(runtime.pointerWorld)
    return false
  }

  function legacyApproxIsActive(scope = 'global') {
    const part = scope === 'part'
    const approximate = part
      ? Boolean(session.form['part-approximate'])
      : ('dimension-approximate' in session.form
          ? Boolean(session.form['dimension-approximate'])
          : Boolean(session.form.approximate))
    return approximate &&
      Math.round(finite(session.form[part ? 'part-decimals' : 'dimension-decimals'], 2)) === 1 &&
      session.form[part ? 'part-rounding' : 'dimension-rounding'] === 'floor' &&
      Math.abs(finite(session.form[part ? 'part-adjustment' : 'dimension-adjustment']) + 0.1) < 0.000001
  }

  function syncControlState() {
    const count = session.points.length
    const setOutput = (name, value) => $$(`[data-output="${name}"]`, dom.commandControls).forEach(output => { output.textContent = String(value) })
    setOutput('draft-count', count)
    setOutput('measure-step', count === 0 ? '1点目' : count === 1 ? '2点目' : '確定できます')
    setOutput('process-step', processStatusText())
    setOutput('move-all-step', count === 0 ? '1/2 基準点' : '2/2 移動先')
    const nextParallel = Math.max(1, Math.round(finite(session.form.parallelCount, 0)) + 1) * Math.abs(finite(session.form['parallel-distance'], 3))
    setOutput('parallel-next', `次 ${Number(nextParallel.toFixed(3))}m`)
    const background = store.document.background
    setOutput('underlay-opacity', `${Math.round(finite(background.opacity, 1) * 100)}%`)
    const pageCount = Math.max(1, background.pages?.length || runtime.backgroundRuntime?.pageCount || 1)
    setOutput('page', `${Math.min(background.currentPage || 1, pageCount)} / ${pageCount}`)
    $$('[data-action="pop-point"]', dom.commandControls).forEach(button => { button.disabled = count === 0 })
    $$('[data-action="finish-command"]', dom.commandControls).forEach(button => {
      const canFinish = canFinishCommand()
      button.disabled = !canFinish
      if (['lot-division-guide', 'parallel-guide'].includes(session.command)) button.textContent = '作成'
      button.hidden = !canFinish || session.command === 'edge-hide' || AUTO_COMPLETE_COMMANDS.has(session.command)
    })
    $$('[data-action="pop-point"]', dom.commandControls).forEach(button => {
      button.hidden = count === 0 || ['edge-hide', 'merge', 'corner-cut'].includes(session.command) || AUTO_COMPLETE_COMMANDS.has(session.command)
    })
    $$('[data-action="flip-parallel"]', dom.commandControls).forEach(button => {
      button.textContent = '反転'
      button.title = '基準線の反対側へ作成方向を切り替えます'
      button.hidden = session.command !== 'parallel-guide' || count < 2
    })
    $$('[data-action="reset-parallel-baseline"]', dom.commandControls).forEach(button => {
      button.hidden = session.command !== 'parallel-guide' || count < 2
    })
    const hasPendingOperation = count > 0 || session.targetIds.length > 0 || session.vertexIndex != null
    $$('[data-action="cancel-command"]', dom.commandControls).forEach(button => { button.textContent = hasPendingOperation ? '作図取消' : '選択へ戻る' })
    $$('[data-action="apply-legacy-approx"]', dom.commandControls).forEach(button => {
      const active = legacyApproxIsActive(button.dataset.approxScope === 'part' ? 'part' : 'global')
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
      button.textContent = active ? '約・切捨て ON' : '約・切捨て'
    })
    $$('[data-action="apply-calibration"]', dom.commandControls).forEach(button => { button.disabled = !(count === 2 && parseNumeric(session.form['calibration-distance']) > 0) })
    $$('[data-action="reset-calibration-points"]', dom.commandControls).forEach(button => { button.hidden = count < 2 })
    const currentScale = Number(store.document.calibration?.mapScale) > 0
      ? Number(store.document.calibration.mapScale)
      : mapScaleFromMpp(store.document.calibration?.mpp)
    $$('[data-output="page-scale-state"]', dom.commandControls).forEach(output => {
      const ready = hasScale()
      output.textContent = ready
        ? (Number.isFinite(currentScale) && currentScale > 0 ? `設定済 1:${Math.round(currentScale).toLocaleString('ja-JP')}` : '設定済 2点校正')
        : '未設定'
      output.dataset.state = ready ? 'ready' : 'missing'
    })
    $$('[data-action="apply-manual-scale"]', dom.commandControls).forEach(button => {
      button.disabled = !(parseNumeric(session.form['manual-scale']) > 0) || worldUnitsPerMeter() == null
    })
    const lock = $('[data-action="toggle-underlay-lock"]', dom.commandControls)
    if (lock) lock.classList.toggle('active', Boolean(background.locked))
    const rotateImage = $('[data-action="rotate-underlay-90"]', dom.commandControls)
    if (rotateImage) rotateImage.hidden = background.type !== 'image'
    const hasUnderlay = background.type === 'pdf' || background.type === 'image'
    $$('[data-action="replace-underlay"], [data-command="underlay-replace"]').forEach(button => { button.hidden = !hasUnderlay })
    $$('[data-action="toggle-underlay"], [data-action="remove-underlay"], [data-command="underlay-adjust"]').forEach(button => { button.hidden = !hasUnderlay })
    $$('[data-action="toggle-underlay"]').forEach(button => {
      const visible = background.visible !== false
      button.textContent = visible ? '下絵を隠す' : '下絵を表示'
      button.setAttribute('aria-pressed', String(visible))
      button.title = visible ? '下絵だけを一時的に隠します' : '下絵を再表示します'
    })
    $$('[data-command="underlay-page"]').forEach(button => { button.hidden = !hasUnderlay || pageCount <= 1 })
    const opacityControls = $('.underlay-opacity-controls', dom.commandControls)
    if (opacityControls) opacityControls.hidden = !hasUnderlay
    const pageControls = $('.underlay-page-controls', dom.commandControls)
    if (pageControls) pageControls.hidden = !hasUnderlay
    $$('[data-action="previous-page"]', dom.commandControls).forEach(button => { button.disabled = !hasUnderlay || background.currentPage <= 1 })
    $$('[data-action="next-page"]', dom.commandControls).forEach(button => { button.disabled = !hasUnderlay || background.currentPage >= pageCount })
    const activePage = page(store.document)
    const activeObjectCount = (activePage?.shapes?.length || 0) + (activePage?.entities?.length || 0)
    const guideCount = activePage?.entities?.filter(entity => entity.kind === 'guide' || entity.kind === 'parallel').length || 0
    const documentObjectCount = (store.document.pages || []).reduce((sum, currentPage) => sum + (currentPage.shapes?.length || 0) + (currentPage.entities?.length || 0), 0)
    const setActionAvailability = (selector, enabled, enabledTitle, disabledTitle) => {
      $$(selector).forEach(button => {
        button.disabled = !enabled
        button.title = enabled ? enabledTitle : disabledTitle
      })
    }
    setActionAvailability('[data-action="clear-document"]', activeObjectCount > 0, '現在のページの図形をすべて消去します', '消去する図形がありません')
    setActionAvailability('[data-action="clear-guides"]', guideCount > 0, `${guideCount}本の補助線を消去します`, '消去する補助線がありません')
    setActionAvailability('[data-action="paste"]', ui.clipboard.length > 0, `${ui.clipboard.length}件を貼り付けます`, '先に図形をコピーしてください')
    setActionAvailability('[data-action="apply-typography-existing"]', documentObjectCount > 0, '現在の図面に文字サイズを一括反映します', '反映する図形がありません')
    const preferencesAreStandard = JSON.stringify(store.document.preferences) === JSON.stringify(STANDARD_PREFERENCES)
    setActionAvailability('[data-action="reset-command-defaults"]', !preferencesAreStandard, '作図の既定値を標準へ戻します', '作図の既定値は既に標準です')
    const opacity = K.clamp(finite(background.opacity, 1), 0.08, 1)
    setActionAvailability('[data-action="underlay-opacity-down"]', hasUnderlay && opacity > 0.080001, '下絵を薄くします', '下絵は最も薄い状態です')
    setActionAvailability('[data-action="underlay-opacity-up"]', hasUnderlay && opacity < 0.999999, '下絵を濃くします', '下絵は最も濃い状態です')
    const underlayTransformIsDefault = Math.abs(finite(session.form['underlay-scale'], 100) - 100) < 0.000001 &&
      Math.abs(finite(session.form['underlay-x'])) < 0.000001 && Math.abs(finite(session.form['underlay-y'])) < 0.000001 &&
      Math.abs(finite(session.form['underlay-angle'])) < 0.000001
    setActionAvailability('[data-action="reset-underlay-transform"]', hasUnderlay && !underlayTransformIsDefault, '下絵の位置・倍率・角度を初期値へ戻します', '下絵の位置・倍率・角度は初期値です')
    let drawingAlreadyCentered = false
    if (ui.workspace === 'output' && activeObjectCount > 0) {
      const bounds = K.documentBounds({ ...store.document, background: { ...store.document.background, visible: false }, paper: { ...store.document.paper, enabled: false } })
      if (bounds) {
        const paperSize = paperPixelSize()
        const printZoom = outputPixelsPerWorldUnit(store.document, 96)
        const dx = paperSize.width / printZoom / 2 - (bounds.minX + bounds.maxX) / 2
        const dy = paperSize.height / printZoom / 2 - (bounds.minY + bounds.maxY) / 2
        drawingAlreadyCentered = Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5
      }
    }
    setActionAvailability('[data-action="center-drawing-on-paper"]', activeObjectCount > 0 && !drawingAlreadyCentered, '図形全体を用紙中央へ移動します', activeObjectCount ? '図形は既に用紙中央です' : '中央へ移動する図形がありません')
    const editDrafts = ui.batchDrafts.length ? ui.batchDrafts : (ui.editDraft ? [ui.editDraft] : [])
    const labelsCanBeCentered = editDrafts.length > 0 && editDrafts.every(draft => CENTERABLE_LABEL_KINDS.has(draft.kind))
    const labelsAreOffset = editDrafts.some(draft => Boolean(
      draft.labelPosition || draft.road?.namePosition || draft.road?.widthLabelPosition ||
      Number.isFinite(draft.labelStyle?.x) || Number.isFinite(draft.labelStyle?.y)
    ))
    $$('[data-action="center-label"]', dom.commandControls).forEach(button => {
      button.hidden = !labelsCanBeCentered
      button.disabled = !labelsAreOffset
      button.title = (labelsAreOffset ? '文字位置を自動配置へ戻します。' : '文字位置は既に自動配置です。') + '番号・面積・坪・寸法などの文字は図面上でドラッグして移動できます'
    })
    const valueLabelProperty = ui.valueLabelPanel === 'tsubo' ? 'tsuboLabel' : 'areaLabel'
    const legacyValueLabelProperty = valueLabelProperty === 'tsuboLabel' ? 'tsuboLabelPosition' : 'areaLabelPosition'
    const valueLabelIsOffset = Boolean(ui.editDraft?.[valueLabelProperty]?.position || ui.editDraft?.[legacyValueLabelProperty])
    setActionAvailability('[data-action="reset-value-label-position"]', valueLabelIsOffset, '表示位置を自動配置へ戻します', '表示位置は既に自動配置です')
    if (session.command === 'typography-settings') {
      const values = typographyValuesFromForm()
      $$('[data-typography-preset]', dom.commandControls).forEach(button => {
        const preset = TYPOGRAPHY_PRESETS[button.dataset.typographyPreset]
        const matches = preset && Object.keys(preset).every(key => Math.abs(values[key] - preset[key]) < 0.001)
        button.classList.toggle('primary', Boolean(matches))
      })
    }
    $$('[data-action="paste"]', dom.commandActions).forEach(button => { button.disabled = ui.clipboard.length === 0 })
    const areaWarning = $('[data-area-manual-warning]', dom.commandControls)
    if (areaWarning) {
      const manualArea = String(session.form['area-label-text'] ?? '').trim()
      const numericArea = numericTextValue(manualArea)
      areaWarning.hidden = !manualArea
      areaWarning.textContent = numericArea != null && numericArea >= 0 ? '手入力値・坪も更新' : '数値を確認してください'
      areaWarning.classList.toggle('error', Boolean(manualArea) && !(numericArea != null && numericArea >= 0))
    }
    syncColorSelects()
    const step = commandStepText()
    dom.commandStep.innerHTML = `<small>${step.small}</small><strong>${step.strong}</strong>`
  }

  function processStatusText() {
    const command = session.command
    if (command === 'merge') return session.targetIds.length ? `区画 ${session.targetIds.length}/2` : '1つ目の区画'
    if (command === 'corner-cut') return !store.document.calibration.mpp ? '先に縮尺を設定' : !session.targetIds.length ? '区画を選択' : session.vertexIndex == null ? '頂点を選択' : '確定できます'
    if (command === 'split') return !session.targetIds.length ? '区画を選択' : session.points.length < 2 ? `分割線 ${session.points.length}/2` : `折れ線 ${session.points.length}点・Enterで確定`
    if (command === 'split-all') return session.points.length < 2 ? `分割線 ${session.points.length}/2` : `折れ線 ${session.points.length}点・Enterで確定`
    if (command === 'division-guide') return session.points.length ? '終点を指定すると作成' : '始点を指定'
    if (command === 'lot-division-guide') return !session.targetIds.length ? '区画を選択' : session.points.length < 2 ? `基準方向 ${session.points.length}/2` : 'Enterまたは「作成」で確定'
    if (command === 'edge-hide') return '寸法を切り替える辺を選択'
    if (command === 'parallel-guide' && !store.document.calibration.mpp) return '先に縮尺を設定'
    if (command === 'parallel-guide') {
      return session.points.length < 2
        ? `基準線 ${session.points.length}/2`
        : `${Number((Math.max(1, Math.round(finite(session.form.parallelCount, 0)) + 1) * Math.abs(finite(session.form['parallel-distance'], 3))).toFixed(3))}mを作成できます`
    }
    return session.points.length < 2 ? `線の点 ${session.points.length}/2` : '確定できます'
  }

  function objectDisplayName(object) {
    if (!object) return '未選択'
    if (object.kind === 'lot') return `区画 ${object.number ?? ''}${object.label ? ` ${object.label}` : ''}`
    const names = { road: '道路', water: '水路', distance: '距離', polyline: '折れ線', area: '面積', line: '線', arrow: '矢印', text: '文字', callout: '引出線', north: '北マーク', house: '家屋', parking: '駐車', 'lot-table': '面積表', guide: 'ガイド', parallel: '平行線', cutout: '隅切り' }
    return `${names[object.kind] || object.kind}${object.label || object.text ? ` ${object.label || object.text}` : ''}`
  }

  function updateStatus() {
    const documentModel = store.document
    const active = page(documentModel)
    const meta = COMMAND[session.command]
    const workspaceHint = ui.workspace === 'registry'
      ? '作成した要素を一覧で確認、編集します'
      : ui.workspace === 'output'
        ? '用紙と書き出し方法を設定します'
        : ''
    const scaleMissing = !hasScale(documentModel)
    const scaleGuidance = scaleMissing
      ? (documentModel.background?.type
          ? 'このページは縮尺未設定です。上部の縮尺候補または2点校正で設定してください'
          : '① 下絵を開いて縮尺を合わせる　② 区画を作図')
      : ''
    dom.statusMessage.textContent = ui.statusOverride || workspaceHint || scaleGuidance || meta?.hint || '準備完了'
    dom.statusMessage.classList.toggle('notice-warning', scaleMissing && !ui.statusOverride && ui.workspace === 'drawing')
    const pointer = runtime.pointerWorld || { x: 0, y: 0 }
    dom.statusCoord.textContent = `X ${pointer.x.toFixed(1)}　Y ${pointer.y.toFixed(1)}`
    const scaleDenominator = Number(documentModel.calibration?.mapScale) > 0
      ? Number(documentModel.calibration.mapScale)
      : mapScaleFromMpp(documentModel.calibration?.mpp, documentModel)
    dom.statusScale.textContent = scaleMissing
      ? '縮尺 未設定'
      : (scaleDenominator ? `縮尺 1:${Math.round(scaleDenominator).toLocaleString('ja-JP')}` : '縮尺 2点校正済')
    dom.statusScale.dataset.state = scaleMissing ? 'missing' : 'ready'
    dom.statusZoom.textContent = `${Math.round(runtime.view.zoom * 100)}%`
    const snap = documentModel.preferences.snap || {}
    dom.statusSnap.textContent = `自動吸着 ${snap.vertex || snap.intersection || snap.edge || snap.grid ? 'ON' : 'OFF'}`
    const lotCount = active?.shapes.filter(shape => shape.kind === 'lot').length || 0
    dom.statusCount.textContent = `区画 ${lotCount}`
    dom.dirty.hidden = !store.dirty
    dom.documentName.textContent = ui.documentName || documentModel.title || '無題'
    if (ui.workspace === 'drawing') syncRail()
    else $$('[data-category]', byId('category-rail')).forEach(button => button.classList.remove('active'))
  }

  function draftStyle() {
    return {
      color: session.form.color || '#1677d2',
      stroke: session.form.stroke || session.form.color || '#1677d2',
      fill: session.form.fill || 'rgba(22,119,210,.12)',
      opacity: K.clamp(finite(session.form['fill-opacity'], 50) / 100, 0, 1),
      lineWidth: finite(session.form['line-width'], 1.4),
      lineStyle: session.form['line-style'] || 'solid'
    }
  }

  function placementPreview() {
    const position = runtime.pointerWorld
    if (!position) return null
    const command = session.command
    const style = draftStyle()
    const stampScale = K.clamp(finite(session.form['stamp-scale'], 1), 0.2, 5)
    const stampTextScale = K.clamp(finite(session.form['stamp-text-scale'], 1), 0.3, 5)
    const stampTextSize = TEXT_BASE_SIZE * stampTextScale
    const stampStyle = { ...style, size: stampTextSize, fontSize: stampTextSize }
    const textStyle = {
      color: session.form.color || '#172033', fontFamily: session.form['note-font'] || 'gothic',
      fontSize: finite(session.form['note-size'], TEXT_BASE_SIZE), rotation: finite(session.form['note-angle']),
      vertical: Boolean(session.form['note-vertical'])
    }
    if (command === 'text') return {
      id: '__preview__', kind: 'text', position, text: String(session.form['note-text'] ?? ''), style: textStyle,
      fontSize: textStyle.fontSize, rotation: textStyle.rotation, vertical: textStyle.vertical, options: { vertical: textStyle.vertical }
    }
    if (command === 'north') return {
      id: '__preview__', kind: 'north', position, text: session.form['stamp-label'] || 'N', style: stampStyle, fontSize: stampTextSize,
      size: finite(session.form['stamp-width'], 54), stampScale, stampTextScale,
      angle: finite(session.form['stamp-angle']), textStyle: { color: session.form.color || '#172033', size: stampTextSize, fontSize: stampTextSize },
      options: { size: finite(session.form['stamp-width'], 54), scale: stampScale }
    }
    if (command === 'house' || command === 'parking') return {
      id: '__preview__', kind: command, position, text: session.form['stamp-label'] || (command === 'parking' ? 'P' : '家屋'),
      width: finite(session.form['stamp-width'], command === 'parking' ? 2.5 : 10),
      height: finite(session.form['stamp-depth'], command === 'parking' ? 5 : 8),
      stampScale, stampTextScale,
      angle: finite(session.form['stamp-angle']), showDimensions: Boolean(session.form['stamp-dimensions']),
      style: {
        ...stampStyle,
        color: session.form['stamp-stroke'] || '#253858',
        stroke: session.form['stamp-stroke'] || '#253858',
        fill: session.form['stamp-fill'] || (command === 'parking' ? '#eef4fb' : '#edf2f8')
      },
      textStyle: { color: session.form.color || '#253858', size: stampTextSize, fontSize: stampTextSize },
      fontSize: stampTextSize,
      options: {
        width: finite(session.form['stamp-width']), height: finite(session.form['stamp-depth']), scale: stampScale,
        showDimensions: Boolean(session.form['stamp-dimensions']),
        hatch: command === 'house' ? Boolean(session.form['stamp-hatch']) : false
      }
    }
    if (command === 'lot-table') return {
      id: '__preview__', kind: 'lot-table', position, title: '区画一覧', scale: finite(session.form['table-scale'], 1),
      rotation: finite(session.form['table-angle']), style, showPrice: true,
      dynamic: session.form['table-mode'] !== 'snapshot', snapshot: session.form['table-mode'] === 'snapshot',
      rows: session.form['table-mode'] === 'snapshot' ? captureLotTableRows() : [],
      options: { scale: finite(session.form['table-scale'], 1), mode: session.form['table-mode'] || 'dynamic' }
    }
    return null
  }

  function objectSnapAnchors(object) {
    const points = Array.isArray(object?.points) ? object.points.filter(K.isPoint).map(K.point) : []
    if (points.length) return points
    const anchor = object?.position || object?.labelPosition || object?.tip
    return K.isPoint(anchor) ? [K.point(anchor)] : []
  }

  function snappedMoveTranslation(target, origin, destination) {
    const targets = (Array.isArray(target) ? target : [target]).filter(Boolean)
    let dx = destination.x - origin.x
    let dy = destination.y - origin.y
    const snap = store.document.preferences.snap || {}
    if (!(snap.vertex || snap.intersection || snap.edge || snap.grid)) return { dx, dy, snap: null }
    const tolerance = 12 / runtime.view.zoom
    const originDistance = Math.hypot(dx, dy)
    // 移動中も元図形はプレビューの背後に残るため、開始位置へ戻したときは
    // 自分自身を一般吸着の候補にせず、移動量ゼロへ明示的に吸着させる。
    if (originDistance <= tolerance) {
      return { dx: 0, dy: 0, snap: { point: K.point(origin), type: 'origin', distance: originDistance } }
    }
    let best = null
    const excludeObjectIds = targets.map(object => object.id)
    for (const object of targets) {
      for (const sourcePoint of objectSnapAnchors(object)) {
        const movedPoint = { x: sourcePoint.x + dx, y: sourcePoint.y + dy }
        const candidate = K.snapPoint(store.document, movedPoint, { ...snap, excludeObjectIds }, tolerance)
        if (candidate.type === 'free') continue
        if (!best || candidate.distance < best.snap.distance) best = { sourcePoint, movedPoint, snap: candidate }
      }
    }
    if (best) {
      dx += best.snap.point.x - best.movedPoint.x
      dy += best.snap.point.y - best.movedPoint.y
    }
    return { dx, dy, snap: best?.snap || null }
  }

  function movePreview() {
    runtime.moveSnap = null
    if (!runtime.pointerWorld) return []
    if (runtime.drag?.type === 'selection-direct' && runtime.drag.moved) {
      const translation = runtime.drag.translation || { dx: 0, dy: 0 }
      runtime.moveSnap = translation.snap || null
      return runtime.drag.originals.map((object, index) => {
        const clone = deepClone(object)
        K.translateObject(clone, finite(translation.dx), finite(translation.dy))
        clone.id = index === 0 ? '__preview__' : `__preview__${index}`
        return clone
      })
    }
    if (runtime.drag?.type === 'vertex-direct' && runtime.drag.moved) {
      const clone = deepClone(runtime.drag.original)
      if (Array.isArray(clone?.points) && K.isPoint(runtime.drag.destination)) clone.points[runtime.drag.index] = K.point(runtime.drag.destination)
      clone.id = '__preview__'
      return [clone]
    }
    const command = session.command
    if (command === 'move' || command === 'copy') {
      const targets = session.targetIds.map(id => K.objectById(store.document, id)?.object).filter(Boolean)
      const origin = session.points[0]
      if (!targets.length || !origin) return []
      const translation = snappedMoveTranslation(targets, origin, runtime.pointerWorld)
      runtime.moveSnap = translation.snap
      return targets.map((target, index) => {
        const clone = deepClone(target)
        K.translateObject(clone, translation.dx, translation.dy)
        clone.id = index === 0 ? '__preview__' : `__preview__${index}`
        return clone
      })
    }
    if (command === 'move-all' && session.points[0]) {
      const dx = runtime.pointerWorld.x - session.points[0].x
      const dy = runtime.pointerWorld.y - session.points[0].y
      return allObjects().map(object => {
        const clone = deepClone(object)
        K.translateObject(clone, dx, dy)
        clone.id = `__preview__${object.id}`
        return clone
      })
    }
    if (command === 'vertex-edit' && session.targetIds[0] && Number.isInteger(session.vertexIndex)) {
      const target = K.objectById(store.document, session.targetIds[0])?.object
      if (!target) return []
      const clone = deepClone(target)
      clone.id = '__preview__'
      if (Array.isArray(clone.points)) clone.points[session.vertexIndex] = K.point(runtime.pointerWorld)
      return [clone]
    }
    return []
  }

  function guidePreviews() {
    const command = session.command
    if (command === 'parallel-guide' && session.points.length >= 2) {
      const mpp = store.document.calibration.mpp
      if (!(mpp > 0)) return []
      const repeat = Math.max(1, Math.round(finite(session.form.parallelCount, 0)) + 1)
      const offsetM = Math.abs(finite(session.form['parallel-distance'], 3)) * repeat
      const sign = finite(session.form.parallelSign, 1) >= 0 ? 1 : -1
      const offsetWorld = offsetM / mpp * sign
      const line = K.parallelLine(session.points[0], session.points[1], offsetWorld)
      return line ? [{ id: '__parallel__', kind: 'parallel', points: line, text: '', style: { color: '#9b4c8d', lineStyle: 'dashed' } }] : []
    }
    if (command === 'division-guide' && session.points.length) {
      const previewPoints = session.points.length >= 2
        ? session.points.slice(0, 2).map(K.point)
        : (runtime.pointerWorld && K.distance(session.points[0], runtime.pointerWorld) > 0.2 / runtime.view.zoom
            ? [K.point(session.points[0]), K.point(runtime.pointerWorld)]
            : [])
      if (previewPoints.length < 2) return []
      const count = K.clamp(Math.round(finite(session.form['division-count'], 2)), 2, 20)
      return [{
        id: '__segment-guide__', kind: 'guide', points: previewPoints, text: '',
        style: { color: '#647783', lineStyle: 'dashed', lineWidth: 0.9 }, options: { mode: 'segment', divisions: count }
      }]
    }
    if (command === 'lot-division-guide' && session.targetIds[0] && session.points.length >= 2) return buildDivisionGuides(true)
    if (command === 'corner-cut' && session.targetIds[0] && Number.isInteger(session.vertexIndex)) {
      if (!(store.document.calibration.mpp > 0)) return []
      const target = K.objectById(store.document, session.targetIds[0])?.object
      const distanceWorld = finite(session.form['corner-length'], 2) / store.document.calibration.mpp
      const result = target ? K.cornerCut(target.points, session.vertexIndex, distanceWorld) : null
      if (!result) return []
      return [
        { ...deepClone(target), id: '__corner-main__', points: result.polygon },
        { id: '__corner-cut__', kind: 'cutout', points: result.cutout, label: '隅切り', style: K.DEFAULTS.cutoutStyle }
      ]
    }
    return []
  }

  function makeOverlay() {
    const command = session.command
    const processCommand = ['split', 'split-all', 'division-guide', 'lot-division-guide', 'parallel-guide', 'corner-cut', 'merge', 'edge-hide'].includes(command)
    const previews = [...movePreview(), ...guidePreviews()]
    const replacements = ui.batchDrafts.length ? ui.batchDrafts : (ui.editDraft && ui.selectedIds[0] ? [ui.editDraft] : [])
    const placed = placementPreview()
    if (placed) previews.push(placed)
    let draft = null
    if (session.points.length && !processCommand) {
      let kind = command
      if (command === 'lot-draw') kind = 'lot'
      if (command === 'road-draw') kind = String(session.form['road-type']).includes('水路') ? 'water' : 'road'
      draft = { kind, points: session.points, style: draftStyle(), visibility: { label: false, dimensions: false } }
    }
    const processPoints = session.points.map(K.point)
    const withPointer = processPoints.length && runtime.pointerWorld ? [...processPoints, K.point(runtime.pointerWorld)] : processPoints
    const splitLine = ['split', 'split-all'].includes(command) && withPointer.length >= 2 ? { points: withPointer } : null
    const guideDirection = command === 'lot-division-guide'
      ? (processPoints.length >= 2 ? { points: processPoints.slice(0, 2) } : (withPointer.length >= 2 ? { points: withPointer.slice(0, 2) } : null))
      : null
    const parallelBaseline = command === 'parallel-guide' && (processPoints.length >= 2 || withPointer.length >= 2)
      ? { points: (processPoints.length >= 2 ? processPoints : withPointer).slice(0, 2) }
      : null
    const selectedObject = ui.selectedIds.length === 1 ? currentObject() : null
    const dimensionEdgeGuide = selectedObject?.kind === 'lot' && ui.contextPage === 'object-dimension'
      ? (runtime.edgeHover?.id === selectedObject.id && Number.isInteger(runtime.edgeHover.index)
          ? { ...runtime.edgeHover, state: 'hover' }
          : (Number.isInteger(ui.editEdgeIndex) ? { id: selectedObject.id, index: ui.editEdgeIndex, state: 'selected' } : null))
      : null
    return {
      selectedIds: ui.selectedIds.length ? ui.selectedIds : session.targetIds,
      hoverId: runtime.hover?.id,
      command: command === 'vertex-edit' ? 'vertex' : command,
      mode: command === 'vertex-edit' ? 'vertex' : command,
      showHandles: command === 'vertex-edit' || command === 'select',
      showVertices: command === 'vertex-edit' || command === 'select',
      activeVertexIndex: runtime.drag?.type === 'vertex-direct' ? runtime.drag.index : session.vertexIndex,
      // 縮尺合わせは2点目で線を確定する。実距離の入力待ちでは
      // 2点目からカーソルへ余計なラバーバンド線を伸ばさない。
      pointer: runtime.pointerWorld && !processCommand && !(command === 'calibrate' && session.points.length >= 2)
        ? { world: runtime.pointerWorld }
        : null,
      draft,
      preview: previews,
      replacements,
      splitLine,
      guideLine: guideDirection,
      parallelLine: parallelBaseline,
      edgeVisibilityGuide: command === 'edge-hide' && runtime.edgeHover ? { ...runtime.edgeHover } : null,
      edgeSelectionGuide: dimensionEdgeGuide,
      snap: runtime.moveSnap?.type && runtime.moveSnap.type !== 'free'
        ? runtime.moveSnap
        : (runtime.hoverSnap?.type && runtime.hoverSnap.type !== 'free' ? runtime.hoverSnap : null)
    }
  }

  function render() {
    renderer.setDocument(store.document)
    renderer.setView(runtime.view)
    renderer.setOverlay(makeOverlay())
    renderer.scheduleRender(store.document, runtime.view, renderer.overlay, { showVertices: true })
    syncEmptyCanvasHint()
    updateStatus()
    syncControlState()
  }

  function resizeCanvas() {
    if (ui.workspace !== 'drawing' || !dom.stage) return
    const rect = dom.stage.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1)
    render()
  }

  function zoomAt(screen, factor) {
    const oldView = { ...runtime.view }
    const world = renderer.screenToWorld(screen, oldView)
    const zoom = K.clamp(oldView.zoom * factor, 0.02, 30)
    runtime.view = { x: screen.x - world.x * zoom, y: screen.y - world.y * zoom, zoom }
    render()
  }

  function fitView() {
    runtime.view = renderer.calculateFitView(store.document, { padding: 34, includeBackground: true, includePaper: true })
    render()
  }

  function actualSize() {
    const size = renderer.getSize()
    const centerScreen = { x: size.width / 2, y: size.height / 2 }
    const centerWorld = renderer.screenToWorld(centerScreen, runtime.view)
    runtime.view = { x: centerScreen.x - centerWorld.x, y: centerScreen.y - centerWorld.y, zoom: 1 }
    render()
  }

  function setObjectSelection(ids, options = {}) {
    if (!options.preserveSubselection) {
      runtime.edgeHover = null
      ui.editEdgeIndex = null
      ui.editSegmentIndex = null
      ui.segmentPanel = 'text'
      ui.specialPanel = 'primary'
      ui.valueLabelPanel = 'area'
    }
    const uniqueIds = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String))]
      .filter(id => Boolean(K.objectById(store.document, id)?.object))
    ui.selectedIds = uniqueIds
    if (options.syncRegistry !== false) ui.registryIds = new Set(uniqueIds)
    if (options.asTarget) session.targetIds = [...uniqueIds]
    resetEditDrafts()
    const objects = selectedObjects()
    if (objects.length === 1) {
      ui.editOriginal = deepClone(objects[0])
      ui.editDraft = deepClone(objects[0])
      if (options.openEditor) loadObjectForm(objects[0])
    } else if (objects.length > 1 && objects.every(object => object.kind === objects[0].kind)) {
      ui.batchOriginals = objects.map(deepClone)
      ui.batchDrafts = objects.map(deepClone)
      if (options.openEditor) loadObjectForm(objects[0])
      if (!['object-basic', 'object-dimension', 'object-special'].includes(ui.contextPage)) ui.contextPage = 'object-basic'
    } else if (objects.length > 1) {
      session.form = {}
      ui.contextPage = ''
    }
    if (options.renderControls !== false) renderCommandSurface()
    renderRegistry()
    render()
  }

  function selectObject(id, options = {}) {
    setObjectSelection(id ? [id] : [], options)
  }

  function toggleObjectSelection(id, options = {}) {
    const next = [...ui.selectedIds]
    const index = next.indexOf(String(id))
    if (index >= 0) next.splice(index, 1)
    else next.push(String(id))
    setObjectSelection(next, { ...options, openEditor: true, preserveSubselection: false })
  }

  function loadObjectForm(object) {
    const shape = ['lot', 'road', 'water', 'cutout'].includes(object.kind)
    const measurement = ['distance', 'polyline', 'area', 'dimension'].includes(object.kind)
    const edge = Number.isInteger(ui.editEdgeIndex) ? object.edges?.[ui.editEdgeIndex] : null
    const segment = Number.isInteger(ui.editSegmentIndex) ? object.segments?.[ui.editSegmentIndex] : null
    const legacyEdgeHidden = Number.isInteger(ui.editEdgeIndex) && Array.isArray(object.hiddenEdges) && object.hiddenEdges.map(String).includes(String(ui.editEdgeIndex))
    const part = edge || segment
    const partStyle = part?.style || {}
    const partSizeStyle = ['scale', 'size', 'fontSize'].some(key => Number.isFinite(Number(partStyle[key]))) ? partStyle : (object.dimensionStyle || {})
    const textStyle = shape
      ? (object.labelStyle || {})
      : { ...(object.style || {}), ...(measurement ? (object.dimensionStyle || {}) : {}), ...(object.textStyle || {}) }
    const measurementVisibility = object.measurementVisibility || {}
    const areaLabel = object.areaLabel && typeof object.areaLabel === 'object' ? object.areaLabel : {}
    const tsuboLabel = object.tsuboLabel && typeof object.tsuboLabel === 'object' ? object.tsuboLabel : {}
    const areaLabelStyle = areaLabel.style || {}
    const tsuboLabelStyle = tsuboLabel.style || {}
    session.form = {
      'object-type': shape ? object.kind : '',
      'lot-number': object.number ?? '',
      'object-label': object.road?.name ?? object.label ?? object.text ?? '',
      'lot-top-label': object.topLabel ?? '',
      'lot-price': object.price ?? '',
      'object-memo': object.memo ?? '',
      fill: object.style?.fill || object.style?.color || '#f6d86b',
      stroke: object.style?.stroke || object.style?.color || '#172033',
      'fill-opacity': Math.round(finite(object.style?.opacity, 0.58) * 100),
      'show-number': object.visibility?.number !== false,
      'show-label': object.visibility?.label !== false,
      'show-top-label': object.visibility?.topLabel !== false,
      'show-area': metricLabelVisible(object, 'area'),
      'show-tsubo': metricLabelVisible(object, 'tsubo'),
      'show-price': object.visibility?.price !== false,
      'show-memo': object.visibility?.memo !== false,
      'font-family': textStyle.fontFamily || 'gothic',
      'text-size': fontScale(textStyle, shape ? LABEL_BASE_SIZE : TEXT_BASE_SIZE),
      'text-angle': finite(textStyle.rotation ?? textStyle.angle ?? object.rotation),
      'text-vertical': Boolean(textStyle.vertical ?? object.vertical ?? object.options?.vertical),
      textColor: textStyle.color || '#172033',
      'text-background': textStyle.background || 'transparent',
      'text-frame': textStyle.frame === true || ['box', 'frame', 'border'].includes(String(textStyle.boxStyle || '').toLowerCase()),
      'text-underline': textStyle.underline === true || String(textStyle.boxStyle || '').toLowerCase() === 'underline',
      'dimension-visible': shape ? object.visibility?.dimensions !== false : object.dimensionStyle?.visible !== false,
      'dimension-approximate': Boolean(object.dimensionStyle?.approximate),
      'dimension-decimals': object.dimensionStyle?.decimals ?? object.dimensionStyle?.digits ?? 2,
      'dimension-rounding': object.dimensionStyle?.rounding || 'round',
      'dimension-adjustment': finite(object.dimensionStyle?.adjustment),
      'dimension-size': fontScale(object.dimensionStyle, DIMENSION_BASE_SIZE),
      'dimension-offset': finite(object.dimensionStyle?.offset, 14),
      dimensionColor: object.dimensionStyle?.color || '#334155',
      'measurement-total': measurementVisibility.total !== false,
      'measurement-segments': measurementVisibility.segments !== false,
      'measurement-area': measurementVisibility.area !== false,
      'measurement-tsubo': measurementVisibility.tsubo !== false,
      'road-category': roadTypeLabel(object.road?.type, object.kind),
      'stamp-width': finite(object.width ?? object.widthM, object.kind === 'parking' ? 2.5 : 10),
      'stamp-depth': finite(object.height ?? object.heightM ?? object.depth, object.kind === 'parking' ? 5 : 8),
      'stamp-angle': finite(object.rotation ?? object.angle),
      'stamp-scale': finite(object.stampScale ?? object.options?.scale, object.kind === 'north' ? finite(object.size, 54) / 54 : 1),
      'stamp-text-scale': finite(object.stampTextScale, fontScale(object.textStyle || object.style || {}, TEXT_BASE_SIZE)),
      'stamp-dimensions': object.showDimensions === true || object.dimensions === true,
      'stamp-kind': object.kind === 'parking' ? 'parking' : 'house',
      'stamp-stroke': object.style?.stroke || object.style?.color || '#253858',
      'stamp-fill': object.style?.fill || (object.kind === 'parking' ? '#eef4fb' : '#edf2f8'),
      'stamp-hatch': object.kind === 'house' && object.options?.hatch !== false && object.hatch !== false,
      'road-width': finite(object.road?.widthM ?? object.road?.width, object.kind === 'water' ? 0 : 4),
      'road-width-visible': object.visibility?.width !== false,
      'road-width-font': object.road?.widthLabelStyle?.fontFamily || 'gothic',
      'road-width-size': fontScale(object.road?.widthLabelStyle, ROAD_WIDTH_BASE_SIZE),
      'road-width-angle': finite(object.road?.widthLabelStyle?.rotation ?? object.road?.widthLabelStyle?.angle),
      'road-width-color': object.road?.widthLabelStyle?.color || object.labelStyle?.color || '#475569',
      'road-width-text': object.road?.widthText ?? '',
      'table-scale': finite(object.scale ?? object.options?.scale, 1),
      'table-angle': finite(object.rotation ?? object.angle),
      'table-mode': object.dynamic === false || object.snapshot === true || object.options?.mode === 'snapshot' ? 'snapshot' : 'dynamic',
      'edge-visible': edge?.hidden !== true && !legacyEdgeHidden,
      'edge-custom-text': edge?.customText ?? '',
      'edge-rotation-offset': finite(edge?.rotationOffset),
      'segment-visible': segment?.hidden !== true,
      'segment-custom-text': segment?.customText ?? '',
      'segment-rotation-offset': finite(segment?.rotationOffset),
      'part-approximate': Boolean(partStyle.approximate ?? object.dimensionStyle?.approximate),
      'part-decimals': partStyle.decimals ?? partStyle.digits ?? object.dimensionStyle?.decimals ?? object.dimensionStyle?.digits ?? 2,
      'part-rounding': partStyle.rounding || object.dimensionStyle?.rounding || 'round',
      'part-adjustment': finite(partStyle.adjustment, finite(object.dimensionStyle?.adjustment)),
      'part-offset-x': finite(part?.labelOffset?.x),
      'part-offset-y': finite(part?.labelOffset?.y),
      'part-font': partStyle.fontFamily || object.dimensionStyle?.fontFamily || 'gothic',
      'part-size': fontScale(partSizeStyle, DIMENSION_BASE_SIZE),
      'part-color': partStyle.color || object.dimensionStyle?.color || '#334155',
      'stamp-line-style': object.style?.lineStyle || 'solid',
      'object-line-style': object.style?.lineStyle || 'solid',
      'object-line-width': finite(object.style?.lineWidth, 1.4),
      'object-line-color': object.style?.color || object.style?.stroke || '#253858',
      'area-label-visible': metricLabelVisible(object, 'area'),
      'area-label-text': areaLabel.text ?? object.customAreaLabel ?? '',
      'area-label-font': areaLabelStyle.fontFamily || object.labelStyle?.fontFamily || 'gothic',
      'area-label-size': fontScale(areaLabelStyle, METRIC_BASE_SIZE),
      'area-label-angle': finite(areaLabelStyle.rotation ?? areaLabelStyle.angle),
      'area-label-vertical': Boolean(areaLabelStyle.vertical),
      'area-label-color': areaLabelStyle.color || object.labelStyle?.color || '#172033',
      'tsubo-label-visible': metricLabelVisible(object, 'tsubo'),
      'tsubo-label-text': tsuboLabel.text ?? object.customTsuboLabel ?? '',
      'tsubo-label-font': tsuboLabelStyle.fontFamily || object.labelStyle?.fontFamily || 'gothic',
      'tsubo-label-size': fontScale(tsuboLabelStyle, METRIC_BASE_SIZE),
      'tsubo-label-angle': finite(tsuboLabelStyle.rotation ?? tsuboLabelStyle.angle),
      'tsubo-label-vertical': Boolean(tsuboLabelStyle.vertical),
      'tsubo-label-color': tsuboLabelStyle.color || object.labelStyle?.color || '#172033'
    }
  }

  function applyDimensionPartForm(object, type, index) {
    if (type === 'edge' && (!Array.isArray(object.edges) || object.edges.length < (object.points?.length || 0))) {
      object.edges = K.edgeMetadata(store.document, object.points || [], object.edges)
    }
    const part = type === 'edge' ? object.edges?.[index] : object.segments?.[index]
    if (!part) return
    const touched = key => ui.batchTouched.has(key)
    if (type === 'edge') {
      if (touched('edge-visible')) setLotEdgeVisibility(object, index, Boolean(session.form['edge-visible']))
      if (touched('edge-custom-text')) part.customText = String(session.form['edge-custom-text'] || '') || null
      if (touched('edge-rotation-offset')) part.rotationOffset = finite(session.form['edge-rotation-offset'])
    } else {
      if (touched('segment-visible')) part.hidden = !Boolean(session.form['segment-visible'])
      if (touched('segment-custom-text')) part.customText = String(session.form['segment-custom-text'] || '') || null
      if (touched('segment-rotation-offset')) part.rotationOffset = finite(session.form['segment-rotation-offset'])
    }
    if (touched('part-offset-x') || touched('part-offset-y')) {
      part.labelOffset = {
        x: finite(session.form['part-offset-x']),
        y: finite(session.form['part-offset-y'])
      }
    }
    const styleTouched = ['part-approximate', 'part-decimals', 'part-rounding', 'part-adjustment', 'part-font', 'part-size', 'part-color'].some(touched)
    if (!styleTouched) return
    const style = { ...(part.style || {}) }
    if (touched('part-approximate')) style.approximate = Boolean(session.form['part-approximate'])
    if (touched('part-decimals')) style.decimals = style.digits = finite(session.form['part-decimals'], 2)
    if (touched('part-rounding')) style.rounding = session.form['part-rounding'] || 'round'
    if (touched('part-adjustment')) style.adjustment = finite(session.form['part-adjustment'])
    if (touched('part-font')) style.fontFamily = session.form['part-font'] || 'gothic'
    if (touched('part-size')) {
      const partScale = K.clamp(finite(session.form['part-size'], 1), 0.2, 5)
      Object.assign(style, { scale: partScale, size: DIMENSION_BASE_SIZE * partScale, fontSize: DIMENSION_BASE_SIZE * partScale })
    }
    if (touched('part-color')) style.color = session.form['part-color'] || '#334155'
    part.style = style
  }

  function applyEditFormToDraft() {
    const object = ui.editDraft
    if (!object) return
    const shape = ['lot', 'road', 'water', 'cutout'].includes(object.kind)
    if (shape) {
      const requestedKind = session.form['object-type']
      if (['lot', 'road', 'water'].includes(requestedKind)) object.kind = requestedKind
      object.number = String(session.form['lot-number'] ?? '').trim() === '' ? null : parseNumeric(session.form['lot-number'], object.number)
      object.label = String(session.form['object-label'] ?? '')
      object.topLabel = String(session.form['lot-top-label'] ?? '')
      object.price = parseNumeric(session.form['lot-price'], null)
      object.memo = String(session.form['object-memo'] ?? '')
      object.style = { ...(object.style || {}), fill: session.form.fill, stroke: session.form.stroke, opacity: K.clamp(finite(session.form['fill-opacity'], 58) / 100, 0, 1) }
      object.visibility = {
        ...(object.visibility || {}), number: Boolean(session.form['show-number']), label: Boolean(session.form['show-label']),
        topLabel: Boolean(session.form['show-top-label']), price: Boolean(session.form['show-price']), memo: Boolean(session.form['show-memo']),
        area: Boolean(session.form['show-area']), tsubo: Boolean(session.form['show-tsubo']), dimensions: Boolean(session.form['dimension-visible'])
      }
      if (object.kind === 'lot') {
        const areaScale = K.clamp(finite(session.form['area-label-size'], 1), 0.3, 5)
        const tsuboScale = K.clamp(finite(session.form['tsubo-label-size'], 1), 0.3, 5)
        const areaText = String(session.form['area-label-text'] ?? '').trim()
        const tsuboText = String(session.form['tsubo-label-text'] ?? '').trim()
        object.areaLabel = {
          ...(object.areaLabel || {}), visible: Boolean(session.form['area-label-visible']), text: areaText || null,
          style: {
            ...(object.areaLabel?.style || {}), fontFamily: session.form['area-label-font'] || 'gothic',
            scale: areaScale, size: METRIC_BASE_SIZE * areaScale, fontSize: METRIC_BASE_SIZE * areaScale,
            rotation: finite(session.form['area-label-angle']), angle: finite(session.form['area-label-angle']),
            vertical: Boolean(session.form['area-label-vertical']), color: session.form['area-label-color'] || '#172033'
          }
        }
        object.tsuboLabel = {
          ...(object.tsuboLabel || {}), visible: Boolean(session.form['tsubo-label-visible']), text: tsuboText || null,
          style: {
            ...(object.tsuboLabel?.style || {}), fontFamily: session.form['tsubo-label-font'] || 'gothic',
            scale: tsuboScale, size: METRIC_BASE_SIZE * tsuboScale, fontSize: METRIC_BASE_SIZE * tsuboScale,
            rotation: finite(session.form['tsubo-label-angle']), angle: finite(session.form['tsubo-label-angle']),
            vertical: Boolean(session.form['tsubo-label-vertical']), color: session.form['tsubo-label-color'] || '#172033'
          }
        }
        object.visibility.area = object.areaLabel.visible
        object.visibility.tsubo = object.tsuboLabel.visible
        object.customAreaLabel = object.areaLabel.text
        object.customTsuboLabel = object.tsuboLabel.text
      }
      object.labelStyle = {
        ...(object.labelStyle || {}), fontFamily: session.form['font-family'] || 'gothic',
        scale: finite(session.form['text-size'], 1), size: LABEL_BASE_SIZE * finite(session.form['text-size'], 1), fontSize: LABEL_BASE_SIZE * finite(session.form['text-size'], 1),
        rotation: finite(session.form['text-angle']), angle: finite(session.form['text-angle']), vertical: Boolean(session.form['text-vertical']), color: session.form.textColor || '#172033',
        background: 'transparent', boxStyle: session.form['text-frame'] ? 'box' : (session.form['text-underline'] ? 'underline' : 'none'),
        frame: Boolean(session.form['text-frame']), underline: Boolean(session.form['text-underline'])
      }
      if (object.kind === 'road' || object.kind === 'water') {
        const roadCategory = roadTypeCode(session.form['road-category'] || object.road?.type || object.kind)
        object.kind = roadCategory === 'water' ? 'water' : 'road'
        const widthScale = K.clamp(finite(session.form['road-width-size'], 1), 0.3, 5)
        object.label = String(session.form['object-label'] ?? object.label ?? '')
        object.road = {
          ...(object.road || {}), type: roadCategory, name: object.label, vertical: Boolean(session.form['text-vertical']),
          widthM: Math.max(0, finite(session.form['road-width'], object.road?.widthM)),
          width: Math.max(0, finite(session.form['road-width'], object.road?.widthM)),
          widthText: String(session.form['road-width-text'] || '') || null,
          widthLabelStyle: {
            ...(object.road?.widthLabelStyle || {}), fontFamily: session.form['road-width-font'] || 'gothic',
            scale: widthScale, size: ROAD_WIDTH_BASE_SIZE * widthScale, fontSize: ROAD_WIDTH_BASE_SIZE * widthScale,
            rotation: finite(session.form['road-width-angle']), angle: finite(session.form['road-width-angle']),
            vertical: Boolean(session.form['text-vertical']), color: session.form['road-width-color'] || '#475569'
          }
        }
        object.visibility.width = Boolean(session.form['road-width-visible'])
      }
      object.dimensionStyle = {
        ...(object.dimensionStyle || {}), visible: Boolean(session.form['dimension-visible']), approximate: Boolean(session.form['dimension-approximate']),
        decimals: finite(session.form['dimension-decimals'], 2), digits: finite(session.form['dimension-decimals'], 2),
        scale: finite(session.form['dimension-size'], 1), size: DIMENSION_BASE_SIZE * finite(session.form['dimension-size'], 1), fontSize: DIMENSION_BASE_SIZE * finite(session.form['dimension-size'], 1),
        offset: finite(session.form['dimension-offset'], 14), color: session.form.dimensionColor || '#334155',
        rounding: session.form['dimension-rounding'] || 'round', adjustment: finite(session.form['dimension-adjustment'])
      }
      if (Number.isInteger(ui.editEdgeIndex) && object.edges?.[ui.editEdgeIndex]) {
        applyDimensionPartForm(object, 'edge', ui.editEdgeIndex)
      }
    } else {
      object.text = String(session.form['object-label'] ?? object.text ?? '')
      object.memo = String(session.form['object-memo'] ?? '')
      const resolvedTextColor = session.form.textColor || object.textStyle?.color || object.style?.color || '#172033'
      object.style = {
        ...(object.style || {}), color: resolvedTextColor,
        fontFamily: session.form['font-family'] || object.style?.fontFamily,
        size: TEXT_BASE_SIZE * finite(session.form['text-size'], 1), fontSize: TEXT_BASE_SIZE * finite(session.form['text-size'], 1),
        background: 'transparent', boxStyle: session.form['text-frame'] ? 'box' : (session.form['text-underline'] ? 'underline' : 'none'),
        frame: Boolean(session.form['text-frame']), underline: Boolean(session.form['text-underline'])
      }
      if (LINE_STYLE_KINDS.has(object.kind)) object.style = {
        ...object.style,
        lineStyle: session.form['object-line-style'] || object.style.lineStyle || 'solid',
        lineWidth: K.clamp(finite(session.form['object-line-width'], object.style.lineWidth || 1.4), 0.5, 10),
        color: session.form['object-line-color'] || object.style.color || '#253858'
      }
      object.rotation = finite(session.form['text-angle'], object.rotation)
      object.vertical = Boolean(session.form['text-vertical'])
      object.options = { ...(object.options || {}), vertical: object.vertical }
      object.textStyle = {
        ...(object.textStyle || {}), color: resolvedTextColor, fontFamily: object.style.fontFamily, size: object.style.fontSize, fontSize: object.style.fontSize,
        angle: object.rotation, rotation: object.rotation, vertical: object.vertical, background: object.style.background,
        boxStyle: object.style.boxStyle, frame: object.style.frame, underline: object.style.underline
      }
      object.dimensionStyle = {
        ...(object.dimensionStyle || {}), visible: Boolean(session.form['dimension-visible']), approximate: Boolean(session.form['dimension-approximate']),
        decimals: finite(session.form['dimension-decimals'], 2), digits: finite(session.form['dimension-decimals'], 2),
        scale: finite(session.form['dimension-size'], 1), size: DIMENSION_BASE_SIZE * finite(session.form['dimension-size'], 1), fontSize: DIMENSION_BASE_SIZE * finite(session.form['dimension-size'], 1),
        offset: finite(session.form['dimension-offset'], 14), color: session.form.dimensionColor || '#334155',
        rounding: session.form['dimension-rounding'] || 'round', adjustment: finite(session.form['dimension-adjustment'])
      }
      if (['distance', 'polyline', 'area', 'dimension'].includes(object.kind)) object.measurementVisibility = {
        ...(object.measurementVisibility || {}), total: Boolean(session.form['measurement-total']), segments: Boolean(session.form['measurement-segments']),
        area: Boolean(session.form['measurement-area']), tsubo: Boolean(session.form['measurement-tsubo'])
      }
      if (['distance', 'polyline', 'area', 'dimension'].includes(object.kind)) object.dimensionStyle = {
        ...object.dimensionStyle, fontFamily: session.form['font-family'] || 'gothic',
        angle: finite(session.form['text-angle']), rotation: finite(session.form['text-angle']), vertical: Boolean(session.form['text-vertical']),
        background: 'transparent', boxStyle: session.form['text-frame'] ? 'box' : (session.form['text-underline'] ? 'underline' : 'none'),
        frame: Boolean(session.form['text-frame']), underline: Boolean(session.form['text-underline'])
      }
      if (Number.isInteger(ui.editSegmentIndex) && object.segments?.[ui.editSegmentIndex]) {
        applyDimensionPartForm(object, 'segment', ui.editSegmentIndex)
      }
      if (object.kind === 'house' || object.kind === 'parking') {
        object.kind = session.form['stamp-kind'] === 'parking' ? 'parking' : 'house'
        object.width = object.widthM = Math.max(0.1, finite(session.form['stamp-width'], object.width))
        object.height = object.heightM = Math.max(0.1, finite(session.form['stamp-depth'], object.height))
        object.stampScale = K.clamp(finite(session.form['stamp-scale'], 1), 0.2, 5)
        object.stampTextScale = K.clamp(finite(session.form['stamp-text-scale'], finite(session.form['text-size'], 1)), 0.3, 5)
        object.rotation = object.angle = finite(session.form['stamp-angle'])
        object.showDimensions = Boolean(session.form['stamp-dimensions'])
        object.style = {
          ...(object.style || {}),
          color: session.form['stamp-stroke'] || object.style?.color || '#253858',
          stroke: session.form['stamp-stroke'] || object.style?.stroke || '#253858',
          fill: session.form['stamp-fill'] || object.style?.fill || (object.kind === 'parking' ? '#eef4fb' : '#edf2f8'),
          lineStyle: session.form['stamp-line-style'] || 'solid'
        }
        object.options = {
          ...(object.options || {}), width: object.width, height: object.height,
          showDimensions: object.showDimensions, scale: object.stampScale,
          hatch: object.kind === 'house' ? Boolean(session.form['stamp-hatch']) : false
        }
        const fontSize = TEXT_BASE_SIZE * object.stampTextScale
        object.fontSize = fontSize
        object.textStyle = { ...(object.textStyle || {}), color: session.form.textColor || '#253858', scale: object.stampTextScale, size: fontSize, fontSize }
      } else if (object.kind === 'north') {
        object.size = 54
        object.stampScale = K.clamp(finite(session.form['stamp-scale'], 1), 0.2, 5)
        object.stampTextScale = K.clamp(finite(session.form['stamp-text-scale'], finite(session.form['text-size'], 1)), 0.3, 5)
        object.rotation = object.angle = finite(session.form['stamp-angle'])
        object.options = { ...(object.options || {}), size: object.size, scale: object.stampScale }
        const fontSize = TEXT_BASE_SIZE * object.stampTextScale
        object.fontSize = fontSize
        object.textStyle = { ...(object.textStyle || {}), color: session.form.textColor || '#172033', scale: object.stampTextScale, size: fontSize, fontSize }
      } else if (object.kind === 'lot-table') {
        const nextMode = session.form['table-mode'] === 'snapshot' ? 'snapshot' : 'dynamic'
        const wasSnapshot = object.dynamic === false || object.snapshot === true || object.options?.mode === 'snapshot'
        object.scale = K.clamp(finite(session.form['table-scale'], 1), 0.3, 5)
        object.rotation = object.angle = finite(session.form['table-angle'])
        object.dynamic = nextMode === 'dynamic'
        object.snapshot = nextMode === 'snapshot'
        if (nextMode === 'snapshot' && (!wasSnapshot || !Array.isArray(object.rows) || !object.rows.length)) object.rows = captureLotTableRows()
        object.options = { ...(object.options || {}), scale: object.scale, mode: nextMode }
      }
    }
  }

  function applyBatchFormToDrafts() {
    if (!ui.batchDrafts.length || !ui.batchTouched.size) return
    const touched = key => ui.batchTouched.has(key)
    const anyTouched = (...keys) => keys.some(touched)
    for (const object of ui.batchDrafts) {
      const shape = ['lot', 'road', 'water', 'cutout'].includes(object.kind)
      const measurement = ['distance', 'polyline', 'area', 'dimension'].includes(object.kind)
      if (shape) {
        object.style = { ...(object.style || {}) }
        if (touched('fill')) object.style.fill = session.form.fill
        if (touched('stroke')) object.style.stroke = session.form.stroke
        if (touched('fill-opacity')) object.style.opacity = K.clamp(finite(session.form['fill-opacity'], 58) / 100, 0, 1)
        object.visibility = { ...(object.visibility || {}) }
        const visibilityFields = {
          'show-number': 'number', 'show-label': 'label', 'show-top-label': 'topLabel',
          'show-area': 'area', 'show-tsubo': 'tsubo', 'show-price': 'price', 'show-memo': 'memo'
        }
        for (const [field, property] of Object.entries(visibilityFields)) {
          if (touched(field)) object.visibility[property] = Boolean(session.form[field])
        }
        if (anyTouched('font-family', 'text-size', 'text-angle', 'text-vertical', 'textColor', 'text-frame', 'text-underline')) {
          const labelStyle = { ...(object.labelStyle || {}) }
          if (touched('font-family')) labelStyle.fontFamily = session.form['font-family'] || 'gothic'
          if (touched('text-size')) {
            const scale = K.clamp(finite(session.form['text-size'], 1), 0.3, 5)
            Object.assign(labelStyle, { scale, size: LABEL_BASE_SIZE * scale, fontSize: LABEL_BASE_SIZE * scale })
          }
          if (touched('text-angle')) Object.assign(labelStyle, { rotation: finite(session.form['text-angle']), angle: finite(session.form['text-angle']) })
          if (touched('text-vertical')) labelStyle.vertical = Boolean(session.form['text-vertical'])
          if (touched('textColor')) labelStyle.color = session.form.textColor || '#172033'
          if (touched('text-frame') || touched('text-underline')) {
            labelStyle.background = 'transparent'
            labelStyle.boxStyle = session.form['text-frame'] ? 'box' : (session.form['text-underline'] ? 'underline' : 'none')
            labelStyle.frame = Boolean(session.form['text-frame'])
            labelStyle.underline = Boolean(session.form['text-underline'])
          }
          object.labelStyle = labelStyle
          if (object.kind === 'road' || object.kind === 'water') {
            object.road = {
              ...(object.road || {}),
              vertical: touched('text-vertical') ? Boolean(session.form['text-vertical']) : object.road?.vertical,
              nameStyle: { ...(object.road?.nameStyle || {}), ...labelStyle },
              widthLabelStyle: {
                ...(object.road?.widthLabelStyle || {}),
                ...(touched('text-vertical') ? { vertical: Boolean(session.form['text-vertical']) } : {})
              }
            }
          }
        }
        if (anyTouched('dimension-visible', 'dimension-approximate', 'dimension-decimals', 'dimension-rounding', 'dimension-adjustment', 'dimension-size', 'dimension-offset', 'dimensionColor')) {
          const style = { ...(object.dimensionStyle || {}) }
          if (touched('dimension-visible')) { style.visible = Boolean(session.form['dimension-visible']); object.visibility.dimensions = style.visible }
          if (touched('dimension-approximate')) style.approximate = Boolean(session.form['dimension-approximate'])
          if (touched('dimension-decimals')) style.decimals = style.digits = finite(session.form['dimension-decimals'], 2)
          if (touched('dimension-rounding')) style.rounding = session.form['dimension-rounding'] || 'round'
          if (touched('dimension-adjustment')) style.adjustment = finite(session.form['dimension-adjustment'])
          if (touched('dimension-size')) {
            const scale = K.clamp(finite(session.form['dimension-size'], 1), 0.2, 5)
            Object.assign(style, { scale, size: DIMENSION_BASE_SIZE * scale, fontSize: DIMENSION_BASE_SIZE * scale })
          }
          if (touched('dimension-offset')) style.offset = finite(session.form['dimension-offset'], 14)
          if (touched('dimensionColor')) style.color = session.form.dimensionColor || '#334155'
          object.dimensionStyle = style
        }
        if ((object.kind === 'road' || object.kind === 'water') && touched('road-category')) {
          const category = roadTypeCode(session.form['road-category'])
          object.kind = category === 'water' ? 'water' : 'road'
          object.road = { ...(object.road || {}), type: category }
        }
        if ((object.kind === 'road' || object.kind === 'water') && anyTouched('road-width-visible', 'road-width', 'road-width-text', 'road-width-font', 'road-width-size', 'road-width-angle', 'road-width-color')) {
          object.road = { ...(object.road || {}), widthLabelStyle: { ...(object.road?.widthLabelStyle || {}) } }
          if (touched('road-width-visible')) object.visibility.width = Boolean(session.form['road-width-visible'])
          if (touched('road-width')) object.road.width = object.road.widthM = Math.max(0, finite(session.form['road-width'], object.road.widthM))
          if (touched('road-width-text')) object.road.widthText = String(session.form['road-width-text'] || '') || null
          if (touched('road-width-font')) object.road.widthLabelStyle.fontFamily = session.form['road-width-font'] || 'gothic'
          if (touched('road-width-size')) {
            const scale = K.clamp(finite(session.form['road-width-size'], 1), 0.3, 5)
            Object.assign(object.road.widthLabelStyle, { scale, size: ROAD_WIDTH_BASE_SIZE * scale, fontSize: ROAD_WIDTH_BASE_SIZE * scale })
          }
          if (touched('road-width-angle')) Object.assign(object.road.widthLabelStyle, { rotation: finite(session.form['road-width-angle']), angle: finite(session.form['road-width-angle']) })
          if (touched('road-width-color')) object.road.widthLabelStyle.color = session.form['road-width-color'] || '#475569'
        }
      } else {
        if (anyTouched('font-family', 'text-size', 'text-angle', 'text-vertical', 'textColor', 'text-frame', 'text-underline')) {
          object.style = { ...(object.style || {}) }
          object.textStyle = { ...(object.textStyle || {}) }
          if (touched('font-family')) object.style.fontFamily = object.textStyle.fontFamily = session.form['font-family'] || 'gothic'
          if (touched('text-size')) {
            const scale = K.clamp(finite(session.form['text-size'], 1), 0.3, 5)
            const fontSize = TEXT_BASE_SIZE * scale
            Object.assign(object.style, { scale, size: fontSize, fontSize })
            Object.assign(object.textStyle, { scale, size: fontSize, fontSize })
          }
          if (touched('text-angle')) object.rotation = object.textStyle.rotation = object.textStyle.angle = finite(session.form['text-angle'])
          if (touched('text-vertical')) object.vertical = object.textStyle.vertical = Boolean(session.form['text-vertical'])
          if (touched('textColor')) object.style.color = object.textStyle.color = session.form.textColor || '#172033'
          if (touched('text-frame') || touched('text-underline')) {
            const boxStyle = session.form['text-frame'] ? 'box' : (session.form['text-underline'] ? 'underline' : 'none')
            Object.assign(object.style, { background: 'transparent', boxStyle, frame: Boolean(session.form['text-frame']), underline: Boolean(session.form['text-underline']) })
            Object.assign(object.textStyle, { background: 'transparent', boxStyle, frame: Boolean(session.form['text-frame']), underline: Boolean(session.form['text-underline']) })
          }
          if (measurement) object.dimensionStyle = { ...(object.dimensionStyle || {}), ...object.textStyle }
        }
        if (LINE_STYLE_KINDS.has(object.kind)) {
          object.style = { ...(object.style || {}) }
          if (touched('object-line-style')) object.style.lineStyle = session.form['object-line-style'] || 'solid'
          if (touched('object-line-width')) object.style.lineWidth = K.clamp(finite(session.form['object-line-width'], object.style.lineWidth || 1.4), 0.5, 10)
          if (touched('object-line-color')) object.style.color = session.form['object-line-color'] || '#253858'
        }
        if ((object.kind === 'house' || object.kind === 'parking') && anyTouched('stamp-width', 'stamp-depth', 'stamp-scale', 'stamp-text-scale', 'stamp-angle', 'stamp-dimensions', 'stamp-stroke', 'stamp-fill', 'stamp-hatch', 'stamp-line-style', 'textColor')) {
          object.style = { ...(object.style || {}) }
          object.options = { ...(object.options || {}) }
          if (touched('stamp-width')) object.width = object.widthM = Math.max(0.1, finite(session.form['stamp-width'], object.width))
          if (touched('stamp-depth')) object.height = object.heightM = Math.max(0.1, finite(session.form['stamp-depth'], object.height))
          if (touched('stamp-scale')) object.stampScale = K.clamp(finite(session.form['stamp-scale'], 1), 0.2, 5)
          if (touched('stamp-text-scale')) {
            object.stampTextScale = K.clamp(finite(session.form['stamp-text-scale'], 1), 0.3, 5)
            const fontSize = TEXT_BASE_SIZE * object.stampTextScale
            object.fontSize = fontSize
            object.textStyle = { ...(object.textStyle || {}), scale: object.stampTextScale, size: fontSize, fontSize }
          }
          if (touched('stamp-angle')) object.rotation = object.angle = finite(session.form['stamp-angle'])
          if (touched('stamp-dimensions')) object.showDimensions = Boolean(session.form['stamp-dimensions'])
          if (touched('stamp-stroke')) object.style.color = object.style.stroke = session.form['stamp-stroke'] || '#253858'
          if (touched('stamp-fill')) object.style.fill = session.form['stamp-fill'] || (object.kind === 'parking' ? '#eef4fb' : '#edf2f8')
          if (touched('stamp-line-style')) object.style.lineStyle = session.form['stamp-line-style'] || 'solid'
          if (touched('stamp-hatch') && object.kind === 'house') object.options.hatch = Boolean(session.form['stamp-hatch'])
          if (touched('textColor')) object.textStyle = { ...(object.textStyle || {}), color: session.form.textColor || '#253858' }
          Object.assign(object.options, { width: object.width, height: object.height, showDimensions: object.showDimensions, scale: finite(object.stampScale, 1) })
        }
        if (object.kind === 'north' && anyTouched('stamp-scale', 'stamp-text-scale', 'stamp-angle', 'textColor')) {
          object.options = { ...(object.options || {}) }
          if (touched('stamp-scale')) {
            object.size = 54
            object.stampScale = K.clamp(finite(session.form['stamp-scale'], 1), 0.2, 5)
            object.options.size = object.size
            object.options.scale = object.stampScale
          }
          if (touched('stamp-text-scale')) {
            object.stampTextScale = K.clamp(finite(session.form['stamp-text-scale'], 1), 0.3, 5)
            const fontSize = TEXT_BASE_SIZE * object.stampTextScale
            object.fontSize = fontSize
            object.textStyle = { ...(object.textStyle || {}), scale: object.stampTextScale, size: fontSize, fontSize }
          }
          if (touched('stamp-angle')) object.rotation = object.angle = finite(session.form['stamp-angle'])
          if (touched('textColor')) object.textStyle = { ...(object.textStyle || {}), color: session.form.textColor || '#172033' }
        }
        if (measurement && anyTouched('dimension-visible', 'dimension-approximate', 'dimension-decimals', 'dimension-rounding', 'dimension-adjustment', 'dimension-size', 'dimension-offset', 'dimensionColor', 'measurement-total', 'measurement-segments', 'measurement-area', 'measurement-tsubo')) {
          const style = { ...(object.dimensionStyle || {}) }
          if (touched('dimension-visible')) style.visible = Boolean(session.form['dimension-visible'])
          if (touched('dimension-approximate')) style.approximate = Boolean(session.form['dimension-approximate'])
          if (touched('dimension-decimals')) style.decimals = style.digits = finite(session.form['dimension-decimals'], 2)
          if (touched('dimension-rounding')) style.rounding = session.form['dimension-rounding'] || 'round'
          if (touched('dimension-adjustment')) style.adjustment = finite(session.form['dimension-adjustment'])
          if (touched('dimension-size')) {
            const scale = K.clamp(finite(session.form['dimension-size'], 1), 0.2, 5)
            Object.assign(style, { scale, size: DIMENSION_BASE_SIZE * scale, fontSize: DIMENSION_BASE_SIZE * scale })
          }
          if (touched('dimension-offset')) style.offset = finite(session.form['dimension-offset'], 14)
          if (touched('dimensionColor')) style.color = session.form.dimensionColor || '#334155'
          object.dimensionStyle = style
          object.measurementVisibility = { ...(object.measurementVisibility || {}) }
          const visibilityFields = { 'measurement-total': 'total', 'measurement-segments': 'segments', 'measurement-area': 'area', 'measurement-tsubo': 'tsubo' }
          for (const [field, property] of Object.entries(visibilityFields)) if (touched(field)) object.measurementVisibility[property] = Boolean(session.form[field])
        }
      }
    }
  }

  function commitBatchEdit() {
    if (!ui.batchDrafts.length || !ui.batchTouched.size) return [...ui.selectedIds]
    applyBatchFormToDrafts()
    const replacements = new Map(ui.batchDrafts.map(object => [String(object.id), deepClone(object)]))
    store.commit('一括書式編集', documentModel => {
      for (const [id, replacement] of replacements) {
        const found = K.objectById(documentModel, id)
        if (!found) continue
        const index = found.collection.findIndex(object => String(object.id) === id)
        if (index >= 0) found.collection[index] = replacement
      }
    })
    ui.batchOriginals = ui.batchDrafts.map(deepClone)
    ui.batchTouched.clear()
    return [...ui.selectedIds]
  }

  function commitPendingEdit() {
    if (ui.batchDrafts.length) return commitBatchEdit()
    if (ui.editDraft && ui.batchTouched.size) return commitObjectEdit()
    return ui.selectedIds[0] || null
  }

  function commitObjectEdit() {
    if (!ui.editDraft || !ui.selectedIds[0]) return
    if (!ui.batchTouched.size) return ui.selectedIds[0]
    applyEditFormToDraft()
    const id = ui.selectedIds[0]
    const replacement = deepClone(ui.editDraft)
    store.commit('図形編集', documentModel => {
      const found = K.objectById(documentModel, id)
      if (!found) return
      const index = found.collection.findIndex(object => object.id === id)
      if (index >= 0) found.collection[index] = replacement
    })
    ui.editOriginal = deepClone(replacement)
    ui.batchTouched.clear()
    return id
  }

  function saveObjectEdit() {
    const id = commitObjectEdit()
    if (!id) return
    activateCommand('select', { focusCanvas: false })
    setStatus('編集内容を確定しました', 1800)
  }

  function cancelObjectEdit() {
    if (!ui.editDraft) return
    activateCommand('select', { focusCanvas: false })
    setStatus('編集前の状態へ戻しました', 1600)
  }

  function moveSelectedObject() {
    const ids = [...ui.selectedIds]
    if (!ids.length) return
    commitPendingEdit()
    activateCommand('move', { focusCanvas: false })
    session.targetIds = [...ids]
    ui.selectedIds = [...ids]
    session.points = []
    renderCommandSurface()
    render()
    setStatus('移動の基準点をクリックしてください', 0)
  }

  function addSessionPoint(world) {
    const next = K.point(world)
    const previous = session.points[session.points.length - 1]
    if (previous && K.distance(previous, next) <= 0.2 / runtime.view.zoom) {
      setStatus('同じ点は続けて置けません', 1400)
      return false
    }
    session.addPoint(next)
    syncControlState()
    render()
    return true
  }

  function handleCanvasPoint(world, screen, isReadPoint, event) {
    const command = session.command
    const hit = hitAt(world)
    if (command === 'underlay-transform') {
      if (store.document.background.locked) { setStatus('下絵はロックされています', 1600); return }
      runtime.drag = { type: 'underlay', start: world, original: deepClone(store.document.background) }
      return
    }
    if (command === 'calibrate') {
      if (session.points.length >= 2) {
        setStatus('2点は取得済みです。実距離を入力するか「2点を取り直す」を選んでください', 2200)
        return
      }
      if (addSessionPoint(world) && session.points.length === 2) {
        setStatus('2点を取得しました。実距離を入力して縮尺を確定してください', 0)
        focusCalibrationDistance()
      }
      return
    }
    if (command === 'callout') {
      if (session.points.length >= 2) { setStatus('2点が揃っています', 1400); return }
      if (addSessionPoint(world) && session.points.length === 2) finishCommand()
      return
    }
    if (['lot-draw', 'road-draw', 'distance', 'polyline', 'area', 'line', 'arrow', 'callout'].includes(command)) {
      const added = addSessionPoint(world)
      if (added && TWO_POINT_AUTO_FINISH_COMMANDS.has(command) && session.points.length === 2) finishCommand()
      return
    }
    if (['text', 'north', 'house', 'parking', 'lot-table'].includes(command)) {
      runtime.pointerWorld = K.point(world)
      finishCommand()
      return
    }
    if (command === 'select' || command === 'label-edit') {
      const labelHit = renderer.hitLabel(screen)
      const vertexHit = command === 'select' && !labelHit ? selectedVertexAt(world) : null
      if (vertexHit) {
        commitPendingEdit()
        const original = K.objectById(store.document, vertexHit.id)?.object
        if (original) {
          runtime.drag = {
            type: 'vertex-direct', id: vertexHit.id, index: vertexHit.index,
            start: K.point(world), startScreen: { ...screen }, destination: K.point(world),
            original: deepClone(original), moved: false
          }
          return
        }
      }
      const selectedDimensionLot = command === 'select' && ui.contextPage === 'object-dimension' && ui.selectedIds.length === 1 && currentObject()?.kind === 'lot'
      if (selectedDimensionLot) {
        const edgeHit = labelHit?.kind === 'shape-dimension' && labelHit.ownerId === ui.selectedIds[0] && Number.isInteger(labelHit.edgeIndex)
          ? { id: labelHit.ownerId, index: labelHit.edgeIndex }
          : selectedLotEdgeAt(world)
        if (edgeHit) {
          const id = ui.selectedIds[0]
          commitPendingEdit()
          ui.editEdgeIndex = edgeHit.index
          ui.editSegmentIndex = null
          ui.contextPage = 'object-dimension'
          ui.segmentPanel = 'text'
          selectObject(id, { openEditor: true, preserveSubselection: true })
          runtime.edgeHover = { ...edgeHit }
          if (labelHit?.kind === 'shape-dimension') {
            runtime.drag = {
              type: 'label', id, labelKind: 'shape-dimension', edgeIndex: edgeHit.index, segmentIndex: null,
              start: world, anchor: Array.isArray(labelHit.worldPolygon) ? K.polygonCentroid(labelHit.worldPolygon) : null,
              original: deepClone(K.objectById(store.document, id)?.object)
            }
            setStatus(`辺 ${edgeHit.index + 1} の寸法文字をドラッグして移動できます`, 0)
          } else {
            setStatus(`辺 ${edgeHit.index + 1} の寸法を選択しました。上部で表示・数値・位置・書式を調整できます`, 2000)
          }
          render()
          return
        }
      }
      const id = labelHit?.ownerId || hit?.id
      if (!id) {
        commitPendingEdit()
        setStatus(ui.selectedIds.length ? '選択は保持中です。Escまたは「選択解除」で解除できます' : '図形をクリックして選択します', 1600)
        return
      }
      const additive = !labelHit && Boolean(event?.ctrlKey || event?.metaKey || event?.shiftKey)
      const keepGroup = command === 'select' && !labelHit && ui.selectedIds.length > 1 && ui.selectedIds.includes(String(id))
      commitPendingEdit()
      if (additive) {
        toggleObjectSelection(id, { openEditor: true })
        setStatus(`${ui.selectedIds.length}件を選択中`, 1200)
        return
      }
      ui.editEdgeIndex = labelHit?.edgeIndex ?? null
      ui.editSegmentIndex = labelHit?.segmentIndex ?? null
      if (labelHit?.kind === 'shape-dimension' || labelHit?.kind === 'entity-segment') {
        ui.contextPage = 'object-dimension'
        ui.segmentPanel = 'text'
      }
      else if (labelHit?.kind === 'shape-area-label' || labelHit?.kind === 'shape-tsubo-label') {
        ui.contextPage = 'object-values'
        ui.valueLabelPanel = labelHit.kind === 'shape-tsubo-label' ? 'tsubo' : 'area'
      }
      else ui.contextPage = 'object-basic'
      if (!keepGroup) selectObject(id, { openEditor: true, preserveSubselection: true })
      if (labelHit) {
        runtime.drag = {
          type: 'label', id, labelKind: labelHit.kind, edgeIndex: labelHit.edgeIndex, segmentIndex: labelHit.segmentIndex,
          start: world, anchor: Array.isArray(labelHit.worldPolygon) ? K.polygonCentroid(labelHit.worldPolygon) : null,
          original: deepClone(K.objectById(store.document, id)?.object)
        }
      } else if (command === 'select') {
        const ids = keepGroup ? [...ui.selectedIds] : [String(id)]
        const originals = ids.map(objectId => K.objectById(store.document, objectId)?.object).filter(Boolean).map(deepClone)
        if (originals.length) {
          runtime.drag = {
            type: 'selection-direct', ids, originals,
            start: K.point(world), startScreen: { ...screen }, moved: false,
            translation: { dx: 0, dy: 0, snap: null }
          }
        }
      }
      return
    }
    if (command === 'move' || command === 'copy') {
      const operationName = command === 'copy' ? '複写' : '移動'
      if (!session.targetIds.length) {
        if (!hit) { setStatus(`${operationName}する対象を選んでください`, 1600); return }
        session.targetIds = [hit.id]
        session.points = []
        ui.selectedIds = [hit.id]
        setStatus(`${operationName}の基準点をクリックしてください`, 0)
        renderCommandSurface()
        render()
      } else if (!session.points.length) {
        session.points = [K.point(world)]
        setStatus('移動先をクリックしてください', 0)
        renderCommandSurface()
        render()
      } else {
        const origin = session.points[0]
        const targets = session.targetIds.map(id => K.objectById(store.document, id)?.object).filter(Boolean)
        const translation = targets.length ? snappedMoveTranslation(targets, origin, world) : { dx: world.x - origin.x, dy: world.y - origin.y }
        const { dx, dy } = translation
        if (command === 'move') {
          store.commit('移動', documentModel => {
            for (const id of session.targetIds) {
              const found = K.objectById(documentModel, id)
              if (found) K.translateObject(found.object, dx, dy)
            }
          })
          restartCommand(command, `${session.targetIds.length}件を移動しました`)
        } else {
          const created = []
          store.commit('複写', documentModel => {
            created.push(...K.duplicateObjects(documentModel, session.targetIds, { x: dx, y: dy }).map(object => object.id))
          })
          activateCommand('select', { focusCanvas: false })
          setObjectSelection(created, { openEditor: true })
          setStatus(`${created.length}件を複写しました`, 1600)
        }
      }
      return
    }
    if (command === 'move-all') {
      if (!session.points.length) addSessionPoint(world)
      else {
        const dx = world.x - session.points[0].x
        const dy = world.y - session.points[0].y
        store.commit('全体移動', documentModel => {
          const active = page(documentModel)
          ;[...active.shapes, ...active.entities].forEach(object => K.translateObject(object, dx, dy))
          if (session.form['move-all-include-underlay'] && documentModel.background?.type) {
            documentModel.background.x = finite(documentModel.background.x) + dx
            documentModel.background.y = finite(documentModel.background.y) + dy
          }
        })
        restartCommand(command, session.form['move-all-include-underlay'] ? '図形と下絵を一緒に移動しました' : '図形全体を移動しました（下絵は固定）')
      }
      return
    }
    if (command === 'vertex-edit') {
      const vertexHit = hitAt(world, 'vertex')
      if (session.vertexIndex == null) {
        if (!vertexHit || vertexHit.part !== 'vertex') { setStatus('編集する頂点を選んでください', 1600); return }
        session.targetIds = [vertexHit.id]
        session.vertexIndex = vertexHit.index
        ui.selectedIds = [vertexHit.id]
        render()
      } else {
        const id = session.targetIds[0]
        const index = session.vertexIndex
        let changed = false
        store.commit('頂点編集', documentModel => { changed = K.updateObjectVertex(documentModel, id, index, world) })
        if (!changed) { setStatus('交差する形になるため頂点を移動できません', 2200); return }
        restartCommand(command, '頂点を移動しました')
      }
      return
    }
    if (command === 'delete') {
      if (!hit) { setStatus('削除する対象を選んでください', 1600); return }
      store.commit('削除', documentModel => K.removeObjects(documentModel, [hit.id]))
      ui.selectedIds = []
      setStatus('削除しました', 1400)
      render()
      return
    }
    if (command === 'split') {
      if (!session.targetIds.length) {
        if (!hit || hit.object?.kind !== 'lot') { setStatus('分割する区画を選んでください', 1600); return }
        session.targetIds = [hit.id]
        ui.selectedIds = [hit.id]
        renderCommandSurface()
        render()
      } else addSessionPoint(world)
      return
    }
    if (command === 'split-all') { addSessionPoint(world); return }
    if (command === 'merge') {
      if (!hit || !['lot', 'cutout'].includes(hit.object?.kind)) { setStatus('合筆する区画または隅切りを選んでください', 1600); return }
      if (session.targetIds.includes(hit.id)) session.targetIds = session.targetIds.filter(id => id !== hit.id)
      else if (session.targetIds.length < 2) session.targetIds.push(hit.id)
      ui.selectedIds = [...session.targetIds]
      if (session.targetIds.length === 2) finishCommand()
      else { renderCommandSurface(); render() }
      return
    }
    if (command === 'corner-cut') {
      if (!hit || hit.object?.kind !== 'lot') { setStatus('区画の頂点を選んでください', 1600); return }
      if (hit.part !== 'vertex') { session.targetIds = [hit.id]; ui.selectedIds = [hit.id]; renderCommandSurface(); render(); return }
      session.targetIds = [hit.id]
      session.vertexIndex = hit.index
      ui.selectedIds = [hit.id]
      renderCommandSurface()
      render()
      return
    }
    if (command === 'division-guide') {
      if (session.points.length >= 2) { setStatus('2点が揃っています。Enterまたは「確定」で作成してください', 1800); return }
      if (addSessionPoint(world) && session.points.length === 2) finishCommand()
      return
    }
    if (command === 'lot-division-guide') {
      if (!session.targetIds.length) {
        if (!hit || hit.object?.kind !== 'lot') { setStatus('ガイド対象の区画を選んでください', 1600); return }
        session.targetIds = [hit.id]
        ui.selectedIds = [hit.id]
        renderCommandSurface()
        render()
      } else if (session.points.length < 2) {
        if (addSessionPoint(world) && session.points.length === 2) setStatus('等分線の向きを確認し、Enterまたは「作成」で確定してください', 0)
      }
      else setStatus('基準方向が揃っています。Enterまたは「確定」で作成してください', 1800)
      return
    }
    if (command === 'parallel-guide') {
      if (session.points.length >= 2) { setStatus('基準線は保持中です。Enterまたは「確定」で次の平行線を作成します', 2000); return }
      addSessionPoint(world)
      return
    }
    if (command === 'edge-hide') {
      const labelHit = renderer.hitLabel(screen)
      const labelObject = labelHit?.ownerId ? K.objectById(store.document, labelHit.ownerId)?.object : null
      const edgeHit = labelHit?.kind === 'shape-dimension' && labelObject?.kind === 'lot' && Number.isInteger(labelHit.edgeIndex)
        ? { id: labelHit.ownerId, index: labelHit.edgeIndex }
        : (hit?.type === 'shape' && hit.object?.kind === 'lot' && hit.part === 'edge' ? { id: hit.id, index: hit.index } : null)
      if (!edgeHit) { setStatus('区画の外周辺または寸法文字を選んでください', 1600); return }
      let nowHidden = false
      store.commit('辺寸法表示切替', documentModel => {
        const found = K.objectById(documentModel, edgeHit.id)
        if (!found) return
        const shape = found.object
        const currentlyHidden = shape.edges?.[edgeHit.index]?.hidden === true || (Array.isArray(shape.hiddenEdges) && shape.hiddenEdges.map(String).includes(String(edgeHit.index)))
        if (setLotEdgeVisibility(shape, edgeHit.index, currentlyHidden)) nowHidden = !currentlyHidden
      })
      runtime.edgeHover = { ...edgeHit }
      setStatus(`辺 ${edgeHit.index + 1} の寸法を${nowHidden ? '非表示' : '表示'}にしました`, 1500)
      render()
    }
  }

  function restartCommand(command, message = '', timeout = 1600) {
    const raw = command
    const form = deepClone(session.form)
    activateCommand(raw, { focusCanvas: false })
    Object.assign(session.form, form)
    renderCommandSurface()
    render()
    if (message) setStatus(message, timeout)
  }

  function finishCommand() {
    const command = session.command
    if (SCALE_REQUIRED_COMMANDS.has(command) && !hasScale()) {
      ui.scaleFlow = { reason: 'required-command', returnCommand: command }
      activateCommand('calibrate', { focusCanvas: false })
      setStatus(`現在のページは縮尺未設定です。縮尺を設定するまで「${COMMAND[command]?.name || command}」は確定できません`, 0)
      showScaleRequiredDialog(command)
      return false
    }
    if (command === 'text' && !String(session.form['note-text'] || '').trim()) {
      setStatus('配置する文字を入力してください', 2200)
      requestAnimationFrame(() => $('[data-field="note-text"]', dom.commandControls)?.focus({ preventScroll: true }))
      return false
    }
    if (!canFinishCommand()) { setStatus('必要な点または対象がまだ揃っていません', 1600); return false }
    const points = session.points.map(K.point)
    const form = deepClone(session.form)
    try {
      if (command === 'underlay-transform') {
        activateCommand('underlay-open', { focusCanvas: false })
        setStatus('下絵の調整を終了しました', 1600)
        return true
      }
      if (command === 'calibrate') return applyCalibration()
      if (command === 'lot-draw') {
        if (!K.validPolygon(points)) throw new Error('交差しない3点以上の区画を指定してください')
        const scaleMissing = !hasScale()
        store.commit('区画作図', documentModel => {
          const style = { ...documentModel.preferences.lot.style, fill: form.fill, stroke: form.stroke, opacity: K.clamp(finite(form['fill-opacity'], 46) / 100, 0, 1) }
          const dimensionStyle = {
            ...documentModel.preferences.lot.dimensionStyle,
            approximate: Boolean(form.approximate),
            decimals: finite(form['dimension-decimals'], 2), digits: finite(form['dimension-decimals'], 2),
            rounding: form['dimension-rounding'] || 'round', adjustment: finite(form['dimension-adjustment'])
          }
          documentModel.preferences.lot.style = deepClone(style)
          documentModel.preferences.lot.dimensionStyle = deepClone(dimensionStyle)
          documentModel.preferences.lot.showArea = Boolean(form['show-area'])
          documentModel.preferences.lot.showTsubo = Boolean(form['show-tsubo'])
          documentModel.preferences.lot.showLengths = Boolean(form['show-lengths'])
          K.addShape(documentModel, 'lot', points, {
            style,
            visibility: { label: true, topLabel: true, number: true, area: Boolean(form['show-area']), tsubo: Boolean(form['show-tsubo']), price: true, memo: true, dimensions: Boolean(form['show-lengths']), approximate: Boolean(form.approximate) },
            dimensionStyle
          })
        })
        restartCommand(command, scaleMissing
          ? '区画を作成しました。縮尺未設定のため寸法・面積は表示されません。ステータスバーの「縮尺 未設定」から設定できます'
          : '区画を作成しました', scaleMissing ? 3600 : 1600)
        return true
      }
      if (command === 'road-draw') {
        if (!K.validPolygon(points)) throw new Error('交差しない3点以上の道路外周を指定してください')
        const typeCode = roadTypeCode(form['road-type'])
        const isWater = typeCode === 'water'
        const kind = isWater ? 'water' : 'road'
        const name = String(form['road-name'] || form['road-type'] || (isWater ? '水路' : '道路'))
        const widthM = Math.max(0, finite(form['road-width'], 4))
        store.commit(isWater ? '水路作図' : '道路作図', documentModel => {
          const preference = documentModel.preferences[kind]
          const style = { ...preference.style, fill: form.fill, stroke: form.stroke, opacity: K.clamp(finite(form['fill-opacity'], Math.round(finite(preference.style?.opacity, 0.68) * 100)) / 100, 0, 1) }
          preference.style = deepClone(style)
          preference.type = String(form['road-type'] || (isWater ? '水路' : '道路'))
          preference.name = name
          preference.widthM = widthM
          const shape = K.addShape(documentModel, kind, points, {
            label: name, style, road: { type: typeCode, widthM, width: widthM, name, vertical: false },
            visibility: { label: true, number: false, area: false, tsubo: false, dimensions: false, width: true }
          })
          shape.road = { ...(shape.road || {}), name, width: widthM, widthM }
        })
        restartCommand(command, `${isWater ? '水路' : '道路'}を作成しました`)
        return true
      }
      if (['distance', 'polyline', 'area', 'line', 'arrow', 'callout'].includes(command)) {
        if (command === 'area' && !K.validPolygon(points)) throw new Error('交差しない3点以上の範囲を指定してください')
        const style = { color: form.color || '#253858', lineWidth: finite(form['line-width'], 1.4), lineStyle: form['line-style'] || 'solid' }
        store.commit('要素作図', documentModel => {
          documentModel.preferences.line = { ...documentModel.preferences.line, ...style }
          const dimensionStyle = {
            ...documentModel.preferences.measurement.dimensionStyle,
            color: style.color,
            approximate: Boolean(form['dimension-approximate']),
            decimals: finite(form['dimension-decimals'], 2), digits: finite(form['dimension-decimals'], 2),
            rounding: form['dimension-rounding'] || 'round', adjustment: finite(form['dimension-adjustment'])
          }
          if (['distance', 'polyline', 'area'].includes(command)) documentModel.preferences.measurement.dimensionStyle = deepClone(dimensionStyle)
          const attributes = {
            points, style,
            text: command === 'callout' ? String(form['note-text'] || '注記') : '',
            labelPosition: command === 'callout' ? points[points.length - 1] : null,
            textStyle: command === 'callout' ? {
              color: form.color || '#172033', fontFamily: form['note-font'] || 'gothic',
              size: finite(form['note-size'], TEXT_BASE_SIZE), fontSize: finite(form['note-size'], TEXT_BASE_SIZE),
              angle: finite(form['note-angle']), rotation: finite(form['note-angle']), vertical: Boolean(form['note-vertical'])
            } : null,
            dimensionStyle,
            options: { closed: command === 'area' }
          }
          const entity = K.addEntity(documentModel, command, attributes)
          if (command === 'area') entity.closed = true
          if (command === 'callout') {
            entity.fontSize = finite(form['note-size'], TEXT_BASE_SIZE)
            entity.rotation = finite(form['note-angle'])
            entity.vertical = Boolean(form['note-vertical'])
          }
        })
        restartCommand(command, '作図しました')
        return true
      }
      if (['text', 'north', 'house', 'parking', 'lot-table'].includes(command)) {
        const position = K.point(runtime.pointerWorld)
        store.commit('注記配置', documentModel => {
          if (command === 'text') {
            const style = {
              color: form.color || '#172033', fontFamily: form['note-font'] || 'gothic',
              size: finite(form['note-size'], TEXT_BASE_SIZE), fontSize: finite(form['note-size'], TEXT_BASE_SIZE),
              rotation: finite(form['note-angle']), vertical: Boolean(form['note-vertical']), background: 'transparent'
            }
            documentModel.preferences.text = { ...documentModel.preferences.text, ...style }
            const entity = K.addEntity(documentModel, 'text', {
              position, text: String(form['note-text']).trim(), style, rotation: style.rotation,
              vertical: style.vertical, options: { vertical: style.vertical }
            })
            entity.vertical = style.vertical
          } else if (command === 'north') {
            const size = finite(form['stamp-width'], 54)
            const stampScale = K.clamp(finite(form['stamp-scale'], 1), 0.2, 5)
            const stampTextScale = K.clamp(finite(form['stamp-text-scale'], 1), 0.3, 5)
            const fontSize = TEXT_BASE_SIZE * stampTextScale
            documentModel.preferences.stamp.north = {
              size, scale: stampScale, textScale: stampTextScale,
              label: String(form['stamp-label'] || 'N'), textColor: form.color || '#172033'
            }
            K.addEntity(documentModel, 'north', {
              position, text: String(form['stamp-label'] || 'N'), size, stampScale, stampTextScale, fontSize,
              angle: finite(form['stamp-angle']), rotation: finite(form['stamp-angle']),
              style: { color: form.color || '#172033', size: fontSize, fontSize },
              textStyle: { color: form.color || '#172033', size: fontSize, fontSize }, options: { size, scale: stampScale }
            })
          } else if (command === 'house' || command === 'parking') {
            const width = finite(form['stamp-width'], command === 'parking' ? 2.5 : 10)
            const height = finite(form['stamp-depth'], command === 'parking' ? 5 : 8)
            const showDimensions = Boolean(form['stamp-dimensions'])
            const stroke = form['stamp-stroke'] || '#253858'
            const fill = form['stamp-fill'] || (command === 'parking' ? '#eef4fb' : '#edf2f8')
            const hatch = command === 'house' ? Boolean(form['stamp-hatch']) : false
            const stampScale = K.clamp(finite(form['stamp-scale'], 1), 0.2, 5)
            const stampTextScale = K.clamp(finite(form['stamp-text-scale'], 1), 0.3, 5)
            const fontSize = TEXT_BASE_SIZE * stampTextScale
            documentModel.preferences.stamp[command] = {
              widthM: width, heightM: height,
              label: String(form['stamp-label'] || (command === 'parking' ? 'P' : '家屋')),
              showDimensions, stroke, fill, hatch, scale: stampScale, textScale: stampTextScale,
              textColor: form.color || '#253858', lineStyle: form['line-style'] || 'solid'
            }
            K.addEntity(documentModel, command, {
              position, text: String(form['stamp-label'] || (command === 'parking' ? 'P' : '家屋')),
              width, height, widthM: width, heightM: height, angle: finite(form['stamp-angle']), rotation: finite(form['stamp-angle']),
              showDimensions, stampScale, stampTextScale, fontSize, style: { color: stroke, stroke, fill, lineStyle: form['line-style'] || 'solid', size: fontSize, fontSize },
              textStyle: { color: form.color || '#253858', size: fontSize, fontSize },
              options: { width, height, showDimensions, hatch, scale: stampScale }
            })
          } else {
            const tableMode = form['table-mode'] === 'snapshot' ? 'snapshot' : 'dynamic'
            K.addEntity(documentModel, 'lot-table', {
              position, title: '区画一覧', scale: finite(form['table-scale'], 1), rotation: finite(form['table-angle']),
              showPrice: true, style: { color: '#253858' },
              dynamic: tableMode === 'dynamic', snapshot: tableMode === 'snapshot',
              rows: tableMode === 'snapshot' ? captureLotTableRows(documentModel) : [],
              options: { scale: finite(form['table-scale'], 1), mode: tableMode }
            })
          }
        })
        restartCommand(command, '配置しました')
        return true
      }
      if (command === 'split') {
        let result = null
        store.commit('区画分割', documentModel => { result = K.splitShapeByPolyline(documentModel, session.targetIds[0], points) })
        if (!result) throw new Error('分割線が区画を横切っていません')
        restartCommand(command, '区画を分割しました')
        return true
      }
      if (command === 'split-all') {
        let result = []
        store.commit('一括分割', documentModel => { result = K.splitAllLotsByPolyline(documentModel, points) })
        if (!Array.isArray(result) || !result.length) throw new Error('分割線が区画を横切っていないか、折れ線が不正です')
        restartCommand(command, '交差する区画を一括分割しました')
        return true
      }
      if (command === 'merge') {
        let result = null
        store.commit('合筆', documentModel => { result = K.mergeLotShapes(documentModel, session.targetIds[0], session.targetIds[1]) })
        if (!result) throw new Error('共有辺のある区画同士、または区画と隅切りを選択してください')
        restartCommand(command, '区画を合筆しました')
        return true
      }
      if (command === 'corner-cut') {
        const distanceWorld = finite(form['corner-length'], 2) / store.document.calibration.mpp
        let result = null
        store.commit('隅切り', documentModel => { result = K.cutShapeCorner(documentModel, session.targetIds[0], session.vertexIndex, distanceWorld) })
        if (!result) throw new Error('この頂点では指定寸法の隅切りを作れません')
        restartCommand(command, '隅切りを作成しました')
        return true
      }
      if (command === 'division-guide') {
        const count = K.clamp(Math.round(finite(form['division-count'], 2)), 2, 20)
        const totalLengthM = store.document.calibration.mpp > 0 ? K.distance(points[0], points[1]) * store.document.calibration.mpp : null
        store.commit('2点間均等ガイド', documentModel => K.addEntity(documentModel, 'guide', {
          points: points.slice(0, 2), text: '', style: { color: '#647783', lineStyle: 'dashed', lineWidth: 0.9 },
          options: { mode: 'segment', divisions: count, totalLengthM, segmentLengthM: totalLengthM == null ? null : totalLengthM / count }
        }))
        restartCommand(command, `${count}等分のガイドを作成しました`)
        return true
      }
      if (command === 'lot-division-guide') {
        const guides = buildDivisionGuides(false)
        if (!guides.length) throw new Error('区画等分線を作成できません')
        store.commit('区画等分線', documentModel => guides.forEach(guide => K.addEntity(documentModel, 'guide', guide)))
        const count = K.clamp(Math.round(finite(form['division-count'], 2)), 2, 20)
        restartCommand(command, `${count}等分のガイドを作成しました（${guides.length}線分）`)
        return true
      }
      if (command === 'parallel-guide') {
        const mpp = store.document.calibration.mpp
        const baseDistanceM = Math.abs(finite(form['parallel-distance'], 3))
        if (!(baseDistanceM > 0)) throw new Error('平行線の間隔を入力してください')
        const repeatIndex = Math.max(1, Math.round(finite(form.parallelCount, 0)) + 1)
        const sign = finite(form.parallelSign, 1) >= 0 ? 1 : -1
        const offsetM = baseDistanceM * repeatIndex * sign
        const result = K.parallelLine(points[0], points[1], offsetM / mpp)
        if (!result) throw new Error('基準線を指定してください')
        store.commit('連続平行線', documentModel => K.addEntity(documentModel, 'parallel', {
          points: result, text: `${Number(Math.abs(offsetM).toFixed(3))}m`, style: { color: '#9b4c8d', lineStyle: 'dashed' },
          options: { distanceM: offsetM, baseDistanceM, repeatIndex, parallelSign: sign }
        }))
        session.form.parallelCount = repeatIndex
        setStatus(`${Number(Math.abs(offsetM).toFixed(3))}mの平行線を作成。基準線は保持しています`, 2200)
        renderCommandSurface()
        render()
        return true
      }
    } catch (error) {
      setStatus(error?.message || '操作を完了できませんでした', 2600)
      render()
      return false
    }
    return false
  }

  function clipPolygonToHalfPlane(points, normal, offset) {
    const polygon = K.cleanPoints(points)
    if (polygon.length < 3) return []
    const tolerance = Math.max(K.EPS * 100, 1e-7)
    const result = []
    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index]
      const next = polygon[(index + 1) % polygon.length]
      const currentDistance = K.dot(current, normal) - offset
      const nextDistance = K.dot(next, normal) - offset
      const currentInside = currentDistance <= tolerance
      const nextInside = nextDistance <= tolerance
      if (currentInside) result.push(K.point(current))
      if (currentInside !== nextInside) {
        const denominator = currentDistance - nextDistance
        if (Math.abs(denominator) > K.EPS) {
          result.push(K.interpolate(current, next, K.clamp(currentDistance / denominator, 0, 1)))
        }
      }
    }
    return K.cleanPoints(result)
  }

  function equalAreaGuideOffset(points, normal, fraction, minOffset, maxOffset) {
    const totalArea = K.polygonArea(points)
    if (!(totalArea > K.EPS) || !(maxOffset - minOffset > K.EPS)) return null
    const targetArea = totalArea * K.clamp(fraction, 0, 1)
    let low = minOffset
    let high = maxOffset
    for (let iteration = 0; iteration < 64; iteration += 1) {
      const middle = (low + high) / 2
      const clipped = clipPolygonToHalfPlane(points, normal, middle)
      const clippedArea = clipped.length >= 3 ? K.polygonArea(clipped) : 0
      if (clippedArea < targetArea) low = middle
      else high = middle
    }
    return (low + high) / 2
  }

  function guideSegmentsInsidePolygon(points, direction, normal, offset) {
    const polygon = K.cleanPoints(points)
    if (polygon.length < 3) return []
    const tolerance = Math.max(K.EPS * 100, 1e-6)
    const alongValues = []
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index]
      const end = polygon[(index + 1) % polygon.length]
      const startDistance = K.dot(start, normal) - offset
      const endDistance = K.dot(end, normal) - offset
      if (Math.abs(startDistance) <= tolerance) alongValues.push(K.dot(start, direction))
      if ((startDistance < -tolerance && endDistance > tolerance) || (startDistance > tolerance && endDistance < -tolerance)) {
        const ratio = startDistance / (startDistance - endDistance)
        alongValues.push(K.dot(K.interpolate(start, end, ratio), direction))
      }
    }
    alongValues.sort((left, right) => left - right)
    const unique = alongValues.filter((value, index) => !index || Math.abs(value - alongValues[index - 1]) > tolerance)
    const result = []
    for (let index = 0; index + 1 < unique.length; index += 1) {
      const startAlong = unique[index]
      const endAlong = unique[index + 1]
      if (!(endAlong - startAlong > tolerance)) continue
      const midpoint = K.add(K.multiply(direction, (startAlong + endAlong) / 2), K.multiply(normal, offset))
      if (!K.pointInPolygon(midpoint, polygon, true)) continue
      const segment = [
        K.add(K.multiply(direction, startAlong), K.multiply(normal, offset)),
        K.add(K.multiply(direction, endAlong), K.multiply(normal, offset))
      ]
      const previous = result[result.length - 1]
      if (previous && K.distance(previous[1], segment[0]) <= tolerance) previous[1] = segment[1]
      else result.push(segment)
    }
    return result
  }

  function buildDivisionGuides(previewOnly) {
    const target = session.targetIds[0] ? K.objectById(store.document, session.targetIds[0])?.object : null
    const polygon = K.cleanPoints(target?.points)
    if (!target || polygon.length < 3 || session.points.length < 2) return []
    const count = K.clamp(Math.round(finite(session.form['division-count'], 2)), 2, 20)
    const direction = K.unit(K.subtract(session.points[1], session.points[0]))
    if (K.length(direction) < K.EPS) return []
    const normal = { x: -direction.y, y: direction.x }
    const projected = polygon.map(point => K.dot(point, normal))
    const minOffset = Math.min(...projected)
    const maxOffset = Math.max(...projected)
    const result = []
    for (let index = 1; index < count; index += 1) {
      const fraction = index / count
      const offset = equalAreaGuideOffset(polygon, normal, fraction, minOffset, maxOffset)
      if (!Number.isFinite(offset)) continue
      const segments = guideSegmentsInsidePolygon(polygon, direction, normal, offset)
      segments.forEach((segment, segmentIndex) => result.push({
        id: previewOnly ? `__guide-${index}-${segmentIndex}` : undefined,
        kind: 'guide', points: segment, text: segmentIndex === 0 ? `${index}/${count}` : '',
        style: { color: '#647783', lineStyle: 'dashed', lineWidth: 0.9 },
        options: {
          mode: 'lot-equal-area', targetId: target.id, divisionCount: count, divisionIndex: index,
          areaFraction: fraction, normalOffset: offset, segmentIndex, segmentCount: segments.length
        }
      }))
    }
    return result
  }

  function applyCalibration() {
    const realDistance = parseNumeric(session.form['calibration-distance'])
    if (session.points.length !== 2 || !(realDistance > 0)) { setStatus('2点と実距離を入力してください', 1800); return false }
    const pixelDistance = K.distance(session.points[0], session.points[1])
    if (!(pixelDistance > K.EPS)) { setStatus('異なる2点を指定してください', 1800); return false }
    const mpp = realDistance / pixelDistance
    const mapScale = mapScaleFromMpp(mpp)
    const pageNumber = Math.max(1, finite(store.document.background?.currentPage, 1))
    store.commit(`${pageNumber}ページの縮尺設定`, documentModel => {
      documentModel.calibration = {
        ...documentModel.calibration, mpp, mapScale,
        points: session.points.map(K.point), realDistanceM: realDistance
      }
    })
    return completeScaleFlow(mapScale
      ? `${pageNumber}ページの縮尺を設定しました（1:${Math.round(mapScale).toLocaleString('ja-JP')}）`
      : `${pageNumber}ページの縮尺を2点から設定しました`)
  }

  function backCurrentDraftPoint(message = '作図点を1点戻しました') {
    const removed = session.back()
    if (!removed) {
      setStatus('戻す作図点がありません', 1200)
      return false
    }
    if (session.command === 'parallel-guide') session.form.parallelCount = 0
    setStatus(message, 1200)
    renderCommandSurface()
    render()
    return true
  }

  function cancelCurrentStep() {
    if (session.points.length) {
      session.points = []
      session.step = 0
      if (session.command === 'parallel-guide') session.form.parallelCount = 0
      setStatus('未確定の作図を取り消しました', 1400)
      renderCommandSurface()
      render()
      return
    }
    if (session.targetIds.length || session.vertexIndex != null) {
      session.targetIds = []
      session.vertexIndex = null
      setObjectSelection([], { openEditor: false, renderControls: false })
      setStatus('対象選択を取り消しました', 1400)
      renderCommandSurface()
      render()
      return
    }
    if (session.command !== 'select') activateCommand('select')
    else {
      commitPendingEdit()
      setObjectSelection([], { openEditor: false })
      setStatus('選択を解除しました', 1000)
    }
  }

  function handleDoubleClick(event) {
    if (ui.workspace !== 'drawing' || !DOUBLE_CLICK_FINISH_COMMANDS.has(session.command)) return
    event.preventDefault()
    if (!canFinishCommand()) return
    // Some runtimes report both pointerdown events with detail=1. In that
    // fallback path the double-click endpoint was inserted twice.
    const count = session.points.length
    if (count >= 2 && K.distance(session.points[count - 1], session.points[count - 2]) <= 8 / runtime.view.zoom) session.back()
    finishCommand()
  }

  function handleContextMenu(event) {
    event.preventDefault()
    if (ui.workspace !== 'drawing') return
    dom.canvas.focus({ preventScroll: true })
    if (session.points.length) backCurrentDraftPoint('右クリックで作図点を1点戻しました')
    else cancelCurrentStep()
  }

  function handlePointerDown(event) {
    if (ui.workspace !== 'drawing') return
    if (event.button === 1 || runtime.spaceDown) {
      event.preventDefault()
      dom.canvas.setPointerCapture?.(event.pointerId)
      runtime.pan = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, view: { ...runtime.view } }
      return
    }
    if (event.button === 2) {
      event.preventDefault()
      dom.canvas.focus({ preventScroll: true })
      return
    }
    if (event.button !== 0) return
    event.preventDefault()
    // IME入力の確定直後に図面をクリックした場合も、表示中の入力値を
    // 必ず配置データへ同期してから配置処理へ進む。
    const activeField = document.activeElement?.closest?.('#command-controls [data-field]')
    if (activeField) handleCommandFieldInput(activeField, false)
    dom.canvas.focus({ preventScroll: true })
    if (event.detail >= 2 && DOUBLE_CLICK_FINISH_COMMANDS.has(session.command)) {
      if (canFinishCommand()) finishCommand()
      return
    }
    // The first click of a double-click can already complete and restart a
    // fixed two-point command. Ignore its second pointerdown so it does not
    // become the first point of the next operation.
    if (event.detail >= 2 && (TWO_POINT_AUTO_FINISH_COMMANDS.has(session.command) || session.command === 'division-guide')) return
    const value = pointFromPointer(event, pointerSnapRequested())
    runtime.pointerWorld = value.world
    runtime.pointerScreen = value.screen
    runtime.hoverSnap = value.snap
    handleCanvasPoint(value.world, value.screen, false, event)
    if (runtime.drag) {
      try { dom.canvas.setPointerCapture?.(event.pointerId) } catch (_) { /* pointer may already be released */ }
    }
  }

  function handlePointerMove(event) {
    if (ui.workspace !== 'drawing') return
    const rect = dom.canvas.getBoundingClientRect()
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    if (runtime.pan) {
      runtime.view = {
        x: runtime.pan.view.x + event.clientX - runtime.pan.startX,
        y: runtime.pan.view.y + event.clientY - runtime.pan.startY,
        zoom: runtime.pan.view.zoom
      }
      render()
      return
    }
    const freeWorld = renderer.screenToWorld(screen, runtime.view)
    const snapRequested = pointerSnapRequested()
    const hoverSnap = K.snapPoint(store.document, freeWorld, pointerSnapSettings(), 10 / runtime.view.zoom)
    const world = snapRequested ? hoverSnap.point : freeWorld
    runtime.pointerScreen = screen
    runtime.pointerWorld = world
    runtime.hover = hitAt(world)
    runtime.hoverSnap = snapRequested ? hoverSnap : null
    if (runtime.drag?.type === 'selection-direct' || runtime.drag?.type === 'vertex-direct') {
      const drag = runtime.drag
      const screenDistance = Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y)
      if (!drag.moved && screenDistance >= 4) {
        drag.moved = true
        setStatus(drag.type === 'vertex-direct' ? '頂点をドラッグして移動しています' : `${drag.originals.length}件をドラッグして移動しています`, 0)
      }
      if (drag.moved && drag.type === 'selection-direct') {
        drag.translation = snappedMoveTranslation(drag.originals, drag.start, freeWorld)
        runtime.hoverSnap = drag.translation.snap
        dom.canvas.dataset.cursor = 'move'
      } else if (drag.moved) {
        const snap = store.document.preferences.snap || {}
        const snapping = snap.vertex || snap.intersection || snap.edge || snap.grid
        const candidate = snapping
          ? K.snapPoint(store.document, freeWorld, { ...snap, excludeObjectIds: [drag.id] }, 10 / runtime.view.zoom)
          : { point: freeWorld, type: 'free' }
        drag.destination = K.point(candidate.point)
        runtime.hoverSnap = candidate.type === 'free' ? null : candidate
        dom.canvas.dataset.cursor = 'vertex'
      }
      render()
      return
    }
    const selectedDimensionLot = session.command === 'select' && ui.contextPage === 'object-dimension' && ui.selectedIds.length === 1 && currentObject()?.kind === 'lot'
    if (session.command === 'select' || session.command === 'label-edit') {
      const hoverLabelHit = renderer.hitLabel(screen)
      const hoverVertexHit = session.command === 'select' && !hoverLabelHit ? selectedVertexAt(freeWorld) : null
      dom.canvas.dataset.cursor = hoverVertexHit ? 'vertex' : hoverLabelHit || (runtime.hover?.id && ui.selectedIds.includes(String(runtime.hover.id))) ? 'move' : ''
    } else if (dom.canvas.dataset.cursor) {
      dom.canvas.dataset.cursor = ''
    }
    if (selectedDimensionLot) {
      const labelHit = renderer.hitLabel(screen)
      runtime.edgeHover = labelHit?.kind === 'shape-dimension' && labelHit.ownerId === ui.selectedIds[0] && Number.isInteger(labelHit.edgeIndex)
        ? { id: labelHit.ownerId, index: labelHit.edgeIndex }
        : selectedLotEdgeAt(freeWorld)
    } else if (session.command === 'edge-hide') {
      const labelHit = renderer.hitLabel(screen)
      const labelObject = labelHit?.ownerId ? K.objectById(store.document, labelHit.ownerId)?.object : null
      const edgeHit = hitAt(freeWorld)
      runtime.edgeHover = labelHit?.kind === 'shape-dimension' && labelObject?.kind === 'lot' && Number.isInteger(labelHit.edgeIndex)
        ? { id: labelHit.ownerId, index: labelHit.edgeIndex }
        : (edgeHit?.type === 'shape' && edgeHit.object?.kind === 'lot' && edgeHit.part === 'edge' ? { id: edgeHit.id, index: edgeHit.index } : null)
    } else runtime.edgeHover = null
    if (runtime.drag?.type === 'underlay') {
      const dx = world.x - runtime.drag.start.x
      const dy = world.y - runtime.drag.start.y
      const original = runtime.drag.original
      session.form['underlay-x'] = finite(original.x) + dx
      session.form['underlay-y'] = finite(original.y) + dy
      const previewDocument = deepClone(store.document)
      previewDocument.background.x = session.form['underlay-x']
      previewDocument.background.y = session.form['underlay-y']
      renderer.scheduleRender(previewDocument, runtime.view, makeOverlay(), { showVertices: true })
      updateStatus()
      return
    }
    if (runtime.drag?.type === 'label') {
      const original = runtime.drag.original
      if (original) {
        const dx = world.x - runtime.drag.start.x
        const dy = world.y - runtime.drag.start.y
        if (dx !== 0 || dy !== 0) runtime.drag.moved = true
        ui.editDraft = deepClone(original)
        if (runtime.drag.labelKind === 'shape-road-name') {
          const center = K.polygonCentroid(original.points || [])
          const base = original.road?.namePosition || original.labelPosition || center
          ui.editDraft.road = { ...(ui.editDraft.road || {}), namePosition: { x: base.x + dx, y: base.y + dy } }
          ui.editDraft.labelPosition = ui.editDraft.road.namePosition
        } else if (runtime.drag.labelKind === 'shape-road-width') {
          const center = K.polygonCentroid(original.points || [])
          const hasOffset = original.road?.widthLabelOffset && typeof original.road.widthLabelOffset === 'object'
          const base = original.road?.widthLabelPosition || {
            x: center.x + finite(original.road?.widthLabelOffset?.x),
            y: center.y + finite(original.road?.widthLabelOffset?.y, hasOffset ? 0 : 26)
          }
          ui.editDraft.road = { ...(ui.editDraft.road || {}), widthLabelPosition: { x: base.x + dx, y: base.y + dy }, widthLabelOffset: null }
        } else if (runtime.drag.labelKind === 'shape-label') {
          const center = K.polygonCentroid(original.points || [])
          const base = original.labelPosition || (Number.isFinite(original.labelStyle?.x) && Number.isFinite(original.labelStyle?.y) ? { x: original.labelStyle.x, y: original.labelStyle.y } : center)
          ui.editDraft.labelPosition = { x: base.x + dx, y: base.y + dy }
          ui.editDraft.labelStyle = { ...(ui.editDraft.labelStyle || {}), x: base.x + dx, y: base.y + dy }
        } else if (runtime.drag.labelKind === 'shape-area-label' || runtime.drag.labelKind === 'shape-tsubo-label') {
          const property = runtime.drag.labelKind === 'shape-tsubo-label' ? 'tsuboLabel' : 'areaLabel'
          const legacyProperty = property === 'tsuboLabel' ? 'tsuboLabelPosition' : 'areaLabelPosition'
          const base = original[property]?.position || original[legacyProperty] || runtime.drag.anchor || K.polygonCentroid(original.points || [])
          ui.editDraft[property] = { ...(ui.editDraft[property] || {}), position: { x: base.x + dx, y: base.y + dy } }
          ui.editDraft[legacyProperty] = ui.editDraft[property].position
        } else if (runtime.drag.labelKind === 'shape-dimension' && Number.isInteger(runtime.drag.edgeIndex)) {
          const edge = ui.editDraft.edges?.[runtime.drag.edgeIndex]
          const baseOffset = original.edges?.[runtime.drag.edgeIndex]?.labelOffset || { x: 0, y: 0 }
          if (edge) edge.labelOffset = { x: finite(baseOffset.x) + dx, y: finite(baseOffset.y) + dy }
        } else if (runtime.drag.labelKind === 'entity-segment' && Number.isInteger(runtime.drag.segmentIndex)) {
          const segment = ui.editDraft.segments?.[runtime.drag.segmentIndex]
          const baseOffset = original.segments?.[runtime.drag.segmentIndex]?.labelOffset || { x: 0, y: 0 }
          if (segment) segment.labelOffset = { x: finite(baseOffset.x) + dx, y: finite(baseOffset.y) + dy }
        } else {
          const anchor = original.position || original.labelPosition || original.points?.[original.points.length - 1] || { x: 0, y: 0 }
          ui.editDraft.position = { x: anchor.x + dx, y: anchor.y + dy }
          ui.editDraft.labelPosition = { x: anchor.x + dx, y: anchor.y + dy }
        }
      }
    }
    render()
  }

  function handlePointerUp(event) {
    if (runtime.pan && (event.pointerId === runtime.pan.pointerId || event.button === 1)) {
      runtime.pan = null
      try { dom.canvas.releasePointerCapture?.(event.pointerId) } catch (_) { /* capture may already be gone */ }
      render()
      return
    }
    if (runtime.drag?.type === 'selection-direct' || runtime.drag?.type === 'vertex-direct') {
      const drag = runtime.drag
      runtime.drag = null
      runtime.moveSnap = null
      runtime.hoverSnap = null
      try { dom.canvas.releasePointerCapture?.(event.pointerId) } catch (_) { /* capture may already be gone */ }
      if (event.type === 'pointercancel' || !drag.moved) {
        render()
        return
      }
      if (drag.type === 'selection-direct') {
        const dx = finite(drag.translation?.dx)
        const dy = finite(drag.translation?.dy)
        if (Math.hypot(dx, dy) > K.EPS) {
          store.commit('直接ドラッグ移動', documentModel => {
            for (const id of drag.ids) {
              const object = K.objectById(documentModel, id)?.object
              if (object) K.translateObject(object, dx, dy)
            }
          })
          setObjectSelection(drag.ids, { openEditor: true })
          setStatus(`${drag.ids.length}件を移動しました`, 1500)
        } else {
          setStatus('元の位置へ戻しました', 1200)
        }
      } else {
        let changed = false
        store.commit('頂点を直接編集', documentModel => { changed = K.updateObjectVertex(documentModel, drag.id, drag.index, drag.destination) })
        setObjectSelection([drag.id], { openEditor: true })
        setStatus(changed ? '頂点を移動しました' : '交差する形になるため頂点を移動できません', changed ? 1500 : 2200)
      }
      render()
      return
    }
    if (runtime.drag?.type === 'underlay') {
      const x = finite(session.form['underlay-x'], runtime.drag.original.x)
      const y = finite(session.form['underlay-y'], runtime.drag.original.y)
      store.commit('下絵移動', documentModel => { documentModel.background.x = x; documentModel.background.y = y })
      runtime.drag = null
      try { dom.canvas.releasePointerCapture?.(event.pointerId) } catch (_) { /* capture may already be gone */ }
      renderCommandSurface()
      render()
      return
    }
    if (runtime.drag?.type === 'label') {
      const id = runtime.drag.id
      const replacement = runtime.drag.moved && ui.editDraft ? deepClone(ui.editDraft) : null
      if (replacement) store.commit('文字位置移動', documentModel => {
        const found = K.objectById(documentModel, id)
        const index = found?.collection.findIndex(value => value.id === id) ?? -1
        if (found && index >= 0) found.collection[index] = replacement
      })
      runtime.drag = null
      try { dom.canvas.releasePointerCapture?.(event.pointerId) } catch (_) { /* capture may already be gone */ }
      const object = K.objectById(store.document, id)?.object
      ui.editOriginal = object ? deepClone(object) : null
      ui.editDraft = object ? deepClone(object) : null
      if (object) loadObjectForm(object)
      renderCommandSurface()
      render()
    }
  }

  function handleWheel(event) {
    if (ui.workspace !== 'drawing') return
    event.preventDefault()
    const rect = dom.canvas.getBoundingClientRect()
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    zoomAt(screen, Math.exp(-event.deltaY * 0.0015))
  }

  async function destroyBackgroundRuntime() {
    const previous = runtime.backgroundRuntime
    runtime.backgroundRuntime = null
    runtime.backgroundSource = null
    renderer.clearBackgroundSources()
    try { await previous?.destroy?.() } catch (_) { /* release best effort */ }
  }

  async function showUnderlayPage(pageNumber = store.document.background.currentPage || 1) {
    const background = store.document.background
    if (!runtime.backgroundRuntime || !background.type || typeof IO.renderUnderlayPage !== 'function') return false
    const count = Math.max(1, background.pages?.length || background.pageCount || runtime.backgroundRuntime.pageCount || 1)
    const nextPage = K.clamp(Math.round(finite(pageNumber, 1)), 1, count)
    const previousPage = Math.max(1, finite(background.currentPage, 1))
    setStatus(`下絵 ${nextPage}ページを描画中…`)
    try {
      // IO mutates currentPage and page dimensions while rendering. Delay those
      // changes until the requested PDF page completed successfully.
      const renderedBackground = { ...background }
      const result = await IO.renderUnderlayPage(runtime.backgroundRuntime, renderedBackground, nextPage, { scale: background.type === 'pdf' ? 4.2 : 1, maxPixels: 80_000_000 })
      if (result?.cancelled) return false
      runtime.backgroundSource = result?.canvas || null
      if (runtime.backgroundSource) renderer.setBackgroundSource(runtime.backgroundSource, 'default')
      store.commit('下絵ページ', documentModel => {
        K.setActivePage(documentModel, nextPage)
        if (renderedBackground.width > 0 && renderedBackground.height > 0) {
          documentModel.background.width = renderedBackground.width
          documentModel.background.height = renderedBackground.height
        }
      })
      // Selection, edit drafts and command points belong to the old page.
      let currentCommand = session.command
      cancelTransient(false)
      ui.selectedIds = []
      ui.registryIds.clear()
      if (!hasScale() && store.document.background?.type) {
        currentCommand = 'calibrate'
        if (nextPage !== previousPage) ui.scaleFlow = { reason: 'page-changed', returnCommand: null }
      }
      if (COMMAND[currentCommand]) {
        session.activate(currentCommand, defaultForm(currentCommand))
        session.category = COMMAND[currentCommand].category
      }
      renderCommandSurface()
      const pageScale = resolvedMapScale()
      const pageScaleLabel = Number.isFinite(pageScale) && pageScale > 0
        ? `1:${Math.round(pageScale).toLocaleString('ja-JP')}`
        : '2点校正済'
      setStatus(hasScale()
        ? `下絵 ${nextPage} / ${count}ページ　このページの縮尺 ${pageScaleLabel}`
        : `下絵 ${nextPage} / ${count}ページ　このページは縮尺未設定です。上部の候補または2点校正で設定してください`,
      hasScale() ? 1800 : 0)
      render()
      return true
    } catch (error) {
      setStatus(error?.message || '下絵を描画できませんでした', 2600)
      return false
    }
  }

  async function loadUnderlay(file, replace = false) {
    if (!file || typeof IO.loadUnderlayFile !== 'function') { setStatus('下絵読込機能を初期化できませんでした', 2200); return false }
    if (!replace && !(await confirmBeforeReplacingDocument('新しい下絵を開く'))) {
      setStatus('下絵の読み込みをキャンセルしました', 1600)
      return false
    }
    setStatus(`${file.name || '下絵'} を読み込み中…`)
    try {
      const previousTransform = replace ? deepClone(store.document.background) : null
      const loaded = await IO.loadUnderlayFile(file, { page: 1 })
      await destroyBackgroundRuntime()
      runtime.backgroundRuntime = loaded.runtime
      store.commit(replace ? '下絵差替' : '下絵読込', documentModel => {
        if (!replace) {
          const freshDocument = K.createDocument()
          for (const key of Object.keys(documentModel)) delete documentModel[key]
          Object.assign(documentModel, freshDocument)
        }
        const background = deepClone(loaded.background)
        if (replace && previousTransform) {
          for (const key of ['x', 'y', 'scale', 'rotation', 'opacity', 'visible', 'locked']) background[key] = previousTransform[key]
        }
        documentModel.background = background
        resetAllCalibrations(documentModel)
        K.setActivePage(documentModel, background.currentPage || 1)
      })
      if (!replace) {
        store.clearHistory()
        ui.selectedIds = []
        ui.registryIds.clear()
        ui.clipboard = []
      }
      ui.documentName = file.name || ui.documentName
      await showUnderlayPage(store.document.background.currentPage || 1)
      ui.scaleFlow = { reason: 'underlay-loaded', returnCommand: null }
      activateCommand('calibrate', { focusCanvas: false })
      setStatus(`${file.name || '下絵'} を読み込みました。現在のページの縮尺を候補から選ぶか、既知寸法の2点で設定してください`, 0)
      return true
    } catch (error) {
      setStatus(error?.message || '下絵を読み込めませんでした', 3000)
      return false
    }
  }

  async function hydrateBackground(background = store.document.background) {
    await destroyBackgroundRuntime()
    if (!background?.type || typeof IO.createUnderlayRuntime !== 'function') return
    try {
      runtime.backgroundRuntime = await IO.createUnderlayRuntime(background)
      await showUnderlayPage(background.currentPage || 1)
    } catch (error) {
      setStatus(`下絵の復元に失敗: ${error?.message || error}`, 3000)
    }
  }

  function serializeCurrentProject() {
    if (typeof IO.serializeProject === 'function') return IO.serializeProject(store.document, { view: runtime.view, name: ui.documentName, appVersion: K.APP_VERSION })
    return JSON.stringify({ format: 'kozu-measure', version: 5, appVersion: K.APP_VERSION, document: store.document, view: runtime.view, meta: { name: ui.documentName } }, null, 2)
  }

  async function saveProject(options = {}) {
    try {
      const contents = serializeCurrentProject()
      const fileName = safeFileName(ui.documentName.replace(/\.(pdf|png|jpe?g|webp)$/i, '') || 'kozu-project', '.kozu.json')
      if (options.forClose && typeof desktop.saveProjectBeforeClose === 'function') {
        const result = await desktop.saveProjectBeforeClose({ fileName, contents })
        if (result?.fileName) ui.documentName = result.fileName
      } else if (typeof desktop.saveProject === 'function') {
        const result = await desktop.saveProject({ fileName, contents })
        if (result?.canceled) { setStatus('編集データの保存をキャンセルしました', 1600); return false }
        if (result?.fileName) ui.documentName = result.fileName
      } else if (typeof IO.downloadProjectJson === 'function') {
        const result = IO.downloadProjectJson(store.document, fileName, { view: runtime.view, name: ui.documentName, appVersion: K.APP_VERSION })
        if (result?.fileName) ui.documentName = result.fileName
      } else {
        const blob = new Blob([contents], { type: 'application/json;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url; link.download = fileName; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      store.markSaved()
      setStatus('作業ファイルを保存しました', 1800)
      return true
    } catch (error) {
      setStatus(error?.message || '保存できませんでした', 3000)
      return false
    }
  }

  function configureUnsavedBar(mode = 'close', actionLabel = '') {
    const destructive = mode === 'replace'
    const message = $('[data-unsaved-message]', dom.closeBar)
    const cancel = $('[data-close-choice="cancel"]', dom.closeBar)
    const discard = $('[data-close-choice="discard"]', dom.closeBar)
    const save = $('[data-close-choice="save"]', dom.closeBar)
    if (message) message.textContent = destructive
      ? `未保存の変更があります。${actionLabel || '別の作業へ移る'}前に保存しますか？`
      : '未保存の変更があります。'
    if (cancel) cancel.textContent = destructive ? 'キャンセル' : '作業に戻る'
    if (discard) discard.textContent = destructive ? '保存せず続行' : '保存せず終了'
    if (save) save.textContent = destructive ? '保存して続行' : '保存して終了'
  }

  function confirmBeforeReplacingDocument(actionLabel) {
    if (!store.dirty || !documentHasWork()) return Promise.resolve(true)
    if (runtime.pendingDestructiveResolve) return Promise.resolve(false)
    runtime.pendingClose = false
    configureUnsavedBar('replace', actionLabel)
    dom.closeBar.hidden = false
    return new Promise(resolve => { runtime.pendingDestructiveResolve = resolve })
  }

  function resolveDestructiveChoice(result) {
    const resolve = runtime.pendingDestructiveResolve
    runtime.pendingDestructiveResolve = null
    dom.closeBar.hidden = true
    if (typeof resolve === 'function') resolve(Boolean(result))
  }

  async function openProjectFile(file) {
    if (!file) return false
    if (!(await confirmBeforeReplacingDocument('作業ファイルを開く'))) {
      setStatus('作業ファイルを開く操作をキャンセルしました', 1600)
      return false
    }
    try {
      setStatus(`${file.name} を開いています…`)
      const loaded = typeof IO.openProjectFile === 'function'
        ? await IO.openProjectFile(file, { hydrateBackground: true })
        : { document: K.normalizeDocument(JSON.parse(await file.text())), view: runtime.view, runtime: null }
      await destroyBackgroundRuntime()
      store.replace(loaded.document, { clean: true })
      runtime.view = loaded.view ? { ...runtime.view, ...loaded.view } : runtime.view
      runtime.backgroundRuntime = loaded.runtime || null
      ui.documentName = loaded.meta?.name || file.name || '無題'
      ui.selectedIds = []
      if (runtime.backgroundRuntime) await showUnderlayPage(store.document.background.currentPage || 1)
      activateCommand('select', { focusCanvas: false })
      store.markSaved()
      setStatus(loaded.migratedFrom ? `旧形式 v${loaded.migratedFrom} を新形式へ移行しました` : '作業ファイルを開きました', 2600)
      return true
    } catch (error) {
      setStatus(error?.message || '作業ファイルを開けませんでした', 3200)
      return false
    }
  }

  function formatArea(value) {
    return Number.isFinite(value) ? value.toFixed(2) : '—'
  }

  function registryObjects() {
    const active = page(store.document)
    if (!active) return []
    if (ui.registryTab === 'lots') return active.shapes.filter(shape => ['lot', 'road', 'water', 'cutout'].includes(shape.kind))
    if (ui.registryTab === 'measures') return active.entities.filter(entity => ['distance', 'polyline', 'area', 'dimension'].includes(entity.kind))
    if (ui.registryTab === 'notes') return active.entities.filter(entity => ['text', 'callout', 'line', 'arrow', 'north', 'house', 'parking'].includes(entity.kind))
    return active.entities.filter(entity => ['lot-table', 'guide', 'parallel'].includes(entity.kind))
  }

  function filteredRegistryObjects() {
    const search = String(byId('registry-search')?.value || '').trim().toLowerCase()
    const filter = byId('registry-filter')?.value || 'all'
    const sort = byId('registry-sort')?.value || 'number'
    const objects = registryObjects()
      .filter(object => filter === 'all' || object.kind === filter)
      .filter(object => !search || [object.number, object.topLabel, object.label, object.text, object.memo, object.kind].some(value => String(value ?? '').toLowerCase().includes(search)))
    objects.sort((a, b) => {
      if (sort === 'area') return K.polygonArea(b.points || []) - K.polygonArea(a.points || [])
      if (sort === 'name') return String(a.label || a.text || '').localeCompare(String(b.label || b.text || ''), 'ja')
      return finite(a.number, 999999) - finite(b.number, 999999)
    })
    return objects
  }

  function renderRegistry() {
    if (!dom.registryRows) return
    const documentModel = store.document
    const active = page(documentModel)
    const objects = filteredRegistryObjects()
    dom.registryRows.replaceChildren()
    if (!objects.length) {
      const row = document.createElement('tr')
      row.className = 'empty-row'
      const cell = document.createElement('td')
      cell.colSpan = 9
      cell.textContent = '該当する要素はありません'
      row.append(cell)
      dom.registryRows.append(row)
    } else {
      for (const object of objects) dom.registryRows.append(makeRegistryRow(object))
    }
    const lots = active?.shapes.filter(shape => shape.kind === 'lot').length || 0
    const roads = active?.shapes.filter(shape => shape.kind === 'road' || shape.kind === 'water').length || 0
    const notes = active?.entities.length || 0
    const priceTotal = K.registrySummary(documentModel).totals.price
    dom.registrySummary.textContent = `区画 ${lots}・道路/水路 ${roads}・要素 ${notes}・価格合計 ${Math.round(priceTotal).toLocaleString('ja-JP')}万円`
    $$('[data-registry-tab]').forEach(button => button.classList.toggle('active', button.dataset.registryTab === ui.registryTab))
    const checkAll = byId('registry-check-all')
    if (checkAll) {
      const ids = objects.map(object => object.id)
      checkAll.checked = ids.length > 0 && ids.every(id => ui.registryIds.has(id))
      checkAll.indeterminate = ids.some(id => ui.registryIds.has(id)) && !checkAll.checked
      checkAll.disabled = ids.length === 0
    }
    const selectedCount = [...ui.registryIds].filter(id => Boolean(K.objectById(documentModel, id)?.object)).length
    $$('[data-action="registry-focus"], [data-action="toggle-selected-visibility"], [data-action="delete-registry-selection"]').forEach(button => {
      button.disabled = selectedCount === 0
      button.title = selectedCount ? `${selectedCount}件に実行` : '一覧で対象を選択してください'
    })
    $$('[data-action="renumber-lots"]').forEach(button => {
      button.disabled = lots < 2
      button.title = lots < 2 ? '区画が2件以上あるときに使用できます' : '区画番号を1から振り直します'
    })
    $$('[data-action="place-area-table"]').forEach(button => {
      button.disabled = lots === 0
      button.title = lots ? '現在の区画を面積表として配置' : '先に区画を作成してください'
    })
  }

  function makeRegistryRow(object) {
    const row = document.createElement('tr')
    row.dataset.objectId = object.id
    row.classList.toggle('selected', ui.registryIds.has(object.id))
    const shape = ['lot', 'road', 'water', 'cutout'].includes(object.kind)
    const metrics = shape ? K.shapeMetrics(object, store.document.calibration.mpp) : K.entityMetrics(object, store.document.calibration.mpp)
    const kindName = { lot: '区画', road: '道路', water: '水路', cutout: '隅切り', distance: '距離', polyline: '折れ線', area: '面積', dimension: '寸法', text: '文字', callout: '引出線', line: '線', arrow: '矢印', north: '北', house: '家屋', parking: '駐車', 'lot-table': '面積表', guide: 'ガイド', parallel: '平行線' }[object.kind] || object.kind
    const cells = []
    const checkboxCell = document.createElement('td')
    checkboxCell.className = 'col-check'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'; checkbox.checked = ui.registryIds.has(object.id); checkbox.dataset.registrySelect = object.id
    checkboxCell.append(checkbox); cells.push(checkboxCell)
    const values = [object.number ?? '', kindName, [object.topLabel, object.label || object.text].filter(Boolean).join(' / '), formatArea(metrics.areaM2), formatArea(metrics.tsubo)]
    values.forEach(value => { const cell = document.createElement('td'); cell.textContent = String(value); cells.push(cell) })
    const priceCell = document.createElement('td')
    if (object.kind === 'lot') {
      const input = document.createElement('input')
      input.className = 'registry-inline-input'; input.inputMode = 'numeric'; input.value = object.price ?? ''; input.dataset.registryField = 'price'; input.dataset.objectId = object.id
      priceCell.append(input)
    } else priceCell.textContent = '—'
    cells.push(priceCell)
    const memoCell = document.createElement('td')
    const memo = document.createElement('input')
    memo.className = 'registry-inline-input'; memo.value = object.memo || ''; memo.dataset.registryField = 'memo'; memo.dataset.objectId = object.id
    memoCell.append(memo); cells.push(memoCell)
    const visibleCell = document.createElement('td')
    const visible = document.createElement('input')
    visible.type = 'checkbox'; visible.checked = object.visible !== false; visible.dataset.registryField = 'visible'; visible.dataset.objectId = object.id
    visibleCell.append(visible); cells.push(visibleCell)
    row.append(...cells)
    return row
  }

  function updateRegistryObject(id, field, value) {
    store.commit('台帳編集', documentModel => {
      const found = K.objectById(documentModel, id)
      if (!found) return
      if (field === 'price') found.object.price = parseNumeric(value, null)
      else if (field === 'memo') found.object.memo = String(value || '')
      else if (field === 'visible') found.object.visible = Boolean(value)
    })
    renderRegistry()
    render()
  }

  function focusRegistrySelection() {
    const ids = [...ui.registryIds]
    if (!ids.length) { setStatus('一覧で対象を選択してください', 1700); return }
    commitPendingEdit()
    const objects = ids.map(id => K.objectById(store.document, id)?.object).filter(Boolean)
    if (ui.workspace !== 'drawing') setWorkspace('drawing')
    if (session.command !== 'select') activateCommand('select', { focusCanvas: false })
    setObjectSelection(ids, { openEditor: true })
    const bounds = K.unionBounds(objects.map(object => K.boundsOfPoints([
      ...(object.points || []), object.position, object.tip, object.labelPosition
    ].filter(Boolean))).filter(Boolean))
    if (bounds) {
      const size = renderer.getSize()
      const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
      runtime.view = { x: size.width / 2 - center.x * runtime.view.zoom, y: size.height / 2 - center.y * runtime.view.zoom, zoom: runtime.view.zoom }
      render()
    }
    dom.canvas.focus({ preventScroll: true })
    setStatus(`${ids.length}件を図面中央に表示しました`, 1500)
  }

  function paperPixelSize(paper = store.document.paper, dpi = 96) {
    const millimeters = paper.size === 'A3' ? { short: 297, long: 420 } : { short: 210, long: 297 }
    const pixelsPerMillimeter = Math.max(1, finite(dpi, 96)) / 25.4
    const landscape = {
      width: Math.round(millimeters.long * pixelsPerMillimeter),
      height: Math.round(millimeters.short * pixelsPerMillimeter)
    }
    return paper.orientation === 'portrait' ? { width: landscape.height, height: landscape.width } : landscape
  }

  function syncPaperControls() {
    const paper = store.document.paper
    const values = {
      'paper-size': paper.size, 'paper-orientation': paper.orientation,
      'paper-frame-visible': paper.showFrame !== false, 'paper-underlay-visible': paper.includeUnderlay !== false,
      'paper-title': paper.title || '', 'paper-date': paper.date || '', 'paper-author': paper.author || '',
      'paper-note': paper.note || '', 'title-frame-visible': paper.showTitleFrame !== false
    }
    for (const [id, value] of Object.entries(values)) {
      const field = byId(id)
      if (!field) continue
      if (field.type === 'checkbox') field.checked = Boolean(value)
      else if (document.activeElement !== field) field.value = value ?? ''
    }
    const printScale = byId('paper-print-scale')
    const denominator = resolvedMapScale(store.document)
    if (printScale) printScale.textContent = denominator ? `1:${Math.round(denominator).toLocaleString('ja-JP')}` : '未設定'
  }

  function renderOutputCanvas(targetCanvas = dom.outputPreview, options = {}) {
    if (!targetCanvas) return null
    const documentModel = deepClone(store.document)
    const outputPaper = deepClone(documentModel.paper)
    const fullPaperSize = paperPixelSize(outputPaper)
    const size = options.size || fullPaperSize
    const outputScale = Math.min(size.width / fullPaperSize.width, size.height / fullPaperSize.height)
    const printZoom = outputPixelsPerWorldUnit(documentModel, 96)
    const view = {
      x: (size.width - fullPaperSize.width * outputScale) / 2,
      y: (size.height - fullPaperSize.height * outputScale) / 2,
      zoom: outputScale * printZoom
    }
    documentModel.background.visible = documentModel.paper.includeUnderlay !== false && documentModel.background.visible !== false
    // 出力用紙は固定座標で描き、図形だけを毎回用紙一杯へ拡大しない。
    // 枠は下の drawOutputFrame で製図用の線として一度だけ描く。
    documentModel.paper.enabled = false
    const result = renderer.renderToCanvas(documentModel, {
      canvas: targetCanvas, width: size.width, height: size.height, dpr: options.dpr || 1,
      view, includeBackground: true, includePaper: false, backgroundColor: '#ffffff', transparent: false
    })
    if (targetCanvas.style) {
      targetCanvas.style.width = `${Math.round(size.width)}px`
      targetCanvas.style.height = `${Math.round(size.height)}px`
    }
    drawOutputFrame(targetCanvas, outputPaper, documentModel.calibration, documentModel)
    return result
  }

  function drawOutputFrame(canvas, paper, calibration = {}, documentModel = store.document) {
    const context = canvas.getContext('2d')
    if (!context) return
    const width = canvas.width
    const height = canvas.height
    const fullPaperSize = paperPixelSize(paper)
    const outputScale = Math.min(width / fullPaperSize.width, height / fullPaperSize.height)
    const margin = Math.max(4, Math.round(15 * outputScale))
    const innerWidth = width - margin * 2
    const innerHeight = height - margin * 2
    context.save()
    context.strokeStyle = '#111827'
    context.fillStyle = '#111827'
    context.lineWidth = Math.max(1, 1.35 * outputScale)
    if (paper.showFrame !== false) context.strokeRect(margin, margin, innerWidth, innerHeight)
    const scaleDenominator = resolvedMapScale({ ...documentModel, calibration })
    const scaleText = scaleDenominator
      ? `縮尺 1:${Math.round(scaleDenominator).toLocaleString('ja-JP')}`
      : (Number(calibration.mpp) > 0 ? '縮尺 2点校正済' : '縮尺 未設定')
    if (paper.showFrame !== false && paper.showTitleFrame !== false && (paper.title || paper.date || paper.author || paper.note || scaleText)) {
      // 一般的な図面枠に合わせ、タイトル欄は右下の大箱ではなく下端の細い帯にする。
      const boxHeight = Math.max(22, Math.round(56 * outputScale))
      const x = margin
      const y = height - margin - boxHeight
      const x1 = x + innerWidth * 0.27
      const x2 = x + innerWidth * 0.41
      const x3 = x + innerWidth * 0.69
      const x4 = x + innerWidth * 0.84
      const endX = x + innerWidth
      const middleY = y + boxHeight / 2
      context.fillStyle = 'rgba(255,255,255,0.97)'
      context.fillRect(x, y, innerWidth, boxHeight)
      context.strokeStyle = '#111827'
      context.strokeRect(x, y, innerWidth, boxHeight)
      for (const dividerX of [x1, x2, x3, x4]) {
        context.beginPath(); context.moveTo(dividerX, y); context.lineTo(dividerX, y + boxHeight); context.stroke()
      }
      for (const [startX, finishX] of [[x, x2], [x3, endX]]) {
        context.beginPath(); context.moveTo(startX, middleY); context.lineTo(finishX, middleY); context.stroke()
      }

      const pad = Math.max(2, 4 * outputScale)
      const labelSize = Math.max(5, 6.5 * outputScale)
      const valueSize = Math.max(7, 9.5 * outputScale)
      const drawCell = (left, top, cellWidth, cellHeight, label, value, centered = false) => {
        context.textBaseline = 'top'
        context.textAlign = centered ? 'center' : 'left'
        context.fillStyle = '#4b5563'
        context.font = `500 ${labelSize}px "Yu Gothic UI", Meiryo, sans-serif`
        const textX = centered ? left + cellWidth / 2 : left + pad
        context.fillText(String(label || ''), textX, top + pad, Math.max(1, cellWidth - pad * 2))
        context.fillStyle = '#111827'
        context.font = `600 ${valueSize}px "Yu Gothic UI", Meiryo, sans-serif`
        context.fillText(String(value || ''), textX, top + cellHeight * 0.43, Math.max(1, cellWidth - pad * 2))
      }
      const note = String(paper.note || '').replace(/\s*\n\s*/g, ' / ')
      drawCell(x, y, x1 - x, boxHeight / 2, '備考', note)
      drawCell(x, middleY, x1 - x, boxHeight / 2, '図面種別', '区画図')
      drawCell(x1, y, x2 - x1, boxHeight / 2, '図番', '1')
      drawCell(x1, middleY, x2 - x1, boxHeight / 2, '用紙', `${paper.size || 'A4'} ${paper.orientation === 'portrait' ? '縦' : '横'}`)
      drawCell(x2, y, x3 - x2, boxHeight, '図名', paper.title || '区画図', true)
      drawCell(x3, y, x4 - x3, boxHeight / 2, '尺度', scaleText.replace(/^縮尺\s*/, ''))
      drawCell(x3, middleY, x4 - x3, boxHeight / 2, '年月日', paper.date || '')
      drawCell(x4, y, endX - x4, boxHeight / 2, '作成', paper.author || '')
      drawCell(x4, middleY, endX - x4, boxHeight / 2, '図面名', paper.title || '区画図')
    }
    context.restore()
  }

  async function refreshOutputPreview() {
    if (runtime.renderingOutput || !dom.outputPreview) return
    runtime.renderingOutput = true
    try {
      syncPaperControls()
      const container = dom.outputPreview.parentElement?.getBoundingClientRect()
      const paper = paperPixelSize()
      // A3を基準サイズとして表示するため、A4は縦横とも約70.7%になる。
      // 用紙を切り替えても同じ大きさにフィットしてしまう旧挙動を避ける。
      const a3Reference = store.document.paper.orientation === 'portrait'
        ? { width: 1123, height: 1587 }
        : { width: 1587, height: 1123 }
      const maxWidth = Math.max(260, Math.min((container?.width || 760) - 16, 980))
      const scale = Math.min(1, maxWidth / a3Reference.width, 620 / a3Reference.height)
      const previewDpr = Math.min(3, Math.max(PREVIEW_MIN_DPR, finite(window.devicePixelRatio, 1)))
      renderOutputCanvas(dom.outputPreview, { size: { width: Math.round(paper.width * scale), height: Math.round(paper.height * scale) }, dpr: previewDpr })
    } catch (error) {
      setStatus(error?.message || '出力プレビューを作成できませんでした', 2500)
    } finally { runtime.renderingOutput = false }
  }

  function createExportCanvas() {
    const size = paperPixelSize(store.document.paper, OUTPUT_DPI)
    const canvas = document.createElement('canvas')
    renderOutputCanvas(canvas, { size, dpr: 1 })
    return canvas
  }

  async function exportPng() {
    try {
      const canvas = createExportCanvas()
      const name = safeFileName((store.document.paper.title || '区画図'), '.png')
      let result = null
      if (typeof desktop.exportPng === 'function') {
        const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG画像を生成できません')), 'image/png'))
        result = await desktop.exportPng({ fileName: name, bytes: new Uint8Array(await blob.arrayBuffer()) })
        if (result?.canceled) { setStatus('PNG保存をキャンセルしました', 1600); return false }
      } else if (typeof IO.downloadCanvasPng === 'function') await IO.downloadCanvasPng(canvas, name)
      else {
        const link = document.createElement('a'); link.download = name; link.href = canvas.toDataURL('image/png'); link.click()
      }
      setStatus(`PNG画像を保存しました${result?.fileName ? `：${result.fileName}` : ''}`, 2400)
      return true
    } catch (error) { setStatus(error?.message || 'PNGを書き出せませんでした', 3000); return false }
  }

  async function printOrPdf(asPdf = false) {
    try {
      const canvas = createExportCanvas()
      const paper = store.document.paper
      const html = typeof IO.canvasToPrintHTML === 'function'
        ? IO.canvasToPrintHTML(canvas, { title: paper.title || '区画図', paperSize: paper.size, orientation: paper.orientation })
        : `<img src="${canvas.toDataURL('image/png')}">`
      const payload = {
        html, pageSize: paper.size, landscape: paper.orientation === 'landscape',
        fileName: safeFileName(paper.title || '区画図', '.pdf')
      }
      const method = asPdf ? desktop.exportPdf : desktop.printDrawing
      let result = null
      if (typeof method === 'function') result = await method.call(desktop, payload)
      else if (!asPdf && typeof IO.openPrintWindow === 'function') IO.openPrintWindow(canvas, { title: paper.title || '区画図', paperSize: paper.size, orientation: paper.orientation })
      else throw new Error(asPdf ? 'PDF出力機能を利用できません' : '印刷機能を利用できません')
      if (result?.canceled) {
        setStatus(asPdf ? 'PDF保存をキャンセルしました' : '印刷をキャンセルしました', 1600)
        return false
      }
      setStatus(asPdf ? `PDFを保存しました${result?.fileName ? `：${result.fileName}` : ''}` : '印刷画面を開きました', 2400)
      return true
    } catch (error) { setStatus(error?.message || (asPdf ? 'PDFを書き出せませんでした' : '印刷できませんでした'), 3000); return false }
  }

  function updatePaperFromControls() {
    const size = byId('paper-size')?.value || 'A4'
    const orientation = byId('paper-orientation')?.value || 'landscape'
    const includeUnderlay = byId('paper-underlay-visible')?.checked !== false
    ui.output.includeUnderlay = includeUnderlay
    ui.output.note = byId('paper-note')?.value || ''
    ui.output.showTitleFrame = byId('title-frame-visible')?.checked !== false
    store.commit('出力設定', documentModel => {
      documentModel.paper.enabled = true
      documentModel.paper.size = size
      documentModel.paper.orientation = orientation
      documentModel.paper.showFrame = byId('paper-frame-visible')?.checked !== false
      documentModel.paper.includeUnderlay = includeUnderlay
      documentModel.paper.showTitleFrame = ui.output.showTitleFrame
      documentModel.paper.title = byId('paper-title')?.value || ''
      documentModel.paper.date = byId('paper-date')?.value || ''
      documentModel.paper.author = byId('paper-author')?.value || ''
      documentModel.paper.note = ui.output.note
    })
    refreshOutputPreview()
  }

  function centerDrawingOnPaper() {
    const active = page(store.document)
    if (!active || !(active.shapes.length || active.entities.length)) { setStatus('中央へ移動する図形がありません', 1600); return }
    const bounds = K.documentBounds({ ...store.document, background: { ...store.document.background, visible: false }, paper: { ...store.document.paper, enabled: false } })
    if (!bounds) return
    const size = paperPixelSize()
    const printZoom = outputPixelsPerWorldUnit(store.document, 96)
    const dx = size.width / printZoom / 2 - (bounds.minX + bounds.maxX) / 2
    const dy = size.height / printZoom / 2 - (bounds.minY + bounds.maxY) / 2
    store.commit('用紙中央へ移動', documentModel => {
      const current = page(documentModel)
      ;[...current.shapes, ...current.entities].forEach(object => K.translateObject(object, dx, dy))
    })
    refreshOutputPreview()
    setStatus('図形を用紙中央へ移動しました', 1800)
  }

  function applyUnderlayTransform() {
    const scale = Math.max(0.01, finite(session.form['underlay-scale'], 100) / 100)
    const x = finite(session.form['underlay-x'])
    const y = finite(session.form['underlay-y'])
    const rotation = finite(session.form['underlay-angle'])
    store.commit('下絵調整', documentModel => {
      const previousScale = Math.max(0.0001, finite(documentModel.background?.scale, 1))
      Object.assign(documentModel.background, { scale, x, y, rotation })
      if (hasScale(documentModel) && Math.abs(scale - previousScale) > 0.000001) {
        const ratio = previousScale / scale
        documentModel.calibration = {
          ...documentModel.calibration,
          mpp: documentModel.calibration.mpp * ratio
        }
        for (const pageValue of documentModel.pages || []) {
          if (Number.isFinite(Number(pageValue.calibration?.mpp)) && Number(pageValue.calibration.mpp) > 0) {
            pageValue.calibration = { ...pageValue.calibration, mpp: pageValue.calibration.mpp * ratio }
          }
        }
      }
    })
    render()
  }

  function applyDisplaySettings(changedKey = null) {
    const changed = key => changedKey == null || changedKey === key
    store.commit('表示設定', documentModel => {
      if (changed('global-show-underlay')) documentModel.background.visible = Boolean(session.form['global-show-underlay'])
      for (const [field, property] of [['snap-grid', 'grid'], ['snap-vertex', 'vertex'], ['snap-intersection', 'intersection'], ['snap-edge', 'edge']]) {
        if (changed(field)) documentModel.preferences.snap[property] = Boolean(session.form[field])
      }
      for (const shape of page(documentModel).shapes) {
        shape.visibility = { ...(shape.visibility || {}) }
        if (changed('global-show-number')) shape.visibility.number = Boolean(session.form['global-show-number'])
        if (changed('global-show-area')) shape.visibility.area = Boolean(session.form['global-show-area'])
        if (changed('global-show-tsubo')) shape.visibility.tsubo = Boolean(session.form['global-show-tsubo'])
        if (shape.kind === 'lot' && changed('global-show-lengths')) shape.visibility.dimensions = Boolean(session.form['global-show-lengths'])
        if (shape.kind === 'lot') {
          if (changed('global-show-area')) shape.areaLabel = { ...(shape.areaLabel || {}), visible: shape.visibility.area }
          if (changed('global-show-tsubo')) shape.tsuboLabel = { ...(shape.tsuboLabel || {}), visible: shape.visibility.tsubo }
        }
      }
    })
    render()
  }

  function sizedStyle(style, size) {
    const resolved = K.clamp(finite(size, 14), 6, 48)
    return { ...(style || {}), size: resolved, fontSize: resolved, scale: 1 }
  }

  function typographyValuesFromForm() {
    return {
      lot: K.clamp(finite(session.form['typography-lot'], 14), 6, 48),
      metric: K.clamp(finite(session.form['typography-metric'], 12), 6, 48),
      dimension: K.clamp(finite(session.form['typography-dimension'], 10), 6, 48),
      road: K.clamp(finite(session.form['typography-road'], 14), 6, 48),
      text: K.clamp(finite(session.form['typography-text'], 14), 6, 48)
    }
  }

  function applyTypographySettings(applyExisting = false) {
    const values = typographyValuesFromForm()
    store.commit(applyExisting ? '文字サイズを図面全体へ反映' : '文字サイズの既定値を設定', documentModel => {
      documentModel.preferences.typography = { ...values }
      documentModel.preferences.lot.labelStyle = sizedStyle(documentModel.preferences.lot.labelStyle, values.lot)
      documentModel.preferences.lot.dimensionStyle = sizedStyle(documentModel.preferences.lot.dimensionStyle, values.dimension)
      for (const kind of ['road', 'water']) {
        documentModel.preferences[kind].labelStyle = sizedStyle(documentModel.preferences[kind].labelStyle, values.road)
        documentModel.preferences[kind].dimensionStyle = sizedStyle(documentModel.preferences[kind].dimensionStyle, values.dimension)
        documentModel.preferences[kind].widthLabelStyle = sizedStyle(documentModel.preferences[kind].widthLabelStyle, values.dimension)
      }
      documentModel.preferences.text = sizedStyle(documentModel.preferences.text, values.text)
      documentModel.preferences.measurement.dimensionStyle = sizedStyle(documentModel.preferences.measurement.dimensionStyle, values.dimension)
      if (!applyExisting) return
      for (const pageValue of documentModel.pages || []) {
        for (const shape of pageValue.shapes || []) {
          if (shape.kind === 'lot') {
            shape.labelStyle = sizedStyle(shape.labelStyle, values.lot)
            shape.areaLabel = { ...(shape.areaLabel || {}), style: sizedStyle(shape.areaLabel?.style, values.metric) }
            shape.tsuboLabel = { ...(shape.tsuboLabel || {}), style: sizedStyle(shape.tsuboLabel?.style, values.metric) }
            shape.dimensionStyle = sizedStyle(shape.dimensionStyle, values.dimension)
            for (const edge of shape.edges || []) edge.style = sizedStyle(edge.style, values.dimension)
          } else if (shape.kind === 'road' || shape.kind === 'water') {
            shape.labelStyle = sizedStyle(shape.labelStyle, values.road)
            shape.road = {
              ...(shape.road || {}),
              nameStyle: sizedStyle(shape.road?.nameStyle, values.road),
              widthLabelStyle: sizedStyle(shape.road?.widthLabelStyle, values.dimension)
            }
            shape.dimensionStyle = sizedStyle(shape.dimensionStyle, values.dimension)
          }
        }
        for (const entity of pageValue.entities || []) {
          if (['distance', 'polyline', 'area', 'dimension'].includes(entity.kind)) {
            entity.dimensionStyle = sizedStyle(entity.dimensionStyle, values.dimension)
            for (const segment of entity.segments || []) segment.style = sizedStyle(segment.style, values.dimension)
          }
          if (['text', 'callout', 'house', 'parking', 'north'].includes(entity.kind)) {
            entity.style = sizedStyle(entity.style, values.text)
            entity.textStyle = sizedStyle(entity.textStyle, values.text)
            entity.fontSize = values.text
          }
        }
      }
    })
    render()
    setStatus(applyExisting ? '文字サイズを現在の図面全体へ反映しました' : '新しく作る図形の文字サイズを設定しました', 2400)
  }

  function copySelection() {
    const ids = ui.selectedIds.length ? ui.selectedIds : session.targetIds
    ui.clipboard = ids.map(id => K.objectById(store.document, id)?.object).filter(Boolean).map(deepClone)
    ui.clipboardPasteCount = 0
    if (ui.clipboard.length) setStatus(`${ui.clipboard.length}件を複写用に記憶しました`, 1600)
    else setStatus('複写する対象を選択してください', 1600)
  }

  function pasteClipboard() {
    if (!ui.clipboard.length) { setStatus('複写用に記憶された図形がありません', 1600); return }
    commitPendingEdit()
    const cascade = (ui.clipboardPasteCount + 1) * 24 / runtime.view.zoom
    const created = []
    store.commit('貼り付け', documentModel => {
      for (const source of ui.clipboard) {
        const object = K.copyObjectToActivePage(documentModel, source, { x: cascade, y: cascade })
        if (object) created.push(object.id)
      }
    })
    ui.clipboardPasteCount += 1
    if (session.command !== 'select') activateCommand('select', { focusCanvas: false })
    setObjectSelection(created, { openEditor: true })
    setStatus(`${created.length}件を貼り付けました`, 1600)
  }

  function showShortcutHelp(pageKey = 'basic') {
    closeMenus()
    if (ui.workspace !== 'drawing') setWorkspace('drawing')
    const label = $('span', dom.commandName)
    if (label) label.textContent = 'ショートカット'
    dom.commandStep.innerHTML = '<small>JWW式</small><strong>キー一覧</strong>'
    dom.commandActions.replaceChildren()
    const pages = {
      basic: { name: '基本', items: [['B', '下絵'], ['C', '縮尺'], ['V', '選択'], ['X / ⇧X', '移動 / 全体移動'], ['Z', '頂点編集'], ['E', '文字・寸法'], ['F', '全体表示'], ['H', 'ヘルプ']] },
      process: { name: '作図・加工', items: [['P', '区画'], ['R', '道路'], ['S / ⇧S', '分割 / 一括'], ['G', '合筆'], ['K', '隅切り'], ['D', '均等ガイド'], ['Q', '平行線']] },
      measure: { name: '計測', items: [['M / ⇧M', '距離 / 折れ線'], ['A', '面積'], ['L', '線'], ['W', '矢印']] },
      note: { name: '注記', items: [['T', '文字'], ['O', '引出線'], ['N', '北'], ['U', '家屋'], ['I', '駐車'], ['Y', '面積表']] }
    }
    const activeKey = pages[pageKey] ? pageKey : 'basic'
    dom.commandPages.hidden = false
    dom.commandPages.replaceChildren()
    for (const [key, page] of Object.entries(pages)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'ctrl-tab'
      button.dataset.helpPage = key
      button.classList.toggle('active', key === activeKey)
      button.textContent = page.name
      dom.commandPages.append(button)
    }
    const items = pages[activeKey].items
    dom.commandControls.innerHTML = `<div class="shortcut-help-grid">${items.map(([key, name]) => `<span><kbd>${key}</kbd>${name}</span>`).join('')}</div>`
    setStatus('左クリック=作図（近くは自動吸着）、ダブルクリック/Enter=確定、右クリック/Backspace=1点戻す、Esc=取消', 9000)
  }

  async function handleAction(action, source) {
    switch (action) {
      case 'show-category-launcher': showLauncher(source?.closest('[data-category]')?.dataset.category || ui.category); break
      case 'finish-command': finishCommand(); break
      case 'cancel-command':
        if (!session.points.length && !session.targetIds.length && session.vertexIndex == null) {
          activateCommand('select', { focusCanvas: false })
          setStatus('選択へ戻りました', 1200)
        } else {
          if (session.command === 'parallel-guide') session.form.parallelCount = 0
          restartCommand(session.command, '操作を取り消しました')
        }
        break
      case 'pop-point': backCurrentDraftPoint(); break
      case 'undo': commitPendingEdit(); store.undo(); setObjectSelection([], { openEditor: false }); break
      case 'redo': commitPendingEdit(); store.redo(); setObjectSelection([], { openEditor: false }); break
      case 'fit': fitView(); break
      case 'actual-size': actualSize(); break
      case 'open-underlay': dom.underlayInput?.click(); break
      case 'replace-underlay': dom.replaceInput?.click(); break
      case 'open-project': dom.projectInput?.click(); break
      case 'save-project': await saveProject(); break
      case 'new-project':
        if (!(await confirmBeforeReplacingDocument('新規作成'))) {
          setStatus('新規作成をキャンセルしました', 1600)
          break
        }
        await destroyBackgroundRuntime()
        store.replace(K.createDocument(), { clean: true })
        runtime.view = { x: 36, y: 32, zoom: 1 }
        ui.documentName = '無題'; ui.selectedIds = []; activateCommand('underlay-open', { focusCanvas: false }); setStatus('新しい図面を作成しました', 1600)
        break
      case 'clear-document':
        store.commit('全図形削除', documentModel => { const active = page(documentModel); active.shapes = []; active.entities = [] })
        ui.selectedIds = []; render(); setStatus('図形をすべて削除しました（戻るで復元できます）', 2000); break
      case 'toggle-underlay': store.commit('下絵表示切替', documentModel => { documentModel.background.visible = !documentModel.background.visible }); render(); break
      case 'remove-underlay':
        await destroyBackgroundRuntime(); store.commit('下絵削除', documentModel => {
          documentModel.background = K.createDocument().background
          resetAllCalibrations(documentModel)
        }); renderCommandSurface(); render(); setStatus('下絵を削除しました', 1500); break
      case 'previous-page': await showUnderlayPage(finite(store.document.background.currentPage, 1) - 1); break
      case 'next-page': await showUnderlayPage(finite(store.document.background.currentPage, 1) + 1); break
      case 'underlay-opacity-down': store.commit('下絵濃さ', documentModel => { documentModel.background.opacity = K.clamp(finite(documentModel.background.opacity, 1) - 0.08, 0.08, 1) }); render(); break
      case 'underlay-opacity-up': store.commit('下絵濃さ', documentModel => { documentModel.background.opacity = K.clamp(finite(documentModel.background.opacity, 1) + 0.08, 0.08, 1) }); render(); break
      case 'toggle-underlay-lock': store.commit('下絵ロック', documentModel => { documentModel.background.locked = !documentModel.background.locked }); renderCommandSurface(); render(); break
      case 'rotate-underlay-90': {
        if (store.document.background.type !== 'image' || typeof IO.rotateImage90 !== 'function') {
          setStatus('90度回転は画像下絵で使えます', 1800)
          break
        }
        store.commit('画像を90度回転', documentModel => { documentModel.background = IO.rotateImage90(documentModel.background, 1) })
        await showUnderlayPage(1)
        renderCommandSurface()
        render()
        setStatus(`画像を${store.document.background.imageRotation}°に回転しました`, 1800)
        break
      }
      case 'reset-underlay-transform':
        Object.assign(session.form, { 'underlay-scale': 100, 'underlay-x': 0, 'underlay-y': 0, 'underlay-angle': 0 }); applyUnderlayTransform(); renderCommandSurface(); break
      case 'apply-calibration': applyCalibration(); break
      case 'reset-calibration-points':
        session.points = []
        session.step = 0
        runtime.hoverSnap = null
        renderCommandSurface()
        render()
        dom.canvas.focus({ preventScroll: true })
        setStatus('縮尺の始点を指定してください', 1600)
        break
      case 'apply-manual-scale': {
        const scale = parseNumeric(session.form['manual-scale'])
        if (!(scale > 0)) { setStatus('縮尺の分母を入力してください', 1800); break }
        const mpp = mppFromMapScale(scale)
        if (!(mpp > 0)) { setStatus('画像のDPIが不明です。既知の2点から縮尺を設定してください', 2400); break }
        const pageNumber = Math.max(1, finite(store.document.background?.currentPage, 1))
        store.commit(`${pageNumber}ページの縮尺設定`, documentModel => { documentModel.calibration = { ...documentModel.calibration, mpp, mapScale: scale, points: null, realDistanceM: null } })
        completeScaleFlow(`${pageNumber}ページの縮尺を 1:${Math.round(scale).toLocaleString('ja-JP')} に設定しました`); break
      }
      case 'apply-legacy-approx': {
        const scope = source?.dataset.approxScope === 'part' ? 'part' : 'global'
        const enable = !legacyApproxIsActive(scope)
        const values = scope === 'part'
          ? { 'part-approximate': enable, 'part-decimals': enable ? 1 : 2, 'part-rounding': enable ? 'floor' : 'round', 'part-adjustment': enable ? -0.1 : 0 }
          : { approximate: enable, 'dimension-approximate': enable, 'dimension-decimals': enable ? 1 : 2, 'dimension-rounding': enable ? 'floor' : 'round', 'dimension-adjustment': enable ? -0.1 : 0 }
        Object.entries(values).forEach(([key, value]) => {
          if (key in session.form) {
            session.form[key] = value
            if (ui.editDraft || ui.batchDrafts.length) ui.batchTouched.add(key)
          }
        })
        if (ui.batchDrafts.length) applyBatchFormToDrafts()
        else if (ui.editDraft) applyEditFormToDraft()
        initializeFieldControls()
        syncControlState()
        render()
        if (ui.editDraft || ui.batchDrafts.length) commitPendingEdit()
        setStatus(enable ? '約表示をON：-0.1m補正・小数1桁・切捨て' : '約表示を解除：補正なし・小数2桁・四捨五入', 2200)
        break
      }
      case 'toggle-snap':
        store.commit('吸着切替', documentModel => {
          const snap = documentModel.preferences.snap
          const enabled = !(snap.grid || snap.vertex || snap.intersection || snap.edge)
          Object.assign(snap, { grid: enabled, vertex: enabled, intersection: enabled, edge: enabled })
        }); render(); break
      case 'reset-command-defaults':
        store.commit('作図既定値初期化', documentModel => { documentModel.preferences = K.createDocument().preferences })
        activateCommand(session.command, { focusCanvas: false })
        setStatus('この図面の作図既定値を標準へ戻しました。表示中の設定にも反映しました', 2200)
        break
      case 'save-typography-defaults': applyTypographySettings(false); break
      case 'apply-typography-existing': applyTypographySettings(true); break
      case 'flip-parallel':
        session.form.parallelSign = -finite(session.form.parallelSign, 1)
        session.form.parallelCount = 0
        renderCommandSurface()
        render()
        setStatus('作成方向を反転しました', 1600)
        break
      case 'reset-parallel-baseline':
        session.points = []
        session.step = 0
        session.form.parallelCount = 0
        runtime.moveSnap = null
        renderCommandSurface()
        render()
        setStatus('平行線の新しい基準線を2点で指定してください', 1800)
        break
      case 'save-edit': saveObjectEdit(); break
      case 'cancel-edit': cancelObjectEdit(); break
      case 'move-selected': moveSelectedObject(); break
      case 'copy-place-selected': {
        const ids = [...ui.selectedIds]
        if (!ids.length) { setStatus('複写する対象を選択してください', 1600); break }
        commitPendingEdit()
        activateCommand('copy', { focusCanvas: false })
        session.targetIds = ids
        ui.selectedIds = ids
        session.points = []
        renderCommandSurface()
        render()
        setStatus('複写の基準点をクリックしてください', 0)
        break
      }
      case 'copy-selection': commitPendingEdit(); copySelection(); syncControlState(); break
      case 'clear-selection':
        commitPendingEdit()
        setObjectSelection([], { openEditor: false })
        setStatus('選択を解除しました', 1000)
        break
      case 'reset-dimension-part-position': {
        const object = ui.editDraft
        const part = Number.isInteger(ui.editEdgeIndex)
          ? object?.edges?.[ui.editEdgeIndex]
          : (Number.isInteger(ui.editSegmentIndex) ? object?.segments?.[ui.editSegmentIndex] : null)
        if (!object || !part) { setStatus('位置を戻す辺寸法を選んでください', 1600); break }
        applyEditFormToDraft()
        part.labelOffset = { x: 0, y: 0 }
        session.form['part-offset-x'] = 0
        session.form['part-offset-y'] = 0
        ui.batchTouched.add('__dimension-part-position')
        commitPendingEdit()
        initializeFieldControls()
        render()
        setStatus(Number.isInteger(ui.editSegmentIndex) ? '区間寸法を線の上側へ戻しました' : '辺寸法の位置を自動位置へ戻しました', 1500)
        break
      }
      case 'edit-vertices': activateCommand('vertex-edit'); break
      case 'delete-selected': {
        const ids = [...ui.selectedIds]
        commitPendingEdit()
        if (ids.length) store.commit('削除', documentModel => K.removeObjects(documentModel, ids))
        setObjectSelection([], { openEditor: false }); break
      }
      case 'center-label':
        if (ui.editDraft || ui.batchDrafts.length) {
          const drafts = ui.batchDrafts.length ? ui.batchDrafts : [ui.editDraft]
          drafts.forEach(draft => {
            draft.labelPosition = null
            if (draft.road) {
              draft.road.namePosition = null
              draft.road.widthLabelPosition = null
              draft.road.widthLabelOffset = null
            }
            if (draft.labelStyle) { delete draft.labelStyle.x; delete draft.labelStyle.y; delete draft.labelStyle.offsetX; delete draft.labelStyle.offsetY }
          })
          ui.batchTouched.add('__label-position')
          commitPendingEdit()
          render()
          const measurementLabels = drafts.every(draft => ['distance', 'polyline', 'dimension'].includes(draft.kind))
          setStatus(measurementLabels
            ? (drafts.length > 1 ? `${drafts.length}件の寸法を自動位置へ戻しました` : '寸法を線の上側の自動位置へ戻しました')
            : (drafts.length > 1 ? `${drafts.length}件の文字位置を中央へ戻しました` : '文字位置を中央へ戻しました'), 1400)
        }
        break
      case 'reset-value-label-position':
        if (ui.editDraft) {
          applyEditFormToDraft()
          const property = ui.valueLabelPanel === 'tsubo' ? 'tsuboLabel' : 'areaLabel'
          const legacyProperty = property === 'tsuboLabel' ? 'tsuboLabelPosition' : 'areaLabelPosition'
          ui.editDraft[property] = { ...(ui.editDraft[property] || {}), position: null }
          ui.editDraft[legacyProperty] = null
          ui.batchTouched.add('__value-label-position')
          commitPendingEdit()
          render()
          setStatus('表示位置を自動へ戻しました', 1400)
        }
        break
      case 'clear-guides': {
        const ids = page(store.document)?.entities.filter(entity => entity.kind === 'guide' || entity.kind === 'parallel').map(entity => entity.id) || []
        if (!ids.length) { setStatus('消去する補助線はありません', 1500); break }
        store.commit('補助線全消去', documentModel => K.removeObjects(documentModel, ids))
        setStatus(`${ids.length}本の補助線を消去しました（元に戻せます）`, 2200)
        renderRegistry()
        render()
        break
      }
      case 'open-registry-record':
        if (ui.selectedIds[0]) ui.registryIds = new Set([ui.selectedIds[0]])
        renderRegistry()
        byId('registry-search')?.focus({ preventScroll: true })
        break
      case 'paste': pasteClipboard(); break
      case 'renumber-lots': store.commit('区画番号整理', documentModel => K.renumberLots(documentModel)); renderRegistry(); render(); break
      case 'toggle-selected-visibility':
        store.commit('表示切替', documentModel => [...ui.registryIds].forEach(id => { const found = K.objectById(documentModel, id); if (found) found.object.visible = found.object.visible === false }))
        renderRegistry(); render(); break
      case 'delete-registry-selection':
        if (ui.registryIds.size) store.commit('一覧選択削除', documentModel => K.removeObjects(documentModel, [...ui.registryIds]))
        ui.registryIds.clear(); renderRegistry(); render(); break
      case 'registry-focus': focusRegistrySelection(); break
      case 'place-area-table': setWorkspace('drawing'); activateCommand('lot-table'); break
      case 'refresh-output-preview': await refreshOutputPreview(); break
      case 'center-drawing-on-paper': centerDrawingOnPaper(); break
      case 'set-today': if (byId('paper-date')) byId('paper-date').value = new Date().toISOString().slice(0, 10); updatePaperFromControls(); break
      case 'export-png': await exportPng(); break
      case 'export-pdf': await printOrPdf(true); break
      case 'print': await printOrPdf(false); break
      case 'show-help': showShortcutHelp(); break
      default:
        break
    }
  }

  function fieldValue(field) {
    if (field.type === 'checkbox') return field.checked
    return field.value
  }

  function handleCommandFieldInput(field, commit = false) {
    const key = field.dataset.field
    if (!key) return
    session.form[key] = fieldValue(field)
    if (key === 'scale-preset') {
      const preset = parseNumeric(session.form[key])
      if (preset > 0) {
        session.form['manual-scale'] = String(preset)
        const manualField = $('[data-field="manual-scale"]', dom.commandControls)
        if (manualField) manualField.value = session.form['manual-scale']
      }
    } else if (key === 'manual-scale') {
      const manual = parseNumeric(session.form[key])
      session.form['scale-preset'] = DRAWING_SCALE_PRESETS.has(manual) ? String(manual) : ''
      const presetField = $('[data-field="scale-preset"]', dom.commandControls)
      if (presetField) presetField.value = session.form['scale-preset']
    }
    if (key === 'area-label-text' || key === 'tsubo-label-text') {
      const normalized = commit
        ? normalizeMetricLabelText(session.form[key], key === 'area-label-text' ? '㎡' : '坪')
        : toHalfWidthText(session.form[key])
      session.form[key] = normalized
      if (field.value !== normalized) field.value = normalized
    }
    const editingObjects = Boolean(ui.editDraft || ui.batchDrafts.length)
    if (editingObjects) ui.batchTouched.add(key)
    if (key === 'parallel-distance') session.form.parallelCount = 0
    if (key === 'show-area') { session.form['area-label-visible'] = Boolean(session.form[key]); if (editingObjects) ui.batchTouched.add('area-label-visible') }
    if (key === 'area-label-visible') { session.form['show-area'] = Boolean(session.form[key]); if (editingObjects) ui.batchTouched.add('show-area') }
    if (key === 'show-tsubo') { session.form['tsubo-label-visible'] = Boolean(session.form[key]); if (editingObjects) ui.batchTouched.add('tsubo-label-visible') }
    if (key === 'tsubo-label-visible') { session.form['show-tsubo'] = Boolean(session.form[key]); if (editingObjects) ui.batchTouched.add('show-tsubo') }
    if (key === 'area-label-text') {
      const manualArea = String(session.form[key] ?? '').trim()
      if (!manualArea) {
        session.form['tsubo-label-text'] = ''
        if (editingObjects) ui.batchTouched.add('tsubo-label-text')
      } else {
        const squareMeters = numericTextValue(manualArea)
        if (squareMeters != null && squareMeters >= 0) {
          session.form['tsubo-label-text'] = `${(squareMeters / K.TSUBO_M2).toFixed(2)}坪`
          if (editingObjects) ui.batchTouched.add('tsubo-label-text')
        }
      }
    }
    const editingKind = ui.editDraft?.kind || selectedKind()
    if (key === 'textColor' && ['distance', 'polyline', 'area', 'dimension'].includes(editingKind)) { session.form.dimensionColor = session.form[key]; if (editingObjects) ui.batchTouched.add('dimensionColor') }
    if (key === 'dimensionColor' && ['distance', 'polyline', 'area', 'dimension'].includes(editingKind)) { session.form.textColor = session.form[key]; if (editingObjects) ui.batchTouched.add('textColor') }
    if (key === 'road-type') {
      const water = roadTypeCode(field.value) === 'water'
      const preference = store.document.preferences[water ? 'water' : 'road'] || {}
      const fallbackStyle = water ? K.DEFAULTS.waterStyle : K.DEFAULTS.roadStyle
      session.form['road-name'] = water ? (preference.name || '水路') : field.value
      session.form['road-width'] = finite(preference.widthM, water ? 0 : 4)
      session.form.fill = preference.style?.fill || fallbackStyle.fill
      session.form.stroke = preference.style?.stroke || fallbackStyle.stroke
      session.form['fill-opacity'] = Math.round(finite(preference.style?.opacity, fallbackStyle.opacity) * 100)
      const nameField = $('[data-field="road-name"]', dom.commandControls)
      const widthField = $('[data-field="road-width"]', dom.commandControls)
      if (nameField && document.activeElement !== nameField) nameField.value = session.form['road-name']
      if (widthField && document.activeElement !== widthField) widthField.value = session.form['road-width']
    }
    if (key === 'object-type' && ui.editDraft) {
      const kind = ['lot', 'road', 'water'].includes(field.value) ? field.value : ui.editDraft.kind
      const preference = store.document.preferences[kind] || {}
      const fallbackStyle = kind === 'water' ? K.DEFAULTS.waterStyle : kind === 'road' ? K.DEFAULTS.roadStyle : K.DEFAULTS.lotStyle
      session.form.fill = preference.style?.fill || fallbackStyle.fill
      session.form.stroke = preference.style?.stroke || fallbackStyle.stroke
      session.form['fill-opacity'] = Math.round(finite(preference.style?.opacity, fallbackStyle.opacity) * 100)
    }
    if (ui.batchDrafts.length) applyBatchFormToDrafts()
    else if (ui.editDraft) applyEditFormToDraft()
    if (commit && session.command === 'underlay-transform') applyUnderlayTransform()
    if (commit && session.command === 'display-settings') applyDisplaySettings(key)
    if (commit && editingObjects) {
      commitPendingEdit()
      setStatus(ui.batchDrafts.length ? `${ui.selectedIds.length}件へ反映しました` : '変更しました', 1100)
    }
    syncControlState()
    render()
  }

  function handleDocumentClick(event) {
    const scaleDialogChoice = event.target.closest('[data-scale-dialog-choice]')
    if (scaleDialogChoice) {
      event.preventDefault()
      const choice = scaleDialogChoice.dataset.scaleDialogChoice
      closeScaleRequiredDialog()
      if (choice === 'cancel') {
        ui.scaleFlow = { reason: null, returnCommand: null }
        activateCommand('select', { focusCanvas: false })
        setStatus('作図を開始しませんでした。縮尺は下絵の「ページ・縮尺」から設定できます', 2200)
      } else {
        requestAnimationFrame(() => {
          const target = $('[data-field="scale-preset"]', dom.commandControls) || $('[data-field="calibration-distance"]', dom.commandControls)
          target?.focus({ preventScroll: true })
        })
      }
      return
    }
    const colorChoice = event.target.closest('[data-color-choice]')
    if (colorChoice) {
      const picker = colorChoice.closest('.color-picker')
      const field = picker ? $(`select[data-field="${picker.dataset.colorField}"]`, dom.commandControls) : null
      if (field) {
        field.value = colorChoice.dataset.colorChoice
        handleCommandFieldInput(field, true)
        syncColorSelects()
      }
      if (picker) picker.querySelector('.color-picker-panel').hidden = true
      return
    }
    const colorToggle = event.target.closest('[data-color-picker-toggle]')
    if (colorToggle) {
      const picker = colorToggle.closest('.color-picker')
      const panel = picker?.querySelector('.color-picker-panel')
      $$('.color-picker-panel', dom.commandControls).forEach(value => { if (value !== panel) value.hidden = true })
      if (panel) panel.hidden = !panel.hidden
      return
    }
    $$('.color-picker-panel', dom.commandControls).forEach(panel => { panel.hidden = true })
    const typographyPresetButton = event.target.closest('[data-typography-preset]')
    if (typographyPresetButton) {
      const preset = TYPOGRAPHY_PRESETS[typographyPresetButton.dataset.typographyPreset]
      if (preset) {
        Object.assign(session.form, {
          'typography-lot': preset.lot,
          'typography-metric': preset.metric,
          'typography-dimension': preset.dimension,
          'typography-road': preset.road,
          'typography-text': preset.text
        })
        $$('[data-typography-preset]', dom.commandControls).forEach(button => button.classList.toggle('primary', button === typographyPresetButton))
        initializeFieldControls()
        setStatus(`${typographyPresetButton.textContent.trim()}の文字サイズを選びました。適用先を選んでください`, 1800)
      }
      return
    }
    const clickedToolbarDropdown = event.target.closest('details.toolbar-dropdown')
    $$('details.toolbar-dropdown[open]').forEach(dropdown => {
      if (dropdown !== clickedToolbarDropdown) dropdown.open = false
    })
    const menuButton = event.target.closest('[data-menu]')
    if (menuButton) {
      event.preventDefault()
      const popup = $(`[data-popup="${menuButton.dataset.menu}"]`)
      const willOpen = popup?.hidden !== false
      closeMenus()
      if (popup && willOpen) { popup.hidden = false; menuButton.classList.add('active') }
      return
    }

    const closeChoice = event.target.closest('[data-close-choice]')
    if (closeChoice) { handleCloseChoice(closeChoice.dataset.closeChoice); return }

    const categoryButton = event.target.closest('#category-rail [data-category]')
    if (categoryButton) {
      event.preventDefault()
      const category = categoryButton.dataset.category
      if (categoryButton.dataset.action === 'show-category-launcher') showLauncher(category)
      else requestUserCommand(categoryButton.dataset.command || category)
      return
    }

    const workspaceButton = event.target.closest('[data-workspace-target]')
    if (workspaceButton) { event.preventDefault(); setWorkspace(workspaceButton.dataset.workspaceTarget); return }

    const registryTab = event.target.closest('[data-registry-tab]')
    if (registryTab) {
      ui.registryTab = registryTab.dataset.registryTab
      const filter = byId('registry-filter')
      if (filter) filter.value = 'all'
      renderRegistry()
      return
    }

    const outputTab = event.target.closest('[data-output-tab]')
    if (outputTab) {
      ui.outputTab = outputTab.dataset.outputTab
      $$('[data-output-tab]').forEach(button => button.classList.toggle('active', button === outputTab))
      $$('[data-output-panel]').forEach(panel => { const active = panel.dataset.outputPanel === ui.outputTab; panel.hidden = !active; panel.classList.toggle('is-active', active) })
      if (ui.outputTab === 'paper') refreshOutputPreview()
      return
    }

    const helpPage = event.target.closest('[data-help-page]')
    if (helpPage) { event.preventDefault(); showShortcutHelp(helpPage.dataset.helpPage); return }

    const segmentPanel = event.target.closest('[data-segment-panel]')
    if (segmentPanel) { event.preventDefault(); ui.segmentPanel = segmentPanel.dataset.segmentPanel; renderCommandSurface(); return }

    const specialPanel = event.target.closest('[data-special-panel]')
    if (specialPanel) { event.preventDefault(); ui.specialPanel = specialPanel.dataset.specialPanel; renderCommandSurface(); return }

    const valueLabelPanel = event.target.closest('[data-value-label-panel]')
    if (valueLabelPanel) { event.preventDefault(); ui.valueLabelPanel = valueLabelPanel.dataset.valueLabelPanel; renderCommandSurface(); return }

    const contextPage = event.target.closest('[data-context-page]')
    if (contextPage) {
      ui.contextPage = contextPage.dataset.contextPage
      runtime.edgeHover = null
      renderCommandSurface()
      render()
      if (ui.selectedIds.length === 1 && ui.contextPage === 'object-dimension' && currentObject()?.kind === 'lot') {
        setStatus('「全辺共通 / 辺1…」から選ぶか、外周辺・寸法文字をクリックして個別調整できます', 2400)
      }
      return
    }

    const actionButton = event.target.closest('[data-action]')
    if (actionButton) { event.preventDefault(); closeMenus(); void handleAction(actionButton.dataset.action, actionButton); return }

    const commandButton = event.target.closest('[data-command]')
    if (commandButton) { event.preventDefault(); closeMenus(); requestUserCommand(commandButton.dataset.command); return }

    const registryRow = event.target.closest('#registry-rows tr[data-object-id]')
    if (registryRow && !event.target.matches('input,select,textarea,button')) {
      const id = registryRow.dataset.objectId
      commitPendingEdit()
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        if (ui.registryIds.has(id)) ui.registryIds.delete(id); else ui.registryIds.add(id)
      } else ui.registryIds = new Set([id])
      setObjectSelection([...ui.registryIds], { openEditor: true, syncRegistry: false })
      return
    }
    if (!event.target.closest('.menu-root')) closeMenus()
  }

  function handleDocumentInput(event) {
    const field = event.target.closest('#command-controls [data-field]')
    if (field) { handleCommandFieldInput(field, false); return }
    if (event.target.matches('#registry-search,#registry-filter,#registry-sort')) { renderRegistry(); return }
  }

  function handleDocumentChange(event) {
    const dimensionTarget = event.target.closest('#command-controls [data-dimension-target]')
    if (dimensionTarget) { selectDimensionTarget(dimensionTarget.value); return }
    const field = event.target.closest('#command-controls [data-field]')
    if (field) { handleCommandFieldInput(field, true); return }
    const registrySelect = event.target.closest('[data-registry-select]')
    if (registrySelect) {
      commitPendingEdit()
      if (registrySelect.checked) ui.registryIds.add(registrySelect.dataset.registrySelect)
      else ui.registryIds.delete(registrySelect.dataset.registrySelect)
      setObjectSelection([...ui.registryIds], { openEditor: true, syncRegistry: false }); return
    }
    const registryField = event.target.closest('[data-registry-field]')
    if (registryField) { updateRegistryObject(registryField.dataset.objectId, registryField.dataset.registryField, registryField.type === 'checkbox' ? registryField.checked : registryField.value); return }
    if (event.target.id === 'registry-check-all') {
      commitPendingEdit()
      const ids = filteredRegistryObjects().map(object => object.id)
      ids.forEach(id => event.target.checked ? ui.registryIds.add(id) : ui.registryIds.delete(id))
      setObjectSelection([...ui.registryIds], { openEditor: true, syncRegistry: false }); return
    }
    if (event.target.matches('#paper-size,#paper-orientation,#paper-frame-visible,#paper-underlay-visible,#paper-title,#paper-date,#paper-author,#paper-note,#title-frame-visible')) {
      updatePaperFromControls(); return
    }
  }

  function isTypingTarget(target) {
    return target && (target.matches?.('input,textarea,select,[contenteditable="true"]') || target.closest?.('[contenteditable="true"]'))
  }

  function handleKeyDown(event) {
    if (event.key === 'Process' || event.keyCode === 229) return
    const typing = isTypingTarget(event.target)
    const commandKey = event.ctrlKey || event.metaKey
    if (commandKey) {
      const key = event.key.toLowerCase()
      if (key === 's') { event.preventDefault(); void saveProject(); return }
      if (key === 'o') { event.preventDefault(); dom.underlayInput?.click(); return }
      if (key === 'n') { event.preventDefault(); void handleAction('new-project'); return }
      if (key === 'p') { event.preventDefault(); void printOrPdf(false); return }
      if (!typing && key === 'z' && !event.shiftKey) { event.preventDefault(); commitPendingEdit(); store.undo(); setObjectSelection([], { openEditor: false }); return }
      if (!typing && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); commitPendingEdit(); store.redo(); setObjectSelection([], { openEditor: false }); return }
      if (!typing && key === 'c') { event.preventDefault(); copySelection(); return }
      if (!typing && key === 'v') { event.preventDefault(); pasteClipboard(); return }
    }
    if (typing && event.key === 'Escape') {
      event.preventDefault()
      dom.canvas.focus({ preventScroll: true })
      closeMenus()
      return
    }
    if (event.repeat && !typing) return
    if (event.key === ' ') { if (!typing) { runtime.spaceDown = true; event.preventDefault() }; return }
    if (event.key === 'Enter') {
      if (runtime.composing || event.isComposing || Date.now() - runtime.compositionEndedAt < 90) return
      if (!typing || event.target.matches('[data-field="calibration-distance"],[data-field="manual-scale"]')) {
        event.preventDefault()
        if (event.target.matches('[data-field="manual-scale"]')) void handleAction('apply-manual-scale')
        else finishCommand()
      }
      return
    }
    if (event.key === 'Backspace' && !typing) { event.preventDefault(); backCurrentDraftPoint('Backspaceで作図点を1点戻しました'); return }
    if (event.key === 'Escape') { event.preventDefault(); cancelCurrentStep(); closeMenus(); return }
    if ((event.key === 'Delete' || event.key === 'Del') && !typing) {
      event.preventDefault()
      if (ui.selectedIds.length) {
        const ids = [...ui.selectedIds]
        commitPendingEdit()
        store.commit('削除', documentModel => K.removeObjects(documentModel, ids))
        setObjectSelection([], { openEditor: false })
      }
      else activateCommand('delete')
      return
    }
    if (typing || event.altKey || commandKey) return
    const key = event.key.toLowerCase()
    const shortcut = `${event.shiftKey ? 'Shift+' : ''}${key.toUpperCase()}`
    if (SHORTCUTS[shortcut]) { event.preventDefault(); requestUserCommand(SHORTCUTS[shortcut]) }
    else if (!event.shiftKey && key === 'f') { event.preventDefault(); fitView() }
    else if (!event.shiftKey && key === 'h') { event.preventDefault(); showShortcutHelp() }
  }

  function handleKeyUp(event) {
    if (event.key === ' ') runtime.spaceDown = false
  }

  function releaseTransientPointerState() {
    runtime.spaceDown = false
    runtime.pan = null
    runtime.drag = null
    runtime.fileDragDepth = 0
    dom.stage?.classList.remove('file-drag-active')
  }

  async function handlePaste(event) {
    if (isTypingTarget(event.target) || typeof IO.clipboardImageFromEvent !== 'function') return
    try {
      const file = await IO.clipboardImageFromEvent(event)
      if (file) { event.preventDefault(); await loadUnderlay(file, Boolean(store.document.background.type)) }
    } catch (_) { /* normal text clipboard is ignored */ }
  }

  function handleDragEnter(event) {
    event.preventDefault()
    runtime.fileDragDepth += 1
    dom.stage?.classList.add('file-drag-active')
  }

  function handleDragLeave(event) {
    event.preventDefault()
    runtime.fileDragDepth = Math.max(0, runtime.fileDragDepth - 1)
    if (runtime.fileDragDepth === 0) dom.stage?.classList.remove('file-drag-active')
  }

  async function handleDrop(event) {
    event.preventDefault()
    runtime.fileDragDepth = 0
    dom.stage?.classList.remove('file-drag-active')
    const file = event.dataTransfer?.files?.[0]
    if (!file) return
    if (/\.json$/i.test(file.name || '')) await openProjectFile(file)
    else await loadUnderlay(file, Boolean(store.document.background.type))
  }

  function handleCloseRequested() {
    if (!store.dirty) { desktop.respondClose?.('discard'); return }
    if (runtime.pendingDestructiveResolve) resolveDestructiveChoice(false)
    runtime.pendingClose = true
    configureUnsavedBar('close')
    dom.closeBar.hidden = false
  }

  async function handleCloseChoice(choice) {
    if (runtime.pendingDestructiveResolve) {
      if (choice === 'cancel') { resolveDestructiveChoice(false); return }
      if (choice === 'discard') { resolveDestructiveChoice(true); return }
      if (choice === 'save') {
        const success = await saveProject({ forClose: true })
        resolveDestructiveChoice(success)
      }
      return
    }
    if (choice === 'cancel') {
      runtime.pendingClose = false; dom.closeBar.hidden = true; desktop.respondClose?.('cancel'); return
    }
    if (choice === 'discard') {
      runtime.pendingClose = false; dom.closeBar.hidden = true; desktop.respondClose?.('discard'); return
    }
    if (choice === 'save') {
      dom.closeBar.hidden = true
      runtime.pendingClose = false
      if (typeof desktop.onSaveBeforeClose === 'function') desktop.respondClose?.('save')
      else {
        const success = await saveProject({ forClose: true })
        if (typeof desktop.notifySaveComplete === 'function') desktop.notifySaveComplete(success)
        else desktop.respondClose?.(success ? 'discard' : 'cancel')
      }
    }
  }

  async function saveBeforeClose() {
    const success = await saveProject({ forClose: true })
    desktop.notifySaveComplete?.(success)
  }

  function bindEvents() {
    document.addEventListener('click', handleDocumentClick)
    document.addEventListener('input', handleDocumentInput)
    document.addEventListener('change', handleDocumentChange)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)
    document.addEventListener('compositionstart', () => { runtime.composing = true }, true)
    document.addEventListener('compositionend', event => {
      runtime.composing = false
      runtime.compositionEndedAt = Date.now()
      const field = event.target?.closest?.('#command-controls [data-field]')
      if (field) handleCommandFieldInput(field, false)
    }, true)
    document.addEventListener('paste', event => { void handlePaste(event) })
    dom.scaleRequiredDialog?.addEventListener('cancel', event => {
      event.preventDefault()
      closeScaleRequiredDialog()
      ui.scaleFlow = { reason: null, returnCommand: null }
      activateCommand('select', { focusCanvas: false })
      setStatus('作図を開始しませんでした。縮尺は下絵の「ページ・縮尺」から設定できます', 2200)
    })
    dom.canvas.addEventListener('pointerdown', handlePointerDown)
    dom.canvas.addEventListener('pointermove', handlePointerMove)
    dom.canvas.addEventListener('pointerup', handlePointerUp)
    dom.canvas.addEventListener('pointercancel', handlePointerUp)
    dom.canvas.addEventListener('dblclick', handleDoubleClick)
    dom.canvas.addEventListener('contextmenu', handleContextMenu)
    dom.canvas.addEventListener('wheel', handleWheel, { passive: false })
    dom.stage.addEventListener('dragenter', handleDragEnter)
    dom.stage.addEventListener('dragleave', handleDragLeave)
    dom.stage.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' })
    dom.stage.addEventListener('drop', event => { void handleDrop(event) })
    dom.underlayInput?.addEventListener('change', async event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) await loadUnderlay(file, false) })
    dom.replaceInput?.addEventListener('change', async event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) await loadUnderlay(file, true) })
    dom.projectInput?.addEventListener('change', async event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) await openProjectFile(file) })
    runtime.resizeObserver = new ResizeObserver(() => resizeCanvas())
    runtime.resizeObserver.observe(dom.stage)
    window.addEventListener('resize', resizeCanvas)
    window.addEventListener('blur', releaseTransientPointerState)
    if (typeof desktop.onCloseRequested === 'function') desktop.onCloseRequested(handleCloseRequested)
    if (typeof desktop.onSaveBeforeClose === 'function') desktop.onSaveBeforeClose(() => { void saveBeforeClose() })
  }

  function init() {
    syncWorkspaceLabels()
    installRegistryDock()
    bindEvents()
    store.subscribe(() => {
      renderer.setDocument(store.document)
      updateStatus()
      renderRegistry()
      if (ui.workspace === 'output') refreshOutputPreview()
    })
    renderer.setBackgroundResolver(() => runtime.backgroundSource)
    session.activate('underlay-open', defaultForm('underlay-open'))
    session.category = 'underlay'
    ui.category = 'underlay'
    syncPaperControls()
    renderCommandSurface()
    setWorkspace('drawing')
    resizeCanvas()
    renderRegistry()
    render()
  }

  const debugApi = {
    get store() { return store },
    get document() { return store.document },
    get session() { return session },
    get ui() { return ui },
    get runtime() { return runtime },
    get view() { return { ...runtime.view } },
    renderer,
    activateCommand,
    selectObject,
    renderCommandSurface,
    showLauncher,
    setWorkspace,
    render,
    fitView,
    actualSize,
    finishCommand,
    showUnderlayPage,
    loadUnderlay,
    serialize: serializeCurrentProject,
    importProject: openProjectFile,
    saveProject,
    exportPng,
    printOrPdf,
    paperPixelSize,
    refreshOutputPreview,
    createExportCanvas,
    resolvedMapScale,
    outputPixelsPerWorldUnit,
    handleAction,
    confirmBeforeReplacingDocument,
    undo: () => { const result = store.undo(); render(); return result },
    redo: () => { const result = store.redo(); render(); return result },
    screenToWorld: value => renderer.screenToWorld(value, runtime.view),
    worldToScreen: value => renderer.worldToScreen(value, runtime.view),
    addPoint: value => { session.addPoint(value); render() },
    pointerDown: handlePointerDown,
    pointerMove: handlePointerMove,
    pointerUp: handlePointerUp,
    snapshot: () => ({ document: deepClone(store.document), session: deepClone({ category: session.category, command: session.command, step: session.step, points: session.points, targetIds: session.targetIds, form: session.form }), view: { ...runtime.view }, ui: { workspace: ui.workspace, category: ui.category, selectedIds: [...ui.selectedIds] } })
  }
  Object.defineProperty(window, '__KOZU_V210__', { value: debugApi, configurable: false, enumerable: false, writable: false })
  Object.defineProperty(window, '__KOZU_V210_TEST__', { value: debugApi, configurable: false, enumerable: false, writable: false })

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true })
  else init()
})()
