# fuhe-tool · 留学生学历认证复核自助工具

面向国（境）外学历学位认证【专业名称复核】场景的开源工具集：帮你搞清楚"我的国外专业能复核成国内哪个专业、需要准备什么材料、对比文档怎么写"。

> ⚠️ **免责声明**：本工具仅提供信息检索、课程匹配参考与文档整理辅助，**不承诺、不保证复核结果**。专业名称复核以教育部留学服务中心（cscse.edu.cn）审核为准；专业目录以国家公务员局《专业参考目录》和教育部《普通高等学校本科专业目录》正式发布版为准。本工具内置数据为社区维护的种子数据，仅供参考。

## 功能

| 模块 | 说明 | 位置 |
|---|---|---|
| 匹配工具 | 粘贴/上传课程表（支持 CSV / 成绩单 PDF 本地解析）→ 匹配可复核的国内专业 | [tool.html](tool.html)（在线版） |
| 考公目录 | 税务系统 2026 公务员专业参考目录查询（60 类 / 835 专业）+ 留学回国人员报考口径 | [catalog.html](catalog.html) |
| 培养方案 | 输入目标专业 + 专业代码 → 核心课程参考、已收录培养方案链接、一键搜索各校培养方案 | [plan.html](plan.html) |
| AI 助手 | 自带 API Key（DeepSeek/Kimi/OpenRouter），浏览器直连生成课程对比说明，可导出 PDF | [ai.html](ai.html) |
| SOP 科普 | 什么是认证复核、流程、材料、费用、常见问题 | [sop.html](sop.html) |
| 开源 CLI | 自动搜集 985/211 高校培养方案 → 生成课程对比文档 | [cli/](cli/) |

在线使用：<https://sxaphs.github.io/fuhe-tool/>

## 三步自助流程

1. **上传课程表**：把你的国外成绩单课程名称粘贴/上传到[匹配工具](tool.html)，得到"可复核专业"候选清单与课程重合度；
2. **确认目标专业**：结合报考岗位的《专业参考目录》确定要改名的国内专业名；
3. **生成对比文档**：用 [CLI](cli/) 搜集目标高校培养方案、生成课程对比表与说明文档。

## 目录结构

```
fuhe-tool/
├── index.html          # 首页
├── sop.html            # 复核 SOP 科普页
├── tool.html           # 课程表匹配工具（支持成绩单 PDF 本地解析）
├── catalog.html        # 考公专业目录对照（税务系统 2026）
├── plan.html           # 培养方案查询（核心课程 + 收录链接 + 一键搜索）
├── ai.html             # AI 助手（自带 Key 浏览器直连，生成对比说明 / 导出 PDF）
├── assets/
│   ├── css/style.css
│   ├── js/app.js       # 匹配逻辑（纯前端，数据在本地浏览器处理）
│   ├── js/catalog.js   # 考公目录查询逻辑
│   ├── js/plan.js      # 培养方案查询逻辑
│   ├── js/ai.js        # AI 助手逻辑（Key 仅存 localStorage）
│   └── vendor/         # 本地化的 pdf.js（自托管，无 CDN 依赖）
├── data/
│   ├── majors.seed.json           # 专业目录种子数据（社区维护，欢迎 PR）
│   ├── civil-service-catalog.json # 税务系统2026公务员专业参考目录（60类/835专业）
│   ├── major-codes.json           # 教育部2025本科专业目录代码（74个种子专业的代码）
│   └── plan-seed.json             # 已收录的高校培养方案链接（欢迎 PR 补充）
├── cli/
│   ├── fuhe.mjs        # 零依赖 CLI：research / report
│   └── package.json
├── scripts/
│   ├── update-catalog.mjs     # 抓取税务系统公务员专业参考目录 → data/civil-service-catalog.json
│   ├── build-plan-seed.mjs    # 检索并收录高校培养方案链接 → data/plan-seed.json
│   ├── validate-data.mjs      # 种子数据质量校验
│   ├── test-match.mjs         # 匹配算法单元测试
│   └── integration-test.mjs   # 真实数据集成测试
└── research/           # 调研资料存档（事实与来源）
```

## CLI 快速开始（零依赖，Node ≥ 18）

```bash
# 搜集某专业在若干高校的培养方案
node cli/fuhe.mjs research --major 计算机科学与技术 --schools 清华大学,北京大学

# 基于搜集结果生成课程对比文档（可选 LLM 润色）
$env:LLM_BASE_URL="https://api.deepseek.com"   # PowerShell
$env:LLM_API_KEY="sk-xxx"
node cli/fuhe.mjs report --major 计算机科学与技术 --school 清华大学 --courses "数据结构,操作系统,算法,计算机网络"
```

不配置 LLM 环境变量时，`report` 会输出标准模板，人工补充对比说明即可。

## 数据更新与维护（零依赖脚本）

```bash
node scripts/update-catalog.mjs   # 抓取税务系统公务员专业参考目录（每年新通知发布后改 URL 重跑）
node scripts/build-plan-seed.mjs  # 检索收录高校培养方案链接（可自行增删专业/学校后重跑）
node scripts/validate-data.mjs    # 校验种子数据结构
node scripts/test-match.mjs       # 匹配算法单元测试
node scripts/integration-test.mjs # 用真实数据跑匹配用例
```

维护日历（详见 [research/sources.md](research/sources.md)）：每年 3–4 月跟教育部本科专业目录、9–10 月跟新年度国考各系统专业目录，每季度核对留服中心通知公告。

## 数据说明与贡献

- `data/majors.seed.json` 为**种子数据**：仅覆盖留学生最常复核的部分专业类，课程关键词供粗略匹配，不保证完整与最新；
- 数据结构：每门核心课程同时带中文名与英文关键词（国外成绩单课程名多为英文），示例：

```json
{ "zh": "数据结构", "en": ["data structure", "data structures", "dsa"] }
```

- 欢迎通过 PR 增补专业、别名（国外专业英文名）与核心课程（中英双语）；`research/sources.md` 列出了官方数据源入口；
- 匹配结果只是"参考线索"，正式决定前请务必核对当年官方专业目录。

## License

[MIT](LICENSE)
