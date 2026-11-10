#!/usr/bin/env node
/**
 * fuhe-tool CLI —— 留学认证复核自助工具
 * 零运行时依赖，Node >= 18。
 *
 * 用法：
 *   node fuhe.mjs research --major 计算机科学与技术 --schools 清华大学,北京大学 [--out out]
 *   node fuhe.mjs report   --major 计算机科学与技术 --school 清华大学 [--courses "数据结构,操作系统"] [--out report]
 *
 * 搜索策略：Bing 优先（国内网络可达），失败自动回退 DuckDuckGo（海外）。
 *
 * 可选环境变量（report 的 LLM 润色）：
 *   LLM_BASE_URL  OpenAI 兼容接口地址（如 https://api.deepseek.com）
 *   LLM_API_KEY   API Key
 *   LLM_MODEL     模型名（默认 deepseek-chat）
 *
 * 免责声明：本工具仅做信息搜集与文档整理，不承诺复核结果，最终以留服中心审核为准。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const DEFAULT_OUT = 'out';

function getArg(argv, name, dft = '') {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : dft;
}

function usage() {
  console.log(`
fuhe-tool CLI —— 留学认证复核自助工具（零依赖，Node >= 18）

用法:
  node fuhe.mjs research --major 计算机科学与技术 --schools 清华大学,北京大学 [--code 0812] [--out out]
      自动搜索各校《培养方案》/课程设置页面，下载原始页面到本地并生成摘要（--code 为学科/专业代码，检索更精准）
  node fuhe.mjs report   --major 计算机科学与技术 --school 清华大学 [--courses "数据结构,操作系统,算法"] [--out report]
      生成课程对比文档（Markdown）；配置 LLM 环境变量后可自动润色"对比说明"段落

可选环境变量:
  LLM_BASE_URL  OpenAI 兼容接口地址（如 https://api.deepseek.com）
  LLM_API_KEY   API Key
  LLM_MODEL     模型名（默认 deepseek-chat）

注意: 本工具仅做信息搜集与文档整理，不承诺复核结果，最终以留服中心审核为准。
`);
}

async function fetchText(url, timeout = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function decodeDdgUrl(u) {
  try {
    const p = new URL(u);
    if (p.hostname.includes('duckduckgo')) {
      const t = p.searchParams.get('uddg');
      if (t) return decodeURIComponent(t);
    }
    return u;
  } catch {
    return u;
  }
}

async function fetchBuffer(url, timeout = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

async function searchLinks(q, n = 5) {
  // Bing 优先（国内可达），失败时回退 DuckDuckGo（海外可用）
  const engines = [
    {
      name: 'bing',
      url: `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
      parse: (html) => [...html.matchAll(/<h2[^>]*><a[^>]*href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
    },
    {
      name: 'ddg',
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
      parse: (html) => [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)].map((m) => decodeDdgUrl(m[1].replace(/&amp;/g, '&')))
    }
  ];
  for (const eng of engines) {
    try {
      const html = await fetchText(eng.url);
      const links = eng.parse(html).filter((l) => /^https?:/.test(l) && !/bing\.com|microsoft|msn\.com|duckduckgo/i.test(l));
      if (links.length) {
        const seen = new Set();
        return links.filter((l) => (seen.has(l) ? false : (seen.add(l), true))).slice(0, n);
      }
    } catch (e) {
      console.error(`  [${eng.name}] 搜索失败: ${e.message}`);
    }
  }
  return [];
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|\s]+/g, '_');
}

async function cmdResearch(argv) {
  const major = getArg(argv, '--major');
  const code = getArg(argv, '--code');
  const schools = getArg(argv, '--schools').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const out = getArg(argv, '--out', DEFAULT_OUT);
  if (!major || !schools.length) {
    console.error('缺少 --major 或 --schools 参数');
    usage();
    process.exit(1);
  }
  const qPrefix = code ? `${code} ` : '';
  const base = path.join(out, 'research', safeName(major));
  await mkdir(base, { recursive: true });
  const allLinks = [];
  for (const school of schools) {
    console.log(`\n== ${school} · ${major} ==`);
    let links = [];
    try {
      console.log('[1/2] 搜索培养方案 ...');
      links = await searchLinks(`${school} ${qPrefix}${major} 培养方案`);
    } catch (e) {
      console.error(`  搜索失败: ${e.message}`);
    }
    if (!links.length) {
      try {
        links = await searchLinks(`${school} ${qPrefix}${major} 课程设置`);
      } catch { /* ignore */ }
    }
    console.log(`  找到 ${links.length} 条链接`);
    const dir = path.join(base, safeName(school));
    await mkdir(dir, { recursive: true });
    const entries = [];
    for (const [i, link] of links.entries()) {
      console.log(`  [2/2] 下载 ${i + 1}/${links.length}: ${link.slice(0, 72)}`);
      try {
        if (/\.pdf(\?|$)/i.test(link)) {
          const buf = await fetchBuffer(link);
          const file = path.join(dir, `src-${i + 1}.pdf`);
          await writeFile(file, buf);
          entries.push({ link, snippet: '（PDF 文件已存档，请用 pdftotext 或浏览器打开提取课程信息）' });
        } else {
          const text = await fetchText(link);
          const file = path.join(dir, `src-${i + 1}.html`);
          await writeFile(file, text);
          const plain = stripHtml(text).slice(0, 1500);
          entries.push({ link, snippet: plain });
        }
        allLinks.push({ school, link });
        await new Promise((r) => setTimeout(r, 300));
      } catch (e) {
        console.error(`    下载失败: ${e.message}`);
      }
    }
    let md = `# ${school} · ${major} 培养方案检索结果\n\n> 生成时间: ${new Date().toISOString()}\n> 检索关键词: "${school} ${qPrefix}${major} 培养方案"\n\n`;
    for (const [i, e] of entries.entries()) {
      md += `## 来源 ${i + 1}\n\n- 链接: ${e.link}\n\n### 页面文本摘要（前 1500 字）\n\n\`\`\`\n${e.snippet}\n\`\`\`\n\n`;
    }
    if (!entries.length) {
      md += '\n未获取到可用页面。请手动访问高校教务处/学院官网查找培养方案，或更换检索词后重试。\n';
    }
    await writeFile(path.join(dir, 'summary.md'), md);
  }
  let idx = `# ${major} 检索索引\n\n> 生成时间: ${new Date().toISOString()}\n\n`;
  for (const l of allLinks) idx += `- [${l.school}] ${l.link}\n`;
  await writeFile(path.join(base, 'index.md'), idx);
  console.log(`\n完成。输出目录: ${path.resolve(base)}`);
  console.log(`下一步: node fuhe.mjs report --major ${major} --school ${schools[0]}`);
}

async function llmChat(prompt) {
  const base = (process.env.LLM_BASE_URL || '').replace(/\/+$/, '');
  const key = process.env.LLM_API_KEY;
  if (!base || !key) return '';
  let extra = {};
  if (process.env.LLM_EXTRA_JSON) {
    try {
      const v = JSON.parse(process.env.LLM_EXTRA_JSON);
      if (v && typeof v === 'object' && !Array.isArray(v)) extra = v;
    } catch { /* 忽略非法额外参数 */ }
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || 'deepseek-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      ...extra
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
}

async function cmdReport(argv) {
  const major = getArg(argv, '--major');
  const school = getArg(argv, '--school');
  const courses = getArg(argv, '--courses').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const out = getArg(argv, '--out', 'report');
  if (!major || !school) {
    console.error('缺少 --major 或 --school 参数');
    usage();
    process.exit(1);
  }
  await mkdir(out, { recursive: true });

  let explanation = '（模板占位）请人工补充：结合目标高校《培养方案》中' + major + '专业核心课程，逐门说明国外课程与国内课程的对应关系，突出内容相近性。';
  if (process.env.LLM_API_KEY && process.env.LLM_BASE_URL) {
    try {
      console.log('调用 LLM 生成对比说明草稿 ...');
      const prompt = `你是留学学历认证复核文书助手。用户国外专业课程: ${courses.join('、') || '（未提供）'}。目标复核专业: ${major}（参考高校: ${school}）。请写一段 200-300 字的"课程对比说明"草稿：说明国外课程与国内${major}专业核心课程的对应关系，语气客观、具体，不承诺审核结果，不出现"保证通过"等表述。`;
      const text = await llmChat(prompt);
      if (text) explanation = text + '\n\n> 以上为 LLM 草稿，请人工核对课程对应关系后再使用。';
    } catch (e) {
      console.error(`  LLM 调用失败: ${e.message}`);
    }
  }

  const rows = courses.length
    ? courses.map((c) => `| ${c} | 待核对 | 请人工对照${school} ${major}培养方案填写对应课程 |`).join('\n')
    : '| （未提供课程，请用 --courses "课1,课2,..." 补充） | - | - |';

  const md = `# ${major} 课程对比文档（草稿）

> 生成时间: ${new Date().toISOString()}
> 目标复核专业: ${major}　|　参考高校: ${school}
> 本文件为整理草稿，仅供申报材料撰写参考，不构成任何结果承诺。

## 一、申请人国外课程清单

| 序号 | 国外课程 |
|---|---|
${courses.length ? courses.map((c, i) => `| ${i + 1} | ${c} |`).join('\n') : '| - | （未提供课程，请用 --courses "课1,课2,..." 补充） |'}

## 二、课程对比表

| 国外课程 | 是否对应 | 对应的国内${major}专业课程（人工填写） |
|---|---|---|
${rows}

## 三、课程对比说明

${explanation}

## 四、申报材料自查清单

- [ ] 国外学历学位认证书（原件扫描件）
- [ ] 国外高校官方成绩单（含课程名称、学分、成绩）
- [ ] 课程对比说明（本文档 + 目标高校培养方案作为参考依据）
- [ ] 目标高校《培养方案》来源说明（官网链接或文件）
- [ ] 其他留服中心要求的材料（以申请系统提示为准）

## 五、提交要点（通用提示，以留服中心现行规定为准）

1. 改名目标必须是国内《专业参考目录》中真实存在的专业名称，不能自定义；
2. 对比说明应客观陈述课程相近性，避免夸大或保证性表述；
3. 留服中心对复核结果有最终裁量权，材料质量直接影响审核周期与结果。

---
*免责声明：本文档由 fuhe-tool 生成，仅辅助整理，最终以教育部留学服务中心审核为准。*
`;
  const file = path.join(out, `${safeName(school)}-${safeName(major)}-对比文档.md`);
  await writeFile(file, md);
  console.log(`已生成: ${path.resolve(file)}`);
}

const cmd = process.argv[2];
if (cmd === 'research') await cmdResearch(process.argv.slice(2));
else if (cmd === 'report') await cmdReport(process.argv.slice(2));
else usage();
