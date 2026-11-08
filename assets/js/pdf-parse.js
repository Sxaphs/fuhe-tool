/* 共享成绩单解析（纯本地，不出浏览器）—— 供匹配工具与 AI 助手共用
 * PDF 有文字层 → pdf.js 直接提取；图片型 PDF/图片 → 本地 OCR（德语+英语+中文）；
 * 可选「AI 视觉识别」：用用户自己的视觉模型 Key 直连识别（更准）。
 */
(function () {
  'use strict';

  const VENDOR = 'assets/vendor/tesseract/';
  const AI_CONFIG_KEY = 'fuhe-ai-config';

  const BLOCK_WORDS = /transcript|成绩单|university|universit|semester|gpa|grade point|credit|unit|year\s*20|term\b|course code|page\s*\d|issued|official|dean|registrar|student|total|average|毕业|姓名|学号|学期|平均|学分绩|成绩单|课程编号|共\s*\d|页\s*\d/i;

  function extractCoursesFromPdfLines(rawLines) {
    const out = [];
    const seen = new Set();
    for (let raw of rawLines) {
      let t = String(raw || '').trim();
      if (!t) continue;
      t = t.replace(/^[A-Z]{2,6}\s*\d{2,4}[A-Z]?\s*/, '');
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

  /* ---------- 图像工具 ---------- */
  function loadImage(file) {
    const url = URL.createObjectURL(file);
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('图片读取失败'));
      i.src = url;
    }).finally(() => URL.revokeObjectURL(url));
  }

  function drawToCanvas(img, maxDim, grayscale) {
    const d = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = Math.max(1, Math.min(4, maxDim / d));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (grayscale) ctx.filter = 'grayscale(1) contrast(1.5)';
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
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
    return T.createWorker('deu+eng+chi_sim', 1, {
      workerPath: VENDOR + 'worker.min.js',
      // OEM=1(LSTM_ONLY) 时浏览器 worker 直接加载 corePath 指定文件，必须用 -lstm 版本
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

  async function parseImageViaOcr(file) {
    const img = await loadImage(file);
    const canvas = drawToCanvas(img, 1600, true);
    const lines = await ocrCanvases([canvas]);
    const courses = extractCoursesFromPdfLines(lines);
    if (!courses.length) throw new Error('图片中未识别出课程行——请确认截图清晰、包含课程名称列表，或改用「AI 识别」');
    return courses;
  }

  /* ---------- PDF ---------- */
  async function loadPdf(file) {
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('PDF 组件未加载，请刷新页面重试');
    lib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
    const buf = await file.arrayBuffer();
    return lib.getDocument({ data: new Uint8Array(buf) }).promise;
  }

  async function renderPdfPagesToCanvases(pdf, maxDim) {
    const canvases = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const d = Math.max(vp1.width, vp1.height);
      const scale = Math.max(2, Math.min(4, maxDim / d));
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
    return canvases;
  }

  async function parseCourseListFromPdf(file) {
    const pdf = await loadPdf(file);
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
    if (!courses.length) {
      const canvases = await renderPdfPagesToCanvases(pdf, 2400);
      const ocrLines = await ocrCanvases(canvases);
      courses = extractCoursesFromPdfLines(ocrLines);
      if (!courses.length) throw new Error('该 PDF 无文字层，OCR 也未识别出课程行——请上传更清晰的截图，或点「AI 识别」');
    }
    return courses;
  }

  /* ---------- AI 视觉识别（用户自带视觉模型 Key，直连） ---------- */
  function getAiConfig() {
    try { return JSON.parse(localStorage.getItem(AI_CONFIG_KEY)) || {}; } catch (e) { return {}; }
  }

  async function parseViaVisionApi(file) {
    const cfg = getAiConfig();
    if (!cfg.base || !cfg.apiKey) throw new Error('未配置 API Key——请先到「AI 助手」页填写并保存');
    if (!cfg.visionModel) throw new Error('未配置视觉模型——DeepSeek 暂无视觉模型，请用 Moonshot（moonshot-v1-8k-vision-preview）或 OpenRouter（如 qwen/qwen2.5-vl-72b-instruct）');

    const name = String(file.name || '').toLowerCase();
    const canvases = name.endsWith('.pdf') || file.type === 'application/pdf'
      ? await renderPdfPagesToCanvases(await loadPdf(file), 1600)
      : [drawToCanvas(await loadImage(file), 1600, false)];

    const content = [{
      type: 'text',
      text: '这是国外成绩单的截图。请提取其中的课程列表：只输出课程名（英文原文），每行一门；忽略课程代码、学分、成绩、表头和无关文字。只输出课程名列表，不要任何解释或编号。'
    }];
    for (const c of canvases) {
      content.push({ type: 'image_url', image_url: { url: c.toDataURL('image/jpeg', 0.85) } });
    }

    const res = await fetch(cfg.base.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({ model: cfg.visionModel, messages: [{ role: 'user', content }], temperature: 0.1, max_tokens: 3000 })
    });
    if (!res.ok) {
      let detail = '';
      try { detail = JSON.stringify((await res.json()).error).slice(0, 200); } catch (e) { /* ignore */ }
      if (res.status === 401) throw new Error('401：API Key 无效');
      if (res.status === 400) throw new Error('400：该服务商可能不支持视觉模型或图片格式 ' + detail);
      throw new Error('HTTP ' + res.status + ' ' + detail);
    }
    const j = await res.json();
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    const courses = extractCoursesFromPdfLines(String(text).split('\n'));
    if (!courses.length) throw new Error('AI 返回内容中未解析出课程行');
    return courses;
  }

  /* ---------- CSV/TXT ---------- */
  function parseCsvText(text) {
    return String(text || '').split(/[\n,，;；、\t\r]+/).map((s) => s.trim()).filter(Boolean);
  }

  /* ---------- 统一入口 ---------- */
  async function parseTranscript(file) {
    const name = String(file.name || '').toLowerCase();
    const type = String(file.type || '');
    if (name.endsWith('.pdf') || type === 'application/pdf') return parseCourseListFromPdf(file);
    if (/\.(png|jpe?g|webp|bmp|gif|heic|heif)$/.test(name) || type.startsWith('image/')) return parseImageViaOcr(file);
    return parseCsvText(await file.text());
  }

  window.FuhePdf = { parseCourseListFromPdf, parseCsvText, parseImageViaOcr, parseViaVisionApi, parseTranscript };
})();
