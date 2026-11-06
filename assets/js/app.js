/* fuhe-tool 匹配逻辑：纯前端，数据本地处理 */
(function () {
  'use strict';

  const DATA_URL = 'data/majors.seed.json';

  const SAMPLE = [
    'Data Structures and Algorithms',
    'Operating Systems',
    'Computer Networks',
    'Database Systems',
    'Software Engineering',
    'Computer Architecture',
    'Discrete Mathematics',
    'Linear Algebra'
  ].join('\n');

  const $ = (id) => document.getElementById(id);

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  }

  /* 从自由文本解析课程名：按行/逗号/顿号/分号切分，去掉行首课程代码 */
  function parseCourses(text) {
    const parts = String(text || '').split(/[\n,，;；、\t\r]+/);
    const out = [];
    const seen = new Set();
    for (let raw of parts) {
      let t = raw.trim();
      if (!t) continue;
      // 去掉行首类似 "CS101 :" 的课程代码
      t = t.replace(/^[A-Za-z]{1,6}\s*\d{2,5}\s*[:：.-]?\s*/, '').trim();
      // 去掉尾部学分/成绩
      t = t.replace(/[（(]?\s*\d+(\.\d+)?\s*学分\s*[)）]?$/u, '').trim();
      t = t.replace(/[（(]\s*(A\+?|A-|B\+?|B-|C\+?|C-|D|F|P|HD|DI|CR|PS|FL|Distinction|Merit|Pass|Fail|GPA\s*\d[\d.]*)\s*[)）]?$/iu, '').trim();
      if (t.length >= 2 && !seen.has(t)) { seen.add(t); out.push(t); }
    }
    return out;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function matchAll(courses, data) {
    const ncourses = courses.map(normalize);
    const results = [];
    for (const cat of (data.categories || [])) {
      for (const m of (cat.majors || [])) {
        // coreCourses 支持两种写法：纯字符串数组（旧版）或 {zh, en[]} 对象数组
        const entries = (m.coreCourses || []).map((c) => (typeof c === 'string' ? { zh: c, en: [] } : c));
        const aliases = (m.aliases || []).map(normalize).filter(Boolean);
        const matched = [];
        let aliasHits = 0;
        for (const c of ncourses) {
          for (const e of entries) {
            const zh = normalize(e.zh);
            const zhHit = !!zh && (c === zh || c.includes(zh) || zh.includes(c));
            const enHit = (e.en || []).some((k) => {
              const nk = normalize(k);
              if (!nk) return false;
              // 短关键词只允许全等匹配，避免 "os" 误命中 "courses"
              if (nk.length <= 3) return c === nk;
              return c === nk || c.includes(nk) || nk.includes(c);
            });
            if (zhHit || enHit) matched.push(e.zh);
          }
          for (const a of aliases) {
            if (a && (c === a || (a.length > 3 && (c.includes(a) || a.includes(c))))) aliasHits++;
          }
        }
        const uniq = [...new Set(matched)];
        const coverage = entries.length ? uniq.length / entries.length : 0;
        const score = Math.round(coverage * 100) + Math.min(aliasHits, 3) * 10;
        if (coverage > 0 || aliasHits > 0) {
          results.push({
            cat: cat.category,
            name: m.name,
            aliases: m.aliases || [],
            core: entries.map((e) => e.zh),
            matched: uniq,
            missing: entries.map((e) => e.zh).filter((zh) => !uniq.includes(zh)),
            coverage: Math.round(coverage * 100),
            aliasHits,
            score
          });
        }
      }
    }
    results.sort((a, b) => b.score - a.score || b.coverage - a.coverage);
    return results;
  }

  function render(results, courses) {
    const box = $('results');
    if (!results.length) {
      box.innerHTML = '<div class="card"><h2>没有匹配结果</h2><p class="muted">你的课程与当前种子数据中的专业核心课程重合度太低。建议：① 补充更多专业课程名（尤其是高年级专业课）；② 在 <a href="https://github.com/Sxaphs/fuhe-tool" target="_blank" rel="noopener">GitHub</a> 提交 PR 补充你的专业数据；③ 直接查看 <a href="sop.html">SOP</a> 了解人工路径。</p></div>';
      return;
    }
    let html = '<div class="card"><h2>匹配结果（' + results.length + ' 个候选专业）</h2><p class="muted small">按课程重合度排序，点击上方 GitHub 链接可完善数据。</p></div>';
    for (const r of results.slice(0, 12)) {
      html += '<div class="card result-card">'
        + '<div class="cover"><div><span class="badge">' + esc(r.cat) + '</span><strong style="font-size:1.1rem;">' + esc(r.name) + '</strong>'
        + (r.aliases.length ? '<span class="muted small">　常见国外名：' + esc(r.aliases.join(' / ')) + '</span>' : '')
        + '</div><div class="bar-wrap"><span class="small muted">重合度</span><div class="bar"><i style="width:' + Math.min(r.coverage, 100) + '%"></i></div><strong>' + r.coverage + '%</strong></div><span class="flex"><a class="small" href="catalog.html?q=' + encodeURIComponent(r.name) + '">考公目录核对 →</a><a class="small" href="plan.html?major=' + encodeURIComponent(r.name) + '">查培养方案 →</a></span></div>'
        + '<div class="mt"><span class="muted small">匹配到的核心课程：</span>'
        + (r.matched.length ? r.matched.map((m) => '<span class="chip hit">' + esc(m) + '</span>').join('') : '<span class="chip miss">无直接匹配</span>')
        + '</div>'
        + (r.missing.length ? '<div class="mt"><span class="muted small">未匹配（可作为补课/补材料的参考）：</span>' + r.missing.slice(0, 8).map((m) => '<span class="chip miss">' + esc(m) + '</span>').join('') + '</div>' : '')
        + '</div>';
    }
    html += '<p class="muted small">解析到 ' + courses.length + ' 门课程。</p>';
    box.innerHTML = html;
  }

  async function run() {
    const text = $('courseInput').value;
    const courses = parseCourses(text);
    if (!courses.length) {
      $('status').textContent = '请先粘贴课程或载入示例。';
      $('results').innerHTML = '';
      return;
    }
    $('status').textContent = '已解析 ' + courses.length + ' 门课程，正在匹配……';
    try {
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const results = matchAll(courses, data);
      render(results, courses);
      $('status').textContent = '完成：解析 ' + courses.length + ' 门课程，命中 ' + results.length + ' 个候选专业。';
    } catch (e) {
      $('status').textContent = '数据加载失败：' + e.message;
      $('results').innerHTML = '<div class="warn">种子数据文件 <code>data/majors.seed.json</code> 加载失败。本地预览请用静态服务器（如 <code>npx serve</code>）打开，或直接访问在线版。</div>';
    }
  }

  /* ---- 成绩单 PDF 解析（本地 pdf.js，不上传任何服务器） ---- */
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

  async function handlePdf(file) {
    const lib = window.pdfjsLib;
    if (!lib) { $('status').textContent = 'PDF 组件未加载，请刷新页面重试。'; return; }
    $('status').textContent = '正在本地解析 PDF（不会上传任何数据）……';
    try {
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
      if (!courses.length) {
        $('status').textContent = 'PDF 解析完成但未提取到课程行——可能是不带文字层的扫描件，请先 OCR 或手动粘贴课程。';
        return;
      }
      $('courseInput').value = courses.join('\n');
      run();
      $('status').textContent = 'PDF 解析完成：提取 ' + courses.length + ' 门候选课程（请在输入框中人工核对，可编辑后重新解析）。';
    } catch (e) {
      $('status').textContent = 'PDF 解析失败：' + e.message;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('btnParse').addEventListener('click', run);
    $('btnSample').addEventListener('click', () => { $('courseInput').value = SAMPLE; run(); });
    $('btnClear').addEventListener('click', () => { $('courseInput').value = ''; $('results').innerHTML = ''; $('status').textContent = '等待输入……'; });
    $('fileCsv').addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { $('courseInput').value = String(reader.result || ''); run(); };
      reader.readAsText(f);
    });
    $('btnPdf').addEventListener('click', () => $('filePdf').click());
    $('filePdf').addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      if (f) handlePdf(f);
    });
  });
})();
