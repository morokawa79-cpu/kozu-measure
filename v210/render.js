(function installKozuV210Renderer(global) {
  'use strict';

  const KozuV210 = global.KozuV210 = global.KozuV210 || {};
  const K = KozuV210;
  const TAU = Math.PI * 2;
  const DEFAULT_FONT = '"Yu Gothic UI", "Meiryo UI", Meiryo, sans-serif';

  const DEFAULTS = Object.freeze({
    workspace: '#b9bec5',
    paper: '#ffffff',
    paperBorder: '#89929e',
    selection: '#1677d2',
    hover: '#0f8f96',
    snap: '#bf3d63',
    lot: Object.freeze({ fill: '#f4dfa1', stroke: '#987722', opacity: 0.42, lineWidth: 1.15 }),
    road: Object.freeze({ fill: '#cfd4d9', stroke: '#65717c', opacity: 0.68, lineWidth: 1.15 }),
    water: Object.freeze({ fill: '#ccebf4', stroke: '#438ba2', opacity: 0.66, lineWidth: 1.15 }),
    cutout: Object.freeze({ fill: '#ffffff', stroke: '#707780', opacity: 0.9, lineWidth: 1 }),
    label: Object.freeze({
      color: '#312b1d',
      size: 14,
      fontSize: 14,
      fontFamily: DEFAULT_FONT,
      fontWeight: 600,
      angle: 0,
      vertical: false,
      align: 'center',
      lineHeight: 1.18,
    }),
    dimension: Object.freeze({
      color: '#384352',
      size: 10,
      fontSize: 10,
      fontFamily: DEFAULT_FONT,
      fontWeight: 500,
      offset: 14,
      digits: 2,
      angle: 'auto',
      approximate: false,
      showUnit: true,
    }),
    entity: Object.freeze({
      color: '#23364b',
      fill: 'rgba(36, 77, 114, 0.08)',
      lineWidth: 1.15,
      lineStyle: 'solid',
      fontFamily: DEFAULT_FONT,
      size: 14,
      fontSize: 14,
      fontWeight: 500,
    }),
  });

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function radians(degrees) {
    return finite(degrees, 0) * Math.PI / 180;
  }

  function point(value, fallback = { x: 0, y: 0 }) {
    if (!value || typeof value !== 'object') return { x: fallback.x, y: fallback.y };
    return { x: finite(value.x, fallback.x), y: finite(value.y, fallback.y) };
  }

  function normalizedPoints(value) {
    return Array.isArray(value)
      ? value.filter(Boolean).map((entry) => point(entry))
      : [];
  }

  function distance(a, b) {
    return Math.hypot(finite(b?.x) - finite(a?.x), finite(b?.y) - finite(a?.y));
  }

  function polygonArea(points) {
    if (!Array.isArray(points) || points.length < 3) return 0;
    let twiceArea = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      twiceArea += finite(current.x) * finite(next.y) - finite(next.x) * finite(current.y);
    }
    return Math.abs(twiceArea) / 2;
  }

  function polygonCentroid(points) {
    if (!Array.isArray(points) || points.length === 0) return { x: 0, y: 0 };
    if (points.length < 3) {
      const total = points.reduce((sum, item) => ({ x: sum.x + finite(item.x), y: sum.y + finite(item.y) }), { x: 0, y: 0 });
      return { x: total.x / points.length, y: total.y / points.length };
    }
    let signedTwiceArea = 0;
    let cx = 0;
    let cy = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const cross = finite(current.x) * finite(next.y) - finite(next.x) * finite(current.y);
      signedTwiceArea += cross;
      cx += (finite(current.x) + finite(next.x)) * cross;
      cy += (finite(current.y) + finite(next.y)) * cross;
    }
    if (Math.abs(signedTwiceArea) < 1e-8) {
      const total = points.reduce((sum, item) => ({ x: sum.x + finite(item.x), y: sum.y + finite(item.y) }), { x: 0, y: 0 });
      return { x: total.x / points.length, y: total.y / points.length };
    }
    return { x: cx / (3 * signedTwiceArea), y: cy / (3 * signedTwiceArea) };
  }

  function pointSegmentDistance(testPoint, start, end) {
    const dx = finite(end?.x) - finite(start?.x);
    const dy = finite(end?.y) - finite(start?.y);
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 1e-12) return distance(testPoint, start);
    const ratio = clamp(((testPoint.x - start.x) * dx + (testPoint.y - start.y) * dy) / lengthSquared, 0, 1);
    return distance(testPoint, { x: start.x + dx * ratio, y: start.y + dy * ratio });
  }

  function polygonClearance(testPoint, polygon) {
    if (!pointInPolygon(testPoint, polygon)) return -1;
    let nearest = Infinity;
    for (let index = 0; index < polygon.length; index += 1) {
      nearest = Math.min(nearest, pointSegmentDistance(testPoint, polygon[index], polygon[(index + 1) % polygon.length]));
    }
    return nearest;
  }

  function polygonInteriorAnchor(points) {
    const polygon = normalizedPoints(points);
    if (polygon.length < 3) return polygonCentroid(polygon);
    const xs = polygon.map(entry => entry.x);
    const ys = polygon.map(entry => entry.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = maxX - minX;
    const height = maxY - minY;
    const candidates = [polygonCentroid(polygon), { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }];
    const divisions = 10;
    for (let row = 0; row < divisions; row += 1) {
      for (let column = 0; column < divisions; column += 1) {
        candidates.push({
          x: minX + width * (column + 0.5) / divisions,
          y: minY + height * (row + 0.5) / divisions,
        });
      }
    }
    let best = candidates.reduce((current, candidate) => {
      const clearance = polygonClearance(candidate, polygon);
      return clearance > current.clearance ? { point: candidate, clearance } : current;
    }, { point: polygon[0], clearance: -1 });
    let step = Math.max(width, height) / divisions / 2;
    for (let pass = 0; pass < 4 && step > 1e-4; pass += 1) {
      for (let y = -1; y <= 1; y += 1) {
        for (let x = -1; x <= 1; x += 1) {
          const candidate = { x: best.point.x + x * step, y: best.point.y + y * step };
          const clearance = polygonClearance(candidate, polygon);
          if (clearance > best.clearance) best = { point: candidate, clearance };
        }
      }
      step /= 2;
    }
    return best.clearance >= 0 ? best.point : polygonCentroid(polygon);
  }

  function midpoint(a, b) {
    return { x: (finite(a?.x) + finite(b?.x)) / 2, y: (finite(a?.y) + finite(b?.y)) / 2 };
  }

  // CanvasはYが下向き。始終点を逆にしても寸法が見た目の上側へ
  // 出るよう、2つある法線のうちYが小さくなる側を標準にする。
  function upperScreenNormal(dx, dy, length = Math.hypot(dx, dy) || 1) {
    let x = -dy / length;
    let y = dx / length;
    if (y > 1e-9 || (Math.abs(y) <= 1e-9 && x < 0)) {
      x *= -1;
      y *= -1;
    }
    return { x, y };
  }

  function rotatePoint(localPoint, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: localPoint.x * cos - localPoint.y * sin,
      y: localPoint.x * sin + localPoint.y * cos,
    };
  }

  function pointInPolygon(testPoint, polygon) {
    if (!testPoint || !Array.isArray(polygon) || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const xi = finite(polygon[i].x);
      const yi = finite(polygon[i].y);
      const xj = finite(polygon[j].x);
      const yj = finite(polygon[j].y);
      const crosses = ((yi > testPoint.y) !== (yj > testPoint.y))
        && (testPoint.x < (xj - xi) * (testPoint.y - yi) / ((yj - yi) || 1e-12) + xi);
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
  }

  function activePage(documentModel) {
    const pages = Array.isArray(documentModel?.pages) ? documentModel.pages : [];
    if (!pages.length) return { id: null, name: '', shapes: [], entities: [] };
    return pages.find((pageModel) => pageModel?.id === documentModel.activePageId) || pages[0];
  }

  function colorWithAlpha(color, alpha) {
    if (typeof color !== 'string') return color;
    const hex = color.trim();
    if (/^#[0-9a-f]{6}$/i.test(hex)) {
      const red = parseInt(hex.slice(1, 3), 16);
      const green = parseInt(hex.slice(3, 5), 16);
      const blue = parseInt(hex.slice(5, 7), 16);
      return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
    }
    return color;
  }

  function mergeStyle(base, object, legacy = {}) {
    const objectStyle = object && typeof object === 'object' ? object : {};
    const result = { ...base, ...legacy, ...objectStyle };
    // Old projects use both `size` and `fontSize`. The most specific source
    // must win even when the base style contains the other alias.
    for (const source of [legacy, objectStyle]) {
      if (!source || typeof source !== 'object') continue;
      if (source.fontSize != null && source.size == null) result.size = source.fontSize;
      if (source.size != null && source.fontSize == null) result.fontSize = source.size;
    }
    return result;
  }

  function fontFamily(value) {
    const presets = {
      gothic: DEFAULT_FONT,
      sans: DEFAULT_FONT,
      mincho: '"Yu Mincho", "MS PMincho", serif',
      serif: '"Yu Mincho", "MS PMincho", serif',
      mono: 'Consolas, "BIZ UDゴシック", monospace',
    };
    return presets[value] || value || DEFAULT_FONT;
  }

  function lineDash(style, unit) {
    const name = String(style || 'solid').toLowerCase();
    if (['dash', 'dashed', 'broken', '破線'].includes(name)) return [7 * unit, 4 * unit];
    if (['dot', 'dotted', '点線'].includes(name)) return [1.5 * unit, 3.5 * unit];
    if (['dashdot', 'chain', '一点鎖線'].includes(name)) return [8 * unit, 3 * unit, 1.5 * unit, 3 * unit];
    return [];
  }

  function moneyText(value) {
    if (value == null || value === '') return '';
    const number = Number(String(value).replace(/,/g, ''));
    if (!Number.isFinite(number)) return String(value);
    return `${Math.round(number).toLocaleString('ja-JP')}万円`;
  }

  function formatNumber(value, digits) {
    return finite(value, 0).toFixed(clamp(Math.round(finite(digits, 2)), 0, 4));
  }

  function adjustedMeasurement(value, style = {}) {
    const digits = clamp(Math.round(finite(style.digits ?? style.decimals, 2)), 0, 4);
    const factor = 10 ** digits;
    const adjusted = Math.max(0, finite(value, 0) + finite(style.adjustment, 0));
    const operation = style.rounding === 'floor' ? Math.floor : style.rounding === 'ceil' ? Math.ceil : Math.round;
    return { value: operation((adjusted + Number.EPSILON) * factor) / factor, digits };
  }

  function formatMeasuredValue(value, style = {}) {
    const adjusted = adjustedMeasurement(value, style);
    return adjusted.value.toFixed(adjusted.digits);
  }

  function extendBounds(bounds, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return bounds;
    if (!bounds) return { minX: x, minY: y, maxX: x, maxY: y };
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
    return bounds;
  }

  function normalizeBounds(bounds) {
    if (!bounds) return null;
    const minX = finite(bounds.minX ?? bounds.x, 0);
    const minY = finite(bounds.minY ?? bounds.y, 0);
    const maxX = finite(bounds.maxX, minX + finite(bounds.width, 0));
    const maxY = finite(bounds.maxY, minY + finite(bounds.height, 0));
    return {
      minX: Math.min(minX, maxX),
      minY: Math.min(minY, maxY),
      maxX: Math.max(minX, maxX),
      maxY: Math.max(minY, maxY),
    };
  }

  function sourceDimensions(source) {
    if (!source) return { width: 0, height: 0 };
    return {
      width: finite(source.naturalWidth ?? source.videoWidth ?? source.width, 0),
      height: finite(source.naturalHeight ?? source.videoHeight ?? source.height, 0),
    };
  }

  function metricLabelIsVisible(shape, key) {
    const property = key === 'tsubo' ? 'tsuboLabel' : 'areaLabel';
    const label = shape?.[property];
    if (typeof label?.visible === 'boolean') return label.visible;
    return key === 'tsubo' ? shape?.visibility?.tsubo === true : shape?.visibility?.area !== false;
  }

  function paperRectangle(paper = {}) {
    const sizes = {
      A4: { width: 1122.52, height: 793.7 },
      A3: { width: 1587.4, height: 1122.52 },
      A2: { width: 2245.04, height: 1587.4 },
    };
    const named = sizes[String(paper.size || 'A4').toUpperCase()] || sizes.A4;
    let width = finite(paper.worldWidth ?? paper.width, named.width);
    let height = finite(paper.worldHeight ?? paper.height, named.height);
    const orientation = String(paper.orientation || 'landscape').toLowerCase();
    if ((orientation === 'portrait' && width > height) || (orientation === 'landscape' && height > width)) {
      [width, height] = [height, width];
    }
    return {
      x: finite(paper.x, 0),
      y: finite(paper.y, 0),
      width: Math.max(1, width),
      height: Math.max(1, height),
    };
  }

  class Renderer {
    constructor(canvas = null, options = {}) {
      this.canvas = null;
      this.context = null;
      this.document = options.document || options.doc || null;
      this.view = this._normalizedView(options.view);
      this.overlay = options.overlay || {};
      this.theme = { ...DEFAULTS, ...(options.theme || {}) };
      this.backgroundResolver = typeof options.backgroundResolver === 'function' ? options.backgroundResolver : null;
      this.backgroundSources = new Map();
      this.labelBoxes = [];
      this.lastError = null;
      this.onError = typeof options.onError === 'function' ? options.onError : null;
      this._cssWidth = 1;
      this._cssHeight = 1;
      this._dpr = Math.max(1, finite(options.dpr, global.devicePixelRatio || 1));
      this._renderView = this.view;
      this._fixedScale = 1;
      this._recordLabels = true;
      this._renderOptions = {};
      this._raf = 0;
      if (canvas) this.attach(canvas);
    }

    static get defaults() {
      return DEFAULTS;
    }

    attach(canvas) {
      if (!canvas || typeof canvas.getContext !== 'function') {
        throw new TypeError('Renderer.attach(canvas): Canvas 2D compatible object is required.');
      }
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Renderer.attach(canvas): 2D context is unavailable.');
      this.canvas = canvas;
      this.context = context;
      this.resize();
      return this;
    }

    detach() {
      this.cancelScheduledRender();
      this.canvas = null;
      this.context = null;
      return this;
    }

    setDocument(documentModel) {
      this.document = documentModel || null;
      return this;
    }

    setView(view) {
      this.view = this._normalizedView(view);
      return this;
    }

    patchView(patch) {
      this.view = this._normalizedView({ ...this.view, ...(patch || {}) });
      return this.view;
    }

    setOverlay(overlay) {
      this.overlay = overlay || {};
      return this;
    }

    setBackgroundResolver(resolver) {
      this.backgroundResolver = typeof resolver === 'function' ? resolver : null;
      return this;
    }

    setBackgroundSource(source, key = 'default') {
      if (source == null) this.backgroundSources.delete(String(key));
      else this.backgroundSources.set(String(key), source);
      return this;
    }

    clearBackgroundSources() {
      this.backgroundSources.clear();
      return this;
    }

    resize(width, height, dpr) {
      if (!this.canvas) return { width: 0, height: 0, dpr: this._dpr };
      if (width && typeof width === 'object') {
        const options = width;
        width = options.width;
        height = options.height;
        dpr = options.dpr;
      }
      const nextDpr = Math.max(1, finite(dpr, this._dpr || global.devicePixelRatio || 1));
      const fallbackWidth = finite(this.canvas.clientWidth, 0) || finite(this.canvas.width, 1) / nextDpr;
      const fallbackHeight = finite(this.canvas.clientHeight, 0) || finite(this.canvas.height, 1) / nextDpr;
      const cssWidth = Math.max(1, finite(width, fallbackWidth));
      const cssHeight = Math.max(1, finite(height, fallbackHeight));
      const pixelWidth = Math.max(1, Math.round(cssWidth * nextDpr));
      const pixelHeight = Math.max(1, Math.round(cssHeight * nextDpr));
      if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
      if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
      this._cssWidth = cssWidth;
      this._cssHeight = cssHeight;
      this._dpr = nextDpr;
      return this.getSize();
    }

    getSize() {
      return { width: this._cssWidth, height: this._cssHeight, dpr: this._dpr };
    }

    worldToScreen(value, view = this.view) {
      const target = point(value);
      const normalized = this._normalizedView(view);
      return { x: target.x * normalized.zoom + normalized.x, y: target.y * normalized.zoom + normalized.y };
    }

    screenToWorld(value, y, view = this.view) {
      let target;
      let targetView = view;
      if (typeof value === 'number') target = { x: value, y: finite(y, 0) };
      else {
        target = point(value);
        if (y && typeof y === 'object') targetView = y;
      }
      const normalized = this._normalizedView(targetView);
      return { x: (target.x - normalized.x) / normalized.zoom, y: (target.y - normalized.y) / normalized.zoom };
    }

    worldLengthToScreen(value, view = this.view) {
      return finite(value, 0) * this._normalizedView(view).zoom;
    }

    screenLengthToWorld(value, view = this.view) {
      return finite(value, 0) / this._normalizedView(view).zoom;
    }

    _screenWorld(value) {
      return finite(value, 0) * Math.max(0.01, finite(this._fixedScale, 1)) / Math.max(0.0001, finite(this._renderView?.zoom, 1));
    }

    getActivePage(documentModel = this.document) {
      return activePage(documentModel);
    }

    computeBounds(documentModel = this.document, options = {}) {
      if (documentModel && documentModel.minX != null && documentModel.maxX != null) {
        return normalizeBounds(documentModel);
      }
      const pageModel = options.page || activePage(documentModel);
      let bounds = null;
      const includeBackground = options.includeBackground !== false;
      const includePaper = options.includePaper !== false;
      if (includeBackground && documentModel?.background?.visible !== false) {
        const backgroundBounds = this._backgroundBounds(documentModel.background, pageModel, documentModel);
        if (backgroundBounds) {
          bounds = extendBounds(bounds, backgroundBounds.minX, backgroundBounds.minY);
          bounds = extendBounds(bounds, backgroundBounds.maxX, backgroundBounds.maxY);
        }
      }
      if (includePaper && documentModel?.paper && documentModel.paper.enabled !== false && documentModel.paper.visible !== false) {
        const rect = paperRectangle(documentModel.paper);
        bounds = extendBounds(bounds, rect.x, rect.y);
        bounds = extendBounds(bounds, rect.x + rect.width, rect.y + rect.height);
      }
      for (const shape of Array.isArray(pageModel?.shapes) ? pageModel.shapes : []) {
        for (const vertex of normalizedPoints(shape?.points)) bounds = extendBounds(bounds, vertex.x, vertex.y);
      }
      for (const entity of Array.isArray(pageModel?.entities) ? pageModel.entities : []) {
        bounds = this._extendEntityBounds(bounds, entity, documentModel);
      }
      return bounds || { minX: 0, minY: 0, maxX: 1000, maxY: 700 };
    }

    computeObjectBounds(object, documentModel = this.document) {
      if (!object) return null;
      const points = normalizedPoints(object.points);
      if (['lot', 'road', 'water', 'cutout'].includes(object.kind) && points.length) {
        return points.reduce((bounds, vertex) => extendBounds(bounds, vertex.x, vertex.y), null);
      }
      return this._extendEntityBounds(null, object, documentModel);
    }

    calculateFitView(target = this.document, options = {}) {
      const bounds = target && target.minX != null ? normalizeBounds(target) : this.computeBounds(target, options);
      const width = Math.max(1, finite(options.width, this._cssWidth));
      const height = Math.max(1, finite(options.height, this._cssHeight));
      const padding = Math.max(0, finite(options.padding, 28));
      const contentWidth = Math.max(1e-6, bounds.maxX - bounds.minX);
      const contentHeight = Math.max(1e-6, bounds.maxY - bounds.minY);
      const availableWidth = Math.max(1, width - padding * 2);
      const availableHeight = Math.max(1, height - padding * 2);
      const zoom = clamp(
        Math.min(availableWidth / contentWidth, availableHeight / contentHeight),
        finite(options.minZoom, 0.02),
        finite(options.maxZoom, 30),
      );
      const drawnWidth = contentWidth * zoom;
      const drawnHeight = contentHeight * zoom;
      return {
        x: padding + (availableWidth - drawnWidth) / 2 - bounds.minX * zoom,
        y: padding + (availableHeight - drawnHeight) / 2 - bounds.minY * zoom,
        zoom,
      };
    }

    fitBounds(target = this.document, options = {}) {
      const nextView = this.calculateFitView(target, options);
      if (options.apply !== false) this.view = nextView;
      return { ...nextView };
    }

    getLabelBoxes() {
      return this.labelBoxes.map((box) => ({
        ...box,
        polygon: box.polygon.map((entry) => ({ ...entry })),
        worldPolygon: box.worldPolygon.map((entry) => ({ ...entry })),
      }));
    }

    hitLabel(screenPoint, options = {}) {
      const target = point(screenPoint);
      const kinds = options.kinds ? new Set(asArray(options.kinds)) : null;
      for (let index = this.labelBoxes.length - 1; index >= 0; index -= 1) {
        const box = this.labelBoxes[index];
        if (kinds && !kinds.has(box.kind)) continue;
        if (pointInPolygon(target, box.polygon)) return box;
      }
      return null;
    }

    render(documentModel = this.document, view = this.view, overlay = this.overlay, options = {}) {
      if (!this.context || !this.canvas) return false;
      if (documentModel && !documentModel.pages && documentModel.doc) {
        const payload = documentModel;
        documentModel = payload.doc;
        view = payload.view || this.view;
        overlay = payload.overlay || this.overlay;
        options = payload.options || {};
      }
      if (documentModel) this.document = documentModel;
      this.view = this._normalizedView(view);
      this.overlay = overlay || {};
      this.labelBoxes = [];
      this._drawScene(this.context, this.getSize(), this.document, this.view, this.overlay, {
        workspaceColor: options.workspaceColor || this.theme.workspace,
        transparent: options.transparent === true,
        includeSelection: options.includeSelection !== false,
        includePreview: options.includePreview !== false,
        showVertices: options.showVertices !== false,
        recordLabels: options.recordLabels !== false,
        ...options,
      });
      return true;
    }

    scheduleRender(documentModel = this.document, view = this.view, overlay = this.overlay, options = {}) {
      if (documentModel) this.document = documentModel;
      this.view = this._normalizedView(view);
      this.overlay = overlay || {};
      if (this._raf) return this._raf;
      const callback = () => {
        this._raf = 0;
        this.render(this.document, this.view, this.overlay, options);
      };
      const request = global.requestAnimationFrame || ((handler) => global.setTimeout(handler, 0));
      this._raf = request(callback);
      return this._raf;
    }

    cancelScheduledRender() {
      if (!this._raf) return;
      const cancel = global.cancelAnimationFrame || global.clearTimeout;
      cancel(this._raf);
      this._raf = 0;
    }

    renderToCanvas(documentOrOptions = this.document, maybeOptions = {}) {
      let documentModel;
      let options;
      if (documentOrOptions && Array.isArray(documentOrOptions.pages)) {
        documentModel = documentOrOptions;
        options = maybeOptions || {};
      } else {
        options = documentOrOptions || {};
        documentModel = options.doc || options.document || this.document;
      }
      const dpr = Math.max(1, finite(options.dpr, 1));
      const width = Math.max(1, Math.round(finite(options.width, 1600)));
      const height = Math.max(1, Math.round(finite(options.height, 1000)));
      const target = options.canvas || this._createCanvas(width * dpr, height * dpr);
      if (!target || typeof target.getContext !== 'function') {
        throw new Error('Renderer.renderToCanvas(): supply options.canvas or provide OffscreenCanvas support.');
      }
      target.width = Math.max(1, Math.round(width * dpr));
      target.height = Math.max(1, Math.round(height * dpr));
      const context = target.getContext('2d');
      if (!context) throw new Error('Renderer.renderToCanvas(): 2D context is unavailable.');
      const view = options.view
        ? this._normalizedView(options.view)
        : this.calculateFitView(options.bounds || documentModel, {
          ...options,
          width,
          height,
          includeBackground: options.includeBackground,
          includePaper: options.includePaper,
        });
      const previousLabels = this.labelBoxes;
      this.labelBoxes = [];
      this._drawScene(context, { width, height, dpr }, documentModel, view, {}, {
        ...options,
        workspaceColor: options.backgroundColor || '#ffffff',
        transparent: options.transparent === true,
        includeSelection: false,
        includePreview: false,
        showVertices: false,
        recordLabels: false,
      });
      this.labelBoxes = previousLabels;
      return target;
    }

    _createCanvas(width, height) {
      if (typeof global.OffscreenCanvas === 'function') return new global.OffscreenCanvas(width, height);
      const ownerDocument = this.canvas?.ownerDocument || global.document;
      if (ownerDocument && typeof ownerDocument.createElement === 'function') {
        const canvas = ownerDocument.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
      }
      return null;
    }

    _normalizedView(view) {
      return {
        x: finite(view?.x, 0),
        y: finite(view?.y, 0),
        zoom: clamp(finite(view?.zoom, 1), 0.005, 100),
      };
    }

    _drawScene(context, size, documentModel, view, overlay, options) {
      const dpr = Math.max(1, finite(size.dpr, 1));
      const width = Math.max(1, finite(size.width, 1));
      const height = Math.max(1, finite(size.height, 1));
      this._renderView = this._normalizedView(view);
      this._fixedScale = Math.max(0.01, finite(options.fixedScale, 1));
      this._recordLabels = options.recordLabels !== false;
      this._renderOptions = options;
      try {
        context.save();
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);
        if (!options.transparent) {
          context.fillStyle = options.workspaceColor || this.theme.workspace;
          context.fillRect(0, 0, width, height);
        }
        context.translate(this._renderView.x, this._renderView.y);
        context.scale(this._renderView.zoom, this._renderView.zoom);
        const pageModel = activePage(documentModel);
        this._drawBackground(context, documentModel?.background, pageModel, documentModel);
        this._drawPaper(context, documentModel?.paper, documentModel?.background);
        const replacements = options.includePreview
          ? asArray(overlay?.replacements).map((value) => value?.object || value?.entity || value?.shape || value).filter(Boolean)
          : [];
        const replacementIds = new Set(replacements.map((value) => String(value?.id || '')).filter(Boolean));
        for (const shape of Array.isArray(pageModel?.shapes) ? pageModel.shapes : []) {
          if (replacementIds.has(String(shape?.id))) continue;
          this._drawShape(context, shape, documentModel, { preview: false });
        }
        for (const entity of Array.isArray(pageModel?.entities) ? pageModel.entities : []) {
          if (replacementIds.has(String(entity?.id))) continue;
          this._drawEntity(context, entity, documentModel, pageModel, { preview: false });
        }
        if (options.includeSelection || options.includePreview) {
          this._drawOverlay(context, overlay || {}, documentModel, pageModel, options);
        }
        context.restore();
        this.lastError = null;
      } catch (error) {
        this.lastError = error;
        try { context.restore(); } catch (_) { /* context may already be balanced */ }
        if (this.onError) this.onError(error);
        else if (global.console?.error) global.console.error('[KozuV210.Renderer]', error);
      }
    }

    _resolveBackgroundSource(background, pageModel, documentModel) {
      if (!background) return null;
      // `background.source` is the persisted PDF Base64 / image data URL, not a
      // CanvasImageSource.  Treating that string as the render source made every
      // successfully loaded underlay measure 0 x 0 and therefore disappear.
      // Prefer the current page's runtime canvas, then registered runtime
      // sources, and only accept object sources that actually have dimensions.
      const candidates = [];
      if (this.backgroundResolver) {
        candidates.push(this.backgroundResolver(background, pageModel, documentModel));
      }
      const keys = [background.runtimeKey, background.sourceId, background.id, pageModel?.id, 'default'].filter(Boolean);
      for (const key of keys) {
        if (this.backgroundSources.has(String(key))) candidates.push(this.backgroundSources.get(String(key)));
      }
      candidates.push(background.renderSource, background.bitmap, background.image, background.canvas);
      return candidates.find((candidate) => {
        if (!candidate || typeof candidate === 'string') return false;
        const dimensions = sourceDimensions(candidate);
        return dimensions.width > 0 && dimensions.height > 0;
      }) || null;
    }

    _drawBackground(context, background, pageModel, documentModel) {
      if (!background || background.visible === false) return;
      const source = this._resolveBackgroundSource(background, pageModel, documentModel);
      const dimensions = sourceDimensions(source);
      if (!source || dimensions.width <= 0 || dimensions.height <= 0) return;
      const x = finite(background.x, 0);
      const y = finite(background.y, 0);
      const scaleX = finite(background.scaleX, finite(background.scale, 1)) || 1;
      const scaleY = finite(background.scaleY, finite(background.scale, 1)) || 1;
      const drawWidth = finite(background.width, dimensions.width);
      const drawHeight = finite(background.height, dimensions.height);
      const angle = radians(background.rotation);
      const origin = String(background.origin || 'top-left');
      const centerX = origin === 'center' ? x : x + drawWidth * scaleX / 2;
      const centerY = origin === 'center' ? y : y + drawHeight * scaleY / 2;
      context.save();
      context.globalAlpha = clamp(finite(background.opacity, 1), 0, 1);
      if (background.filter && 'filter' in context) context.filter = background.filter;
      context.translate(centerX, centerY);
      context.rotate(angle);
      context.scale(scaleX, scaleY);
      const crop = background.crop;
      try {
        if (crop && finite(crop.width, 0) > 0 && finite(crop.height, 0) > 0) {
          context.drawImage(
            source,
            finite(crop.x, 0), finite(crop.y, 0), finite(crop.width), finite(crop.height),
            -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight,
          );
        } else {
          context.drawImage(source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        }
      } catch (error) {
        this.lastError = error;
        if (this.onError) this.onError(error);
      }
      context.restore();
    }

    _drawPaper(context, paper, background) {
      if (!paper || paper.enabled === false || paper.visible === false) return;
      const rect = paperRectangle(paper);
      const zoom = this._renderView.zoom;
      const hasBackground = background && background.visible !== false;
      context.save();
      if (!hasBackground || paper.fill === true || paper.fillColor) {
        context.globalAlpha = clamp(finite(paper.fillOpacity, hasBackground ? 0.06 : 1), 0, 1);
        context.fillStyle = paper.fillColor || this.theme.paper;
        context.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
      context.globalAlpha = 1;
      context.strokeStyle = paper.borderColor || this.theme.paperBorder;
      context.lineWidth = Math.max(0.7, finite(paper.borderWidth, 1)) / zoom;
      context.setLineDash([]);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      if (paper.printMargin) {
        const margin = finite(paper.printMargin, 0);
        if (margin > 0 && margin * 2 < rect.width && margin * 2 < rect.height) {
          context.strokeStyle = colorWithAlpha(paper.borderColor || this.theme.paperBorder, 0.55);
          context.lineWidth = 0.75 / zoom;
          context.setLineDash([3 / zoom, 3 / zoom]);
          context.strokeRect(rect.x + margin, rect.y + margin, rect.width - margin * 2, rect.height - margin * 2);
        }
      }
      context.restore();
    }

    _shapeDefaults(kind) {
      if (kind === 'road') return DEFAULTS.road;
      if (kind === 'water') return DEFAULTS.water;
      if (kind === 'cutout') return DEFAULTS.cutout;
      return DEFAULTS.lot;
    }

    _drawShape(context, shape, documentModel, state = {}) {
      if (!shape || shape.visible === false) return;
      const points = normalizedPoints(shape.points);
      if (points.length < 2) return;
      const zoom = this._renderView.zoom;
      const base = this._shapeDefaults(shape.kind);
      const style = mergeStyle(base, shape.style, {
        fill: shape.fillColor,
        stroke: shape.strokeColor,
        opacity: shape.opacity,
      });
      const opacity = clamp(finite(style.opacity, base.opacity), 0, 1);
      const isArea = points.length >= 3;
      context.save();
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
      if (isArea) context.closePath();
      if (isArea) {
        context.globalAlpha = state.preview ? opacity * 0.58 : opacity;
        context.fillStyle = style.fill || base.fill;
        context.fill();
      }
      context.globalAlpha = state.preview ? 0.72 : 1;
      context.strokeStyle = style.stroke || base.stroke;
      context.lineWidth = this._screenWorld(Math.max(0.45, finite(style.lineWidth, base.lineWidth)));
      context.setLineDash(lineDash(style.lineStyle, this._screenWorld(1)));
      if (!isArea && (shape.kind === 'road' || shape.kind === 'water')) {
        const mpp = Math.max(0, finite(documentModel?.calibration?.mpp, 0));
        const widthMeters = finite(shape.road?.widthM ?? shape.road?.width ?? shape.width, 0);
        const worldWidth = mpp > 0 && widthMeters > 0 ? widthMeters / mpp : finite(style.worldWidth, 10);
        context.lineWidth = Math.max(context.lineWidth, worldWidth);
        context.globalAlpha = opacity;
      }
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = 1;
      if (shape.kind === 'cutout' && isArea) this._drawCutoutHatch(context, points, style, zoom);
      if (!state.preview) {
        this._drawShapeLabel(context, shape, documentModel);
        if (this._shapeShowsDimensions(shape)) this._drawShapeDimensions(context, shape, documentModel);
      } else if (state.showLabel !== false) {
        this._drawShapeLabel(context, shape, documentModel, { preview: true });
        if (this._shapeShowsDimensions(shape)) this._drawShapeDimensions(context, shape, documentModel, { preview: true });
      }
      if (this._renderOptions.showVertices && !state.preview) this._drawQuietVertices(context, points);
      context.restore();
    }

    _drawCutoutHatch(context, points, style, zoom) {
      const bounds = points.reduce((box, vertex) => extendBounds(box, vertex.x, vertex.y), null);
      if (!bounds) return;
      context.save();
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
      context.closePath();
      context.clip();
      const step = this._screenWorld(10);
      context.strokeStyle = colorWithAlpha(style.stroke || DEFAULTS.cutout.stroke, 0.34);
      context.lineWidth = this._screenWorld(0.65);
      for (let offset = bounds.minX - (bounds.maxY - bounds.minY); offset < bounds.maxX; offset += step) {
        context.beginPath();
        context.moveTo(offset, bounds.maxY);
        context.lineTo(offset + (bounds.maxY - bounds.minY), bounds.minY);
        context.stroke();
      }
      context.restore();
    }

    _shapeShowsDimensions(shape) {
      const visibility = shape.visibility || {};
      return visibility.dimensions === true || visibility.dimension === true || shape.showLengths === true;
    }

    _shapeLabelLines(shape, documentModel) {
      const visibility = shape.visibility || {};
      const lines = [];
      if (shape.kind === 'road' || shape.kind === 'water') {
        const name = shape.road?.name || shape.label || shape.road?.type || (shape.kind === 'water' ? '水路' : '道路');
        if (visibility.label !== false && name) lines.push(String(name));
        const width = finite(shape.road?.widthM ?? shape.road?.width, 0);
        if (visibility.width !== false && width > 0) lines.push(`${formatNumber(width, 1)}m`);
        return lines;
      }
      if (shape.kind === 'lot') {
        const numberText = visibility.number !== false && shape.number != null ? `区画 ${shape.number}` : '';
        const labelText = visibility.label !== false && shape.label ? String(shape.label) : '';
        if (numberText || labelText) lines.push([numberText, labelText].filter(Boolean).join('　'));
      } else if (visibility.label !== false && shape.label) lines.push(String(shape.label));
      if (visibility.price === true && shape.price != null && shape.price !== '') lines.push(moneyText(shape.price));
      if (visibility.memo === true && shape.memo) lines.push(String(shape.memo));
      if (shape.topLabel && visibility.topLabel !== false) lines.unshift(String(shape.topLabel));
      return lines;
    }

    _drawShapeLabel(context, shape, documentModel, state = {}) {
      if (shape.kind === 'road' || shape.kind === 'water') {
        this._drawRoadLabels(context, shape, documentModel, state);
        return;
      }
      const lines = this._shapeLabelLines(shape, documentModel);
      const center = polygonInteriorAnchor(shape.points);
      const style = mergeStyle(DEFAULTS.label, shape.labelStyle, {
        color: shape.labelColor,
        size: shape.labelSize,
        angle: shape.labelAngle,
        vertical: shape.labelVertical,
      });
      const explicitAnchor = shape.labelPosition && typeof shape.labelPosition === 'object' ? point(shape.labelPosition) : null;
      const baseAnchor = explicitAnchor || {
        x: finite(style.x, center.x + finite(style.offsetX, 0)),
        y: finite(style.y, center.y + finite(style.offsetY, 0)),
      };
      const metricSize = clamp(finite(style.size ?? style.fontSize, DEFAULTS.label.size) * 0.8, 8, 32);
      const metricLineHeight = metricSize * 1.18;
      const hasMetricSource = Math.max(0, finite(documentModel?.calibration?.mpp, 0)) > 0;
      const metricIsAutomatic = (property, legacyProperty, visible) => {
        const label = shape[property] && typeof shape[property] === 'object' ? shape[property] : {};
        const hasText = label.text != null && String(label.text).trim() !== '';
        return visible && (hasText || hasMetricSource) && !label.position && !shape[legacyProperty];
      };
      const automaticMetricCount = shape.kind === 'lot'
        ? Number(metricIsAutomatic('areaLabel', 'areaLabelPosition', metricLabelIsVisible(shape, 'area')))
          + Number(metricIsAutomatic('tsuboLabel', 'tsuboLabelPosition', metricLabelIsVisible(shape, 'tsubo')))
        : 0;
      const anchor = {
        x: baseAnchor.x,
        y: baseAnchor.y - (lines.length ? automaticMetricCount * (metricLineHeight + 5) / 2 : 0),
      };
      let primaryBox = null;
      if (lines.length) {
        primaryBox = this._drawTextBlock(context, anchor, lines, {
          ...style,
          color: state.preview ? colorWithAlpha(style.color || DEFAULTS.label.color, 0.72) : style.color,
        }, {
          id: `shape-label:${shape.id}`,
          ownerId: shape.id,
          kind: 'shape-label',
          key: 'label',
        });
      }
      if (shape.kind === 'lot') this._drawLotMetricLabels(context, shape, documentModel, state, anchor, lines, style, primaryBox);
    }

    _drawLotMetricLabels(context, shape, documentModel, state, primaryAnchor, primaryLines, primaryStyle, primaryBox = null) {
      const visibility = shape.visibility || {};
      const mpp = Math.max(0, finite(documentModel?.calibration?.mpp, 0));
      const areaSquareMeters = Number.isFinite(Number(shape.area))
        ? Number(shape.area)
        : (mpp > 0 ? polygonArea(shape.points) * mpp * mpp : null);
      const approx = shape.approximate || shape.yaku || shape.dimensionStyle?.approximate;
      const areaDigits = clamp(Math.round(finite(shape.areaDigits ?? shape.decimals ?? shape.dimensionStyle?.decimals, 2)), 0, 3);
      const tsuboDigits = clamp(Math.round(finite(shape.tsuboDigits ?? shape.dimensionStyle?.decimals, 2)), 0, 3);
      const metricFormat = { ...(shape.dimensionStyle || {}), adjustment: 0 };
      const inheritedSize = clamp(finite(primaryStyle?.size ?? primaryStyle?.fontSize, DEFAULTS.label.size), 4, 144);
      const metricSize = clamp(inheritedSize * 0.8, 8, 32);
      const primaryHeight = primaryLines.length ? finite(primaryBox?.height, primaryLines.length * inheritedSize * 1.18) : 0;
      const definitions = [
        {
          property: 'areaLabel', legacyPosition: shape.areaLabelPosition,
          visible: metricLabelIsVisible(shape, 'area'),
          automaticText: areaSquareMeters == null ? null : `${approx ? '約' : ''}${formatMeasuredValue(areaSquareMeters, { ...metricFormat, decimals: areaDigits, digits: areaDigits })}㎡`,
          kind: 'shape-area-label', key: 'area', id: `shape-area-label:${shape.id}`,
        },
        {
          property: 'tsuboLabel', legacyPosition: shape.tsuboLabelPosition,
          visible: metricLabelIsVisible(shape, 'tsubo'),
          automaticText: areaSquareMeters == null ? null : `${approx ? '約' : ''}${formatMeasuredValue(areaSquareMeters / K.TSUBO_M2, { ...metricFormat, decimals: tsuboDigits, digits: tsuboDigits })}坪`,
          kind: 'shape-tsubo-label', key: 'tsubo', id: `shape-tsubo-label:${shape.id}`,
        },
      ];
      const automaticDefinitions = definitions.filter(definition => {
        const label = shape[definition.property] && typeof shape[definition.property] === 'object' ? shape[definition.property] : {};
        return definition.visible && label.visible !== false && !label.position && !definition.legacyPosition;
      });
      let automaticBottom = primaryAnchor.y + primaryHeight / 2;
      for (const definition of definitions) {
        const label = shape[definition.property] && typeof shape[definition.property] === 'object' ? shape[definition.property] : {};
        if (!definition.visible || label.visible === false) continue;
        const customStyle = label.style && typeof label.style === 'object' ? label.style : {};
        const explicitSize = customStyle.fontSize ?? customStyle.size;
        const resolvedSize = explicitSize == null
          ? metricSize * Math.max(0.05, finite(customStyle.scale, 1))
          : finite(explicitSize, metricSize);
        const labelStyle = mergeStyle(DEFAULTS.label, shape.labelStyle, customStyle);
        labelStyle.size = resolvedSize;
        labelStyle.fontSize = resolvedSize;
        const automaticIndex = automaticDefinitions.indexOf(definition);
        const text = label.text == null ? definition.automaticText : String(label.text);
        if (!text) continue;
        const renderedLineHeight = resolvedSize * 1.18 * (labelStyle.vertical ? Math.max(1, Array.from(String(text)).length) : 1);
        let automaticAnchor = null;
        if (automaticIndex >= 0) {
          automaticAnchor = { x: primaryAnchor.x, y: automaticBottom + 5 + renderedLineHeight / 2 };
          automaticBottom = automaticAnchor.y + renderedLineHeight / 2;
        }
        const anchor = point(label.position || definition.legacyPosition || automaticAnchor || primaryAnchor);
        this._drawTextBlock(context, anchor, text, {
          ...labelStyle,
          color: state.preview ? colorWithAlpha(labelStyle.color || DEFAULTS.label.color, 0.72) : labelStyle.color,
        }, {
          id: definition.id,
          ownerId: shape.id,
          kind: definition.kind,
          key: definition.key,
        });
      }
    }

    _drawRoadLabels(context, shape, documentModel, state = {}) {
      const visibility = shape.visibility || {};
      const center = polygonInteriorAnchor(shape.points);
      const road = shape.road || {};
      const name = road.name || shape.label || road.type || (shape.kind === 'water' ? '水路' : '道路');
      const nameStyle = mergeStyle(DEFAULTS.label, shape.labelStyle, road.nameStyle);
      const nameAnchor = point(road.namePosition || shape.labelPosition || {
        x: finite(nameStyle.x, center.x + finite(nameStyle.offsetX, 0)),
        y: finite(nameStyle.y, center.y + finite(nameStyle.offsetY, 0)),
      });
      let nameBox = null;
      if (visibility.label !== false && name) {
        nameBox = this._drawTextBlock(context, nameAnchor, String(name), {
          ...nameStyle,
          color: state.preview ? colorWithAlpha(nameStyle.color || DEFAULTS.label.color, 0.72) : nameStyle.color,
        }, {
          id: `shape-road-name:${shape.id}`,
          ownerId: shape.id,
          kind: 'shape-road-name',
          key: 'road-name',
        });
      }

      const width = finite(road.widthM ?? road.width, 0);
      let widthText = '';
      if (visibility.width !== false && width > 0) {
      const widthStyle = mergeStyle({ ...DEFAULTS.label, size: 10, fontSize: 10 }, shape.widthLabelStyle, road.widthLabelStyle);
      // 道路名を縦書きにしたときは、幅員も同じ向きへそろえる。
      // 過去データは幅員側に vertical を持たないため、道路名の設定を継承する。
      if (nameStyle.vertical === true || road.vertical === true) widthStyle.vertical = true;
      const hasWidthOffset = road.widthLabelOffset && typeof road.widthLabelOffset === 'object';
      const widthAnchor = point(road.widthLabelPosition || {
        x: center.x + finite(road.widthLabelOffset?.x, 0),
        y: center.y + finite(road.widthLabelOffset?.y, hasWidthOffset ? 0 : 26),
      });
      widthText = typeof road.widthText === 'string' && road.widthText.trim()
        ? road.widthText
        : `${road.widthPrefix == null ? '幅員 ' : String(road.widthPrefix)}${formatNumber(width, finite(road.widthDigits, 1))}${road.widthUnit === false ? '' : (road.widthUnit || 'm')}`;
      this._drawTextBlock(context, widthAnchor, widthText, {
        ...widthStyle,
        color: state.preview ? colorWithAlpha(widthStyle.color || DEFAULTS.label.color, 0.72) : widthStyle.color,
      }, {
        id: `shape-road-width:${shape.id}`,
        ownerId: shape.id,
        kind: 'shape-road-width',
        key: 'road-width',
      });
      }
      this._drawLotMetricLabels(
        context,
        shape,
        documentModel,
        state,
        nameAnchor,
        [visibility.label !== false && name ? String(name) : '', widthText].filter(Boolean),
        nameStyle,
        nameBox,
      );
    }

    _drawShapeDimensions(context, shape, documentModel, state = {}) {
      const points = normalizedPoints(shape.points);
      if (points.length < 2) return;
      const mpp = Math.max(0, finite(documentModel?.calibration?.mpp, 0));
      if (mpp <= 0) return;
      const center = polygonCentroid(points);
      const style = mergeStyle(DEFAULTS.dimension, shape.dimensionStyle, {
        color: shape.dimensionColor,
        size: shape.dimensionSize,
        digits: shape.decimals,
        approximate: shape.approximate || shape.yaku,
      });
      const hiddenEdges = new Set(asArray(shape.hiddenEdges).map((entry) => String(entry)));
      asArray(shape.edges).forEach((edge, index) => {
        if (edge?.hidden === true) hiddenEdges.add(String(index));
      });
      const limit = points.length > 2 ? points.length : points.length - 1;
      for (let index = 0; index < limit; index += 1) {
        if (hiddenEdges.has(String(index)) || hiddenEdges.has(`${index}:${(index + 1) % points.length}`)) continue;
        const edge = asArray(shape.edges)[index] || {};
        const edgeStyle = mergeStyle(style, edge.style);
        const start = points[index];
        const end = points[(index + 1) % points.length];
        const length = distance(start, end);
        if (length < 1e-7) continue;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        let nx = -dy / length;
        let ny = dx / length;
        const middle = midpoint(start, end);
        if ((middle.x - center.x) * nx + (middle.y - center.y) * ny < 0) {
          nx *= -1;
          ny *= -1;
        }
        const offset = finite(edgeStyle.offset, DEFAULTS.dimension.offset);
        const specificOffset = edge.labelOffset && typeof edge.labelOffset === 'object'
          ? edge.labelOffset
          : { x: finite(edgeStyle.offsetX, 0), y: finite(edgeStyle.offsetY, 0) };
        const anchor = {
          x: middle.x + nx * offset + finite(specificOffset.x, 0),
          y: middle.y + ny * offset + finite(specificOffset.y, 0),
        };
        const prefix = edgeStyle.approximate ? '約' : (edgeStyle.prefix || '');
        const unit = edgeStyle.showUnit === false ? '' : (edgeStyle.unit || 'm');
        const text = edge.customText != null && edge.customText !== ''
          ? String(edge.customText)
          : `${prefix}${formatMeasuredValue(length * mpp, edgeStyle)}${unit}`;
        let angle = 0;
        if (edgeStyle.angle === 'auto' || edgeStyle.angle == null || edgeStyle.rotate === true) {
          angle = Math.atan2(dy, dx) * 180 / Math.PI;
          if (angle > 90 || angle < -90) angle += 180;
        } else if (edgeStyle.rotate !== false) angle = finite(edgeStyle.angle, 0);
        angle += finite(edge.rotationOffset, 0);
        this._drawTextBlock(context, anchor, text, {
          ...edgeStyle,
          angle,
          align: 'center',
          color: state.preview ? colorWithAlpha(edgeStyle.color, 0.7) : edgeStyle.color,
          padding: 1.5,
        }, {
          id: `shape-dimension:${shape.id}:${index}`,
          ownerId: shape.id,
          kind: 'shape-dimension',
          key: `edge:${index}`,
          edgeIndex: index,
        });
      }
    }

    _drawQuietVertices(context, points) {
      const radius = 0.9 / this._renderView.zoom;
      context.save();
      context.fillStyle = 'rgba(59, 69, 80, 0.58)';
      for (const vertex of points) {
        context.beginPath();
        context.arc(vertex.x, vertex.y, radius, 0, TAU);
        context.fill();
      }
      context.restore();
    }

    _drawEntity(context, entity, documentModel, pageModel, state = {}) {
      if (!entity || entity.visible === false) return;
      const kind = String(entity.kind || entity.type || '').toLowerCase();
      switch (kind) {
        case 'distance': this._drawDistanceEntity(context, entity, documentModel, state); break;
        case 'polyline': this._drawPolylineEntity(context, entity, documentModel, state); break;
        case 'area': this._drawAreaEntity(context, entity, documentModel, state); break;
        case 'line': this._drawLineEntity(context, entity, state); break;
        case 'arrow': this._drawArrowEntity(context, entity, state); break;
        case 'text': this._drawTextEntity(context, entity, state); break;
        case 'callout': this._drawCalloutEntity(context, entity, state); break;
        case 'north': this._drawNorthEntity(context, entity, state); break;
        case 'house':
        case 'parking': this._drawStampEntity(context, entity, documentModel, state); break;
        case 'lot-table': this._drawLotTableEntity(context, entity, documentModel, pageModel, state); break;
        case 'guide':
        case 'parallel': this._drawGuideEntity(context, entity, documentModel, state); break;
        default:
          if (normalizedPoints(entity.points).length >= 2) this._drawLineEntity(context, entity, state);
          else if (entity.text) this._drawTextEntity(context, entity, state);
      }
    }

    _entityStyle(entity, state = {}) {
      const legacy = {
        color: entity.color || entity.strokeColor,
        fill: entity.fill || entity.fillColor,
        lineWidth: entity.lineWidth,
        lineStyle: entity.lineStyle,
        fontFamily: entity.fontFamily,
        fontSize: entity.fontSize,
        fontWeight: entity.fontWeight,
      };
      const result = mergeStyle(DEFAULTS.entity, entity.style, legacy);
      if (state.preview) {
        result.color = colorWithAlpha(result.color, 0.72);
        result.fill = colorWithAlpha(result.fill, 0.45);
      }
      return result;
    }

    _applyStroke(context, style) {
      context.strokeStyle = style.color || DEFAULTS.entity.color;
      context.lineWidth = this._screenWorld(Math.max(0.4, finite(style.lineWidth, DEFAULTS.entity.lineWidth)));
      context.lineCap = style.lineCap || 'round';
      context.lineJoin = style.lineJoin || 'round';
      context.setLineDash(lineDash(style.lineStyle, this._screenWorld(1)));
    }

    _drawPath(context, points, style, close = false, fill = false) {
      if (points.length < 2) return;
      context.save();
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
      if (close) context.closePath();
      if (fill) {
        context.fillStyle = style.fill || DEFAULTS.entity.fill;
        context.fill();
      }
      this._applyStroke(context, style);
      context.stroke();
      context.restore();
    }

    _drawEndpoint(context, target, style, radiusPx = 1.7) {
      const radius = this._screenWorld(radiusPx);
      context.save();
      context.beginPath();
      context.arc(target.x, target.y, radius, 0, TAU);
      context.fillStyle = style.color || DEFAULTS.entity.color;
      context.fill();
      context.restore();
    }

    _drawArrowHead(context, from, to, style, sizePx = 8) {
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const length = this._screenWorld(sizePx);
      const spread = Math.PI / 7;
      context.save();
      context.beginPath();
      context.moveTo(to.x, to.y);
      context.lineTo(to.x - Math.cos(angle - spread) * length, to.y - Math.sin(angle - spread) * length);
      context.moveTo(to.x, to.y);
      context.lineTo(to.x - Math.cos(angle + spread) * length, to.y - Math.sin(angle + spread) * length);
      this._applyStroke(context, style);
      context.stroke();
      context.restore();
    }

    _measurementText(entity, value, fallbackUnit = 'm') {
      const style = mergeStyle(DEFAULTS.dimension, entity.dimensionStyle || entity.style, {
        digits: entity.digits ?? entity.decimals,
        approximate: entity.approximate || entity.yaku,
      });
      const prefix = style.approximate ? '約' : (style.prefix || '');
      const unit = style.showUnit === false ? '' : (style.unit || fallbackUnit);
      return `${prefix}${formatMeasuredValue(value, style)}${unit}`;
    }

    _drawDistanceEntity(context, entity, documentModel, state) {
      const points = normalizedPoints(entity.points);
      if (points.length < 2) return;
      const style = this._entityStyle(entity, state);
      this._drawPath(context, points.slice(0, 2), style);
      this._drawEndpoint(context, points[0], style);
      this._drawEndpoint(context, points[1], style);
      const mpp = Math.max(0, finite(documentModel?.calibration?.mpp, 0));
      const value = mpp > 0 ? distance(points[0], points[1]) * mpp : null;
      const middle = midpoint(points[0], points[1]);
      const dx = points[1].x - points[0].x;
      const dy = points[1].y - points[0].y;
      let angle = Math.atan2(dy, dx) * 180 / Math.PI;
      if (angle > 90 || angle < -90) angle += 180;
      const offset = finite(entity.dimensionStyle?.offset ?? entity.offset, 10);
      const length = Math.hypot(dx, dy) || 1;
      const normal = upperScreenNormal(dx, dy, length);
      const anchor = entity.labelPosition
        ? point(entity.labelPosition)
        : { x: middle.x + normal.x * offset, y: middle.y + normal.y * offset };
      if (entity.dimensionStyle?.visible === false || entity.measurementVisibility?.total === false) return;
      const configuredAngle = entity.dimensionStyle?.angle ?? entity.dimensionStyle?.rotation;
      const dimensionColor = entity.dimensionStyle?.color || style.color;
      this._drawTextBlock(context, anchor, entity.text || (value == null ? '縮尺未設定' : this._measurementText(entity, value)), {
        ...DEFAULTS.dimension,
        ...entity.dimensionStyle,
        color: state.preview ? colorWithAlpha(dimensionColor, 0.72) : dimensionColor,
        angle: configuredAngle == null || configuredAngle === 'auto' ? angle : finite(configuredAngle, 0),
        padding: 1.5,
      }, { id: `entity-label:${entity.id}`, ownerId: entity.id, kind: 'entity-label', key: 'distance' });
    }

    _drawMeasurementSegments(context, entity, points, documentModel, state, closed = false) {
      if (entity.dimensionStyle?.visible === false || entity.measurementVisibility?.segments === false) return;
      const mpp = Math.max(0, finite(documentModel?.calibration?.mpp, 0));
      if (mpp <= 0 || points.length < 2) return;
      const style = this._entityStyle(entity, state);
      const center = closed ? polygonCentroid(points) : null;
      const limit = closed && points.length > 2 ? points.length : points.length - 1;
      for (let index = 0; index < limit; index += 1) {
        const start = points[index];
        const end = points[(index + 1) % points.length];
        const segment = asArray(entity.segments)[index] || {};
        if (segment.hidden === true) continue;
        const segmentStyle = mergeStyle(DEFAULTS.dimension, entity.dimensionStyle, segment.style);
        const segmentLength = distance(start, end);
        if (segmentLength <= 1e-7) continue;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        let { x: nx, y: ny } = upperScreenNormal(dx, dy, segmentLength);
        const middle = midpoint(start, end);
        if (center && (middle.x - center.x) * nx + (middle.y - center.y) * ny < 0) { nx *= -1; ny *= -1; }
        const offset = finite(segmentStyle.offset, DEFAULTS.dimension.offset);
        const labelOffset = segment.labelOffset && typeof segment.labelOffset === 'object' ? segment.labelOffset : { x: 0, y: 0 };
        const anchor = {
          x: middle.x + nx * offset + finite(labelOffset.x, 0),
          y: middle.y + ny * offset + finite(labelOffset.y, 0),
        };
        let angle = Math.atan2(dy, dx) * 180 / Math.PI;
        if (angle > 90 || angle < -90) angle += 180;
        const configuredAngle = segmentStyle.angle ?? segmentStyle.rotation;
        if (configuredAngle != null && configuredAngle !== 'auto') angle = finite(configuredAngle, 0);
        angle += finite(segment.rotationOffset, 0);
        const prefix = segmentStyle.approximate ? '約' : (segmentStyle.prefix || '');
        const unit = segmentStyle.showUnit === false ? '' : (segmentStyle.unit || 'm');
        const text = segment.customText != null && segment.customText !== ''
          ? String(segment.customText)
          : `${prefix}${formatMeasuredValue(segmentLength * mpp, segmentStyle)}${unit}`;
        this._drawTextBlock(context, anchor, text, {
          ...segmentStyle,
          color: state.preview ? colorWithAlpha(segmentStyle.color || style.color, 0.7) : (segmentStyle.color || style.color),
          angle,
          align: 'center',
          padding: 1.5,
        }, {
          id: `entity-segment:${entity.id}:${index}`,
          ownerId: entity.id,
          kind: 'entity-segment',
          key: `segment:${index}`,
          segmentIndex: index,
        });
      }
    }

    _drawPolylineEntity(context, entity, documentModel, state) {
      const points = normalizedPoints(entity.points);
      if (points.length < 2) return;
      const style = this._entityStyle(entity, state);
      this._drawPath(context, points, style, false, false);
      this._drawMeasurementSegments(context, entity, points, documentModel, state, false);
      const mpp = Math.max(0, finite(documentModel?.calibration?.mpp, 0));
      const total = mpp > 0 ? points.slice(1).reduce((sum, vertex, index) => sum + distance(points[index], vertex), 0) * mpp : null;
      const anchor = point(entity.labelPosition || points[points.length - 1]);
      if (entity.dimensionStyle?.visible === false || entity.measurementVisibility?.total === false) return;
      const dimensionColor = entity.dimensionStyle?.color || style.color;
      this._drawTextBlock(context, {
        x: anchor.x + finite(entity.labelOffsetX, 8),
        y: anchor.y + finite(entity.labelOffsetY, -8),
      }, entity.text || (total == null ? '縮尺未設定' : this._measurementText(entity, total)), {
        ...DEFAULTS.dimension,
        ...entity.dimensionStyle,
        color: state.preview ? colorWithAlpha(dimensionColor, 0.72) : dimensionColor,
        align: 'left',
        padding: 1.5,
      }, { id: `entity-label:${entity.id}`, ownerId: entity.id, kind: 'entity-label', key: 'polyline' });
    }

    _drawAreaEntity(context, entity, documentModel, state) {
      const points = normalizedPoints(entity.points);
      if (points.length < 3) return;
      const style = this._entityStyle(entity, state);
      this._drawPath(context, points, style, true, entity.fill !== false);
      this._drawMeasurementSegments(context, entity, points, documentModel, state, true);
      const mpp = Math.max(0, finite(documentModel?.calibration?.mpp, 0));
      const value = mpp > 0 ? polygonArea(points) * mpp * mpp : null;
      const anchor = point(entity.labelPosition || polygonInteriorAnchor(points));
      if (entity.dimensionStyle?.visible === false || entity.measurementVisibility?.total === false) return;
      const visibility = entity.measurementVisibility || {};
      const areaEntity = { ...entity, dimensionStyle: { ...(entity.dimensionStyle || {}), adjustment: 0 } };
      const content = entity.text || (value == null ? ['縮尺未設定'] : [
        visibility.area === false ? null : this._measurementText(areaEntity, value, '㎡'),
        visibility.tsubo === false ? null : this._measurementText(areaEntity, value / K.TSUBO_M2, '坪'),
      ].filter(Boolean));
      const dimensionColor = entity.dimensionStyle?.color || style.color;
      this._drawTextBlock(context, anchor, content, {
        ...DEFAULTS.dimension,
        ...entity.dimensionStyle,
        color: state.preview ? colorWithAlpha(dimensionColor, 0.72) : dimensionColor,
        padding: 1.5,
      }, { id: `entity-label:${entity.id}`, ownerId: entity.id, kind: 'entity-label', key: 'area' });
    }

    _drawLineEntity(context, entity, state) {
      const points = normalizedPoints(entity.points);
      if (points.length < 2) return;
      this._drawPath(context, points, this._entityStyle(entity, state), entity.closed === true, entity.fill === true);
    }

    _drawArrowEntity(context, entity, state) {
      const points = normalizedPoints(entity.points);
      if (points.length < 2) return;
      const style = this._entityStyle(entity, state);
      this._drawPath(context, points, style);
      this._drawArrowHead(context, points[points.length - 2], points[points.length - 1], style, finite(entity.headSize, 8));
      if (entity.doubleHead) this._drawArrowHead(context, points[1], points[0], style, finite(entity.headSize, 8));
      if (entity.text) {
        const textStyle = this._textStyle(entity, state);
        this._drawTextBlock(context, point(entity.labelPosition || midpoint(points[0], points[points.length - 1])), entity.text, {
          ...textStyle,
          angle: finite(entity.textAngle ?? textStyle.angle, 0),
        }, { id: `entity-label:${entity.id}`, ownerId: entity.id, kind: 'entity-label', key: 'arrow' });
      }
    }

    _entityAnchor(entity) {
      if (entity.position) return point(entity.position);
      if (entity.anchor) return point(entity.anchor);
      if (Array.isArray(entity.points) && entity.points.length) return point(entity.points[entity.points.length - 1]);
      return { x: finite(entity.x, 0), y: finite(entity.y, 0) };
    }

    _textStyle(entity, state) {
      const entityStyle = this._entityStyle(entity, state);
      return {
        color: entity.textStyle?.color || entityStyle.color,
        size: finite(entity.textStyle?.size ?? entity.fontSize ?? entityStyle.fontSize, 12),
        fontFamily: entity.textStyle?.fontFamily || entityStyle.fontFamily,
        fontWeight: entity.textStyle?.fontWeight || entityStyle.fontWeight,
        angle: finite(entity.textStyle?.angle ?? entity.angle ?? entity.rotation, 0),
        vertical: entity.textStyle?.vertical ?? entity.vertical ?? false,
        align: entity.textStyle?.align || entity.align || 'left',
        lineHeight: finite(entity.textStyle?.lineHeight, 1.2),
        borderColor: entity.textStyle?.borderColor ?? entity.borderColor,
        borderWidth: entity.textStyle?.borderWidth ?? entity.borderWidth,
        boxStyle: entity.textStyle?.boxStyle ?? entityStyle.boxStyle ?? entity.boxStyle,
        frame: entity.textStyle?.frame ?? entityStyle.frame ?? entity.frame,
        underline: entity.textStyle?.underline ?? entityStyle.underline ?? entity.underline,
        padding: entity.textStyle?.padding ?? entity.padding,
      };
    }

    _drawTextEntity(context, entity, state) {
      const anchor = this._entityAnchor(entity);
      this._drawTextBlock(context, anchor, entity.text ?? entity.label ?? '', this._textStyle(entity, state), {
        id: `entity-label:${entity.id}`,
        ownerId: entity.id,
        kind: 'entity-label',
        key: 'text',
      });
    }

    _drawCalloutEntity(context, entity, state) {
      const points = normalizedPoints(entity.points);
      if (!points.length) return;
      const style = this._entityStyle(entity, state);
      if (points.length >= 2) {
        this._drawPath(context, points, style);
        this._drawArrowHead(context, points[1], points[0], style, finite(entity.headSize, 7));
      }
      const anchor = point(entity.labelPosition || points[points.length - 1]);
      const textAlign = entity.align || (points.length >= 2 && anchor.x < points[0].x ? 'right' : 'left');
      this._drawTextBlock(context, {
        x: anchor.x + (textAlign === 'right' ? -5 : 5),
        y: anchor.y,
      }, entity.text || entity.label || '注記', { ...this._textStyle(entity, state), align: textAlign }, {
        id: `entity-label:${entity.id}`,
        ownerId: entity.id,
        kind: 'entity-label',
        key: 'callout',
      });
    }

    _drawNorthEntity(context, entity, state) {
      const anchor = this._entityAnchor(entity);
      const style = this._entityStyle(entity, state);
      const stampScale = clamp(finite(entity.stampScale ?? entity.options?.scale, 1), 0.2, 5);
      const size = clamp(finite(entity.size, 54) * stampScale, 10, 1200);
      const rotation = finite(entity.rotation ?? entity.angle, 0);
      const angle = radians(rotation);
      const ink = style.stroke || style.color || DEFAULTS.entity.color;
      const markStyle = { ...style, color: ink, lineWidth: Math.max(0.9, finite(style.lineWidth, 1.1)) };
      const outerRadius = size * 0.29;
      const innerRadius = size * 0.145;
      const hubRadius = size * 0.105;
      const arrowTipY = -size * 0.64;
      const arrowBaseY = -size * 0.38;
      const tailY = size * 0.68;
      const labelY = -size * 0.84;
      context.save();

      context.translate(anchor.x, anchor.y);
      context.rotate(angle);

      // 方位軸。円の外側まで伸ばし、測量図で見慣れた十字線にする。
      context.beginPath();
      context.moveTo(0, arrowTipY);
      context.lineTo(0, tailY);
      context.moveTo(-outerRadius * 1.22, 0);
      context.lineTo(outerRadius * 1.22, 0);
      this._applyStroke(context, { ...markStyle, lineWidth: Math.max(0.75, finite(markStyle.lineWidth, 1)) });
      context.stroke();

      // 16方位の交互色ペタル。画像ではなくベクターなので拡大しても荒れない。
      for (let index = 0; index < 16; index += 1) {
        const direction = -Math.PI / 2 + index * TAU / 16;
        const halfBase = TAU / 64;
        const tip = { x: Math.cos(direction) * outerRadius, y: Math.sin(direction) * outerRadius };
        const left = { x: Math.cos(direction - halfBase) * innerRadius, y: Math.sin(direction - halfBase) * innerRadius };
        const right = { x: Math.cos(direction + halfBase) * innerRadius, y: Math.sin(direction + halfBase) * innerRadius };
        context.beginPath();
        context.moveTo(tip.x, tip.y);
        context.lineTo(left.x, left.y);
        context.lineTo(right.x, right.y);
        context.closePath();
        context.fillStyle = index % 2 === 0 ? colorWithAlpha(ink, state.preview ? 0.48 : 0.82) : 'rgba(255,255,255,0.84)';
        context.fill();
        this._applyStroke(context, { ...markStyle, lineWidth: 0.7 });
        context.stroke();
      }

      // 外輪・内輪・中心輪を重ね、印刷時にも輪郭がつぶれない線幅にする。
      context.beginPath();
      context.arc(0, 0, outerRadius, 0, TAU);
      context.moveTo(innerRadius, 0);
      context.arc(0, 0, innerRadius, 0, TAU);
      context.moveTo(hubRadius, 0);
      context.arc(0, 0, hubRadius, 0, TAU);
      this._applyStroke(context, markStyle);
      context.stroke();

      // 北向き矢印は片側を塗り、細い図面上でも方向を一目で判別できる形にする。
      const arrowHalfWidth = size * 0.115;
      context.beginPath();
      context.moveTo(0, arrowTipY);
      context.lineTo(-arrowHalfWidth, arrowBaseY);
      context.lineTo(0, arrowBaseY);
      context.closePath();
      context.fillStyle = colorWithAlpha(ink, state.preview ? 0.48 : 0.9);
      context.fill();
      context.beginPath();
      context.moveTo(0, arrowTipY);
      context.lineTo(arrowHalfWidth, arrowBaseY);
      context.lineTo(0, arrowBaseY);
      context.closePath();
      context.fillStyle = 'rgba(255,255,255,0.9)';
      context.fill();
      context.beginPath();
      context.moveTo(0, arrowTipY);
      context.lineTo(-arrowHalfWidth, arrowBaseY);
      context.lineTo(arrowHalfWidth, arrowBaseY);
      context.closePath();
      this._applyStroke(context, markStyle);
      context.stroke();
      context.restore();

      const labelAnchor = {
        x: anchor.x - Math.sin(angle) * labelY,
        y: anchor.y + Math.cos(angle) * labelY,
      };
      this._drawTextBlock(context, labelAnchor, entity.text || 'N', {
        color: ink,
        size: finite(entity.textStyle?.size ?? entity.textStyle?.fontSize ?? entity.fontSize ?? style.size ?? style.fontSize, Math.max(12, size * 0.24)),
        fontFamily: style.fontFamily,
        fontWeight: 700,
        align: 'center',
      }, { id: `entity-label:${entity.id}`, ownerId: entity.id, kind: 'entity-label', key: 'north' });
    }

    _stampDimensions(entity, documentModel) {
      const mpp = Math.max(0, finite(documentModel?.calibration?.mpp, 0));
      const scale = clamp(finite(entity.stampScale ?? entity.options?.scale, 1), 0.2, 5);
      const width = Math.max(0.01, finite(entity.width, entity.kind === 'parking' ? 2.5 : 10)) * scale;
      const height = Math.max(0.01, finite(entity.height ?? entity.depth, entity.kind === 'parking' ? 5 : 8)) * scale;
      const metric = entity.units !== 'world' && entity.metric !== false;
      const factor = metric && mpp > 0 ? 1 / mpp : finite(entity.worldScale, metric ? 10 : 1);
      return { width: width * factor, height: height * factor, widthLabel: width, heightLabel: height };
    }

    _drawStampEntity(context, entity, documentModel, state) {
      const anchor = this._entityAnchor(entity);
      const style = this._entityStyle(entity, state);
      const dimensions = this._stampDimensions(entity, documentModel);
      const rotation = finite(entity.rotation ?? entity.angle, 0);
      const angle = radians(rotation);
      context.save();
      context.translate(anchor.x, anchor.y);
      context.rotate(angle);
      context.beginPath();
      context.rect(-dimensions.width / 2, -dimensions.height / 2, dimensions.width, dimensions.height);
      context.fillStyle = style.fill || (entity.kind === 'parking' ? 'rgba(33, 112, 187, 0.08)' : 'rgba(236, 186, 70, 0.16)');
      context.fill();
      this._applyStroke(context, { ...style, color: style.stroke || style.color });
      context.stroke();
      if (entity.kind === 'house' && entity.options?.hatch !== false && entity.hatch !== false) {
        context.save();
        context.clip();
        context.strokeStyle = colorWithAlpha(style.hatchColor || style.stroke || style.color, 0.32);
        context.lineWidth = this._screenWorld(0.6);
        const step = this._screenWorld(clamp(finite(entity.options?.hatchSpacing, 9), 2, 40));
        const extent = Math.hypot(dimensions.width, dimensions.height);
        context.rotate(radians(finite(entity.options?.hatchAngle, 45)));
        for (let offset = -extent; offset <= extent; offset += step) {
          context.beginPath();
          context.moveTo(-extent, offset);
          context.lineTo(extent, offset);
          context.stroke();
        }
        context.restore();
      }
      context.restore();
      const label = entity.text || entity.label || (entity.kind === 'parking' ? 'P' : '家屋');
      this._drawTextBlock(context, anchor, label, {
        ...this._textStyle(entity, state),
        align: 'center',
        angle: rotation + finite(entity.textAngle, 0),
      }, { id: `entity-label:${entity.id}`, ownerId: entity.id, kind: 'entity-label', key: entity.kind });
      if (entity.showDimensions === true || entity.dimensions === true) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const bottom = {
          x: anchor.x + (-sin) * (dimensions.height / 2 + 10),
          y: anchor.y + cos * (dimensions.height / 2 + 10),
        };
        const right = {
          x: anchor.x + cos * (dimensions.width / 2 + 10),
          y: anchor.y + sin * (dimensions.width / 2 + 10),
        };
        this._drawTextBlock(context, bottom, `${formatNumber(dimensions.widthLabel, 1)}m`, {
          ...DEFAULTS.dimension,
          color: style.color,
          angle: rotation,
          padding: 1,
        }, { id: `stamp-dimension:${entity.id}:width`, ownerId: entity.id, kind: 'entity-dimension', key: 'width' });
        this._drawTextBlock(context, right, `${formatNumber(dimensions.heightLabel, 1)}m`, {
          ...DEFAULTS.dimension,
          color: style.color,
          angle: rotation + 90,
          padding: 1,
        }, { id: `stamp-dimension:${entity.id}:height`, ownerId: entity.id, kind: 'entity-dimension', key: 'height' });
      }
    }

    _defaultLotTableColumns(entity) {
      const columns = [
        { key: 'number', label: '区画', width: 48, align: 'center' },
        { key: 'label', label: '表示', width: 108, align: 'left' },
        { key: 'area', label: '面積', width: 76, align: 'right' },
        { key: 'tsubo', label: '坪', width: 68, align: 'right' },
      ];
      if (entity.showPrice !== false) columns.push({ key: 'price', label: '価格', width: 88, align: 'right' });
      return columns;
    }

    _drawLotTableEntity(context, entity, documentModel, pageModel, state) {
      const liveLots = (Array.isArray(pageModel?.shapes) ? pageModel.shapes : []).filter((shape) => shape?.kind === 'lot' && shape.visible !== false);
      const fixed = entity.dynamic === false || entity.snapshot === true || entity.options?.mode === 'snapshot';
      const snapshotRows = Array.isArray(entity.rows) ? entity.rows : [];
      const lots = fixed ? snapshotRows : liveLots;
      const anchor = this._entityAnchor(entity);
      const zoom = this._renderView.zoom;
      const tableScale = clamp(finite(entity.scale ?? entity.options?.scale ?? entity.worldScale, 1), 0.3, 5);
      const style = this._entityStyle(entity, state);
      const columns = (Array.isArray(entity.columns) && entity.columns.length ? entity.columns : this._defaultLotTableColumns(entity))
        .map((column) => ({ ...column, width: Math.max(24, finite(column.width, 70)) * tableScale }));
      const rowHeight = Math.max(14, finite(entity.rowHeight, 24)) * tableScale;
      const titleHeight = entity.title === false ? 0 : Math.max(16, finite(entity.titleHeight, 26)) * tableScale;
      const headerHeight = Math.max(14, finite(entity.headerHeight, 23)) * tableScale;
      const width = columns.reduce((sum, column) => sum + column.width, 0);
      const height = titleHeight + headerHeight + rowHeight * (Math.max(1, lots.length) + 1);
      const fontSize = clamp(finite(entity.fontSize ?? entity.textStyle?.fontSize ?? style.fontSize, 10.5), 7, 60) * tableScale;
      const mpp = Math.max(0, finite(documentModel?.calibration?.mpp, 0));
      context.save();
      context.translate(anchor.x, anchor.y);
      context.rotate(radians(entity.rotation ?? entity.angle));
      context.fillStyle = entity.background || 'rgba(255,255,255,0.94)';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = style.color;
      context.lineWidth = clamp(finite(style.lineWidth, 0.75), 0.5, 5);
      context.strokeRect(0, 0, width, height);
      let y = 0;
      context.textBaseline = 'middle';
      context.font = `700 ${fontSize}px ${fontFamily(style.fontFamily)}`;
      context.fillStyle = style.color;
      if (titleHeight) {
        context.textAlign = 'left';
        context.fillText(String(entity.title || '区画一覧'), 7 * tableScale, titleHeight / 2);
        y += titleHeight;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
      context.fillStyle = entity.headerFill || 'rgba(31, 76, 119, 0.08)';
      context.fillRect(0, y, width, headerHeight);
      context.fillStyle = style.color;
      let x = 0;
      for (const column of columns) {
        context.textAlign = 'center';
        context.fillText(String(column.label || column.key), x + column.width / 2, y + headerHeight / 2);
        x += column.width;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x, height);
        context.stroke();
      }
      y += headerHeight;
      context.font = `500 ${fontSize}px ${fontFamily(style.fontFamily)}`;
      const rows = lots.length ? lots : [{ number: '', label: fixed ? '固定値なし' : '区画なし', points: [] }];
      const totals = { area: 0, tsubo: 0, price: 0, hasArea: false, hasTsubo: false, hasPrice: false };
      rows.forEach((lot, rowIndex) => {
        if (rowIndex % 2 === 1) {
          context.fillStyle = 'rgba(33, 64, 94, 0.025)';
          context.fillRect(0, y, width, rowHeight);
        }
        const area = Number.isFinite(Number(lot.area)) ? Number(lot.area) : (mpp > 0 && Array.isArray(lot.points) ? polygonArea(lot.points) * mpp * mpp : null);
        const tsubo = Number.isFinite(Number(lot.tsubo)) ? Number(lot.tsubo) : (area == null ? null : area / K.TSUBO_M2);
        const priceNumber = lot.price == null || lot.price === '' ? null : Number(String(lot.price).replace(/,/g, ''));
        if (lots.length && area != null && Number.isFinite(area)) { totals.area += area; totals.hasArea = true; }
        if (lots.length && tsubo != null && Number.isFinite(tsubo)) { totals.tsubo += tsubo; totals.hasTsubo = true; }
        if (lots.length && Number.isFinite(priceNumber)) { totals.price += priceNumber; totals.hasPrice = true; }
        const values = {
          number: lot.number == null ? '' : String(lot.number),
          label: lot.label || '',
          area: area == null ? '—' : `${formatNumber(area, 2)}㎡`,
          tsubo: tsubo == null ? '—' : `${formatNumber(tsubo, 2)}坪`,
          price: lot.price == null || lot.price === '' ? '—' : moneyText(lot.price),
          memo: lot.memo || '',
        };
        x = 0;
        context.fillStyle = style.color;
        for (const column of columns) {
          const padding = 5 * tableScale;
          const align = column.align || 'left';
          context.textAlign = align;
          const textX = align === 'center' ? x + column.width / 2 : align === 'right' ? x + column.width - padding : x + padding;
          const raw = typeof column.value === 'function' ? column.value(lot, { area, document: documentModel }) : values[column.key];
          context.fillText(raw == null ? '' : String(raw), textX, y + rowHeight / 2);
          x += column.width;
        }
        y += rowHeight;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      });
      context.fillStyle = entity.totalFill || 'rgba(31, 76, 119, 0.13)';
      context.fillRect(0, y, width, rowHeight);
      context.font = `700 ${fontSize}px ${fontFamily(style.fontFamily)}`;
      const totalValues = {
        number: '', label: '合計',
        area: totals.hasArea ? `${formatNumber(totals.area, 2)}㎡` : '—',
        tsubo: totals.hasTsubo ? `${formatNumber(totals.tsubo, 2)}坪` : '—',
        price: totals.hasPrice ? moneyText(totals.price) : '0万円',
        memo: '',
      };
      x = 0;
      context.fillStyle = style.color;
      for (const column of columns) {
        const padding = 5 * tableScale;
        const align = column.align || 'left';
        context.textAlign = align;
        const textX = align === 'center' ? x + column.width / 2 : align === 'right' ? x + column.width - padding : x + padding;
        context.fillText(totalValues[column.key] ?? '', textX, y + rowHeight / 2);
        x += column.width;
      }
      y += rowHeight;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
      context.restore();
      this._registerBox({
        id: `lot-table:${entity.id}`,
        ownerId: entity.id,
        kind: 'lot-table',
        key: 'table',
      }, { x: 0, y: 0, width, height }, anchor, 0);
    }

    _drawGuideEntity(context, entity, documentModel, state) {
      let points = normalizedPoints(entity.points);
      if (points.length < 2) return;
      const style = this._entityStyle({
        ...entity,
        style: {
          color: entity.kind === 'parallel' ? '#9b4c8d' : '#6c7680',
          lineWidth: 0.9,
          lineStyle: entity.kind === 'parallel' ? 'dashdot' : 'dashed',
          ...(entity.style || {}),
        },
      }, state);
      if (entity.kind === 'parallel') {
        const start = points[0];
        const end = points[points.length - 1];
        const length = distance(start, end);
        if (length > 1e-7) {
          const direction = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
          const extension = Math.max(length * 4, this._screenWorld(600));
          points = [
            { x: start.x - direction.x * extension, y: start.y - direction.y * extension },
            { x: end.x + direction.x * extension, y: end.y + direction.y * extension },
          ];
        }
      }
      this._drawPath(context, points, style);
      const isSegmentGuide = entity.kind === 'guide' && entity.options?.mode === 'segment';
      if (isSegmentGuide) {
        const start = points[0];
        const end = points[points.length - 1];
        const divisions = clamp(Math.round(finite(entity.options?.divisions, 2)), 2, 20);
        const markerSize = this._screenWorld(3.25);
        context.save();
        context.strokeStyle = style.color;
        context.lineWidth = this._screenWorld(Math.max(0.65, finite(style.lineWidth, 0.9)));
        context.setLineDash([]);
        for (let index = 1; index < divisions; index += 1) {
          const marker = {
            x: start.x + (end.x - start.x) * index / divisions,
            y: start.y + (end.y - start.y) * index / divisions,
          };
          context.beginPath();
          context.moveTo(marker.x - markerSize, marker.y - markerSize);
          context.lineTo(marker.x + markerSize, marker.y + markerSize);
          context.moveTo(marker.x + markerSize, marker.y - markerSize);
          context.lineTo(marker.x - markerSize, marker.y + markerSize);
          context.stroke();
        }
        context.restore();
      }
    }

    _drawTextBlock(context, anchorValue, content, styleValue = {}, meta = {}) {
      const anchor = point(anchorValue);
      const style = mergeStyle(DEFAULTS.label, styleValue);
      const zoom = this._renderView.zoom;
      const screenFixed = style.screenFixed === true && style.worldSize !== true;
      const fixedWorld = screenFixed ? Math.max(0.01, finite(this._fixedScale, 1)) / zoom : 1;
      const size = clamp(finite(style.size ?? style.fontSize, 12), 4, 144) * fixedWorld;
      const family = fontFamily(style.fontFamily || style.font);
      const weight = style.fontWeight || style.weight || 500;
      const italic = style.italic ? 'italic ' : '';
      const lineHeight = size * clamp(finite(style.lineHeight, 1.18), 0.8, 2.5);
      const lines = Array.isArray(content) ? content.map(String) : String(content ?? '').split(/\r?\n/);
      const vertical = style.vertical === true;
      const padding = Math.max(0, finite(style.padding, 0)) * fixedWorld;
      context.save();
      context.font = `${italic}${weight} ${size}px ${family}`;
      context.textBaseline = 'middle';
      const widths = lines.map((line) => context.measureText(line || ' ').width);
      let contentWidth;
      let contentHeight;
      if (vertical) {
        const columns = lines.map((line) => Array.from(line || ' '));
        contentWidth = Math.max(size, columns.length * lineHeight);
        contentHeight = Math.max(lineHeight, ...columns.map((characters) => characters.length * lineHeight));
      } else {
        contentWidth = Math.max(size * 0.4, ...widths);
        contentHeight = Math.max(lineHeight, lines.length * lineHeight);
      }
      const boxWidth = contentWidth + padding * 2;
      const boxHeight = contentHeight + padding * 2;
      const align = style.align || 'center';
      const localX = align === 'left' ? 0 : align === 'right' ? -boxWidth : -boxWidth / 2;
      const localY = -boxHeight / 2;
      const angleDegrees = finite(style.angle ?? style.rotation, 0);
      context.translate(anchor.x, anchor.y);
      context.rotate(radians(angleDegrees));
      const boxStyle = String(style.boxStyle || '').toLowerCase();
      const hasFrame = style.frame === true || ['box', 'frame', 'border', '枠'].includes(boxStyle);
      if (hasFrame || style.borderColor || finite(style.borderWidth, 0) > 0) {
        context.strokeStyle = style.borderColor || style.color || DEFAULTS.label.color;
        context.lineWidth = Math.max(0.5, finite(style.borderWidth, 0.75)) * fixedWorld;
        context.setLineDash(lineDash(style.borderStyle, fixedWorld));
        context.strokeRect(localX, localY, boxWidth, boxHeight);
      }
      context.fillStyle = style.color || DEFAULTS.label.color;
      context.font = `${italic}${weight} ${size}px ${family}`;
      if (vertical) {
        const columns = lines.map((line) => Array.from(line || ' '));
        context.textAlign = 'center';
        columns.forEach((characters, columnIndex) => {
          const x = localX + padding + contentWidth - lineHeight * (columnIndex + 0.5);
          const columnHeight = characters.length * lineHeight;
          const startY = localY + padding + (contentHeight - columnHeight) / 2 + lineHeight / 2;
          characters.forEach((character, charIndex) => context.fillText(character, x, startY + charIndex * lineHeight));
        });
      } else {
        context.textAlign = align;
        const textX = align === 'left'
          ? localX + padding
          : align === 'right'
            ? localX + boxWidth - padding
            : localX + boxWidth / 2;
        const startY = localY + padding + (contentHeight - lines.length * lineHeight) / 2 + lineHeight / 2;
        lines.forEach((line, index) => context.fillText(line, textX, startY + index * lineHeight));
      }
      if (style.underline === true || ['underline', '下線'].includes(boxStyle)) {
        context.beginPath();
        context.strokeStyle = style.color || DEFAULTS.label.color;
        context.lineWidth = Math.max(0.6, finite(style.underlineWidth, 0.9)) * fixedWorld;
        context.moveTo(localX + padding, localY + boxHeight - Math.max(0.5, padding * 0.45));
        context.lineTo(localX + boxWidth - padding, localY + boxHeight - Math.max(0.5, padding * 0.45));
        context.stroke();
      }
      context.restore();
      this._registerBox(meta, { x: localX, y: localY, width: boxWidth, height: boxHeight }, anchor, angleDegrees);
      return { width: boxWidth, height: boxHeight };
    }

    _registerBox(meta, localBounds, anchor, angleDegrees) {
      if (!this._recordLabels || !meta) return;
      const angle = radians(angleDegrees);
      const localCorners = [
        { x: localBounds.x, y: localBounds.y },
        { x: localBounds.x + localBounds.width, y: localBounds.y },
        { x: localBounds.x + localBounds.width, y: localBounds.y + localBounds.height },
        { x: localBounds.x, y: localBounds.y + localBounds.height },
      ];
      const worldPolygon = localCorners.map((corner) => {
        const rotated = rotatePoint(corner, angle);
        return { x: anchor.x + rotated.x, y: anchor.y + rotated.y };
      });
      const polygon = worldPolygon.map((entry) => this.worldToScreen(entry, this._renderView));
      const screenBounds = polygon.reduce((box, entry) => extendBounds(box, entry.x, entry.y), null);
      this.labelBoxes.push({
        ...meta,
        angle: finite(angleDegrees, 0),
        polygon,
        worldPolygon,
        x: screenBounds.minX,
        y: screenBounds.minY,
        width: screenBounds.maxX - screenBounds.minX,
        height: screenBounds.maxY - screenBounds.minY,
        world: {
          x: Math.min(...worldPolygon.map((entry) => entry.x)),
          y: Math.min(...worldPolygon.map((entry) => entry.y)),
          width: Math.max(...worldPolygon.map((entry) => entry.x)) - Math.min(...worldPolygon.map((entry) => entry.x)),
          height: Math.max(...worldPolygon.map((entry) => entry.y)) - Math.min(...worldPolygon.map((entry) => entry.y)),
        },
      });
    }

    _drawOverlay(context, overlay, documentModel, pageModel, options) {
      const shapes = Array.isArray(pageModel?.shapes) ? pageModel.shapes : [];
      const entities = Array.isArray(pageModel?.entities) ? pageModel.entities : [];
      const replacements = asArray(overlay.replacements)
        .map((value) => value?.object || value?.entity || value?.shape || value)
        .filter(Boolean);
      const replacementMap = new Map(replacements.map((value) => [String(value.id), value]));
      if (options.includePreview) {
        for (const replacement of replacements) {
          if (['lot', 'road', 'water', 'cutout'].includes(replacement.kind)) {
            this._drawShape(context, replacement, documentModel, { preview: false, showLabel: true });
          } else {
            this._drawEntity(context, replacement, documentModel, pageModel, { preview: false });
          }
        }
      }
      const selectedIds = new Set([
        ...asArray(overlay.selectedIds),
        ...asArray(overlay.selectedId),
      ].filter((value) => value != null).map(String));
      if (options.includeSelection) {
        for (const selectedId of selectedIds) {
          const replacement = replacementMap.get(selectedId);
          const shape = ['lot', 'road', 'water', 'cutout'].includes(replacement?.kind)
            ? replacement
            : shapes.find((item) => String(item?.id) === selectedId);
          if (shape) this._drawShapeSelection(context, shape, overlay);
          const entity = replacement && !['lot', 'road', 'water', 'cutout'].includes(replacement.kind)
            ? replacement
            : entities.find((item) => String(item?.id) === selectedId);
          if (entity) this._drawEntitySelection(context, entity, overlay);
        }
        if (overlay.hoverId != null && !selectedIds.has(String(overlay.hoverId))) {
          const shape = shapes.find((item) => String(item?.id) === String(overlay.hoverId));
          if (shape) this._drawShapeOutline(context, shape, this.theme.hover, false);
          const entity = entities.find((item) => String(item?.id) === String(overlay.hoverId));
          if (entity) this._drawEntityOutline(context, entity, this.theme.hover, false);
        }
        if (overlay.edgeVisibilityGuide?.id != null && Number.isInteger(overlay.edgeVisibilityGuide.index)) {
          const edgeId = String(overlay.edgeVisibilityGuide.id);
          const shape = replacementMap.get(edgeId) || shapes.find((item) => String(item?.id) === edgeId);
          if (shape) this._drawEdgeVisibilityGuide(context, shape, overlay.edgeVisibilityGuide.index);
        }
        if (overlay.edgeSelectionGuide?.id != null && Number.isInteger(overlay.edgeSelectionGuide.index)) {
          const edgeId = String(overlay.edgeSelectionGuide.id);
          const shape = replacementMap.get(edgeId) || shapes.find((item) => String(item?.id) === edgeId);
          if (shape) this._drawEdgeSelectionGuide(context, shape, overlay.edgeSelectionGuide.index, overlay.edgeSelectionGuide);
        }
        if (overlay.marquee?.start && overlay.marquee?.end) {
          const start = point(overlay.marquee.start);
          const end = point(overlay.marquee.end);
          const x = Math.min(start.x, end.x);
          const y = Math.min(start.y, end.y);
          const width = Math.abs(end.x - start.x);
          const height = Math.abs(end.y - start.y);
          const zoom = Math.max(0.005, this._renderView.zoom);
          context.save();
          context.fillStyle = 'rgba(22,119,210,0.10)';
          context.strokeStyle = this.theme.selection;
          context.lineWidth = 1.25 / zoom;
          context.setLineDash([6 / zoom, 3 / zoom]);
          context.fillRect(x, y, width, height);
          context.strokeRect(x, y, width, height);
          context.restore();
        }
      }
      if (options.includePreview) {
        this._drawDraft(context, overlay, documentModel);
        const previews = [
          ...asArray(overlay.preview),
          ...asArray(overlay.placementPreview),
          ...asArray(overlay.previews),
        ].filter(Boolean);
        for (const previewValue of previews) {
          const preview = previewValue.object || previewValue.entity || previewValue.shape || previewValue;
          if (!preview) continue;
          if (previewValue.type === 'shape' || ['lot', 'road', 'water', 'cutout'].includes(preview.kind)) {
            this._drawShape(context, preview, documentModel, { preview: true, showLabel: true });
          } else {
            this._drawEntity(context, preview, documentModel, pageModel, { preview: true });
          }
        }
        this._drawConstructionLine(context, overlay.splitLine, '#c43d55');
        this._drawConstructionLine(context, overlay.guideLine, '#647783');
        this._drawConstructionLine(context, overlay.parallelLine, '#9b4c8d');
        if (overlay.snap?.point || (overlay.snap && overlay.snap.x != null)) {
          this._drawSnap(context, overlay.snap.point || overlay.snap);
        }
      }
    }

    _drawShapeOutline(context, shape, color, handles) {
      const points = normalizedPoints(shape.points);
      if (points.length < 2) return;
      const zoom = this._renderView.zoom;
      context.save();
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
      if (points.length >= 3) context.closePath();
      context.strokeStyle = 'rgba(255,255,255,0.92)';
      context.lineWidth = 4 / zoom;
      context.setLineDash([]);
      context.stroke();
      context.strokeStyle = color;
      context.lineWidth = 4 / zoom;
      context.setLineDash([7 / zoom, 3.5 / zoom]);
      context.stroke();
      // 選択ハローの中央へ実際の外枠を描き戻す。
      // 選択中でも塗り・外枠の設定色をその場で確認できる。
      const base = this._shapeDefaults(shape.kind);
      const actualStyle = mergeStyle(base, shape.style, {
        stroke: shape.strokeColor,
      });
      context.strokeStyle = actualStyle.stroke || base.stroke;
      context.lineWidth = Math.max(2, finite(actualStyle.lineWidth, base.lineWidth)) / zoom;
      context.setLineDash(lineDash(actualStyle.lineStyle, 1 / zoom));
      context.stroke();
      context.setLineDash([]);
      if (handles) {
        points.forEach((vertex) => {
          const radius = 1.6 / zoom;
          context.beginPath();
          context.arc(vertex.x, vertex.y, radius, 0, TAU);
          context.fillStyle = '#ffffff';
          context.fill();
          context.lineWidth = 0.85 / zoom;
          context.strokeStyle = color;
          context.stroke();
        });
      }
      context.restore();
    }

    _drawShapeSelection(context, shape, overlay) {
      const showHandles = overlay.showHandles !== false && (overlay.command === 'vertex' || overlay.mode === 'vertex' || overlay.showVertices === true);
      this._drawShapeOutline(context, shape, this.theme.selection, showHandles);
    }

    _drawEdgeVisibilityGuide(context, shape, edgeIndex) {
      const points = normalizedPoints(shape?.points);
      if (points.length < 2 || edgeIndex < 0 || edgeIndex >= points.length) return;
      const start = points[edgeIndex];
      const end = points[(edgeIndex + 1) % points.length];
      const hidden = asArray(shape.edges)[edgeIndex]?.hidden === true || asArray(shape.hiddenEdges).map(String).includes(String(edgeIndex));
      const color = hidden ? '#138a58' : '#d4572b';
      const zoom = this._renderView.zoom;
      context.save();
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.strokeStyle = 'rgba(255,255,255,.96)';
      context.lineWidth = 8 / zoom;
      context.setLineDash([]);
      context.stroke();
      context.strokeStyle = color;
      context.lineWidth = 4 / zoom;
      context.setLineDash([9 / zoom, 3 / zoom]);
      context.stroke();
      for (const vertex of [start, end]) {
        context.beginPath();
        context.arc(vertex.x, vertex.y, 3 / zoom, 0, TAU);
        context.fillStyle = '#fff';
        context.fill();
        context.lineWidth = 1.5 / zoom;
        context.strokeStyle = color;
        context.setLineDash([]);
        context.stroke();
      }
      context.restore();
      this._drawTextBlock(context, midpoint(start, end), hidden ? 'クリックで表示' : 'クリックで非表示', {
        color,
        size: 10,
        fontWeight: 700,
        screenFixed: true,
        background: 'transparent',
        padding: 0,
      }, { id: `edge-visibility:${shape.id}:${edgeIndex}`, ownerId: shape.id, kind: 'edge-visibility-guide', edgeIndex });
    }

    _drawEdgeSelectionGuide(context, shape, edgeIndex, guide = {}) {
      const points = normalizedPoints(shape?.points);
      if (points.length < 2 || edgeIndex < 0 || edgeIndex >= points.length) return;
      const start = points[edgeIndex];
      const end = points[(edgeIndex + 1) % points.length];
      const hover = guide.state === 'hover' || guide.mode === 'hover' || guide.hover === true;
      const zoom = Math.max(0.0001, finite(this._renderView.zoom, 1));
      context.save();
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.strokeStyle = hover ? 'rgba(37, 99, 235, .58)' : 'rgba(37, 99, 235, .88)';
      context.lineWidth = (hover ? 1.5 : 2.1) / zoom;
      context.setLineDash(hover ? [5 / zoom, 4 / zoom] : []);
      context.stroke();
      context.restore();
    }

    _drawEntityOutline(context, entity, color, handles) {
      const points = normalizedPoints(entity.points);
      const anchor = this._entityAnchor(entity);
      const zoom = this._renderView.zoom;
      context.save();
      context.strokeStyle = color;
      context.lineWidth = 4 / zoom;
      context.setLineDash([7 / zoom, 3.5 / zoom]);
      if (points.length >= 2) {
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
        if (entity.kind === 'area' || entity.closed) context.closePath();
        context.stroke();
        // 青い選択帯の中央へ実際の線を戻し、編集中の線色を見える状態にする。
        const actualStyle = this._entityStyle(entity);
        this._applyStroke(context, { ...actualStyle, lineWidth: Math.max(2, finite(actualStyle.lineWidth, DEFAULTS.entity.lineWidth)) });
        context.stroke();
      } else {
        const size = 7 / zoom;
        context.strokeRect(anchor.x - size / 2, anchor.y - size / 2, size, size);
      }
      context.setLineDash([]);
      if (handles) {
        for (const vertex of points.length ? points : [anchor]) {
          context.beginPath();
          context.arc(vertex.x, vertex.y, 1.6 / zoom, 0, TAU);
          context.fillStyle = '#ffffff';
          context.fill();
          context.stroke();
        }
      }
      context.restore();
    }

    _drawEntitySelection(context, entity, overlay) {
      this._drawEntityOutline(context, entity, this.theme.selection, overlay.showHandles === true || overlay.command === 'vertex');
    }

    _drawDraftSegmentDimensions(context, inputPoints, documentModel, closed = false) {
      const mpp = Math.max(0, finite(documentModel?.calibration?.mpp, 0));
      if (mpp <= 0) return;
      const points = normalizedPoints(inputPoints).filter((vertex, index, values) => index === 0 || distance(vertex, values[index - 1]) > 1e-7);
      if (points.length < 2) return;
      const drawClosed = closed && points.length >= 3;
      const center = drawClosed ? polygonCentroid(points) : null;
      const limit = drawClosed ? points.length : points.length - 1;
      const zoom = Math.max(0.05, this._renderView.zoom);
      for (let index = 0; index < limit; index += 1) {
        const start = points[index];
        const end = points[(index + 1) % points.length];
        const segmentLength = distance(start, end);
        if (segmentLength <= 1e-7) continue;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        let { x: nx, y: ny } = upperScreenNormal(dx, dy, segmentLength);
        const middle = midpoint(start, end);
        if (center) {
          if ((middle.x - center.x) * nx + (middle.y - center.y) * ny < 0) { nx *= -1; ny *= -1; }
        }
        let angle = Math.atan2(dy, dx) * 180 / Math.PI;
        if (angle > 90 || angle < -90) angle += 180;
        const offset = 13 / zoom;
        const anchor = { x: middle.x + nx * offset, y: middle.y + ny * offset };
        const text = `${formatMeasuredValue(segmentLength * mpp, { digits: 2, decimals: 2, rounding: 'round' })}m`;
        this._drawTextBlock(context, anchor, text, {
          ...DEFAULTS.dimension,
          color: '#153f6d',
          size: 11,
          fontSize: 11,
          fontWeight: 700,
          angle,
          padding: 1.5,
          screenFixed: true,
        });
      }
    }

    _drawDraft(context, overlay, documentModel) {
      const draftObject = overlay.draft;
      const points = normalizedPoints(Array.isArray(draftObject) ? draftObject : draftObject?.points);
      if (!points.length) return;
      const pointer = overlay.pointer?.world || overlay.pointerWorld || (overlay.pointer?.x != null ? overlay.pointer : null);
      const previewPoints = pointer ? [...points, point(pointer)] : points;
      const draftKind = draftObject?.kind || overlay.draftKind || overlay.command || 'line';
      if (draftKind === 'road' || draftKind === 'water') {
        // 道路・水路は外周を指定して作る。入力途中を幅付き中心線として描くと
        // 太い帯が突然現れて外周点を見失うため、確定前は細い境界ガイドだけにする。
        this._drawPath(context, previewPoints, {
          ...DEFAULTS.entity,
          ...(draftObject?.style || overlay.style || {}),
          color: draftObject?.style?.stroke || draftObject?.style?.color || overlay.style?.stroke || this.theme.selection,
          lineWidth: 1.15,
          lineStyle: 'dashed',
          opacity: 0.9,
        });
        this._drawDraftSegmentDimensions(context, previewPoints, documentModel, previewPoints.length >= 3);
      } else if (['lot', 'parcel', 'cutout'].includes(draftKind)) {
        const kind = draftKind === 'parcel' ? 'lot' : draftKind;
        const shape = {
          id: '__draft__',
          kind,
          points: previewPoints,
          style: draftObject?.style || overlay.style,
          labelStyle: draftObject?.labelStyle,
          dimensionStyle: draftObject?.dimensionStyle,
          visibility: draftObject?.visibility || { label: false, dimensions: draftObject?.showDimensions === true },
          showLengths: draftObject?.showDimensions === true,
        };
        this._drawShape(context, shape, documentModel, { preview: true, showLabel: false });
        if (kind === 'lot') this._drawDraftSegmentDimensions(context, previewPoints, documentModel, previewPoints.length >= 3);
      } else {
        const isMeasurementDraft = ['distance', 'polyline', 'area'].includes(draftKind);
        const closeMeasurementDraft = draftKind === 'area' && previewPoints.length >= 3;
        this._drawPath(context, previewPoints, {
          ...DEFAULTS.entity,
          ...(draftObject?.style || overlay.style || {}),
          color: draftObject?.style?.color || overlay.style?.color || this.theme.selection,
          lineStyle: draftObject?.style?.lineStyle || 'dashed',
        }, closeMeasurementDraft);
        if (isMeasurementDraft) {
          this._drawDraftSegmentDimensions(context, previewPoints, documentModel, closeMeasurementDraft);
        }
      }
      context.save();
      context.fillStyle = this.theme.selection;
      for (const vertex of points) {
        context.beginPath();
        context.arc(vertex.x, vertex.y, 1.4 / this._renderView.zoom, 0, TAU);
        context.fill();
      }
      context.restore();
    }

    _drawConstructionLine(context, line, color) {
      if (!line) return;
      const points = normalizedPoints(line.points || line);
      if (points.length < 2) return;
      this._drawPath(context, points, {
        ...DEFAULTS.entity,
        ...(line.style || {}),
        color: line.style?.color || color,
        lineWidth: line.style?.lineWidth || 1,
        lineStyle: line.style?.lineStyle || 'dashed',
      });
    }

    _drawSnap(context, value) {
      const target = point(value);
      const zoom = this._renderView.zoom;
      const size = 4 / zoom;
      context.save();
      context.strokeStyle = this.theme.snap;
      context.lineWidth = 0.9 / zoom;
      context.strokeRect(target.x - size, target.y - size, size * 2, size * 2);
      context.beginPath();
      context.moveTo(target.x - size * 1.5, target.y);
      context.lineTo(target.x + size * 1.5, target.y);
      context.moveTo(target.x, target.y - size * 1.5);
      context.lineTo(target.x, target.y + size * 1.5);
      context.stroke();
      context.restore();
    }

    _backgroundBounds(background, pageModel, documentModel) {
      const source = this._resolveBackgroundSource(background, pageModel, documentModel);
      const dimensions = sourceDimensions(source);
      const width = finite(background?.width, dimensions.width);
      const height = finite(background?.height, dimensions.height);
      if (width <= 0 || height <= 0) return null;
      const scaleX = finite(background.scaleX, finite(background.scale, 1)) || 1;
      const scaleY = finite(background.scaleY, finite(background.scale, 1)) || 1;
      const origin = String(background.origin || 'top-left');
      const x = finite(background.x, 0);
      const y = finite(background.y, 0);
      const center = origin === 'center'
        ? { x, y }
        : { x: x + width * scaleX / 2, y: y + height * scaleY / 2 };
      const angle = radians(background.rotation);
      const corners = [
        { x: -width * scaleX / 2, y: -height * scaleY / 2 },
        { x: width * scaleX / 2, y: -height * scaleY / 2 },
        { x: width * scaleX / 2, y: height * scaleY / 2 },
        { x: -width * scaleX / 2, y: height * scaleY / 2 },
      ].map((corner) => {
        const rotated = rotatePoint(corner, angle);
        return { x: center.x + rotated.x, y: center.y + rotated.y };
      });
      return corners.reduce((bounds, corner) => extendBounds(bounds, corner.x, corner.y), null);
    }

    _extendEntityBounds(bounds, entity, documentModel) {
      for (const vertex of normalizedPoints(entity?.points)) bounds = extendBounds(bounds, vertex.x, vertex.y);
      if (!entity) return bounds;
      const anchor = this._entityAnchor(entity);
      bounds = extendBounds(bounds, anchor.x, anchor.y);
      if (entity.kind === 'house' || entity.kind === 'parking') {
        const dimensions = this._stampDimensions(entity, documentModel);
        const halfDiagonal = Math.hypot(dimensions.width, dimensions.height) / 2;
        bounds = extendBounds(bounds, anchor.x - halfDiagonal, anchor.y - halfDiagonal);
        bounds = extendBounds(bounds, anchor.x + halfDiagonal, anchor.y + halfDiagonal);
      } else if (entity.kind === 'lot-table') {
        const columns = Array.isArray(entity.columns) && entity.columns.length ? entity.columns : this._defaultLotTableColumns(entity);
        const tableScale = clamp(finite(entity.scale ?? entity.options?.scale ?? entity.worldScale, 1), 0.3, 5);
        const width = finite(entity.worldWidth, columns.reduce((sum, column) => sum + finite(column.width, 70), 0) * tableScale);
        const height = finite(entity.worldHeight, (80 + finite(entity.rowHeight, 24) * 5) * tableScale);
        const angle = radians(entity.rotation ?? entity.angle);
        for (const corner of [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }]) {
          const rotated = rotatePoint(corner, angle);
          bounds = extendBounds(bounds, anchor.x + rotated.x, anchor.y + rotated.y);
        }
      } else if (entity.kind === 'north') {
        const scale = clamp(finite(entity.stampScale ?? entity.options?.scale, 1), 0.2, 5);
        const size = finite(entity.worldSize, finite(entity.size, 54)) * scale;
        bounds = extendBounds(bounds, anchor.x - size, anchor.y - size);
        bounds = extendBounds(bounds, anchor.x + size, anchor.y + size);
      }
      return bounds;
    }
  }

  KozuV210.Renderer = Renderer;
  KozuV210.RENDER_DEFAULTS = DEFAULTS;
})(typeof window !== 'undefined' ? window : globalThis);
