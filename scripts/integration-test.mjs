// 集成测试：用真实 majors.seed.json 验证匹配效果: node scripts/integration-test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

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
        results.push({ cat: cat.category, name: m.name, coverage: Math.round(coverage * 100), score });
      }
    }
  }
  results.sort((a, b) => b.score - a.score || b.coverage - a.coverage);
  return results;
}

const data = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'majors.seed.json'), 'utf8'));
console.log('categories:', data.categories.length, 'majors:', data.categories.reduce((n, c) => n + (c.majors || []).length, 0));

const show = (label, courses, top = 3) => {
  const r = matchAll(courses, data);
  console.log(`\n== ${label} ==`);
  if (!r.length) { console.log('  无命中！'); return; }
  for (const x of r.slice(0, top)) console.log(`  ${x.cat} / ${x.name}  重合度 ${x.coverage}%  score ${x.score}`);
};

show('英文 CS 课程', ['Data Structures and Algorithms', 'Operating Systems', 'Computer Networks', 'Database Systems']);
show('英文金融课程', ['Corporate Finance', 'Investments', 'Financial Accounting']);
show('中文 CS 课程', ['数据结构', '操作系统', '计算机网络']);
show('通信课程', ['Communication Systems', 'Digital Signal Processing', 'Electromagnetic Waves']);
show('商业分析', ['Business Analytics', 'Machine Learning', 'Data Mining']);
show('语言学（应无命中或弱命中）', ['Phonetics', 'Syntax', 'Pragmatics']);
