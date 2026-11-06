// 数据质量校验: node scripts/validate-data.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const d = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'majors.seed.json'), 'utf8'));

let majors = 0, courses = 0, badAlias = 0, emptyEn = 0, zhAlias = 0, shortKW = new Set(), enCounts = {};
for (const c of d.categories) {
  for (const m of c.majors) {
    majors++;
    if (!m.aliases || !m.aliases.length) badAlias++;
    else if (m.aliases.some((a) => /[\u4e00-\u9fa5]/.test(a))) zhAlias++;
    for (const cc of m.coreCourses) {
      courses++;
      const en = cc.en || [];
      enCounts[en.length] = (enCounts[en.length] || 0) + 1;
      if (!en.length) emptyEn++;
      for (const k of en) if (k.length <= 3) shortKW.add(k);
    }
  }
}
console.log('categories:', d.categories.length, '| majors:', majors, '| courses:', courses);
console.log('majors with EMPTY aliases:', badAlias, badAlias ? '  <-- 需修复' : '(OK)');
console.log('majors with Chinese aliases (允许):', zhAlias);
console.log('courses with EMPTY en:', emptyEn, emptyEn ? '  <-- 需修复' : '(OK)');
console.log('short keywords (<=3字符, 仅精确匹配):', [...shortKW]);
console.log('en-size distribution:', JSON.stringify(enCounts));
