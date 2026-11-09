# fuhe-tool · 留学生学历认证复核自助工具

面向国（境）外学历学位认证【专业名称复核】场景的开源工具集：帮你搞清楚"我的国外专业能复核成国内哪个专业、需要准备什么材料、对比文档怎么写"。

> ⚠️ **免责声明**：本工具仅提供信息检索、课程匹配参考与文档整理辅助，**不承诺、不保证复核结果**。专业名称复核以教育部留学服务中心（cscse.edu.cn）审核为准；专业目录以国家公务员局《专业参考目录》和教育部《普通高等学校本科专业目录》正式发布版为准。本工具内置数据为社区维护的种子数据，仅供参考。

## 功能

| 模块 | 说明 | 位置 |
|---|---|---|
| 一键分析（主页） | 填 API Key + 上传成绩单 + 选目标复核专业（可选上传培养方案）→ 自动完成：成绩单识别（AI 视觉/本地 OCR）→ 专业匹配 → 查 985/211 培养方案（找不到提示上传）→ 生成复核建议报告（可导出 PDF） | [index.html](index.html) |
| 考公目录 | 税务系统 2026 公务员专业参考目录查询（60 类 / 835 专业）+ 留学回国人员报考口径 | [catalog.html](catalog.html) |
| 培养方案库 | 输入目标专业 + 专业代码 → 核心课程参考、已收录培养方案链接、一键搜索各校培养方案 | [plan.html](plan.html) |
| SOP 科普 | 什么是认证复核、流程、材料、费用、常见问题 | [sop.html](sop.html) |
| 开源 CLI | 自动搜集 985/211 高校培养方案 → 生成课程对比文档 | [cli/](cli/) |

在线使用：<https://sxaphs.github.io/fuhe-tool/>

## 一条龙流程（主页）

1. **填配置**：API Key（存本机 localStorage）+ 文本模型 + 视觉模型（截图识别用，DeepSeek 暂无视觉模型，可用 Moonshot/OpenRouter）；
2. **传材料**：上传成绩单（PDF/图片/CSV/TXT，图片用 AI 视觉识别、未配置时本地三语 OCR 兜底）、选择目标复核专业、可选上传目标学校培养方案；
3. **一键出报告**：自动匹配专业 → 自动查找已收录的 985/211 课表（未收录会提示上传/一键搜索）→ 生成复核建议报告并导出 PDF。

## 目录结构

```
fuhe-tool/
├── index.html          # 主页：一条龙分析（配置 → 上传 → 识别 → 匹配 → 报告）
├── sop.html            # 复核 SOP 科普页
├── tool.html / ai.html # 已合并进主页，保留跳转
├── catalog.html        # 考公专业目录对照（税务系统 2026）
├── plan.html           # 培养方案库（核心课程 + 收录链接 + 一键搜索）
├── assets/
│   ├── css/style.css
│   ├── js/pipeline.js  # 主页流水线（识别/匹配/报告）
│   ├── js/pdf-parse.js # 共享解析：PDF 文本层 / 图片 OCR / AI 视觉 / CSV
│   ├── js/app.js       # 旧匹配页逻辑（保留）
│   ├── js/catalog.js   # 考公目录查询逻辑
│   ├── js/plan.js      # 培养方案库查询逻辑
│   ├── js/ai.js        # 旧 AI 助手逻辑（保留）
│   └── vendor/         # 本地化 pdf.js + tesseract.js（自托管，无 CDN 依赖）
├── data/
│   ├── majors.seed.json           # 专业目录种子数据（社区维护，欢迎 PR）
│   ├── civil-service-catalog.json # 税务系统2026公务员专业参考目录（60类/835专业）
│   ├── major-codes.json           # 教育部2025本科专业目录代码（74个种子专业的代码）
│   ├── plan-seed.json             # 已收录的高校培养方案链接（欢迎 PR 补充）
│   └── plan-courses.json          # 各校培养方案课程列表（清华/北大 CS 等，欢迎 PR）
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

## 产品宣传片

产品介绍视频用 [huashu-motion](https://github.com/alchaincyf/huashu-motion)（让 coding agent 直出产品发布片的开源 skill）制作，完整简报见 [docs/product-brief.md](docs/product-brief.md)——含产品档案、三个创作方向、品牌色、镜头清单和红线（不得出现"包过"类承诺）。

启动提示词（复制给你的 agent）：

```
用 huashu-motion 给 fuhe-tool 做一支 30-40 秒的产品介绍片：
产品档案在仓库 docs/product-brief.md，先 om grab 抓 https://sxaphs.github.io/fuhe-tool/
的真实界面素材，按简报出三个方向关键帧让我选，选定后按节奏单成片，
结尾展示 GitHub 仓库地址。不需要找我做任何确认，全程独立完成。
```

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
