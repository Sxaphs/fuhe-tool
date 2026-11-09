# fuhe-tool · 产品介绍视频简报（huashu-motion v0.3.1）

> 本文档是给 huashu-motion（coding agent）拍摄 fuhe-tool 产品介绍片的完整输入。
> 本机 skill 位置：`D:\daily_update\.agents\skills\huashu-motion\`；Windows 下 om 入口：
> `node D:\daily_update\.agents\skills\huashu-motion\cli\om.js <命令>`（或 `npx huashu-motion`）。
>
> **本机环境状态（已跑 om doctor）**：Node 24 ✓、Chrome ✓（C:\Program Files\Google\Chrome\...）、
> FFmpeg 存在但**缺 libx264 / libopus / libvpx-vp9 / prores_ks 编码器**——渲染 MP4 前需先换成完整版 FFmpeg
> （如 gyan.dev/BtbN 的 full build）并放回 PATH，否则 `om render` 的 mp4 会失败。
> 本机渲染一律 `--workers 2`（默认 8 路 Chrome 在 Windows 上会压超时，见本机经验 L1）。
>
> **开工顺序（按 SKILL.md）**：`om learn launch rhythm sound` → `om grab` 抓真实素材 →
> 发一条确认消息（决策带默认值）→ 三个方向关键帧（必含一个 depth 方向）→ `treatment.md` →
> 最难镜头先行 → `om check` 0 错误 + `om still` 自审 → 配乐（ABC 谱）→ `om studio` → `om render` / `om qa` / `om share`。

## 一、产品档案

**一句话定位**：留学认证复核一条龙——上传成绩单，自动识别、自动比对 985/211 课表、自动出复核建议报告的开源免费工具。

| 事实 | 数据 |
|---|---|
| 产品名 / 在线地址 | fuhe-tool · https://sxaphs.github.io/fuhe-tool/ |
| GitHub | https://github.com/Sxaphs/fuhe-tool（MIT 开源） |
| 目标用户 | 报考公务员、需做留服中心「专业名称复核」的留学回国人员 |
| 输入 | 成绩单（PDF / 手机截图 / CSV / TXT）+ API Key + 目标复核专业（本科专业或研究生学科，如"应用经济学 0202"） |
| 自动流水线 | 识别成绩单 → 匹配专业 → 找各校培养方案比对 → 生成复核建议报告（可导出 PDF） |
| 识别能力 | PDF 文字层直提；截图用视觉模型 AI 识别（Moonshot/OpenRouter）；未配置时本地三语 OCR 兜底（德/英/中） |
| 数据资产 | 74 本科专业 × 464 双语课程；55 个研究生一级学科（含 0202 应用经济学）；税务系统公务员目录 60 类 / 835 专业 |
| 课表比对 | 本地已收录真实培养方案 + AI 自动整理各校课程并语义匹配 + 用户可直接上传培养方案 |
| 隐私承诺 | 全程浏览器本地处理：Key 只存本机 localStorage，文件不出设备，无后端服务器 |

**内容红线**（画面与文案不得违反）：不得出现「包过 / 保证通过 / 100% 成功」；免责声明可自然呈现（片尾小字"仅供申报参考，最终以留服中心审核为准"）。

## 二、素材（om grab）

- `om grab https://sxaphs.github.io/fuhe-tool/ <dir>`：抓主页（一条龙表单）、考公目录页、结果页（步骤卡片 + 学校重合度表格 + 课程对应表）的截图与页面真实颜色/字体（品牌蓝 #2563eb 等会随页面样式被收集）。
- `om grab https://github.com/Sxaphs/fuhe-tool <dir>`：README、徽标、仓库页截图。
- 界面镜头要求（SKILL.md）：截图是参考不是镜头——需要动起来的界面（识别课程逐个弹出、重合度进度条、表格逐行填满）用代码**按截图重绘**真实 UI（真文字、真颜色、真数据），禁止灰色占位框；重绘后与截图并排 `om still` 对比。
- 无官方 logo：用「fuhe-tool」字标 + 品牌蓝圆角块（呼应网页 12px 圆角卡片）。

## 三、三个方向（必含一个 depth 方向，关键帧用真实素材拼）

**方向 A · 一条龙流水线（depth 方向，推荐）**
成绩单投入 → 识别出的课程名逐个弹出"盖章"核对 → 专业名+代码落定（应用经济学 0202）→ 各校培养方案卡片在 3D 界面空间飞行、依次亮起重合度 → 报告表格逐行填满 → 导出 PDF。
镜头语言：界面 3D 空间（`ui-space` 模板 / `OM.space`），蓝色主线贯穿，元素按拍落地。

**方向 B · 隐私盾牌（flat / kinetic type）**
"你的成绩单、你的 Key、你的电脑"——Key 存本机的锁扣、文件在本地的围栏、请求直连服务商的线；适合强调开源免费与无服务器。
镜头语言：锁/盾/围栏符号 + 数据流动线，暗底亮蓝，动态文字。

**方向 C · 考公上岸（storytime 插画叙事）**
留学生（学位帽+成绩单）→ 复核专业与公务员岗位目录对钩 → 上岸。情绪向，适合抖音/小红书。
镜头语言：手绘感叙事 + 绿色对钩、琥珀节点。

## 四、品牌与视觉

- 主色 `#2563eb`（动作/主元素）；深底 `#1e3a8a`；辅助 `#16a34a`（绿·匹配通过）、`#d97706`（琥珀·提示）、`#dc2626`（红·失败）；背景亮纸面 `#f8fafc`
- 字体：中文黑体（`om fonts add "Noto Sans SC"` 类）；数字/代码可用等宽
- 三个方向卡的 Palette 用 `om swatch directions.md` 出图对比

## 五、镜头清单（方向 A 细化；场景即 timeline 标签，声音标在落地行）

| # | 场景标签 | 时长 | 内容 | sfx 落点 |
|---|---|---|---|---|
| 1 | scene:hook | 0–3s | 成绩单掉入画面，认证报告专业名与考公目录错位（红色错位标记） | subdrop @ 落地 |
| 2 | scene:promise | 3–6s | 主标题「留学认证复核，一条龙」+ 副标 | whoosh @ 入画 |
| 3 | scene:inputs | 6–12s | 三要素依次落地：Key（锁图标）、成绩单（PDF/截图）、目标专业（下拉落「应用经济学 · 0202」） | thud ×3 |
| 4 | scene:pipeline | 12–26s | 流水线爆发：识别课程逐个弹出 → 重合度进度条 → 各校卡片亮起（清华/北大…）→ 课程对应表逐行填满 | pop/hit 每拍 |
| 5 | scene:privacy | 26–32s | 数据流动线本机循环：「Key 不出设备 · 文件不出浏览器 · 无服务器」 | glitch @ 转场 |
| 6 | scene:outro | 32–40s | MIT 徽标 + 字标 fuhe-tool + 仓库地址 + 免责小字 | 收拍 |

节奏单（写进 treatment.md）：3 秒内钩子；中段一次爆发（pipeline 段快切，最大响点前停一拍）；结尾收在品牌。
配乐：作曲家模式 ABC 谱（`om-score`），`!mark:scene:hook!` 等锚点对齐场景标签，BPM 120–128；或兜底 `OM.music({ product })`。

## 六、成片规格与交付

- 30–40 秒、16:9、60fps（UI 密集）；如需抖音版另做 9:16 + 中文口播（`om voice --text`）
- 片尾签名「Made with huashu-motion」默认保留（自由开源工具自片，署名合理；想关再关）
- `om render --blur` 最终导出 → `om qa` → `om share`（≤10MB GIF + share.md 发帖文案）
- 出口文件：`out/<name>-vN.mp4` + `out/share/`

## 七、给用户的一句话启动提示词

```
用 huashu-motion 给 fuhe-tool 做一支 30-40 秒的产品介绍片：
产品档案在仓库 docs/product-brief.md，先 om grab 抓 https://sxaphs.github.io/fuhe-tool/
的真实界面素材，按简报出三个方向关键帧让我选，选定后写 treatment.md 再成片，
结尾展示 GitHub 仓库地址。不需要找我做任何确认，全程独立完成。
```
