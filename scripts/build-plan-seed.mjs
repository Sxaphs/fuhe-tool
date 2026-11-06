// 采集常见专业在重点高校的培养方案公开链接 → data/plan-seed.json
// 用法: node scripts/build-plan-seed.mjs（可自行增删 majors/schools 后重跑）
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'plan-seed.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const MAJORS = [
  '计算机科学与技术', '软件工程', '数据科学与大数据技术', '人工智能',
  '电子信息工程', '通信工程', '自动化', '电气工程及其自动化',
  '机械设计制造及其自动化', '金融学', '会计学', '法学'
];
const SEARCH_SCHOOLS = ['清华大学', '北京大学'];
const SCHOOLS = [
  '清华大学', '北京大学', '浙江大学', '上海交通大学', '复旦大学', '南京大学',
  '中国科学技术大学', '华中科技大学', '武汉大学', '西安交通大学', '哈尔滨工业大学', '同济大学'
];

async function fetchText(url, timeout = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

async function searchLinks(q, n = 6) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}`;
  const html = await fetchText(url);
  const links = [...html.matchAll(/<h2[^>]*><a[^>]*href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  const seen = new Set();
  const out = [];
  for (const l of links) {
    if (/^https?:/.test(l) && !/bing\.com|microsoft|msn\.com/i.test(l) && !seen.has(l)) { seen.add(l); out.push(l); }
    if (out.length >= n) break;
  }
  return out;
}

function isUseful(url) {
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (!/\.edu\.cn$/i.test(h)) return false; // 只收录高校官网域名
    const p = u.pathname;
    if (!p || p === '/') return false;
    if (/\.(png|jpe?g|gif|webp|mp4|zip|rar|docx?|xlsx?)$/i.test(p)) return false;
    if (/\/(xxgk|index|about)(\.|\/|$)/i.test(p)) return false;
    return true;
  } catch { return false; }
}

function pickBest(links, n = 2) {
  const useful = links.filter(isUseful);
  const pdf = useful.filter((l) => /\.pdf(\?|$)/i.test(l));
  const rest = useful.filter((l) => !/\.pdf(\?|$)/i.test(l));
  return [...pdf, ...rest].slice(0, n);
}

const entries = [
  // 已知优质来源（冒烟测试实测可下载）
  {
    major: '计算机科学与技术', school: '清华大学',
    title: '清华大学计算机科学与技术专业本科培养方案（教学计划 PDF）',
    url: 'https://www.tsinghua.edu.cn/jxjywj/bksjywj/28-1-jisuanji.pdf', kind: 'pdf'
  }
];

for (const major of MAJORS) {
  for (const school of SEARCH_SCHOOLS) {
    try {
      const links = pickBest(await searchLinks(`site:edu.cn ${school} ${major} 培养方案`), 2);
      for (const url of links) {
        if (entries.some((e) => e.url === url)) continue;
        entries.push({
          major, school,
          title: `${school} · ${major} 培养方案（检索收录）`,
          url, kind: /\.pdf(\?|$)/i.test(url) ? 'pdf' : 'page'
        });
      }
      console.log(`OK ${school} ${major}: ${links.length} 条`);
    } catch (e) {
      console.error(`FAIL ${school} ${major}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 700));
  }
}

const out = {
  version: '2026-11',
  updated: new Date().toISOString().slice(0, 10),
  schools: SCHOOLS,
  entries,
  note: '链接来自公开搜索引擎检索结果，仅供参考，使用前请核对高校官网来源与年份；欢迎 PR 补充，或运行 scripts/build-plan-seed.mjs 重新生成。'
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('total entries:', entries.length, '→', OUT);
