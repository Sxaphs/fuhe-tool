/* fuhe-tool 匹配逻辑：纯前端，数据本地处理
 * 三步流程：① 上传成绩单→识别课程→确认；② 用户选择目标复核专业；③ 匹配各校培养方案课表
 */
(function () {
  'use strict';

  const DATA_URL = 'data/majors.seed.json';
  const PLAN_COURSES_URL = 'data/plan-courses.json';

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

  /* ---------- 缓存 ---------- */
  let seedCache = null;
  let planCoursesCache = null;
  let confirmedCourses = [];
  let lastTranscriptFile = null;

  async function getSeed() {
    if (seedCache) return seedCache;
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    seedCache = await res.json();
    return seedCache;
  }

  async function getPlanCourses() {
    if (planCoursesCache) return planCoursesCache;
    const res = await fetch(PLAN_COURSES_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    planCoursesCache = await res.json();
    return planCoursesCache;
  }

  function findMajor(name) {
    if (!seedCache) return null;
    const n = String(name || '').trim();
    for (const cat of seedCache.categories) {
      for (const m of cat.majors) {
        if (m.name === n) return { major: m, cat: cat.category };
      }
    }
    return null;
  }

  /* ---------- 工具函数 ---------- */
  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  }

  function parseCourses(text) {
    const parts = String(text || '').split(/[\n,，;；、\t\r]+/);
    const out = [];
    const seen = new Set();
    for (let raw of parts) {
      let t = raw.trim();
      if (!t) continue;
      t = t.replace(/^[A-Za-z]{1,6}\s*\d{2,5}\s*[:：.-]?\s*/, '').trim();
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

  /* ---------- 匹配：课程 → 候选专业（通用种子数据） ---------- */
  function matchAll(courses, data) {
    const ncourses = courses.map(normalize);
    const results = [];
    for (const cat of (data.categories || [])) {
      for (const m of (cat.majors || [])) {
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
    let html = '<div class="card"><h2>匹配结果（' + results.length + ' 个候选专业）</h2><p class="muted small">按课程重合度排序，仅供参考——最终选哪个专业由你决定（见第二步）。</p></div>';
    for (const r of results.slice(0, 12)) {
      html += '<div class="card result-card">'
        + '<div class="cover"><div><span class="badge">' + esc(r.cat) + '</span><strong style="font-size:1.1rem;">' + esc(r.name) + '</strong>'
        + (r.aliases.length ? '<span class="muted small">　常见国外名：' + esc(r.aliases.join(' / ')) + '</span>' : '')
        + '</div><div class="bar-wrap"><span class="small muted">重合度</span><div class="bar"><i style="width:' + Math.min(r.coverage, 100) + '%"></i></div><strong>' + r.coverage + '%</strong></div><span class="flex">'
        + '<button class="btn ghost small" data-pick="' + esc(r.name) + '">选这个专业 →</button>'
        + '<a class="small" href="catalog.html?q=' + encodeURIComponent(r.name) + '">考公目录核对 →</a>'
        + '<a class="small" href="plan.html?major=' + encodeURIComponent(r.name) + '">查培养方案 →</a></span></div>'
        + '<div class="mt"><span class="muted small">匹配到的核心课程：</span>'
        + (r.matched.length ? r.matched.map((m) => '<span class="chip hit">' + esc(m) + '</span>').join('') : '<span class="chip miss">无直接匹配</span>')
        + '</div>'
        + (r.missing.length ? '<div class="mt"><span class="muted small">未匹配（可作为补课/补材料的参考）：</span>' + r.missing.slice(0, 8).map((m) => '<span class="chip miss">' + esc(m) + '</span>').join('') + '</div>' : '')
        + '</div>';
    }
    html += '<p class="muted small">解析到 ' + courses.length + ' 门课程。</p>';
    box.innerHTML = html;
    box.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('majorSelect').value = btn.getAttribute('data-pick');
        matchSchools($('majorSelect').value);
      });
    });
  }

  async function matchCourses(courses) {
    try {
      const data = await getSeed();
      const results = matchAll(courses, data);
      render(results, courses);
      showStep2(results);
      return results.length;
    } catch (e) {
      $('results').innerHTML = '<div class="warn">种子数据文件 <code>data/majors.seed.json</code> 加载失败。本地预览请用静态服务器（如 <code>npx serve</code>）打开，或直接访问在线版。</div>';
      throw e;
    }
  }

  /* ---------- 第二步：选择目标复核专业 ---------- */
  function populateMajorList() {
    if (!seedCache) return;
    const dl = $('majorList');
    dl.innerHTML = '';
    for (const cat of seedCache.categories) {
      for (const m of cat.majors) {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.label = m.name + '（' + cat.category + '）';
        dl.appendChild(opt);
      }
    }
  }

  function showStep2(results) {
    $('step2Card').style.display = '';
    populateMajorList();
    const wrap = $('recommendWrap');
    if (results && results.length) {
      wrap.style.display = '';
      $('recommendChips').innerHTML = results.slice(0, 5).map((r) =>
        '<span class="chip" style="cursor:pointer;" data-pick="' + esc(r.name) + '">' + esc(r.name) + '（' + r.coverage + '%）</span>'
      ).join(' ');
      $('recommendChips').querySelectorAll('[data-pick]').forEach((el) => {
        el.addEventListener('click', () => {
          $('majorSelect').value = el.getAttribute('data-pick');
          matchSchools(el.getAttribute('data-pick'));
        });
      });
    } else {
      wrap.style.display = 'none';
    }
  }

  /* ---------- 第三步：学校培养方案课表匹配 ---------- */
  function buildBridge(majorEntry) {
    const map = {};
    for (const cc of (majorEntry.coreCourses || [])) {
      const e = typeof cc === 'string' ? { zh: cc, en: [] } : cc;
      map[normalize(e.zh)] = e.en || [];
    }
    return map;
  }

  function matchSchoolCourses(courses, schoolCourses, bridge) {
    const ncourses = courses.map(normalize);
    const hits = [];
    for (const k of schoolCourses) {
      const nk = normalize(k);
      let enKeys = [];
      for (const [zh, en] of Object.entries(bridge)) {
        if (nk && (nk === zh || nk.includes(zh) || zh.includes(nk))) enKeys = enKeys.concat(en);
      }
      const hit = ncourses.some((c) => {
        if (nk && (c === nk || c.includes(nk) || nk.includes(c))) return true;
        return enKeys.some((key) => {
          const kk = normalize(key);
          if (!kk) return false;
          if (kk.length <= 3) return c === kk;
          return c === kk || c.includes(kk) || kk.includes(c);
        });
      });
      if (hit) hits.push(k);
    }
    return hits;
  }

  async function matchSchools(majorName) {
    const found = findMajor(majorName);
    if (!found) {
      $('schoolStatus').textContent = '未找到专业"' + majorName + '"，请在列表中重新选择。';
      return;
    }
    const { major, cat } = found;
    const courses = confirmedCourses;
    if (!courses.length) {
      $('schoolStatus').textContent = '请先完成第一步：上传成绩单并确认课程。';
      return;
    }
    $('step3Card').style.display = '';
    $('schoolStatus').textContent = '正在匹配 ' + major.name + '（' + cat + '）在各校培养方案中的课程重合度……';

    const bridge = buildBridge(major);
    let planEntries = [];
    try {
      planEntries = (await getPlanCourses()).entries.filter((e) => e.major === major.name);
    } catch (e) {
      planEntries = [];
    }

    let html = '<div class="card"><div class="cover"><div><h2 style="margin:0;">' + esc(major.name) + ' · 各校课表匹配</h2>'
      + '<span class="muted small">成绩单课程 vs 高校培养方案课程列表（重合度越高，越适合作为课程对比依据）</span></div>'
      + '<span class="flex"><a class="small" href="plan.html?major=' + encodeURIComponent(major.name) + '">查培养方案 →</a>'
      + '<a class="small" href="ai.html?major=' + encodeURIComponent(major.name) + '">去 AI 助手生成对比说明 →</a></span></div></div>';

    if (planEntries.length) {
      const rows = [];
      for (const e of planEntries) {
        const hits = matchSchoolCourses(courses, e.courses, bridge);
        const cov = e.courses.length ? Math.round(hits.length / e.courses.length * 100) : 0;
        rows.push({ school: e.school, cov, hits, total: e.courses.length, source: e.source, year: e.year || '' });
      }
      rows.sort((a, b) => b.cov - a.cov);
      html += '<div class="card"><h3>已收录课表数据的学校</h3><table><tr><th>学校</th><th>课程重合度</th><th>匹配的课程数</th><th>来源</th></tr>';
      for (const r of rows) {
        html += '<tr><td><strong>' + esc(r.school) + '</strong>' + (r.year ? '<span class="muted small">（' + esc(r.year) + '）</span>' : '') + '</td>'
          + '<td><div class="bar" style="width:120px;display:inline-block;vertical-align:middle;"><i style="width:' + r.cov + '%"></i></div> ' + r.cov + '%</td>'
          + '<td>' + r.hits.length + ' / ' + r.total + '</td>'
          + '<td class="small"><a href="' + esc(r.source) + '" target="_blank" rel="noopener">培养方案 ↗</a></td></tr>';
      }
      html += '</table><p class="muted small">命中课程：' + (rows[0] ? rows[0].hits.join('、') : '') + '</p></div>';
    } else {
      html += '<div class="card"><h3>已收录课表数据的学校</h3><p class="muted">该专业暂无收录的学校课表数据。你可以：① 到 <a href="plan.html?major=' + encodeURIComponent(major.name) + '">培养方案页</a> 用一键搜索直达各校官网；② 欢迎到 <a href="https://github.com/Sxaphs/fuhe-tool" target="_blank" rel="noopener">GitHub</a> 提 PR 收录（data/plan-courses.json）。</p></div>';
    }

    // 通用对照（种子核心课程）
    const generic = major.coreCourses || [];
    html += '<div class="card"><h3>通用核心课程对照（' + esc(major.name) + '）</h3><p class="muted small">与社区种子数据的核心课程比对（不区分学校）：</p>';
    const entries = generic.map((c) => (typeof c === 'string' ? { zh: c, en: [] } : c));
    const ncourses = courses.map(normalize);
    const hitZh = [];
    for (const e of entries) {
      const zh = normalize(e.zh);
      const hit = ncourses.some((c) => {
        if (zh && (c === zh || c.includes(zh) || zh.includes(c))) return true;
        return (e.en || []).some((k) => {
          const kk = normalize(k);
          if (!kk) return false;
          if (kk.length <= 3) return c === kk;
          return c === kk || c.includes(kk) || kk.includes(c);
        });
      });
      hitZh.push({ zh: e.zh, hit });
    }
    const cov = entries.length ? Math.round(hitZh.filter((x) => x.hit).length / entries.length * 100) : 0;
    html += '<div class="bar" style="width:160px;display:inline-block;vertical-align:middle;margin-right:8px;"><i style="width:' + cov + '%"></i></div><strong>' + cov + '%</strong>';
    html += '<div class="mt">' + hitZh.map((x) => '<span class="chip ' + (x.hit ? 'hit' : 'miss') + '">' + esc(x.zh) + '</span>').join('') + '</div></div>';

    $('schoolResults').innerHTML = html;
    $('schoolStatus').textContent = '完成。重合度最高的学校培养方案，可作为课程对比说明的参考依据。';
    $('schoolResults').scrollIntoView({ behavior: 'smooth' });
  }

  /* ---------- 第一步：成绩单上传/粘贴 ---------- */
  async function run() {
    const courses = parseCourses($('courseInput').value);
    if (!courses.length) {
      $('status').textContent = '请先粘贴课程或载入示例。';
      $('results').innerHTML = '';
      return;
    }
    confirmedCourses = courses;
    $('status').textContent = '已解析 ' + courses.length + ' 门课程，正在匹配……';
    try {
      const n = await matchCourses(courses);
      $('status').textContent = '完成：解析 ' + courses.length + ' 门课程，命中 ' + n + ' 个候选专业。';
    } catch (e) {
      $('status').textContent = '数据加载失败：' + e.message;
    }
  }

  async function handleTranscript(file) {
    const name = String(file.name || '').toLowerCase();
    const isImage = /\.(png|jpe?g|webp|bmp|gif|heic|heif)$/.test(name) || String(file.type || '').startsWith('image/');
    lastTranscriptFile = file;
    $('reviewArea').style.display = '';
    $('reviewStatus').textContent = isImage
      ? '正在本地 OCR 识别截图（首次使用需加载识别组件，约几秒）……'
      : '正在本地解析（不会上传任何数据；若为图片型 PDF 会自动转 OCR，首次较慢）……';
    try {
      const courses = await window.FuhePdf.parseTranscript(file);
      $('reviewInput').value = courses.join('\n');
      $('reviewStatus').textContent = '✅ 识别到 ' + courses.length + ' 门课程——请在下方确认。可以直接编辑（增、删、改课程名），确认后点「开始匹配」。';
      $('results').innerHTML = '';
      $('step2Card').style.display = 'none';
      $('step3Card').style.display = 'none';
    } catch (e) {
      $('reviewStatus').textContent = '解析失败：' + e.message + '（可点「手动粘贴课程」录入）';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('btnParse').addEventListener('click', run);
    $('btnSample').addEventListener('click', () => {
      $('pasteArea').style.display = '';
      $('btnShowPaste').style.display = 'none';
      $('courseInput').value = SAMPLE;
      run();
    });
    $('btnClear').addEventListener('click', () => {
      $('courseInput').value = '';
      $('results').innerHTML = '';
      $('step2Card').style.display = 'none';
      $('step3Card').style.display = 'none';
      $('status').textContent = '等待输入……';
    });
    $('btnShowPaste').addEventListener('click', () => {
      $('pasteArea').style.display = '';
      $('btnShowPaste').style.display = 'none';
    });
    $('fileTranscript').addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      if (f) handleTranscript(f);
    });
    $('btnReselect').addEventListener('click', () => $('fileTranscript').click());
    $('btnAiOcr').addEventListener('click', async () => {
      if (!lastTranscriptFile) { alert('请先上传成绩单文件'); return; }
      let cfg = {};
      try { cfg = JSON.parse(localStorage.getItem('fuhe-ai-config') || '{}'); } catch (e) { /* ignore */ }
      if (!cfg.apiKey || !cfg.base) {
        if (confirm('需要先在「AI 助手」页配置 API Key（图片会直发你配置的服务商）。现在去配置？')) location.href = 'ai.html';
        return;
      }
      if (!cfg.visionModel) {
        alert('当前配置缺少视觉模型名。请到「AI 助手」页填写视觉模型（DeepSeek 暂无视觉模型，请用 Moonshot 或 OpenRouter）。');
        return;
      }
      $('reviewStatus').textContent = 'AI 识别中（图片直发你配置的服务商，本站不中转）……';
      try {
        const courses = await window.FuhePdf.parseViaVisionApi(lastTranscriptFile);
        $('reviewInput').value = courses.join('\n');
        $('reviewStatus').textContent = '✅ AI 识别到 ' + courses.length + ' 门课程——请核对后点「开始匹配」。';
      } catch (e) {
        $('reviewStatus').textContent = 'AI 识别失败：' + e.message;
      }
    });
    $('btnConfirm').addEventListener('click', async () => {
      const courses = parseCourses($('reviewInput').value);
      if (!courses.length) { alert('课程列表为空，请检查识别结果。'); return; }
      confirmedCourses = courses;
      $('reviewStatus').textContent = '正在匹配 ' + courses.length + ' 门课程……';
      try {
        const n = await matchCourses(courses);
        $('reviewStatus').textContent = '完成：解析 ' + courses.length + ' 门课程，命中 ' + n + ' 个候选专业（要改课程可编辑上方列表后重新点「开始匹配」）。';
      } catch (e) {
        $('reviewStatus').textContent = '数据加载失败：' + e.message;
      }
    });
    $('btnMatchSchool').addEventListener('click', () => {
      const name = $('majorSelect').value.trim();
      if (!name) { alert('请先选择目标专业'); return; }
      matchSchools(name);
    });
  });
})();
