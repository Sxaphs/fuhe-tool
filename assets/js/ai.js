/* AI 助手：Key 存 localStorage，浏览器直连 OpenAI 兼容 API */
(function () {
  'use strict';

  const STORE_KEY = 'fuhe-ai-config';
  const $ = (id) => document.getElementById(id);

  const PRESETS = {
    'https://api.deepseek.com': 'deepseek-chat',
    'https://api.moonshot.cn/v1': 'moonshot-v1-8k',
    'https://openrouter.ai/api/v1': 'deepseek/deepseek-chat'
  };

  function loadConfig() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch { return {}; }
  }
  function saveConfig(cfg) {
    localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
  }
  function clearConfig() {
    localStorage.removeItem(STORE_KEY);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function getApi() {
    const baseSel = $('baseUrl').value;
    const base = baseSel === 'custom' ? $('customBase').value.trim().replace(/\/+$/, '') : baseSel;
    const key = $('apiKey').value.trim() || (loadConfig().apiKey || '');
    const model = $('model').value.trim() || loadConfig().model || 'deepseek-chat';
    return { base, key, model };
  }

  async function generate() {
    const { base, key, model } = getApi();
    const major = $('major').value.trim();
    const courses = $('courses').value.split(/[\n,，;；]+/).map((s) => s.trim()).filter(Boolean);
    if (!key) { alert('请先填写并保存 API Key'); return; }
    if (!major) { alert('请填写目标复核专业'); return; }
    if (!courses.length) { alert('请填写国外课程列表'); return; }

    const st = $('genStatus');
    st.textContent = '生成中……';
    const school = $('school').value.trim();
    const prompt = '你是留学学历认证复核文书助手。用户国外专业课程: ' + courses.join('、') +
      '。目标复核专业: ' + major + (school ? '（参考高校: ' + school + '）' : '') +
      '。请写一段 300-500 字的"课程对比说明"草稿：说明国外课程与国内' + major + '专业核心课程的对应关系，语气客观、具体，逐门说明相近性；不承诺审核结果，不出现"保证通过""包过"等表述。';

    try {
      const res = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 2000
        })
      });
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).error && (await res.json()).error.message; } catch { /* ignore */ }
        if (res.status === 401) throw new Error('401：API Key 无效或未授权，请检查');
        if (res.status === 429) throw new Error('429：请求过于频繁或余额不足');
        throw new Error('HTTP ' + res.status + (detail ? '：' + detail : '（若为 CORS/网络错误，请确认该服务商支持浏览器直连）'));
      }
      const j = await res.json();
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      if (!text) throw new Error('响应中未找到文本内容');
      $('result').value = text;
      $('resultCard').style.display = '';
      st.textContent = '完成';
    } catch (e) {
      st.textContent = '';
      alert('生成失败：' + e.message);
    }
  }

  function copyResult() {
    const t = $('result').value;
    if (!t) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(() => alert('已复制')).catch(() => prompt('请手动复制：', t));
    } else prompt('请手动复制：', t);
  }

  function exportPdf() {
    const major = $('major').value.trim() || '目标专业';
    const school = $('school').value.trim();
    const text = $('result').value;
    if (!text) { alert('还没有生成内容'); return; }
    const w = window.open('', '_blank');
    if (!w) { alert('请允许弹窗后再试'); return; }
    w.document.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>' + esc(major) + ' 课程对比说明</title>'
      + '<style>body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.8;max-width:760px;margin:32px auto;padding:0 24px;color:#111;}'
      + 'h1{font-size:20px;border-bottom:2px solid #2563eb;padding-bottom:8px;}'
      + 'pre{white-space:pre-wrap;font-family:inherit;}'
      + '.meta{color:#555;font-size:13px;margin-bottom:16px;}'
      + '.foot{margin-top:32px;font-size:12px;color:#888;border-top:1px solid #ddd;padding-top:8px;}</style></head><body>'
      + '<h1>' + esc(major) + ' 课程对比说明（草稿）</h1>'
      + '<div class="meta">目标复核专业：' + esc(major) + (school ? '　|　参考高校：' + esc(school) : '') + '<br>生成时间：' + new Date().toLocaleString('zh-CN') + '</div>'
      + '<pre>' + esc(text) + '</pre>'
      + '<div class="foot">本文档由 fuhe-tool 生成，仅供申报材料撰写参考，不承诺复核结果；请人工核对后使用。最终以教育部留学服务中心审核为准。</div>'
      + '</body></html>');
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  }

  function refreshKeyStatus() {
    const cfg = loadConfig();
    const st = $('keyStatus');
    if (cfg.apiKey && cfg.base) {
      st.textContent = '✅ 本机已保存配置：' + cfg.base + ' / ' + (cfg.model || '（未存模型）') + '（Key 已隐藏）';
    } else {
      st.textContent = '尚未保存配置（也可以直接输入 Key 不保存，仅本次会话有效）。';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const cfg = loadConfig();
    if (cfg.base && PRESETS[cfg.base]) {
      $('baseUrl').value = cfg.base;
      $('model').value = cfg.model || PRESETS[cfg.base];
    } else if (cfg.base) {
      $('baseUrl').value = 'custom';
      $('customBase').style.display = '';
      $('customBase').value = cfg.base;
      $('model').value = cfg.model || '';
    }
    if (cfg.apiKey) { $('apiKey').value = cfg.apiKey; }
    refreshKeyStatus();

    // 从其他页面带入专业（如 tool.html?major= / 匹配结果的跳转）
    const q = new URLSearchParams(location.search);
    if (q.get('major')) $('major').value = q.get('major');

    $('baseUrl').addEventListener('change', () => {
      const v = $('baseUrl').value;
      $('customBase').style.display = v === 'custom' ? '' : 'none';
      if (v !== 'custom' && PRESETS[v]) $('model').value = PRESETS[v];
    });

    $('btnSave').addEventListener('click', () => {
      const { base, key, model } = getApi();
      if (!base || !key) { alert('请填写接口地址和 Key'); return; }
      saveConfig({ base, key, model });
      refreshKeyStatus();
      alert('已保存到本机浏览器（localStorage）');
    });
    $('btnClearKey').addEventListener('click', () => {
      clearConfig();
      $('apiKey').value = '';
      refreshKeyStatus();
      alert('已清除本机保存的配置');
    });
    $('btnGenerate').addEventListener('click', generate);
    $('btnCopy').addEventListener('click', copyResult);
    $('btnExportPdf').addEventListener('click', exportPdf);

    // 成绩单上传（单文件 PDF/CSV/TXT，本地解析 → 展示识别结果供确认修改）
    $('fileTranscriptAi').addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const name = String(f.name || '').toLowerCase();
      $('uploadStatus').textContent = '正在本地解析（不会上传任何数据）……';
      const done = (list) => {
        $('courses').value = list.join('\n');
        $('uploadStatus').textContent = '✅ 识别到 ' + list.length + ' 门课程——已在下方展示，请确认（可直接修改），然后点「生成对比说明」。';
      };
      if (name.endsWith('.pdf')) {
        window.FuhePdf.parseCourseListFromPdf(f).then(done).catch((e) => {
          $('uploadStatus').textContent = '解析失败：' + e.message;
        });
      } else {
        f.text().then((t) => done(window.FuhePdf.parseCsvText(t))).catch((e) => {
          $('uploadStatus').textContent = '读取失败：' + e.message;
        });
      }
    });
  });
})();
