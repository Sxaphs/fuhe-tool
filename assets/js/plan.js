/* 培养方案查询：核心课程参考 + 收录链接 + 一键搜索 */
(function () {
  'use strict';

  const SEED_URL = 'data/majors.seed.json';
  const CODES_URL = 'data/major-codes.json';
  const PLAN_URL = 'data/plan-seed.json';

  const DEFAULT_SCHOOLS = [
    '清华大学', '北京大学', '浙江大学', '上海交通大学', '复旦大学', '南京大学',
    '中国科学技术大学', '华中科技大学', '武汉大学', '西安交通大学', '哈尔滨工业大学', '同济大学'
  ];

  const $ = (id) => document.getElementById(id);
  let seed = null, codes = null, plan = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function findMajor(name, code) {
    if (!seed) return null;
    const n = String(name || '').trim();
    const c = String(code || '').trim();
    let byCode = null;
    if (codes && c) {
      for (const [mn, mc] of Object.entries(codes.majors || {})) {
        if (String(mc) === c) { byCode = mn; break; }
      }
    }
    let best = null, bestScore = 0;
    for (const cat of seed.categories) {
      for (const m of cat.majors) {
        if (!n && !c) return null;
        if (n && m.name === n) return m; // 精确命中优先
        if (byCode && m.name === byCode) return m;
        if (n) {
          const score = m.name.includes(n) || n.includes(m.name) ? 1 : 0;
          if (score > bestScore) { bestScore = score; best = m; }
        }
      }
    }
    return best;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        alert('已复制到剪贴板');
      }).catch(() => { prompt('请手动复制：', text); });
    } else {
      prompt('请手动复制：', text);
    }
  }

  function render(major, name, code) {
    const box = $('results');
    if (!major) {
      box.innerHTML = '<div class="card"><p class="muted">在种子数据中没有找到"<strong>' + esc(name || code || '') + '</strong>"对应的专业。'
        + '请检查名称（用国内专业全名，如"计算机科学与技术"），或先到<a href="tool.html">匹配工具</a>看你的国外课程对应哪些国内专业。</p></div>';
      return;
    }
    const matchedCode = codes && codes.majors && codes.majors[major.name] ? codes.majors[major.name] : '';
    const qCode = code || matchedCode || '';
    const schools = (plan && plan.schools && plan.schools.length) ? plan.schools : DEFAULT_SCHOOLS;

    let html = '';

    // 1. 核心课程参考
    const courses = (major.coreCourses || []).map((c) => (typeof c === 'string' ? c : c.zh));
    const courseText = courses.join('\n');
    html += '<div class="card"><div class="cover"><div><h2 style="margin:0;">核心课程参考（' + esc(major.name) + '）</h2>'
      + '<span class="muted small">来自社区维护的种子数据，供撰写课程对比说明时参考；请以目标高校培养方案为准</span></div>'
      + (courses.length ? '<button class="btn ghost small" id="btnCopyCourses">复制课程列表</button>' : '') + '</div>'
      + '<div class="mt">' + (courses.length
        ? courses.map((c) => '<span class="chip">' + esc(c) + '</span>').join('')
        : '<span class="muted small">该专业暂无核心课程数据</span>') + '</div></div>';

    // 2. 专业代码
    html += '<div class="card"><h2>专业代码</h2><p>'
      + (matchedCode
        ? '<strong style="font-size:1.2rem;">' + esc(matchedCode) + '</strong>　<span class="muted small">（教育部《普通高等学校本科专业目录（2025年）》，与种子数据同名专业对应）</span>'
        : (qCode
          ? '你输入的代码 <strong>' + esc(qCode) + '</strong> 未在代码库中匹配到该专业，请核对官方目录。'
          : '代码库中暂无该专业代码，可在下方一键搜索中带上代码查询高校官网。'))
      + '</p></div>';

    // 3. 已收录培养方案链接
    const entries = (plan && plan.entries || []).filter((e) => e.major === major.name);
    html += '<div class="card"><h2>已收录的培养方案链接</h2>';
    if (entries.length) {
      html += '<ul>';
      for (const e of entries) {
        html += '<li><a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.title || (e.school + ' · ' + e.major)) + '</a>'
          + '<span class="muted small">　' + esc(e.school) + (e.kind === 'pdf' ? ' · PDF' : '') + '</span></li>';
      }
      html += '</ul><p class="muted small">收录链接有限，欢迎到 GitHub 提 PR 补充（data/plan-seed.json）。</p>';
    } else {
      html += '<p class="muted small">暂无该专业的收录链接。用下方一键搜索直达高校官网，或提 PR 补充数据。</p>';
    }
    html += '</div>';

    // 4. 一键搜索
    const kw = encodeURIComponent(major.name + (qCode ? ' ' + qCode : '') + ' 培养方案');
    html += '<div class="card"><h2>一键搜索各校培养方案</h2><p class="muted small">点开即可在搜索引擎中直达目标高校的培养方案页面（建议优先看教务处/学院官网）。</p>';
    for (const s of schools) {
      const bd = 'https://www.baidu.com/s?wd=' + encodeURIComponent(s + ' ' + major.name + (qCode ? ' ' + qCode : '') + ' 培养方案');
      const bi = 'https://www.bing.com/search?q=' + encodeURIComponent(s + ' ' + major.name + (qCode ? ' ' + qCode : '') + ' 培养方案');
      html += '<span class="chip"><a href="' + esc(bd) + '" target="_blank" rel="noopener">' + esc(s) + ' · 百度</a></span>'
        + '<span class="chip"><a href="' + esc(bi) + '" target="_blank" rel="noopener">' + esc(s) + ' · Bing</a></span>';
    }
    html += '</div>';

    // 5. CLI 提示
    html += '<div class="card"><h2>深度搜集（自动下载）</h2><pre>node cli/fuhe.mjs research --major ' + major.name + ' --schools ' + schools.slice(0, 3).join(',') + '</pre>'
      + '<p class="muted small">CLI 会搜索并下载各校培养方案页面/PDF 到本地，再运行 <code>report</code> 生成课程对比文档。详见 <a href="https://github.com/Sxaphs/fuhe-tool" target="_blank" rel="noopener">GitHub</a>。</p></div>';

    box.innerHTML = html;
    const btn = $('btnCopyCourses');
    if (btn) btn.addEventListener('click', () => copyText(courseText));
  }

  async function init() {
    try {
      const [r1, r2, r3] = await Promise.all([
        fetch(SEED_URL).then((r) => r.json()),
        fetch(CODES_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(PLAN_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      ]);
      seed = r1; codes = r2; plan = r3;
      $('status').textContent = '数据加载完成：' + seed.categories.length + ' 个专业类、' + (r3 ? (r3.entries || []).length + ' 条培养方案链接' : '培养方案链接库待补充');
      const q = new URLSearchParams(location.search);
      const major = q.get('major') || '';
      const code = q.get('code') || '';
      if (major || code) {
        $('majorInput').value = major;
        $('codeInput').value = code;
        render(findMajor(major, code), major, code);
      }
    } catch (e) {
      $('status').textContent = '数据加载失败：' + e.message;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    init();
    $('btnQuery').addEventListener('click', () => {
      const name = $('majorInput').value.trim();
      const code = $('codeInput').value.trim();
      if (!name && !code) { alert('请输入专业名或专业代码'); return; }
      render(findMajor(name, code), name, code);
      $('status').textContent = '查询：' + (name || '') + (code ? '（代码 ' + code + '）' : '');
    });
    ['majorInput', 'codeInput'].forEach((id) => {
      $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnQuery').click(); });
    });
  });
})();
