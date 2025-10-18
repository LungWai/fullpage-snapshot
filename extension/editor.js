// A lightweight, dependency-free canvas editor focused on rectangles and batch application.
(function(){
  const qs = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));

  const canvas = qs('#canvas');
  const ctx = canvas.getContext('2d');
  const thumbs = qs('#thumbs');
  const dropzone = qs('#dropzone');

  const strokeWidthEl = qs('#strokeWidth');
  const colorEl = qs('#color');
  const fillOpacityEl = qs('#fillOpacity');
  const applyToAllEl = qs('#applyToAll');

  // Mode buttons (create vs drag)
  const modeButtons = [qs('#mode-create'), qs('#mode-drag')];
  let editMode = 'create'; // 'create' or 'drag'
  
  modeButtons.forEach(b => b.addEventListener('click', () => {
    editMode = b.dataset.mode;
    modeButtons.forEach(x => x.classList.toggle('primary', x === b));
    updateCursor();
    selectedShapeIndex = -1; // Clear selection when changing modes
    redraw();
  }));

  const toolButtons = [qs('#tool-rect-stroke'), qs('#tool-rect-fill')];
  let tool = 'rect-stroke';
  toolButtons.forEach(b => b.addEventListener('click', () => {
    tool = b.dataset.tool;
    toolButtons.forEach(x => x.classList.toggle('primary', x === b));
  }));

  const state = {
    images: [], // { id, name, img, width, height, shapes: [ { type, color, strokeWidth, fillOpacity, nx, ny, nw, nh } ] }
    currentIndex: -1,
    history: [] // stack of actions for undo
  };

  let selectedShapeIndex = -1; // Currently selected shape for editing/deletion

  function pickName(prefix='image') { return `${prefix}-${Date.now()}.png`; }

  function selectImage(index) {
    if (index < 0 || index >= state.images.length) return;
    state.currentIndex = index;
    selectedShapeIndex = -1; // Clear shape selection when switching images
    const item = state.images[index];
    resizeCanvas(item.width, item.height);
    redraw();
    qsa('.thumb').forEach((el, i) => el.classList.toggle('active', i === index));
  }

  function resizeCanvas(w, h) {
    // Set canvas backing store to image size
    canvas.width = w;
    canvas.height = h;
    
    // Compute available space dynamically
    const stageRect = qs('#stage').getBoundingClientRect();
    const dropzoneWidth = dropzone.offsetWidth || 220;
    const thumbsWidth = thumbs.offsetWidth || 0;
    const gap = 24; // 12px gap × 2
    
    // Available width = stage width - dropzone - thumbs - gaps
    const availableWidth = Math.max(400, stageRect.width - dropzoneWidth - thumbsWidth - gap);
    
    // Available height = viewport height - toolbar - batch panel - stage padding - some buffer
    const toolbarHeight = qs('header.toolbar')?.offsetHeight || 60;
    const batchPanelHeight = qs('.batch-panel')?.offsetHeight || 40;
    const availableHeight = Math.max(400, window.innerHeight - toolbarHeight - batchPanelHeight - 80);
    
    // Scale to fit available space, but never upscale
    const scale = Math.min(1, availableWidth / w, availableHeight / h);
    const cssW = Math.round(w * scale);
    const cssH = Math.round(h * scale);
    
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
  }

  function drawImageBase(item) {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(item.img, 0, 0, item.width, item.height);
  }

  function drawShapes(item) {
    for (let i = 0; i < item.shapes.length; i++) {
      const s = item.shapes[i];
      const x = Math.round(s.nx * item.width);
      const y = Math.round(s.ny * item.height);
      const w = Math.round(s.nw * item.width);
      const h = Math.round(s.nh * item.height);
      
      if (s.type === 'rect-fill') {
        const [r,g,b] = hexToRgb(s.color);
        ctx.fillStyle = `rgba(${r},${g},${b},${s.fillOpacity})`;
        ctx.fillRect(x, y, w, h);
      }
      if (s.type === 'rect-stroke') {
        ctx.lineWidth = s.strokeWidth;
        ctx.strokeStyle = s.color;
        ctx.strokeRect(x + s.strokeWidth/2, y + s.strokeWidth/2, Math.max(0, w - s.strokeWidth), Math.max(0, h - s.strokeWidth));
      }
      
      // Draw selection indicator if this shape is selected
      if (i === selectedShapeIndex) {
        ctx.save();
        ctx.strokeStyle = '#0088ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
        
        // Draw resize handles
        ctx.fillStyle = '#0088ff';
        const handleSize = 8;
        // Corners
        ctx.fillRect(x - handleSize/2, y - handleSize/2, handleSize, handleSize);
        ctx.fillRect(x + w - handleSize/2, y - handleSize/2, handleSize, handleSize);
        ctx.fillRect(x - handleSize/2, y + h - handleSize/2, handleSize, handleSize);
        ctx.fillRect(x + w - handleSize/2, y + h - handleSize/2, handleSize, handleSize);
        
        ctx.restore();
      }
    }
  }

  function redraw() {
    if (state.currentIndex === -1) return;
    const item = state.images[state.currentIndex];
    drawImageBase(item);
    drawShapes(item);
  }

  function hexToRgb(hex) {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
    if (!m) return [255,0,0];
    return [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)];
  }

  function addThumb(item, index) {
    const el = document.createElement('button');
    el.className = 'thumb';
    el.title = item.name;
    const tn = document.createElement('canvas');
    const tctx = tn.getContext('2d');
    const maxW = 200, maxH = 140;
    const scale = Math.min(maxW / item.width, maxH / item.height, 1);
    tn.width = Math.max(1, Math.round(item.width * scale));
    tn.height = Math.max(1, Math.round(item.height * scale));
    tctx.drawImage(item.img, 0, 0, tn.width, tn.height);
    el.appendChild(tn);
    el.addEventListener('click', () => selectImage(index));
    thumbs.appendChild(el);
  }

  async function addImageFromDataUrl(dataUrl, name) {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const item = { id: crypto.randomUUID(), name: name || pickName('snapshot'), img, width: img.naturalWidth, height: img.naturalHeight, shapes: [] };
    state.images.push(item);
    addThumb(item, state.images.length - 1);
    if (state.currentIndex === -1) selectImage(0);
  }

  function recordAction(action) {
    state.history.push(action);
  }

  function applyShapeTo(item, shape) {
    item.shapes.push({ ...shape });
  }

  function applyShape(shape) {
    if (state.currentIndex === -1) return;
    const targets = applyToAllEl.checked ? state.images : [state.images[state.currentIndex]];
    targets.forEach(it => applyShapeTo(it, shape));
    recordAction({ kind: 'add-shape', shape, targets: applyToAllEl.checked ? 'all' : 'current', index: state.currentIndex });
    redraw();
  }

  // Update cursor based on mode
  function updateCursor() {
    if (editMode === 'create') {
      canvas.style.cursor = 'crosshair';
    } else if (editMode === 'drag') {
      canvas.style.cursor = 'default';
    }
  }

  // Pointer-driven shape creation and dragging
  let drag = null; // { mode: 'create'|'move', startX, startY, curX, curY, shapeIndex: number }
  
  updateCursor(); // Set initial cursor

  function findShapeAtPoint(x, y, item) {
    // Check from last to first (top shape first)
    for (let i = item.shapes.length - 1; i >= 0; i--) {
      const s = item.shapes[i];
      const sx = s.nx * item.width;
      const sy = s.ny * item.height;
      const sw = s.nw * item.width;
      const sh = s.nh * item.height;
      if (x >= sx && x <= sx + sw && y >= sy && y <= sy + sh) {
        return i;
      }
    }
    return -1;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (state.currentIndex === -1) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    
    const item = state.images[state.currentIndex];
    
    // Check mode or shift key for quick toggle
    const effectiveMode = e.shiftKey ? (editMode === 'create' ? 'drag' : 'create') : editMode;
    
    if (effectiveMode === 'drag') {
      const shapeIndex = findShapeAtPoint(x, y, item);
      if (shapeIndex !== -1) {
        selectedShapeIndex = shapeIndex;
        drag = { mode: 'move', startX: x, startY: y, curX: x, curY: y, shapeIndex };
        canvas.style.cursor = 'move';
        redraw();
        return;
      } else {
        selectedShapeIndex = -1;
        redraw();
      }
    } else if (effectiveMode === 'create') {
      selectedShapeIndex = -1;
      drag = { mode: 'create', startX: x, startY: y, curX: x, curY: y };
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (state.currentIndex === -1) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    
    if (!drag) {
      // Update cursor based on hover
      const item = state.images[state.currentIndex];
      const effectiveMode = e.shiftKey ? (editMode === 'create' ? 'drag' : 'create') : editMode;
      
      if (effectiveMode === 'drag') {
        const shapeIndex = findShapeAtPoint(x, y, item);
        canvas.style.cursor = shapeIndex !== -1 ? 'move' : 'default';
      } else {
        canvas.style.cursor = 'crosshair';
      }
      return;
    }
    
    drag.curX = x;
    drag.curY = y;
    redraw();
    
    const item = state.images[state.currentIndex];
    
    if (drag.mode === 'create') {
      // Draw preview of new shape
      const px = Math.min(drag.startX, drag.curX);
      const py = Math.min(drag.startY, drag.curY);
      const pw = Math.abs(drag.startX - drag.curX);
      const ph = Math.abs(drag.startY - drag.curY);
      const color = colorEl.value;
      const strokeWidth = Number(strokeWidthEl.value);
      const fillOpacity = Number(fillOpacityEl.value);
      
      if (tool === 'rect-fill') {
        const [r,g,b] = hexToRgb(color);
        ctx.fillStyle = `rgba(${r},${g},${b},${fillOpacity})`;
        ctx.fillRect(px, py, pw, ph);
      } else {
        ctx.lineWidth = strokeWidth;
        ctx.strokeStyle = color;
        ctx.strokeRect(px + strokeWidth/2, py + strokeWidth/2, Math.max(0, pw - strokeWidth), Math.max(0, ph - strokeWidth));
      }
    } else if (drag.mode === 'move') {
      // Draw preview of moved shape
      const shape = item.shapes[drag.shapeIndex];
      const dx = drag.curX - drag.startX;
      const dy = drag.curY - drag.startY;
      const sx = shape.nx * item.width + dx;
      const sy = shape.ny * item.height + dy;
      const sw = shape.nw * item.width;
      const sh = shape.nh * item.height;
      
      if (shape.type === 'rect-fill') {
        const [r,g,b] = hexToRgb(shape.color);
        ctx.fillStyle = `rgba(${r},${g},${b},${shape.fillOpacity})`;
        ctx.fillRect(sx, sy, sw, sh);
      } else {
        ctx.lineWidth = shape.strokeWidth;
        ctx.strokeStyle = shape.color;
        ctx.strokeRect(sx + shape.strokeWidth/2, sy + shape.strokeWidth/2, Math.max(0, sw - shape.strokeWidth), Math.max(0, sh - shape.strokeWidth));
      }
      
      // Draw dashed outline to show it's being moved
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = '#0088ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.setLineDash([]);
    }
  });

  canvas.addEventListener('pointerup', () => {
    if (!drag || state.currentIndex === -1) return;
    const item = state.images[state.currentIndex];
    
    if (drag.mode === 'create') {
      const x = Math.min(drag.startX, drag.curX);
      const y = Math.min(drag.startY, drag.curY);
      const w = Math.abs(drag.startX - drag.curX);
      const h = Math.abs(drag.startY - drag.curY);
      
      if (w >= 2 && h >= 2) {
        const shape = {
          type: tool,
          color: colorEl.value,
          strokeWidth: Number(strokeWidthEl.value),
          fillOpacity: Number(fillOpacityEl.value),
          nx: clamp(x / item.width, 0, 1),
          ny: clamp(y / item.height, 0, 1),
          nw: clamp(w / item.width, 0, 1),
          nh: clamp(h / item.height, 0, 1)
        };
        applyShape(shape);
      }
    } else if (drag.mode === 'move') {
      const dx = drag.curX - drag.startX;
      const dy = drag.curY - drag.startY;
      const shape = item.shapes[drag.shapeIndex];
      
      // Update shape position
      shape.nx = clamp(shape.nx + dx / item.width, 0, 1);
      shape.ny = clamp(shape.ny + dy / item.height, 0, 1);
      
      recordAction({ kind: 'move-shape', shapeIndex: drag.shapeIndex, dx, dy });
    }
    
    drag = null;
    updateCursor();
    redraw();
  });

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  // Delete selected shape
  qs('#deleteShape').addEventListener('click', () => {
    if (state.currentIndex === -1 || selectedShapeIndex === -1) return;
    const item = state.images[state.currentIndex];
    if (selectedShapeIndex >= 0 && selectedShapeIndex < item.shapes.length) {
      const deletedShape = item.shapes.splice(selectedShapeIndex, 1)[0];
      recordAction({ kind: 'delete-shape', shapeIndex: selectedShapeIndex, shape: deletedShape });
      selectedShapeIndex = -1;
      redraw();
    }
  });

  // Update undo to handle delete actions
  qs('#undo').addEventListener('click', () => {
    if (state.history.length === 0) return;
    const last = state.history.pop();
    if (last.kind === 'add-shape') {
      if (last.targets === 'all') {
        state.images.forEach(it => it.shapes.pop());
      } else {
        state.images[last.index].shapes.pop();
      }
      redraw();
    } else if (last.kind === 'delete-shape') {
      // Restore deleted shape
      state.images[state.currentIndex].shapes.splice(last.shapeIndex, 0, last.shape);
      redraw();
    } else if (last.kind === 'move-shape') {
      // Undo move
      const shape = state.images[state.currentIndex].shapes[last.shapeIndex];
      shape.nx -= last.dx / state.images[state.currentIndex].width;
      shape.ny -= last.dy / state.images[state.currentIndex].height;
      redraw();
    }
  });

  // Undo and clear
  qs('#undo').addEventListener('click', () => {
    if (state.history.length === 0) return;
    const last = state.history.pop();
    if (last.kind === 'add-shape') {
      if (last.targets === 'all') {
        state.images.forEach(it => it.shapes.pop());
      } else {
        state.images[last.index].shapes.pop();
      }
      redraw();
    }
  });

  qs('#clear').addEventListener('click', () => {
    if (state.currentIndex === -1) return;
    state.images[state.currentIndex].shapes = [];
    redraw();
  });

  // Save
  qs('#saveOne').addEventListener('click', () => saveCurrent());
  qs('#saveAll').addEventListener('click', () => saveAll());

  async function saveCurrent() {
    if (state.currentIndex === -1) return;
    const item = state.images[state.currentIndex];
    drawImageBase(item); drawShapes(item);
    const name = item.name || pickName('annotated');
    const url = canvas.toDataURL('image/png');
    download(url, name);
  }

  async function saveAll() {
    if (state.images.length === 0) return;
    const prevIndex = state.currentIndex;
    for (let i = 0; i < state.images.length; i++) {
      const item = state.images[i];
      resizeCanvas(item.width, item.height);
      drawImageBase(item);
      drawShapes(item);
      const url = canvas.toDataURL('image/png');
      download(url, item.name || pickName('annotated'));
    }
    if (prevIndex !== -1) {
      const prevItem = state.images[prevIndex];
      resizeCanvas(prevItem.width, prevItem.height);
      state.currentIndex = prevIndex;
      redraw();
    }
  }

  function download(dataUrl, filename) {
    if (chrome && chrome.downloads && chrome.downloads.download) {
      fetch(dataUrl).then(r => r.blob()).then(blob => {
        const url = URL.createObjectURL(blob);
        chrome.downloads.download({ url, filename });
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      });
    } else {
      const a = document.createElement('a');
      a.href = dataUrl; a.download = filename; a.click();
    }
  }

  // Batch by coordinates (normalized)
  qs('#batchAdd').addEventListener('click', () => {
    const nx = Number(qs('#bx').value); const ny = Number(qs('#by').value);
    const nw = Number(qs('#bw').value); const nh = Number(qs('#bh').value);
    const type = qs('#btype').value;
    const shape = {
      type,
      color: colorEl.value,
      strokeWidth: Number(strokeWidthEl.value),
      fillOpacity: Number(fillOpacityEl.value),
      nx: clamp(nx,0,1), ny: clamp(ny,0,1), nw: clamp(nw,0,1), nh: clamp(nh,0,1)
    };
    state.images.forEach(it => applyShapeTo(it, shape));
    recordAction({ kind: 'add-shape', shape, targets: 'all', index: state.currentIndex });
    redraw();
  });

  qs('#batchPresetExport').addEventListener('click', () => {
    const actions = state.images[state.currentIndex]?.shapes || [];
    const blob = new Blob([JSON.stringify(actions, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'actions.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  qs('#batchPresetImport').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const txt = await file.text();
    let shapes = [];
    try { shapes = JSON.parse(txt); } catch { alert('Invalid JSON'); return; }
    if (!Array.isArray(shapes)) { alert('JSON must be an array of shapes'); return; }
    // Validate fields lightly
    shapes = shapes.filter(s => ['rect-stroke','rect-fill'].includes(s.type) && typeof s.nx === 'number');
    state.images.forEach(it => it.shapes.push(...shapes));
    redraw();
  });

  // Drag-and-drop and paste support
  function isImageFile(f) { return /image\/(png|jpeg|webp)/i.test(f.type) || /\.(png|jpg|jpeg|webp)$/i.test(f.name); }

  ;['dragenter','dragover'].forEach(evt => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('over'); }));
  ;['dragleave','drop'].forEach(evt => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('over'); }));
  dropzone.addEventListener('drop', async (e) => {
    const files = Array.from(e.dataTransfer.files).filter(isImageFile);
    for (const f of files) {
      const url = URL.createObjectURL(f);
      await addImageFromDataUrl(url, f.name.replace(/\s+/g,'_'));
      URL.revokeObjectURL(url);
    }
  });

  window.addEventListener('paste', async (e) => {
    const items = Array.from(e.clipboardData.items);
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        const blob = it.getAsFile();
        const url = URL.createObjectURL(blob);
        await addImageFromDataUrl(url, pickName('pasted'));
        URL.revokeObjectURL(url);
      }
    }
  });

  // Load latest full-page capture from storage and stitch here.
  async function loadLatestCapture() {
    const { latestCapture } = await chrome.storage.local.get('latestCapture');
    if (!latestCapture) return;
    const { metrics, segments, tabTitle } = latestCapture;
    const stitched = await stitchSegments(segments, metrics);
    const filename = tabTitle 
      ? `${tabTitle.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}-${Date.now()}.png`
      : `fullpage-${new Date(latestCapture.createdAt).toISOString().slice(0,19).replace(/[:T]/g,'-')}.png`;
    await addImageFromDataUrl(stitched, filename);
  }

  async function loadBatchCaptures() {
    const { batchCaptures } = await chrome.storage.local.get('batchCaptures');
    if (!batchCaptures || batchCaptures.length === 0) return;
    
    for (const capture of batchCaptures) {
      const { metrics, segments, tabTitle } = capture;
      const stitched = await stitchSegments(segments, metrics);
      const filename = tabTitle 
        ? `${tabTitle.replace(/[^a-z0-9]/gi, '_').substring(0, 50)}-${Date.now()}.png`
        : `capture-${new Date(capture.createdAt).toISOString().slice(0,19).replace(/[:T]/g,'-')}.png`;
      await addImageFromDataUrl(stitched, filename);
    }
    
    // Clear batch captures after loading
    await chrome.storage.local.remove('batchCaptures');
  }

  async function stitchSegments(segments, metrics) {
    const { totalWidth, totalHeight, viewportHeight, devicePixelRatio } = metrics;
    // Create a canvas at 1:1 CSS pixels, then draw captures scaled down from device pixels.
    const cnv = document.createElement('canvas');
    cnv.width = totalWidth; 
    cnv.height = totalHeight;
    const cctx = cnv.getContext('2d');

    for (const seg of segments) {
      const img = await loadImage(seg.dataUrl);
      // img dimensions are in device pixels; scale to CSS pixels.
      const scale = 1 / devicePixelRatio;
      const drawY = Math.round(seg.y);
      cctx.drawImage(img, 0, 0, img.width, img.height, 0, drawY, Math.round(img.width * scale), Math.round(img.height * scale));
    }
    return cnv.toDataURL('image/png');
  }

  function loadImage(src) { 
    return new Promise((res, rej) => { 
      const i = new Image(); 
      i.onload = () => res(i); 
      i.onerror = rej; 
      i.src = src; 
    }); 
  }

  // Initialize
  (async function init(){
    // Check URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    
    // Check for errors first
    if (urlParams.get('error') === 'true') {
      const { captureErrors } = await chrome.storage.local.get('captureErrors');
      if (captureErrors && captureErrors.length > 0) {
        // Show error message in dropzone
        dropzone.innerHTML = `
          <div style="padding: 20px;">
            <h3 style="color: #ff5252; margin-bottom: 10px;">⚠️ Capture Failed</h3>
            <p style="color: #ff8a80; margin-bottom: 15px;">Some pages could not be captured. This might happen with:</p>
            <ul style="text-align: left; color: #ff8a80;">
              <li>Browser internal pages (chrome://, edge://, about:)</li>
              <li>Extension pages</li>
              <li>Pages with strict security policies</li>
            </ul>
            <p style="margin-top: 15px; color: var(--text);">You can still:</p>
            <ul style="text-align: left; margin-bottom: 15px;">
              <li>Drop images here to annotate</li>
              <li>Paste screenshots from clipboard</li>
              <li>Try capturing other pages</li>
            </ul>
          </div>
        `;
        // Clear the errors
        await chrome.storage.local.remove('captureErrors');
      }
    } else if (urlParams.get('batch') === 'true') {
      // Load batch captures
      try {
        await loadBatchCaptures();
        // Show success message if captures loaded
        if (state.images.length > 0) {
          dropzone.innerHTML += `
            <p style="color: #4CAF50; margin-top: 10px;">
              ✓ Successfully loaded ${state.images.length} captures
            </p>
          `;
        }
      } catch (e) {
        console.error('Failed to load batch captures:', e);
        dropzone.innerHTML += `
          <p style="color: #ff5252; margin-top: 10px;">
            ⚠️ Error loading batch captures. You can still drop images here.
          </p>
        `;
      }
    } else {
      // Load single capture
      try {
        await loadLatestCapture();
        // Check if it was a fallback capture
        const { latestCapture } = await chrome.storage.local.get('latestCapture');
        if (latestCapture?.isFallback) {
          dropzone.innerHTML += `
            <p style="color: #FFA726; margin-top: 10px; font-size: 12px;">
              ⚠️ Note: Only visible viewport was captured. Full page scrolling may have been blocked.
            </p>
          `;
        }
      } catch (e) {
        console.error('Failed to load latest capture:', e);
        // Don't show error for normal case where there's no capture
      }
    }
  })();

  // Handle window resize to keep canvas properly scaled
  let resizeTimeout;
  window.addEventListener('resize', () => {
    // Debounce resize events
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (state.currentIndex !== -1) {
        const item = state.images[state.currentIndex];
        resizeCanvas(item.width, item.height);
        redraw();
      }
    }, 150);
  });
})(); 