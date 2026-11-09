/* fuhe-tool 主流水线：配置 → 上传 → 一键分析（识别 → 匹配专业 → 找培养方案 → 出报告）
 * 全部本地处理；AI 请求直发用户配置的服务商。
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const AI_KEY = 'fuhe-ai-config';
  const DATA_URL = 'data/majors.seed.json';
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

  /* ---------- 数据缓存 ---------- */
  let seedCache = null, planCoursesCache = null, planSeedCache = null, codesCache = null;
  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  const getSeed = () => seedCache || (seedCache = getJson(DATA_URL));
  const getPlanCourses = () => planCoursesCache || (planCoursesCache = getJson(PLAN_COURSES_URL).catch(() => ({ entries: [] })));
  const getPlanSeed = () => planSeedCache || (planSeedCache = getJson(PLAN_SEED_URL).catch(() => ({ schools: SCHOOLS, entries: [] })));
  const getCodes = () => codesCache || (codesCache = getJson(CODES_URL).catch(() => null));

  /* ---------- 工具 ---------- */
  function normalize(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function parseCourses(text) {
    return String(text || '').split(/[\n,，;；、\t\r]+/).map((s) => s.trim()).filter((s) => s.length >= 2);
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

  /* ---------- 匹配（课程 → 候选专业） ---------- */
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

  /* ---------- 学校课表匹配（桥接双语关键词） ---------- */
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

  /* ---------- 成绩单识别（自动选路：文字层 → AI 视觉 → 本地 OCR） ---------- */
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
          try { return { courses: await window.FuhePdf.parseViaVisionApi(file), method: 'AI 视觉识别（' + cfg.visionModel + '）' }; } catch (e2) { throw new Error(e2.message); }
        }
        throw e;
      }
    }
    if (isImage) {
      if (hasVision) {
        try { return { courses: await window.FuhePdf.parseViaVisionApi(file), method: 'AI 视觉识别（' + cfg.visionModel + '）' }; }
        catch (e) { /* 视觉失败回落本地 OCR */ }
      }
      try { return { courses: await window.FuhePdf.parseImageViaOcr(file), method: '本地 OCR（德语+英语+中文）' }; }
      catch (e) { throw new Error('截图识别失败：' + e.message + (hasVision ? '' : '。提示：配置视觉模型（Moonshot/OpenRouter）可大幅提升识别率')); }
    }
    return { courses: window.FuhePdf.parseCsvText(await file.text()), method: '文本解析' };
  }

  /* ---------- 培养方案解析（用户上传） ---------- */
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

  /* ---------- 第 3 步：学校培养方案匹配 ---------- */
  function renderStep3(courses, majorEntry, majorName, uploadPlanCourses, planSeed) {
    const bridge = buildBridge(majorEntry || { coreCourses: [] });
    const planEntries = ((planCoursesCache && planCoursesCache.entries) || []).filter((e) => e.major === majorName);
    const linkEntries = (planSeed && planSeed.entries || []).filter((e) => e.major === majorName);

    let html = '';
    const rows = [];
    for (const e of planEntries) {
      const hits = matchSchoolCourses(courses, e.courses, bridge);
      rows.push({ school: e.school, year: e.year || '', hits, total: e.courses.length, source: e.source, kind: '收录' });
    }
    if (uploadPlanCourses && uploadPlanCourses.length) {
      const hits = matchSchoolCourses(courses, uploadPlanCourses, bridge);
      rows.push({ school: '你上传的培养方案', year: '', hits, total: uploadPlanCourses.length, source: '', kind: '上传' });
    }
    rows.sort((a, b) => (b.hits.length / Math.max(b.total, 1)) - (a.hits.length / Math.max(a.total, 1)));

    if (rows.length) {
      html += '<table><tr><th>学校 / 来源</th><th>课程重合度</th><th>匹配课程数</th><th>来源</th></tr>';
      for (const r of rows) {
        const cov = r.total ? Math.round(r.hits.length / r.total * 100) : 0;
        html += '<tr><td><strong>' + esc(r.school) + '</strong>' + (r.year ? '<span class="muted small">（' + esc(r.year) + '）</span>' : '') + (r.kind === '上传' ? '<span class="badge">用户上传</span>' : '') + '</td>'
          + '<td><div class="bar" style="width:110px;display:inline-block;vertical-align:middle;margin-right:6px;"><i style="width:' + cov + '%"></i></div>' + cov + '%</td>'
          + '<td>' + r.hits.length + ' / ' + r.total + '</td>'
          + '<td class="small">' + (r.source ? '<a href="' + esc(r.source) + '" target="_blank" rel="noopener">培养方案 ↗</a>' : '—') + '</td></tr>';
        if (r.hits.length) html += '<tr><td colspan="4" class="small muted">命中课程：' + r.hits.map(esc).join('、') + '</td></tr>';
      }
      html += '</table>';
    } else {
      html += '<div class="warn">⚠️ 该专业暂未收录任何学校的课表数据。<br>'
        + '① 建议直接在上方「📎 上传目标学校培养方案」上传文件后重新分析；<br>'
        + '② 或通过下方一键搜索去各校官网下载培养方案：</div>';
    }
    if (linkEntries.length) {
      html += '<p class="muted small mt">已收录的该专业培养方案链接：</p><ul class="small">';
      for (const e of linkEntries) html += '<li><a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.school) + ' · ' + esc(majorName) + (e.kind === 'pdf' ? '（PDF）' : '') + '</a></li>';
      html += '</ul>';
    }
    html += '<p class="muted small mt">一键搜索各校培养方案（' + majorName + '）：</p>';
    const schools = (planSeed && planSeed.schools && planSeed.schools.length) ? planSeed.schools : SCHOOLS;
    for (const s of schools.slice(0, 6)) {
      const bd = 'https://www.baidu.com/s?wd=' + encodeURIComponent(s + ' ' + majorName + ' 培养方案');
      const bi = 'https://www.bing.com/search?q=' + encodeURIComponent(s + ' ' + majorName + ' 培养方案');
      html += '<span class="chip"><a href="' + esc(bd) + '" target="_blank" rel="noopener">' + esc(s) + ' · 百度</a></span><span class="chip"><a href="' + esc(bi) + '" target="_blank" rel="noopener">' + esc(s) + ' · Bing</a></span>';
    }
    $('step3Body').innerHTML = html;
  }

  /* ---------- 第 4 步：报告 ---------- */
  async function generateReport(courses, majorName, catName, step3Summary) {
    const cfg = getConfig();
    $('reportBody').innerHTML = '<p class="muted">正在生成复核建议……</p>';
    let report = '';
    if (cfg.apiKey && cfg.base && cfg.model) {
      try {
        const prompt = '你是留学学历认证复核顾问。请基于以下信息，生成一份中文《复核建议报告》：\n'
          + '【目标复核专业】' + majorName + (catName ? '（' + catName + '）' : '') + '\n'
          + '【国外成绩单课程】\n' + courses.join('\n') + '\n'
          + '【学校培养方案匹配情况】\n' + step3Summary + '\n'
          + '要求：1) 课程对比分析：逐类说明国外课程与目标专业核心课程的对应关系；2) 建议选择哪所学校的培养方案作为对比依据及理由；3) 复核材料清单与提交流程要点（认证书、成绩单、课程对比说明、目标高校培养方案等，PDF 单文件 1M 以下）；4) 风险提示（复核免费、12 个月内申请、仅 1 次机会、最终以留服中心审核为准）。不承诺结果，不出现"包过"。用 markdown 输出。';
        const res = await fetch(cfg.base.replace(/\/+$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
          body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 2500 })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        report = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      } catch (e) {
        report = 'AI 生成失败（' + e.message + '），以下为模板报告。\n\n';
      }
    }
    if (!report) {
      report = '（未配置文本模型，以下为模板报告）\n\n';
      report += '# 复核建议报告（模板）\n\n';
      report += '## 一、目标复核专业\n\n' + majorName + (catName ? '（' + catName + '）' : '') + '\n\n';
      report += '## 二、国外课程清单（共 ' + courses.length + ' 门）\n\n' + courses.map((c) => '- ' + c).join('\n') + '\n\n';
      report += '## 三、学校培养方案匹配\n\n' + step3Summary + '\n\n';
      report += '## 四、申报材料自查清单\n\n- [ ] 国外学历学位认证书（原件扫描件）\n- [ ] 国外高校官方成绩单（PDF、单文件 1M 以下）\n- [ ] 课程对比说明（对照目标高校培养方案逐门说明）\n- [ ] 目标高校《培养方案》来源说明（官网链接或文件）\n- [ ] 复核原因说明（为什么复核、改哪个专业名）\n\n';
      report += '## 五、注意事项\n\n1. 改名目标必须是国内专业目录中真实存在的专业名，不能自定义；\n2. 复核免费、认证结果出具之日起 12 个月内申请、仅 1 次机会；\n3. 报考事业单位自 2024-10-25 起官方建议无需复核（人社部发〔2024〕57 号）；\n4. 本报告仅供申报参考，最终以留服中心审核为准。\n';
    }
    // 简单 markdown → html
    let html = report
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.*)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*)$/gm, '<h2>$1</h2>')
      .replace(/^- \[ \] /gm, '☐ ')
      .replace(/^- /gm, '• ')
      .replace(/^(\d+)\. /gm, '$1. ')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = '<div style="white-space:pre-wrap;line-height:1.9;">' + html + '</div>';
    $('reportBody').innerHTML = html;
  }

  function exportPdf() {
    const major = $('majorSelect').value.trim() || '目标专业';
    const text = ($('reportBody').innerText || '').trim();
    if (!text) { alert('还没有报告内容'); return; }
    const w = window.open('', '_blank');
    if (!w) { alert('请允许弹窗'); return; }
    w.document.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>' + esc(major) + ' 复核建议报告</title>'
      + '<style>body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.8;max-width:760px;margin:32px auto;padding:0 24px;color:#111;}h1,h2{border-bottom:1px solid #ddd;padding-bottom:6px;}h1{font-size:20px;}</style></head><body>'
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
    const majorName = $('majorSelect').value.trim();
    if (!transcriptFile) { alert('请先上传成绩单'); return; }
    $('runStatus').textContent = '开始分析……';
    $('pipelineResults').style.display = '';
    try {
      // 第 1 步：识别成绩单
      $('step1Badge').textContent = '识别中……';
      const r1 = await parseTranscriptAuto(transcriptFile);
      const courses = r1.courses;
      $('coursesOutput').value = courses.join('\n');
      $('step1Method').textContent = r1.method;
      $('step1Badge').textContent = '✅ ' + courses.length + ' 门课程';

      // 第 2 步：复核专业
      const seed = await getSeed();
      const found = findMajor(majorName);
      if (found) {
        const codes = await getCodes();
        const code = codes && codes.majors && codes.majors[found.major.name] ? codes.majors[found.major.name] : '';
        $('step2Badge').textContent = '✅ ' + found.major.name + '（' + found.cat + (code ? ' · ' + code : '') + '）';
      } else if (majorName) {
        $('step2Badge').textContent = '⚠️ 未在收录库中找到，按你输入的专业名继续';
      } else {
        $('step2Badge').textContent = '⚠️ 未选择专业';
      }
      const recs = matchAll(courses, seed);
      let step2Html = '';
      if (!found && majorName) {
        step2Html += '<div class="warn">「' + esc(majorName) + '」不在 74 个常见专业库中。请确认名称是否为国内专业全名；也可从下方推荐中选择。</div>';
      }
      step2Html += '<p class="muted small">按课程匹配度的候选专业（点击可直接替换上方目标专业并重新分析）：</p>';
      step2Html += recs.slice(0, 6).map((r) =>
        '<span class="chip" style="cursor:pointer;" data-pick="' + esc(r.name) + '">' + esc(r.name) + '（' + r.coverage + '%）</span>').join(' ');
      step2Html += '<span class="chip"><a href="catalog.html?q=' + encodeURIComponent(majorName || (recs[0] && recs[0].name) || '') + '" target="_blank" rel="noopener">考公目录核对 ↗</a></span>';
      $('step2Body').innerHTML = step2Html;
      $('step2Body').querySelectorAll('[data-pick]').forEach((el) => {
        el.addEventListener('click', () => {
          $('majorSelect').value = el.getAttribute('data-pick');
          $('runStatus').textContent = '已选择「' + el.getAttribute('data-pick') + '」，点击「开始一键分析」重新生成。';
          $('step3Body').innerHTML = '';
          $('reportBody').innerHTML = '';
        });
      });

      // 第 3 步：学校培养方案
      $('step3Badge').textContent = '查找中……';
      const planCourses = await getPlanCourses();
      const planSeed = await getPlanSeed();
      let uploadPlanCourses = [];
      if (planFile) {
        try {
          uploadPlanCourses = await parsePlanAuto(planFile);
          $('step3Badge').textContent = '✅ 已解析你上传的培养方案（' + uploadPlanCourses.length + ' 门课程）';
        } catch (e) {
          $('step3Badge').textContent = '⚠️ 培养方案解析失败：' + e.message;
        }
      }
      const entries = (planCourses.entries || []).filter((e) => e.major === majorName);
      if (entries.length || uploadPlanCourses.length) {
        $('step3Badge').textContent = '✅ ' + (entries.length + (uploadPlanCourses.length ? 1 : 0)) + ' 个来源';
      } else {
        $('step3Badge').textContent = '⚠️ 未收录，请上传或一键搜索';
      }
      renderStep3(courses, found ? found.major : null, majorName, uploadPlanCourses, planSeed);

      // 第 4 步：报告
      const step3SummaryText = (() => {
        const txt = [];
        for (const e of entries) {
          const hits = matchSchoolCourses(courses, e.courses, buildBridge(found ? found.major : { coreCourses: [] }));
          txt.push(e.school + '：' + hits.length + '/' + e.courses.length + ' 门课程匹配' + (hits.length ? '（' + hits.join('、') + '）' : ''));
        }
        if (uploadPlanCourses.length) {
          const hits = matchSchoolCourses(courses, uploadPlanCourses, buildBridge(found ? found.major : { coreCourses: [] }));
          txt.push('用户上传培养方案：' + hits.length + '/' + uploadPlanCourses.length + ' 门课程匹配' + (hits.length ? '（' + hits.join('、') + '）' : ''));
        }
        if (!txt.length) txt.push('暂无学校课表数据（可上传培养方案或一键搜索）');
        return txt.join('\n');
      })();
      await generateReport(courses, majorName, found ? found.cat : '', step3SummaryText);
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
    if (!cfg.base) $('visionModel').value = '';

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
      $('runStatus').textContent = '重新生成中……';
      runPipeline();
    });
    $('btnExportPdf').addEventListener('click', exportPdf);

    // 专业候选列表
    try {
      const seed = await getSeed();
      const dl = $('majorList');
      for (const cat of seed.categories) {
        for (const m of cat.majors) {
          const opt = document.createElement('option');
          opt.value = m.name;
          opt.label = m.name + '（' + cat.category + '）';
          dl.appendChild(opt);
        }
      }
    } catch (e) { /* 数据加载失败时页面其余功能仍可用 */ }
  });
})();
