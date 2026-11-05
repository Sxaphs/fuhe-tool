/* 考公专业目录对照：数据来自 data/civil-service-catalog.json */
(function () {
  'use strict';

  const DATA_URL = 'data/civil-service-catalog.json';
  const $ = (id) => document.getElementById(id);
  let data = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function norm(s) {
    return String(s || '').replace(/\s+/g, '').toLowerCase();
  }

  function renderAll() {
    let html = '';
    for (const c of data.categories) {
      html += '<div class="card result-card"><div class="cover"><div><span class="badge">' + c.index + '</span><strong>' + esc(c.category) + '</strong></div>'
        + '<span class="muted small">' + c.majors.length + ' 个专业</span></div>'
        + '<div class="mt">' + (c.majors.length
          ? c.majors.map((m) => '<span class="chip">' + esc(m) + '</span>').join('')
          : '<span class="chip miss">参照英语相关专业</span>') + '</div></div>';
    }
    $('results').innerHTML = html;
  }

  function renderSearch(q) {
    const nq = norm(q);
    const exact = [];
    const fuzzy = [];
    for (const c of data.categories) {
      for (const m of c.majors) {
        if (norm(m) === nq) exact.push({ cat: c.category, major: m });
        else if (norm(m).includes(nq) || nq.includes(norm(m))) fuzzy.push({ cat: c.category, major: m });
      }
    }
    if (!exact.length && !fuzzy.length) {
      $('results').innerHTML = '<div class="card"><p class="muted">没有找到"<strong>' + esc(q) + '</strong>"。<br>提示：① 目录里的是国内专业名，先到<a href="tool.html">匹配工具</a>看你的国外专业可能对应哪些国内专业；② 尝试更短的词，如"会计""计算机"；③ 税务系统目录未收录不代表其他招录系统不收录。</p></div>';
      return;
    }
    let html = '';
    if (exact.length) {
      html += '<div class="card"><h3>✅ 精确匹配（' + exact.length + ' 个类别收录）</h3><p class="muted small">你的专业在这些招录类别里，对应职位均可报考。</p>';
      for (const r of exact) html += '<p><span class="badge">' + esc(r.cat) + '</span><strong>' + esc(r.major) + '</strong></p>';
      html += '</div>';
    }
    if (fuzzy.length) {
      html += '<div class="card"><h3>相近专业（' + fuzzy.length + ' 个，供参考）</h3><p class="muted small">名称不完全一致。按官方口径：相近专业报考须在"学科成绩"或"备注"栏完整填写该专业所有课程名称和成绩，由招录机关综合审查。</p>';
      for (const r of fuzzy.slice(0, 30)) html += '<p><span class="badge">' + esc(r.cat) + '</span>' + esc(r.major) + '</p>';
      html += '</div>';
    }
    $('results').innerHTML = html;
  }

  async function init() {
    try {
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
      $('stat').textContent = data.categories.length + ' 类专业 / ' + data.categories.reduce((n, c) => n + c.majors.length, 0) + ' 个专业';
      $('policyList').innerHTML = (data.policy || []).map((p) => '<li>' + esc(p) + '</li>').join('');
      $('status').textContent = '数据加载完成。输入专业名查询，或直接浏览全部类别。';
      const q = new URLSearchParams(location.search).get('q');
      if (q) {
        $('searchInput').value = q;
        renderSearch(q);
      } else {
        renderAll();
      }
    } catch (e) {
      $('status').textContent = '目录数据加载失败：' + e.message;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    init();
    $('btnSearch').addEventListener('click', () => {
      const q = $('searchInput').value.trim();
      if (!q) { renderAll(); $('status').textContent = '显示全部类别。'; return; }
      renderSearch(q);
      $('status').textContent = '查询："' + q + '"（税务系统 2026 目录）';
    });
    $('btnClear').addEventListener('click', () => {
      $('searchInput').value = '';
      renderAll();
      $('status').textContent = '显示全部类别。';
    });
    $('searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnSearch').click(); });
  });
})();
