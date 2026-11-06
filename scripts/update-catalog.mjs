// 抓取国家税务总局 2026 税务系统公务员专业参考目录 → data/civil-service-catalog.json
// 用法: node scripts/update-catalog.mjs（每年新年度通知发布后改 URL 重跑即可）
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DATA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'civil-service-catalog.json');
const URL = 'https://www.chinatax.gov.cn/chinatax/n896543r/c5243601/content.html';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const res = await fetch(URL, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
if (!res.ok) throw new Error('HTTP ' + res.status);
let html = await res.text();

// 解码实体
html = html.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function cleanCell(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[注：[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const categories = [];
const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
for (const tr of rows) {
  const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cleanCell(m[1]));
  if (tds.length !== 3) continue;
  const [num, cat, majors] = tds;
  if (!/^\d{1,2}$/.test(num)) continue;
  const list = majors === '[参照英语]' || !majors
    ? []
    : majors.split(/[，,]/).map((s) => s.trim()).filter(Boolean);
  categories.push({ index: Number(num), category: cat, majors: list });
}

if (categories.length < 50) {
  console.error('解析出的类别数过少:', categories.length);
  process.exit(1);
}

const out = {
  version: '2026',
  title: '税务系统2026年度考试录用公务员专业参考目录',
  source: '国家税务总局《税务系统2026年度考试录用公务员相关事项通知》（2025-10-14）',
  sourceUrl: URL,
  scopeNote: '本目录为税务系统招录编制，包含本科及以上学历层次所需的相关专业；其他系统/省考目录以各自招录公告为准。',
  policy: [
    '留学回国人员可以教育部留学服务中心学历认证的专业报考。',
    '报考人员所学专业不在本表范围内的一般不接受报考，尝试使用个别相近专业报考的，须如实准确填写本人所学专业名称及专业代码，在"学科成绩"或"备注"栏内完整填写该专业所有课程名称和成绩，并对所学专业进行简要描述和说明，由招录机关综合进行资格审查。',
    '专业学位硕士可以根据所学专业规范名称，按对应的专业进行报考。如"会计硕士"，可按"会计学"报考"工商管理类"职位。',
    '报考人员所学专业同时属于不同专业类别的，相关专业类别职位均可报考。如"经济统计学"专业，既可报考"经济学类"职位，也可报考"统计学类"职位。'
  ],
  updated: '2025-10-14',
  categories
};

const file = DATA_FILE;
writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('categories:', categories.length, '| majors:', categories.reduce((n, c) => n + c.majors.length, 0));
console.log('sample:', JSON.stringify(categories.slice(0, 3), null, 1));
console.log('written:', file);
