# fuhe-tool CLI

零依赖命令行工具（Node ≥ 18），用于留学学历认证复核中的两类工作：

- `research`：自动搜索指定高校某专业的《培养方案》/课程设置页面，下载原始页面并生成摘要（用于搜集课程对比依据）；
- `report`：生成课程对比文档（Markdown），配置 LLM 环境变量后可自动生成"对比说明"草稿。

## 快速开始

```bash
# 1. 搜集：清华大学、北京大学的"计算机科学与技术"培养方案
node fuhe.mjs research --major 计算机科学与技术 --schools 清华大学,北京大学

# 2. 生成对比文档（无 LLM 时为模板）
node fuhe.mjs report --major 计算机科学与技术 --school 清华大学 \
  --courses "数据结构,操作系统,算法,计算机网络,数据库"

# 3. 可选：配置 LLM 润色对比说明（OpenAI 兼容接口）
export LLM_BASE_URL="https://api.deepseek.com"
export LLM_API_KEY="sk-xxx"
export LLM_MODEL="deepseek-chat"   # 可选，默认 deepseek-chat
node fuhe.mjs report --major 计算机科学与技术 --school 清华大学 \
  --courses "数据结构,操作系统,算法"
```

## 输出

```
out/
├── research/
│   └── 计算机科学与技术/
│       ├── index.md          # 所有来源链接索引
│       └── 清华大学/
│           ├── src-1.html ... # 原始页面存档
│           └── summary.md     # 每页文本摘要
report/
└── 清华大学-计算机科学与技术-对比文档.md
```

## 说明与边界

- 搜索使用 Bing（国内网络可达）并自动回退 DuckDuckGo，可能受频率限制；下载失败会跳过并提示，不会中断整体流程；
- PDF 培养方案文件会自动存档到输出目录，暂不自动解析正文，可配合 `pdftotext`（poppler）等工具提取后人工比对；
- `report` 的 LLM 草稿**必须人工核对**课程对应关系后使用；
- 本工具不承诺复核结果，最终以教育部留学服务中心审核为准。
