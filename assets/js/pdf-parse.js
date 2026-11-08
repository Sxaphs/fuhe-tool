/* 共享成绩单解析（纯本地，不出浏览器）—— 供匹配工具与 AI 助手共用
 * PDF 有文字层 → pdf.js 直接提取；PDF 为图片型（微信截图导出等）→ 渲染页面后 OCR；图片 → OCR；CSV/TXT → 切分
 */
(function () {
  'use strict';

  const VENDOR = 'assets/vendor/tesseract/';

  const BLOCK_WORDS = /transcript|成绩单|university|universit|semester|gpa|grade point|credit|unit|year\s*20|term\b|course code|page\s*\d|issued|official|dean|registrar|student|total|average|毕业|姓名|学号|学期|平均|学分绩|成绩单|课程编号|共\s*\d|页\s*\d/i;

  function extractCoursesFromPdfLines(rawLines) {
    const out = [];
    const seen = new Set();
    for (let raw of rawLines) {
      let t = String(raw || '').trim();
      if (!t) continue;
      t = t.replace(/^[A-Z]{2,6}\s*\d{2,4}[A-Z]?\s*/, ''); // 行首课程代码 CS101
      t = t.replace(/[\s,;，]+(A\+?|A-|B\+?|B-|C\+?|C-|D\+?|D-|F|P|HD|DI|CR|PS|FL|Pass|Merit|Distinction|Fail|EX|W|S)\s*$/i, '');
      t = t.replace(/[\s,;，]+\d{1,3}(\.\d{1,2})?\s*$/, '');
      t = t.replace(/[\s,;，]+\d{1,2}\s*学分\s*$/u, '');
      t = t.trim();
      if (t.length < 3 || t.length > 80) continue;
      if (BLOCK_WORDS.test(t)) continue;
      if (!/^[A-Za-z\u4e00-\u9fa5]/.test(t)) continue;
      if (!seen.has(t)) { seen.add(t); out.push(t); }
    }
    return out;
  }

  /* ---------- Tesseract OCR（按需加载，WASM 本地识别） ---------- */
  let tessPromise = null;
  function loadTesseract() {
    if (tessPromise) return tessPromise;
    tessPromise = new Promise((resolve, reject) => {
      if (window.Tesseract) { resolve(window.Tesseract); return; }
      const s = document.createElement('script');
      s.src = VENDOR + 'tesseract.min.js';
      s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR 组件未就绪')));
      s.onerror = () => reject(new Error('OCR 组件加载失败，请刷新后重试'));
      document.head.appendChild(s);
    });
    return tessPromise;
  }

  async function createWorker() {
    const T = await loadTesseract();
    return T.createWorker('chi_sim+eng', 1, {
      workerPath: VENDOR + 'worker.min.js',
      // OEM=1(LSTM_ONLY) 时浏览器 worker 直接加载 corePath 指向的文件，
      // 必须用 LSTM 版本，否则核心函数缺失（v5 worker 不会自动替换）
      corePath: VENDOR + 'tesseract-core-simd-lstm.wasm.js',
      langPath: VENDOR + 'lang'
    });
  }

  async function ocrCanvases(canvases) {
    const worker = await createWorker();
    try {
      const lines = [];
      for (const c of canvases) {
        const { data } = await worker.recognize(c);
        lines.push(...String(data.text || '').split('\n'));
      }
      return lines.map((s) => s.trim()).filter(Boolean);
    } finally {
      try { await worker.terminate(); } catch (e) { /* ignore */ }
    }
  }

  async function imageToCanvas(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('图片读取失败'));
        i.src = url;
      });
      const maxDim = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = Math.max(1, Math.min(3, 1600 / maxDim));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.filter = 'grayscale(1) contrast(1.5)';
      ctx.drawImage(img, 0, 0, w, h);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function parseImageViaOcr(file) {
    const canvas = await imageToCanvas(file);
    const lines = await ocrCanvases([canvas]);
    const courses = extractCoursesFromPdfLines(lines);
    if (!courses.length) throw new Error('图片中未识别出课程行——请确认截图清晰、包含课程名称列表（纯表格截图效果最佳）');
    return courses;
  }

  /* ---------- PDF ---------- */
  async function parseCourseListFromPdf(file) {
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('PDF 组件未加载，请刷新页面重试');
    lib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
    const buf = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;

    // 1) 先尝试直接提取文字层
    const lines = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        const s = String(it.str || '').trim();
        if (s) lines.push(s);
      }
    }
    let courses = extractCoursesFromPdfLines(lines);

    // 2) 无文字层（微信截图导出/扫描件）→ 渲染每页为图片再 OCR
    if (!courses.length) {
      const canvases = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const vp1 = page.getViewport({ scale: 1 });
        const maxDim = Math.max(vp1.width, vp1.height);
        const scale = Math.max(2, Math.min(4, 2400 / maxDim));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        canvases.push(canvas);
      }
      const ocrLines = await ocrCanvases(canvases);
      courses = extractCoursesFromPdfLines(ocrLines);
      if (!courses.length) throw new Error('该 PDF 无文字层，OCR 也未识别出课程行——请上传更清晰的截图，或手动粘贴课程');
    }
    return courses;
  }

  /* ---------- CSV/TXT ---------- */
  function parseCsvText(text) {
    return String(text || '').split(/[\n,，;；、\t\r]+/).map((s) => s.trim()).filter(Boolean);
  }

  /* ---------- 统一入口：按文件类型分发 ---------- */
  async function parseTranscript(file) {
    const name = String(file.name || '').toLowerCase();
    const type = String(file.type || '');
    if (name.endsWith('.pdf') || type === 'application/pdf') return parseCourseListFromPdf(file);
    if (/\.(png|jpe?g|webp|bmp|gif|heic|heif)$/.test(name) || type.startsWith('image/')) return parseImageViaOcr(file);
    return parseCsvText(await file.text());
  }

  window.FuhePdf = { parseCourseListFromPdf, parseCsvText, parseImageViaOcr, parseTranscript };
})();
