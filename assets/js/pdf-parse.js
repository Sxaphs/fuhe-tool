/* 共享成绩单解析（纯本地，不出浏览器）—— 供匹配工具与 AI 助手共用
 * PDF → pdf.js 文本提取；图片（手机截图）→ Tesseract.js OCR（中英识别）；CSV/TXT → 文本切分
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

  /* ---------- PDF（pdf.js 本地解析） ---------- */
  async function parseCourseListFromPdf(file) {
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('PDF 组件未加载，请刷新页面重试');
    lib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
    const buf = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
    const lines = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        const s = String(it.str || '').trim();
        if (s) lines.push(s);
      }
    }
    const courses = extractCoursesFromPdfLines(lines);
    if (!courses.length) throw new Error('未提取到课程行——可能是不带文字层的扫描件，请改用截图上传（会走 OCR 识别）');
    return courses;
  }

  /* ---------- CSV/TXT ---------- */
  function parseCsvText(text) {
    return String(text || '').split(/[\n,，;；、\t\r]+/).map((s) => s.trim()).filter(Boolean);
  }

  /* ---------- 图片 OCR（Tesseract.js，WASM 本地识别，按需加载） ---------- */
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
    const T = await loadTesseract();
    const worker = await T.createWorker('chi_sim+eng', 1, {
      workerPath: VENDOR + 'worker.min.js',
      corePath: VENDOR + 'tesseract-core-simd.wasm.js',
      langPath: VENDOR + 'lang'
    });
    try {
      const canvas = await imageToCanvas(file);
      const { data } = await worker.recognize(canvas);
      const lines = String(data.text || '').split('\n').map((s) => s.trim()).filter(Boolean);
      const courses = extractCoursesFromPdfLines(lines);
      if (!courses.length) throw new Error('图片中未识别出课程行——请确认截图清晰、包含课程名称列表（纯表格截图效果最佳）');
      return courses;
    } finally {
      try { await worker.terminate(); } catch (e) { /* ignore */ }
    }
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
