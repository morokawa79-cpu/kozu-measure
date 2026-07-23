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
  const AUTO_COMPLETE_COMMANDS = new Set(['distance', 'arrow', 'callout', 'text', 'north', 'house', 'parking', 'lot-table', 'division-guide'])
  const MANUAL_FINISH_COMMANDS = new Set([...DOUBLE_CLICK_FINISH_COMMANDS, 'merge'])
  const SCALE_REQUIRED_COMMANDS = new Set(['lot-draw', 'road-draw', 'distance', 'polyline', 'area', 'corner-cut', 'parallel-guide', 'house', 'parking'])
  const SELECTION_TARGET_COMMANDS = new Set(['move', 'copy', 'vertex-edit', 'split', 'merge', 'corner-cut', 'lot-division-guide'])
  const DRAWING_SCALE_PRESETS = new Set([5, 10, 20, 25, 30, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 1000])
  const CENTERABLE_LABEL_KINDS = new Set(['lot', 'road', 'water', 'cutout', 'distance', 'polyline', 'area', 'dimension', 'arrow', 'callout'])
  const OBJECT_EDITOR_ROUTES = Object.freeze({
    // 名称・幅員・面積・坪は、内容と書式を同じ「文字・数値」で扱う。
    // 表示ON/OFFは「表示」、辺ごとの上書きは「辺寸法」だけを正本にする。
    lot: Object.freeze([['object-basic', '基本'], ['object-appearance', '表示'], ['object-text', '文字・数値'], ['object-dimension', '辺寸法'], ['object-record', '台帳']]),
    road: Object.freeze([['object-basic', '基本'], ['object-appearance', '表示'], ['object-text', '文字・数値'], ['object-dimension', '辺寸法']]),
    water: Object.freeze([['object-basic', '基本'], ['object-appearance', '表示'], ['object-text', '文字・数値'], ['object-dimension', '辺寸法']]),
    cutout: Object.freeze([['object-basic', '隅切り情報'], ['object-special', '元へ戻す'], ['object-dimension', '寸法'], ['object-appearance', '表示'], ['object-text', '文字'], ['object-record', '台帳']]),
    distance: Object.freeze([['object-basic', '値・表示'], ['object-dimension', '寸法'], ['object-text', '文字・位置'], ['object-special', '線']]),
    polyline: Object.freeze([['object-basic', '合計・区間'], ['object-dimension', '寸法'], ['object-text', '文字・位置'], ['object-special', '線']]),
    area: Object.freeze([['object-basic', '面積・坪'], ['object-dimension', '辺寸法'], ['object-text', '文字・位置'], ['object-special', '線']]),
    dimension: Object.freeze([['object-basic', '値・表示'], ['object-dimension', '寸法'], ['object-text', '文字'], ['object-special', '線']]),
    line: Object.freeze([['object-special', '線']]),
    arrow: Object.freeze([['object-basic', '内容'], ['object-text', '文字・位置'], ['object-special', '線・矢印']]),
    text: Object.freeze([['object-basic', '内容'], ['object-text', '文字・配置']]),
    callout: Object.freeze([['object-basic', '内容'], ['object-text', '文字・位置'], ['object-special', '引出線']]),
    north: Object.freeze([['object-basic', '基本'], ['object-appearance', '表示'], ['object-text', '文字'], ['object-special', '大きさ・配置']]),
    house: Object.freeze([['object-basic', '基本'], ['object-appearance', '表示'], ['object-text', '文字'], ['object-special', '大きさ・寸法']]),
    parking: Object.freeze([['object-basic', '基本'], ['object-appearance', '表示'], ['object-text', '文字'], ['object-special', '大きさ・寸法']]),
    'lot-table': Object.freeze([['object-special', '面積表'], ['object-text', '文字']]),
    guide: Object.freeze([['object-special', '均等ガイド']]),
    parallel: Object.freeze([['object-special', '平行線']])
  })
  const CREATE_COMMAND_ROUTES = Object.freeze({
    'lot-draw': Object.freeze([['create-basic', '基本'], ['create-appearance', '表示'], ['create-text', '文字'], ['create-dimension', '辺寸法']]),
    'road-draw': Object.freeze([['create-basic', '基本'], ['create-appearance', '表示'], ['create-text', '文字'], ['create-dimension', '辺寸法']]),
    north: Object.freeze([['create-basic', '基本'], ['create-appearance', '表示'], ['create-text', '文字']]),
    house: Object.freeze([['create-basic', '基本'], ['create-appearance', '表示'], ['create-text', '文字']]),
    parking: Object.freeze([['create-basic', '基本'], ['create-appearance', '表示'], ['create-text', '文字']])
  })
  const SOFT_COLOR_OPTIONS = Object.freeze([
    ['#f4dfa1', '淡い黄'], ['#cfe5f5', '淡い青'], ['#d8edcf', '淡い緑'], ['#f6d3b2', '淡い橙'],
    ['#f2cbd2', '淡い赤'], ['#ddd3f2', '淡い紫'], ['#cce9df', '淡い青緑'], ['#e7edc5', '淡い黄緑'],
    ['#f6ddd0', '淡い桃'], ['#e8dccb', '淡い茶'], ['#f1f3f5', 'ごく薄い灰'], ['#edf2f8', '家屋'],
    ['#eef4fb', '駐車'], ['#e5e7eb', '隅切り'], ['#e3e5e8', '明るい灰'], ['#d8dde5', '薄灰'],
    ['#c3c9d1', '灰'], ['#adb5bd', '中灰'], ['#8d99a6', '濃灰'],
    ['#d6d3d1', '暖灰'], ['#cbd5e1', '青灰'], ['#bfe7f8', '水路青'], ['#ffffff', '白']
  ])
  const COLOR_OPTIONS = Object.freeze({
    ink: [['#172033', '濃紺'], ['#0f172a', '黒'], ['#334155', '灰'], ['#1d4ed8', '青'], ['#b4232d', '赤'], ['#08735c', '緑'], ['#7c3aed', '紫']],
    line: [['#253858', '濃紺'], ['#111827', '黒'], ['#1d4ed8', '青'], ['#b4232d', '赤'], ['#08735c', '緑'], ['#7c3aed', '紫'], ['#647783', 'ガイド'], ['#9b4c8d', '平行線']],
    dimension: [['#334155', '灰'], ['#172033', '濃紺'], ['#1d4ed8', '青'], ['#b4232d', '赤'], ['#08735c', '緑'], ['#7c3aed', '紫']],
    lot: SOFT_COLOR_OPTIONS,
    road: SOFT_COLOR_OPTIONS,
    fill: SOFT_COLOR_OPTIONS,
    border: [
      ['#987722', '黄土'], ['#427aa1', '青'], ['#477b52', '緑'], ['#b36b31', '橙'], ['#a34f5d', '赤'],
      ['#6b5a9a', '紫'], ['#2f7898', '水路'], ['#6b7280', '隅切り'], ['#8d99a6', '中灰'],
      ['#596579', '道路灰'], ['#3f4a59', '濃い道路灰'], ['#172033', '濃紺']
    ]
  })
  const CSS_UNITS_PER_METER = 96 / 0.0254
  const PDF_UNITS_PER_METER = 72 / 0.0254
  const OUTPUT_DPI = 300
  const PREVIEW_MIN_DPR = 2
  const OUTPUT_SCALE_PRESETS = Object.freeze([5, 10, 20, 25, 30, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 1000])
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
    'underlay-open': { category: 'underlay', name: '下絵', icon: 'i-underlay', template: 'controls-underlay', hint: '①下絵を開く　②ページを選ぶ　③そのページの縮尺を設定' },
    'underlay-replace': { category: 'underlay', name: '下絵差替', icon: 'i-replace', template: 'controls-underlay', hint: '現在の位置と倍率を保って下絵を差し替えます' },
    'underlay-page': { category: 'underlay', name: 'ページ', icon: 'i-page', template: 'controls-underlay', hint: 'PDFのページを切り替え、ページごとに縮尺を設定します' },
    'underlay-transform': { category: 'underlay', name: '下絵位置', icon: 'i-adjust', template: 'controls-underlay-adjust', hint: '数値入力またはドラッグで下絵を調整' },
    calibrate: { category: 'underlay', name: 'ページ・縮尺', icon: 'i-underlay', template: 'controls-underlay-calibrate', hint: '現在のページだけに縮尺を設定します。候補選択または2点校正を使用できます' },
    'paper-blank': { category: 'underlay', name: '下絵なし', icon: 'i-blank', template: 'controls-underlay', hint: '下絵なしの用紙へ切り替えます（作成済みの図形は保持します）' },

    select: { category: 'select', name: '選択', icon: 'i-select', hint: '図形を選択。文字・寸法も直接選べます' },
    move: { category: 'select', name: '移動', icon: 'i-move', hint: '対象を選び、移動先を指定' },
    'move-all': { category: 'select', name: '全体移動', icon: 'i-move-all', template: 'controls-move-all', hint: '移動対象を確認し、基準点と移動先を指定' },
    'vertex-edit': { category: 'select', name: '頂点編集', icon: 'i-vertex', hint: '頂点を選び、移動先を指定' },
    copy: { category: 'select', name: '複写', icon: 'i-copy', hint: '対象を選び、複写位置を指定' },
    delete: { category: 'select', name: '削除', icon: 'i-delete', hint: '削除する図形を選択' },

    'lot-draw': { category: 'parcel', name: '区画', icon: 'i-parcel', template: 'controls-parcel', hint: '頂点クリック　画面の確定ボタン／ダブルクリック／Enterで確定　右クリックで1点戻す' },
    'road-draw': { category: 'road', name: '道路・水路', icon: 'i-road', template: 'controls-road', hint: '外周クリック　画面の確定ボタン／ダブルクリック／Enterで確定' },

    split: { category: 'process', name: '選択分割', icon: 'i-split', template: 'controls-process', hint: '区画・道路・水路を選び、分割線を左クリック。画面の確定ボタン／ダブルクリック／Enterで確定' },
    'split-all': { category: 'process', name: '一括分割', icon: 'i-split-all', template: 'controls-process', hint: '対象種類を選び、横切る線を左クリック。画面の確定ボタン／ダブルクリック／Enterで確定' },
    merge: { category: 'process', name: '合筆', icon: 'i-merge', template: 'controls-process', hint: '同じ種類で辺を共有する図形を2つ以上選び、画面の「合筆」ボタンまたはEnterで確定。区画と隅切りは2つ選択' },
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
    'typography-settings': { category: 'select', name: '文字サイズ設定', icon: 'i-text', template: 'controls-typography-settings', hint: '反映先を選び、入力終了時に自動保存' }
  })

  const UI_COMMAND_ALIASES = Object.freeze({
    underlay: 'underlay-open',
    'underlay-replace': 'underlay-replace',
    'underlay-page': 'underlay-page',
    'underlay-adjust': 'underlay-transform',
    'blank-paper': 'paper-blank',
    calibrate: 'calibrate',
    select: 'select', move: 'move', 'move-all': 'move-all', vertex: 'vertex-edit', copy: 'copy', delete: 'delete',
    parcel: 'lot-draw', road: 'road-draw', split: 'split', 'split-all': 'split-all', merge: 'merge', 'corner-cut': 'corner-cut',
    'division-guide': 'division-guide', 'lot-division-guide': 'lot-division-guide', parallel: 'parallel-guide', 'edge-hide': 'edge-hide',
    distance: 'distance', polyline: 'polyline', area: 'area', line: 'line', arrow: 'arrow', text: 'text', callout: 'callout',
    'north-arrow': 'north', 'house-stamp': 'house', 'parking-stamp': 'parking', 'lot-table': 'lot-table', 'display-settings': 'display-settings',
    'typography-settings': 'typography-settings'
  })

  const SHORTCUTS = Object.freeze({
    B: 'underlay', V: 'select', P: 'lot-draw', R: 'road-draw',
    X: 'move', 'Shift+X': 'move-all', Z: 'vertex-edit',
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
    registryRows: byId('registry-rows'),
    registrySummary: byId('registry-summary'),
    registryAreaSummary: byId('registry-area-summary'),
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
    createPage: '',
    selectedIds: [],
    registryIds: new Set(),
    registryTab: 'lots',
    outputTab: 'paper',
    editDraft: null,
    editOriginal: null,
    batchDrafts: [],
    batchOriginals: [],
    batchTouched: new Set(),
    mixedFields: new Set(),
    editEdgeIndex: null,
    editSegmentIndex: null,
    segmentPanel: 'text',
    specialPanel: 'primary',
    textRole: 'name',
    clipboard: [],
    clipboardPasteCount: 0,
    statusOverride: '',
    statusTimer: 0,
    documentName: '無題',
    output: { includeUnderlay: true, note: '', showTitleFrame: true },
    workspaceSelection: [],
    workspaceContextPage: '',
    scaleFlow: { reason: null, returnCommand: null, returnTargetIds: [] }
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
    outputDrag: null,
    resizeObserver: null,
    renderingOutput: false,
    pendingClose: false,
    pendingDestructiveResolve: null,
    currentProjectPath: null,
    fileDragDepth: 0,
    compositionEndedAt: 0,
    inputTransaction: null,
    activeColorSelect: null,
    activeColorTrigger: null,
    backgroundTaskToken: 0,
    backgroundSyncRequest: 0,
    backgroundVisualState: null
  }

  const PAPER_INPUT_SELECTOR = '#paper-size,#paper-orientation,#paper-print-scale-preset,#paper-print-scale-custom,#paper-frame-visible,#paper-underlay-visible,#paper-guides-visible,#paper-title,#paper-date,#paper-author,#paper-note,#title-frame-visible'

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

  function fontToken(value) {
    return typeof K.normalizeFontToken === 'function' ? K.normalizeFontToken(value) : 'gothic'
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

  function normalizeColorSelectOptions(select) {
    if (!select || select.dataset.colorOptionsReady === 'true') return
    const palette = COLOR_OPTIONS[select.dataset.colorSelect] || COLOR_OPTIONS.ink
    const current = select.value
    select.replaceChildren(...palette.map(([value, name]) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = name
      return option
    }))
    if (current && ![...select.options].some(option => option.value === current)) {
      const option = document.createElement('option')
      option.value = current
      option.textContent = `現在の色 ${current}`
      select.prepend(option)
    }
    if (current) select.value = current
    select.dataset.colorOptionsReady = 'true'
  }

  function enhanceColorSelects() {
    $$('select[data-color-select]', dom.commandControls).forEach(select => {
      normalizeColorSelectOptions(select)
      if (select.closest('[data-color-control]')) return
      const control = document.createElement('span')
      control.className = 'color-control'
      control.dataset.colorControl = ''
      const trigger = document.createElement('button')
      trigger.type = 'button'
      trigger.className = 'color-trigger'
      trigger.dataset.colorTrigger = ''
      trigger.setAttribute('aria-haspopup', 'listbox')
      trigger.setAttribute('aria-expanded', 'false')
      trigger.innerHTML = '<span class="color-current-swatch" data-color-current aria-hidden="true"></span><span class="color-trigger-chevron" aria-hidden="true">⌄</span>'
      select.before(control)
      control.append(trigger, select)
      select.classList.add('color-select-source')
      select.tabIndex = -1
      select.setAttribute('aria-hidden', 'true')
    })
  }

  function ensureColorPalette() {
    let palette = document.querySelector('[data-color-palette]')
    if (palette) return palette
    palette = document.createElement('div')
    palette.className = 'color-palette'
    palette.dataset.colorPalette = ''
    palette.id = 'color-palette'
    palette.hidden = true
    palette.setAttribute('role', 'listbox')
    document.body.append(palette)
    return palette
  }

  function closeColorPalette(restoreFocus = false) {
    const palette = document.querySelector('[data-color-palette]')
    if (palette) palette.hidden = true
    $$('[data-color-trigger]').forEach(trigger => trigger.setAttribute('aria-expanded', 'false'))
    const trigger = runtime.activeColorTrigger
    runtime.activeColorSelect = null
    runtime.activeColorTrigger = null
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true })
  }

  function openColorPalette(select, trigger) {
    if (!select || !trigger) return
    const palette = ensureColorPalette()
    const wasOpen = !palette.hidden && runtime.activeColorSelect === select
    closeColorPalette()
    if (wasOpen) return
    runtime.activeColorSelect = select
    runtime.activeColorTrigger = trigger
    const values = []
    const seen = new Set()
    for (const option of select.options) {
      const value = String(option.value || '').trim()
      if (!value || seen.has(value)) continue
      seen.add(value)
      values.push({ value, name: option.textContent?.trim() || value })
    }
    palette.replaceChildren(...values.map(({ value, name }) => {
      const swatch = document.createElement('button')
      swatch.type = 'button'
      swatch.className = 'color-palette-swatch'
      swatch.dataset.colorSwatch = ''
      swatch.dataset.colorValue = value
      swatch.style.setProperty('--swatch-color', value)
      swatch.setAttribute('role', 'option')
      swatch.setAttribute('aria-label', `${name} ${value}`)
      swatch.setAttribute('aria-selected', String(value === select.value))
      swatch.title = `${name} ${value}`
      return swatch
    }))
    const label = select.closest('.field-inline')?.querySelector(':scope > span')?.textContent?.trim() || '色'
    palette.setAttribute('aria-label', `${label}を選択`)
    palette.style.setProperty('--color-columns', String(values.length > 10 ? 5 : Math.max(2, Math.min(4, values.length))))
    palette.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    trigger.setAttribute('aria-controls', palette.id)
    const rect = trigger.getBoundingClientRect()
    const bounds = palette.getBoundingClientRect()
    const gap = 4
    let left = Math.min(Math.max(6, rect.left), Math.max(6, window.innerWidth - bounds.width - 6))
    let top = rect.bottom + gap
    if (top + bounds.height > window.innerHeight - 6) top = Math.max(6, rect.top - bounds.height - gap)
    palette.style.left = `${Math.round(left)}px`
    palette.style.top = `${Math.round(top)}px`
    palette.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true })
  }

  function fontOptionsMarkup() {
    return '<option value="gothic">ゴシック</option><option value="mincho">明朝</option><option value="even">均等</option>'
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

  function activeOutputLayout(documentModel = store.document) {
    const active = page(documentModel)
    return active?.outputLayout || K.createOutputLayout?.({}, documentModel?.paper || {}) || {
      paperSize: documentModel?.paper?.size === 'A3' ? 'A3' : 'A4',
      orientation: documentModel?.paper?.orientation === 'portrait' ? 'portrait' : 'landscape',
      printScale: null, offsetMmX: 0, offsetMmY: 0,
      showFrame: true, showTitleFrame: true, includeUnderlay: true, includeGuides: false, initialized: false
    }
  }

  function outputPaperModel(documentModel = store.document) {
    const layout = activeOutputLayout(documentModel)
    const size = layout.paperSize === 'A3' ? 'A3' : 'A4'
    const orientation = layout.orientation === 'portrait' ? 'portrait' : 'landscape'
    const millimeters = size === 'A3' ? { short: 297, long: 420 } : { short: 210, long: 297 }
    return {
      ...(documentModel?.paper || {}),
      size,
      orientation,
      widthMm: orientation === 'portrait' ? millimeters.short : millimeters.long,
      heightMm: orientation === 'portrait' ? millimeters.long : millimeters.short,
      showFrame: layout.showFrame !== false,
      showTitleFrame: layout.showTitleFrame !== false,
      includeUnderlay: layout.includeUnderlay !== false,
      includeGuides: layout.includeGuides === true,
      printScale: Number(layout.printScale) > 0 ? Number(layout.printScale) : null
    }
  }

  function outputPrintScale(documentModel = store.document) {
    const value = Number(activeOutputLayout(documentModel).printScale)
    return Number.isFinite(value) && value > 0 ? value : null
  }

  function outputPixelsPerWorldUnit(documentModel = store.document, dpi = 96) {
    const targetDpi = Math.max(1, finite(dpi, 96))
    const active = page(documentModel)
    const mpp = Number(active?.calibration?.mpp ?? documentModel?.calibration?.mpp)
    const printScale = outputPrintScale(documentModel)
    if (Number.isFinite(mpp) && mpp > 0 && Number.isFinite(printScale) && printScale > 0) {
      return (mpp / printScale) * (targetDpi / 0.0254)
    }
    return null
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
    ui.mixedFields = new Set()
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
    if (!world || !['lot', 'road', 'water', 'cutout'].includes(lot?.kind) || !Array.isArray(lot.points) || lot.points.length < 2) return null
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
    if (!['lot', 'road', 'water', 'cutout'].includes(object?.kind) || !Number.isInteger(index)) return false
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

  function activeSnapSettings(documentModel = store.document) {
    return { ...(documentModel?.preferences?.snap || {}), grid: false }
  }

  function pointerSnapSettings() {
    const settings = activeSnapSettings()
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
    closeColorPalette()
  }

  function setWorkspace(name) {
    if (name === 'registry') {
      flushActiveEditor()
      renderRegistry()
      byId('registry-search')?.focus({ preventScroll: true })
      setStatus('右側の一覧を表示しています。図面の表示倍率と選択は保持されます', 1800)
      closeMenus()
      return
    }
    const next = ['drawing', 'registry', 'output'].includes(name) ? name : 'drawing'
    const changed = ui.workspace !== next
    if (changed) {
      if (ui.workspace === 'drawing') {
        ui.workspaceSelection = [...ui.selectedIds]
        ui.workspaceContextPage = ui.contextPage
      }
      flushActiveEditor()
      cancelTransient(false)
      if (ui.statusTimer) clearTimeout(ui.statusTimer)
      ui.statusTimer = null
      ui.statusOverride = ''
      ui.category = 'select'
      if (next === 'drawing') {
        ui.selectedIds = ui.workspaceSelection.filter(id => Boolean(K.objectById(store.document, id)?.object))
        ui.contextPage = ui.workspaceContextPage
        ui.launcher = ui.selectedIds.length === 0
        session.activate(ui.selectedIds.length ? 'select' : 'launcher:select')
        if (ui.selectedIds.length) setObjectSelection(ui.selectedIds, { openEditor: true, preserveSubselection: true })
      } else {
        ui.selectedIds = []
        ui.contextPage = ''
        ui.launcher = true
        session.activate('launcher:select')
      }
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
    const selectedBefore = [...ui.selectedIds]
    commitPendingEdit()
    cancelTransient(false)
    ui.category = selectedCategory
    ui.launcher = true
    ui.contextPage = ''
    session.activate(`launcher:${selectedCategory}`)
    session.category = selectedCategory
    // 加工ランチャーを開いただけでは対象選択を捨てない。ここで保持した
    // 選択は分割・合筆・隅切り等を選んだ時に targetIds へ引き継がれる。
    ui.selectedIds = selectedBefore.filter(id => Boolean(K.objectById(store.document, id)?.object))
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
        const currentMethod = documentModel.calibration?.method === 'two-point' ? 'two-point' : 'scale'
        return {
          'scale-method': currentMethod,
          'calibration-distance': '',
          'manual-scale': scaleText,
          'scale-preset': DRAWING_SCALE_PRESETS.has(Number(scaleText)) ? scaleText : ''
        }
      }
      case 'move-all': return { 'move-all-include-underlay': false }
      case 'split-all': return { 'split-lot': true, 'split-road': false, 'split-water': false }
      case 'lot-draw': return {
        fill: lot.style?.fill || K.DEFAULTS.lotStyle.fill,
        stroke: lot.style?.stroke || K.DEFAULTS.lotStyle.stroke,
        'fill-opacity': Math.round(finite(lot.style?.opacity, K.DEFAULTS.lotStyle.opacity) * 100),
        'show-area': lot.showArea !== false, 'show-tsubo': lot.showTsubo !== false, 'show-lengths': lot.showLengths !== false,
        'font-family': fontToken(lot.labelStyle?.fontFamily), 'text-size': fontScale(lot.labelStyle, LABEL_BASE_SIZE),
        'dimension-font': fontToken(lot.dimensionStyle?.fontFamily), 'dimension-size': fontScale(lot.dimensionStyle, DIMENSION_BASE_SIZE),
        approximate: Boolean(lot.dimensionStyle?.approximate),
        'dimension-decimals': lot.dimensionStyle?.decimals ?? 2,
        'dimension-rounding': lot.dimensionStyle?.rounding || 'round',
        'dimension-adjustment': finite(lot.dimensionStyle?.adjustment)
      }
      case 'road-draw': return {
        'road-type': road.type || '道路', 'road-name': road.name || '道路', 'road-width': finite(road.widthM, 4),
        fill: road.style?.fill || K.DEFAULTS.roadStyle.fill, stroke: road.style?.stroke || K.DEFAULTS.roadStyle.stroke,
        'fill-opacity': Math.round(finite(road.style?.opacity, K.DEFAULTS.roadStyle.opacity) * 100),
        'show-label': true, 'road-width-visible': true,
        'show-area': road.showArea === true, 'show-tsubo': road.showTsubo === true, 'show-lengths': road.showLengths === true,
        'font-family': fontToken(road.labelStyle?.fontFamily), 'text-size': fontScale(road.labelStyle, LABEL_BASE_SIZE),
        'road-width-font': fontToken(road.widthLabelStyle?.fontFamily), 'road-width-size': fontScale(road.widthLabelStyle, ROAD_WIDTH_BASE_SIZE),
        'text-vertical': Boolean(road.vertical),
        'dimension-font': fontToken(road.dimensionStyle?.fontFamily), 'dimension-size': fontScale(road.dimensionStyle, DIMENSION_BASE_SIZE),
        approximate: Boolean(road.dimensionStyle?.approximate),
        'dimension-decimals': road.dimensionStyle?.decimals ?? road.dimensionStyle?.digits ?? 2,
        'dimension-rounding': road.dimensionStyle?.rounding || 'round',
        'dimension-adjustment': finite(road.dimensionStyle?.adjustment)
      }
      case 'division-guide': case 'lot-division-guide': return { 'division-count': 2 }
      case 'parallel-guide': return { 'parallel-distance': 3, 'parallel-count': 1, parallelSign: 1 }
      case 'corner-cut': return { 'corner-length': 2 }
      case 'distance': case 'polyline': case 'area': return {
        'line-style': line.lineStyle || 'solid', 'line-width': finite(line.lineWidth, 1.4), color: line.color || '#253858',
        'note-text': '', 'note-size': finite(text.fontSize, TEXT_BASE_SIZE), 'note-angle': 0, 'note-font': fontToken(text.fontFamily), 'note-vertical': false,
        'dimension-approximate': false,
        'dimension-font': fontToken(measurement.fontFamily), 'dimension-size': fontScale(measurement, DIMENSION_BASE_SIZE),
        'dimension-decimals': measurement.decimals ?? measurement.digits ?? 2,
        'dimension-rounding': measurement.rounding || 'round',
        'dimension-adjustment': finite(measurement.adjustment)
      }
      case 'line': case 'arrow': return {
        'line-style': line.lineStyle || 'solid', 'line-width': finite(line.lineWidth, 1.4), color: line.color || '#253858',
        'note-text': '', 'note-size': finite(text.fontSize, TEXT_BASE_SIZE), 'note-angle': 0, 'note-font': fontToken(text.fontFamily), 'note-vertical': false
      }
      case 'text': case 'callout': return {
        'note-text': command === 'callout' ? '注記' : '文字', 'note-size': finite(text.fontSize, TEXT_BASE_SIZE), 'note-angle': finite(text.rotation),
        'note-font': fontToken(text.fontFamily), 'note-vertical': Boolean(text.vertical), color: text.color || '#172033',
        'line-style': line.lineStyle || 'solid', 'line-width': finite(line.lineWidth, 1.4)
      }
      case 'north': return {
        'stamp-width': finite(stamp.size, 54), 'stamp-depth': finite(stamp.size, 54),
        'stamp-scale': finite(stamp.scale, 1), 'stamp-text-scale': finite(stamp.textScale, finite(text.fontSize, TEXT_BASE_SIZE) / TEXT_BASE_SIZE),
        'stamp-angle': 0, 'stamp-dimensions': false, 'stamp-label': stamp.label || 'N', 'stamp-font': fontToken(stamp.fontFamily || text.fontFamily), 'stamp-line-width': finite(stamp.lineWidth, 1.4), color: stamp.textColor || text.color || '#172033'
      }
      case 'house': case 'parking': return {
        'stamp-width': finite(stamp.widthM, command === 'parking' ? 2.5 : 10),
        'stamp-depth': finite(stamp.heightM, command === 'parking' ? 5 : 8), 'stamp-angle': 0,
        'stamp-scale': finite(stamp.scale, 1), 'stamp-text-scale': finite(stamp.textScale, finite(text.fontSize, TEXT_BASE_SIZE) / TEXT_BASE_SIZE),
        'stamp-dimensions': stamp.showDimensions !== false, 'stamp-label': stamp.label || (command === 'parking' ? 'P' : '家屋'), 'stamp-font': fontToken(stamp.fontFamily || text.fontFamily),
        color: stamp.textColor || line.color || '#253858',
        'stamp-stroke': stamp.stroke || line.color || '#253858',
        'stamp-fill': stamp.fill || (command === 'parking' ? '#eef4fb' : '#edf2f8'),
        'stamp-hatch': command === 'house' ? stamp.hatch !== false : false,
        'stamp-hatch-spacing': finite(stamp.hatchSpacing, 9), 'stamp-hatch-angle': finite(stamp.hatchAngle, 45),
        'line-style': stamp.lineStyle || line.lineStyle || 'solid', 'stamp-line-width': finite(stamp.lineWidth, 1.4)
      }
      case 'lot-table': return {
        'table-title': '区画一覧', 'table-show-price': true,
        'font-family': fontToken(text.fontFamily), 'text-size': fontScale(text, TEXT_BASE_SIZE),
        'table-line-width': 0.75, 'table-scale': 1, 'table-angle': 0, 'table-mode': 'dynamic'
      }
      case 'display-settings': {
        const lots = (page(documentModel)?.shapes || []).filter(shape => shape.kind === 'lot')
        const everyLot = predicate => lots.length === 0 || lots.every(predicate)
        return {
          'global-show-underlay': documentModel.background.visible !== false,
          'global-show-number': everyLot(shape => shape.visibility?.number !== false),
          'global-show-area': everyLot(shape => shape.visibility?.area !== false && shape.areaLabel?.visible !== false),
          'global-show-tsubo': everyLot(shape => shape.visibility?.tsubo !== false && shape.tsuboLabel?.visible !== false),
          'global-show-lengths': everyLot(shape => shape.visibility?.dimensions !== false),
          'snap-vertex': prefs.snap?.vertex !== false,
          'snap-intersection': prefs.snap?.intersection !== false, 'snap-edge': prefs.snap?.edge !== false
        }
      }
      case 'typography-settings': return {
        'typography-apply-target': 'new',
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
    const command = rawCommand === 'underlay' && store.document.background?.type
      ? 'calibrate'
      : (UI_COMMAND_ALIASES[rawCommand] || rawCommand)
    const meta = COMMAND[command]
    if (!meta) return false
    const requestedTargets = options.preserveSelection && SELECTION_TARGET_COMMANDS.has(command)
      ? selectedObjects()
      : []
    if (ui.workspace !== 'drawing') setWorkspace('drawing')
    commitPendingEdit()
    cancelTransient(false)
    ui.launcher = false
    ui.category = meta.category
    ui.contextPage = ''
    ui.createPage = ''
    ui.selectedIds = []
    resetEditDrafts()
    ui.editEdgeIndex = null
    ui.editSegmentIndex = null
    session.activate(command, defaultForm(command))
    session.category = meta.category
    if (requestedTargets.length) {
      let targets = requestedTargets
      if (command === 'split') targets = targets.length === 1 && ['lot', 'road', 'water'].includes(targets[0].kind) ? targets : []
      else if (command === 'merge') targets = targets.length && targets.every(object => ['lot', 'road', 'water', 'cutout'].includes(object.kind)) ? targets : []
      else if (command === 'corner-cut') targets = targets.length === 1 && targets[0].kind === 'lot' ? targets : []
      else if (command === 'lot-division-guide') targets = targets.length === 1 && targets[0].kind === 'lot' ? targets : []
      else if (command === 'vertex-edit') targets = targets.length === 1 ? targets : []
      session.targetIds = targets.map(object => String(object.id))
      ui.selectedIds = [...session.targetIds]
    }
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

  function requestUserCommand(rawCommand, options = {}) {
    const command = rawCommand === 'underlay' && store.document.background?.type
      ? 'calibrate'
      : (UI_COMMAND_ALIASES[rawCommand] || rawCommand)
    if (SCALE_REQUIRED_COMMANDS.has(command) && !hasScale()) {
      const returnTargetIds = SELECTION_TARGET_COMMANDS.has(command) ? [...ui.selectedIds] : []
      ui.scaleFlow = { reason: 'required-command', returnCommand: command, returnTargetIds }
      activateCommand('calibrate', options)
      setStatus(`現在の${Math.max(1, finite(store.document.background?.currentPage, 1))}ページは縮尺未設定です。縮尺を設定するまで「${COMMAND[command]?.name || command}」は開始できません`, 0)
      return false
    }
    return activateCommand(command, { ...options, preserveSelection: options.preserveSelection !== false })
  }

  function completeScaleFlow(message) {
    const returnCommand = ui.scaleFlow.returnCommand
    const returnTargetIds = Array.isArray(ui.scaleFlow.returnTargetIds) ? [...ui.scaleFlow.returnTargetIds] : []
    ui.scaleFlow = { reason: null, returnCommand: null, returnTargetIds: [] }
    if (returnCommand) {
      ui.selectedIds = returnTargetIds.filter(id => Boolean(K.objectById(store.document, id)?.object))
      activateCommand(returnCommand, { focusCanvas: false, preserveSelection: true })
      setStatus(`${message}　「${COMMAND[returnCommand]?.name || returnCommand}」を開始します`, 2400)
    } else {
      // 明示的な再設定と下絵読込後は、この画面に留める。候補と2点校正を
      // 何度でも切り替えられ、「選択へ戻る」だけを画面移動にする。
      session.points = []
      session.step = 0
      runtime.hoverSnap = null
      renderCommandSurface()
      render()
      setStatus(`${message}　このページの縮尺は続けて再設定できます`, 2400)
    }
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

  function resetDocumentScopedUiState(options = {}) {
    const { resetViews = false } = options
    const outputDrag = runtime.outputDrag
    const panPointerId = runtime.pan?.pointerId
    try {
      if (outputDrag && dom.outputPreview?.hasPointerCapture?.(outputDrag.pointerId)) dom.outputPreview.releasePointerCapture(outputDrag.pointerId)
      if (Number.isInteger(panPointerId) && dom.canvas?.hasPointerCapture?.(panPointerId)) dom.canvas.releasePointerCapture(panPointerId)
    } catch (_) { /* pointer capture may already be lost */ }

    cancelTransient(false)
    runtime.pointerWorld = null
    runtime.pointerScreen = null
    runtime.moveSnap = null
    runtime.pan = null
    runtime.spaceDown = false
    runtime.composing = false
    runtime.compositionEndedAt = 0
    runtime.outputDrag = null
    runtime.fileDragDepth = 0
    dom.outputPreview?.classList.remove('is-dragging')
    dom.stage?.classList.remove('file-drag-active')

    ui.selectedIds = []
    ui.registryIds.clear()
    ui.contextPage = ''
    ui.editEdgeIndex = null
    ui.editSegmentIndex = null
    ui.segmentPanel = 'text'
    ui.specialPanel = 'primary'
    ui.textRole = 'name'
    ui.clipboard = []
    ui.clipboardPasteCount = 0
    ui.workspaceSelection = []
    ui.workspaceContextPage = ''
    ui.scaleFlow = { reason: null, returnCommand: null, returnTargetIds: [] }

    if (resetViews) {
      ui.registryTab = 'lots'
      ui.outputTab = 'paper'
      const registrySearch = byId('registry-search')
      const registryFilter = byId('registry-filter')
      const registrySort = byId('registry-sort')
      if (registrySearch) registrySearch.value = ''
      if (registryFilter) registryFilter.value = 'all'
      if (registrySort) registrySort.value = 'number'
      $$('[data-output-tab]').forEach(button => button.classList.toggle('active', button.dataset.outputTab === ui.outputTab))
      $$('[data-output-panel]').forEach(panel => {
        const active = panel.dataset.outputPanel === ui.outputTab
        panel.hidden = !active
        panel.classList.toggle('is-active', active)
      })
    }

    closeMenus()
  }

  function prepareForDocumentReplacement() {
    // Pending drafts must be resolved against the old document. Clearing them
    // only after store.replace() can overwrite same-id objects in the new file.
    commitPendingEdit()
    resetDocumentScopedUiState({ resetViews: true })
  }

  function commandStepText() {
    const command = session.command
    const points = session.points.length
    const targets = session.targetIds.length
    if (ui.launcher) return { small: 'コマンド', strong: '選択' }
    if (command === 'underlay-open') return { small: '下絵', strong: '未読込' }
    if (command === 'calibrate') {
      if (session.form['scale-method'] !== 'two-point') return { small: `ページ ${Math.max(1, finite(store.document.background?.currentPage, 1))}`, strong: hasScale() ? '縮尺入力' : '未設定' }
      if (points === 0) return { small: `ページ ${Math.max(1, finite(store.document.background?.currentPage, 1))}`, strong: hasScale() ? '設定済' : '未設定' }
      return { small: points === 1 ? '2点校正 終点' : '実距離入力', strong: points === 1 ? '2/2' : '確定' }
    }
    if (['lot-draw', 'road-draw', 'polyline', 'area'].includes(command)) return { small: '作図点', strong: String(points) }
    if (command === 'callout') return { small: points === 0 ? '先端' : points === 1 ? '文字位置' : '確定', strong: `${Math.min(points + 1, 2)}/2` }
    if (['distance', 'arrow'].includes(command)) return { small: points === 0 ? '始点' : '終点', strong: points === 0 ? '1/2' : '2/2' }
    if (command === 'line') return { small: '作図点', strong: String(points) }
    if (command === 'split') return { small: targets ? (points < 2 ? '分割線' : '確定できます') : '区画選択', strong: targets ? `${points}点` : '1/2' }
    if (command === 'split-all') return { small: points < 2 ? '分割線' : '確定できます', strong: `${points}点` }
    if (command === 'merge') return targets >= 2
      ? { small: '確定できます', strong: `${targets}件` }
      : { small: targets ? '2つ目の図形' : '1つ目の図形', strong: `${targets}/2` }
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
      openButton?.classList.toggle('primary', !hasUnderlay)
      const directScaleAvailable = (hasUnderlay || store.document.paper?.enabled) && worldUnitsPerMeter() != null
      if (!directScaleAvailable) session.form['scale-method'] = 'two-point'
      const method = session.form['scale-method'] === 'two-point' ? 'two-point' : 'scale'
      const methodSelect = $('[data-field="scale-method"]', dom.commandControls)
      if (methodSelect) {
        methodSelect.value = method
        const scaleOption = methodSelect.querySelector('option[value="scale"]')
        if (scaleOption) scaleOption.disabled = !directScaleAvailable
      }
      $$('[data-scale-method-panel]', dom.commandControls).forEach(element => {
        // 下絵なしのページでも、既存図形上の既知距離を使って再校正できる。
        // 設定済み縮尺から2点校正へいつでも切り替えられる状態を保つ。
        element.hidden = element.dataset.scaleMethodPanel !== method
      })
      $$('[data-direct-scale]', dom.commandControls).forEach(element => { if (!directScaleAvailable) element.hidden = true })
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
      widthField?.insertAdjacentHTML('beforebegin', '<label class="field-inline" data-create-page="create-basic"><span>名称</span><input class="ctrl-input wide" data-field="road-name" type="text" placeholder="道路・水路名称"></label>')
    }
    if (command === 'line') {
      for (const fieldName of ['note-text', 'note-size', 'note-angle']) {
        const field = $(`[data-field="${fieldName}"]`, dom.commandControls)
        const container = field?.closest('label') || field
        if (container) container.hidden = true
      }
      const colorLabel = $('[data-field="color"]', dom.commandControls)?.closest('label')?.querySelector('span')
      if (colorLabel) colorLabel.textContent = '線色'
    }
    if (command === 'line') {
      for (const fieldName of ['note-font', 'note-vertical']) {
        const field = $(`[data-field="${fieldName}"]`, dom.commandControls)
        const container = field?.closest('label') || field
        if (container) container.hidden = true
      }
    }
    if (['line', 'arrow', 'callout'].includes(command)) {
      dom.commandControls.insertAdjacentHTML('beforeend', '<label class="field-inline"><span>線種</span><select class="ctrl-select compact-select" data-field="line-style"><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option></select></label><label class="field-inline"><span>太さ</span><input class="ctrl-input number-small" data-field="line-width" type="number" min="0.5" max="10" step="0.5"></label>')
    }
    if (['north', 'house', 'parking'].includes(command)) {
      const appearance = command === 'north'
        ? `${colorSelectMarkup('color', '色', 'ink')}<label class="field-inline"><span>線幅</span><input class="ctrl-input number-small" data-field="stamp-line-width" type="number" min="0.5" max="10" step="0.5"></label>`
        : `${colorSelectMarkup('color', '文字色', 'ink')}${colorSelectMarkup('stamp-stroke', '枠線', 'border')}${colorSelectMarkup('stamp-fill', '塗り', 'fill')}${command === 'house' ? '<label class="check-control"><input data-field="stamp-hatch" type="checkbox">斜線</label><label class="field-inline"><span>斜線間隔</span><input class="ctrl-input number-small" data-field="stamp-hatch-spacing" type="number" min="2" max="40" step="1"></label><label class="field-inline"><span>斜線角度</span><input class="ctrl-input number-small" data-field="stamp-hatch-angle" type="number" step="1"><em>°</em></label>' : ''}<label class="field-inline"><span>線種</span><select class="ctrl-select compact-select" data-field="line-style"><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option></select></label><label class="field-inline"><span>線幅</span><input class="ctrl-input number-small" data-field="stamp-line-width" type="number" min="0.5" max="10" step="0.5"></label>`
      dom.commandControls.insertAdjacentHTML('beforeend', `<label class="field-inline" data-create-page="create-text"><span>文字</span><input class="ctrl-input" data-field="stamp-label" type="text"></label><span class="control-section" data-create-page="create-appearance" aria-label="表示"><span class="control-section-title">表示</span>${appearance}</span>`)
      if (command === 'north') {
        $$('.stamp-metric-only, .stamp-dimension-only', dom.commandControls).forEach(element => { element.hidden = true })
      }
    }
  }

  function configureCreateCommandPages(command) {
    const route = CREATE_COMMAND_ROUTES[command]
    if (!route) return false
    if (!route.some(([pageId]) => pageId === ui.createPage)) ui.createPage = route[0][0]
    dom.commandPages.replaceChildren(...route.map(([pageId, label]) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `ctrl-tab${pageId === ui.createPage ? ' active' : ''}`
      button.dataset.createCommandPage = pageId
      button.textContent = label
      return button
    }))
    dom.commandPages.hidden = false
    $$('[data-create-page]', dom.commandControls).forEach(element => {
      const unavailableForNorth = command === 'north' && element.matches('.stamp-metric-only, .stamp-dimension-only')
      element.hidden = unavailableForNorth || element.dataset.createPage !== ui.createPage
    })
    return true
  }

  function makeInstructionControls(meta) {
    const wrap = document.createElement('div')
    wrap.className = 'control-group instruction'
    const strong = document.createElement('strong')
    strong.textContent = meta.hint
    wrap.append(strong)
    if (session.command === 'select') {
      const span = document.createElement('span')
      span.className = 'context-optional'
      span.textContent = '　クリック後、上部で編集'
      wrap.append(span)
    }
    dom.commandControls.append(wrap)
  }

  function objectEditorRoute(kind) {
    return OBJECT_EDITOR_ROUTES[kind] || OBJECT_EDITOR_ROUTES.text
  }

  function configureObjectEditorPages(kind) {
    const route = objectEditorRoute(kind)
    if (!route.some(([pageId]) => pageId === ui.contextPage)) ui.contextPage = route[0]?.[0] || ''
    const buttons = $$('[data-context-page]', dom.commandPages)
    buttons.forEach((button, index) => {
      const entry = route[index]
      button.hidden = !entry
      if (!entry) return
      const [pageId, label] = entry
      button.dataset.contextPage = pageId
      button.textContent = label
      button.classList.toggle('active', pageId === ui.contextPage)
    })
    return new Set(route.map(([pageId]) => pageId))
  }

  function appendRoadBasicControls(kind, { batch = false } = {}) {
    const water = kind === 'water'
    const widthName = water ? '水路幅' : '幅員'
    const categoryOptions = water
      ? '<option value="水路">水路</option>'
      : '<option>道路</option><option>公道</option><option>私道</option><option>位置指定道路</option><option>認定外道路</option>'
    dom.commandControls.insertAdjacentHTML('beforeend', `${batch ? '' : `<label class="field-inline"><span>${water ? '水路名' : '道路名'}</span><input class="ctrl-input wide" data-field="object-label" type="text"></label>`}<label class="field-inline"><span>区分</span><select class="ctrl-select" data-field="road-category">${categoryOptions}</select></label><label class="field-inline"><span>${widthName}</span><input class="ctrl-input number-small" data-field="road-width" type="number" min="0" step="0.1"><em>m</em></label>`)
  }

  function textRoleVisibility(objects, role) {
    const visible = object => role === 'name'
      ? object.visibility?.label !== false
      : role === 'width'
        ? object.visibility?.width !== false
        : metricLabelVisible(object, role)
    const values = objects.map(visible)
    return values.every(Boolean) ? '' : values.some(Boolean) ? '（一部非表示）' : '（非表示）'
  }

  function automaticMetricSummary(objects, role) {
    const mpp = Math.max(0, finite(store.document.calibration?.mpp))
    if (!(mpp > 0)) return '自動値：縮尺未設定'
    const values = objects.map(object => {
      const area = Number.isFinite(Number(object.area)) ? Number(object.area) : K.polygonArea(object.points || []) * mpp * mpp
      return role === 'tsubo' ? area / K.TSUBO_M2 : area
    }).filter(Number.isFinite)
    if (!values.length) return '自動値：—'
    if (values.some(value => Math.abs(value - values[0]) > 0.000001)) return '自動値：複数の計算値'
    const property = role === 'tsubo' ? 'tsuboLabel' : 'areaLabel'
    const style = objects[0]?.[property]?.style || {}
    return `自動値：${K.formatMeasurement(values[0], { ...style, approximate: false }, role === 'tsubo' ? '坪' : '㎡')}`
  }

  function metricHiddenStyleNeedsReset(object, role) {
    if (!object || !['area', 'tsubo'].includes(role)) return false
    const property = role === 'tsubo' ? 'tsuboLabel' : 'areaLabel'
    const legacyDigits = role === 'tsubo' ? object.tsuboDigits : object.areaDigits
    const style = object[property]?.style || {}
    const boxStyle = String(style.boxStyle || '').toLowerCase()
    const digits = style.decimals ?? style.digits ?? legacyDigits ?? 2
    return Math.abs(finite(style.rotation ?? style.angle)) > 0.000001 ||
      style.vertical === true || style.frame === true || style.underline === true ||
      !['', 'none'].includes(boxStyle) || Boolean(style.borderColor) || finite(style.borderWidth) > 0 ||
      Number(digits) !== 2 || String(style.rounding || 'round') !== 'round' ||
      Math.abs(finite(style.adjustment)) > 0.000001 || style.approximate === true
  }

  function appendTextRoleControls(object, objects = [object]) {
    if (!['lot', 'road', 'water'].includes(object.kind)) return
    const targets = objects.length ? objects : [object]
    const roles = [['name', object.kind === 'lot' ? '区画名・番号' : object.kind === 'water' ? '水路名' : '道路名']]
    if (object.kind === 'road' || object.kind === 'water') roles.push(['width', object.kind === 'water' ? '水路幅' : '幅員'])
    roles.push(['area', '面積'], ['tsubo', '坪'])
    if (!roles.some(([value]) => value === ui.textRole)) ui.textRole = 'name'
    const options = roles.map(([value, label]) => `<option value="${value}" ${value === ui.textRole ? 'selected' : ''}>${label}${textRoleVisibility(targets, value)}</option>`).join('')
    const targetControl = `<label class="field-inline"><span>編集対象</span><select class="ctrl-select text-role-select" data-text-role>${options}</select></label>`
    let content = ''
    let style = ''
    dom.commandControls.replaceChildren()
    if (ui.textRole === 'name') {
      const label = object.kind === 'lot' ? '区画名・番号' : object.kind === 'water' ? '水路名' : '道路名'
      content = `<span class="control-label text-value-note">内容は「基本」で編集</span>`
      style = `<label class="field-inline"><span>書体</span><select class="ctrl-select compact-select" data-field="font-family">${fontOptionsMarkup()}</select></label><label class="field-inline"><span>大きさ</span><input class="ctrl-input number-small" data-field="text-size" type="number" min="0.3" max="5" step="0.1"><em>倍</em></label><label class="field-inline"><span>角度</span><input class="ctrl-input number-small" data-field="text-angle" type="number" step="1"><em>°</em></label><label class="check-control"><input data-field="text-vertical" type="checkbox">縦書き</label>${colorSelectMarkup('textColor', '文字色', 'ink')}<label class="check-control"><input data-field="text-frame" type="checkbox">枠</label><label class="check-control"><input data-field="text-underline" type="checkbox">下線</label><button class="ctrl-btn" type="button" data-action="reset-text-role-position" data-text-position-role="name">${label}を自動位置へ戻す</button>`
    } else if (ui.textRole === 'width') {
      const widthName = object.kind === 'water' ? '水路幅' : '幅員'
      const widths = targets.map(value => finite(value.road?.widthM ?? value.road?.width)).filter(Number.isFinite)
      const widthSummary = widths.length && widths.every(value => Math.abs(value - widths[0]) < 0.000001) ? `実幅 ${widths[0].toFixed(2)}m` : '実幅：複数の値'
      content = `<span class="control-label text-value-note">${widthSummary}</span><label class="field-inline"><span>表示文字</span><input class="ctrl-input wide" data-field="road-width-text" type="text" placeholder="空欄で自動表示"></label>`
      style = `<label class="field-inline"><span>書体</span><select class="ctrl-select compact-select" data-field="road-width-font">${fontOptionsMarkup()}</select></label><label class="field-inline"><span>大きさ</span><input class="ctrl-input number-small" data-field="road-width-size" type="number" min="0.3" max="5" step="0.1"><em>倍</em></label><label class="field-inline"><span>角度</span><input class="ctrl-input number-small" data-field="road-width-angle" type="number" step="1"><em>°</em></label><label class="check-control"><input data-field="road-width-vertical" type="checkbox">縦書き</label>${colorSelectMarkup('road-width-color', '文字色', 'dimension')}<label class="check-control"><input data-field="road-width-frame" type="checkbox">枠</label><label class="check-control"><input data-field="road-width-underline" type="checkbox">下線</label><button class="ctrl-btn" type="button" data-action="reset-text-role-position" data-text-position-role="width">${widthName}を自動位置へ戻す</button>`
    } else {
      const prefix = ui.textRole === 'tsubo' ? 'tsubo-label' : 'area-label'
      const label = ui.textRole === 'tsubo' ? '坪' : '面積'
      // 面積・坪は図面内の主要数値であり、回転・縦書き・枠・下線や
      // 個別の丸め補正を並べるより「表示値・書体・大きさ・色・位置」へ
      // 絞る。旧版の詳細書式が残る場合だけ標準化ボタンを表示する。
      content = `<span class="control-label text-value-note">${automaticMetricSummary(targets, ui.textRole)}</span><label class="field-inline value-text-field"><span>手入力値</span><input class="ctrl-input wide" data-field="${prefix}-text" type="text" placeholder="空欄＝自動"><em class="field-warning" data-metric-manual-state hidden>手入力中</em></label>`
      style = `<label class="field-inline"><span>書体</span><select class="ctrl-select compact-select" data-field="${prefix}-font">${fontOptionsMarkup()}</select></label><label class="field-inline"><span>大きさ</span><input class="ctrl-input number-small" data-field="${prefix}-size" type="number" min="0.3" max="5" step="0.1"><em>倍</em></label>${colorSelectMarkup(`${prefix}-color`, '文字色', 'ink')}<button class="ctrl-btn" type="button" data-action="reset-text-role-position" data-text-position-role="${ui.textRole}">${label}を自動位置へ戻す</button><button class="ctrl-btn metric-standard-reset" type="button" data-action="reset-metric-hidden-style" data-metric-role="${ui.textRole}" hidden>標準表示へ戻す</button>`
    }
    dom.commandControls.insertAdjacentHTML('beforeend', `<div class="text-value-row text-value-content-row">${targetControl}${content}</div><div class="text-value-row text-value-style-row"><span class="control-section-title">書式・位置</span>${style}</div>`)
  }

  function lotTableControlsMarkup() {
    return `<label class="field-inline"><span>題名</span><input class="ctrl-input wide" data-field="table-title" type="text"></label><label class="field-inline"><span>全体倍率</span><input class="ctrl-input number-small" data-field="table-scale" type="number" min="0.3" max="5" step="0.1"><em>倍</em></label><label class="check-control"><input data-field="table-show-price" type="checkbox">価格列</label><label class="field-inline"><span>書体</span><select class="ctrl-select compact-select" data-field="font-family">${fontOptionsMarkup()}</select></label><label class="field-inline"><span>文字倍率</span><input class="ctrl-input number-small" data-field="text-size" type="number" min="0.3" max="5" step="0.1"><em>倍</em></label><label class="field-inline"><span>罫線</span><input class="ctrl-input number-small" data-field="table-line-width" type="number" min="0.5" max="5" step="0.25"></label><label class="field-inline"><span>角度</span><input class="ctrl-input number-small" data-field="table-angle" type="number" step="1"><em>°</em></label><label class="field-inline"><span>更新</span><select class="ctrl-select" data-field="table-mode"><option value="dynamic">区画変更に追従</option><option value="snapshot">現在値で固定</option></select></label>`
  }

  function appendGuideEditControls(object, { batch = false } = {}) {
    if (object.kind === 'guide' && object.options?.mode === 'segment') {
      dom.commandControls.insertAdjacentHTML('beforeend', '<label class="field-inline"><span>分割数</span><input class="ctrl-input number-small" data-field="guide-divisions" type="number" min="2" max="20" step="1"><em>等分</em></label>')
    }
    if (!batch && object.kind === 'parallel') {
      const hasBaseline = Array.isArray(object.options?.baselinePoints) && object.options.baselinePoints.length >= 2
      dom.commandControls.insertAdjacentHTML('beforeend', `<label class="field-inline"><span>間隔</span><input class="ctrl-input number-small" data-field="parallel-distance-edit" type="number" min="0.1" step="0.1" ${hasBaseline ? '' : 'disabled'}><em>m</em></label><button class="ctrl-btn" type="button" data-action="flip-selected-parallel" ${hasBaseline ? '' : 'disabled'}>反転</button>${hasBaseline ? '' : '<span class="control-label context-optional">旧形式の平行線は線の書式だけ編集できます</span>'}`)
    }
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
    configureObjectEditorPages(kind)
    if (ui.contextPage) dom.commandControls.append(cloneTemplate(`controls-${ui.contextPage}`))
    if (ui.contextPage === 'object-basic') {
      $$('.shape-kind-convert', dom.commandControls).forEach(element => { element.hidden = true })
      $$('[data-field="object-type"],[data-field="lot-number"],[data-field="object-label"]', dom.commandControls).forEach(field => {
        const container = field.closest('label') || field
        container.hidden = true
      })
      $$('.shape-appearance-only', dom.commandControls).forEach(element => { element.hidden = !isShape })
      $$('.editable-text-only', dom.commandControls).forEach(element => { element.hidden = !hasEditableText })
      $$('.lot-only', dom.commandControls).forEach(element => { element.hidden = kind !== 'lot' })
      if (isRoadLike) appendRoadBasicControls(kind, { batch: true })
    }
    if (ui.contextPage === 'object-appearance' && isRoadLike) {
      dom.commandControls.insertAdjacentHTML('beforeend', `<label class="check-control"><input data-field="road-width-visible" type="checkbox">${kind === 'water' ? '水路幅' : '幅員'}を表示</label>`)
    }
    if (ui.contextPage === 'object-appearance' && isStamp) {
      dom.commandControls.replaceChildren()
      if (kind === 'north') {
        dom.commandControls.insertAdjacentHTML('beforeend', `${colorSelectMarkup('textColor', '色', 'ink')}<label class="field-inline"><span>線幅</span><input class="ctrl-input number-small" data-field="stamp-line-width" type="number" min="0.5" max="10" step="0.5"></label>`)
      } else {
        const hatch = kind === 'house'
          ? '<label class="check-control"><input data-field="stamp-hatch" type="checkbox">斜線</label><label class="field-inline"><span>斜線間隔</span><input class="ctrl-input number-small" data-field="stamp-hatch-spacing" type="number" min="2" max="40" step="1"></label><label class="field-inline"><span>斜線角度</span><input class="ctrl-input number-small" data-field="stamp-hatch-angle" type="number" step="1"><em>°</em></label>'
          : ''
        dom.commandControls.insertAdjacentHTML('beforeend', `${colorSelectMarkup('textColor', '文字色', 'ink')}${colorSelectMarkup('stamp-stroke', '枠線', 'border')}${colorSelectMarkup('stamp-fill', '塗り', 'fill')}${hatch}<label class="field-inline"><span>線種</span><select class="ctrl-select compact-select" data-field="stamp-line-style"><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option></select></label><label class="field-inline"><span>線幅</span><input class="ctrl-input number-small" data-field="stamp-line-width" type="number" min="0.5" max="10" step="0.5"></label>`)
      }
    }
    if (ui.contextPage === 'object-text' && isShape) appendTextRoleControls(object, objects)
    if (ui.contextPage === 'object-record') {
      $$('[data-field]', dom.commandControls).forEach(field => {
        const container = field.closest('label') || field
        container.hidden = true
      })
    }
    if (ui.contextPage === 'object-special') {
      if (isStamp) {
        const metricControls = kind === 'north' ? '' : '<label class="field-inline"><span>幅</span><input class="ctrl-input number-small" data-field="stamp-width" type="number" min="0.1" step="0.1"><em>m</em></label><label class="field-inline"><span>奥行</span><input class="ctrl-input number-small" data-field="stamp-depth" type="number" min="0.1" step="0.1"><em>m</em></label>'
        dom.commandControls.insertAdjacentHTML('beforeend', `${metricControls}<label class="field-inline"><span>全体倍率</span><input class="ctrl-input number-small" data-field="stamp-scale" type="number" min="0.2" max="5" step="0.1"><em>倍</em></label><label class="field-inline"><span>角度</span><input class="ctrl-input number-small" data-field="stamp-angle" type="number" step="1"><em>°</em></label>${kind === 'north' ? '' : '<label class="check-control"><input data-field="stamp-dimensions" type="checkbox">寸法表示</label>'}`)
      } else if (kind === 'lot-table') {
        dom.commandControls.insertAdjacentHTML('beforeend', lotTableControlsMarkup())
      } else if (hasLineStyle) {
        appendGuideEditControls(object, { batch: true })
        dom.commandControls.insertAdjacentHTML('beforeend', `<label class="field-inline"><span>線種</span><select class="ctrl-select compact-select" data-field="object-line-style"><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option></select></label><label class="field-inline"><span>太さ</span><input class="ctrl-input number-small" data-field="object-line-width" type="number" min="0.5" max="10" step="0.5"></label>${colorSelectMarkup('object-line-color', '線色', 'line')}`)
      }
    }
    $$('.measurement-only', dom.commandControls).forEach(element => { element.hidden = !isMeasurement })
    $$('.area-only', dom.commandControls).forEach(element => { element.hidden = kind !== 'area' })
    $$('.edge-approx-only', dom.commandControls).forEach(element => { element.hidden = !['lot', 'road', 'water', 'cutout'].includes(kind) })
    const notice = document.createElement('div')
    notice.className = 'batch-edit-notice'
    notice.innerHTML = `<strong>${objectDisplayName(object).replace(/\s+$/, '')}ほか ${objects.length}件</strong><span>変更した項目だけを全件へ反映します。番号・名称・価格・メモは変えません。</span>`
    if (ui.contextPage !== 'object-text') dom.commandControls.append(notice)
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
    const edgeCount = ['lot', 'road', 'water', 'cutout'].includes(object.kind) ? Math.max(object.edges?.length || 0, object.points?.length || 0) : 0
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
    all.textContent = edgeCount ? '全辺共通' : '全区間共通'
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

  function appendDimensionPartControls(object, targetControl = null) {
    const isEdge = Number.isInteger(ui.editEdgeIndex)
    const isSegment = Number.isInteger(ui.editSegmentIndex)
    if (!(isEdge || isSegment)) return
    // 共通設定と同じ順序（表示→文字→数値→書体→位置）に固定する。
    const visibleField = isEdge ? 'edge-visible' : 'segment-visible'
    const textField = isEdge ? 'edge-custom-text' : 'segment-custom-text'
    const rotationField = isEdge ? 'edge-rotation-offset' : 'segment-rotation-offset'
    const visibleLabel = '寸法を表示'
    const approximateControl = isEdge ? '<button class="ctrl-btn preset-button dimension-auto-value-control" type="button" data-action="apply-legacy-approx" data-approx-scope="part" title="約を付け、小数1桁・切捨て・-0.1m補正にします">約表示</button>' : ''
    const commonVisible = ['lot', 'road', 'water', 'cutout'].includes(object.kind)
      ? object.visibility?.dimensions !== false
      : object.dimensionStyle?.visible !== false
    dom.commandControls.replaceChildren()
    dom.commandControls.insertAdjacentHTML('beforeend', `<div class="dimension-editor-row dimension-value-row"><span class="dimension-target-slot"></span><span class="control-label dimension-common-state" data-state="${commonVisible ? 'on' : 'off'}">共通表示：${commonVisible ? 'ON' : 'OFF'}</span><label class="check-control"><input data-field="${visibleField}" type="checkbox" checked>${visibleLabel}</label><label class="field-inline"><span>表示文字</span><input class="ctrl-input wide" data-field="${textField}" type="text" placeholder="空欄で自動寸法"></label>${approximateControl}<label class="field-inline dimension-auto-value-control"><span>小数</span><select class="ctrl-select compact-select" data-field="part-decimals"><option value="0">整数</option><option value="1">1桁</option><option value="2">2桁</option></select></label><label class="field-inline dimension-auto-value-control"><span>丸め</span><select class="ctrl-select compact-select" data-field="part-rounding"><option value="round">四捨五入</option><option value="floor">切捨て</option><option value="ceil">切上げ</option></select></label><label class="field-inline dimension-auto-value-control"><span>補正</span><input class="ctrl-input number-small" data-field="part-adjustment" type="number" step="0.01"><em>m</em></label></div><div class="dimension-editor-row dimension-style-row"><span class="control-section-title">書式・位置</span><label class="field-inline"><span>書体</span><select class="ctrl-select compact-select" data-field="part-font">${fontOptionsMarkup()}</select></label><label class="field-inline"><span>大きさ</span><input class="ctrl-input number-small" data-field="part-size" type="number" min="0.2" max="5" step="0.1"><em>倍</em></label>${colorSelectMarkup('part-color', '寸法色', 'dimension')}<label class="field-inline"><span>角度</span><input class="ctrl-input number-small" data-field="${rotationField}" type="number" step="1"><em>°</em></label><button class="ctrl-btn" type="button" data-action="reset-dimension-part-position">位置を自動へ戻す</button><button class="ctrl-btn" type="button" data-action="reset-dimension-part-overrides">個別設定を共通へ戻す</button></div>`)
    if (targetControl) $('.dimension-target-slot', dom.commandControls)?.replaceWith(targetControl)
  }

  function selectDimensionTarget(value) {
    const id = ui.selectedIds.length === 1 ? ui.selectedIds[0] : null
    if (!id) return
    commitPendingEdit()
    const match = String(value || '').match(/^(edge|segment):(\d+)$/)
    ui.editEdgeIndex = match?.[1] === 'edge' ? Number(match[2]) : null
    ui.editSegmentIndex = match?.[1] === 'segment' ? Number(match[2]) : null
    if (!match) runtime.edgeHover = null
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
    const isRoadLike = object.kind === 'road' || object.kind === 'water'
    const isMeasurement = ['distance', 'polyline', 'area', 'dimension'].includes(object.kind)
    const hasLineStyle = LINE_STYLE_KINDS.has(object.kind)
    const hasEditableText = !['line', 'guide', 'parallel', 'lot-table'].includes(object.kind)
    const hasSegmentSelection = Number.isInteger(ui.editEdgeIndex) || Number.isInteger(ui.editSegmentIndex)
    configureObjectEditorPages(object.kind)
    const templateId = `controls-${ui.contextPage}`
    dom.commandControls.replaceChildren(cloneTemplate(templateId))
    if (ui.contextPage === 'object-basic' && isShape && vertexButton) dom.commandControls.prepend(vertexButton)
    if (ui.contextPage === 'object-basic') {
      $$('.shape-kind-convert', dom.commandControls).forEach(element => { element.hidden = !['lot', 'road', 'water'].includes(object.kind) })
      const labelField = $('[data-field="object-label"]', dom.commandControls)
      const labelControl = labelField?.closest('label')
      if (labelControl) {
        const caption = $('span', labelControl)
        if (caption) caption.textContent = object.kind === 'road' ? '道路名' : object.kind === 'water' ? '水路名' : object.kind === 'lot' ? '名称' : '文字'
        labelControl.hidden = !hasEditableText || isRoadLike
      }
      if (isRoadLike) appendRoadBasicControls(object.kind)
    }
    if (ui.contextPage === 'object-appearance' && isRoadLike) {
      dom.commandControls.insertAdjacentHTML('beforeend', `<label class="check-control"><input data-field="road-width-visible" type="checkbox">${object.kind === 'water' ? '水路幅' : '幅員'}を表示</label>`)
    }
    if (ui.contextPage === 'object-appearance' && ['house', 'parking', 'north'].includes(object.kind)) {
      dom.commandControls.replaceChildren()
      if (object.kind === 'north') {
        dom.commandControls.insertAdjacentHTML('beforeend', `${colorSelectMarkup('textColor', '色', 'ink')}<label class="field-inline"><span>線幅</span><input class="ctrl-input number-small" data-field="stamp-line-width" type="number" min="0.5" max="10" step="0.5"></label>`)
      } else {
        const hatch = object.kind === 'house'
          ? '<label class="check-control"><input data-field="stamp-hatch" type="checkbox">斜線</label><label class="field-inline"><span>斜線間隔</span><input class="ctrl-input number-small" data-field="stamp-hatch-spacing" type="number" min="2" max="40" step="1"></label><label class="field-inline"><span>斜線角度</span><input class="ctrl-input number-small" data-field="stamp-hatch-angle" type="number" step="1"><em>°</em></label>'
          : ''
        dom.commandControls.insertAdjacentHTML('beforeend', `${colorSelectMarkup('textColor', '文字色', 'ink')}${colorSelectMarkup('stamp-stroke', '枠線', 'border')}${colorSelectMarkup('stamp-fill', '塗り', 'fill')}${hatch}<label class="field-inline"><span>線種</span><select class="ctrl-select compact-select" data-field="stamp-line-style"><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option></select></label><label class="field-inline"><span>線幅</span><input class="ctrl-input number-small" data-field="stamp-line-width" type="number" min="0.5" max="10" step="0.5"></label>`)
      }
    }
    if (ui.contextPage === 'object-text' && isShape) appendTextRoleControls(object)
    if (ui.contextPage === 'object-special') {
      if (object.kind === 'house' || object.kind === 'parking') {
        dom.commandControls.insertAdjacentHTML('beforeend', `<label class="field-inline"><span>種類</span><select class="ctrl-select compact-select" data-field="stamp-kind"><option value="house">家屋</option><option value="parking">駐車場</option></select></label><label class="field-inline"><span>幅</span><input class="ctrl-input number-small" data-field="stamp-width" type="number" min="0.1" step="0.1"><em>m</em></label><label class="field-inline"><span>奥行</span><input class="ctrl-input number-small" data-field="stamp-depth" type="number" min="0.1" step="0.1"><em>m</em></label><label class="field-inline"><span>全体倍率</span><input class="ctrl-input number-small" data-field="stamp-scale" type="number" min="0.2" max="5" step="0.1"><em>倍</em></label><label class="field-inline"><span>角度</span><input class="ctrl-input number-small" data-field="stamp-angle" type="number" step="1"><em>°</em></label><label class="check-control"><input data-field="stamp-dimensions" type="checkbox">寸法表示</label>`)
      } else if (object.kind === 'north') {
        dom.commandControls.insertAdjacentHTML('beforeend', `<label class="field-inline"><span>全体倍率</span><input class="ctrl-input number-small" data-field="stamp-scale" type="number" min="0.2" max="5" step="0.1"><em>倍</em></label><label class="field-inline"><span>角度</span><input class="ctrl-input number-small" data-field="stamp-angle" type="number" step="1"><em>°</em></label>`)
      } else if (object.kind === 'lot-table') {
        dom.commandControls.insertAdjacentHTML('beforeend', lotTableControlsMarkup())
      } else if (object.kind === 'cutout') {
        const canRestore = Boolean(object.parentShapeId && Array.isArray(object.parentOriginalPoints) && object.parentOriginalPoints.length >= 3)
        dom.commandControls.insertAdjacentHTML('beforeend', `<button class="ctrl-btn primary" type="button" data-action="restore-cutout" ${canRestore ? '' : 'disabled'}>元の区画へ戻す</button><span class="control-label context-optional">${canRestore ? '隅切り前の頂点・辺情報を正確に復元します' : '旧形式の隅切りは、隣接区画との合筆を使用してください'}</span>`)
      } else if (hasLineStyle) {
        appendGuideEditControls(object)
        dom.commandControls.insertAdjacentHTML('beforeend', `<label class="field-inline"><span>線種</span><select class="ctrl-select compact-select" data-field="object-line-style"><option value="solid">実線</option><option value="dashed">破線</option><option value="dotted">点線</option></select></label><label class="field-inline"><span>太さ</span><input class="ctrl-input number-small" data-field="object-line-width" type="number" min="0.5" max="10" step="0.5"></label>${colorSelectMarkup('object-line-color', '色', 'line')}`)
      }
    }
    if (ui.contextPage === 'object-dimension') {
      const targetControl = makeDimensionTargetControl(object)
      if (hasSegmentSelection) appendDimensionPartControls(object, targetControl)
      else if (targetControl) {
        const targetSlot = $('.dimension-target-slot', dom.commandControls)
        if (targetSlot) targetSlot.replaceWith(targetControl)
        else dom.commandControls.prepend(targetControl)
      }
    }
    $$('.lot-only', dom.commandControls).forEach(element => { element.hidden = object.kind !== 'lot' })
    $$('.shape-appearance-only', dom.commandControls).forEach(element => { element.hidden = !isShape })
    $$('.editable-text-only', dom.commandControls).forEach(element => {
      // 道路・水路の基本ページは appendRoadBasicControls が名称欄を1つだけ
      // 生成する。静的な共通名称欄をここで再表示すると二重入力になる。
      element.hidden = !hasEditableText || (ui.contextPage === 'object-basic' && isRoadLike)
    })
    $$('.measurement-only', dom.commandControls).forEach(element => { element.hidden = !isMeasurement })
    $$('.area-only', dom.commandControls).forEach(element => { element.hidden = object.kind !== 'area' })
    $$('.edge-approx-only', dom.commandControls).forEach(element => { element.hidden = !['lot', 'road', 'water', 'cutout'].includes(object.kind) })
    if (isMeasurement) $$('[data-action="center-label"]', dom.commandControls).forEach(button => { button.textContent = '寸法を自動位置へ戻す' })
    if (!isShape) {
      $$('[data-field="object-type"],[data-field="lot-number"],[data-field="lot-price"],[data-field="fill-opacity"],[data-field="show-number"],[data-field="show-label"],[data-field="show-area"],[data-field="show-tsubo"],[data-field="show-price"],[data-field="show-memo"],[data-field="show-top-label"]', dom.commandControls).forEach(field => {
        const container = field.closest('label') || field
        container.hidden = true
      })
    }
  }

  function renderCommandSurface() {
    if (runtime.renderingCommandSurface) {
      runtime.commandSurfaceRenderPending = true
      return
    }
    runtime.renderingCommandSurface = true
    try {
      renderCommandSurfaceNow()
    } finally {
      runtime.renderingCommandSurface = false
    }
    if (runtime.commandSurfaceRenderPending) {
      runtime.commandSurfaceRenderPending = false
      queueMicrotask(renderCommandSurface)
    }
  }

  function renderCommandSurfaceNow() {
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

    if (ui.selectedIds.length && session.command === 'select') showObjectEditor()
    else if (meta.template) {
      dom.commandControls.append(cloneTemplate(meta.template))
      addDynamicCommandControls(session.command)
      configureCreateCommandPages(session.command)
    } else makeInstructionControls(meta)
    appendManualFinishControls(session.command)

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
    enhanceColorSelects()
    $$('[data-field]', dom.commandControls).forEach(field => {
      const key = field.dataset.field
      if (!(key in session.form)) return
      const mixed = ui.mixedFields.has(key)
      field.toggleAttribute('data-mixed', mixed)
      if (mixed) field.setAttribute('aria-label', `${field.closest('label')?.querySelector('span')?.textContent || key}：複数値`)
      if (field.type === 'checkbox') {
        field.indeterminate = mixed
        field.checked = mixed ? false : Boolean(session.form[key])
      }
      else {
        const value = session.form[key] ?? ''
        if (mixed) {
          if (field.matches('select')) {
            const option = document.createElement('option')
            option.value = ''
            option.textContent = '複数値'
            option.dataset.mixedOption = ''
            field.prepend(option)
          } else field.placeholder = '複数値'
          field.value = ''
          return
        }
        if (field.matches('select[data-color-select]') && value && ![...field.options].some(option => option.value === String(value))) {
          const option = document.createElement('option')
          option.value = String(value)
          option.textContent = `現在の色 ${value}`
          field.prepend(option)
        }
        field.value = value
      }
    })
    syncColorSelects()
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
      const control = select.closest('[data-color-control]')
      const trigger = control?.querySelector('[data-color-trigger]')
      const current = control?.querySelector('[data-color-current]')
      const mixed = select.hasAttribute('data-mixed')
      const selectedName = select.selectedOptions?.[0]?.textContent?.trim() || '現在の色'
      const label = select.closest('.field-inline')?.querySelector(':scope > span')?.textContent?.trim() || '色'
      if (current) {
        current.style.setProperty('--selected-color', mixed ? 'transparent' : (select.value || '#ffffff'))
        current.classList.toggle('is-mixed', mixed)
      }
      if (trigger) {
        trigger.disabled = select.disabled
        trigger.title = mixed ? `${label}：複数の色` : `${label}：${selectedName} ${select.value || ''}`.trim()
        trigger.setAttribute('aria-label', trigger.title)
      }
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
    if (command === 'merge') return session.targetIds.length >= 2
    if (command === 'corner-cut') return Boolean(store.document.calibration.mpp) && session.targetIds.length === 1 && Number.isInteger(session.vertexIndex)
    if (command === 'division-guide') return count === 2
    if (command === 'lot-division-guide') return session.targetIds.length === 1 && count === 2
    if (command === 'parallel-guide') return Boolean(store.document.calibration.mpp) && count === 2
    if (['text', 'north', 'house', 'parking', 'lot-table'].includes(command)) return Boolean(runtime.pointerWorld)
    return false
  }

  function finishButtonLabel(command = session.command) {
    if (command === 'lot-draw') return '区画を確定'
    if (command === 'road-draw') return '道路・水路を確定'
    if (command === 'polyline') return '折れ線を確定'
    if (command === 'area') return '面積を確定'
    if (command === 'line') return '線を確定'
    if (command === 'split') return '分割を確定'
    if (command === 'split-all') return '一括分割を確定'
    if (command === 'merge') return session.targetIds.length >= 2 ? `${session.targetIds.length}件を合筆` : '合筆を確定'
    return '確定'
  }

  function finishCommandHint(command = session.command) {
    if (canFinishCommand()) {
      const alternatives = DOUBLE_CLICK_FINISH_COMMANDS.has(command)
        ? 'Enterキーまたはダブルクリック'
        : 'Enterキー'
      return `「${finishButtonLabel(command)}」ボタン、${alternatives}で確定します`
    }
    if (command === 'lot-draw' || command === 'road-draw' || command === 'area') return '3点以上を指定すると確定できます'
    if (command === 'polyline' || command === 'line') return '2点以上を指定すると確定できます'
    if (command === 'split') return session.targetIds.length ? '分割線を2点以上指定してください' : '分割する図形を選択してください'
    if (command === 'split-all') return '分割線を2点以上指定してください'
    if (command === 'merge') return '同じ種類で辺を共有する図形を2件以上選択してください'
    return '必要な点または対象を指定してください'
  }

  function appendManualFinishControls(command) {
    if (!MANUAL_FINISH_COMMANDS.has(command)) return
    const existingCancel = $('[data-action="cancel-command"]', dom.commandControls)
    const existingStrip = existingCancel?.closest('.action-strip')
    existingCancel?.remove()
    if (existingStrip && !existingStrip.children.length) existingStrip.remove()

    const strip = document.createElement('div')
    strip.className = 'control-group action-strip manual-finish-strip'
    const finish = document.createElement('button')
    finish.className = 'ctrl-btn primary'
    finish.type = 'button'
    finish.dataset.action = 'finish-command'
    const cancel = existingCancel || document.createElement('button')
    cancel.className = 'ctrl-btn'
    cancel.type = 'button'
    cancel.dataset.action = 'cancel-command'
    const hint = document.createElement('span')
    hint.className = 'control-label manual-finish-hint'
    hint.dataset.output = 'finish-hint'
    strip.append(finish, cancel, hint)
    dom.commandControls.append(strip)
  }

  function legacyApproxIsActive(scope = 'global') {
    const part = scope === 'part'
    return part
      ? Boolean(session.form['part-approximate'])
      : ('dimension-approximate' in session.form
          ? Boolean(session.form['dimension-approximate'])
          : Boolean(session.form.approximate))
  }

  function currentDimensionPart(object = ui.editDraft) {
    if (!object) return null
    if (Number.isInteger(ui.editEdgeIndex)) return object.edges?.[ui.editEdgeIndex] || null
    if (Number.isInteger(ui.editSegmentIndex)) return object.segments?.[ui.editSegmentIndex] || null
    return null
  }

  function dimensionPartHasOverrides(object = ui.editDraft) {
    const part = currentDimensionPart(object)
    if (!part) return false
    const legacyHidden = Number.isInteger(ui.editEdgeIndex) &&
      Array.isArray(object.hiddenEdges) && object.hiddenEdges.map(String).includes(String(ui.editEdgeIndex))
    const labelOffset = part.labelOffset || {}
    return part.hidden === true || legacyHidden ||
      (part.customText != null && String(part.customText) !== '') ||
      Math.abs(finite(labelOffset.x)) > 0.000001 || Math.abs(finite(labelOffset.y)) > 0.000001 ||
      Math.abs(finite(part.rotationOffset)) > 0.000001 ||
      Boolean(part.style && Object.keys(part.style).length)
  }

  function syncControlState() {
    const count = session.points.length
    const setOutput = (name, value) => $$(`[data-output="${name}"]`, dom.commandControls).forEach(output => { output.textContent = String(value) })
    setOutput('draft-count', count)
    setOutput('measure-step', count === 0 ? '1点目' : count === 1 ? '2点目' : '確定できます')
    setOutput('process-step', processStatusText())
    setOutput('move-all-step', count === 0 ? '1/2 基準点' : '2/2 移動先')
    const parallelDistance = Math.abs(finite(session.form['parallel-distance'], 3))
    const parallelCount = K.clamp(Math.round(finite(session.form['parallel-count'], 1)), 1, 20)
    setOutput('parallel-next', `${Number(parallelDistance.toFixed(3))}m間隔・${parallelCount}本`)
    const background = store.document.background
    setOutput('underlay-opacity', `${Math.round(finite(background.opacity, 1) * 100)}%`)
    const pageCount = Math.max(1, background.pages?.length || runtime.backgroundRuntime?.pageCount || 1)
    setOutput('page', `${Math.min(background.currentPage || 1, pageCount)} / ${pageCount}`)
    $$('[data-action="pop-point"]', dom.commandControls).forEach(button => { button.disabled = count === 0 })
    $$('[data-action="pop-point"]', dom.commandControls).forEach(button => {
      button.hidden = count === 0 || ['edge-hide', 'merge', 'corner-cut'].includes(session.command) || AUTO_COMPLETE_COMMANDS.has(session.command)
    })
    $$('[data-action="flip-parallel"]', dom.commandControls).forEach(button => {
      button.textContent = '反転'
      button.title = '基準線の反対側へ作成方向を切り替えます'
      // 平行線は2点目で自動作成するため、2点取得後にだけ表示すると
      // ユーザーが押せる瞬間がない。基準線を取る前から作成側を選べるようにする。
      button.hidden = session.command !== 'parallel-guide'
      button.classList.toggle('active', finite(session.form.parallelSign, 1) < 0)
      button.setAttribute('aria-pressed', finite(session.form.parallelSign, 1) < 0 ? 'true' : 'false')
    })
    $$('[data-action="reset-parallel-baseline"]', dom.commandControls).forEach(button => {
      // 1本ごとに自動完了して選択へ戻る現在の操作では基準線保持を行わない。
      button.hidden = true
    })
    const hasPendingOperation = count > 0 || session.targetIds.length > 0 || session.vertexIndex != null
    $$('[data-action="cancel-command"]', dom.commandControls).forEach(button => { button.textContent = hasPendingOperation ? '作図取消' : '選択へ戻る' })
    $$('[data-action="finish-command"]', dom.commandControls).forEach(button => {
      const ready = canFinishCommand()
      const label = finishButtonLabel()
      button.textContent = label
      button.disabled = !ready
      button.title = ready ? `${label}します（Enterキーでも確定できます）` : finishCommandHint()
      button.setAttribute('aria-label', button.title)
    })
    setOutput('finish-hint', finishCommandHint())
    $$('[data-action="apply-legacy-approx"]', dom.commandControls).forEach(button => {
      const active = legacyApproxIsActive(button.dataset.approxScope === 'part' ? 'part' : 'global')
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
      button.textContent = active ? '約表示 ON' : '約表示'
    })
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
    const setActionAvailability = (selector, enabled, enabledTitle, disabledTitle) => {
      $$(selector).forEach(button => {
        button.disabled = !enabled
        button.title = enabled ? enabledTitle : disabledTitle
      })
    }
    setActionAvailability('[data-action="clear-document"]', activeObjectCount > 0, '現在のページの図形をすべて消去します', '消去する図形がありません')
    setActionAvailability('[data-action="clear-guides"]', guideCount > 0, `${guideCount}本の補助線を消去します`, '消去する補助線がありません')
    setActionAvailability('[data-action="paste"]', ui.clipboard.length > 0, `${ui.clipboard.length}件を貼り付けます`, '先に図形をコピーしてください')
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
      const centered = centeredOutputOffset()
      const layout = activeOutputLayout(store.document)
      if (centered) drawingAlreadyCentered = Math.abs(centered.x - finite(layout.offsetMmX)) < 0.05 && Math.abs(centered.y - finite(layout.offsetMmY)) < 0.05
    }
    setActionAvailability('[data-action="center-drawing-on-paper"]', activeObjectCount > 0 && !drawingAlreadyCentered, '出力上の図形全体を用紙中央へ配置します', activeObjectCount ? '出力は既に用紙中央です' : '中央へ配置する図形がありません')
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
    $$('[data-action="reset-text-role-position"]', dom.commandControls).forEach(button => {
      const role = button.dataset.textPositionRole || ui.textRole
      const drafts = ui.batchDrafts.length ? ui.batchDrafts : (ui.editDraft ? [ui.editDraft] : [])
      const offset = drafts.some(draft => role === 'name'
        ? Boolean(draft.labelPosition || draft.road?.namePosition || Number.isFinite(draft.labelStyle?.x) || Number.isFinite(draft.labelStyle?.y))
        : role === 'width'
          ? Boolean(draft.road?.widthLabelPosition || draft.road?.widthLabelOffset)
          : role === 'tsubo'
            ? Boolean(draft.tsuboLabel?.position || draft.tsuboLabelPosition)
            : Boolean(draft.areaLabel?.position || draft.areaLabelPosition))
      button.disabled = !offset
      button.title = offset ? '文字位置を自動配置へ戻します' : '文字位置は既に自動配置です'
    })
    $$('[data-action="reset-metric-hidden-style"]', dom.commandControls).forEach(button => {
      const role = button.dataset.metricRole || ui.textRole
      const drafts = ui.batchDrafts.length ? ui.batchDrafts : (ui.editDraft ? [ui.editDraft] : [])
      const needsReset = drafts.some(draft => metricHiddenStyleNeedsReset(draft, role))
      button.hidden = !needsReset
      button.disabled = !needsReset
      button.title = needsReset
        ? '旧版で設定された回転・縦書き・装飾・数値書式だけを標準へ戻します'
        : '面積・坪は標準表示です'
    })
    const part = currentDimensionPart()
    const partOffset = part?.labelOffset || {}
    setActionAvailability(
      '[data-action="reset-dimension-part-position"]',
      Boolean(part) && (Math.abs(finite(partOffset.x)) > 0.000001 || Math.abs(finite(partOffset.y)) > 0.000001),
      'この寸法の位置だけを自動配置へ戻します',
      'この寸法は自動位置です'
    )
    setActionAvailability(
      '[data-action="reset-dimension-part-overrides"]',
      dimensionPartHasOverrides(),
      '表示文字・数値書式・書体・位置・角度を共通設定へ戻します',
      'この寸法は共通設定を使っています'
    )
    const manualPartTextKey = Number.isInteger(ui.editEdgeIndex)
      ? 'edge-custom-text'
      : (Number.isInteger(ui.editSegmentIndex) ? 'segment-custom-text' : null)
    const manualPartText = manualPartTextKey ? String(session.form[manualPartTextKey] ?? '').trim() : ''
    $$('.dimension-auto-value-control', dom.commandControls).forEach(container => {
      const control = container.matches('button,input,select') ? container : $('[data-field]', container)
      if (!control) return
      control.disabled = Boolean(manualPartText)
      control.title = manualPartText ? '表示文字を空欄にすると自動寸法の数値設定を使えます' : ''
      container.classList.toggle('is-disabled', Boolean(manualPartText))
    })
    if (session.command === 'typography-settings') {
      const values = typographyValuesFromForm()
      $$('[data-typography-preset]', dom.commandControls).forEach(button => {
        const preset = TYPOGRAPHY_PRESETS[button.dataset.typographyPreset]
        const matches = preset && Object.keys(preset).every(key => Math.abs(values[key] - preset[key]) < 0.001)
        button.classList.toggle('primary', Boolean(matches))
      })
    }
    $$('[data-action="paste"]', dom.commandActions).forEach(button => { button.disabled = ui.clipboard.length === 0 })
    const manualMetricState = $('[data-metric-manual-state]', dom.commandControls)
    if (manualMetricState) {
      const prefix = ui.textRole === 'tsubo' ? 'tsubo-label' : 'area-label'
      const manualText = String(session.form[`${prefix}-text`] ?? '').trim()
      manualMetricState.hidden = !manualText
      manualMetricState.textContent = '手入力表示'
      manualMetricState.classList.remove('error')
    }
    syncColorSelects()
    const step = commandStepText()
    dom.commandStep.innerHTML = `<small>${step.small}</small><strong>${step.strong}</strong>`
  }

  function processStatusText() {
    const command = session.command
    if (command === 'merge') return session.targetIds.length >= 2 ? `${session.targetIds.length}件選択・確定できます` : session.targetIds.length ? '2つ目の図形を選択' : '1つ目の図形を選択'
    if (command === 'corner-cut') return !store.document.calibration.mpp ? '先に縮尺を設定' : !session.targetIds.length ? '区画を選択' : session.vertexIndex == null ? '頂点を選択' : '確定できます'
    if (command === 'split') return !session.targetIds.length ? '区画・道路・水路を選択' : session.points.length < 2 ? `分割線 ${session.points.length}/2` : `折れ線 ${session.points.length}点・確定できます`
    if (command === 'split-all') return session.points.length < 2 ? `分割線 ${session.points.length}/2` : `折れ線 ${session.points.length}点・確定できます`
    if (command === 'division-guide') return session.points.length ? '終点を指定すると作成' : '始点を指定'
    if (command === 'lot-division-guide') return !session.targetIds.length ? '区画を選択' : session.points.length < 2 ? `基準方向 ${session.points.length}/2（2点目で自動作成）` : '自動作成します'
    if (command === 'edge-hide') return '寸法を切り替える辺を選択'
    if (command === 'parallel-guide' && !store.document.calibration.mpp) return '先に縮尺を設定'
    if (command === 'parallel-guide') {
      return session.points.length < 2
        ? `基準線 ${session.points.length}/2`
        : `${Number(Math.abs(finite(session.form['parallel-distance'], 3)).toFixed(3))}m間隔・${K.clamp(Math.round(finite(session.form['parallel-count'], 1)), 1, 20)}本`
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
    const snap = activeSnapSettings(documentModel)
    dom.statusSnap.textContent = `自動吸着 ${snap.vertex || snap.intersection || snap.edge ? 'ON' : 'OFF'}`
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
      color: session.form.color || '#172033', fontFamily: fontToken(session.form['note-font']),
      fontSize: finite(session.form['note-size'], TEXT_BASE_SIZE), rotation: finite(session.form['note-angle']),
      vertical: Boolean(session.form['note-vertical'])
    }
    if (command === 'text') return {
      id: '__preview__', kind: 'text', position, text: String(session.form['note-text'] ?? ''), style: textStyle,
      fontSize: textStyle.fontSize, rotation: textStyle.rotation, vertical: textStyle.vertical, options: { vertical: textStyle.vertical }
    }
    if (command === 'north') return {
      id: '__preview__', kind: 'north', position, text: session.form['stamp-label'] || 'N', style: { ...stampStyle, lineWidth: K.clamp(finite(session.form['stamp-line-width'], 1.4), 0.5, 10) }, fontSize: stampTextSize,
      size: finite(session.form['stamp-width'], 54), stampScale, stampTextScale,
      angle: finite(session.form['stamp-angle']), textStyle: { color: session.form.color || '#172033', fontFamily: fontToken(session.form['stamp-font']), size: stampTextSize, fontSize: stampTextSize },
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
        fill: session.form['stamp-fill'] || (command === 'parking' ? '#eef4fb' : '#edf2f8'),
        lineStyle: session.form['line-style'] || 'solid', lineWidth: K.clamp(finite(session.form['stamp-line-width'], 1.4), 0.5, 10)
      },
      textStyle: { color: session.form.color || '#253858', fontFamily: fontToken(session.form['stamp-font']), size: stampTextSize, fontSize: stampTextSize },
      fontSize: stampTextSize,
      options: {
        width: finite(session.form['stamp-width']), height: finite(session.form['stamp-depth']), scale: stampScale,
        showDimensions: Boolean(session.form['stamp-dimensions']),
        hatch: command === 'house' ? Boolean(session.form['stamp-hatch']) : false,
        hatchSpacing: command === 'house' ? K.clamp(finite(session.form['stamp-hatch-spacing'], 9), 2, 40) : undefined,
        hatchAngle: command === 'house' ? finite(session.form['stamp-hatch-angle'], 45) : undefined
      }
    }
    if (command === 'lot-table') {
      const textScale = K.clamp(finite(session.form['text-size'], 1), 0.3, 5)
      const fontSize = TEXT_BASE_SIZE * textScale
      return {
      id: '__preview__', kind: 'lot-table', position, title: String(session.form['table-title'] || '区画一覧'), scale: finite(session.form['table-scale'], 1),
      rotation: finite(session.form['table-angle']), style: { ...style, fontFamily: fontToken(session.form['font-family']), fontSize, size: fontSize, lineWidth: K.clamp(finite(session.form['table-line-width'], 0.75), 0.5, 5) }, showPrice: Boolean(session.form['table-show-price']),
      dynamic: session.form['table-mode'] !== 'snapshot', snapshot: session.form['table-mode'] === 'snapshot',
      rows: session.form['table-mode'] === 'snapshot' ? captureLotTableRows() : [],
      options: { scale: finite(session.form['table-scale'], 1), mode: session.form['table-mode'] || 'dynamic' }
    }
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
    const snap = activeSnapSettings()
    if (!(snap.vertex || snap.intersection || snap.edge)) return { dx, dy, snap: null }
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
      const count = K.clamp(Math.round(finite(session.form['parallel-count'], 1)), 1, 20)
      const baseDistanceM = Math.abs(finite(session.form['parallel-distance'], 3))
      const sign = finite(session.form.parallelSign, 1) >= 0 ? 1 : -1
      const previews = []
      for (let repeatIndex = 1; repeatIndex <= count; repeatIndex += 1) {
        const offsetM = baseDistanceM * repeatIndex * sign
        const line = K.parallelLine(session.points[0], session.points[1], offsetM / mpp)
        if (line) previews.push({ id: `__parallel__${repeatIndex}`, kind: 'parallel', points: line, text: '', style: { color: '#9b4c8d', lineStyle: 'dashed' } })
      }
      return previews
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
    const dimensionEdgeGuide = ['lot', 'road', 'water', 'cutout'].includes(selectedObject?.kind) && ui.contextPage === 'object-dimension'
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
      marquee: runtime.drag?.type === 'marquee' && runtime.drag.moved
        ? { start: K.point(runtime.drag.start), end: K.point(runtime.drag.current) }
        : null,
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
      ui.textRole = 'name'
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
      if (options.openEditor) {
        const forms = objects.map(object => {
          loadObjectForm(object)
          return deepClone(session.form)
        })
        session.form = forms[0] || {}
        const keys = new Set(forms.flatMap(form => Object.keys(form)))
        ui.mixedFields = new Set([...keys].filter(key => forms.some(form => !sameStoredValue(form[key], forms[0]?.[key]))))
      }
      const route = objectEditorRoute(objects[0].kind)
      if (!route.some(([pageId]) => pageId === ui.contextPage)) ui.contextPage = route[0]?.[0] || ''
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

  function selectionBoundsContains(bounds, pointValue) {
    return K.isPoint(pointValue) && pointValue.x >= bounds.minX && pointValue.x <= bounds.maxX && pointValue.y >= bounds.minY && pointValue.y <= bounds.maxY
  }

  function objectInsideSelectionBounds(object, bounds) {
    const objectBounds = typeof renderer.computeObjectBounds === 'function' ? renderer.computeObjectBounds(object, store.document) : null
    if (objectBounds) {
      return objectBounds.minX >= bounds.minX && objectBounds.maxX <= bounds.maxX && objectBounds.minY >= bounds.minY && objectBounds.maxY <= bounds.maxY
    }
    const anchors = [object?.position, object?.labelPosition, object?.tip].filter(K.isPoint)
    return anchors.length > 0 && anchors.every(value => selectionBoundsContains(bounds, value))
  }

  function idsInsideSelectionBounds(start, end) {
    const bounds = {
      minX: Math.min(start.x, end.x), minY: Math.min(start.y, end.y),
      maxX: Math.max(start.x, end.x), maxY: Math.max(start.y, end.y)
    }
    return allObjects().filter(object => object.visible !== false && objectInsideSelectionBounds(object, bounds)).map(object => String(object.id))
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
      'font-family': fontToken(textStyle.fontFamily),
      'text-size': fontScale(textStyle, shape ? LABEL_BASE_SIZE : TEXT_BASE_SIZE),
      'text-angle': finite(textStyle.rotation ?? textStyle.angle ?? object.rotation),
      'text-vertical': Boolean(textStyle.vertical ?? object.vertical ?? object.options?.vertical),
      textColor: textStyle.color || '#172033',
      'text-background': textStyle.background || 'transparent',
      'text-frame': textStyle.frame === true || ['box', 'frame', 'border'].includes(String(textStyle.boxStyle || '').toLowerCase()),
      'text-underline': textStyle.underline === true || String(textStyle.boxStyle || '').toLowerCase() === 'underline',
      'dimension-visible': shape ? object.visibility?.dimensions !== false : object.dimensionStyle?.visible !== false,
      'dimension-approximate': shape ? Boolean(object.dimensionStyle?.approximate) : false,
      'dimension-decimals': object.dimensionStyle?.decimals ?? object.dimensionStyle?.digits ?? 2,
      'dimension-rounding': object.dimensionStyle?.rounding || 'round',
      'dimension-adjustment': finite(object.dimensionStyle?.adjustment),
      'dimension-font': fontToken(object.dimensionStyle?.fontFamily),
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
      'stamp-hatch-spacing': finite(object.options?.hatchSpacing, 9),
      'stamp-hatch-angle': finite(object.options?.hatchAngle, 45),
      'stamp-line-width': finite(object.style?.lineWidth, 1.4),
      'road-width': finite(object.road?.widthM ?? object.road?.width, object.kind === 'water' ? 0 : 4),
      'road-width-visible': object.visibility?.width !== false,
      'road-width-font': fontToken(object.road?.widthLabelStyle?.fontFamily),
      'road-width-size': fontScale(object.road?.widthLabelStyle, ROAD_WIDTH_BASE_SIZE),
      'road-width-angle': finite(object.road?.widthLabelStyle?.rotation ?? object.road?.widthLabelStyle?.angle),
      'road-width-vertical': Boolean(object.road?.widthLabelStyle?.vertical ?? object.road?.vertical ?? object.labelStyle?.vertical),
      'road-width-color': object.road?.widthLabelStyle?.color || object.labelStyle?.color || '#475569',
      'road-width-frame': object.road?.widthLabelStyle?.frame === true || ['box', 'frame', 'border'].includes(String(object.road?.widthLabelStyle?.boxStyle || '').toLowerCase()),
      'road-width-underline': object.road?.widthLabelStyle?.underline === true || String(object.road?.widthLabelStyle?.boxStyle || '').toLowerCase() === 'underline',
      'road-width-text': object.road?.widthText ?? '',
      'table-title': object.title === false ? '' : String(object.title || '区画一覧'),
      'table-show-price': object.showPrice !== false,
      'table-line-width': finite(object.style?.lineWidth, 0.75),
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
      'part-font': fontToken(partStyle.fontFamily || object.dimensionStyle?.fontFamily),
      'part-size': fontScale(partSizeStyle, DIMENSION_BASE_SIZE),
      'part-color': partStyle.color || object.dimensionStyle?.color || '#334155',
      'stamp-line-style': object.style?.lineStyle || 'solid',
      'object-line-style': object.style?.lineStyle || 'solid',
      'object-line-width': finite(object.style?.lineWidth, 1.4),
      'object-line-color': object.style?.color || object.style?.stroke || '#253858',
      'guide-divisions': K.clamp(Math.round(finite(object.options?.divisions, 2)), 2, 20),
      'parallel-distance-edit': Math.abs(finite(object.options?.distanceM ?? object.options?.distance, 0)),
      'area-label-visible': metricLabelVisible(object, 'area'),
      'area-label-text': areaLabel.text ?? object.customAreaLabel ?? '',
      'area-label-font': fontToken(areaLabelStyle.fontFamily || object.labelStyle?.fontFamily),
      'area-label-size': fontScale(areaLabelStyle, METRIC_BASE_SIZE),
      'area-label-angle': finite(areaLabelStyle.rotation ?? areaLabelStyle.angle),
      'area-label-vertical': Boolean(areaLabelStyle.vertical),
      'area-label-color': areaLabelStyle.color || object.labelStyle?.color || '#172033',
      'area-label-frame': areaLabelStyle.frame === true || ['box', 'frame', 'border'].includes(String(areaLabelStyle.boxStyle || '').toLowerCase()),
      'area-label-underline': areaLabelStyle.underline === true || String(areaLabelStyle.boxStyle || '').toLowerCase() === 'underline',
      'area-label-decimals': areaLabelStyle.decimals ?? areaLabelStyle.digits ?? object.areaDigits ?? 2,
      'area-label-rounding': areaLabelStyle.rounding || 'round',
      'area-label-adjustment': finite(areaLabelStyle.adjustment),
      'tsubo-label-visible': metricLabelVisible(object, 'tsubo'),
      'tsubo-label-text': tsuboLabel.text ?? object.customTsuboLabel ?? '',
      'tsubo-label-font': fontToken(tsuboLabelStyle.fontFamily || object.labelStyle?.fontFamily),
      'tsubo-label-size': fontScale(tsuboLabelStyle, METRIC_BASE_SIZE),
      'tsubo-label-angle': finite(tsuboLabelStyle.rotation ?? tsuboLabelStyle.angle),
      'tsubo-label-vertical': Boolean(tsuboLabelStyle.vertical),
      'tsubo-label-color': tsuboLabelStyle.color || object.labelStyle?.color || '#172033',
      'tsubo-label-frame': tsuboLabelStyle.frame === true || ['box', 'frame', 'border'].includes(String(tsuboLabelStyle.boxStyle || '').toLowerCase()),
      'tsubo-label-underline': tsuboLabelStyle.underline === true || String(tsuboLabelStyle.boxStyle || '').toLowerCase() === 'underline',
      'tsubo-label-decimals': tsuboLabelStyle.decimals ?? tsuboLabelStyle.digits ?? object.tsuboDigits ?? 2,
      'tsubo-label-rounding': tsuboLabelStyle.rounding || 'round',
      'tsubo-label-adjustment': finite(tsuboLabelStyle.adjustment)
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
    if (touched('part-font')) style.fontFamily = fontToken(session.form['part-font'])
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
      if (['lot', 'road', 'water'].includes(object.kind)) {
        const areaScale = K.clamp(finite(session.form['area-label-size'], 1), 0.3, 5)
        const tsuboScale = K.clamp(finite(session.form['tsubo-label-size'], 1), 0.3, 5)
        const areaText = String(session.form['area-label-text'] ?? '').trim()
        const tsuboText = String(session.form['tsubo-label-text'] ?? '').trim()
        object.areaLabel = {
          ...(object.areaLabel || {}), visible: Boolean(session.form['area-label-visible']), text: areaText || null,
          style: {
            ...(object.areaLabel?.style || {}), fontFamily: fontToken(session.form['area-label-font']),
            scale: areaScale, size: METRIC_BASE_SIZE * areaScale, fontSize: METRIC_BASE_SIZE * areaScale,
            rotation: finite(session.form['area-label-angle']), angle: finite(session.form['area-label-angle']),
            vertical: Boolean(session.form['area-label-vertical']), color: session.form['area-label-color'] || '#172033',
            decimals: finite(session.form['area-label-decimals'], 2), digits: finite(session.form['area-label-decimals'], 2),
            rounding: session.form['area-label-rounding'] || 'round', adjustment: finite(session.form['area-label-adjustment']),
            background: 'transparent', boxStyle: session.form['area-label-frame'] ? 'box' : (session.form['area-label-underline'] ? 'underline' : 'none'),
            frame: Boolean(session.form['area-label-frame']), underline: Boolean(session.form['area-label-underline'])
          }
        }
        object.tsuboLabel = {
          ...(object.tsuboLabel || {}), visible: Boolean(session.form['tsubo-label-visible']), text: tsuboText || null,
          style: {
            ...(object.tsuboLabel?.style || {}), fontFamily: fontToken(session.form['tsubo-label-font']),
            scale: tsuboScale, size: METRIC_BASE_SIZE * tsuboScale, fontSize: METRIC_BASE_SIZE * tsuboScale,
            rotation: finite(session.form['tsubo-label-angle']), angle: finite(session.form['tsubo-label-angle']),
            vertical: Boolean(session.form['tsubo-label-vertical']), color: session.form['tsubo-label-color'] || '#172033',
            decimals: finite(session.form['tsubo-label-decimals'], 2), digits: finite(session.form['tsubo-label-decimals'], 2),
            rounding: session.form['tsubo-label-rounding'] || 'round', adjustment: finite(session.form['tsubo-label-adjustment']),
            background: 'transparent', boxStyle: session.form['tsubo-label-frame'] ? 'box' : (session.form['tsubo-label-underline'] ? 'underline' : 'none'),
            frame: Boolean(session.form['tsubo-label-frame']), underline: Boolean(session.form['tsubo-label-underline'])
          }
        }
        object.visibility.area = object.areaLabel.visible
        object.visibility.tsubo = object.tsuboLabel.visible
        object.customAreaLabel = object.areaLabel.text
        object.customTsuboLabel = object.tsuboLabel.text
      }
      object.labelStyle = {
        ...(object.labelStyle || {}), fontFamily: fontToken(session.form['font-family']),
        scale: finite(session.form['text-size'], 1), size: LABEL_BASE_SIZE * finite(session.form['text-size'], 1), fontSize: LABEL_BASE_SIZE * finite(session.form['text-size'], 1),
        rotation: finite(session.form['text-angle']), angle: finite(session.form['text-angle']), vertical: Boolean(session.form['text-vertical']), color: session.form.textColor || '#172033',
        background: 'transparent', boxStyle: session.form['text-frame'] ? 'box' : (session.form['text-underline'] ? 'underline' : 'none'),
        frame: Boolean(session.form['text-frame']), underline: Boolean(session.form['text-underline'])
      }
      if (object.kind === 'road' || object.kind === 'water') {
        const roadCategory = object.kind === 'water' ? 'water' : roadTypeCode(session.form['road-category'] || object.road?.type || object.kind)
        const widthScale = K.clamp(finite(session.form['road-width-size'], 1), 0.3, 5)
        object.label = String(session.form['object-label'] ?? object.label ?? '')
        object.road = {
          ...(object.road || {}), type: roadCategory, name: object.label, vertical: Boolean(session.form['text-vertical']),
          nameStyle: { ...(object.road?.nameStyle || {}), ...object.labelStyle },
          widthM: Math.max(0, finite(session.form['road-width'], object.road?.widthM)),
          width: Math.max(0, finite(session.form['road-width'], object.road?.widthM)),
          widthText: String(session.form['road-width-text'] || '') || null,
          widthLabelStyle: {
            ...(object.road?.widthLabelStyle || {}), fontFamily: fontToken(session.form['road-width-font']),
            scale: widthScale, size: ROAD_WIDTH_BASE_SIZE * widthScale, fontSize: ROAD_WIDTH_BASE_SIZE * widthScale,
            rotation: finite(session.form['road-width-angle']), angle: finite(session.form['road-width-angle']),
            vertical: Boolean(session.form['road-width-vertical']), color: session.form['road-width-color'] || '#475569',
            background: 'transparent', boxStyle: session.form['road-width-frame'] ? 'box' : (session.form['road-width-underline'] ? 'underline' : 'none'),
            frame: Boolean(session.form['road-width-frame']), underline: Boolean(session.form['road-width-underline'])
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
        fontFamily: fontToken(session.form['font-family'] || object.style?.fontFamily),
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
      if (object.kind === 'guide' && object.options?.mode === 'segment') {
        const divisions = K.clamp(Math.round(finite(session.form['guide-divisions'], object.options?.divisions || 2)), 2, 20)
        object.options = { ...(object.options || {}), divisions }
        if (Number.isFinite(Number(object.options.totalLengthM))) object.options.segmentLengthM = Number(object.options.totalLengthM) / divisions
      }
      if (object.kind === 'parallel' && Array.isArray(object.options?.baselinePoints) && object.options.baselinePoints.length >= 2) {
        const baseline = object.options.baselinePoints.slice(0, 2).map(K.point)
        const currentSign = finite(object.options?.parallelSign ?? object.options?.distanceM, 1) >= 0 ? 1 : -1
        const distanceM = Math.max(0.1, Math.abs(finite(session.form['parallel-distance-edit'], object.options?.distanceM || 3))) * currentSign
        const mpp = Math.max(0, finite(store.document.calibration?.mpp))
        const points = mpp > 0 ? K.parallelLine(baseline[0], baseline[1], distanceM / mpp) : null
        if (points) object.points = points
        object.options = { ...(object.options || {}), distanceM, parallelSign: currentSign }
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
        ...(object.dimensionStyle || {}), visible: Boolean(session.form['dimension-visible']), approximate: false,
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
        ...object.dimensionStyle, fontFamily: fontToken(session.form['font-family']),
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
          lineStyle: session.form['stamp-line-style'] || 'solid',
          lineWidth: K.clamp(finite(session.form['stamp-line-width'], object.style?.lineWidth || 1.4), 0.5, 10)
        }
        object.options = {
          ...(object.options || {}), width: object.width, height: object.height,
          showDimensions: object.showDimensions, scale: object.stampScale,
          hatch: object.kind === 'house' ? Boolean(session.form['stamp-hatch']) : false,
          hatchSpacing: object.kind === 'house' ? K.clamp(finite(session.form['stamp-hatch-spacing'], 9), 2, 40) : undefined,
          hatchAngle: object.kind === 'house' ? finite(session.form['stamp-hatch-angle'], 45) : undefined
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
        object.style = { ...(object.style || {}), lineWidth: K.clamp(finite(session.form['stamp-line-width'], object.style?.lineWidth || 1.4), 0.5, 10) }
      } else if (object.kind === 'lot-table') {
        const nextMode = session.form['table-mode'] === 'snapshot' ? 'snapshot' : 'dynamic'
        const wasSnapshot = object.dynamic === false || object.snapshot === true || object.options?.mode === 'snapshot'
        const textScale = K.clamp(finite(session.form['text-size'], 1), 0.3, 5)
        object.title = String(session.form['table-title'] || '').trim() || false
        object.showPrice = Boolean(session.form['table-show-price'])
        object.scale = K.clamp(finite(session.form['table-scale'], 1), 0.3, 5)
        object.rotation = object.angle = finite(session.form['table-angle'])
        object.style = {
          ...(object.style || {}), fontFamily: fontToken(session.form['font-family']),
          scale: textScale, size: TEXT_BASE_SIZE * textScale, fontSize: TEXT_BASE_SIZE * textScale,
          lineWidth: K.clamp(finite(session.form['table-line-width'], object.style?.lineWidth || 0.75), 0.5, 5)
        }
        object.dynamic = nextMode === 'dynamic'
        object.snapshot = nextMode === 'snapshot'
        if (nextMode === 'snapshot' && (!wasSnapshot || !Array.isArray(object.rows) || !object.rows.length)) object.rows = captureLotTableRows()
        object.options = { ...(object.options || {}), scale: object.scale, mode: nextMode }
      }
    }
  }

  function applyBatchFormToDrafts(objects = ui.batchDrafts) {
    if (!objects.length || !ui.batchTouched.size) return
    const touched = key => ui.batchTouched.has(key)
    const anyTouched = (...keys) => keys.some(touched)
    for (const object of objects) {
      const shape = ['lot', 'road', 'water', 'cutout'].includes(object.kind)
      const measurement = ['distance', 'polyline', 'area', 'dimension'].includes(object.kind)
      if (shape) {
        if (touched('lot-number')) object.number = String(session.form['lot-number'] ?? '').trim() === '' ? null : parseNumeric(session.form['lot-number'], object.number)
        if (touched('object-label')) {
          object.label = String(session.form['object-label'] ?? '')
          if (object.kind === 'road' || object.kind === 'water') object.road = { ...(object.road || {}), name: object.label }
        }
        if (touched('lot-top-label')) object.topLabel = String(session.form['lot-top-label'] ?? '')
        if (touched('lot-price')) object.price = parseNumeric(session.form['lot-price'], null)
        if (touched('object-memo')) object.memo = String(session.form['object-memo'] ?? '')
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
        if (['lot', 'road', 'water'].includes(object.kind)) {
          for (const [prefix, property] of [['area-label', 'areaLabel'], ['tsubo-label', 'tsuboLabel']]) {
            const fields = [`${prefix}-visible`, `${prefix}-text`, `${prefix}-font`, `${prefix}-size`, `${prefix}-angle`, `${prefix}-vertical`, `${prefix}-color`, `${prefix}-frame`, `${prefix}-underline`, `${prefix}-decimals`, `${prefix}-rounding`, `${prefix}-adjustment`]
            if (!fields.some(touched)) continue
            const label = { ...(object[property] || {}), style: { ...(object[property]?.style || object.labelStyle || {}) } }
            if (touched(`${prefix}-visible`)) label.visible = Boolean(session.form[`${prefix}-visible`])
            if (touched(`${prefix}-text`)) label.text = String(session.form[`${prefix}-text`] || '') || null
            if (touched(`${prefix}-font`)) label.style.fontFamily = fontToken(session.form[`${prefix}-font`])
            if (touched(`${prefix}-size`)) {
              const scale = K.clamp(finite(session.form[`${prefix}-size`], 1), 0.3, 5)
              Object.assign(label.style, { scale, size: METRIC_BASE_SIZE * scale, fontSize: METRIC_BASE_SIZE * scale })
            }
            if (touched(`${prefix}-angle`)) Object.assign(label.style, { rotation: finite(session.form[`${prefix}-angle`]), angle: finite(session.form[`${prefix}-angle`]) })
            if (touched(`${prefix}-vertical`)) label.style.vertical = Boolean(session.form[`${prefix}-vertical`])
            if (touched(`${prefix}-color`)) label.style.color = session.form[`${prefix}-color`] || '#172033'
            if (touched(`${prefix}-frame`) || touched(`${prefix}-underline`)) {
              label.style.background = 'transparent'
              label.style.boxStyle = session.form[`${prefix}-frame`] ? 'box' : (session.form[`${prefix}-underline`] ? 'underline' : 'none')
              label.style.frame = Boolean(session.form[`${prefix}-frame`])
              label.style.underline = Boolean(session.form[`${prefix}-underline`])
            }
            if (touched(`${prefix}-decimals`)) label.style.decimals = label.style.digits = K.clamp(Math.round(finite(session.form[`${prefix}-decimals`], 2)), 0, 3)
            if (touched(`${prefix}-rounding`)) label.style.rounding = session.form[`${prefix}-rounding`] || 'round'
            if (touched(`${prefix}-adjustment`)) label.style.adjustment = finite(session.form[`${prefix}-adjustment`])
            object[property] = label
            const metric = prefix === 'area-label' ? 'area' : 'tsubo'
            object.visibility[metric] = label.visible !== false
            if (metric === 'area') object.customAreaLabel = label.text
            else object.customTsuboLabel = label.text
          }
        }
        if (anyTouched('font-family', 'text-size', 'text-angle', 'text-vertical', 'textColor', 'text-frame', 'text-underline')) {
          const labelStyle = { ...(object.labelStyle || {}) }
          if (touched('font-family')) labelStyle.fontFamily = fontToken(session.form['font-family'])
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
        if (anyTouched('dimension-visible', 'dimension-approximate', 'dimension-decimals', 'dimension-rounding', 'dimension-adjustment', 'dimension-font', 'dimension-size', 'dimension-offset', 'dimensionColor')) {
          const style = { ...(object.dimensionStyle || {}) }
          if (touched('dimension-visible')) { style.visible = Boolean(session.form['dimension-visible']); object.visibility.dimensions = style.visible }
          if (touched('dimension-approximate')) style.approximate = Boolean(session.form['dimension-approximate'])
          if (touched('dimension-decimals')) style.decimals = style.digits = finite(session.form['dimension-decimals'], 2)
          if (touched('dimension-rounding')) style.rounding = session.form['dimension-rounding'] || 'round'
          if (touched('dimension-adjustment')) style.adjustment = finite(session.form['dimension-adjustment'])
          if (touched('dimension-font')) style.fontFamily = fontToken(session.form['dimension-font'])
          if (touched('dimension-size')) {
            const scale = K.clamp(finite(session.form['dimension-size'], 1), 0.2, 5)
            Object.assign(style, { scale, size: DIMENSION_BASE_SIZE * scale, fontSize: DIMENSION_BASE_SIZE * scale })
          }
          if (touched('dimension-offset')) style.offset = finite(session.form['dimension-offset'], 14)
          if (touched('dimensionColor')) style.color = session.form.dimensionColor || '#334155'
          object.dimensionStyle = style
        }
        if (Number.isInteger(ui.editEdgeIndex) && object.edges?.[ui.editEdgeIndex] && anyTouched('edge-visible', 'edge-custom-text', 'edge-rotation-offset', 'part-offset-x', 'part-offset-y', 'part-approximate', 'part-decimals', 'part-rounding', 'part-adjustment', 'part-font', 'part-size', 'part-color')) {
          applyDimensionPartForm(object, 'edge', ui.editEdgeIndex)
        }
        if ((object.kind === 'road' || object.kind === 'water') && touched('road-category')) {
          const category = object.kind === 'water' ? 'water' : roadTypeCode(session.form['road-category'])
          object.road = { ...(object.road || {}), type: category }
        }
        if ((object.kind === 'road' || object.kind === 'water') && anyTouched('road-width-visible', 'road-width', 'road-width-text', 'road-width-font', 'road-width-size', 'road-width-angle', 'road-width-vertical', 'road-width-color', 'road-width-frame', 'road-width-underline')) {
          object.road = { ...(object.road || {}), widthLabelStyle: { ...(object.road?.widthLabelStyle || {}) } }
          if (touched('road-width-visible')) object.visibility.width = Boolean(session.form['road-width-visible'])
          if (touched('road-width')) object.road.width = object.road.widthM = Math.max(0, finite(session.form['road-width'], object.road.widthM))
          if (touched('road-width-text')) object.road.widthText = String(session.form['road-width-text'] || '') || null
          if (touched('road-width-font')) object.road.widthLabelStyle.fontFamily = fontToken(session.form['road-width-font'])
          if (touched('road-width-size')) {
            const scale = K.clamp(finite(session.form['road-width-size'], 1), 0.3, 5)
            Object.assign(object.road.widthLabelStyle, { scale, size: ROAD_WIDTH_BASE_SIZE * scale, fontSize: ROAD_WIDTH_BASE_SIZE * scale })
          }
          if (touched('road-width-angle')) Object.assign(object.road.widthLabelStyle, { rotation: finite(session.form['road-width-angle']), angle: finite(session.form['road-width-angle']) })
          if (touched('road-width-vertical')) object.road.widthLabelStyle.vertical = Boolean(session.form['road-width-vertical'])
          if (touched('road-width-color')) object.road.widthLabelStyle.color = session.form['road-width-color'] || '#475569'
          if (touched('road-width-frame') || touched('road-width-underline')) {
            object.road.widthLabelStyle.background = 'transparent'
            object.road.widthLabelStyle.boxStyle = session.form['road-width-frame'] ? 'box' : (session.form['road-width-underline'] ? 'underline' : 'none')
            object.road.widthLabelStyle.frame = Boolean(session.form['road-width-frame'])
            object.road.widthLabelStyle.underline = Boolean(session.form['road-width-underline'])
          }
        }
      } else {
        if (touched('object-label')) {
          object.text = String(session.form['object-label'] ?? object.text ?? '')
          if ('label' in object) object.label = object.text
        }
        if (touched('object-memo')) object.memo = String(session.form['object-memo'] ?? '')
        if ((object.kind === 'house' || object.kind === 'parking') && touched('stamp-kind')) {
          object.kind = session.form['stamp-kind'] === 'parking' ? 'parking' : 'house'
        }
        if (anyTouched('font-family', 'text-size', 'text-angle', 'text-vertical', 'textColor', 'text-frame', 'text-underline')) {
          object.style = { ...(object.style || {}) }
          object.textStyle = { ...(object.textStyle || {}) }
          if (touched('font-family')) object.style.fontFamily = object.textStyle.fontFamily = fontToken(session.form['font-family'])
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
        if (object.kind === 'guide' && object.options?.mode === 'segment' && touched('guide-divisions')) {
          const divisions = K.clamp(Math.round(finite(session.form['guide-divisions'], object.options?.divisions || 2)), 2, 20)
          object.options = { ...(object.options || {}), divisions }
          if (Number.isFinite(Number(object.options.totalLengthM))) object.options.segmentLengthM = Number(object.options.totalLengthM) / divisions
        }
        if (object.kind === 'parallel' && Array.isArray(object.options?.baselinePoints) && object.options.baselinePoints.length >= 2 && touched('parallel-distance-edit')) {
          const baseline = object.options.baselinePoints.slice(0, 2).map(K.point)
          const currentSign = finite(object.options?.parallelSign ?? object.options?.distanceM, 1) >= 0 ? 1 : -1
          const distanceM = Math.max(0.1, Math.abs(finite(session.form['parallel-distance-edit'], object.options?.distanceM || 3))) * currentSign
          const mpp = Math.max(0, finite(store.document.calibration?.mpp))
          const points = mpp > 0 ? K.parallelLine(baseline[0], baseline[1], distanceM / mpp) : null
          if (points) object.points = points
          object.options = { ...(object.options || {}), distanceM, parallelSign: currentSign }
        }
        if ((object.kind === 'house' || object.kind === 'parking') && anyTouched('stamp-width', 'stamp-depth', 'stamp-scale', 'stamp-text-scale', 'stamp-angle', 'stamp-dimensions', 'stamp-stroke', 'stamp-fill', 'stamp-hatch', 'stamp-hatch-spacing', 'stamp-hatch-angle', 'stamp-line-style', 'stamp-line-width', 'textColor')) {
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
          if (touched('stamp-line-width')) object.style.lineWidth = K.clamp(finite(session.form['stamp-line-width'], object.style.lineWidth || 1.4), 0.5, 10)
          if (touched('stamp-hatch') && object.kind === 'house') object.options.hatch = Boolean(session.form['stamp-hatch'])
          if (touched('stamp-hatch-spacing') && object.kind === 'house') object.options.hatchSpacing = K.clamp(finite(session.form['stamp-hatch-spacing'], 9), 2, 40)
          if (touched('stamp-hatch-angle') && object.kind === 'house') object.options.hatchAngle = finite(session.form['stamp-hatch-angle'], 45)
          if (touched('textColor')) object.textStyle = { ...(object.textStyle || {}), color: session.form.textColor || '#253858' }
          Object.assign(object.options, { width: object.width, height: object.height, showDimensions: object.showDimensions, scale: finite(object.stampScale, 1) })
        }
        if (object.kind === 'north' && anyTouched('stamp-scale', 'stamp-text-scale', 'stamp-angle', 'stamp-line-width', 'textColor')) {
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
          if (touched('stamp-line-width')) object.style = { ...(object.style || {}), lineWidth: K.clamp(finite(session.form['stamp-line-width'], object.style?.lineWidth || 1.4), 0.5, 10) }
          if (touched('textColor')) object.textStyle = { ...(object.textStyle || {}), color: session.form.textColor || '#172033' }
        }
        if (object.kind === 'lot-table' && anyTouched('table-title', 'table-show-price', 'font-family', 'text-size', 'table-line-width', 'table-scale', 'table-angle', 'table-mode')) {
          const wasSnapshot = object.dynamic === false || object.snapshot === true || object.options?.mode === 'snapshot'
          if (touched('table-title')) object.title = String(session.form['table-title'] || '').trim() || false
          if (touched('table-show-price')) object.showPrice = Boolean(session.form['table-show-price'])
          object.style = { ...(object.style || {}) }
          if (touched('font-family')) object.style.fontFamily = fontToken(session.form['font-family'])
          if (touched('text-size')) {
            const scale = K.clamp(finite(session.form['text-size'], 1), 0.3, 5)
            Object.assign(object.style, { scale, size: TEXT_BASE_SIZE * scale, fontSize: TEXT_BASE_SIZE * scale })
          }
          if (touched('table-line-width')) object.style.lineWidth = K.clamp(finite(session.form['table-line-width'], object.style.lineWidth || 0.75), 0.5, 5)
          if (touched('table-scale')) object.scale = K.clamp(finite(session.form['table-scale'], 1), 0.3, 5)
          if (touched('table-angle')) object.rotation = object.angle = finite(session.form['table-angle'])
          if (touched('table-mode')) {
            const nextMode = session.form['table-mode'] === 'snapshot' ? 'snapshot' : 'dynamic'
            object.dynamic = nextMode === 'dynamic'
            object.snapshot = nextMode === 'snapshot'
            if (nextMode === 'snapshot' && (!wasSnapshot || !Array.isArray(object.rows) || !object.rows.length)) object.rows = captureLotTableRows()
            object.options = { ...(object.options || {}), mode: nextMode }
          }
          object.options = { ...(object.options || {}), scale: finite(object.scale, 1) }
        }
        if (measurement && anyTouched('dimension-visible', 'dimension-decimals', 'dimension-rounding', 'dimension-adjustment', 'dimension-size', 'dimension-offset', 'dimensionColor', 'measurement-total', 'measurement-segments', 'measurement-area', 'measurement-tsubo')) {
          const style = { ...(object.dimensionStyle || {}) }
          if (touched('dimension-visible')) style.visible = Boolean(session.form['dimension-visible'])
          style.approximate = false
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
        if (Number.isInteger(ui.editSegmentIndex) && object.segments?.[ui.editSegmentIndex] && anyTouched('segment-visible', 'segment-custom-text', 'segment-rotation-offset', 'part-offset-x', 'part-offset-y', 'part-approximate', 'part-decimals', 'part-rounding', 'part-adjustment', 'part-font', 'part-size', 'part-color')) {
          applyDimensionPartForm(object, 'segment', ui.editSegmentIndex)
        }
      }
    }
  }

  function plainRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  }

  function sameStoredValue(left, right) {
    return JSON.stringify(left) === JSON.stringify(right)
  }

  function applyDraftDelta(latest, original, draft) {
    if (!plainRecord(latest) || !plainRecord(original) || !plainRecord(draft)) return draft
    const keys = new Set([...Object.keys(original), ...Object.keys(draft)])
    for (const key of keys) {
      const before = original[key]
      const after = draft[key]
      if (sameStoredValue(before, after)) continue
      if (!(key in draft)) {
        delete latest[key]
      } else if (plainRecord(before) && plainRecord(after) && plainRecord(latest[key])) {
        applyDraftDelta(latest[key], before, after)
      } else {
        latest[key] = deepClone(after)
      }
    }
    return latest
  }

  function commitBatchEdit() {
    if (!ui.batchDrafts.length || !ui.batchTouched.size) return [...ui.selectedIds]
    applyBatchFormToDrafts()
    const changes = new Map(ui.batchDrafts.map((object, index) => [String(object.id), {
      original: deepClone(ui.batchOriginals[index] || object),
      draft: deepClone(object)
    }]))
    store.commit('一括書式編集', documentModel => {
      for (const [id, change] of changes) {
        const found = K.objectById(documentModel, id)
        if (!found) continue
        applyDraftDelta(found.object, change.original, change.draft)
      }
    })
    const current = ui.selectedIds.map(id => K.objectById(store.document, id)?.object).filter(Boolean)
    ui.batchOriginals = current.map(deepClone)
    ui.batchDrafts = current.map(deepClone)
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
    applyBatchFormToDrafts([ui.editDraft])
    const id = ui.selectedIds[0]
    const original = deepClone(ui.editOriginal || ui.editDraft)
    const draft = deepClone(ui.editDraft)
    store.commit('図形編集', documentModel => {
      const found = K.objectById(documentModel, id)
      if (!found) return
      applyDraftDelta(found.object, original, draft)
    })
    const current = K.objectById(store.document, id)?.object
    ui.editOriginal = current ? deepClone(current) : null
    ui.editDraft = current ? deepClone(current) : null
    ui.batchTouched.clear()
    return id
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
      if (session.form['scale-method'] !== 'two-point') {
        setStatus('上部の縮尺候補または任意の分母を入力してください', 1800)
        return
      }
      if (session.points.length >= 2) {
        setStatus('2点は取得済みです。実距離を入力するか「2点を取り直す」を選んでください', 2200)
        return
      }
      if (addSessionPoint(world) && session.points.length === 2) {
        if (parseNumeric(session.form['calibration-distance']) > 0) applyCalibration()
        else {
          setStatus('2点を取得しました。実距離を入力すると、このページへすぐ設定します', 0)
          focusCalibrationDistance()
        }
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
    if (command === 'select') {
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
      const selectedDimensionLot = command === 'select' && ui.contextPage === 'object-dimension' && ui.selectedIds.length === 1 && ['lot', 'road', 'water', 'cutout'].includes(currentObject()?.kind)
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
        runtime.drag = {
          type: 'marquee', start: K.point(world), current: K.point(world),
          startScreen: { ...screen }, currentScreen: { ...screen }, moved: false,
          additive: Boolean(event?.ctrlKey || event?.metaKey || event?.shiftKey),
          previousIds: [...ui.selectedIds]
        }
        setStatus('左上から右下へ囲むと、枠内の図形をまとめて選択できます', 0)
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
        ui.contextPage = 'object-text'
        ui.textRole = labelHit.kind === 'shape-tsubo-label' ? 'tsubo' : 'area'
      }
      else if (labelHit?.kind === 'shape-road-width') { ui.contextPage = 'object-text'; ui.textRole = 'width' }
      else if (labelHit?.kind === 'shape-road-name' || labelHit?.kind === 'shape-label') { ui.contextPage = 'object-text'; ui.textRole = 'name' }
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
        if (!hit || !['lot', 'road', 'water'].includes(hit.object?.kind)) { setStatus('分割する区画・道路・水路を選んでください', 1600); return }
        session.targetIds = [hit.id]
        ui.selectedIds = [hit.id]
        renderCommandSurface()
        render()
      } else addSessionPoint(world)
      return
    }
    if (command === 'split-all') { addSessionPoint(world); return }
    if (command === 'merge') {
      if (!hit || !['lot', 'road', 'water', 'cutout'].includes(hit.object?.kind)) { setStatus('合筆する区画・道路・水路・隅切りを選んでください', 1600); return }
      if (session.targetIds.includes(hit.id)) session.targetIds = session.targetIds.filter(id => id !== hit.id)
      else session.targetIds.push(hit.id)
      ui.selectedIds = [...session.targetIds]
      renderCommandSurface()
      render()
      return
    }
    if (command === 'corner-cut') {
      if (!hit || hit.object?.kind !== 'lot') { setStatus('区画の頂点を選んでください', 1600); return }
      if (hit.part !== 'vertex') { session.targetIds = [hit.id]; ui.selectedIds = [hit.id]; renderCommandSurface(); render(); return }
      session.targetIds = [hit.id]
      session.vertexIndex = hit.index
      ui.selectedIds = [hit.id]
      finishCommand()
      return
    }
    if (command === 'division-guide') {
      if (session.points.length >= 2) { setStatus('2点は取得済みです', 1200); return }
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
        if (addSessionPoint(world) && session.points.length === 2) finishCommand()
      }
      else setStatus('基準方向は指定済みです', 1200)
      return
    }
    if (command === 'parallel-guide') {
      if (session.points.length >= 2) return
      if (addSessionPoint(world) && session.points.length === 2) finishCommand()
      return
    }
    if (command === 'edge-hide') {
      const labelHit = renderer.hitLabel(screen)
      const labelObject = labelHit?.ownerId ? K.objectById(store.document, labelHit.ownerId)?.object : null
      const edgeHit = labelHit?.kind === 'shape-dimension' && ['lot', 'road', 'water', 'cutout'].includes(labelObject?.kind) && Number.isInteger(labelHit.edgeIndex)
        ? { id: labelHit.ownerId, index: labelHit.edgeIndex }
        : (hit?.type === 'shape' && ['lot', 'road', 'water', 'cutout'].includes(hit.object?.kind) && hit.part === 'edge' ? { id: hit.id, index: hit.index } : null)
      if (!edgeHit) { setStatus('図形の外周辺または寸法文字を選んでください', 1600); return }
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
      ui.scaleFlow = { reason: 'required-command', returnCommand: command, returnTargetIds: [...session.targetIds] }
      activateCommand('calibrate', { focusCanvas: false })
      setStatus(`現在のページは縮尺未設定です。縮尺を設定するまで「${COMMAND[command]?.name || command}」は確定できません`, 0)
      return false
    }
    if (command === 'text' && !String(session.form['note-text'] || '').trim()) {
      setStatus('配置する文字を入力してください', 2200)
      requestAnimationFrame(() => $('[data-field="note-text"]', dom.commandControls)?.focus({ preventScroll: true }))
      return false
    }
    if (!canFinishCommand()) {
      // A native Enter used to close the distance input can be delivered once
      // more after the successful calibration has already cleared its pair.
      // Keep the success result and message instead of reporting a false
      // "points missing" failure for that harmless trailing event.
      if (command === 'calibrate' && hasScale() && session.points.length === 0) return false
      setStatus('必要な点または対象がまだ揃っていません', 1600)
      return false
    }
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
          const labelScale = K.clamp(finite(form['text-size'], 1), 0.3, 5)
          const labelStyle = { ...documentModel.preferences.lot.labelStyle, fontFamily: fontToken(form['font-family']), scale: labelScale, size: LABEL_BASE_SIZE * labelScale, fontSize: LABEL_BASE_SIZE * labelScale }
          const dimensionScale = K.clamp(finite(form['dimension-size'], 1), 0.2, 5)
          const dimensionStyle = {
            ...documentModel.preferences.lot.dimensionStyle,
            fontFamily: fontToken(form['dimension-font']), scale: dimensionScale, size: DIMENSION_BASE_SIZE * dimensionScale, fontSize: DIMENSION_BASE_SIZE * dimensionScale,
            approximate: Boolean(form.approximate),
            decimals: finite(form['dimension-decimals'], 2), digits: finite(form['dimension-decimals'], 2),
            rounding: form['dimension-rounding'] || 'round', adjustment: finite(form['dimension-adjustment'])
          }
          documentModel.preferences.lot.style = deepClone(style)
          documentModel.preferences.lot.labelStyle = deepClone(labelStyle)
          documentModel.preferences.lot.dimensionStyle = deepClone(dimensionStyle)
          documentModel.preferences.lot.showArea = Boolean(form['show-area'])
          documentModel.preferences.lot.showTsubo = Boolean(form['show-tsubo'])
          documentModel.preferences.lot.showLengths = Boolean(form['show-lengths'])
          K.addShape(documentModel, 'lot', points, {
            style, labelStyle,
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
          const labelScale = K.clamp(finite(form['text-size'], 1), 0.3, 5)
          const labelStyle = { ...preference.labelStyle, fontFamily: fontToken(form['font-family']), scale: labelScale, size: LABEL_BASE_SIZE * labelScale, fontSize: LABEL_BASE_SIZE * labelScale, vertical: Boolean(form['text-vertical']) }
          const widthScale = K.clamp(finite(form['road-width-size'], 1), 0.3, 5)
          const widthLabelStyle = { ...(preference.widthLabelStyle || {}), fontFamily: fontToken(form['road-width-font']), scale: widthScale, size: ROAD_WIDTH_BASE_SIZE * widthScale, fontSize: ROAD_WIDTH_BASE_SIZE * widthScale, vertical: Boolean(form['text-vertical']) }
          const dimensionScale = K.clamp(finite(form['dimension-size'], 1), 0.2, 5)
          const dimensionStyle = {
            ...(preference.dimensionStyle || {}),
            fontFamily: fontToken(form['dimension-font']), scale: dimensionScale,
            size: DIMENSION_BASE_SIZE * dimensionScale, fontSize: DIMENSION_BASE_SIZE * dimensionScale,
            approximate: Boolean(form.approximate),
            decimals: finite(form['dimension-decimals'], 2), digits: finite(form['dimension-decimals'], 2),
            rounding: form['dimension-rounding'] || 'round', adjustment: finite(form['dimension-adjustment'])
          }
          preference.style = deepClone(style)
          preference.labelStyle = deepClone(labelStyle)
          preference.widthLabelStyle = deepClone(widthLabelStyle)
          preference.dimensionStyle = deepClone(dimensionStyle)
          preference.vertical = Boolean(form['text-vertical'])
          preference.type = String(form['road-type'] || (isWater ? '水路' : '道路'))
          preference.name = name
          preference.widthM = widthM
          preference.showArea = Boolean(form['show-area'])
          preference.showTsubo = Boolean(form['show-tsubo'])
          preference.showLengths = Boolean(form['show-lengths'])
          const shape = K.addShape(documentModel, kind, points, {
            label: name, style, labelStyle, dimensionStyle,
            road: { type: typeCode, widthM, width: widthM, name, vertical: Boolean(form['text-vertical']), nameStyle: labelStyle, widthLabelStyle },
            visibility: {
              label: Boolean(form['show-label']), number: false,
              area: Boolean(form['show-area']), tsubo: Boolean(form['show-tsubo']),
              dimensions: Boolean(form['show-lengths']), width: Boolean(form['road-width-visible']),
              approximate: Boolean(form.approximate)
            }
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
            fontFamily: fontToken(form['dimension-font']),
            scale: K.clamp(finite(form['dimension-size'], 1), 0.2, 5),
            size: DIMENSION_BASE_SIZE * K.clamp(finite(form['dimension-size'], 1), 0.2, 5),
            fontSize: DIMENSION_BASE_SIZE * K.clamp(finite(form['dimension-size'], 1), 0.2, 5),
            approximate: false,
            decimals: finite(form['dimension-decimals'], 2), digits: finite(form['dimension-decimals'], 2),
            rounding: form['dimension-rounding'] || 'round', adjustment: finite(form['dimension-adjustment'])
          }
          if (['distance', 'polyline', 'area'].includes(command)) documentModel.preferences.measurement.dimensionStyle = deepClone(dimensionStyle)
          const attributes = {
            points, style,
            text: command === 'callout' ? String(form['note-text'] || '注記') : command === 'arrow' ? String(form['note-text'] || '') : '',
            labelPosition: command === 'callout' ? points[points.length - 1] : null,
            textStyle: (command === 'callout' || command === 'arrow') ? {
              color: form.color || '#172033', fontFamily: fontToken(form['note-font']),
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
              color: form.color || '#172033', fontFamily: fontToken(form['note-font']),
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
            const lineWidth = K.clamp(finite(form['stamp-line-width'], 1.4), 0.5, 10)
            documentModel.preferences.stamp.north = {
              size, scale: stampScale, textScale: stampTextScale,
              label: String(form['stamp-label'] || 'N'), fontFamily: fontToken(form['stamp-font']), lineWidth, textColor: form.color || '#172033'
            }
            K.addEntity(documentModel, 'north', {
              position, text: String(form['stamp-label'] || 'N'), size, stampScale, stampTextScale, fontSize,
              angle: finite(form['stamp-angle']), rotation: finite(form['stamp-angle']),
              style: { color: form.color || '#172033', fontFamily: fontToken(form['stamp-font']), lineWidth, size: fontSize, fontSize },
              textStyle: { color: form.color || '#172033', fontFamily: fontToken(form['stamp-font']), size: fontSize, fontSize }, options: { size, scale: stampScale }
            })
          } else if (command === 'house' || command === 'parking') {
            const width = finite(form['stamp-width'], command === 'parking' ? 2.5 : 10)
            const height = finite(form['stamp-depth'], command === 'parking' ? 5 : 8)
            const showDimensions = Boolean(form['stamp-dimensions'])
            const stroke = form['stamp-stroke'] || '#253858'
            const fill = form['stamp-fill'] || (command === 'parking' ? '#eef4fb' : '#edf2f8')
            const hatch = command === 'house' ? Boolean(form['stamp-hatch']) : false
            const hatchSpacing = command === 'house' ? K.clamp(finite(form['stamp-hatch-spacing'], 9), 2, 40) : undefined
            const hatchAngle = command === 'house' ? finite(form['stamp-hatch-angle'], 45) : undefined
            const lineWidth = K.clamp(finite(form['stamp-line-width'], 1.4), 0.5, 10)
            const stampScale = K.clamp(finite(form['stamp-scale'], 1), 0.2, 5)
            const stampTextScale = K.clamp(finite(form['stamp-text-scale'], 1), 0.3, 5)
            const fontSize = TEXT_BASE_SIZE * stampTextScale
            documentModel.preferences.stamp[command] = {
              widthM: width, heightM: height,
              label: String(form['stamp-label'] || (command === 'parking' ? 'P' : '家屋')),
              showDimensions, stroke, fill, hatch, hatchSpacing, hatchAngle, lineWidth, scale: stampScale, textScale: stampTextScale,
              fontFamily: fontToken(form['stamp-font']), textColor: form.color || '#253858', lineStyle: form['line-style'] || 'solid'
            }
            K.addEntity(documentModel, command, {
              position, text: String(form['stamp-label'] || (command === 'parking' ? 'P' : '家屋')),
              width, height, widthM: width, heightM: height, angle: finite(form['stamp-angle']), rotation: finite(form['stamp-angle']),
              showDimensions, stampScale, stampTextScale, fontSize, style: { color: stroke, stroke, fill, lineStyle: form['line-style'] || 'solid', lineWidth, size: fontSize, fontSize },
              textStyle: { color: form.color || '#253858', fontFamily: fontToken(form['stamp-font']), size: fontSize, fontSize },
              options: { width, height, showDimensions, hatch, hatchSpacing, hatchAngle, scale: stampScale }
            })
          } else {
            const tableMode = form['table-mode'] === 'snapshot' ? 'snapshot' : 'dynamic'
            const textScale = K.clamp(finite(form['text-size'], 1), 0.3, 5)
            const fontSize = TEXT_BASE_SIZE * textScale
            K.addEntity(documentModel, 'lot-table', {
              position, title: String(form['table-title'] || '').trim() || false, scale: finite(form['table-scale'], 1), rotation: finite(form['table-angle']),
              showPrice: Boolean(form['table-show-price']), style: { color: '#253858', fontFamily: fontToken(form['font-family']), scale: textScale, size: fontSize, fontSize, lineWidth: K.clamp(finite(form['table-line-width'], 0.75), 0.5, 5) },
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
        const targetKind = K.objectById(store.document, session.targetIds[0])?.object?.kind
        let result = null
        store.commit('図形分割', documentModel => { result = K.splitShapeByPolyline(documentModel, session.targetIds[0], points) })
        if (!result) throw new Error('分割線が選択した図形を横切っていません')
        const targetName = targetKind === 'road' ? '道路' : targetKind === 'water' ? '水路' : '区画'
        restartCommand(command, `${targetName}を分割しました`)
        return true
      }
      if (command === 'split-all') {
        const kinds = [form['split-lot'] && 'lot', form['split-road'] && 'road', form['split-water'] && 'water'].filter(Boolean)
        if (!kinds.length) throw new Error('一括分割する対象を1種類以上選んでください')
        let result = []
        store.commit('一括分割', documentModel => { result = K.splitAllLotsByPolyline(documentModel, points, { kinds }) })
        if (!Array.isArray(result) || !result.length) {
          const reason = result?.failures?.[0]?.reason
          const detail = reason === 'boundary-overlap' ? '対象図形の境界と分割線が重なっています' : '分割線が対象図形を横切っていないか、折れ線が不正です'
          throw new Error(detail)
        }
        const skipped = Array.isArray(result.failures) ? result.failures.length : 0
        restartCommand(command, skipped
          ? `交差する図形を一括分割しました（成功${result.length / 2}件・対象外/失敗${skipped}件）`
          : `交差する図形を一括分割しました（${result.length / 2}件）`)
        return true
      }
      if (command === 'merge') {
        const selectedObjects = session.targetIds.map(id => K.objectById(store.document, id)?.object).filter(Boolean)
        const firstObject = selectedObjects[0]
        let adoptedDifferentAttributes = false
        if (['road', 'water'].includes(firstObject?.kind) && selectedObjects.every(object => object.kind === firstObject.kind)) {
          const firstAttributes = JSON.stringify({ label: firstObject.label, road: firstObject.road, style: firstObject.style })
          adoptedDifferentAttributes = selectedObjects.slice(1).some(object => firstAttributes !== JSON.stringify({ label: object.label, road: object.road, style: object.style }))
        }
        let result = null
        const selectedIds = [...session.targetIds]
        const hasCutout = selectedObjects.some(object => object.kind === 'cutout')
        if (hasCutout && selectedIds.length === 2) {
          let restored = null
          store.commit('合筆', documentModel => { restored = K.mergeLotShapes(documentModel, selectedIds[0], selectedIds[1], { primaryId: selectedIds[0] }) })
          result = restored ? { ok: true, shape: restored } : { ok: false, reason: 'different-kinds' }
        } else {
          store.commit('合筆', documentModel => { result = K.mergeShapeGroup(documentModel, selectedIds, { primaryId: selectedIds[0] }) })
        }
        if (!result?.ok) {
          const messages = {
            'point-contact': '点で接するだけの図形は合筆できません。一定長の辺を共有する図形を選んでください',
            disconnected: `辺でつながっていない図形があります${result?.disconnectedIds?.length ? `（${result.disconnectedIds.join(', ')}）` : ''}`,
            overlap: '重なりまたは包含のある図形は合筆できません',
            'different-kinds': '同じ種類の図形、または対応する区画と隅切りを選んでください',
            'unsupported-union': '穴または複数図形になる組み合わせは合筆できません'
          }
          throw new Error(messages[result?.reason] || '共有辺のある有効な図形を選んでください')
        }
        const mergedShape = result.shape
        const resultName = mergedShape.kind === 'road' ? '道路' : mergedShape.kind === 'water' ? '水路' : '区画'
        const sourceName = firstObject?.label || resultName
        restartCommand(command, adoptedDifferentAttributes
          ? `${resultName}を合筆しました。名称・幅・色は先に選んだ「${sourceName}」を採用しました（Ctrl+Zで戻せます）`
          : `${selectedIds.length}件の${resultName}を合筆しました`)
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
        const count = K.clamp(Math.round(finite(form['parallel-count'], 1)), 1, 20)
        const sign = finite(form.parallelSign, 1) >= 0 ? 1 : -1
        const results = []
        for (let repeatIndex = 1; repeatIndex <= count; repeatIndex += 1) {
          const offsetM = baseDistanceM * repeatIndex * sign
          const result = K.parallelLine(points[0], points[1], offsetM / mpp)
          if (result) results.push({ repeatIndex, offsetM, points: result })
        }
        if (!results.length) throw new Error('基準線を指定してください')
        const created = []
        store.commit('平行線', documentModel => {
          for (const result of results) created.push(K.addEntity(documentModel, 'parallel', {
            points: result.points, text: `${Number(Math.abs(result.offsetM).toFixed(3))}m`, style: { color: '#9b4c8d', lineStyle: 'dashed' },
            options: { distanceM: result.offsetM, baseDistanceM, repeatIndex: result.repeatIndex, parallelSign: sign, baselinePoints: points.slice(0, 2).map(K.point) }
          }))
        })
        activateCommand('select', { focusCanvas: false })
        setObjectSelection(created.map(entity => entity.id), { openEditor: true })
        setStatus(`${Number(baseDistanceM.toFixed(3))}m間隔の平行線を${created.length}本作成しました`, 2200)
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
    session.form['scale-method'] = 'two-point'
    const mapScale = mapScaleFromMpp(mpp)
    const pageNumber = Math.max(1, finite(store.document.background?.currentPage, 1))
      store.commit(`${pageNumber}ページの縮尺設定`, documentModel => {
        documentModel.calibration = {
          ...documentModel.calibration, method: 'two-point', mpp, mapScale,
        points: session.points.map(K.point), realDistanceM: realDistance
      }
    })
    return completeScaleFlow(mapScale
      ? `${pageNumber}ページの縮尺を設定しました（1:${Math.round(mapScale).toLocaleString('ja-JP')}）`
      : `${pageNumber}ページの縮尺を2点から設定しました`)
  }

  function applyManualPageScale(value) {
    const scale = parseNumeric(value)
    if (!(scale > 0)) { setStatus('縮尺の分母を入力してください', 1800); return false }
    const mpp = mppFromMapScale(scale)
    if (!(mpp > 0)) { setStatus('画像のDPIが不明です。既知の2点から縮尺を設定してください', 2400); return false }
    const pageNumber = Math.max(1, finite(store.document.background?.currentPage, 1))
    session.form['scale-method'] = 'scale'
    const current = store.document.calibration || {}
    if (Math.abs(finite(current.mpp) - mpp) > 1e-12 || Math.abs(finite(current.mapScale) - scale) > 1e-9 || current.points || current.realDistanceM) {
      store.commit(`${pageNumber}ページの縮尺設定`, documentModel => {
        documentModel.calibration = { ...documentModel.calibration, method: 'scale', mpp, mapScale: scale, points: null, realDistanceM: null }
      })
    }
    return completeScaleFlow(`${pageNumber}ページの縮尺を 1:${Math.round(scale).toLocaleString('ja-JP')} に設定しました`)
  }

  function backCurrentDraftPoint(message = '作図点を1点戻しました') {
    const removed = session.back()
    if (!removed) {
      setStatus('戻す作図点がありません', 1200)
      return false
    }
    setStatus(message, 1200)
    renderCommandSurface()
    render()
    return true
  }

  function cancelCurrentStep() {
    if (session.points.length) {
      session.points = []
      session.step = 0
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
    if (runtime.drag?.type === 'marquee') {
      const drag = runtime.drag
      drag.current = K.point(freeWorld)
      drag.currentScreen = { ...screen }
      if (!drag.moved && Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) >= 4) drag.moved = true
      dom.canvas.dataset.cursor = 'crosshair'
      if (drag.moved) setStatus(`囲み選択中：${idsInsideSelectionBounds(drag.start, drag.current).length}件`, 0)
      render()
      return
    }
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
        const snap = activeSnapSettings()
        const snapping = snap.vertex || snap.intersection || snap.edge
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
    const selectedDimensionLot = session.command === 'select' && ui.contextPage === 'object-dimension' && ui.selectedIds.length === 1 && ['lot', 'road', 'water', 'cutout'].includes(currentObject()?.kind)
    if (session.command === 'select') {
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
      runtime.edgeHover = labelHit?.kind === 'shape-dimension' && ['lot', 'road', 'water', 'cutout'].includes(labelObject?.kind) && Number.isInteger(labelHit.edgeIndex)
        ? { id: labelHit.ownerId, index: labelHit.edgeIndex }
        : (edgeHit?.type === 'shape' && ['lot', 'road', 'water', 'cutout'].includes(edgeHit.object?.kind) && edgeHit.part === 'edge' ? { id: edgeHit.id, index: edgeHit.index } : null)
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
    if (runtime.drag?.type === 'marquee') {
      const drag = runtime.drag
      runtime.drag = null
      dom.canvas.dataset.cursor = ''
      try { dom.canvas.releasePointerCapture?.(event.pointerId) } catch (_) { /* capture may already be gone */ }
      if (event.type === 'pointercancel' || !drag.moved) {
        if (event.type !== 'pointercancel') setObjectSelection([], { openEditor: false })
        render()
        setStatus(event.type === 'pointercancel' && drag.previousIds.length ? '囲い選択を取り消し、元の選択を保持しました' : '選択を解除しました', 1400)
        return
      }
      const enclosed = idsInsideSelectionBounds(drag.start, drag.current)
      const ids = drag.additive ? [...new Set([...drag.previousIds, ...enclosed])] : enclosed
      setObjectSelection(ids, { openEditor: true })
      setStatus(ids.length ? `${ids.length}件を囲み選択しました` : '枠内に図形がありません', 1600)
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

  function underlayVisualState(background = store.document.background) {
    return {
      type: background?.type || null,
      source: typeof background?.source === 'string' ? background.source : null,
      currentPage: Math.max(1, Math.trunc(finite(background?.currentPage, 1))),
      imageRotation: ((Math.trunc(finite(background?.imageRotation)) % 360) + 360) % 360
    }
  }

  function sameUnderlayVisualState(left, right) {
    return Boolean(left) && Boolean(right) &&
      left.type === right.type && left.source === right.source &&
      left.currentPage === right.currentPage && left.imageRotation === right.imageRotation
  }

  function underlayRuntimeModel(background = store.document.background) {
    return {
      ...background,
      metadata: deepClone(background?.metadata || {}),
      pages: Array.isArray(background?.pages) ? background.pages.map(item => deepClone(item)) : []
    }
  }

  function updateUnderlayPageWithoutHistory(nextPage, renderedBackground) {
    // Page navigation is view state. It must not create an Undo entry or turn a
    // clean project dirty, while K.setActivePage still restores page-local
    // calibration and drawings.
    const dirty = store.dirty
    K.setActivePage(store.document, nextPage)
    if (renderedBackground?.width > 0 && renderedBackground?.height > 0) {
      store.document.background.width = renderedBackground.width
      store.document.background.height = renderedBackground.height
    }
    store.dirty = dirty
    store.emit({ type: 'view', label: '下絵ページ' })
  }

  async function destroyBackgroundRuntime(options = {}) {
    if (options.invalidate !== false) {
      runtime.backgroundTaskToken += 1
      runtime.backgroundSyncRequest += 1
    }
    const previous = runtime.backgroundRuntime
    runtime.backgroundRuntime = null
    runtime.backgroundSource = null
    runtime.backgroundVisualState = null
    renderer.clearBackgroundSources()
    try { await previous?.destroy?.() } catch (_) { /* release best effort */ }
  }

  async function synchronizeBackgroundRuntime(options = {}) {
    runtime.backgroundSyncRequest += 1
    const targetState = underlayVisualState()
    const ready = targetState.type
      ? Boolean(runtime.backgroundRuntime && runtime.backgroundSource)
      : !runtime.backgroundRuntime && !runtime.backgroundSource
    if (!options.force && ready && sameUnderlayVisualState(runtime.backgroundVisualState, targetState)) return true

    const token = ++runtime.backgroundTaskToken
    const previous = runtime.backgroundRuntime
    runtime.backgroundRuntime = null
    runtime.backgroundSource = null
    runtime.backgroundVisualState = null
    renderer.clearBackgroundSources()
    try { await previous?.destroy?.() } catch (_) { /* release best effort */ }
    if (token !== runtime.backgroundTaskToken) return false

    const background = underlayRuntimeModel()
    if (!background.type) {
      runtime.backgroundVisualState = targetState
      render()
      return true
    }
    if (typeof IO.createUnderlayRuntime !== 'function' || typeof IO.renderUnderlayPage !== 'function') {
      setStatus('下絵の復元機能を初期化できませんでした', 2600)
      return false
    }

    let nextRuntime = null
    try {
      nextRuntime = await IO.createUnderlayRuntime(background)
      if (token !== runtime.backgroundTaskToken) {
        try { await nextRuntime?.destroy?.() } catch (_) { /* stale runtime */ }
        return false
      }
      const pageNumber = Math.max(1, finite(targetState.currentPage, 1))
      const result = await IO.renderUnderlayPage(nextRuntime, background, pageNumber, { scale: background.type === 'pdf' ? 4.2 : 1, maxPixels: 80_000_000 })
      if (token !== runtime.backgroundTaskToken || result?.cancelled) {
        try { await nextRuntime?.destroy?.() } catch (_) { /* stale runtime */ }
        return false
      }
      runtime.backgroundRuntime = nextRuntime
      runtime.backgroundSource = result?.canvas || null
      runtime.backgroundVisualState = targetState
      if (runtime.backgroundSource) renderer.setBackgroundSource(runtime.backgroundSource, 'default')
      renderCommandSurface()
      render()
      return true
    } catch (error) {
      try { await nextRuntime?.destroy?.() } catch (_) { /* release failed runtime */ }
      if (token === runtime.backgroundTaskToken) setStatus(`下絵の復元に失敗: ${error?.message || error}`, 3000)
      return false
    }
  }

  function scheduleBackgroundSynchronization() {
    const targetState = underlayVisualState()
    const ready = targetState.type
      ? Boolean(runtime.backgroundRuntime && runtime.backgroundSource)
      : !runtime.backgroundRuntime && !runtime.backgroundSource
    if (ready && sameUnderlayVisualState(runtime.backgroundVisualState, targetState)) return
    const request = ++runtime.backgroundSyncRequest
    runtime.backgroundTaskToken += 1
    runtime.backgroundSource = null
    renderer.clearBackgroundSources()
    Promise.resolve().then(() => {
      if (request !== runtime.backgroundSyncRequest) return
      void synchronizeBackgroundRuntime()
    })
  }

  async function showUnderlayPage(pageNumber = store.document.background.currentPage || 1) {
    const background = store.document.background
    if (!runtime.backgroundRuntime || !background.type || typeof IO.renderUnderlayPage !== 'function') return false
    const taskRuntime = runtime.backgroundRuntime
    const token = ++runtime.backgroundTaskToken
    const count = Math.max(1, background.pages?.length || background.pageCount || runtime.backgroundRuntime.pageCount || 1)
    const nextPage = K.clamp(Math.round(finite(pageNumber, 1)), 1, count)
    const previousPage = Math.max(1, finite(background.currentPage, 1))
    const pageChanged = nextPage !== previousPage
    let currentCommand = session.command
    if (pageChanged) {
      flushActiveEditor()
      // Clear old-page state before the asynchronous PDF render starts. If it
      // is cleared after await, quick calibration clicks made while rendering
      // are silently discarded when the render finishes.
      cancelTransient(false)
      ui.selectedIds = []
      ui.registryIds.clear()
    }
    setStatus(`下絵 ${nextPage}ページを描画中…`)
    try {
      // IO mutates currentPage and page dimensions while rendering. Delay those
      // changes until the requested PDF page completed successfully.
      const renderedBackground = underlayRuntimeModel(background)
      const result = await IO.renderUnderlayPage(taskRuntime, renderedBackground, nextPage, { scale: background.type === 'pdf' ? 4.2 : 1, maxPixels: 80_000_000 })
      if (token !== runtime.backgroundTaskToken || taskRuntime !== runtime.backgroundRuntime || result?.cancelled) return false
      runtime.backgroundSource = result?.canvas || null
      if (runtime.backgroundSource) renderer.setBackgroundSource(runtime.backgroundSource, 'default')
      updateUnderlayPageWithoutHistory(nextPage, renderedBackground)
      runtime.backgroundVisualState = underlayVisualState()
      if (pageChanged) {
        // Selection, edit drafts and command points were tied to the old page.
        if (!hasScale() && store.document.background?.type) {
          currentCommand = 'calibrate'
          ui.scaleFlow = { reason: 'page-changed', returnCommand: null, returnTargetIds: [] }
        }
        if (COMMAND[currentCommand]) {
          session.activate(currentCommand, defaultForm(currentCommand))
          session.category = COMMAND[currentCommand].category
        }
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
      if (token === runtime.backgroundTaskToken) setStatus(error?.message || '下絵を描画できませんでした', 2600)
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
      if (!replace) prepareForDocumentReplacement()
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
        resetDocumentScopedUiState({ resetViews: true })
        runtime.currentProjectPath = null
      }
      ui.documentName = file.name || ui.documentName
      // Enter calibration before waiting for the PDF raster. This makes the
      // visible scale UI authoritative immediately and avoids resetting a
      // point pair that the user starts while a large PDF is still rendering.
      ui.scaleFlow = { reason: 'underlay-loaded', returnCommand: null, returnTargetIds: [] }
      activateCommand('calibrate', { focusCanvas: false })
      await showUnderlayPage(store.document.background.currentPage || 1)
      if (session.command === 'calibrate' && session.points.length === 0 && !hasScale()) {
        setStatus(`${file.name || '下絵'} を読み込みました。現在のページの縮尺を候補から選ぶか、既知寸法の2点で設定してください`, 0)
      }
      return true
    } catch (error) {
      setStatus(error?.message || '下絵を読み込めませんでした', 3000)
      return false
    }
  }

  function serializeCurrentProject() {
    if (typeof IO.serializeProject === 'function') return IO.serializeProject(store.document, { view: runtime.view, name: ui.documentName, appVersion: K.APP_VERSION })
    return JSON.stringify({ format: 'kozu-measure', version: K.SCHEMA_VERSION, appVersion: K.APP_VERSION, document: store.document, view: runtime.view, meta: { name: ui.documentName } }, null, 2)
  }

  async function saveProject(options = {}) {
    try {
      flushActiveEditor()
      const contents = serializeCurrentProject()
      const fileName = safeFileName(ui.documentName.replace(/\.(pdf|png|jpe?g|webp)$/i, '') || 'kozu-project', '.kozu.json')
      const payload = { fileName, contents }
      if (!options.saveAs && runtime.currentProjectPath) payload.outputPath = runtime.currentProjectPath
      if (typeof desktop.saveProject === 'function') {
        const result = await desktop.saveProject(payload)
        if (result?.canceled) { setStatus('編集データの保存をキャンセルしました', 1600); return false }
        if (result?.success === false) throw new Error('編集データを保存できませんでした')
        if (result?.path) runtime.currentProjectPath = result.path
        if (result?.fileName) ui.documentName = result.fileName
      } else if (options.forClose && typeof desktop.saveProjectBeforeClose === 'function') {
        const result = await desktop.saveProjectBeforeClose(payload)
        if (result?.canceled) { setStatus('編集データの保存をキャンセルしました', 1600); return false }
        if (result?.path) runtime.currentProjectPath = result.path
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
    flushActiveEditor()
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

  async function openProjectFile(file, options = {}) {
    if (!file) return false
    if (!options.skipConfirm && !(await confirmBeforeReplacingDocument('作業ファイルを開く'))) {
      setStatus('作業ファイルを開く操作をキャンセルしました', 1600)
      return false
    }
    try {
      setStatus(`${file.name} を開いています…`)
      const loaded = typeof IO.openProjectFile === 'function'
        ? await IO.openProjectFile(file, { hydrateBackground: false })
        : { document: K.normalizeDocument(JSON.parse(await file.text())), view: runtime.view, runtime: null }
      await destroyBackgroundRuntime()
      prepareForDocumentReplacement()
      store.replace(loaded.document, { clean: true })
      resetDocumentScopedUiState({ resetViews: true })
      runtime.view = loaded.view ? { ...runtime.view, ...loaded.view } : runtime.view
      ui.documentName = loaded.meta?.name || file.name || '無題'
      runtime.currentProjectPath = typeof options.projectPath === 'string' ? options.projectPath : null
      await synchronizeBackgroundRuntime({ force: true })
      activateCommand('select', { focusCanvas: false })
      store.markSaved()
      setStatus(loaded.migratedFrom
        ? `旧形式 v${loaded.migratedFrom} を新形式へ移行しました${loaded.warnings?.length ? `。${loaded.warnings[0]}` : ''}`
        : '作業ファイルを開きました', loaded.warnings?.length ? 5200 : 2600)
      return true
    } catch (error) {
      setStatus(error?.message || '作業ファイルを開けませんでした', 3200)
      return false
    }
  }

  async function openProjectFromDialog() {
    if (typeof desktop.openProject !== 'function') {
      dom.projectInput?.click()
      return false
    }
    if (!(await confirmBeforeReplacingDocument('作業ファイルを開く'))) {
      setStatus('作業ファイルを開く操作をキャンセルしました', 1600)
      return false
    }
    try {
      const result = await desktop.openProject()
      if (result?.canceled) { setStatus('作業ファイルを開く操作をキャンセルしました', 1600); return false }
      if (!result?.success || typeof result.contents !== 'string') throw new Error('作業ファイルを読み込めませんでした')
      const file = { name: result.fileName || 'kozu-project.kozu.json', text: async () => result.contents }
      return openProjectFile(file, { skipConfirm: true, projectPath: result.path })
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

  function renderRegistry(options = {}) {
    if (!dom.registryRows) return
    const scrollContainer = dom.registryRows.closest('.registry-table-wrap')
    const preserveScroll = options.preserveScroll !== false
    const scrollPosition = scrollContainer
      ? { top: scrollContainer.scrollTop, left: scrollContainer.scrollLeft }
      : null
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
    const summary = K.registrySummary(documentModel)
    const totals = summary.totals
    const lots = totals.lotCount || 0
    const roads = totals.roadCount || 0
    const waters = totals.waterCount || 0
    const notes = active?.entities.length || 0
    const priceTotal = totals.price
    dom.registrySummary.textContent = `区画 ${lots}・道路 ${roads}・水路 ${waters}・要素 ${notes}・価格合計 ${Math.round(priceTotal).toLocaleString('ja-JP')}万円`
    if (dom.registryAreaSummary) {
      const calibrated = finite(documentModel.calibration?.mpp) > 0
      const groups = {
        all: { count: totals.includedCount, area: totals.includedAreaM2, tsubo: totals.includedTsubo },
        lot: { count: totals.lotCount, area: totals.lotAreaM2, tsubo: totals.lotTsubo },
        road: { count: totals.roadCount, area: totals.roadAreaM2, tsubo: totals.roadTsubo },
        water: { count: totals.waterCount, area: totals.waterAreaM2, tsubo: totals.waterTsubo }
      }
      const activeFilter = byId('registry-filter')?.value || 'all'
      dom.registryAreaSummary.hidden = ui.registryTab !== 'lots'
      $$('[data-registry-area-filter]', dom.registryAreaSummary).forEach(button => {
        const key = button.dataset.registryAreaFilter
        const group = groups[key] || groups.all
        const hasUnscaledObjects = group.count > 0 && !calibrated
        const areaText = hasUnscaledObjects ? '縮尺未設定' : `${formatArea(group.area)}㎡`
        const tsuboText = hasUnscaledObjects ? '縮尺未設定' : `${formatArea(group.tsubo)}坪`
        const countNode = $(`[data-registry-total-count="${key}"]`, button)
        const areaNode = $(`[data-registry-total-area="${key}"]`, button)
        const tsuboNode = $(`[data-registry-total-tsubo="${key}"]`, button)
        if (countNode) countNode.textContent = String(group.count || 0)
        if (areaNode) areaNode.textContent = areaText
        if (tsuboNode) tsuboNode.textContent = tsuboText
        button.classList.toggle('active', key === activeFilter)
        button.setAttribute('aria-pressed', String(key === activeFilter))
        button.title = `${key === 'all' ? '区画・道路・水路 合計' : key === 'lot' ? '区画' : key === 'road' ? '道路' : '水路'}: ${group.count || 0}件 / ${areaText} / ${tsuboText}`
      })
    }
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
    const activeLots = (active?.shapes || []).filter(shape => shape.kind === 'lot')
    const needsRenumber = activeLots.length > 0 && K.lotNumbersNeedRenumber(store.document, active?.id)
    $$('[data-action="renumber-lots"]').forEach(button => {
      button.disabled = activeLots.length === 0 || !needsRenumber
      button.title = activeLots.length === 0
        ? '現在のページに区画がありません'
        : !needsRenumber
          ? '区画番号は既に1からの連番です'
          : `現在のページの${activeLots.length}区画を、現在番号の小さい順に1から振り直します`
    })
    $$('[data-action="place-area-table"]').forEach(button => {
      button.disabled = lots === 0
      button.title = lots ? '現在の区画を面積表として配置' : '先に区画を作成してください'
    })
    if (scrollContainer && scrollPosition) {
      scrollContainer.scrollTop = preserveScroll ? scrollPosition.top : 0
      scrollContainer.scrollLeft = preserveScroll ? scrollPosition.left : 0
    }
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
    checkbox.setAttribute('aria-label', `${kindName}${object.number ? ` ${object.number}` : ''}を一括操作の対象にする`)
    checkbox.title = '一括操作の対象'
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
    visible.setAttribute('aria-label', `${kindName}${object.number ? ` ${object.number}` : ''}を図面に表示`)
    visible.title = '図面への表示・非表示'
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

  function paperPixelSize(paper = outputPaperModel(store.document), dpi = 96) {
    const millimeters = paper.size === 'A3' ? { short: 297, long: 420 } : { short: 210, long: 297 }
    const pixelsPerMillimeter = Math.max(1, finite(dpi, 96)) / 25.4
    const landscape = {
      width: Math.round(millimeters.long * pixelsPerMillimeter),
      height: Math.round(millimeters.short * pixelsPerMillimeter)
    }
    return paper.orientation === 'portrait' ? { width: landscape.height, height: landscape.width } : landscape
  }

  function outputFrameMetricsMm(paper = outputPaperModel(store.document)) {
    const frameVisible = paper.showFrame !== false
    return {
      inset: 5,
      titleHeight: frameVisible && paper.showTitleFrame !== false ? (paper.size === 'A3' ? 15 : 12) : 0
    }
  }

  function printableRectMm(paper = outputPaperModel(store.document)) {
    const frameMetrics = outputFrameMetricsMm(paper)
    const innerGap = paper.showFrame !== false ? 2 : 0
    const inset = frameMetrics.inset + innerGap
    const titleHeight = frameMetrics.titleHeight
    const width = Math.max(1, finite(paper.widthMm) - inset * 2)
    const height = Math.max(1, finite(paper.heightMm) - inset * 2 - titleHeight)
    return {
      left: inset, top: inset, right: inset + width, bottom: inset + height,
      width, height, centerX: inset + width / 2, centerY: inset + height / 2
    }
  }

  function outputContentBounds(documentModel = store.document) {
    const copy = deepClone(documentModel)
    const includeBackground = activeOutputLayout(copy).includeUnderlay !== false && Boolean(copy.background?.type) && copy.background.width > 0 && copy.background.height > 0
    copy.background = { ...copy.background, visible: includeBackground }
    copy.paper = { ...copy.paper, enabled: false }
    const active = page(copy)
    if (active) {
      active.shapes = active.shapes.filter(shape => shape.visible !== false)
      active.entities = active.entities.filter(entity => entity.visible !== false && (activeOutputLayout(copy).includeGuides === true || !['guide', 'parallel'].includes(entity.kind)))
    }
    if (!includeBackground && !(active?.shapes.length || active?.entities.length)) return null
    return renderer.computeBounds(copy, { page: active, includeBackground, includePaper: false })
  }

  function standardOutputScaleAtLeast(value) {
    const required = Math.max(1, finite(value, 1))
    const standard = OUTPUT_SCALE_PRESETS.find(scale => scale >= required)
    if (standard) return standard
    const nice = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10]
    const exponent = Math.floor(Math.log10(required))
    for (let power = Math.max(0, exponent - 1); power <= exponent + 2; power += 1) {
      const multiplier = 10 ** power
      const candidate = nice.map(entry => entry * multiplier).find(entry => entry >= required)
      if (candidate) return candidate
    }
    return Math.ceil(required)
  }

  function outputFitStatus(documentModel = store.document, layout = activeOutputLayout(documentModel), paper = outputPaperModel(documentModel)) {
    const active = page(documentModel)
    const mpp = Number(active?.calibration?.mpp)
    const printScale = Number(layout.printScale)
    const bounds = outputContentBounds(documentModel)
    if (!bounds || !(mpp > 0) || !(printScale > 0)) return null
    const millimetersPerWorld = mpp * 1000 / printScale
    const printable = printableRectMm(paper)
    const visual = {
      left: finite(layout.offsetMmX) + bounds.minX * millimetersPerWorld,
      right: finite(layout.offsetMmX) + bounds.maxX * millimetersPerWorld,
      top: finite(layout.offsetMmY) + bounds.minY * millimetersPerWorld,
      bottom: finite(layout.offsetMmY) + bounds.maxY * millimetersPerWorld
    }
    visual.width = visual.right - visual.left
    visual.height = visual.bottom - visual.top
    const overflow = {
      left: Math.max(0, printable.left - visual.left),
      right: Math.max(0, visual.right - printable.right),
      top: Math.max(0, printable.top - visual.top),
      bottom: Math.max(0, visual.bottom - printable.bottom)
    }
    const maxOverflow = Math.max(...Object.values(overflow))
    const widthRatio = visual.width / printable.width
    const heightRatio = visual.height / printable.height
    const usage = Math.max(widthRatio, heightRatio)
    const worldWidth = bounds.maxX - bounds.minX
    const worldHeight = bounds.maxY - bounds.minY
    const requiredScale = Math.max(
      worldWidth * mpp * 1000 / printable.width,
      worldHeight * mpp * 1000 / printable.height
    )
    const comfortableScale = Math.max(
      worldWidth * mpp * 1000 / (printable.width * 0.75),
      worldHeight * mpp * 1000 / (printable.height * 0.75)
    )
    const state = maxOverflow > 0.5 ? 'overflow' : usage < 0.45 ? 'small' : 'fit'
    const suggestedScale = state === 'overflow'
      ? standardOutputScaleAtLeast(requiredScale)
      : state === 'small' ? standardOutputScaleAtLeast(comfortableScale) : null
    return { state, overflow, maxOverflow, widthRatio, heightRatio, usage, requiredScale, suggestedScale, visual, printable }
  }

  function centeredOutputOffset(documentModel = store.document, layout = activeOutputLayout(documentModel), paper = outputPaperModel(documentModel)) {
    const bounds = outputContentBounds(documentModel)
    const active = page(documentModel)
    const mpp = Number(active?.calibration?.mpp ?? documentModel.calibration?.mpp)
    const printScale = Number(layout.printScale)
    if (!bounds || !(mpp > 0) || !(printScale > 0)) return null
    const millimetersPerWorld = mpp * 1000 / printScale
    const printable = printableRectMm(paper)
    return {
      x: printable.centerX - (bounds.minX + bounds.maxX) / 2 * millimetersPerWorld,
      y: printable.centerY - (bounds.minY + bounds.maxY) / 2 * millimetersPerWorld
    }
  }

  function ensurePhysicalOutputReady(documentModel = store.document) {
    const active = page(documentModel)
    const mpp = Number(active?.calibration?.mpp ?? documentModel.calibration?.mpp)
    if (!(mpp > 0)) throw new Error('このページの縮尺が未設定です。下絵の「ページ・縮尺」を設定してください')
    if (!(outputPrintScale(documentModel) > 0)) throw new Error('印刷縮尺が未設定です。出力の「用紙」で縮尺を選択してください')
    return true
  }

  function syncPaperControls() {
    const paper = outputPaperModel(store.document)
    const layout = activeOutputLayout(store.document)
    const values = {
      'paper-size': paper.size, 'paper-orientation': paper.orientation,
      'paper-frame-visible': paper.showFrame !== false, 'paper-underlay-visible': paper.includeUnderlay !== false,
      'paper-guides-visible': paper.includeGuides === true,
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
    const denominator = outputPrintScale(store.document)
    if (printScale) printScale.textContent = denominator ? `1:${Math.round(denominator).toLocaleString('ja-JP')}` : '未設定'
    const preset = byId('paper-print-scale-preset')
    const custom = byId('paper-print-scale-custom')
    if (preset) {
      const presetValue = denominator && OUTPUT_SCALE_PRESETS.includes(denominator) ? String(denominator) : 'custom'
      if (document.activeElement !== preset) preset.value = presetValue
    }
    if (custom && document.activeElement !== custom) custom.value = denominator ? String(denominator) : ''
    const readiness = byId('paper-output-readiness')
    const fitMessage = byId('paper-fit-status')
    const fitAction = byId('paper-fit-suggestion')
    const mpp = Number(page(store.document)?.calibration?.mpp ?? store.document.calibration?.mpp)
    if (readiness) {
      readiness.textContent = !(mpp > 0)
        ? 'このページは縮尺未設定です。下絵のページ・縮尺を設定してください。'
        : !(denominator > 0)
          ? '印刷縮尺を選択してください。'
          : `このページを 1:${Math.round(denominator).toLocaleString('ja-JP')} で出力します。配置 X ${finite(layout.offsetMmX).toFixed(1)}mm / Y ${finite(layout.offsetMmY).toFixed(1)}mm。プレビューをドラッグして配置を調整できます。`
      readiness.dataset.state = mpp > 0 && denominator > 0 ? 'ready' : 'blocked'
    }
    const fit = mpp > 0 && denominator > 0 ? outputFitStatus(store.document, layout, paper) : null
    if (fitMessage) {
      if (!fit) {
        fitMessage.textContent = '図形を作成すると、用紙への収まりを確認できます。'
        fitMessage.dataset.state = 'idle'
      } else if (fit.state === 'overflow') {
        const sides = [['左', fit.overflow.left], ['右', fit.overflow.right], ['上', fit.overflow.top], ['下', fit.overflow.bottom]]
          .filter(([, value]) => value > 0.5).map(([name, value]) => `${name}${value.toFixed(1)}mm`).join('・')
        fitMessage.textContent = `用紙からはみ出します（${sides}）。中央配置へ戻すか、候補縮尺を選んでください。`
        fitMessage.dataset.state = 'overflow'
      } else if (fit.state === 'small') {
        fitMessage.textContent = `用紙に対して小さめです（使用率 ${Math.round(fit.usage * 100)}%）。候補縮尺で大きくできます。`
        fitMessage.dataset.state = 'small'
      } else {
        fitMessage.textContent = `用紙内に収まっています（使用率 ${Math.round(fit.usage * 100)}%）。`
        fitMessage.dataset.state = 'fit'
      }
    }
    if (fitAction) {
      const suggestion = Number(fit?.suggestedScale)
      const useful = suggestion > 0 && Math.abs(suggestion - denominator) > 1e-9
      fitAction.hidden = !useful
      fitAction.dataset.outputScale = useful ? String(suggestion) : ''
      fitAction.textContent = useful
        ? (fit?.state === 'overflow'
            ? `候補 1:${Math.round(suggestion).toLocaleString('ja-JP')} で全体を収める`
            : `候補 1:${Math.round(suggestion).toLocaleString('ja-JP')} で大きくする`)
        : ''
    }
  }

  function renderOutputCanvas(targetCanvas = dom.outputPreview, options = {}) {
    if (!targetCanvas) return null
    const documentModel = deepClone(store.document)
    const storedLayout = activeOutputLayout(documentModel)
    const previewOffset = targetCanvas === dom.outputPreview ? runtime.outputDrag?.previewOffset : null
    const layout = previewOffset
      ? { ...storedLayout, offsetMmX: previewOffset.x, offsetMmY: previewOffset.y }
      : storedLayout
    const outputPaper = outputPaperModel(documentModel)
    const fullPaperSize = paperPixelSize(outputPaper)
    const size = options.size || fullPaperSize
    const outputScale = Math.min(size.width / fullPaperSize.width, size.height / fullPaperSize.height)
    const printZoom = outputPixelsPerWorldUnit(documentModel, 96)
    const renderable = Number.isFinite(printZoom) && printZoom > 0
    const paperPixelsPerMm = 96 / 25.4
    const view = {
      x: (size.width - fullPaperSize.width * outputScale) / 2 + finite(layout.offsetMmX) * paperPixelsPerMm * outputScale,
      y: (size.height - fullPaperSize.height * outputScale) / 2 + finite(layout.offsetMmY) * paperPixelsPerMm * outputScale,
      zoom: outputScale * (renderable ? printZoom : 1)
    }
    documentModel.background.visible = renderable && outputPaper.includeUnderlay !== false
    if (!renderable) {
      const active = page(documentModel)
      if (active) { active.shapes = []; active.entities = [] }
    } else if (outputPaper.includeGuides !== true) {
      const active = page(documentModel)
      if (active) active.entities = active.entities.filter(entity => !['guide', 'parallel'].includes(entity.kind))
    }
    // 出力用紙は固定座標で描き、図形だけを毎回用紙一杯へ拡大しない。
    // 枠は下の drawOutputFrame で製図用の線として一度だけ描く。
    documentModel.paper.enabled = false
    const result = renderer.renderToCanvas(documentModel, {
      canvas: targetCanvas, width: size.width, height: size.height, dpr: options.dpr || 1,
      view, fixedScale: outputScale, includeBackground: true, includePaper: false, backgroundColor: '#ffffff', transparent: false
    })
    if (targetCanvas.style) {
      targetCanvas.style.width = `${Math.round(size.width)}px`
      targetCanvas.style.height = `${Math.round(size.height)}px`
    }
    drawOutputFrame(targetCanvas, outputPaper, page(documentModel)?.calibration || documentModel.calibration, documentModel)
    return result
  }

  function drawOutputFrame(canvas, paper, calibration = {}, documentModel = store.document) {
    const context = canvas.getContext('2d')
    if (!context) return
    const width = canvas.width
    const height = canvas.height
    const millimeters = paper.size === 'A3' ? { short: 297, long: 420 } : { short: 210, long: 297 }
    const portrait = paper.orientation === 'portrait'
    const paperWidthMm = Math.max(1, finite(paper.widthMm, portrait ? millimeters.short : millimeters.long))
    const paperHeightMm = Math.max(1, finite(paper.heightMm, portrait ? millimeters.long : millimeters.short))
    const pixelsPerMmX = width / paperWidthMm
    const pixelsPerMmY = height / paperHeightMm
    const pixelsPerMm = Math.min(pixelsPerMmX, pixelsPerMmY)
    const frameMetrics = outputFrameMetricsMm(paper)
    const frameInsetX = frameMetrics.inset * pixelsPerMmX
    const frameInsetY = frameMetrics.inset * pixelsPerMmY
    const innerWidth = width - frameInsetX * 2
    const innerHeight = height - frameInsetY * 2
    context.save()
    context.strokeStyle = '#111827'
    context.fillStyle = '#111827'
    context.lineWidth = Math.max(1, 0.35 * pixelsPerMm)
    if (paper.showFrame !== false) context.strokeRect(frameInsetX, frameInsetY, innerWidth, innerHeight)
    const scaleDenominator = Number(paper.printScale) > 0 ? Number(paper.printScale) : null
    const scaleText = scaleDenominator
      ? `縮尺 1:${Math.round(scaleDenominator).toLocaleString('ja-JP')}`
      : (Number(calibration.mpp) > 0 ? '縮尺 2点校正済' : '縮尺 未設定')
    if (paper.showFrame !== false && paper.showTitleFrame !== false && (paper.title || paper.date || paper.author || paper.note || scaleText)) {
      // 一般的な図面枠に合わせ、タイトル欄は右下の大箱ではなく下端の細い帯にする。
      const boxHeight = frameMetrics.titleHeight * pixelsPerMmY
      const x = frameInsetX
      const y = height - frameInsetY - boxHeight
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

      const pad = Math.max(2, pixelsPerMm)
      const labelSize = Math.max(5, 1.7 * pixelsPerMm)
      const valueSize = Math.max(7, 2.5 * pixelsPerMm)
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
      const paperModel = outputPaperModel(store.document)
      const paper = paperPixelSize(paperModel)
      // A3を基準サイズとして表示するため、A4は縦横とも約70.7%になる。
      // 用紙を切り替えても同じ大きさにフィットしてしまう旧挙動を避ける。
      const a3Reference = paperModel.orientation === 'portrait'
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
    ensurePhysicalOutputReady()
    const size = paperPixelSize(outputPaperModel(store.document), OUTPUT_DPI)
    const canvas = document.createElement('canvas')
    renderOutputCanvas(canvas, { size, dpr: 1 })
    return canvas
  }

  async function exportPng() {
    try {
      flushActiveEditor()
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
      flushActiveEditor()
      const canvas = createExportCanvas()
      const paper = outputPaperModel(store.document)
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
    const includeGuides = byId('paper-guides-visible')?.checked === true
    const preset = byId('paper-print-scale-preset')?.value || 'custom'
    const customScale = parseNumeric(byId('paper-print-scale-custom')?.value)
    const printScale = preset === 'custom' ? customScale : parseNumeric(preset)
    ui.output.includeUnderlay = includeUnderlay
    ui.output.note = byId('paper-note')?.value || ''
    ui.output.showTitleFrame = byId('title-frame-visible')?.checked !== false
    store.commit('出力設定', documentModel => {
      const current = page(documentModel)
      if (!current) return
      const oldLayout = deepClone(current.outputLayout || K.createOutputLayout?.({}, documentModel.paper))
      const oldPaper = outputPaperModel(documentModel)
      documentModel.paper.enabled = true
      documentModel.paper.size = size
      documentModel.paper.orientation = orientation
      documentModel.paper.showFrame = byId('paper-frame-visible')?.checked !== false
      documentModel.paper.includeUnderlay = includeUnderlay
      documentModel.paper.includeGuides = includeGuides
      documentModel.paper.showTitleFrame = ui.output.showTitleFrame
      documentModel.paper.title = byId('paper-title')?.value || ''
      documentModel.paper.date = byId('paper-date')?.value || ''
      documentModel.paper.author = byId('paper-author')?.value || ''
      documentModel.paper.note = ui.output.note
      current.outputLayout = {
        ...(current.outputLayout || {}),
        paperSize: size,
        orientation,
        printScale: Number(printScale) > 0 ? Number(printScale) : null,
        showFrame: documentModel.paper.showFrame,
        showTitleFrame: documentModel.paper.showTitleFrame,
        includeUnderlay,
        includeGuides,
        initialized: current.outputLayout?.initialized === true,
        offsetMmX: finite(current.outputLayout?.offsetMmX),
        offsetMmY: finite(current.outputLayout?.offsetMmY)
      }
      documentModel.outputDefaults = {
        ...current.outputLayout,
        offsetMmX: 0,
        offsetMmY: 0,
        initialized: false
      }
      const oldScale = Number(oldLayout.printScale)
      const newScale = Number(current.outputLayout.printScale)
      const mpp = Number(current.calibration?.mpp ?? documentModel.calibration?.mpp)
      if (oldLayout.initialized && oldScale > 0 && newScale > 0 && mpp > 0) {
        const oldRect = printableRectMm(oldPaper)
        const newRect = printableRectMm(outputPaperModel(documentModel))
        const oldMmPerWorld = mpp * 1000 / oldScale
        const newMmPerWorld = mpp * 1000 / newScale
        const worldAnchorX = (oldRect.centerX - finite(oldLayout.offsetMmX)) / oldMmPerWorld
        const worldAnchorY = (oldRect.centerY - finite(oldLayout.offsetMmY)) / oldMmPerWorld
        current.outputLayout.offsetMmX = newRect.centerX - worldAnchorX * newMmPerWorld
        current.outputLayout.offsetMmY = newRect.centerY - worldAnchorY * newMmPerWorld
      } else if (!oldLayout.initialized && newScale > 0 && mpp > 0) {
        const initialOffset = centeredOutputOffset(documentModel, current.outputLayout, outputPaperModel(documentModel))
        if (initialOffset) {
          current.outputLayout.offsetMmX = initialOffset.x
          current.outputLayout.offsetMmY = initialOffset.y
          current.outputLayout.initialized = true
        }
      }
    })
    refreshOutputPreview()
  }

  function centerDrawingOnPaper() {
    const active = page(store.document)
    if (!active || !(active.shapes.length || active.entities.length)) { setStatus('中央に配置する図形がありません', 1600); return }
    try { ensurePhysicalOutputReady() } catch (error) { setStatus(error.message, 2600); return }
    const offset = centeredOutputOffset()
    if (!offset) { setStatus('図形の出力範囲を計算できませんでした', 2200); return }
    store.commit('出力を用紙中央へ配置', documentModel => {
      const current = page(documentModel)
      current.outputLayout = { ...current.outputLayout, offsetMmX: offset.x, offsetMmY: offset.y, initialized: true }
    })
    refreshOutputPreview()
    setStatus('出力上の図形全体を用紙中央へ配置しました（作図座標は変更していません）', 2200)
  }

  function applySuggestedOutputScale(source) {
    const printScale = Number(source?.dataset.outputScale)
    if (!(printScale > 0)) return false
    const active = page(store.document)
    if (!active) return false
    if (!(Number(active.calibration?.mpp) > 0)) { setStatus('先にこのページの縮尺を設定してください', 2200); return false }
    store.commit('候補縮尺で全体を配置', documentModel => {
      const current = page(documentModel)
      current.outputLayout = { ...current.outputLayout, printScale }
      const offset = centeredOutputOffset(documentModel, current.outputLayout, outputPaperModel(documentModel))
      if (offset) current.outputLayout = { ...current.outputLayout, offsetMmX: offset.x, offsetMmY: offset.y, initialized: true }
    })
    refreshOutputPreview()
    setStatus(`印刷縮尺 1:${Math.round(printScale).toLocaleString('ja-JP')} を適用し、全体を中央へ配置しました`, 2400)
    return true
  }

  function cancelOutputDrag(message = '') {
    const drag = runtime.outputDrag
    if (!drag) return false
    runtime.outputDrag = null
    dom.outputPreview?.classList.remove('is-dragging')
    try {
      if (dom.outputPreview?.hasPointerCapture?.(drag.pointerId)) dom.outputPreview.releasePointerCapture(drag.pointerId)
    } catch (_) { /* pointer capture may already be lost */ }
    refreshOutputPreview()
    if (message) setStatus(message, 1600)
    return true
  }

  function handleOutputPointerDown(event) {
    if (runtime.outputDrag || event.button !== 0) return
    try { ensurePhysicalOutputReady() } catch (error) { setStatus(error.message, 2600); return }
    const rect = dom.outputPreview?.getBoundingClientRect()
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return
    const layout = activeOutputLayout(store.document)
    runtime.outputDrag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      rectWidth: rect.width,
      rectHeight: rect.height,
      startOffset: { x: finite(layout.offsetMmX), y: finite(layout.offsetMmY) },
      previewOffset: { x: finite(layout.offsetMmX), y: finite(layout.offsetMmY) },
      moved: false
    }
    dom.outputPreview.setPointerCapture?.(event.pointerId)
    dom.outputPreview.classList.add('is-dragging')
    event.preventDefault()
  }

  function handleOutputPointerMove(event) {
    const drag = runtime.outputDrag
    if (!drag || event.pointerId !== drag.pointerId) return
    const deltaX = event.clientX - drag.startClientX
    const deltaY = event.clientY - drag.startClientY
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 2) return
    drag.moved = true
    const paper = outputPaperModel(store.document)
    drag.previewOffset = {
      x: drag.startOffset.x + deltaX * paper.widthMm / drag.rectWidth,
      y: drag.startOffset.y + deltaY * paper.heightMm / drag.rectHeight
    }
    refreshOutputPreview()
    event.preventDefault()
  }

  function handleOutputPointerUp(event) {
    const drag = runtime.outputDrag
    if (!drag || event.pointerId !== drag.pointerId) return
    if (!drag.moved) {
      cancelOutputDrag()
      event.preventDefault()
      return
    }
    const offset = { ...drag.previewOffset }
    runtime.outputDrag = null
    dom.outputPreview?.classList.remove('is-dragging')
    try {
      if (dom.outputPreview?.hasPointerCapture?.(event.pointerId)) dom.outputPreview.releasePointerCapture(event.pointerId)
    } catch (_) { /* pointer capture may already be lost */ }
    store.commit('出力配置を調整', documentModel => {
      const current = page(documentModel)
      current.outputLayout = { ...current.outputLayout, offsetMmX: offset.x, offsetMmY: offset.y, initialized: true }
    })
    refreshOutputPreview()
    setStatus(`出力配置を X ${offset.x.toFixed(1)}mm / Y ${offset.y.toFixed(1)}mm に変更しました`, 1800)
    event.preventDefault()
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
      documentModel.preferences.snap.grid = false
      for (const [field, property] of [['snap-vertex', 'vertex'], ['snap-intersection', 'intersection'], ['snap-edge', 'edge']]) {
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
            shape.areaLabel = { ...(shape.areaLabel || {}), style: sizedStyle(shape.areaLabel?.style, values.metric) }
            shape.tsuboLabel = { ...(shape.tsuboLabel || {}), style: sizedStyle(shape.tsuboLabel?.style, values.metric) }
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
      basic: { name: '基本', items: [['B', '下絵'], ['C', '縮尺'], ['V', '選択・文字・寸法編集'], ['X / ⇧X', '移動 / 全体移動'], ['Z', '頂点編集'], ['F', '全体表示'], ['H', 'ヘルプ']] },
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

  function convertSelectedShapeKind(targetKind) {
    const id = ui.selectedIds.length === 1 ? ui.selectedIds[0] : null
    const current = id ? K.objectById(store.document, id)?.object : null
    const nextKind = ['lot', 'road', 'water'].includes(targetKind) ? targetKind : null
    if (!current || !['lot', 'road', 'water'].includes(current.kind) || !nextKind) {
      setStatus('種類を変更する区画・道路・水路を1件選んでください', 1800)
      return false
    }
    if (current.kind === nextKind) return true
    const previousKind = current.kind
    commitPendingEdit()
    let converted = null
    store.commit('図形種類変更', documentModel => { converted = K.convertShapeKind(documentModel, id, nextKind) })
    if (!converted) {
      setStatus('種類を変更できませんでした', 1800)
      return false
    }
    ui.contextPage = 'object-basic'
    selectObject(id, { openEditor: true })
    const label = kind => kind === 'lot' ? '区画' : kind === 'water' ? '水路' : '道路'
    setStatus(`${label(previousKind)}から${label(nextKind)}へ変更しました。Ctrl+Zで元へ戻せます`, 2600)
    return true
  }

  function performHistoryNavigation(direction) {
    flushActiveEditor()
    const selectedBefore = [...ui.selectedIds]
    const contextBefore = ui.contextPage
    const changed = direction === 'redo' ? store.redo() : store.undo()
    if (!changed) return false
    const remaining = selectedBefore.filter(id => Boolean(K.objectById(store.document, id)?.object))
    ui.contextPage = contextBefore
    setObjectSelection(remaining, { openEditor: remaining.length > 0, preserveSubselection: true })
    // DocumentStore restores serializable data. The PDF/image runtime is not
    // part of that snapshot, so rebuild it when the visual source/page changed.
    void synchronizeBackgroundRuntime()
    return true
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
          restartCommand(session.command, '操作を取り消しました')
        }
        break
      case 'pop-point': backCurrentDraftPoint(); break
      case 'undo': performHistoryNavigation('undo'); break
      case 'redo': performHistoryNavigation('redo'); break
      case 'fit': fitView(); break
      case 'actual-size': actualSize(); break
      case 'open-underlay': dom.underlayInput?.click(); break
      case 'replace-underlay': dom.replaceInput?.click(); break
      case 'open-project': await openProjectFromDialog(); break
      case 'save-project': await saveProject(); break
      case 'save-project-as': await saveProject({ saveAs: true }); break
      case 'new-project':
        if (!(await confirmBeforeReplacingDocument('新規作成'))) {
          setStatus('新規作成をキャンセルしました', 1600)
          break
        }
        await destroyBackgroundRuntime()
        prepareForDocumentReplacement()
        store.replace(K.createDocument(), { clean: true })
        resetDocumentScopedUiState({ resetViews: true })
        runtime.view = { x: 36, y: 32, zoom: 1 }
        runtime.currentProjectPath = null
        await synchronizeBackgroundRuntime()
        ui.documentName = '無題'; activateCommand('underlay-open', { focusCanvas: false }); setStatus('新しい図面を作成しました', 1600)
        break
      case 'clear-document':
        store.commit('全図形削除', documentModel => { const active = page(documentModel); active.shapes = []; active.entities = [] })
        ui.selectedIds = []; render(); setStatus('図形をすべて削除しました（戻るで復元できます）', 2000); break
      case 'toggle-underlay': store.commit('下絵表示切替', documentModel => { documentModel.background.visible = !documentModel.background.visible }); render(); break
      case 'remove-underlay':
        await destroyBackgroundRuntime(); store.commit('下絵削除', documentModel => {
          documentModel.background = K.createDocument().background
          resetAllCalibrations(documentModel)
        }); await synchronizeBackgroundRuntime(); renderCommandSurface(); render(); setStatus('下絵を削除しました', 1500); break
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
      case 'return-from-scale':
        ui.scaleFlow = { reason: null, returnCommand: null, returnTargetIds: [] }
        activateCommand('select', { focusCanvas: false })
        setStatus('選択へ戻りました', 1200)
        break
      case 'reset-calibration-points':
        session.points = []
        session.step = 0
        runtime.hoverSnap = null
        renderCommandSurface()
        render()
        dom.canvas.focus({ preventScroll: true })
        setStatus('縮尺の始点を指定してください', 1600)
        break
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
        else if (ui.editDraft) applyBatchFormToDrafts([ui.editDraft])
        initializeFieldControls()
        syncControlState()
        render()
        if (ui.editDraft || ui.batchDrafts.length) commitPendingEdit()
        setStatus(enable ? '約表示をON：小数1桁・切捨て・-0.1m補正' : '約表示をOFF：小数2桁・四捨五入・補正なし', 2200)
        break
      }
      case 'toggle-snap':
        store.commit('吸着切替', documentModel => {
          const snap = documentModel.preferences.snap
          const enabled = !(snap.vertex || snap.intersection || snap.edge)
          Object.assign(snap, { grid: false, vertex: enabled, intersection: enabled, edge: enabled })
        }); render(); break
      case 'reset-command-defaults':
        store.commit('作図既定値初期化', documentModel => { documentModel.preferences = K.createDocument().preferences })
        activateCommand(session.command, { focusCanvas: false })
        setStatus('この図面の作図既定値を標準へ戻しました。表示中の設定にも反映しました', 2200)
        break
      case 'flip-parallel':
        session.form.parallelSign = -finite(session.form.parallelSign, 1)
        renderCommandSurface()
        render()
        setStatus('作成方向を反転しました', 1600)
        break
      case 'reset-parallel-baseline':
        session.points = []
        session.step = 0
        runtime.moveSnap = null
        renderCommandSurface()
        render()
        setStatus('平行線の新しい基準線を2点で指定してください', 1800)
        break
      case 'flip-selected-parallel': {
        const object = ui.editDraft
        const baseline = object?.options?.baselinePoints
        const mpp = Math.max(0, finite(store.document.calibration?.mpp))
        if (!object || object.kind !== 'parallel' || !Array.isArray(baseline) || baseline.length < 2 || !(mpp > 0)) {
          setStatus('この平行線は反転できません', 1600)
          break
        }
        applyBatchFormToDrafts([ui.editDraft])
        const distanceM = -finite(object.options?.distanceM, 0)
        const points = K.parallelLine(baseline[0], baseline[1], distanceM / mpp)
        if (!points) { setStatus('平行線を反転できませんでした', 1600); break }
        object.points = points
        object.options = { ...(object.options || {}), distanceM, parallelSign: distanceM >= 0 ? 1 : -1 }
        session.form['parallel-distance-edit'] = Math.abs(distanceM)
        ui.batchTouched.add('__parallel-flip')
        commitPendingEdit()
        initializeFieldControls()
        render()
        setStatus('平行線を基準線の反対側へ反転しました', 1500)
        break
      }
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
        applyBatchFormToDrafts([ui.editDraft])
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
      case 'reset-dimension-part-overrides': {
        const object = ui.editDraft
        const isEdge = Number.isInteger(ui.editEdgeIndex)
        const index = isEdge ? ui.editEdgeIndex : ui.editSegmentIndex
        const part = isEdge ? object?.edges?.[index] : object?.segments?.[index]
        if (!object || !part || !Number.isInteger(index)) { setStatus('共通へ戻す辺寸法を選んでください', 1600); break }
        applyBatchFormToDrafts([object])
        if (isEdge) setLotEdgeVisibility(object, index, true)
        else delete part.hidden
        part.customText = null
        part.labelOffset = { x: 0, y: 0 }
        part.rotationOffset = 0
        part.style = null
        ui.batchTouched.add('__dimension-part-overrides')
        const id = commitPendingEdit()
        if (id) selectObject(id, { openEditor: true, preserveSubselection: true })
        render()
        setStatus(`${isEdge ? '辺' : '区間'} ${index + 1} の個別設定を共通へ戻しました`, 1700)
        break
      }
      case 'restore-cutout': {
        const id = ui.selectedIds.length === 1 ? ui.selectedIds[0] : null
        const cutout = id ? K.objectById(store.document, id)?.object : null
        if (!cutout || cutout.kind !== 'cutout') { setStatus('元へ戻す隅切りを1件選んでください', 1600); break }
        commitPendingEdit()
        let restored = null
        store.commit('隅切りを元へ戻す', documentModel => { restored = K.restoreCutout(documentModel, id) })
        if (!restored) { setStatus('旧形式の隅切りです。区画との合筆を使用してください', 2200); break }
        ui.contextPage = 'object-basic'
        selectObject(restored.id, { openEditor: true })
        setStatus('隅切り前の区画へ戻しました', 1800)
        break
      }
      case 'edit-vertices': requestUserCommand('vertex-edit'); break
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
      case 'reset-text-role-position':
        if (ui.editDraft || ui.batchDrafts.length) {
          const drafts = ui.batchDrafts.length ? ui.batchDrafts : [ui.editDraft]
          applyBatchFormToDrafts(drafts)
          const role = source?.dataset.textPositionRole || ui.textRole
          drafts.forEach(draft => {
            if (role === 'name') {
              draft.labelPosition = null
              if (draft.road) draft.road.namePosition = null
              if (draft.labelStyle) {
                delete draft.labelStyle.x
                delete draft.labelStyle.y
                delete draft.labelStyle.offsetX
                delete draft.labelStyle.offsetY
              }
            } else if (role === 'width') {
              draft.road = { ...(draft.road || {}), widthLabelPosition: null, widthLabelOffset: null }
            } else if (role === 'area' || role === 'tsubo') {
              const property = role === 'tsubo' ? 'tsuboLabel' : 'areaLabel'
              const legacy = role === 'tsubo' ? 'tsuboLabelPosition' : 'areaLabelPosition'
              draft[property] = { ...(draft[property] || {}), position: null }
              draft[legacy] = null
            }
          })
          ui.batchTouched.add('__text-role-position')
          commitPendingEdit()
          renderCommandSurface()
          render()
          const roleName = role === 'name' ? '名称' : role === 'width' ? '幅員' : role === 'tsubo' ? '坪' : '面積'
          setStatus(`${drafts.length > 1 ? `${drafts.length}件の` : ''}${roleName}位置を自動へ戻しました`, 1400)
        }
        break
      case 'reset-metric-hidden-style':
        if (ui.editDraft || ui.batchDrafts.length) {
          const drafts = ui.batchDrafts.length ? ui.batchDrafts : [ui.editDraft]
          const role = source?.dataset.metricRole || ui.textRole
          if (!['area', 'tsubo'].includes(role)) break
          applyBatchFormToDrafts(drafts)
          let changed = false
          drafts.forEach(draft => {
            if (!metricHiddenStyleNeedsReset(draft, role)) return
            const property = role === 'tsubo' ? 'tsuboLabel' : 'areaLabel'
            const label = { ...(draft[property] || {}) }
            label.style = {
              ...(label.style || {}),
              rotation: 0,
              angle: 0,
              vertical: false,
              background: 'transparent',
              boxStyle: 'none',
              frame: false,
              underline: false,
              borderColor: null,
              borderWidth: 0,
              decimals: 2,
              digits: 2,
              rounding: 'round',
              adjustment: 0,
              approximate: false
            }
            draft[property] = label
            if (role === 'tsubo') draft.tsuboDigits = 2
            else draft.areaDigits = 2
            changed = true
          })
          if (changed) {
            ui.batchTouched.add('__metric-hidden-style')
            commitPendingEdit()
            renderCommandSurface()
            render()
            setStatus(`${drafts.length > 1 ? `${drafts.length}件の` : ''}${role === 'tsubo' ? '坪' : '面積'}を標準表示へ戻しました`, 1700)
          }
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
      case 'renumber-lots': {
        const lotCount = (page(store.document)?.shapes || []).filter(shape => shape.kind === 'lot').length
        const count = store.commit('区画番号整理', documentModel => K.renumberLots(documentModel, documentModel.activePageId))
        renderRegistry()
        render()
        setStatus(count
          ? `現在のページの区画番号を1から振り直しました（${count}件変更）`
          : lotCount
            ? '区画番号は既に1からの連番です'
            : '振り直す区画がありません', 1800)
        break
      }
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
      case 'apply-output-scale-suggestion': applySuggestedOutputScale(source); break
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

  function beginInputTransaction(target) {
    const field = target?.closest?.('#command-controls [data-field],[data-registry-field],#paper-size,#paper-orientation,#paper-print-scale-preset,#paper-print-scale-custom,#paper-frame-visible,#paper-underlay-visible,#paper-guides-visible,#paper-title,#paper-date,#paper-author,#paper-note,#title-frame-visible')
    if (!field) return
    if (runtime.inputTransaction?.field && runtime.inputTransaction.field !== field) {
      const previous = runtime.inputTransaction.field
      runtime.inputTransaction = null
      commitInputElement(previous)
    }
    runtime.inputTransaction = {
      field,
      value: fieldValue(field),
      sessionForm: deepClone(session.form),
      editDraft: ui.editDraft ? deepClone(ui.editDraft) : null,
      batchDrafts: ui.batchDrafts.map(deepClone),
      batchTouched: [...ui.batchTouched]
    }
  }

  function restoreInputTransaction() {
    const transaction = runtime.inputTransaction
    runtime.inputTransaction = null
    if (!transaction) return false
    session.form = deepClone(transaction.sessionForm)
    ui.editDraft = transaction.editDraft ? deepClone(transaction.editDraft) : null
    ui.batchDrafts = transaction.batchDrafts.map(deepClone)
    ui.batchTouched = new Set(transaction.batchTouched)
    const field = transaction.field
    if (field?.isConnected) {
      if (field.type === 'checkbox') field.checked = Boolean(transaction.value)
      else field.value = transaction.value ?? ''
    }
    if (field?.closest?.('#command-controls')) {
      renderCommandSurface()
      render()
    }
    return true
  }

  function commitInputElement(field) {
    if (!field) return false
    const commandField = field.closest?.('#command-controls [data-field]')
    if (commandField) {
      handleCommandFieldInput(commandField, true)
      return true
    }
    const registryField = field.closest?.('[data-registry-field]')
    if (registryField) {
      updateRegistryObject(
        registryField.dataset.objectId,
        registryField.dataset.registryField,
        registryField.type === 'checkbox' ? registryField.checked : registryField.value
      )
      return true
    }
    if (field.matches?.(PAPER_INPUT_SELECTOR)) {
      updatePaperFromControls()
      return true
    }
    return false
  }

  function flushActiveEditor() {
    const active = document.activeElement
    runtime.inputTransaction = null
    commitInputElement(active)
    commitPendingEdit()
    return true
  }

  function handleCommandFieldInput(field, commit = false) {
    const key = field.dataset.field
    if (!key) return
    ui.mixedFields.delete(key)
    field.removeAttribute('data-mixed')
    if (field.type === 'checkbox') field.indeterminate = false
    session.form[key] = fieldValue(field)
    if (key === 'scale-method') {
      // The method selector is replaced as soon as its native `change` fires.
      // End the transaction first; otherwise the removed select can later
      // focus-out with its original value and switch the UI back to direct
      // scale before the user can place the first calibration point.
      runtime.inputTransaction = null
      session.form[key] = session.form[key] === 'two-point' ? 'two-point' : 'scale'
      session.points = []
      session.step = 0
      runtime.hoverSnap = null
      renderCommandSurface()
      render()
      requestAnimationFrame(() => {
        const target = session.form[key] === 'two-point'
          ? dom.canvas
          : ($('[data-field="scale-preset"]', dom.commandControls) || $('[data-field="manual-scale"]', dom.commandControls))
        target?.focus({ preventScroll: true })
      })
      setStatus(session.form[key] === 'two-point' ? '図面上の既知の2点を指定してください' : '縮尺候補または任意の分母を入力してください', 1800)
      return
    }
    if (key === 'scale-preset') {
      const preset = parseNumeric(session.form[key])
      if (preset > 0) {
        session.form['manual-scale'] = String(preset)
        const manualField = $('[data-field="manual-scale"]', dom.commandControls)
        if (manualField) manualField.value = session.form['manual-scale']
        applyManualPageScale(preset)
        return
      }
    } else if (key === 'manual-scale') {
      const manual = parseNumeric(session.form[key])
      session.form['scale-preset'] = DRAWING_SCALE_PRESETS.has(manual) ? String(manual) : ''
      const presetField = $('[data-field="scale-preset"]', dom.commandControls)
      if (presetField) presetField.value = session.form['scale-preset']
      if (commit && manual > 0) {
        applyManualPageScale(manual)
        return
      }
    } else if (key === 'calibration-distance' && commit && session.command === 'calibrate' && session.points.length === 2) {
      applyCalibration()
      return
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
    if (key === 'show-area') { session.form['area-label-visible'] = Boolean(session.form[key]); if (editingObjects) ui.batchTouched.add('area-label-visible') }
    if (key === 'area-label-visible') { session.form['show-area'] = Boolean(session.form[key]); if (editingObjects) ui.batchTouched.add('show-area') }
    if (key === 'show-tsubo') { session.form['tsubo-label-visible'] = Boolean(session.form[key]); if (editingObjects) ui.batchTouched.add('tsubo-label-visible') }
    if (key === 'tsubo-label-visible') { session.form['show-tsubo'] = Boolean(session.form[key]); if (editingObjects) ui.batchTouched.add('show-tsubo') }
    const editingKind = ui.editDraft?.kind || selectedKind()
    if (key === 'text-size' && ['house', 'parking', 'north'].includes(editingKind)) {
      session.form['stamp-text-scale'] = session.form[key]
      if (editingObjects) ui.batchTouched.add('stamp-text-scale')
    }
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
      session.form['font-family'] = fontToken(preference.labelStyle?.fontFamily)
      session.form['text-size'] = fontScale(preference.labelStyle, LABEL_BASE_SIZE)
      session.form['road-width-font'] = fontToken(preference.widthLabelStyle?.fontFamily)
      session.form['road-width-size'] = fontScale(preference.widthLabelStyle, ROAD_WIDTH_BASE_SIZE)
      session.form['text-vertical'] = Boolean(preference.vertical)
      session.form['show-label'] = true
      session.form['road-width-visible'] = true
      session.form['show-area'] = preference.showArea === true
      session.form['show-tsubo'] = preference.showTsubo === true
      session.form['show-lengths'] = preference.showLengths === true
      session.form['dimension-font'] = fontToken(preference.dimensionStyle?.fontFamily)
      session.form['dimension-size'] = fontScale(preference.dimensionStyle, DIMENSION_BASE_SIZE)
      session.form.approximate = Boolean(preference.dimensionStyle?.approximate)
      session.form['dimension-decimals'] = preference.dimensionStyle?.decimals ?? preference.dimensionStyle?.digits ?? 2
      session.form['dimension-rounding'] = preference.dimensionStyle?.rounding || 'round'
      session.form['dimension-adjustment'] = finite(preference.dimensionStyle?.adjustment)
      for (const fieldName of ['road-name', 'road-width', 'fill-opacity', 'font-family', 'text-size', 'road-width-font', 'road-width-size', 'text-vertical', 'show-label', 'road-width-visible', 'show-area', 'show-tsubo', 'show-lengths', 'dimension-font', 'dimension-size', 'approximate', 'dimension-decimals', 'dimension-rounding', 'dimension-adjustment']) {
        const target = $(`[data-field="${fieldName}"]`, dom.commandControls)
        if (!target || document.activeElement === target) continue
        if (target.type === 'checkbox') target.checked = Boolean(session.form[fieldName])
        else target.value = session.form[fieldName] ?? ''
      }
    }
    if (key === 'object-type' && ui.editDraft) {
      const kind = ['lot', 'road', 'water'].includes(field.value) ? field.value : ui.editDraft.kind
      ui.batchTouched.delete(key)
      convertSelectedShapeKind(kind)
      return
    }
    if (session.command === 'typography-settings' && commit && key.startsWith('typography-') && key !== 'typography-apply-target') {
      applyTypographySettings(session.form['typography-apply-target'] === 'all')
      return
    }
    if (ui.batchDrafts.length) applyBatchFormToDrafts()
    else if (ui.editDraft) applyBatchFormToDrafts([ui.editDraft])
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
    const colorSwatch = event.target.closest('[data-color-swatch]')
    if (colorSwatch) {
      event.preventDefault()
      const select = runtime.activeColorSelect
      const trigger = runtime.activeColorTrigger
      const value = colorSwatch.dataset.colorValue || ''
      closeColorPalette()
      if (select?.isConnected && value) {
        select.value = value
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
      return
    }
    const colorTrigger = event.target.closest('[data-color-trigger]')
    if (colorTrigger) {
      event.preventDefault()
      const select = colorTrigger.closest('[data-color-control]')?.querySelector('select[data-color-select]')
      openColorPalette(select, colorTrigger)
      return
    }
    const colorField = event.target.closest('label.field-inline')
    const colorFieldTrigger = colorField?.querySelector('[data-color-trigger]')
    if (colorFieldTrigger) {
      event.preventDefault()
      const select = colorFieldTrigger.closest('[data-color-control]')?.querySelector('select[data-color-select]')
      openColorPalette(select, colorFieldTrigger)
      return
    }
    if (runtime.activeColorSelect) closeColorPalette()
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
        applyTypographySettings(session.form['typography-apply-target'] === 'all')
      }
      return
    }
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
      ui.registryIds.clear()
      ui.registryTab = registryTab.dataset.registryTab
      const filter = byId('registry-filter')
      if (filter) filter.value = 'all'
      renderRegistry()
      return
    }

    const registryAreaFilter = event.target.closest('[data-registry-area-filter]')
    if (registryAreaFilter) {
      ui.registryIds.clear()
      const filter = byId('registry-filter')
      if (filter) filter.value = registryAreaFilter.dataset.registryAreaFilter || 'all'
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

    const createCommandPage = event.target.closest('[data-create-command-page]')
    if (createCommandPage) {
      event.preventDefault()
      commitPendingEdit()
      ui.createPage = createCommandPage.dataset.createCommandPage || ''
      renderCommandSurface()
      render()
      return
    }

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
    if (field) {
      // A native select can emit `input` while its option list is still open.
      // Rebuilding the whole command surface at that moment removes the select
      // before `change`, so the user's 2-point choice is lost. Commit this
      // structural switch only after the native selection has closed.
      if (field.matches('select[data-field="scale-method"]')) return
      handleCommandFieldInput(field, false)
      return
    }
    if (event.target.matches('#registry-search,#registry-filter')) { ui.registryIds.clear(); renderRegistry({ preserveScroll: false }); return }
    if (event.target.matches('#registry-sort')) { renderRegistry({ preserveScroll: false }); return }
  }

  function handleDocumentChange(event) {
    const textRole = event.target.closest('#command-controls [data-text-role]')
    if (textRole) { commitPendingEdit(); ui.textRole = textRole.value || 'name'; renderCommandSurface(); render(); return }
    const dimensionTarget = event.target.closest('#command-controls [data-dimension-target]')
    if (dimensionTarget) { selectDimensionTarget(dimensionTarget.value); return }
    const field = event.target.closest('#command-controls [data-field]')
    if (field) { handleCommandFieldInput(field, true); return }
    if (event.target.matches('#registry-search,#registry-filter')) { ui.registryIds.clear(); renderRegistry({ preserveScroll: false }); return }
    if (event.target.matches('#registry-sort')) { renderRegistry({ preserveScroll: false }); return }
    const registrySelect = event.target.closest('[data-registry-select]')
    if (registrySelect) {
      commitPendingEdit()
      if (registrySelect.checked) ui.registryIds.add(registrySelect.dataset.registrySelect)
      else ui.registryIds.delete(registrySelect.dataset.registrySelect)
      renderRegistry(); return
    }
    const registryField = event.target.closest('[data-registry-field]')
    if (registryField) {
      if (registryField.type === 'checkbox') runtime.inputTransaction = null
      updateRegistryObject(registryField.dataset.objectId, registryField.dataset.registryField, registryField.type === 'checkbox' ? registryField.checked : registryField.value); return
    }
    if (event.target.id === 'registry-check-all') {
      commitPendingEdit()
      const ids = filteredRegistryObjects().map(object => object.id)
      ids.forEach(id => event.target.checked ? ui.registryIds.add(id) : ui.registryIds.delete(id))
      renderRegistry(); return
    }
    if (event.target.matches(PAPER_INPUT_SELECTOR)) {
      updatePaperFromControls(); return
    }
  }

  function handleDocumentFocusOut(event) {
    const transaction = runtime.inputTransaction
    if (!transaction || transaction.field !== event.target || runtime.composing) return
    setTimeout(() => {
      if (runtime.inputTransaction !== transaction) return
      runtime.inputTransaction = null
      commitInputElement(transaction.field)
    }, 0)
  }

  function flushInputBeforeCanvasPointer(event) {
    const transaction = runtime.inputTransaction
    if (!transaction) return
    const completesTwoPointCalibration = transaction.field?.dataset?.field === 'calibration-distance' &&
      session.command === 'calibrate' && session.points.length === 2 &&
      parseNumeric(transaction.field.value) > 0
    runtime.inputTransaction = null
    commitInputElement(transaction.field)
    if (completesTwoPointCalibration && hasScale() && session.points.length === 0) {
      // The click was intended only to leave the distance field. Do not reuse
      // that same pointerdown as point 1 of a new calibration (or of the
      // command resumed after the required scale flow).
      event?.preventDefault?.()
      event?.stopImmediatePropagation?.()
      dom.canvas.focus({ preventScroll: true })
    }
  }

  function isTypingTarget(target) {
    return target && (target.matches?.('input,textarea,select,[contenteditable="true"]') || target.closest?.('[contenteditable="true"]'))
  }

  function handleKeyDown(event) {
    if (event.key === 'Process' || event.keyCode === 229) return
    const focusedColorSwatch = event.target.closest?.('[data-color-swatch]')
    if (focusedColorSwatch && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const swatches = [...focusedColorSwatch.closest('[data-color-palette]').querySelectorAll('[data-color-swatch]')]
      const index = swatches.indexOf(focusedColorSwatch)
      const columns = Math.max(1, parseInt(getComputedStyle(focusedColorSwatch.closest('[data-color-palette]')).getPropertyValue('--color-columns'), 10) || 5)
      const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : event.key === 'ArrowDown' ? columns : 0
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? swatches.length - 1 : Math.max(0, Math.min(swatches.length - 1, index + delta))
      swatches[nextIndex]?.focus({ preventScroll: true })
      return
    }
    if (event.key === 'Escape' && runtime.activeColorSelect) {
      event.preventDefault()
      closeColorPalette(true)
      return
    }
    if (event.key === 'Escape' && runtime.outputDrag) {
      event.preventDefault()
      cancelOutputDrag('出力配置の変更を取り消しました')
      return
    }
    const typing = isTypingTarget(event.target)
    const commandKey = event.ctrlKey || event.metaKey
    if (commandKey) {
      const key = event.key.toLowerCase()
      if (key === 's') { event.preventDefault(); void saveProject(); return }
      if (key === 'o' && event.shiftKey) { event.preventDefault(); void handleAction('open-project'); return }
      if (key === 'o') { event.preventDefault(); dom.underlayInput?.click(); return }
      if (key === 'n') { event.preventDefault(); void handleAction('new-project'); return }
      if (key === 'p') { event.preventDefault(); void printOrPdf(false); return }
      if (!typing && key === 'z' && !event.shiftKey) { event.preventDefault(); performHistoryNavigation('undo'); return }
      if (!typing && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); performHistoryNavigation('redo'); return }
      if (!typing && key === 'c') { event.preventDefault(); copySelection(); return }
      if (!typing && key === 'v') { event.preventDefault(); pasteClipboard(); return }
    }
    if (typing && event.key === 'Escape') {
      event.preventDefault()
      restoreInputTransaction()
      dom.canvas.focus({ preventScroll: true })
      closeMenus()
      return
    }
    if (event.repeat && !typing) return
    if (event.key === ' ') { if (!typing) { runtime.spaceDown = true; event.preventDefault() }; return }
    if (event.key === 'Enter') {
      if (runtime.composing || event.isComposing || Date.now() - runtime.compositionEndedAt < 90) return
      if (typing && !event.target.matches('textarea,[contenteditable="true"]')) {
        event.preventDefault()
        runtime.inputTransaction = null
        if (event.target.matches('[data-field="manual-scale"]')) applyManualPageScale(event.target.value)
        else if (event.target.matches('[data-field="calibration-distance"]')) {
          const hasCalibrationPair = session.points.length === 2
          const validCalibrationDistance = parseNumeric(event.target.value) > 0
          commitInputElement(event.target)
          // commitInputElement() itself completes a ready 2-point calibration.
          // Calling applyCalibration() again here used to see the already-cleared
          // point pair and replace the success message with a false error.
          if (!hasCalibrationPair) {
            dom.canvas.focus({ preventScroll: true })
            setStatus('図面上の既知の2点を指定してください', 1800)
          } else if (!validCalibrationDistance) {
            setStatus('0より大きい実距離を入力してください', 1800)
          }
        }
        else commitInputElement(event.target)
      } else if (!typing) {
        event.preventDefault()
        finishCommand()
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
    cancelOutputDrag()
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
    flushActiveEditor()
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
    document.addEventListener('focusin', event => beginInputTransaction(event.target), true)
    document.addEventListener('focusout', handleDocumentFocusOut, true)
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
    dom.canvas.addEventListener('pointerdown', flushInputBeforeCanvasPointer, true)
    dom.canvas.addEventListener('pointerdown', handlePointerDown)
    dom.canvas.addEventListener('pointermove', handlePointerMove)
    dom.canvas.addEventListener('pointerup', handlePointerUp)
    dom.canvas.addEventListener('pointercancel', handlePointerUp)
    dom.canvas.addEventListener('dblclick', handleDoubleClick)
    dom.canvas.addEventListener('contextmenu', handleContextMenu)
    dom.canvas.addEventListener('wheel', handleWheel, { passive: false })
    dom.outputPreview?.addEventListener('pointerdown', flushInputBeforeCanvasPointer, true)
    dom.outputPreview?.addEventListener('pointerdown', handleOutputPointerDown)
    dom.outputPreview?.addEventListener('pointermove', handleOutputPointerMove)
    dom.outputPreview?.addEventListener('pointerup', handleOutputPointerUp)
    dom.outputPreview?.addEventListener('pointercancel', () => cancelOutputDrag('出力配置の変更を取り消しました'))
    dom.outputPreview?.addEventListener('lostpointercapture', () => cancelOutputDrag())
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
    store.subscribe(event => {
      renderer.setDocument(store.document)
      updateStatus()
      renderRegistry()
      if (ui.workspace === 'output') refreshOutputPreview()
      if (['undo', 'redo', 'replace'].includes(event?.type)) scheduleBackgroundSynchronization()
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
    outputPaperModel,
    outputFitStatus,
    centeredOutputOffset,
    handleOutputPointerDown,
    handleOutputPointerMove,
    handleOutputPointerUp,
    cancelOutputDrag,
    refreshOutputPreview,
    createExportCanvas,
    resolvedMapScale,
    outputPixelsPerWorldUnit,
    handleAction,
    confirmBeforeReplacingDocument,
    synchronizeBackgroundRuntime,
    undo: () => { const result = performHistoryNavigation('undo'); render(); return result },
    redo: () => { const result = performHistoryNavigation('redo'); render(); return result },
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
