/* 共享 PDF/CSV 课程解析（纯本地，不出浏览器）—— 供匹配工具与 AI 助手共用 */
(function () {
  'use strict';

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
    if (!courses.length) throw new Error('未提取到课程行——可能是不带文字层的扫描件，请先 OCR 或手动粘贴');
    return courses;
  }

  function parseCsvText(text) {
    return String(text || '').split(/[\n,，;；、\t\r]+/).map((s) => s.trim()).filter(Boolean);
  }

  window.FuhePdf = { parseCourseListFromPdf, parseCsvText };
})();
