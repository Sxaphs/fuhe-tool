// 匹配算法单元测试（新 schema：coreCourses 为 {zh, en[]} 对象数组）
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
        results.push({ cat: cat.category, name: m.name, coverage: Math.round(coverage * 100), score, matched: uniq, aliasHits });
      }
    }
  }
  results.sort((a, b) => b.score - a.score || b.coverage - a.coverage);
  return results;
}

const fakeData = {
  categories: [
    { id: 'computer', category: '计算机类', majors: [
      { name: '计算机科学与技术', aliases: ['Computer Science', 'CS'],
        coreCourses: [
          { zh: '数据结构', en: ['data structure', 'data structures', 'dsa'] },
          { zh: '操作系统', en: ['operating system', 'operating systems'] },
          { zh: '计算机网络', en: ['computer network', 'computer networks', 'networking'] },
          { zh: '数据库原理', en: ['database', 'database systems', 'dbms'] }
        ] },
      { name: '软件工程', aliases: ['Software Engineering'],
        coreCourses: [ { zh: '软件工程', en: ['software engineering'] }, { zh: '程序设计', en: ['programming', 'program design'] } ] }
    ]},
    { id: 'finance', category: '金融学类', majors: [
      { name: '金融学', aliases: ['Finance'],
        coreCourses: [ { zh: '金融学', en: ['finance'] }, { zh: '投资学', en: ['investment', 'investments'] } ] }
    ]}
  ]
};

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('PASS:', msg); };

// 英文课程名 → 中文专业命中
const cs = matchAll(['Data Structures and Algorithms', 'Operating Systems', 'Computer Networks', 'Database Systems'], fakeData);
assert(cs.length === 1, '英文 CS 课程命中计算机类专业，实际 ' + cs.length + ' 个');
assert(cs[0].name === '计算机科学与技术', '第一名是计算机科学与技术，实际=' + (cs[0] ? cs[0].name + ' score=' + cs[0].score : 'undefined'));
assert(cs[0].coverage === 100, '四门全中 coverage=100，实际=' + (cs[0] ? cs[0].coverage : '?'));

// 短关键词防误匹配："courses" 不应命中 "os"
const guard = matchAll(['Courses in Modern Art', 'Courses in History'], fakeData);
assert(guard.length === 0, '短关键词防护："courses" 不误命中，实际命中 ' + guard.length + ' 个');

// 中文课程名也能命中
const zh = matchAll(['数据结构', '操作系统'], fakeData);
assert(zh.length >= 1 && zh[0].name === '计算机科学与技术', '中文课程名命中计算机科学与技术');

// 金融
const fin = matchAll(['Finance', 'Corporate Finance', 'Investment Analysis'], fakeData);
assert(fin.length === 1 && fin[0].name === '金融学', '金融课程只命中金融学');

// 别名兜底：只给专业英文名也能出结果
const aliasOnly = matchAll(['Computer Science'], fakeData);
assert(aliasOnly.length > 0, '仅输入 "Computer Science" 也有结果（别名匹配）');

console.log('done');
