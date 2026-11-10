/* fuhe-tool 主流水线：配置 → 上传 → 一键分析
 * 识别成绩单 → 匹配专业（本科专业 + 研究生学科）→ 找学校培养方案（收录数据 + AI 自动整理 + 用户上传）→ 标准化复核建议报告
 * 全部本地处理；AI 请求直发用户配置的服务商。
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const AI_KEY = 'fuhe-ai-config';
  const DATA_URL = 'data/majors.seed.json';
  const GRAD_URL = 'data/graduate-majors.json';
  const PLAN_COURSES_URL = 'data/plan-courses.json';
  const PLAN_SEED_URL = 'data/plan-seed.json';
  const CODES_URL = 'data/major-codes.json';

  const PRESETS = {
    'https://api.deepseek.com': 'deepseek-chat',
    'https://api.moonshot.cn/v1': 'moonshot-v1-8k',
    'https://openrouter.ai/api/v1': 'deepseek/deepseek-chat'
  };
  const VISION_PRESETS = {
    'https://api.deepseek.com': '',
    'https://api.moonshot.cn/v1': 'moonshot-v1-8k-vision-preview',
    'https://openrouter.ai/api/v1': 'qwen/qwen2.5-vl-72b-instruct'
  };
  const SCHOOLS = ['清华大学', '北京大学', '浙江大学', '上海交通大学', '复旦大学', '南京大学', '中国科学技术大学', '华中科技大学', '武汉大学', '西安交通大学', '哈尔滨工业大学', '同济大学'];

  /* ---------- 配置 ---------- */
  function loadConfig() { try { return JSON.parse(localStorage.getItem(AI_KEY)) || {}; } catch (e) { return {}; } }
  function saveConfig(c) { localStorage.setItem(AI_KEY, JSON.stringify(c)); }
  function getConfig() {
    const baseSel = $('baseUrl').value;
    const base = baseSel === 'custom' ? $('customBase').value.trim().replace(/\/+$/, '') : baseSel;
    return {
      base,
      apiKey: $('apiKey').value.trim() || loadConfig().apiKey || '',
      model: $('model').value.trim() || loadConfig().model || 'deepseek-chat',
      visionModel: $('visionModel').value.trim() || loadConfig().visionModel || ''
    };
  }

  /* ---------- 数据缓存（只存 Promise，一律 await 消费） ---------- */
  let seedP = null, gradP = null, planCoursesP = null, planSeedP = null, codesP = null;
  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  const getSeed = () => seedP || (seedP = getJson(DATA_URL));
  const getGrad = () => gradP || (gradP = getJson(GRAD_URL).catch(() => ({ disciplines: [] })));
  const getPlanCourses = () => planCoursesP || (planCoursesP = getJson(PLAN_COURSES_URL).catch(() => ({ entries: [] })));
  const getPlanSeed = () => planSeedP || (planSeedP = getJson(PLAN_SEED_URL).catch(() => ({ schools: SCHOOLS, entries: [] })));
  const getCodes = () => codesP || (codesP = getJson(CODES_URL).catch(() => null));

  /* ---------- 学历层次识别（本科 vs 硕士/博士） ---------- */
  const LEVEL_MASTER = /master|msc\b|m\.?s\.?c|mba\b|magister|masterarbeit|master of|硕士学位|硕士|研究生/i;
  const LEVEL_BACHELOR = /bachelor|bsc\b|b\.?s\.?c|b\.?a\b|beng|bachelor of|学士学位|学士|本科|undergraduate/i;

  function detectLevel(raw) {
    const text = String(raw || '');
    const m = (text.match(LEVEL_MASTER) || []).length;
    const b = (text.match(LEVEL_BACHELOR) || []).length;
    if (m > b) return 'grad';
    if (b > m) return 'undergrad';
    return null;
  }

  function levelName(level) {
    return level === 'grad' ? '硕士 / 博士' : (level === 'undergrad' ? '本科' : '未知');
  }

  let lastDetectedLevel = null;
  let groupData = []; // 两级选择数据：[{gate, entries:[{value,label,level}]}]
  let refreshMajorSelects = () => {}; // 模块作用域占位，初始化时赋值（runPipeline 会调用）

  /* 学科门类（主目录）：从专业代码前两位映射 */
  const GATE = { '01': '哲学', '02': '经济学', '03': '法学', '04': '教育学', '05': '文学', '06': '历史学', '07': '理学', '08': '工学', '09': '农学', '10': '医学', '12': '管理学', '13': '艺术学', '14': '交叉学科' };
  const GATE_ORDER = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '12', '13', '14', '99'];
  function gateOf(code) {
    const g = String(code || '').slice(0, 2);
    return GATE[g] || '其他';
  }

  /* ---------- 工具 ---------- */
  function normalize(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function parseCourses(text) {
    return String(text || '').split(/[\n,，;；、\t\r]+/).map((s) => s.trim()).filter((s) => s.length >= 2);
  }

  /* ---------- 课程表格（确认/编辑界面） ---------- */
  function renderCoursesTable(courses) {
    const tbody = $('coursesTable').querySelector('tbody');
    tbody.innerHTML = '';
    courses.forEach((c, i) => tbody.appendChild(buildCourseRow(c, i)));
  }
  function buildCourseRow(name, idx) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = idx + 1;
    const td2 = document.createElement('td');
    const inp = document.createElement('input');
    inp.value = name;
    inp.className = 'course-input';
    inp.style.cssText = 'width:100%;border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:inherit;';
    td2.appendChild(inp);
    const td3 = document.createElement('td');
    const del = document.createElement('button');
    del.textContent = '删除';
    del.className = 'btn ghost small';
    del.addEventListener('click', () => {
      tr.remove();
      [...$('coursesTable').querySelector('tbody').children].forEach((r, i) => { r.children[0].textContent = i + 1; });
    });
    td3.appendChild(del);
    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
    return tr;
  }
  function getCoursesFromTable() {
    return [...document.querySelectorAll('#coursesTable .course-input')].map((i) => i.value.trim()).filter(Boolean);
  }

  /* 查找目标专业：先本科种子库，再研究生学科库（支持「一级学科::二级学科」编码） */
  function findMajorAny(seed, gradData, sel) {
    const n = String(sel || '').trim();
    const [parent, sub] = n.split('::');
    if (sub && gradData && gradData.disciplines) {
      const d = gradData.disciplines.find((x) => x.name === parent);
      if (d) return { name: sub, parentName: d.name, cat: '研究生学科（' + d.name + '）', kind: 'grad', code: d.code, entry: d, subs: d.subs || [] };
      return null;
    }
    if (seed && seed.categories) {
      for (const cat of seed.categories) {
        for (const m of cat.majors) {
          if (m.name === n) return { name: m.name, cat: cat.category, kind: 'undergrad', code: '', entry: m };
        }
      }
    }
    if (gradData && gradData.disciplines) {
      for (const d of gradData.disciplines) {
        if (d.name === n) {
          return { name: d.name, cat: '研究生学科', kind: 'grad', code: d.code, entry: d, subs: d.subs || [] };
        }
      }
    }
    return null;
  }

  /* 当前选中的目标专业（支持手动输入） */
  function currentMajorValue() {
    const v = $('majorSelect').value;
    if (v === '__custom__') return $('majorCustom').value.trim();
    return v;
  }

  /* ---------- 匹配（课程 → 候选本科专业） ---------- */
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
          results.push({ cat: cat.category, name: m.name, matched: uniq, coverage: Math.round(coverage * 100), score });
        }
      }
    }
    results.sort((a, b) => b.score - a.score || b.coverage - a.coverage);
    return results;
  }

  /* ---------- 课程 → 学校课表匹配（双语桥接） ---------- */
  function buildBridgeFor(seed, found) {
    const map = {};
    const add = (coreCourses) => {
      for (const cc of (coreCourses || [])) {
        const e = typeof cc === 'string' ? { zh: cc, en: [] } : cc;
        const key = normalize(e.zh);
        if (key && !map[key]) map[key] = e.en || [];
      }
    };
    if (found && found.kind === 'grad') {
      // 研究生学科没有自己的 coreCourses：聚合相关本科专业的核心课程作为中英桥
      const related = (found.entry && found.entry.related) || [];
      for (const cat of (seed.categories || [])) {
        for (const m of cat.majors) {
          if (related.includes(m.name)) add(m.coreCourses);
        }
      }
    } else if (found && found.entry) {
      add(found.entry.coreCourses);
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

  /* ---------- 成绩单识别（自动选路） ---------- */
  async function parseTranscriptAuto(file) {
    const cfg = loadConfig();
    const name = String(file.name || '').toLowerCase();
    const type = String(file.type || '');
    const isPdf = name.endsWith('.pdf') || type === 'application/pdf';
    const isImage = /\.(png|jpe?g|webp|bmp|gif|heic|heif)$/.test(name) || type.startsWith('image/');
    const hasVision = cfg.apiKey && cfg.base && cfg.visionModel;

    if (isPdf) {
      try {
        return { courses: await window.FuhePdf.parseCourseListFromPdf(file), method: 'PDF 文字层提取' + (hasVision ? '' : '（或本地 OCR）') };
      } catch (e) {
        if (hasVision) {
          try { return { courses: await window.FuhePdf.parseViaVisionApi(file), method: 'AI 视觉识别（' + cfg.visionModel + '）' }; }
          catch (e2) { throw new Error(e2.message); }
        }
        throw e;
      }
    }
    if (isImage) {
      if (hasVision) {
        try { return { courses: await window.FuhePdf.parseViaVisionApi(file), method: 'AI 视觉识别（' + cfg.visionModel + '）' }; }
        catch (e) { /* 回落本地 OCR */ }
      }
      try { return { courses: await window.FuhePdf.parseImageViaOcr(file), method: '本地 OCR（德语+英语+中文）' }; }
      catch (e) { throw new Error('截图识别失败：' + e.message + (hasVision ? '' : '。提示：配置视觉模型可大幅提升识别率')); }
    }
    return { courses: window.FuhePdf.parseCsvText(await file.text()), method: '文本解析' };
  }

  async function parsePlanAuto(file) {
    const name = String(file.name || '').toLowerCase();
    const type = String(file.type || '');
    const isImage = /\.(png|jpe?g|webp|bmp|gif|heic|heif)$/.test(name) || type.startsWith('image/');
    if (isImage || name.endsWith('.pdf')) {
      const r = await parseTranscriptAuto(file);
      return r.courses;
    }
    return window.FuhePdf.parseCsvText(await file.text());
  }

  /* ---------- AI 自动查找各校培养方案核心课程 + 语义匹配（结构化 JSON） ---------- */
  async function aiFindSchoolCourses(majorName, kind, subs, courses, focusSub) {
    const cfg = getConfig();
    if (!cfg.apiKey || !cfg.base || !cfg.model) return [];
    const kindText = kind === 'grad' ? '研究生一级学科' : '本科专业';
    const subText = (subs && subs.length) ? '（其二级学科包括：' + subs.slice(0, 8).join('、') + '）' : '';
    const focusText = focusSub ? '本次用户的目标是其二级学科「' + focusSub + '」，课程清单请侧重覆盖该二级学科的方向课。' : '';
    const prompt = '你是国内高校课程设置专家。请给出4所985/211高校的「' + majorName + '」' + kindText + subText + focusText + '培养方案的核心专业课程清单，'
      + '并对【国外课程】中的每一门课程判断它与该校哪门课程对应。严格只输出JSON数组（不要markdown代码块、不要解释文字）：\n'
      + '[{"school":"学校全名","courses":["课程1","课程2"],"matched":["对应上的国外课程原名1"]}]\n'
      + '要求：courses 每校12~20门核心专业课程，课程名用国内通行名称；matched 数组中的课程名必须与【国外课程】中的名称逐字一致，只放确实与该培养方案对应的课程（按课程内容语义判断，不要只按名字猜）。\n'
      + '【国外课程】\n' + courses.join('\n');
    try {
      const res = await fetch(cfg.base.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 2500 })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      let arr = null;
      try { arr = JSON.parse(text); } catch (e) {
        const m = text.match(/\[[\s\S]*\]/);
        if (m) { try { arr = JSON.parse(m[0]); } catch (e2) { /* ignore */ } }
      }
      if (!Array.isArray(arr)) throw new Error('AI 返回格式无法解析');
      return arr.filter((e) => e && e.school && Array.isArray(e.courses) && e.courses.length)
        .map((e) => ({
          school: String(e.school),
          courses: e.courses.map((c) => String(c)).filter(Boolean),
          matched: Array.isArray(e.matched) ? e.matched.map((c) => String(c)) : [],
          year: '', source: '', kind: 'AI整理'
        }));
    } catch (e) {
      console.warn('AI 查找学校课程失败：', e.message);
      return [];
    }
  }

  /* ---------- 第 3 步：学校培养方案匹配（标准化表格） ---------- */
  function renderStep3(courses, bridge, displayMajor, matchMajor, uploadPlanCourses, planSeed, planCoursesData, aiEntries, level) {
    const levelOk = (e) => e.major === matchMajor && (!level || !e.level || e.level === level);
    const planEntries = ((planCoursesData && planCoursesData.entries) || []).filter(levelOk);
    const linkEntries = (planSeed && planSeed.entries || []).filter((e) => e.major === matchMajor);

    const rows = [];
    for (const e of planEntries) {
      const hits = matchSchoolCourses(courses, e.courses, bridge);
      rows.push({ school: e.school, year: e.year || '', hits, total: e.courses.length, source: e.source, kind: '收录' });
    }
    for (const e of aiEntries) {
      // AI 语义匹配优先；返回里没有 matched 字段时退回本地关键词匹配
      const matchedSet = new Set((e.matched || []).map(normalize));
      const aiHits = matchedSet.size
        ? courses.filter((c) => matchedSet.has(normalize(c)))
        : matchSchoolCourses(courses, e.courses, bridge);
      rows.push({ school: e.school, year: '', hits: aiHits, total: e.courses.length, source: '', kind: 'AI整理', aiMatched: matchedSet.size > 0 });
    }
    if (uploadPlanCourses && uploadPlanCourses.length) {
      const hits = matchSchoolCourses(courses, uploadPlanCourses, bridge);
      rows.push({ school: '你上传的培养方案', year: '', hits, total: uploadPlanCourses.length, source: '', kind: '上传' });
    }
    rows.sort((a, b) => (b.hits.length / Math.max(b.total, 1)) - (a.hits.length / Math.max(a.total, 1)));

    let html = '';
    if (rows.length) {
      html += '<table><tr><th>学校 / 来源</th><th>课程重合度</th><th>匹配课程数</th><th>来源</th></tr>';
      for (const r of rows) {
        const cov = r.total ? Math.round(r.hits.length / r.total * 100) : 0;
        const badge = r.kind === '上传' ? '<span class="badge">用户上传</span>' : (r.kind === 'AI整理' ? '<span class="badge" style="background:#fef3c7;color:#92400e;">AI 整理</span>' : '<span class="badge">已收录</span>');
        html += '<tr><td><strong>' + esc(r.school) + '</strong> ' + badge + (r.year ? '<span class="muted small">（' + esc(r.year) + '）</span>' : '') + '</td>'
          + '<td><div class="bar" style="width:110px;display:inline-block;vertical-align:middle;margin-right:6px;"><i style="width:' + cov + '%"></i></div>' + cov + '%</td>'
          + '<td>' + r.hits.length + ' / ' + r.total + '</td>'
          + '<td class="small">' + (r.source ? '<a href="' + esc(r.source) + '" target="_blank" rel="noopener">培养方案 ↗</a>' : (r.kind === 'AI整理' ? (r.aiMatched ? 'AI 语义匹配，建议官网核对' : 'AI 整理，建议官网核对') : '—')) + '</td></tr>';
        if (r.hits.length) html += '<tr><td colspan="4" class="small muted">命中课程：' + r.hits.map(esc).join('、') + '</td></tr>';
      }
      html += '</table>';
      if (aiEntries.length) {
        html += '<p class="muted small">⚠️ 「AI 整理」的课程清单由模型生成，可能与实际培养方案有出入——作为参考，正式申报前请到官网核对（一键搜索见下）。</p>';
      }
    } else {
      html += '<div class="warn">⚠️ 该专业暂未收录学校课表数据，AI 也未能整理。<br>'
        + '① 建议直接在上方「📎 上传目标学校培养方案」上传文件后重新分析；<br>'
        + '② 或通过下方一键搜索去各校官网下载培养方案：</div>';
    }
    if (linkEntries.length) {
      html += '<p class="muted small mt">已收录的该专业培养方案链接：</p><ul class="small">';
      for (const e of linkEntries) html += '<li><a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.school) + ' · ' + esc(displayMajor) + (e.kind === 'pdf' ? '（PDF）' : '') + '</a></li>';
      html += '</ul>';
    }
    const searchSuffix = level === 'grad' ? ' 研究生培养方案' : ' 培养方案';
    html += '<p class="muted small mt">一键搜索各校培养方案（' + esc(displayMajor) + (level ? ' · ' + levelName(level) + '层次' : '') + '）：</p>';
    const schools = (planSeed && planSeed.schools && planSeed.schools.length) ? planSeed.schools : SCHOOLS;
    for (const s of schools.slice(0, 6)) {
      const bd = 'https://www.baidu.com/s?wd=' + encodeURIComponent(s + ' ' + displayMajor + searchSuffix);
      const bi = 'https://www.bing.com/search?q=' + encodeURIComponent(s + ' ' + displayMajor + searchSuffix);
      html += '<span class="chip"><a href="' + esc(bd) + '" target="_blank" rel="noopener">' + esc(s) + ' · 百度</a></span><span class="chip"><a href="' + esc(bi) + '" target="_blank" rel="noopener">' + esc(s) + ' · Bing</a></span>';
    }
    $('step3Body').innerHTML = html;
  }

  /* ---------- 逐门课程对照表（报告核心） ---------- */
  function buildComparisonTable(courses, schoolRows) {
    // 找匹配最好的学校，生成 国外课程 → 国内课程 对照
    const best = schoolRows.slice().sort((a, b) => b.hits.length - a.hits.length)[0];
    if (!best) return { md: '', rows: [] };
    const ncourses = courses.map(normalize);
    const table = [];
    for (const c of courses) {
      const nc = normalize(c);
      let hit = '';
      for (const k of best.hits) {
        const nk = normalize(k);
        if (nc === nk || nc.includes(nk) || nk.includes(nc)) { hit = k; break; }
      }
      table.push({ course: c, target: hit || '—', school: best.school });
    }
    const md = '| 国外课程 | 对应国内课程 | 来源学校 | 匹配说明 |\n|---|---|---|---|\n'
      + table.map((r) => '| ' + r.course + ' | ' + (r.target === '—' ? '（待人工对照）' : r.target) + ' | ' + r.school + ' | ' + (r.target === '—' ? '建议人工核对培养方案' : '课程名称对应') + ' |').join('\n');
    return { md, rows: table };
  }

  /* ---------- 第 4 步：报告 ---------- */
  async function generateReport(courses, majorName, catName, codeText, schoolRows, comparisonTable, level) {
    const cfg = getConfig();
    $('reportBody').innerHTML = '<p class="muted">正在生成复核建议报告……</p>';
    const levelLine = level ? '（学历层次：' + levelName(level) + '）' : '';
    const bestLine = schoolRows.length
      ? schoolRows.slice().sort((a, b) => b.hits.length / Math.max(b.total, 1) - a.hits.length / Math.max(a.total, 1))[0]
      : null;
    const summary = schoolRows.length
      ? schoolRows.map((r) => r.school + '：' + r.hits.length + '/' + r.total + ' 门匹配' + (r.hits.length ? '（' + r.hits.join('、') + '）' : '')).join('\n')
      : '暂无学校课表数据';

    let report = '';
    if (cfg.apiKey && cfg.base && cfg.model) {
      try {
        const prompt = '你是留学学历认证复核顾问。基于以下信息生成中文《复核建议报告》，用 markdown 输出，结构固定为：\n'
          + '## 一、目标专业\n' + majorName + (catName ? '（' + catName + (codeText ? ' · ' + codeText : '') + '）' : '') + levelLine + '\n'
          + '## 二、课程对应表\n请用 markdown 表格：| 国外课程 | 对应国内课程 | 来源学校 | 匹配说明 |，必须逐门列出【国外课程】中的每一门课程。'
          + '你必须利用自身知识，为每门国外课程判断并填写对应的国内「' + majorName + '」培养方案课程（例如 Financial Statement Analysis 可对应「财务报表分析」或「中级财务会计」），'
          + '「来源学校」填一所开设该课程的代表性985/211高校。给出的本地匹配参考仅供参考，以你的专业判断为准；'
          + '只有确实无法对应的课程才写「待人工对照」并在匹配说明注明原因，此类不超过总数的 20%。\n'
          + '## 三、推荐选校\n结合重合度说明哪所学校培养方案最适合作为对比依据及理由。\n'
          + '## 四、材料清单\n认证书、成绩单（PDF 单文件 1M 以下）、课程对比说明、目标高校培养方案来源等。\n'
          + '## 五、风险提示\n复核免费、认证结果出具之日起 12 个月内申请、仅 1 次机会；不承诺结果，最终以留服中心审核为准。\n\n'
          + '【国外课程】\n' + courses.join('\n') + '\n\n【学校课表匹配】\n' + summary + '\n\n【本地匹配参考（仅供参考，以你的判断为准）】\n' + comparisonTable.md + '\n'
          + '【最优学校】' + (bestLine ? bestLine.school : '无') + '\n\n要求：课程对应表必须逐门列出全部国外课程并尽量给出对应课程名，不要大范围写「待人工对照」；语气客观；不出现"保证通过""包过"。';
        const res = await fetch(cfg.base.replace(/\/+$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
          body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 3000 })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        report = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      } catch (e) {
        report = '';
        console.warn('AI 报告生成失败：', e.message);
      }
    }
    if (!report) {
      report = '# 复核建议报告（模板）\n\n'
        + '## 一、目标专业\n\n' + majorName + (catName ? '（' + catName + (codeText ? ' · ' + codeText : '') + '）' : '') + levelLine + '\n\n'
        + '## 二、课程对应表\n\n' + comparisonTable.md + '\n\n'
        + '## 三、推荐选校\n\n' + (bestLine ? '建议以「' + bestLine.school + '」的培养方案作为课程对比依据（重合度最高：' + bestLine.hits.length + '/' + bestLine.total + ' 门课程匹配）。' : '暂无学校课表数据，请上传目标学校培养方案。') + '\n\n'
        + '## 四、材料清单\n\n- 国外学历学位认证书（原件扫描件）\n- 国外高校官方成绩单（PDF、单文件 1M 以下）\n- 课程对比说明（对照目标高校培养方案逐门说明）\n- 目标高校《培养方案》来源说明（官网链接或文件）\n- 复核原因说明\n\n'
        + '## 五、风险提示\n\n1. 改名目标必须是国内专业目录中真实存在的专业名；\n2. 复核免费、认证结果出具之日起 12 个月内申请、仅 1 次机会；\n3. 报考事业单位自 2024-10-25 起官方建议无需复核；\n4. 本报告仅供申报参考，最终以留服中心审核为准。\n';
    }
    $('reportBody').innerHTML = mdToHtml(report);
  }

  /* markdown → HTML（支持表格） */
  function mdToHtml(md) {
    const lines = String(md).split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\|.*\|$/.test(line.trim()) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
        // 表格块
        const header = line.trim().split('|').slice(1, -1).map((s) => s.trim());
        const rows = [];
        i += 2;
        while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
          rows.push(lines[i].trim().split('|').slice(1, -1).map((s) => s.trim()));
          i++;
        }
        let t = '<table><tr>' + header.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr>';
        for (const r of rows) {
          t += '<tr>' + header.map((_, idx) => '<td>' + esc(r[idx] || '') + '</td>').join('') + '</tr>';
        }
        out.push(t + '</table>');
        continue;
      }
      if (/^#{1,3} /.test(line)) {
        const level = line.match(/^#+/)[0].length;
        out.push('<h' + Math.min(level + 1, 4) + '>' + esc(line.replace(/^#+\s*/, '')) + '</h' + Math.min(level + 1, 4) + '>');
      } else if (/^[-*] \[ \] /.test(line)) {
        out.push('<div>☐ ' + esc(line.replace(/^[-*] \[ \] /, '')) + '</div>');
      } else if (/^[-*] /.test(line)) {
        out.push('<div>• ' + esc(line.replace(/^[-*] /, '')) + '</div>');
      } else if (/^\d+\. /.test(line)) {
        out.push('<div>' + esc(line) + '</div>');
      } else if (line.trim() === '') {
        out.push('<div style="height:8px;"></div>');
      } else {
        out.push('<div>' + esc(line).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') + '</div>');
      }
      i++;
    }
    return '<div style="white-space:normal;line-height:1.8;">' + out.join('') + '</div>';
  }

  function exportPdf() {
    const major = currentMajorValue() || '目标专业';
    const text = ($('reportBody').innerText || '').trim();
    if (!text) { alert('还没有报告内容'); return; }
    const w = window.open('', '_blank');
    if (!w) { alert('请允许弹窗'); return; }
    w.document.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>' + esc(major) + ' 复核建议报告</title>'
      + '<style>body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.8;max-width:780px;margin:32px auto;padding:0 24px;color:#111;}'
      + 'h1,h2{border-bottom:1px solid #ddd;padding-bottom:6px;}h1{font-size:20px;}'
      + 'table{width:100%;border-collapse:collapse;margin:12px 0;}th,td{border:1px solid #ccc;padding:6px 8px;font-size:13px;text-align:left;}th{background:#f2f4f7;}</style></head><body>'
      + '<h1>' + esc(major) + ' 复核建议报告</h1>'
      + '<div>' + $('reportBody').innerHTML + '</div>'
      + '<p style="font-size:12px;color:#888;border-top:1px solid #ddd;padding-top:8px;">本文档由 fuhe-tool 生成，仅供申报参考，不承诺复核结果；最终以教育部留学服务中心审核为准。</p>'
      + '</body></html>');
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  }

  /* ---------- 主流程 ---------- */
  let transcriptFile = null, planFile = null;

  async function runPipeline() {
    if (!transcriptFile) { alert('请先上传成绩单'); return; }
    $('runStatus').textContent = '开始分析……';
    $('pipelineResults').style.display = '';
    try {
      // 第 1 步：识别成绩单
      $('step1Badge').textContent = '识别中……';
      const r1 = await parseTranscriptAuto(transcriptFile);
      renderCoursesTable(r1.courses);
      const detected = detectLevel(window.FuhePdf.getLastRawText());
      lastDetectedLevel = detected;
      if (detected && $('levelSelect').value === 'auto') $('levelSelect').value = detected;
      $('step1Method').textContent = r1.method + (detected ? '｜学历层次识别：' + levelName(detected) : '｜学历层次：未能识别（可手动选择）');
      $('step1Badge').textContent = '✅ ' + r1.courses.length + ' 门课程';
      refreshMajorSelects();
      await runAnalysis(r1.courses);
    } catch (e) {
      $('runStatus').textContent = '❌ 分析失败：' + e.message;
      $('step1Badge').textContent = '失败';
    }
  }

  /* 第 2-4 步：以给定课程列表跑匹配与报告（重新生成时从可编辑表格取课程） */
  async function runAnalysis(courses) {
    const majorName = currentMajorValue();
    // 有效学历层次：手动选择优先，否则用自动识别结果
    const level = $('levelSelect').value !== 'auto' ? $('levelSelect').value : lastDetectedLevel;
    try {

      // 第 2 步：复核专业（本科 + 研究生学科）
      const seed = await getSeed();
      const gradData = await getGrad();
      const found = findMajorAny(seed, gradData, majorName);
      let codeText = '';
      if (found) {
        if (found.kind === 'grad') {
          codeText = found.code;
          $('step2Badge').textContent = '✅ ' + found.name + (found.parentName ? '（' + found.parentName + ' 二级学科 · ' + found.code + '）' : '（研究生学科 · ' + found.code + '）');
        } else {
          const codes = await getCodes();
          const code = codes && codes.majors && codes.majors[found.name] ? codes.majors[found.name] : '';
          codeText = code;
          $('step2Badge').textContent = '✅ ' + found.name + '（' + found.cat + (code ? ' · ' + code : '') + '）';
        }
      } else if (majorName) {
        $('step2Badge').textContent = '⚠️ 未在收录库中找到，按你输入的专业名继续';
      } else {
        $('step2Badge').textContent = '⚠️ 未选择专业';
      }

      const recs = matchAll(courses, seed);
      let step2Html = '';
      if (!found && majorName) {
        step2Html += '<div class="warn">「' + esc(majorName) + '」不在收录库中（含 74 个本科专业与研究生学科目录）。请确认名称；也可从下方推荐中选择。</div>';
      }
      if (found && level && found.kind !== level) {
        step2Html += '<div class="warn">⚠️ 学历层次不匹配：成绩单识别为「' + levelName(level) + '」，而你选择的目标「' + esc(found.name) + '」是'
          + (found.kind === 'grad' ? '研究生学科' : '本科专业') + '。'
          + (level === 'grad' ? '硕士/博士成绩单通常复核对标研究生学科（下拉中带「研究生学科 · 代码」的选项），不建议匹配本科专业课表。'
            : '本科成绩单通常复核对标本科专业，不建议匹配研究生学科课表。')
          + '已按你的选择继续，但建议更换目标专业。</div>';
      }
      if (found && found.kind === 'grad' && found.subs && found.subs.length) {
        step2Html += '<p class="muted small">二级学科：' + found.subs.map(esc).join('、') + '</p>';
      }
      step2Html += '<p class="muted small">按课程匹配度的候选专业（点击替换目标专业后重新分析）：</p>';
      step2Html += recs.slice(0, 6).map((r) =>
        '<span class="chip" style="cursor:pointer;" data-pick="' + esc(r.name) + '">' + esc(r.name) + '（' + r.coverage + '%）</span>').join(' ');
      step2Html += '<span class="chip"><a href="catalog.html?q=' + encodeURIComponent(majorName || (recs[0] && recs[0].name) || '') + '" target="_blank" rel="noopener">考公目录核对 ↗</a></span>';
      $('step2Body').innerHTML = step2Html;
      $('step2Body').querySelectorAll('[data-pick]').forEach((el) => {
        el.addEventListener('click', () => {
          const name = el.getAttribute('data-pick');
          let opt = [...$('majorSelect').options].find((o) => o.value === name);
          if (!opt) {
            opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name + '（推荐）';
            $('majorSelect').appendChild(opt);
          }
          $('majorSelect').value = name;
          $('majorCustom').style.display = 'none';
          $('runStatus').textContent = '已选择「' + name + '」，点击「开始一键分析」重新生成。';
          $('step3Body').innerHTML = '';
          $('reportBody').innerHTML = '';
        });
      });

      // 第 3 步：学校培养方案（收录 + AI 自动整理 + 用户上传；按学历层次过滤）
      $('step3Badge').textContent = '查找中……';
      const planCourses = await getPlanCourses();
      const planSeed = await getPlanSeed();
      // 二级学科选择时，课表按一级学科匹配
      const matchMajor = found && found.parentName ? found.parentName : majorName;
      const displayMajor = found && found.parentName ? found.name + '（' + found.parentName + '）' : majorName;
      // 层次过滤：未知层次的条目在层次明确时排除（严格同层次匹配）
      const levelFilter = (e) => e.major === matchMajor && (!level || !e.level || e.level === level);
      let uploadPlanCourses = [];
      if (planFile) {
        try {
          uploadPlanCourses = await parsePlanAuto(planFile);
        } catch (e) {
          $('step3Badge').textContent = '⚠️ 培养方案解析失败：' + e.message;
        }
      }
      // AI 自动整理各校课程 + 语义匹配
      let aiEntries = [];
      if (getConfig().apiKey && getConfig().base && getConfig().model) {
        $('step3Badge').textContent = 'AI 正在整理各校课程并语义匹配……';
        aiEntries = await aiFindSchoolCourses(matchMajor, found ? found.kind : 'undergrad', found && found.subs ? found.subs : [], courses, found && found.parentName ? found.name : null);
      }
      const curatedCount = ((planCourses.entries || []).filter(levelFilter)).length;
      const totalSources = curatedCount + aiEntries.length + (uploadPlanCourses.length ? 1 : 0);
      $('step3Badge').textContent = totalSources ? ('✅ ' + totalSources + ' 个来源' + (level ? '（' + levelName(level) + '层次）' : '')) : '⚠️ 未收录，请上传或一键搜索';
      // 双语桥：研究生学科聚合相关本科专业核心课程（修复 0 重合问题）
      const bridge = buildBridgeFor(seed, found);
      renderStep3(courses, bridge, displayMajor, matchMajor, uploadPlanCourses, planSeed, planCourses, aiEntries, level);

      // 学校行汇总（供报告）
      const schoolRows = [];
      for (const e of ((planCourses.entries || []).filter(levelFilter))) {
        schoolRows.push({ school: e.school, total: e.courses.length, hits: matchSchoolCourses(courses, e.courses, bridge) });
      }
      for (const e of aiEntries) {
        const matchedSet = new Set((e.matched || []).map(normalize));
        const hits = matchedSet.size ? courses.filter((c) => matchedSet.has(normalize(c))) : matchSchoolCourses(courses, e.courses, bridge);
        schoolRows.push({ school: e.school, total: e.courses.length, hits });
      }
      if (uploadPlanCourses.length) {
        schoolRows.push({ school: '你上传的培养方案', total: uploadPlanCourses.length, hits: matchSchoolCourses(courses, uploadPlanCourses, bridge) });
      }

      // 第 4 步：报告（标准化表格）
      const comparisonTable = buildComparisonTable(courses, schoolRows);
      const reportMajor = found ? (found.parentName ? found.name + '（' + found.parentName + '）' : found.name) : majorName;
      const reportCat = found && found.parentName ? '研究生学科' : (found ? found.cat : '');
      await generateReport(courses, reportMajor, reportCat, codeText, schoolRows, comparisonTable, level);
      $('runStatus').textContent = '✅ 分析完成。可编辑识别课程后点「重新生成建议」。';
      document.getElementById('pipelineResults').scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
      $('runStatus').textContent = '❌ 分析失败：' + e.message;
      $('step1Badge').textContent = '失败';
    }
  }

  /* ---------- 初始化 ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    const cfg = loadConfig();
    if (cfg.base && PRESETS[cfg.base]) {
      $('baseUrl').value = cfg.base;
      $('model').value = cfg.model || PRESETS[cfg.base];
      $('visionModel').value = cfg.visionModel || VISION_PRESETS[cfg.base];
    } else if (cfg.base) {
      $('baseUrl').value = 'custom';
      $('customBase').style.display = '';
      $('customBase').value = cfg.base;
    }
    if (cfg.apiKey) $('apiKey').value = cfg.apiKey;

    $('baseUrl').addEventListener('change', () => {
      const v = $('baseUrl').value;
      $('customBase').style.display = v === 'custom' ? '' : 'none';
      if (v !== 'custom') {
        if (PRESETS[v]) $('model').value = PRESETS[v];
        $('visionModel').value = VISION_PRESETS[v] || '';
      }
    });
    $('btnSaveKey').addEventListener('click', () => {
      const c = getConfig();
      if (!c.base || !c.apiKey) { alert('请填写接口地址和 Key'); return; }
      saveConfig(c);
      $('keyStatus').textContent = '✅ 已保存到本机浏览器。';
    });
    $('fileTranscript').addEventListener('change', (ev) => {
      transcriptFile = ev.target.files[0] || null;
      $('transcriptName').textContent = transcriptFile ? transcriptFile.name : '未选择文件';
    });
    $('filePlan').addEventListener('change', (ev) => {
      planFile = ev.target.files[0] || null;
      $('planName').textContent = planFile ? planFile.name : '未选择';
    });
    $('btnRun').addEventListener('click', runPipeline);
    $('btnRegen').addEventListener('click', () => {
      const courses = getCoursesFromTable();
      if (!courses.length) { alert('课程表为空，请先上传成绩单或手动添加课程。'); return; }
      $('runStatus').textContent = '重新生成中……';
      runAnalysis(courses);
    });
    $('btnAddCourse').addEventListener('click', () => {
      const tbody = $('coursesTable').querySelector('tbody');
      const idx = tbody.children.length;
      tbody.appendChild(buildCourseRow('', idx));
      const inputs = tbody.querySelectorAll('.course-input');
      if (inputs.length) { inputs[inputs.length - 1].focus(); }
    });
    $('btnExportPdf').addEventListener('click', exportPdf);

    // 两级选择：学科门类（主目录）→ 具体专业（子目录，含研究生学科与二级学科）
    function populateMajorOptions(level) {
      const gate = $('majorGroup').value;
      const mSel = $('majorSelect');
      mSel.innerHTML = '';
      const g = groupData.find((x) => x.gate === gate);
      if (g) {
        for (const e of g.entries) {
          if (level !== 'auto' && e.level !== level) continue;
          const o = document.createElement('option');
          o.value = e.value;
          o.textContent = e.label;
          mSel.appendChild(o);
        }
      }
      const oc = document.createElement('option');
      oc.value = '__custom__';
      oc.textContent = '其他专业（手动输入）…';
      mSel.appendChild(oc);
      $('majorCustom').style.display = mSel.value === '__custom__' ? '' : 'none';
    }

    $('majorGroup').addEventListener('change', () => populateMajorOptions($('levelSelect').value));
    $('majorSelect').addEventListener('change', () => {
      $('majorCustom').style.display = $('majorSelect').value === '__custom__' ? '' : 'none';
      $('step2Body').innerHTML = '';
      $('step3Body').innerHTML = '';
      $('reportBody').innerHTML = '';
    });
    $('levelSelect').addEventListener('change', () => {
      refreshMajorSelects();
      $('step2Body').innerHTML = '';
      $('step3Body').innerHTML = '';
      $('reportBody').innerHTML = '';
      $('runStatus').textContent = '学历层次已切换，点击「开始一键分析」重新生成。';
    });
    try {
      const seed = await getSeed();
      const grad = await getGrad();
      const codes = await getCodes();
      const gateMap = {};
      const addEntry = (gate, value, label, level) => {
        if (!gateMap[gate]) gateMap[gate] = [];
        gateMap[gate].push({ value, label, level });
      };
      for (const cat of seed.categories) {
        for (const m of cat.majors) {
          const code = codes && codes.majors && codes.majors[m.name] ? codes.majors[m.name] : '';
          addEntry(gateOf(code), m.name, m.name + '（本科 · ' + cat.category + (code ? ' · ' + code : '') + '）', 'undergrad');
        }
      }
      for (const d of (grad.disciplines || [])) {
        addEntry(gateOf(d.code), d.name, d.name + '（研究生学科 · ' + d.code + '）', 'grad');
        for (const s of (d.subs || [])) {
          addEntry(gateOf(d.code), d.name + '::' + s, s + '（二级学科 · ' + d.name + '）', 'grad');
        }
      }
      groupData = GATE_ORDER
        .map((k) => ({ gate: GATE[k] || '其他', entries: gateMap[GATE[k] || '其他'] || [] }))
        .filter((g) => g.entries.length);
      refreshMajorSelects = () => {
        const level = ($('levelSelect').value === 'undergrad' || $('levelSelect').value === 'grad') ? $('levelSelect').value : 'auto';
        const gSel = $('majorGroup');
        const prevGate = gSel.value;
        gSel.innerHTML = '';
        for (const g of groupData) {
          const opts = g.entries.filter((e) => level === 'auto' || e.level === level);
          if (!opts.length) continue;
          const og = document.createElement('option');
          og.value = g.gate;
          const nUnd = g.entries.filter((e) => e.level === 'undergrad').length;
          const nGrad = g.entries.filter((e) => e.level === 'grad').length;
          og.textContent = g.gate + (level === 'auto' ? '（本科 ' + nUnd + ' / 研究生 ' + nGrad + '）' : '');
          gSel.appendChild(og);
        }
        if (gSel.querySelector('option[value="' + prevGate + '"]')) gSel.value = prevGate;
        populateMajorOptions(level);
      };
      refreshMajorSelects();
    } catch (e) { /* 数据加载失败不影响其他功能 */ }
  });
})();
