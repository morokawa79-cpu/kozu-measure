(function bootstrapKozuV210IO(global) {
  'use strict';

  const K = global.KozuV210 = global.KozuV210 || {};
  const FORMAT = 'kozu-measure';
  const PROJECT_VERSION = 7;
  const desktopVersion = typeof global.kozuDesktop?.version === 'string' ? global.kozuDesktop.version.trim() : '';
  const APP_VERSION = K.APP_VERSION || desktopVersion || '2.1.0-alpha.11';
  const PDF_WORKER_SRC = 'vendor/pdf.worker.min.js';
  // 300dpi出力時にも下絵PDFが拡大ぼけしない解像度（72dpi × 4.2 ≒ 302dpi）。
  const PDF_RENDER_SCALE = 4.2;
  const MAX_RENDER_PIXELS = 80_000_000;
  const BASE64_BYTE_CHUNK = 3 * 8192;
  const BASE64_TEXT_CHUNK = 4 * 8192;

  const BACKGROUND_TYPES = new Set([null, 'pdf', 'image']);
  const SHAPE_KINDS = new Set(['lot', 'road', 'water', 'cutout']);
  const CONVERTIBLE_SHAPE_KINDS = new Set(['lot', 'road', 'water']);
  const KIND_STATE_KEYS = ['lot', 'road', 'water'];
  const KIND_STATE_EXCLUDED_KEYS = new Set([
    'id', 'kind', 'points', 'edges', 'kindStates',
    'parentShapeId', 'parentOriginalPoints', 'parentOriginalEdges',
  ]);
  const ENTITY_KINDS = new Set([
    'distance', 'polyline', 'area', 'line', 'arrow', 'text', 'callout',
    'north', 'house', 'parking', 'lot-table', 'parallel', 'guide', 'dimension',
  ]);
  const PAPER_SIZES = new Set(['A4', 'A3']);
  const PAPER_ORIENTATIONS = new Set(['portrait', 'landscape']);
  const IMAGE_ROTATIONS = new Set([0, 90, 180, 270]);
  const ROAD_TYPES = new Set([
    'road', 'location-designated', 'private', 'public', 'recognized-private',
    'water', 'other',
  ]);
  const RUNTIME_KEYS = new Set([
    'pdf', 'pdfBytes', 'image', 'bitmap', 'renderTask', 'renderTasks',
    'loadingTask', 'runtime', '_runtime', 'renderSource', 'history', 'future', 'selection',
    'commandSession', 'ui',
  ]);
  const EXCLUDED_KEY = /(kaitori|buyout|purchase.?estimate|set.?back|セットバック|買取)/i;

  if (global.document && global.pdfjsLib?.GlobalWorkerOptions) {
    global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
  }

  function pdfResourceOptions() {
    // Electron serves these through main-v210.js.  The local browser preview
    // serves pdfjs-dist directly from this project, avoiding an external CDN
    // (and keeping the same Japanese CID/CAD PDF support in both runtimes).
    const desktopRuntime = Boolean(global.kozuDesktop);
    return {
      cMapUrl: desktopRuntime ? 'pdfres://cmaps/' : 'node_modules/pdfjs-dist/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: desktopRuntime ? 'pdfres://standard_fonts/' : 'node_modules/pdfjs-dist/standard_fonts/',
      useSystemFonts: true,
    };
  }

  class ProjectValidationError extends Error {
    constructor(errors) {
      const list = Array.isArray(errors) ? errors : [String(errors || '不明な検証エラー')];
      super(`プロジェクトデータが不正です (${list.length}件): ${list[0]}`);
      this.name = 'ProjectValidationError';
      this.errors = list;
    }
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function finiteOr(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function positiveOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function integerInRange(value, fallback, minimum, maximum) {
    const number = Math.trunc(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.max(minimum, Math.min(maximum, number));
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function stringOr(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
  }

  function normalizedQuarterTurn(value) {
    const number = finiteOr(value, 0);
    return ((Math.round(number / 90) * 90) % 360 + 360) % 360;
  }

  function safeIdentifier(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0;
    return typeof value === 'string' && value.length > 0 && value.length <= 160;
  }

  function cloneValue(value) {
    if (typeof K.clone === 'function') {
      try { return K.clone(value); } catch (_) { /* local fallback below */ }
    }
    if (typeof global.structuredClone === 'function') {
      try { return global.structuredClone(value); } catch (_) { /* local fallback below */ }
    }
    return JSON.parse(JSON.stringify(value));
  }

  function fallbackDocument() {
    const timestamp = new Date().toISOString();
    return {
      format: FORMAT,
      schemaVersion: PROJECT_VERSION,
      appVersion: APP_VERSION,
      id: `project-${Date.now().toString(36)}`,
      title: '無題の図面',
      createdAt: timestamp,
      updatedAt: timestamp,
      background: {
        type: null,
        name: '',
        mimeType: '',
        source: null,
        size: 0,
        pages: [],
        pageCount: 0,
        currentPage: 1,
        metadata: {},
        width: 0,
        height: 0,
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        imageRotation: 0,
        locked: true,
      },
      calibration: { method: null, mpp: null, mapScale: null, points: null, realDistanceM: null },
      paper: {
        enabled: false,
        size: 'A4',
        orientation: 'landscape',
        widthMm: 297,
        heightMm: 210,
        title: '',
        date: timestamp.slice(0, 10),
        author: '',
        showFrame: true,
        showTitleFrame: true,
        includeUnderlay: true,
      },
      outputDefaults: { paperSize: 'A4', orientation: 'landscape', printScale: null, offsetMmX: 0, offsetMmY: 0, showFrame: true, showTitleFrame: true, includeUnderlay: true, includeGuides: false, initialized: false },
      preferences: { snap: { vertex: true, intersection: true, edge: true, grid: false, gridSize: 10 } },
      pages: [{
        id: 'page-1', name: '図面 1', sourcePage: 1, calibration: null,
        outputLayout: { paperSize: 'A4', orientation: 'landscape', printScale: null, offsetMmX: 0, offsetMmY: 0, showFrame: true, showTitleFrame: true, includeUnderlay: true, includeGuides: false, initialized: false },
        shapes: [], entities: []
      }],
      activePageId: 'page-1',
      nextId: 1,
    };
  }

  function createFreshDocument() {
    if (typeof K.createDocument === 'function') {
      try {
        const candidate = K.createDocument();
        if (isObject(candidate)) return cloneValue(candidate);
      } catch (_) { /* use the isolated IO fallback */ }
    }
    return fallbackDocument();
  }

  function cleanSerializable(value, seen = new WeakSet()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined;
    if (value instanceof Date) return value.toISOString();
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return undefined;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return undefined;
    if (typeof Element !== 'undefined' && value instanceof Element) return undefined;
    if (seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) {
      const result = [];
      for (const item of value) {
        const cleaned = cleanSerializable(item, seen);
        if (cleaned !== undefined) result.push(cleaned);
      }
      seen.delete(value);
      return result;
    }
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (RUNTIME_KEYS.has(key) || EXCLUDED_KEY.test(key)) continue;
      const cleaned = cleanSerializable(item, seen);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    seen.delete(value);
    return result;
  }

  function normalizedKindStateEdge(value) {
    if (!isObject(value)) return null;
    const edge = cleanSerializable(value) || {};
    delete edge.id;
    return edge;
  }

  function normalizedKindState(value) {
    if (!isObject(value)) return null;
    const state = {};
    for (const [key, item] of Object.entries(value)) {
      if (KIND_STATE_EXCLUDED_KEYS.has(key)) continue;
      state[key] = cloneValue(item);
    }
    state.edges = (Array.isArray(value.edges) ? value.edges : []).map(normalizedKindStateEdge).filter(Boolean);
    return cleanSerializable(state);
  }

  function captureShapeKindState(shape) {
    const state = {};
    for (const [key, item] of Object.entries(shape || {})) {
      if (KIND_STATE_EXCLUDED_KEYS.has(key)) continue;
      state[key] = cloneValue(item);
    }
    state.edges = (Array.isArray(shape?.edges) ? shape.edges : []).map(normalizedKindStateEdge).filter(Boolean);
    return cleanSerializable(state);
  }

  function shapeWithNormalizedKindStates(shape) {
    if (!isObject(shape) || !CONVERTIBLE_SHAPE_KINDS.has(shape.kind)) return shape;
    const source = isObject(shape.kindStates) ? shape.kindStates : {};
    const kindStates = Object.fromEntries(KIND_STATE_KEYS.map(kind => [kind, normalizedKindState(source[kind])]));
    kindStates[shape.kind] = captureShapeKindState(shape);
    return { ...shape, kindStates };
  }

  function normalizedOutputLayout(value, paper = {}) {
    if (typeof K.createOutputLayout === 'function') return K.createOutputLayout(value || {}, paper);
    const source = isObject(value) ? value : {};
    const requestedSize = source.paperSize ?? source.size;
    const printScale = positiveOrNull(source.printScale);
    return {
      paperSize: requestedSize === 'A3' ? 'A3' : requestedSize === 'A4' ? 'A4' : paper.size === 'A3' ? 'A3' : 'A4',
      orientation: source.orientation === 'portrait' ? 'portrait' : source.orientation === 'landscape' ? 'landscape' : paper.orientation === 'portrait' ? 'portrait' : 'landscape',
      printScale,
      offsetMmX: finiteOr(source.offsetMmX, 0),
      offsetMmY: finiteOr(source.offsetMmY, 0),
      showFrame: typeof source.showFrame === 'boolean' ? source.showFrame : paper.showFrame !== false,
      showTitleFrame: typeof source.showTitleFrame === 'boolean' ? source.showTitleFrame : paper.showTitleFrame !== false,
      includeUnderlay: typeof source.includeUnderlay === 'boolean' ? source.includeUnderlay : paper.includeUnderlay !== false,
      includeGuides: source.includeGuides === true,
      initialized: source.initialized === true,
    };
  }

  function mergeFreshDocument(source) {
    const fresh = createFreshDocument();
    const clean = cleanSerializable(source) || {};
    const sourcePages = Array.isArray(clean.pages) ? clean.pages : fresh.pages;
    const pages = sourcePages.map((page, index) => ({
      id: page?.id ?? `page-${index + 1}`,
      name: stringOr(page?.name, `図面 ${index + 1}`),
      sourcePage: integerInRange(page?.sourcePage, index + 1, 1, 100_000),
      calibration: isObject(page?.calibration) ? page.calibration : null,
      outputLayout: isObject(page?.outputLayout) ? page.outputLayout : null,
      shapes: Array.isArray(page?.shapes) ? page.shapes : [],
      entities: Array.isArray(page?.entities) ? page.entities : [],
    }));
    if (pages.length === 0) pages.push({
      id: 'page-1', name: '図面 1', sourcePage: 1, calibration: null,
      outputLayout: null, shapes: [], entities: []
    });

    const result = {
      format: FORMAT,
      schemaVersion: PROJECT_VERSION,
      appVersion: stringOr(clean.appVersion, APP_VERSION),
      id: clean.id ?? fresh.id,
      title: stringOr(clean.title, fresh.title),
      createdAt: stringOr(clean.createdAt, fresh.createdAt),
      updatedAt: stringOr(clean.updatedAt, fresh.updatedAt),
      pages,
      activePageId: clean.activePageId ?? pages[0].id,
      background: { ...fresh.background, ...(isObject(clean.background) ? clean.background : {}) },
      calibration: { ...fresh.calibration, ...(isObject(clean.calibration) ? clean.calibration : {}) },
      paper: { ...fresh.paper, ...(isObject(clean.paper) ? clean.paper : {}) },
      outputDefaults: normalizedOutputLayout(clean.outputDefaults || fresh.outputDefaults, clean.paper || fresh.paper),
      preferences: { ...fresh.preferences, ...(isObject(clean.preferences) ? clean.preferences : {}) },
      nextId: clean.nextId ?? fresh.nextId,
    };
    result.background.pages = Array.isArray(result.background.pages) ? result.background.pages : [];
    result.background.pageCount = Math.max(0, integerInRange(result.background.pageCount, result.background.pages.length, 0, 100_000));
    result.background.currentPage = integerInRange(result.background.currentPage, 1, 1, Math.max(1, result.background.pageCount));
    result.background.metadata = isObject(result.background.metadata) ? result.background.metadata : {};
    result.background.imageRotation = normalizedQuarterTurn(result.background.imageRotation);
    result.pages = result.pages.map(page => ({
      ...page,
      outputLayout: normalizedOutputLayout(page.outputLayout, result.paper),
      shapes: (Array.isArray(page.shapes) ? page.shapes : []).map(shapeWithNormalizedKindStates),
    }));
    return result;
  }

  function normalizeDocument(source) {
    let candidate = source;
    if (typeof K.normalizeDocument === 'function') {
      try {
        const normalized = K.normalizeDocument(cloneValue(source));
        if (isObject(normalized)) candidate = normalized;
      } catch (_) { /* strict IO normalization still runs below */ }
    }
    return mergeFreshDocument(candidate);
  }

  function toUint8Array(input) {
    if (input instanceof Uint8Array) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (Array.isArray(input)) return Uint8Array.from(input);
    throw new TypeError('バイト列ではありません');
  }

  function bytesToBase64(input) {
    const bytes = toUint8Array(input);
    let output = '';
    for (let offset = 0; offset < bytes.length; offset += BASE64_BYTE_CHUNK) {
      const chunk = bytes.subarray(offset, Math.min(offset + BASE64_BYTE_CHUNK, bytes.length));
      let binary = '';
      for (let index = 0; index < chunk.length; index += 1) binary += String.fromCharCode(chunk[index]);
      output += global.btoa(binary);
    }
    return output;
  }

  function base64ToBytes(value) {
    const text = String(value || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    if (!text) return new Uint8Array(0);
    if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('Base64データが不正です');
    const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
    const output = new Uint8Array((text.length / 4) * 3 - padding);
    let outputOffset = 0;
    for (let offset = 0; offset < text.length; offset += BASE64_TEXT_CHUNK) {
      const chunk = text.slice(offset, Math.min(offset + BASE64_TEXT_CHUNK, text.length));
      const binary = global.atob(chunk);
      for (let index = 0; index < binary.length; index += 1) output[outputOffset++] = binary.charCodeAt(index);
    }
    return output;
  }

  async function blobToDataUrl(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return `data:${blob.type || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
  }

  function ensurePdfJs() {
    const library = global.pdfjsLib;
    if (!library?.getDocument) throw new Error('PDF読込ライブラリを利用できません');
    if (global.document && library.GlobalWorkerOptions) library.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
    return library;
  }

  function createCanvas(width = 1, height = 1) {
    if (global.document?.createElement) {
      const canvas = global.document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(width));
      canvas.height = Math.max(1, Math.ceil(height));
      return canvas;
    }
    if (typeof global.OffscreenCanvas === 'function') return new global.OffscreenCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
    throw new Error('Canvasを作成できません');
  }

  function loadImageElement(dataUrl) {
    return new Promise((resolve, reject) => {
      if (typeof global.Image !== 'function') {
        reject(new Error('画像デコーダーを利用できません'));
        return;
      }
      const image = new global.Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('画像を読み込めませんでした'));
      image.src = dataUrl;
    });
  }

  function safePdfInfo(info) {
    const output = {};
    for (const [key, value] of Object.entries(isObject(info) ? info : {})) {
      if (['string', 'number', 'boolean'].includes(typeof value) && value !== null) output[key] = value;
    }
    return output;
  }

  async function inspectPdf(pdf, preferredPage = 1) {
    const requestedPage = integerInRange(preferredPage, 1, 1, pdf.numPages);
    // 縮尺表記は信頼できる校正値ではないため読み取らない。最初に表示する
    // ページの寸法だけを取得し、縮尺は利用者がページごとに設定する。
    const firstPage = await pdf.getPage(requestedPage);
    const firstViewport = firstPage.getViewport({ scale: 1 });
    if (typeof firstPage.cleanup === 'function') firstPage.cleanup();
    const pages = Array.from({ length: pdf.numPages }, (_, index) => ({
      number: index + 1,
      width: firstViewport.width,
      height: firstViewport.height,
      rotation: index + 1 === requestedPage ? (firstViewport.rotation || 0) : 0,
      pending: index + 1 !== requestedPage,
    }));
    let metadata = {};
    try {
      const result = await pdf.getMetadata();
      metadata = safePdfInfo(result?.info);
    } catch (_) { /* metadata is optional */ }
    metadata.pageCount = pdf.numPages;
    return { pages, metadata };
  }

  function defaultBackgroundTransform() {
    return {
      visible: true,
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      imageRotation: 0,
      locked: true,
    };
  }

  function backgroundTransformFrom(value) {
    const source = isObject(value) ? value : {};
    return {
      visible: source.visible !== false,
      opacity: clamp(finiteOr(source.opacity, 1), 0, 1),
      x: finiteOr(source.x, 0),
      y: finiteOr(source.y, 0),
      scale: Math.max(0.0001, finiteOr(source.scale, 1)),
      rotation: finiteOr(source.rotation, 0),
      imageRotation: normalizedQuarterTurn(source.imageRotation),
      locked: source.locked === undefined ? true : !!source.locked,
    };
  }

  async function loadPdfBytes(input, options = {}) {
    const library = ensurePdfJs();
    const sourceBytes = toUint8Array(input).slice();
    if (sourceBytes.length === 0) throw new Error('PDFが空です');
    const storedBase64 = bytesToBase64(sourceBytes);
    const currentPage = integerInRange(options.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const loadingTask = library.getDocument({
      data: sourceBytes.slice(),
      ...pdfResourceOptions(),
      isEvalSupported: false,
    });
    const pdf = await loadingTask.promise;
    const resolvedCurrentPage = integerInRange(currentPage, 1, 1, pdf.numPages);
    const inspected = await inspectPdf(pdf, resolvedCurrentPage);
    const currentPageMetadata = inspected.pages[resolvedCurrentPage - 1] || inspected.pages[0];
    const background = {
      type: 'pdf',
      name: stringOr(options.name, '図面.pdf'),
      mimeType: 'application/pdf',
      source: storedBase64,
      size: sourceBytes.length,
      pages: inspected.pages,
      pageCount: pdf.numPages,
      currentPage: resolvedCurrentPage,
      metadata: inspected.metadata,
      width: currentPageMetadata?.width || 0,
      height: currentPageMetadata?.height || 0,
      ...defaultBackgroundTransform(),
      ...backgroundTransformFrom(options.transform),
      imageRotation: 0,
    };
    const runtime = {
      type: 'pdf',
      pdf,
      loadingTask,
      pages: pdf.numPages,
      pageCount: pdf.numPages,
      renderTasks: new Map(),
      async destroy() {
        for (const task of this.renderTasks.values()) {
          try { task.cancel(); } catch (_) { /* already complete */ }
        }
        this.renderTasks.clear();
        try { await this.pdf?.destroy?.(); } catch (_) { /* best effort */ }
        try { await this.loadingTask?.destroy?.(); } catch (_) { /* best effort */ }
      },
    };
    return { background, runtime };
  }

  async function loadPdfFile(file, options = {}) {
    if (!file) throw new TypeError('PDFファイルが指定されていません');
    const name = options.name || file.name || '図面.pdf';
    if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(name)) throw new Error('PDFファイルではありません');
    return loadPdfBytes(await file.arrayBuffer(), { ...options, name });
  }

  async function loadImageBlob(blob, options = {}) {
    if (!blob) throw new TypeError('画像が指定されていません');
    const mimeType = blob.type || options.mimeType || 'image/png';
    if (!/^image\//i.test(mimeType)) throw new Error('画像ファイルではありません');
    const dataUrl = await blobToDataUrl(blob);
    const image = await loadImageElement(dataUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!(width > 0 && height > 0)) throw new Error('画像サイズを取得できません');
    const background = {
      type: 'image',
      name: stringOr(options.name, '図面画像'),
      mimeType,
      source: dataUrl,
      size: Number.isFinite(blob.size) ? blob.size : 0,
      pages: [{ number: 1, width, height, rotation: 0 }],
      pageCount: 1,
      currentPage: 1,
      metadata: { width, height },
      width,
      height,
      ...defaultBackgroundTransform(),
      ...backgroundTransformFrom(options.transform),
      imageRotation: normalizedQuarterTurn(options.imageRotation ?? options.transform?.imageRotation),
    };
    return {
      background,
      runtime: {
        type: 'image',
        image,
        pages: 1,
        pageCount: 1,
        async destroy() {
          try { this.image.src = ''; } catch (_) { /* best effort */ }
          this.image = null;
        },
      },
    };
  }

  async function loadImageFile(file, options = {}) {
    if (!file) throw new TypeError('画像ファイルが指定されていません');
    return loadImageBlob(file, { ...options, name: options.name || file.name || '図面画像' });
  }

  async function loadUnderlayFile(file, options = {}) {
    if (!file) throw new TypeError('下絵ファイルが指定されていません');
    const name = file.name || options.name || '';
    if (file.type === 'application/pdf' || /\.pdf$/i.test(name)) return loadPdfFile(file, options);
    if (/^image\//i.test(file.type || '') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name)) return loadImageFile(file, options);
    throw new Error('PDFまたは画像ファイルを選択してください');
  }

  async function createUnderlayRuntime(background) {
    if (!isObject(background) || !BACKGROUND_TYPES.has(background.type)) throw new Error('下絵データが不正です');
    if (background.type === null) return null;
    if (background.type === 'pdf') {
      if (!background.source) throw new Error('PDF本体が保存されていません');
      const loaded = await loadPdfBytes(base64ToBytes(background.source), {
        name: background.name,
        page: background.currentPage,
        transform: background,
      });
      Object.assign(background, {
        pages: loaded.background.pages,
        pageCount: loaded.background.pageCount,
        currentPage: loaded.background.currentPage,
        metadata: loaded.background.metadata,
        size: loaded.background.size,
        width: loaded.background.width,
        height: loaded.background.height,
      });
      return loaded.runtime;
    }
    if (!background.source) throw new Error('画像本体が保存されていません');
    const image = await loadImageElement(background.source);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    background.pages = [{ number: 1, width, height, rotation: 0 }];
    background.pageCount = 1;
    background.currentPage = 1;
    background.width = width;
    background.height = height;
    background.metadata = { ...(isObject(background.metadata) ? background.metadata : {}), width, height };
    return {
      type: 'image',
      image,
      pages: 1,
      pageCount: 1,
      async destroy() {
        try { this.image.src = ''; } catch (_) { /* best effort */ }
        this.image = null;
      },
    };
  }

  async function renderPdfPage(runtime, pageNumber, options = {}) {
    if (!runtime?.pdf || runtime.type !== 'pdf') throw new Error('PDFランタイムがありません');
    const number = integerInRange(pageNumber, 1, 1, runtime.pdf.numPages);
    const page = await runtime.pdf.getPage(number);
    const baseViewport = page.getViewport({ scale: 1 });
    let scale = clamp(finiteOr(options.scale, PDF_RENDER_SCALE), 0.05, 16);
    const maximumPixels = Math.max(1_000_000, finiteOr(options.maxPixels, MAX_RENDER_PIXELS));
    const requestedPixels = baseViewport.width * baseViewport.height * scale * scale;
    if (requestedPixels > maximumPixels) scale *= Math.sqrt(maximumPixels / requestedPixels);
    const viewport = page.getViewport({ scale });
    const canvas = options.canvas || createCanvas(viewport.width, viewport.height);
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2Dを利用できません');
    const previous = runtime.renderTasks.get(canvas);
    if (previous) {
      try { previous.cancel(); } catch (_) { /* already complete */ }
    }
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = options.backgroundColor || '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
    const task = page.render({ canvasContext: context, viewport });
    runtime.renderTasks.set(canvas, task);
    try {
      await task.promise;
    } catch (error) {
      if (error?.name !== 'RenderingCancelledException') throw error;
      return { cancelled: true, canvas, page: number, pages: runtime.pdf.numPages, scale };
    } finally {
      if (runtime.renderTasks.get(canvas) === task) runtime.renderTasks.delete(canvas);
    }
    return {
      cancelled: false,
      canvas,
      page: number,
      pages: runtime.pdf.numPages,
      width: canvas.width,
      height: canvas.height,
      scale,
      viewport,
      baseViewport,
    };
  }

  async function renderImage(runtime, background, options = {}) {
    if (!runtime?.image || runtime.type !== 'image') throw new Error('画像ランタイムがありません');
    const image = runtime.image;
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const rotation = normalizedQuarterTurn(options.imageRotation ?? background?.imageRotation);
    const scale = clamp(finiteOr(options.scale, 1), 0.01, 32);
    const swapped = rotation === 90 || rotation === 270;
    const width = Math.max(1, Math.ceil((swapped ? sourceHeight : sourceWidth) * scale));
    const height = Math.max(1, Math.ceil((swapped ? sourceWidth : sourceHeight) * scale));
    if (width * height > finiteOr(options.maxPixels, MAX_RENDER_PIXELS)) throw new Error('画像が大きすぎるため描画できません');
    const canvas = options.canvas || createCanvas(width, height);
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Canvas 2Dを利用できません');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(width / 2, height / 2);
    context.rotate(rotation * Math.PI / 180);
    context.scale(scale, scale);
    context.drawImage(image, -sourceWidth / 2, -sourceHeight / 2);
    context.restore();
    return { canvas, page: 1, pages: 1, width, height, scale, imageRotation: rotation };
  }

  async function renderUnderlayPage(runtime, background, pageNumber = 1, options = {}) {
    if (!runtime) throw new Error('下絵ランタイムがありません');
    const result = runtime.type === 'pdf'
      ? renderPdfPage(runtime, pageNumber, options)
      : renderImage(runtime, background, options);
    const resolved = await result;
    if (!resolved.cancelled && isObject(background)) {
      background.currentPage = resolved.page;
      if (runtime.type === 'pdf') {
        const metadata = background.pages?.find((item) => item.number === resolved.page);
        const width = resolved.baseViewport?.width || metadata?.width;
        const height = resolved.baseViewport?.height || metadata?.height;
        if (metadata && width > 0 && height > 0) Object.assign(metadata, {
          width,
          height,
          rotation: resolved.baseViewport?.rotation || 0,
          pending: false,
        });
        if (width > 0 && height > 0) {
          background.width = width;
          background.height = height;
        }
      } else {
        background.width = resolved.width / resolved.scale;
        background.height = resolved.height / resolved.scale;
      }
    }
    return resolved;
  }

  function rotateImage90(background, turns = 1) {
    if (!isObject(background) || background.type !== 'image') throw new Error('90度回転は画像下絵でのみ利用できます');
    const output = cloneValue(background);
    output.imageRotation = normalizedQuarterTurn((output.imageRotation || 0) + Math.trunc(finiteOr(turns, 1)) * 90);
    output.metadata = { ...(isObject(output.metadata) ? output.metadata : {}), imageRotation: output.imageRotation };
    return output;
  }

  function collectGeneralValidationErrors(value, path, errors, seen = new WeakSet()) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      errors.push(`${path}: 有限数ではありません`);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) {
      errors.push(`${path}: 循環参照があります`);
      return;
    }
    seen.add(value);
    for (const [key, item] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (EXCLUDED_KEY.test(key)) errors.push(`${childPath}: 廃止機能のデータは保存できません`);
      if (RUNTIME_KEYS.has(key)) errors.push(`${childPath}: 実行時データは保存できません`);
      collectGeneralValidationErrors(item, childPath, errors, seen);
    }
    seen.delete(value);
  }

  function validatePoint(point, path, errors) {
    if (!isObject(point) || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
      errors.push(`${path}: x/yは有限数である必要があります`);
    }
  }

  function validateStyleObject(style, path, errors) {
    if (style === undefined) return;
    if (!isObject(style)) {
      errors.push(`${path}: オブジェクトではありません`);
      return;
    }
    if (style.opacity !== undefined && (!isFiniteNumber(style.opacity) || style.opacity < 0 || style.opacity > 1)) errors.push(`${path}.opacity: 0〜1の有限数ではありません`);
    for (const key of ['size', 'fontSize', 'width', 'lineWidth', 'offset', 'offsetX', 'offsetY', 'scale', 'adjustment']) {
      if (style[key] !== undefined && !isFiniteNumber(style[key])) errors.push(`${path}.${key}: 有限数ではありません`);
    }
    if (style.angle !== undefined && style.angle !== 'auto' && !isFiniteNumber(style.angle)) errors.push(`${path}.angle: 有限数またはautoではありません`);
    if (style.rotation !== undefined && style.rotation !== 'auto' && !isFiniteNumber(style.rotation)) errors.push(`${path}.rotation: 有限数またはautoではありません`);
  }

  function validateBackground(background, path, errors) {
    if (!isObject(background)) {
      errors.push(`${path}: オブジェクトではありません`);
      return;
    }
    if (!BACKGROUND_TYPES.has(background.type ?? null)) errors.push(`${path}.type: 未対応の下絵種別です`);
    for (const key of ['opacity', 'x', 'y', 'scale', 'rotation']) {
      if (!isFiniteNumber(background[key])) errors.push(`${path}.${key}: 有限数ではありません`);
    }
    if (isFiniteNumber(background.opacity) && (background.opacity < 0 || background.opacity > 1)) errors.push(`${path}.opacity: 0〜1である必要があります`);
    if (isFiniteNumber(background.scale) && background.scale <= 0) errors.push(`${path}.scale: 0より大きい必要があります`);
    if (!IMAGE_ROTATIONS.has(background.imageRotation)) errors.push(`${path}.imageRotation: 0/90/180/270のいずれかではありません`);
    for (const key of ['width', 'height']) {
      if (!isFiniteNumber(background[key]) || background[key] < 0) errors.push(`${path}.${key}: 0以上の有限数ではありません`);
    }
    if (!Number.isSafeInteger(background.pageCount) || background.pageCount < 0) errors.push(`${path}.pageCount: 0以上の整数ではありません`);
    if (!Number.isSafeInteger(background.currentPage) || background.currentPage < 1) errors.push(`${path}.currentPage: 1以上の整数ではありません`);
    if (Number.isSafeInteger(background.pageCount) && background.pageCount > 0 && background.currentPage > background.pageCount) errors.push(`${path}.currentPage: pageCountを超えています`);
    if (!Array.isArray(background.pages)) errors.push(`${path}.pages: 配列ではありません`);
    else background.pages.forEach((page, index) => {
      if (!isObject(page) || !Number.isSafeInteger(page.number) || page.number < 1 || !isFiniteNumber(page.width) || page.width <= 0 || !isFiniteNumber(page.height) || page.height <= 0) {
        errors.push(`${path}.pages[${index}]: ページ寸法が不正です`);
      }
    });
    if (background.type === 'pdf') {
      if (typeof background.source !== 'string' || background.source.length === 0) errors.push(`${path}.source: PDF本体がありません`);
      else if (background.source.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(background.source)) errors.push(`${path}.source: PDFのBase64が不正です`);
    }
    if (background.type === 'image' && (typeof background.source !== 'string' || !/^data:image\//i.test(background.source))) errors.push(`${path}.source: 画像本体がありません`);
  }

  function minimumPointsForEntity(kind) {
    if (kind === 'area') return 3;
    if (['text', 'north', 'house', 'parking', 'lot-table'].includes(kind)) return 0;
    return 2;
  }

  function validateOptionalPoint(value, path, errors) {
    if (value !== null && value !== undefined) validatePoint(value, path, errors);
  }

  function validateKindState(state, path, errors) {
    if (!isObject(state)) {
      errors.push(`${path}: nullまたはオブジェクトではありません`);
      return;
    }
    for (const key of KIND_STATE_EXCLUDED_KEYS) {
      if (key === 'edges') continue;
      if (Object.prototype.hasOwnProperty.call(state, key)) errors.push(`${path}.${key}: 種類別状態には保存できません`);
    }
    validateStyleObject(state.style, `${path}.style`, errors);
    validateStyleObject(state.labelStyle, `${path}.labelStyle`, errors);
    validateStyleObject(state.dimensionStyle, `${path}.dimensionStyle`, errors);
    validateOptionalPoint(state.labelPosition, `${path}.labelPosition`, errors);
    validateOptionalPoint(state.areaLabelPosition, `${path}.areaLabelPosition`, errors);
    validateOptionalPoint(state.tsuboLabelPosition, `${path}.tsuboLabelPosition`, errors);
    for (const labelKey of ['areaLabel', 'tsuboLabel']) {
      const label = state[labelKey];
      if (label === null || label === undefined) continue;
      if (!isObject(label)) errors.push(`${path}.${labelKey}: オブジェクトではありません`);
      else {
        validateOptionalPoint(label.position, `${path}.${labelKey}.position`, errors);
        validateStyleObject(label.style, `${path}.${labelKey}.style`, errors);
      }
    }
    if (state.road !== null && state.road !== undefined) {
      if (!isObject(state.road)) errors.push(`${path}.road: オブジェクトではありません`);
      else {
        if (state.road.type !== undefined && !ROAD_TYPES.has(state.road.type)) errors.push(`${path}.road.type: 未対応の道路種別です`);
        validateOptionalPoint(state.road.namePosition, `${path}.road.namePosition`, errors);
        validateOptionalPoint(state.road.widthLabelPosition, `${path}.road.widthLabelPosition`, errors);
        validateOptionalPoint(state.road.widthLabelOffset, `${path}.road.widthLabelOffset`, errors);
        if (state.road.nameStyle !== null && state.road.nameStyle !== undefined) validateStyleObject(state.road.nameStyle, `${path}.road.nameStyle`, errors);
        if (state.road.widthLabelStyle !== null && state.road.widthLabelStyle !== undefined) validateStyleObject(state.road.widthLabelStyle, `${path}.road.widthLabelStyle`, errors);
      }
    }
    if (!Array.isArray(state.edges)) errors.push(`${path}.edges: 配列ではありません`);
    else state.edges.forEach((edge, edgeIndex) => {
      const edgePath = `${path}.edges[${edgeIndex}]`;
      if (!isObject(edge)) {
        errors.push(`${edgePath}: オブジェクトではありません`);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(edge, 'id')) errors.push(`${edgePath}.id: 種類別状態にはIDを保存できません`);
      validatePoint(edge.from, `${edgePath}.from`, errors);
      validatePoint(edge.to, `${edgePath}.to`, errors);
      if (edge.labelOffset !== undefined) validatePoint(edge.labelOffset, `${edgePath}.labelOffset`, errors);
      if (edge.style !== null && edge.style !== undefined) validateStyleObject(edge.style, `${edgePath}.style`, errors);
    });
  }

  function validateKindStates(shape, path, errors) {
    if (!CONVERTIBLE_SHAPE_KINDS.has(shape.kind)) return;
    if (!isObject(shape.kindStates)) {
      errors.push(`${path}.kindStates: オブジェクトではありません`);
      return;
    }
    for (const key of Object.keys(shape.kindStates)) {
      if (!KIND_STATE_KEYS.includes(key)) errors.push(`${path}.kindStates.${key}: 未対応の種類です`);
    }
    KIND_STATE_KEYS.forEach(kind => {
      const statePath = `${path}.kindStates.${kind}`;
      if (!Object.prototype.hasOwnProperty.call(shape.kindStates, kind)) {
        errors.push(`${statePath}: 項目がありません`);
        return;
      }
      const state = shape.kindStates[kind];
      if (state === null) {
        if (kind === shape.kind) errors.push(`${statePath}: 現在種類の状態がありません`);
        return;
      }
      validateKindState(state, statePath, errors);
    });
  }

  function validateDocument(documentValue) {
    const errors = [];
    if (!isObject(documentValue)) return { valid: false, errors: ['document: オブジェクトではありません'] };
    collectGeneralValidationErrors(documentValue, 'document', errors);
    if (documentValue.schemaVersion !== PROJECT_VERSION) errors.push(`document.schemaVersion: ${PROJECT_VERSION}ではありません`);
    validateBackground(documentValue.background, 'document.background', errors);

    if (!isObject(documentValue.calibration)) errors.push('document.calibration: オブジェクトではありません');
    else {
      if (![null, 'scale', 'two-point'].includes(documentValue.calibration.method ?? null)) errors.push('document.calibration.method: 未対応です');
      for (const key of ['mpp', 'mapScale']) {
        const value = documentValue.calibration[key];
        if (value !== null && (!isFiniteNumber(value) || value <= 0)) errors.push(`document.calibration.${key}: nullまたは正の有限数ではありません`);
      }
    }

    if (!isObject(documentValue.paper)) errors.push('document.paper: オブジェクトではありません');
    else {
      if (!PAPER_SIZES.has(documentValue.paper.size)) errors.push('document.paper.size: 未対応です');
      if (!PAPER_ORIENTATIONS.has(documentValue.paper.orientation)) errors.push('document.paper.orientation: 未対応です');
      for (const key of ['widthMm', 'heightMm']) {
        if (!isFiniteNumber(documentValue.paper[key]) || documentValue.paper[key] <= 0) errors.push(`document.paper.${key}: 正の有限数ではありません`);
      }
    }
    if (!isObject(documentValue.preferences)) errors.push('document.preferences: オブジェクトではありません');
    if (!isObject(documentValue.outputDefaults)) errors.push('document.outputDefaults: オブジェクトではありません');
    else {
      if (!PAPER_SIZES.has(documentValue.outputDefaults.paperSize)) errors.push('document.outputDefaults.paperSize: 未対応です');
      if (!PAPER_ORIENTATIONS.has(documentValue.outputDefaults.orientation)) errors.push('document.outputDefaults.orientation: 未対応です');
      if (documentValue.outputDefaults.printScale !== null && (!isFiniteNumber(documentValue.outputDefaults.printScale) || documentValue.outputDefaults.printScale <= 0)) errors.push('document.outputDefaults.printScale: nullまたは正の有限数ではありません');
    }
    if (!Number.isSafeInteger(documentValue.nextId) || documentValue.nextId < 1) errors.push('document.nextId: 1以上の整数ではありません');
    if (!Array.isArray(documentValue.pages) || documentValue.pages.length === 0) errors.push('document.pages: 1ページ以上必要です');

    const identifiers = new Map();
    const registerId = (id, path) => {
      if (!safeIdentifier(id)) {
        errors.push(`${path}: IDが不正です`);
        return;
      }
      const key = `${typeof id}:${String(id)}`;
      if (identifiers.has(key)) errors.push(`${path}: IDが${identifiers.get(key)}と重複しています`);
      else identifiers.set(key, path);
    };

    const pageIds = new Set();
    if (Array.isArray(documentValue.pages)) documentValue.pages.forEach((page, pageIndex) => {
      const pagePath = `document.pages[${pageIndex}]`;
      if (!isObject(page)) {
        errors.push(`${pagePath}: オブジェクトではありません`);
        return;
      }
      registerId(page.id, `${pagePath}.id`);
      pageIds.add(`${typeof page.id}:${String(page.id)}`);
      if (!Number.isSafeInteger(page.sourcePage) || page.sourcePage < 1) errors.push(`${pagePath}.sourcePage: 1以上の整数ではありません`);
      if (page.calibration !== null && page.calibration !== undefined) {
        if (!isObject(page.calibration)) errors.push(`${pagePath}.calibration: nullまたはオブジェクトではありません`);
        else {
          if (![null, 'scale', 'two-point'].includes(page.calibration.method ?? null)) errors.push(`${pagePath}.calibration.method: 未対応です`);
          if (Array.isArray(page.calibration.points)) page.calibration.points.forEach((point, pointIndex) => validatePoint(point, `${pagePath}.calibration.points[${pointIndex}]`, errors));
        }
      }
      if (!isObject(page.outputLayout)) errors.push(`${pagePath}.outputLayout: オブジェクトではありません`);
      else {
        if (!PAPER_SIZES.has(page.outputLayout.paperSize)) errors.push(`${pagePath}.outputLayout.paperSize: 未対応です`);
        if (!PAPER_ORIENTATIONS.has(page.outputLayout.orientation)) errors.push(`${pagePath}.outputLayout.orientation: 未対応です`);
        if (page.outputLayout.printScale !== null && (!isFiniteNumber(page.outputLayout.printScale) || page.outputLayout.printScale <= 0)) errors.push(`${pagePath}.outputLayout.printScale: nullまたは正の有限数ではありません`);
        for (const key of ['offsetMmX', 'offsetMmY']) if (!isFiniteNumber(page.outputLayout[key])) errors.push(`${pagePath}.outputLayout.${key}: 有限数ではありません`);
        for (const key of ['showFrame', 'showTitleFrame', 'includeUnderlay', 'includeGuides', 'initialized']) if (typeof page.outputLayout[key] !== 'boolean') errors.push(`${pagePath}.outputLayout.${key}: 真偽値ではありません`);
      }
      if (!Array.isArray(page.shapes)) errors.push(`${pagePath}.shapes: 配列ではありません`);
      else page.shapes.forEach((shape, shapeIndex) => {
        const shapePath = `${pagePath}.shapes[${shapeIndex}]`;
        if (!isObject(shape)) {
          errors.push(`${shapePath}: オブジェクトではありません`);
          return;
        }
        registerId(shape.id, `${shapePath}.id`);
        if (!SHAPE_KINDS.has(shape.kind)) errors.push(`${shapePath}.kind: 未対応の図形種別です`);
        if (!Array.isArray(shape.points) || shape.points.length < 3) errors.push(`${shapePath}.points: 3点以上必要です`);
        else shape.points.forEach((point, pointIndex) => validatePoint(point, `${shapePath}.points[${pointIndex}]`, errors));
        validateStyleObject(shape.style, `${shapePath}.style`, errors);
        validateStyleObject(shape.labelStyle, `${shapePath}.labelStyle`, errors);
        validateStyleObject(shape.dimensionStyle, `${shapePath}.dimensionStyle`, errors);
        validateKindStates(shape, shapePath, errors);
        if (shape.road?.type !== undefined && !ROAD_TYPES.has(shape.road.type)) errors.push(`${shapePath}.road.type: 未対応の道路種別です`);
        if (shape.labelPosition !== null && shape.labelPosition !== undefined) validatePoint(shape.labelPosition, `${shapePath}.labelPosition`, errors);
        if (shape.road?.widthLabelPosition !== null && shape.road?.widthLabelPosition !== undefined) validatePoint(shape.road.widthLabelPosition, `${shapePath}.road.widthLabelPosition`, errors);
        if (Array.isArray(shape.edges)) shape.edges.forEach((edge, edgeIndex) => {
          const edgePath = `${shapePath}.edges[${edgeIndex}]`;
          if (!isObject(edge)) errors.push(`${edgePath}: オブジェクトではありません`);
          else {
            registerId(edge.id, `${edgePath}.id`);
            validatePoint(edge.from, `${edgePath}.from`, errors);
            validatePoint(edge.to, `${edgePath}.to`, errors);
            if (edge.labelOffset !== undefined) validatePoint(edge.labelOffset, `${edgePath}.labelOffset`, errors);
          }
        });
      });
      if (!Array.isArray(page.entities)) errors.push(`${pagePath}.entities: 配列ではありません`);
      else page.entities.forEach((entity, entityIndex) => {
        const entityPath = `${pagePath}.entities[${entityIndex}]`;
        if (!isObject(entity)) {
          errors.push(`${entityPath}: オブジェクトではありません`);
          return;
        }
        registerId(entity.id, `${entityPath}.id`);
        if (!ENTITY_KINDS.has(entity.kind)) errors.push(`${entityPath}.kind: 未対応の要素種別です`);
        const minimum = minimumPointsForEntity(entity.kind);
        if (!Array.isArray(entity.points)) errors.push(`${entityPath}.points: 配列ではありません`);
        else {
          if (entity.points.length < minimum) errors.push(`${entityPath}.points: ${minimum}点以上必要です`);
          entity.points.forEach((point, pointIndex) => validatePoint(point, `${entityPath}.points[${pointIndex}]`, errors));
        }
        if (minimum === 0 && entity.points?.length === 0 && !entity.position && !isFiniteNumber(entity.x)) errors.push(`${entityPath}: 配置位置がありません`);
        if (entity.position !== undefined) validatePoint(entity.position, `${entityPath}.position`, errors);
        if (entity.tip !== undefined) validatePoint(entity.tip, `${entityPath}.tip`, errors);
        if (entity.labelPosition !== null && entity.labelPosition !== undefined) validatePoint(entity.labelPosition, `${entityPath}.labelPosition`, errors);
        if (entity.kind === 'lot-table' && entity.lotIds !== undefined) {
          if (!Array.isArray(entity.lotIds)) errors.push(`${entityPath}.lotIds: 配列ではありません`);
          else entity.lotIds.forEach((id, idIndex) => {
            if (!safeIdentifier(id)) errors.push(`${entityPath}.lotIds[${idIndex}]: IDが不正です`);
          });
        }
        validateStyleObject(entity.style, `${entityPath}.style`, errors);
        if (Array.isArray(entity.segments)) entity.segments.forEach((segment, segmentIndex) => {
          const segmentPath = `${entityPath}.segments[${segmentIndex}]`;
          if (!isObject(segment)) errors.push(`${segmentPath}: オブジェクトではありません`);
          else {
            registerId(segment.id, `${segmentPath}.id`);
            validatePoint(segment.from, `${segmentPath}.from`, errors);
            validatePoint(segment.to, `${segmentPath}.to`, errors);
            if (segment.labelOffset !== undefined) validatePoint(segment.labelOffset, `${segmentPath}.labelOffset`, errors);
            if (segment.style !== null && segment.style !== undefined) validateStyleObject(segment.style, `${segmentPath}.style`, errors);
          }
        });
      });
    });
    const activeKey = `${typeof documentValue.activePageId}:${String(documentValue.activePageId)}`;
    if (!safeIdentifier(documentValue.activePageId) || !pageIds.has(activeKey)) errors.push('document.activePageId: pages内のIDではありません');
    return { valid: errors.length === 0, errors };
  }

  function extractDocumentCandidate(raw) {
    if (isObject(raw?.document)) return raw.document;
    if (!isObject(raw)) return raw;
    const copy = { ...raw };
    delete copy.format;
    delete copy.version;
    delete copy.appVersion;
    delete copy.savedAt;
    delete copy.view;
    delete copy.meta;
    return copy;
  }

  function validateProject(raw, options = {}) {
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const errors = [];
    if (!isObject(payload)) errors.push('project: オブジェクトではありません');
    else {
      const version = payload.version ?? payload.schemaVersion ?? payload.document?.schemaVersion;
      if (version !== PROJECT_VERSION) errors.push(`project.version: ${PROJECT_VERSION}ではありません`);
      if (payload.format !== undefined && payload.format !== FORMAT) errors.push('project.format: 未対応です');
      errors.push(...validateDocument(extractDocumentCandidate(payload)).errors);
      if (payload.view !== undefined) {
        if (!isObject(payload.view)) errors.push('project.view: オブジェクトではありません');
        else for (const key of ['x', 'y', 'zoom']) {
          if (!isFiniteNumber(payload.view[key])) errors.push(`project.view.${key}: 有限数ではありません`);
        }
      }
    }
    const result = { valid: errors.length === 0, errors };
    if (!result.valid && options.throwOnError) throw new ProjectValidationError(errors);
    return result;
  }

  function sanitizePointArray(points, minimum = 1) {
    if (!Array.isArray(points)) return [];
    const output = points.map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    return output.length >= minimum ? output : [];
  }

  function safeColor(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  function legacyPrice(value) {
    if (value === null || value === undefined || value === '') return null;
    if (Number.isFinite(Number(value))) return Number(value);
    const number = Number(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  function legacyRoadType(label, rawType) {
    const value = `${rawType || ''} ${label || ''}`;
    if (/水路/.test(value)) return 'water';
    if (/位置指定/.test(value)) return 'location-designated';
    if (/認定.*外|認定外/.test(value)) return 'recognized-private';
    if (/私道/.test(value)) return 'private';
    if (/公道/.test(value)) return 'public';
    return 'road';
  }

  function legacyEntityKind(raw) {
    const value = String(raw?.kind || raw?.type || raw?.textType || '').toLowerCase();
    const mapping = {
      'north-arrow': 'north',
      'house-stamp': 'house',
      'parking-stamp': 'parking',
      memo: 'text',
      table: 'lot-table',
      divguide: 'guide',
    };
    return mapping[value] || (ENTITY_KINDS.has(value) ? value : null);
  }

  function migrateV6(raw) {
    if (!isObject(raw)) throw new ProjectValidationError(['v6 project: オブジェクトではありません']);
    const wrapper = cloneValue(raw);
    const documentValue = cloneValue(extractDocumentCandidate(wrapper));
    documentValue.schemaVersion = PROJECT_VERSION;
    const normalized = normalizeDocument(documentValue);
    return {
      document: normalized,
      view: normalizedView(wrapper.view),
      meta: { ...(isObject(wrapper.meta) ? wrapper.meta : {}), name: stringOr(wrapper.meta?.name, '') },
      migratedFrom: 6,
      warnings: [],
    };
  }

  function migrateV5(raw) {
    if (!isObject(raw)) throw new ProjectValidationError(['v5 project: オブジェクトではありません']);
    const wrapper = cloneValue(raw);
    const documentValue = cloneValue(extractDocumentCandidate(wrapper));
    const paper = isObject(documentValue.paper) ? documentValue.paper : {};
    const activePageId = documentValue.activePageId;
    const pages = Array.isArray(documentValue.pages) ? documentValue.pages : [];
    documentValue.schemaVersion = PROJECT_VERSION;
    documentValue.outputDefaults = normalizedOutputLayout(documentValue.outputDefaults || {
      paperSize: paper.size, orientation: paper.orientation, printScale: null,
      showFrame: paper.showFrame !== false, showTitleFrame: paper.showTitleFrame !== false,
      includeUnderlay: paper.includeUnderlay !== false, includeGuides: false, initialized: false,
      offsetMmX: 0, offsetMmY: 0,
    }, paper);
    documentValue.pages = pages.map((page, index) => {
      const pageCalibration = isObject(page?.calibration)
        ? page.calibration
        : page?.id === activePageId && isObject(documentValue.calibration) ? documentValue.calibration : {};
      const existingLayout = isObject(page?.outputLayout) ? page.outputLayout : null;
      const migratedLayout = existingLayout || {
        paperSize: paper.size,
        orientation: paper.orientation,
        printScale: positiveOrNull(pageCalibration.mapScale),
        offsetMmX: 0,
        offsetMmY: 0,
        showFrame: paper.showFrame !== false,
        showTitleFrame: paper.showTitleFrame !== false,
        includeUnderlay: paper.includeUnderlay !== false,
        includeGuides: false,
        initialized: false,
      };
      return { ...page, outputLayout: normalizedOutputLayout(migratedLayout, paper), sourcePage: integerInRange(page?.sourcePage, index + 1, 1, 100_000) };
    });
    const normalized = normalizeDocument(documentValue);
    return {
      document: normalized,
      view: normalizedView(wrapper.view),
      meta: { ...(isObject(wrapper.meta) ? wrapper.meta : {}), name: stringOr(wrapper.meta?.name, '') },
      migratedFrom: 5,
      warnings: ['旧版で「用紙中央へ」を実行済みの場合、移動前の作図座標は保存されていないため自動復元できません。'],
    };
  }

  function migrateLegacyV3(raw) {
    if (!isObject(raw)) throw new ProjectValidationError(['legacy: オブジェクトではありません']);
    if (isObject(raw.document)) {
      const wrapper = raw;
      const embedded = raw.document;
      const firstPage = Array.isArray(embedded.pages) ? embedded.pages[0] : null;
      raw = {
        ...embedded,
        ...wrapper,
        background: wrapper.background ?? embedded.background,
        calibration: wrapper.calibration ?? embedded.calibration,
        paper: wrapper.paper ?? embedded.paper,
        preferences: wrapper.preferences ?? embedded.preferences,
        lots: wrapper.lots ?? embedded.lots ?? firstPage?.lots ?? firstPage?.shapes,
        items: wrapper.items ?? embedded.items ?? firstPage?.items ?? firstPage?.entities,
        texts: wrapper.texts ?? embedded.texts,
      };
    }
    if (isObject(raw.background) || isObject(raw.view)) {
      const background = isObject(raw.background) ? raw.background : {};
      const view = isObject(raw.view) ? raw.view : {};
      raw = {
        ...raw,
        pdfBase64: raw.pdfBase64 ?? background.pdfBase64,
        imageDataUrl: raw.imageDataUrl ?? background.imageDataUrl,
        backgroundName: raw.backgroundName ?? background.name,
        backgroundOpacity: raw.backgroundOpacity ?? background.opacity,
        backgroundVisible: raw.backgroundVisible ?? background.visible,
        bgOffsetX: raw.bgOffsetX ?? background.x,
        bgOffsetY: raw.bgOffsetY ?? background.y,
        bgScale: raw.bgScale ?? background.scale,
        bgRotation: raw.bgRotation ?? background.rotation,
        bgLocked: raw.bgLocked ?? background.locked,
        imageRotation: raw.imageRotation ?? background.imageRotation,
        pageNum: raw.pageNum ?? background.page ?? background.currentPage,
        pageCount: raw.pageCount ?? background.pages,
        vx: raw.vx ?? view.x,
        vy: raw.vy ?? view.y,
        vz: raw.vz ?? view.zoom,
      };
    }
    const documentValue = createFreshDocument();
    documentValue.schemaVersion = PROJECT_VERSION;
    documentValue.pages = [{ id: 'page-1', name: '図面 1', sourcePage: integerInRange(raw.pageNum, 1, 1, 100_000), calibration: null, shapes: [], entities: [] }];
    documentValue.activePageId = 'page-1';
    const page = documentValue.pages[0];
    const usedIds = new Set(['string:page-1']);
    let numericId = 1;
    const allocateId = (preferred) => {
      const key = `${typeof preferred}:${String(preferred)}`;
      if (safeIdentifier(preferred) && !usedIds.has(key)) {
        usedIds.add(key);
        if (typeof preferred === 'number') numericId = Math.max(numericId, preferred + 1);
        return preferred;
      }
      while (usedIds.has(`number:${numericId}`)) numericId += 1;
      const result = numericId++;
      usedIds.add(`number:${result}`);
      return result;
    };
    const allocateStringId = (prefix) => {
      let value;
      do { value = `${prefix}-${numericId++}`; } while (usedIds.has(`string:${value}`));
      usedIds.add(`string:${value}`);
      return value;
    };

    if (typeof raw.pdfBase64 === 'string' && raw.pdfBase64.length > 0) {
      documentValue.background = {
        ...documentValue.background,
        type: 'pdf',
        name: stringOr(raw.backgroundName, '旧図面.pdf'),
        mimeType: 'application/pdf',
        source: raw.pdfBase64.replace(/^data:[^,]*,/, ''),
        size: 0,
        pages: [],
        pageCount: Math.max(1, integerInRange(raw.pageCount, 1, 1, 100_000)),
        currentPage: integerInRange(raw.pageNum, 1, 1, Math.max(1, integerInRange(raw.pageCount, 1, 1, 100_000))),
        width: Math.max(0, finiteOr(raw.pageWidthPt, 0)),
        height: Math.max(0, finiteOr(raw.pageHeightPt, 0)),
      };
    } else if (typeof raw.imageDataUrl === 'string' && /^data:image\//i.test(raw.imageDataUrl)) {
      documentValue.background = {
        ...documentValue.background,
        type: 'image',
        name: stringOr(raw.backgroundName, '旧図面画像'),
        mimeType: raw.imageDataUrl.slice(5, raw.imageDataUrl.indexOf(';')) || 'image/png',
        source: raw.imageDataUrl,
        pages: [],
        pageCount: 1,
        currentPage: 1,
        width: Math.max(0, finiteOr(raw.pageWidthPt, 0)),
        height: Math.max(0, finiteOr(raw.pageHeightPt, 0)),
      };
    }
    Object.assign(documentValue.background, {
      x: finiteOr(raw.bgOffsetX, 0),
      y: finiteOr(raw.bgOffsetY, 0),
      scale: Math.max(0.0001, finiteOr(raw.bgScale, 1)),
      rotation: finiteOr(raw.bgRotation, 0),
      imageRotation: normalizedQuarterTurn(raw.imageRotation),
      locked: raw.bgLocked !== false,
      visible: raw.backgroundVisible !== false,
      opacity: clamp(finiteOr(raw.backgroundOpacity, 0.68), 0, 1),
    });
    documentValue.calibration = {
      mpp: positiveOrNull(raw.mpp),
      mapScale: positiveOrNull(raw.mapScale),
    };

    const globalLotFill = safeColor(raw.lotStrokeColor, '#fff0bd');
    const globalLotStroke = safeColor(raw.lotBorderColor, '#a46a08');
    const globalOpacity = clamp(finiteOr(raw.lotFillOpacity, 0.58), 0, 1);
    for (const oldShape of Array.isArray(raw.lots) ? raw.lots : []) {
      const points = sanitizePointArray(oldShape?.points, 3);
      if (points.length < 3) continue;
      const isRoad = oldShape.type === 'road' || oldShape.kind === 'road' || oldShape.kind === 'water';
      const legacyRoad = isObject(oldShape.road) ? oldShape.road : {};
      const roadType = isRoad ? legacyRoadType(oldShape.roadLabel ?? legacyRoad.name ?? oldShape.label, oldShape.roadType ?? legacyRoad.type) : null;
      const kind = isRoad ? (oldShape.kind === 'water' || roadType === 'water' ? 'water' : 'road') : (oldShape.type === 'cutout' || oldShape.kind === 'cutout' ? 'cutout' : 'lot');
      const legacyNumber = oldShape.number ?? oldShape.lotNum;
      const number = legacyNumber !== null && legacyNumber !== undefined && Number.isFinite(Number(legacyNumber))
        ? Number(legacyNumber) : null;
      const price = legacyPrice(oldShape.price);
      const fill = safeColor(oldShape.style?.fill ?? oldShape.color, isRoad ? '#cbd5e1' : globalLotFill);
      const stroke = safeColor(oldShape.style?.stroke ?? oldShape.borderColor, isRoad ? '#64748b' : globalLotStroke);
      const opacity = clamp(finiteOr(oldShape.style?.opacity ?? oldShape.fillOpacity, isRoad ? 0.48 : globalOpacity), 0, 1);
      const indexedValue = (collection, index) => (Array.isArray(collection) || isObject(collection)) ? collection[index] : undefined;
      const oldEdgeHidden = oldShape.edgeHidden;
      const oldHiddenEdges = new Set(Array.isArray(oldShape.hiddenEdges) ? oldShape.hiddenEdges.map(String) : []);
      const oldEdgeOffsets = oldShape.edgeLabelOffsets;
      const oldVisibility = isObject(oldShape.visibility) ? oldShape.visibility : {};
      const legacyAreaHidden = String(oldShape.areaDisplay || '').toLowerCase() === 'hide';
      const areaVisible = kind === 'lot' && Boolean(oldShape.areaLabel?.visible
        ?? oldVisibility.area
        ?? (!legacyAreaHidden && oldShape.showArea !== false));
      const tsuboVisible = kind === 'lot' && Boolean(oldShape.tsuboLabel?.visible
        ?? oldVisibility.tsubo
        ?? (!legacyAreaHidden && oldShape.showTsubo !== false));
      const rawPrimaryLabel = stringOr(oldShape.label ?? oldShape.displayText, '');
      const compactPrimaryLabel = rawPrimaryLabel.replace(/[\s　]+/g, '');
      const generatedNumberLabel = number !== null && compactPrimaryLabel === `区画${number}`;
      const generatedNumberPrefix = number !== null ? new RegExp(`^区画\\s*${number}(?:[\\s　]+|$)`) : null;
      let primaryLabel = kind === 'lot' && generatedNumberPrefix?.test(rawPrimaryLabel)
        ? rawPrimaryLabel.replace(generatedNumberPrefix, '').trim()
        : rawPrimaryLabel;
      const primaryMetricOnly = primaryLabel.split(/[\r\n]+/).map(value => value.trim()).filter(Boolean)
        .every(value => /^(?:約)?[\d,.]+\s*(?:㎡|m²|m2|坪)$/i.test(value));
      if (kind === 'lot' && (generatedNumberLabel || (primaryLabel && primaryMetricOnly))) primaryLabel = '';
      const edgeBaseSize = clamp(finiteOr(oldShape.dimensionStyle?.fontSize ?? oldShape.dimensionStyle?.size ?? oldShape.edgeLabelSize, 10 * finiteOr(oldShape.edgeScale ?? oldShape.lotEdgeScale ?? raw.lotEdgeScale, 1)), 4, 200);
      const edges = points.map((from, index) => {
        const sourceEdge = indexedValue(oldShape.edges, index) || {};
        const customColor = indexedValue(oldShape.customEdgeLabelColors, index);
        const customFont = indexedValue(oldShape.customEdgeFontFamilies, index);
        const customScale = finiteOr(indexedValue(oldShape.customEdgeScales, index), 1);
        const edgeStyle = isObject(sourceEdge.style) ? cleanSerializable(sourceEdge.style) : {};
        if (typeof customColor === 'string' && customColor.trim()) edgeStyle.color = customColor.trim();
        if (typeof customFont === 'string' && customFont.trim()) edgeStyle.fontFamily = customFont.trim();
        if (customScale > 0 && Math.abs(customScale - 1) > 1e-9) {
          edgeStyle.size = clamp(edgeBaseSize * customScale, 4, 300);
          edgeStyle.fontSize = edgeStyle.size;
        }
        const offset = indexedValue(oldEdgeOffsets, index) || sourceEdge.labelOffset;
        const customText = indexedValue(oldShape.customEdgeLabels, index) ?? sourceEdge.customText;
        return {
          id: safeIdentifier(sourceEdge.id) ? sourceEdge.id : allocateStringId('edge'),
          from: { ...from },
          to: { ...points[(index + 1) % points.length] },
          hidden: sourceEdge.hidden === true || !!indexedValue(oldEdgeHidden, index) || oldHiddenEdges.has(String(index)),
          customText: customText == null ? null : String(customText),
          labelOffset: {
            x: finiteOr(offset?.dx ?? offset?.x, 0),
            y: finiteOr(offset?.dy ?? offset?.y, 0),
          },
          rotationOffset: finiteOr(indexedValue(oldShape.edgeRotationOffset, index) ?? sourceEdge.rotationOffset, 0),
          style: Object.keys(edgeStyle).length ? edgeStyle : null,
        };
      });
      const shape = {
        id: allocateId(oldShape.id),
        kind,
        number,
        label: primaryLabel,
        topLabel: stringOr(oldShape.topLabel, ''),
        memo: stringOr(oldShape.memo, ''),
        points,
        style: {
          fill, stroke, opacity,
          lineWidth: clamp(finiteOr(oldShape.lineWidth, 1.25), 0.1, 20),
          lineStyle: stringOr(oldShape.lineStyle, 'solid'),
        },
        labelStyle: {
          fontFamily: stringOr(oldShape.labelStyle?.fontFamily ?? oldShape.labelStyle?.font ?? oldShape.labelFontFamily ?? oldShape.roadLabelFontFamily, 'Yu Gothic UI'),
          fontSize: clamp(finiteOr(oldShape.labelStyle?.fontSize ?? oldShape.labelStyle?.size ?? oldShape.labelSize, 14 * finiteOr(oldShape.labelScale ?? oldShape.lotTextScale ?? raw.lotTextScale, 1)), 4, 200),
          color: safeColor(oldShape.labelStyle?.color ?? oldShape.labelTextColor ?? oldShape.roadLabelColor, '#334155'),
          rotation: clamp(finiteOr(oldShape.labelStyle?.rotation ?? oldShape.labelStyle?.angle ?? oldShape.labelRotation ?? oldShape.roadLabelRotation, 0), -3600, 3600),
          angle: clamp(finiteOr(oldShape.labelStyle?.angle ?? oldShape.labelStyle?.rotation ?? oldShape.labelRotation ?? oldShape.roadLabelRotation, 0), -3600, 3600),
          vertical: !!(oldShape.labelStyle?.vertical ?? oldShape.labelVertical ?? oldShape.roadVertical),
          offsetX: finiteOr(oldShape.labelStyle?.offsetX ?? oldShape.labelOffX, 0),
          offsetY: finiteOr(oldShape.labelStyle?.offsetY ?? oldShape.labelOffY, 0),
        },
        dimensionStyle: {
          fontFamily: stringOr(oldShape.dimensionStyle?.fontFamily ?? oldShape.edgeFontFamily, 'Yu Gothic UI'),
          size: clamp(finiteOr(oldShape.dimensionStyle?.size ?? oldShape.dimensionStyle?.fontSize ?? oldShape.edgeLabelSize, 10 * finiteOr(oldShape.lotEdgeScale ?? raw.lotEdgeScale, 1)), 4, 200),
          fontSize: clamp(finiteOr(oldShape.dimensionStyle?.fontSize ?? oldShape.dimensionStyle?.size ?? oldShape.edgeLabelSize, 10 * finiteOr(oldShape.edgeScale ?? oldShape.lotEdgeScale ?? raw.lotEdgeScale, 1)), 4, 200),
          color: safeColor(oldShape.dimensionStyle?.color ?? oldShape.edgeLabelColor, '#dc2626'),
          offset: clamp(finiteOr(oldShape.dimensionStyle?.offset ?? oldShape.edgeLabelOffset, 10), 0, 1_000),
          rotation: oldShape.dimensionStyle?.rotation ?? (oldShape.edgeLabelRotate === false ? 0 : 'auto'),
          decimals: integerInRange(oldShape.dimensionStyle?.decimals ?? oldShape.decimals ?? raw.yakuDecimal, 2, 0, 6),
          approximate: !!(oldShape.approximate
            ?? (oldShape.yakuMode != null ? oldShape.yakuMode === 'on' : raw.useYaku)),
          rounding: stringOr(oldShape.dimensionStyle?.rounding, raw.useYaku ? 'floor' : 'round'),
          adjustment: finiteOr(oldShape.dimensionStyle?.adjustment ?? oldShape.yakuAdjust ?? raw.yakuAdjust, 0),
        },
        visibility: {
          label: oldVisibility.label ?? oldShape.showLabel ?? true,
          number: kind === 'lot' ? (oldVisibility.number ?? oldShape.showNumber ?? raw.showLotNumbers !== false) : false,
          topLabel: kind === 'lot' ? (oldVisibility.topLabel ?? oldShape.showTopLabel ?? true) : false,
          area: areaVisible,
          tsubo: tsuboVisible,
          price: kind === 'lot' ? (oldVisibility.price ?? oldShape.showPrice ?? true) : false,
          memo: kind === 'lot' ? (oldVisibility.memo ?? oldShape.showMemo ?? true) : false,
          dimensions: kind === 'lot' && Boolean(oldVisibility.dimensions ?? oldShape.showLengths ?? oldShape.showEdgeLengths ?? raw.lotShowEdgeLengths),
          approximate: kind === 'lot' && Boolean(oldVisibility.approximate ?? oldShape.approximate
            ?? (oldShape.yakuMode != null ? oldShape.yakuMode === 'on' : raw.useYaku)),
        },
        edges,
      };
      if (number === null) delete shape.number;
      if (price !== null) shape.price = price;
      if (kind === 'lot') {
        const metricBaseSize = clamp(finiteOr(oldShape.metricLabelSize, 12), 4, 200);
        shape.areaLabel = {
          text: oldShape.customAreaLabel == null || oldShape.customAreaLabel === '' ? null : String(oldShape.customAreaLabel),
          position: isObject(oldShape.areaLabelPosition) ? {
            x: finiteOr(oldShape.areaLabelPosition.x, 0), y: finiteOr(oldShape.areaLabelPosition.y, 0),
          } : null,
          visible: areaVisible,
          style: {
            fontFamily: stringOr(oldShape.customAreaFontFamily ?? oldShape.labelFontFamily, 'Yu Gothic UI'),
            size: metricBaseSize * Math.max(0.1, finiteOr(oldShape.customAreaLabelScale, 1)),
            fontSize: metricBaseSize * Math.max(0.1, finiteOr(oldShape.customAreaLabelScale, 1)),
            color: safeColor(oldShape.customAreaLabelColor, '#172033'),
            rotation: finiteOr(oldShape.customAreaLabelRotation, 0),
            vertical: !!oldShape.customAreaLabelVertical,
          },
        };
        shape.tsuboLabel = {
          text: oldShape.customTsuboLabel == null || oldShape.customTsuboLabel === '' ? null : String(oldShape.customTsuboLabel),
          position: isObject(oldShape.tsuboLabelPosition) ? {
            x: finiteOr(oldShape.tsuboLabelPosition.x, 0), y: finiteOr(oldShape.tsuboLabelPosition.y, 0),
          } : null,
          visible: tsuboVisible,
          style: {
            fontFamily: stringOr(oldShape.customTsuboFontFamily ?? oldShape.labelFontFamily, 'Yu Gothic UI'),
            size: metricBaseSize * Math.max(0.1, finiteOr(oldShape.customTsuboLabelScale, 1)),
            fontSize: metricBaseSize * Math.max(0.1, finiteOr(oldShape.customTsuboLabelScale, 1)),
            color: safeColor(oldShape.customTsuboLabelColor, '#172033'),
            rotation: finiteOr(oldShape.customTsuboLabelRotation, 0),
            vertical: !!oldShape.customTsuboLabelVertical,
          },
        };
      }
      if (isRoad) {
        const widthOffsetPresent = oldShape.roadWidthOffX != null || oldShape.roadWidthOffY != null;
        shape.road = {
          type: roadType,
          name: stringOr(oldShape.roadLabel ?? legacyRoad.name ?? oldShape.label, roadType === 'water' ? '水路' : '道路'),
          widthM: positiveOrNull(oldShape.roadWidth ?? legacyRoad.widthM ?? legacyRoad.width),
          vertical: !!(oldShape.roadVertical ?? legacyRoad.vertical),
          widthLabelOffset: widthOffsetPresent ? { x: finiteOr(oldShape.roadWidthOffX, 0), y: finiteOr(oldShape.roadWidthOffY, 0) } : null,
          widthLabelStyle: {
            fontFamily: stringOr(oldShape.roadWidthFontFamily ?? oldShape.roadLabelFontFamily, 'Yu Gothic UI'),
            size: clamp(11 * finiteOr(oldShape.roadWidthLabelSize ?? oldShape.roadLabelSize, 1), 4, 200),
            fontSize: clamp(11 * finiteOr(oldShape.roadWidthLabelSize ?? oldShape.roadLabelSize, 1), 4, 200),
            color: safeColor(oldShape.roadWidthLabelColor ?? oldShape.roadLabelColor, '#475569'),
            rotation: finiteOr(oldShape.roadLabelRotation, 0),
            angle: finiteOr(oldShape.roadLabelRotation, 0),
            vertical: !!oldShape.roadVertical,
          },
        };
        shape.label = stringOr(oldShape.roadLabel, roadType === 'water' ? '水路' : '道路');
      }
      page.shapes.push(shape);
    }

    const migrateItem = (oldEntity, forcedKind = null) => {
      const kind = forcedKind || legacyEntityKind(oldEntity);
      if (!kind) return null;
      let points = sanitizePointArray(oldEntity.points, 1);
      if (points.length === 0 && Number.isFinite(Number(oldEntity.x)) && Number.isFinite(Number(oldEntity.y))) points = [{ x: Number(oldEntity.x), y: Number(oldEntity.y) }];
      if (kind === 'callout' && Number.isFinite(Number(oldEntity.tipX)) && Number.isFinite(Number(oldEntity.tipY))) {
        points = [{ x: Number(oldEntity.tipX), y: Number(oldEntity.tipY) }, ...(points.slice(-1))];
      }
      if (points.length < minimumPointsForEntity(kind)) return null;
      const entity = {
        id: allocateId(oldEntity.id),
        kind,
        points,
        text: stringOr(oldEntity.text ?? oldEntity.label, ''),
        style: {
          color: safeColor(oldEntity.color ?? oldEntity.lineColor, '#1d4ed8'),
          fill: safeColor(oldEntity.bgColor, 'transparent'),
          background: safeColor(oldEntity.bgColor, 'transparent'),
          lineWidth: clamp(finiteOr(oldEntity.lineWidth, 1.5), 0.1, 100),
          lineStyle: stringOr(oldEntity.lineStyle, 'solid'),
          fontFamily: stringOr(oldEntity.fontFamily ?? oldEntity.labelFontFamily, 'Yu Gothic UI'),
          fontSize: clamp(finiteOr(oldEntity.fontSize, 14 * finiteOr(raw.subMeasureScale, 1)), 4, 300),
          vertical: !!oldEntity.vertical,
          boxStyle: stringOr(oldEntity.boxStyle, 'none'),
        },
        rotation: finiteOr(oldEntity.angle ?? oldEntity.rotation ?? oldEntity.labelRotation, 0),
        vertical: !!oldEntity.vertical,
        background: safeColor(oldEntity.bgColor, 'transparent'),
        textStyle: {
          color: safeColor(oldEntity.color, '#1a1a1a'),
          size: clamp(finiteOr(oldEntity.fontSize, 14 * finiteOr(raw.subMeasureScale, 1)), 4, 300),
          fontFamily: stringOr(oldEntity.fontFamily ?? oldEntity.labelFontFamily, 'Yu Gothic UI'),
          angle: finiteOr(oldEntity.angle ?? oldEntity.rotation ?? oldEntity.labelRotation, 0),
          vertical: !!oldEntity.vertical,
          background: safeColor(oldEntity.bgColor, 'transparent'),
          boxStyle: stringOr(oldEntity.boxStyle, 'none'),
        },
      };
      if (['distance', 'polyline', 'area', 'dimension'].includes(kind)) {
        entity.text = stringOr(oldEntity.customLabel ?? oldEntity.label, '');
        entity.labelPosition = cleanSerializable(oldEntity.labelPos) || null;
        entity.segmentLabels = Array.isArray(oldEntity.customSegLabels)
          ? oldEntity.customSegLabels.map((value, index) => value ?? oldEntity.segLabels?.[index] ?? '')
          : (Array.isArray(oldEntity.segLabels) ? oldEntity.segLabels.map(String) : []);
        entity.segmentLabelPositions = cleanSerializable(oldEntity.segLabelPos) || [];
        entity.dimensionStyle = {
          color: safeColor(oldEntity.color, '#1d4ed8'),
          fontSize: clamp(finiteOr(oldEntity.fontSize, 10 * finiteOr(raw.subMeasureScale, 1)), 4, 200),
          size: clamp(finiteOr(oldEntity.fontSize, 10 * finiteOr(raw.subMeasureScale, 1)), 4, 200),
          approximate: !!raw.useYaku,
          decimals: integerInRange(raw.yakuDecimal, 2, 0, 6),
          rounding: raw.useYaku ? 'floor' : 'round',
          adjustment: finiteOr(raw.yakuAdjust, 0),
        };
      }
      if (kind === 'north') {
        entity.angle = finiteOr(oldEntity.angle, 0);
        entity.size = Math.max(16, 54 * finiteOr(oldEntity.size, 1));
        entity.text = stringOr(oldEntity.text, 'N');
      }
      if (kind === 'house' || kind === 'parking') {
        entity.width = Math.max(0.01, finiteOr(oldEntity.wM, kind === 'parking' ? 5 : 10));
        entity.height = Math.max(0.01, finiteOr(oldEntity.hM, kind === 'parking' ? 2.5 : 8));
        entity.angle = finiteOr(oldEntity.angle, 0);
        entity.text = stringOr(oldEntity.label, kind === 'parking' ? 'P' : '家屋');
        entity.showDimensions = oldEntity.showDims !== false;
        entity.units = 'metric';
      }
      if (kind === 'lot-table') {
        entity.title = stringOr(oldEntity.title, '区画一覧');
        if (Array.isArray(oldEntity.columns) && oldEntity.columns.every(isObject)) entity.columns = cleanSerializable(oldEntity.columns);
        entity.fontSize = clamp(finiteOr(oldEntity.fontSize, 10), 4, 100);
      }
      return entity;
    };

    for (const item of Array.isArray(raw.items) ? raw.items : []) {
      const entity = migrateItem(item);
      if (entity) page.entities.push(entity);
    }
    for (const text of Array.isArray(raw.texts) ? raw.texts : []) {
      const entity = migrateItem(text, legacyEntityKind(text) || 'text');
      if (entity) page.entities.push(entity);
    }
    for (const guide of Array.isArray(raw.divGuides) ? raw.divGuides : []) {
      const points = sanitizePointArray(guide.points || [guide.p1, guide.p2], 2);
      if (points.length < 2) continue;
      page.entities.push({
        id: allocateId(guide.id),
        kind: 'guide',
        points: points.slice(0, 2),
        text: '',
        style: { color: '#f59e0b', lineWidth: 1, lineStyle: 'dashed' },
        options: { divisions: integerInRange(guide.n, 2, 2, 1_000) },
      });
    }
    for (const line of Array.isArray(raw.parallelLines) ? raw.parallelLines : []) {
      const points = sanitizePointArray(line.points || [line.p1, line.p2], 2);
      if (points.length < 2) continue;
      page.entities.push({
        id: allocateId(line.id),
        kind: 'parallel',
        points: points.slice(0, 2),
        text: '',
        style: { color: safeColor(line.color, '#0ea5e9'), lineWidth: 1, lineStyle: 'dashed' },
        options: { distance: finiteOr(line.distance, 0) },
      });
    }

    const paperSize = PAPER_SIZES.has(raw.paperSize) ? raw.paperSize : 'A4';
    documentValue.paper = {
      ...documentValue.paper,
      enabled: !!raw.paperMode,
      size: paperSize,
      orientation: raw.paperOrientation === 'portrait' ? 'portrait' : 'landscape',
      widthMm: paperSize === 'A3' ? 420 : 297,
      heightMm: paperSize === 'A3' ? 297 : 210,
      title: stringOr(raw.paperInfo?.title, ''),
      date: stringOr(raw.paperInfo?.date, ''),
      author: stringOr(raw.paperInfo?.author, ''),
    };
    // Deliberately keep only fresh v5 preferences. Old command defaults and localStorage styles are never imported.
    documentValue.preferences = cloneValue(createFreshDocument().preferences || fallbackDocument().preferences);
    const numericIds = [...page.shapes, ...page.entities].map((item) => typeof item.id === 'number' ? item.id : 0);
    documentValue.nextId = Math.max(numericId, ...numericIds.map((id) => id + 1), 1);
    const view = {
      x: finiteOr(raw.vx, 18),
      y: finiteOr(raw.vy, 18),
      zoom: clamp(finiteOr(raw.vz, 1), 0.01, 100),
    };
    return { document: normalizeDocument(documentValue), view, migratedFrom: Number(raw.version) || 3 };
  }

  function canonicalDocument(source) {
    const normalized = normalizeDocument(source);
    const canonical = cleanSerializable({
      format: FORMAT,
      schemaVersion: PROJECT_VERSION,
      appVersion: stringOr(normalized.appVersion, APP_VERSION),
      id: normalized.id,
      title: normalized.title,
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt,
      pages: normalized.pages,
      activePageId: normalized.activePageId,
      background: normalized.background,
      calibration: normalized.calibration,
      paper: normalized.paper,
      outputDefaults: normalized.outputDefaults,
      preferences: normalized.preferences,
      nextId: normalized.nextId,
    });
    const check = validateDocument(canonical);
    if (!check.valid) throw new ProjectValidationError(check.errors);
    return canonical;
  }

  function normalizedView(value) {
    const source = isObject(value) ? value : {};
    return {
      x: finiteOr(source.x, 18),
      y: finiteOr(source.y, 18),
      zoom: clamp(finiteOr(source.zoom, 1), 0.01, 100),
    };
  }

  function serializeProject(documentValue, options = {}) {
    const documentSource = isObject(documentValue?.document) ? documentValue.document : documentValue;
    const documentCheck = validateDocument(documentSource);
    if (!documentCheck.valid) throw new ProjectValidationError(documentCheck.errors);
    const documentData = canonicalDocument(documentSource);
    const payload = {
      format: FORMAT,
      version: PROJECT_VERSION,
      appVersion: stringOr(options.appVersion, APP_VERSION),
      savedAt: options.savedAt || new Date().toISOString(),
      document: documentData,
      view: normalizedView(options.view ?? documentValue?.view),
      meta: {
        name: stringOr(options.name ?? documentValue?.meta?.name, ''),
      },
    };
    validateProject(payload, { throwOnError: true });
    return JSON.stringify(payload, null, options.pretty === false ? 0 : 2);
  }

  function deserializeProject(input, options = {}) {
    let raw;
    try { raw = typeof input === 'string' ? JSON.parse(input) : cloneValue(input); }
    catch (error) { throw new ProjectValidationError([`JSONを解析できません: ${error.message}`]); }
    if (!isObject(raw)) throw new ProjectValidationError(['project: オブジェクトではありません']);
    const version = Number(raw.version ?? raw.schemaVersion ?? raw.document?.schemaVersion);
    if (version === 6) {
      if (options.allowLegacy === false) throw new ProjectValidationError(['v6形式の読込は無効です']);
      const migrated = migrateV6(raw);
      const check = validateDocument(migrated.document);
      if (!check.valid) throw new ProjectValidationError(check.errors);
      return migrated;
    }
    if (version === 5) {
      if (options.allowLegacy === false) throw new ProjectValidationError(['v5形式の読込は無効です']);
      const migrated = migrateV5(raw);
      const check = validateDocument(migrated.document);
      if (!check.valid) throw new ProjectValidationError(check.errors);
      return migrated;
    }
    if (version === 3 || version === 4 || (version === 0 && (raw.lots || raw.items || raw.texts))) {
      if (options.allowLegacy === false) throw new ProjectValidationError(['旧形式の読込は無効です']);
      const migrated = migrateLegacyV3(raw);
      const check = validateDocument(migrated.document);
      if (!check.valid) throw new ProjectValidationError(check.errors);
      return {
        ...migrated,
        meta: { name: stringOr(options.name, '') },
      };
    }
    validateProject(raw, { throwOnError: true });
    return {
      document: canonicalDocument(extractDocumentCandidate(raw)),
      view: normalizedView(raw.view),
      meta: { ...(isObject(raw.meta) ? raw.meta : {}), name: stringOr(raw.meta?.name ?? options.name, '') },
      migratedFrom: null,
    };
  }

  async function openProjectFile(file, options = {}) {
    if (!file) throw new TypeError('プロジェクトファイルが指定されていません');
    const result = deserializeProject(await file.text(), { ...options, name: file.name });
    if (options.hydrateBackground !== false && result.document.background.type) {
      result.runtime = await createUnderlayRuntime(result.document.background);
      const page = result.document.pages.find((item) => item.id === result.document.activePageId);
      if (page && result.document.background.type === 'pdf') {
        const maximumPage = Math.max(1, result.document.background.pageCount || result.document.background.pages.length || 1);
        // The drawing page owns sourcePage. Restoring the PDF must follow it;
        // rewriting sourcePage here used to collapse page-local drawings.
        const sourcePage = integerInRange(page.sourcePage, result.document.background.currentPage || 1, 1, maximumPage);
        page.sourcePage = sourcePage;
        result.document.background.currentPage = sourcePage;
        const metadata = result.document.background.pages.find((item) => item.number === sourcePage);
        if (metadata) {
          result.document.background.width = metadata.width;
          result.document.background.height = metadata.height;
        }
      }
    } else result.runtime = null;
    return result;
  }

  function safeFileName(value, fallback) {
    const cleaned = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
    return cleaned || fallback;
  }

  function downloadBlob(blob, fileName) {
    if (!global.document?.createElement || !global.URL?.createObjectURL) throw new Error('この環境ではダウンロードできません');
    const name = safeFileName(fileName, 'download');
    const url = global.URL.createObjectURL(blob);
    const link = global.document.createElement('a');
    link.href = url;
    link.download = name;
    link.style.display = 'none';
    global.document.body?.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(() => global.URL.revokeObjectURL(url), 1000);
    return name;
  }

  function downloadProjectJson(documentValue, fileName, options = {}) {
    const contents = serializeProject(documentValue, options);
    const name = safeFileName(fileName || options.name || 'kozu-project', 'kozu-project');
    const finalName = /\.json$/i.test(name) ? name : `${name}.kozu.json`;
    downloadBlob(new Blob([contents], { type: 'application/json;charset=utf-8' }), finalName);
    return { fileName: finalName, contents };
  }

  function canvasToBlob(canvas, type = 'image/png', quality) {
    if (typeof canvas?.convertToBlob === 'function') return canvas.convertToBlob({ type, quality });
    return new Promise((resolve, reject) => {
      if (typeof canvas?.toBlob !== 'function') {
        reject(new Error('Canvasを画像に変換できません'));
        return;
      }
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('画像を生成できません')), type, quality);
    });
  }

  async function downloadCanvasPng(canvas, fileName = '区画図.png') {
    if (!canvas || !(canvas.width > 0 && canvas.height > 0)) throw new Error('出力するCanvasがありません');
    const blob = await canvasToBlob(canvas, 'image/png');
    const finalName = /\.png$/i.test(fileName) ? fileName : `${fileName}.png`;
    downloadBlob(blob, safeFileName(finalName, '区画図.png'));
    return { fileName: finalName, width: canvas.width, height: canvas.height, blob };
  }

  async function clipboardImageFromEvent(event, options = {}) {
    const clipboard = event?.clipboardData;
    if (!clipboard) return null;
    const files = [...(clipboard.files || [])];
    const direct = files.find((file) => /^image\//i.test(file.type || ''));
    if (direct) return direct;
    for (const item of [...(clipboard.items || [])]) {
      if (item.kind === 'file' && /^image\//i.test(item.type || '')) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
    return null;
  }

  async function readClipboardImage(options = {}) {
    if (!global.navigator?.clipboard?.read) throw new Error('クリップボード画像の読込に対応していません');
    const items = await global.navigator.clipboard.read();
    for (const item of items) {
      const mimeType = item.types.find((type) => /^image\//i.test(type));
      if (!mimeType) continue;
      const blob = await item.getType(mimeType);
      return loadImageBlob(blob, { ...options, name: options.name || 'クリップボード画像' });
    }
    return null;
  }

  async function copyCanvasPngToClipboard(canvas) {
    if (!global.navigator?.clipboard?.write || typeof global.ClipboardItem !== 'function') throw new Error('クリップボード画像の書込に対応していません');
    const blob = await canvasToBlob(canvas, 'image/png');
    await global.navigator.clipboard.write([new global.ClipboardItem({ 'image/png': blob })]);
    return blob;
  }

  function canvasDataUrl(canvas) {
    if (typeof canvas?.toDataURL === 'function') return canvas.toDataURL('image/png');
    throw new Error('印刷HTMLには通常のCanvasが必要です');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function printPaperDimensions(options = {}) {
    const size = PAPER_SIZES.has(options.paperSize) ? options.paperSize : 'A4';
    const orientation = PAPER_ORIENTATIONS.has(options.orientation) ? options.orientation : 'landscape';
    const portrait = size === 'A3'
      ? { widthMm: 297, heightMm: 420 }
      : { widthMm: 210, heightMm: 297 };
    return Object.freeze({
      size,
      orientation,
      widthMm: orientation === 'landscape' ? portrait.heightMm : portrait.widthMm,
      heightMm: orientation === 'landscape' ? portrait.widthMm : portrait.heightMm,
    });
  }

  function canvasToPrintHTML(canvas, options = {}) {
    if (!canvas || !(canvas.width > 0 && canvas.height > 0)) throw new Error('印刷するCanvasがありません');
    const title = escapeHtml(options.title || '区画図');
    const paper = printPaperDimensions(options);
    const margin = typeof options.margin === 'string' ? options.margin : '0';
    const dataUrl = canvasDataUrl(canvas);
    const autoPrint = options.autoPrint === true
      ? '<script>addEventListener("load",()=>{requestAnimationFrame(()=>print())},{once:true});<\/script>'
      : '';
    return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
@page { size: ${paper.widthMm}mm ${paper.heightMm}mm; margin: ${escapeHtml(margin)}; }
html,body { margin:0; width:100%; height:100%; background:#fff; }
body { display:flex; align-items:center; justify-content:center; overflow:hidden; }
img { display:block; width:100%; height:100%; object-fit:contain; image-rendering:auto; }
@media screen { body { background:#d7dce3; } img { background:#fff; box-shadow:0 2px 18px #0003; } }
</style>
</head>
<body><img src="${dataUrl}" width="${canvas.width}" height="${canvas.height}" alt="${title}">${autoPrint}</body>
</html>`;
  }

  function openPrintWindow(canvas, options = {}) {
    const html = canvasToPrintHTML(canvas, { ...options, autoPrint: options.autoPrint !== false });
    const printWindow = global.open?.('', '_blank', 'popup');
    if (!printWindow) throw new Error('印刷画面を開けません');
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    return printWindow;
  }

  async function printCanvasWithSystemDialog(canvas, options = {}) {
    const html = canvasToPrintHTML(canvas, { ...options, autoPrint: false });
    const paper = printPaperDimensions(options);
    const desktop = global.kozuDesktop;
    if (desktop?.printDrawing) return desktop.printDrawing({
      html,
      pageSize: paper.size,
      landscape: paper.orientation === 'landscape',
      marginType: options.marginType || 'none',
    });
    return openPrintWindow(canvas, options);
  }

  async function exportCanvasPdf(canvas, options = {}) {
    const html = canvasToPrintHTML(canvas, { ...options, autoPrint: false });
    const paper = printPaperDimensions(options);
    const desktop = global.kozuDesktop;
    if (desktop?.exportPdf) return desktop.exportPdf({
      html,
      pageSize: paper.size,
      landscape: paper.orientation === 'landscape',
      fileName: safeFileName(options.fileName || options.title || '区画図.pdf', '区画図.pdf'),
    });
    throw new Error('PDF書出し機能を利用できません');
  }

  K.IO = Object.freeze({
    FORMAT,
    PROJECT_VERSION,
    APP_VERSION,
    ProjectValidationError,
    BACKGROUND_TYPES,
    SHAPE_KINDS,
    ENTITY_KINDS,
    bytesToBase64,
    base64ToBytes,
    blobToDataUrl,
    loadPdfBytes,
    loadPdfFile,
    loadImageBlob,
    loadImageFile,
    loadUnderlayFile,
    openUnderlay: loadUnderlayFile,
    replaceUnderlay: loadUnderlayFile,
    createUnderlayRuntime,
    renderPdfPage,
    renderImage,
    renderUnderlayPage,
    rotateImage90,
    validateDocument,
    validateProject,
    migrateLegacyV3,
    migrateV6,
    migrateV5,
    serializeProject,
    deserializeProject,
    importProject: deserializeProject,
    openProjectFile,
    loadProject: openProjectFile,
    downloadBlob,
    downloadProjectJson,
    saveProject: downloadProjectJson,
    downloadCanvasPng,
    exportPNG: downloadCanvasPng,
    clipboardImageFromEvent,
    readClipboardImage,
    copyCanvasPngToClipboard,
    canvasToPrintHTML,
    printPaperDimensions,
    openPrintWindow,
    printCanvas: printCanvasWithSystemDialog,
    exportPDF: exportCanvasPdf,
    getBackgroundSource(background) { return isObject(background) ? background.source || null : null; },
  });
})(window);
