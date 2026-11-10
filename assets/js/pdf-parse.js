/* 共享成绩单解析（纯本地，不出浏览器）—— 供匹配工具与 AI 助手共用
 * PDF 有文字层 → pdf.js 直接提取；图片型 PDF/图片 → 本地 OCR（德语+英语+中文）；
 * 可选「AI 视觉识别」：用用户自己的视觉模型 Key 直连识别（更准）。
 */
(function () {
  'use strict';

  const VENDOR = 'assets/vendor/tesseract/';
  const AI_CONFIG_KEY = 'fuhe-ai-config';
  let lastRawText = ''; // 最近一次解析的原始文本（供学历层次识别等使用）

  const BLOCK_WORDS = /masterarbeit|thesis|dissertation|kernbereich|wahlpflicht|pflichtbereich|erg[aä]nzungsbereich|core\s+area|core\s+\w{2,12}\s+(area|economics|business)|complementary\s+area|additive\s+key\s+qualifications|\bspecialisation\b|\bseminars?\b|seminar\s+topics|compulsory|elective|\bmodule\b|\bmodul\b|semester|\bnote\b|\bgrade\b|\blp\b|\bcp\b|\bcredit|born|geboren|\bprof\b|\bdr\b|universit|examination|prufung|prüfung|zeugnis|transcript|成绩单|论文|总学分|平均|page\s*\d|出生|毕业|姓名|学号/i;

  const TRAIL = /[\s,;，]+(?:\d{1,2}(?:[.,]\d{1,2})?|Pass|Merit|Distinction|Fail|HD|DI|CR|PS|FL|EX|PP|GPA\s*\d[\d.]*|学分|LP|CP|ECTS)\s*$/gi;

  function extractCoursesFromPdfLines(rawLines) {
    const hasPipe = rawLines.filter((l) => String(l || '').includes('|')).length >= 3;
    const out = [];
    const seen = new Set();
    for (let i = 0; i < rawLines.length; i++) {
      let t = String(rawLines[i] || '').trim();
      if (!t) continue;
      const parts = t.split('|');
      const isPipe = parts.length > 1;
      if (isPipe) {
        t = parts[parts.length - 1].trim(); // 表格型成绩单：课程名列在最后一栏
      } else if (hasPipe) {
        continue; // 表格型文档中，无 | 的行（人名/标题/说明）跳过
      } else if (!/\d/.test(t)) {
        continue; // 无分栏且不含数字的行（标题/人名）跳过
      }
      if (BLOCK_WORDS.test(t)) continue;
      t = t.replace(/^[A-Z]{2,6}\s*\d{2,4}[A-Z]?\s*/, '');
      for (let k = 0; k < 5; k++) {
        t = t.replace(/[\s:：,，;；<>]+$/, '');
        t = t.replace(/[\s,;，]*<+\s*\d{1,2}(?:[.,]\d{1,2})?\s*$/, '');
        t = t.replace(/\s+[a-z]\s*$/i, '');
        t = t.replace(TRAIL, '');
      }
      // 课程名跨行：以 & 结尾则并入下一行
      if (t.endsWith('&') && i + 1 < rawLines.length) {
        i++;
        t = t.slice(0, -1).trim() + ' ' + String(rawLines[i] || '').trim();
      }
      t = t.replace(/^[_\-–—\s]+|[_\-–—\s]+$/g, '').trim();
      if (t.length < 3 || t.length > 60) continue;
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
      const cleaned = lines.map((s) => s.trim()).filter(Boolean);
      lastRawText = cleaned.join('\n');
      return cleaned;
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
    lastRawText = lines.join('\n');
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
      text: '这是国外成绩单的截图。请先判断学历层次：第一行只输出「本科」「硕士」「博士」或「未知」四者之一（硕士项目常出现 Master/MSc/Magister，本科项目常出现 Bachelor/BSc）。'
        + '从第二行开始，只输出【课程列表】：每行一门课程的英文课程名。'
        + '必须排除：姓名、出生日期、论文题目（如 Master Thesis）、分类标题（如 Core Area/Compulsory/Elective）、学校与学位信息、分数、学分、表头。'
        + '课程名通常带课程代码、分数或学分，请去掉这些，只保留课程名本身。不要编号、解释或 markdown。'
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
    lastRawText = text;
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
    const text = await file.text();
    lastRawText = text;
    return parseCsvText(text);
  }

  /* 解析并返回课程 + 原始文本（供学历层次识别） */
  async function parseTranscriptDetailed(file) {
    const courses = await parseTranscript(file);
    return { courses, raw: lastRawText };
  }

  window.FuhePdf = { parseCourseListFromPdf, parseCsvText, parseImageViaOcr, parseViaVisionApi, parseTranscript, parseTranscriptDetailed, getLastRawText: () => lastRawText };
})();
