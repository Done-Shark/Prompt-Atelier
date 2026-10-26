# Prompt Atelier 参考项目调研笔记

> 只读调研，未改动任何参考项目。下文路径相对各参考项目仓库根目录；行号为调研时的快照。
> 结论先行：数据层学 NPS 的「图片-标签-元数据」分表 + 语义指纹；格式层学 NAI Launcher 的强类型模型与权重语法；解析层学 CLM 的「按节点类型注册 extractor」；视觉学 NPS 的纸墨朱砂令牌，避开 NAI Launcher 的重装饰主题。

## 1. Prompt 数据模型

### 1.1 NovelAIPromptStudio（SQLite / node:sqlite）
`NovelAIPromptStudio/electron/database.js:20-111` 是唯一 schema 来源：

| 表 | 关键字段 | 说明 |
|---|---|---|
| `projects` | id, name, image_path, thumbnail_path, content_hash, prompt_fingerprint, base_prompt_fingerprint, vibe_fingerprint, exact_group_fingerprint, is_favorite, deleted_at, created_at, updated_at | 一图一 project；软删除；多种指纹用于去重/分组 |
| `prompt_tags` | id, project_id, tag, translation, category, weight, position, note, raw_segment, syntax_issue, brace_depth, brace_group, brace_trailing_comma | 标签是行级实体，保留原片段与括号元信息，可无损回写 |
| `generation_metadata` | project_id, prompt_raw, negative_prompt, prompt_structure_json, model, seed, steps, sampler, guidance, width, height, generation_mode, extra_json | 正/负面原文 + V4 结构 JSON |
| `gallery_collections` | id, name, kind CHECK IN ('manual','smart'), filter_json | 手动集合与智能集合同表 |
| `gallery_collection_projects` | collection_id, project_id, created_at | 多对多 |
| `prompt_group_covers` | prompt_fingerprint, project_id | 同 Prompt 分组选封面 |

领域类型见 `NovelAIPromptStudio/src/shared/types.ts`：`Tag`（30-43，含 translation/category/weight/note/raw_segment/syntax_issue/segment_type/brace_*）；`PromptStructureRaw`（64-71，`base_prompt_raw`/`base_undesired_raw`/`use_coords`/`use_order`/`novelai_auto`/`characters[]`）；`PromptCharacter`（58-63，raw + 解析后的 `prompt_tags`/`undesired_tags`）；`PromptScope`（98-113，`base:prompt`、`base:undesired`、`character:<id>:prompt|undesired` + `polarity`）；`ImageProject`（137-149）= 图 + `metadata` + `tags` + `prompt_structure`；`LibraryCard`（170-193）是列表投影（只带 model/width/height 与 `filter_tags`）；`Collection.kind: 'manual' | 'smart'`（221-231）。

结构化解析在 `src/lib/promptStructure.js:58-98` `extractV4PromptData`：把 `v4_prompt.caption.base_caption`、`char_captions[].char_caption`、`centers[0].{x,y}` 拍平为上述 raw 结构。`src/lib/promptFingerprint.js:18-68` 用规范化 tag 列表 + 角色中心点生成指纹，用于「同 Prompt 分组」而非文本 diff。文档级编辑在 `src/lib/promptDocument.ts:39-58`：`PromptBlock` 保存 `range/prefix/labelSpacing/suffix/contentRange`，`parsePromptSection`（190）与 `serializePromptSection`（218）保证标签块 ↔ 段落块切换后原文逐字节不变；`createPromptDocument`（400）/`promptDocumentProject`（440）负责与 project 互转。
**使用次数：NPS 没有。** 全仓无 `usage_count`，排序只有 `recent|oldest|name`（`src/state/library.ts:20-27`）。

### 1.2 NAI Launcher（Flutter + SQLite/Hive）
- `lib/data/models/prompt/prompt_tag.dart:22-53`：`PromptTag{id,text,weight,category(0/1/3/4/5),translation,enabled,selected,rawSyntax,syntaxType}`；`WeightSyntaxType{none,bracket,numeric}` 决定回写 `{{{}}}` 还是 `1.2::x::`；步进 `0.05`、范围 `0.1–3.0`（82-88）。
- `lib/core/database/datasources/gallery_schema.dart`：`images`（39-56，含 `metadata_status`/`is_favorite`/`is_deleted`）、`metadata`（184-217，正负 prompt + NAI 全参数 + `raw_json` + vibe 字段）、`favorites`（243-253）、`tags`（259-266，含 `usage_count`）、`image_tags`、`albums`（335-347，`parent_id` 自引用=文件夹树、`cover_path`、`pending_paths`）、`album_images`。
- `lib/domain/entities/gallery_image_entity.dart:12-51` 把 DB 记录 + Hive 缓存 + `NaiImageMetadata` 合成实体，`metadata.hasData` 决定有无 Prompt；`lib/data/models/gallery/nai_image_metadata.dart:20-44` 定义 `CharacterPromptInfo{prompt,negativePrompt,position,centerX,centerY}`。
- **使用次数**：标签级 `usage_count`（`gallery_schema.dart:263`），词库条目 `useCount` 自增并按它排序（`lib/data/models/tag_library/tag_library_entry.dart:48,225,278`）。

### 1.3 ComfyUI-Lora-Manager
没有独立 Prompt 实体。Prompt 只作为 recipe 的 `gen_params`：`py/recipes/constants.py:7-17` 定义 `GEN_PARAM_KEYS = prompt, negative_prompt, steps, sampler, cfg_scale, seed, size, clip_skip, denoising_strength`；结果结构见 `py/recipes/parsers/comfy.py:244-250`（`base_model/loras/checkpoint/gen_params/from_comfy_metadata`）。集合能力弱，靠文件夹树 + 标签。

### 1.4 取舍
NPS 的 prompt 依附图片、NAI Launcher 的 prompt 依附生成器，两者都没有「可独立保存的 Prompt 实体」。我们应建 `prompts` 主表 + `prompt_tags` 子表 + `prompt_revisions`（可选），图片只作为 `source_image` 外键；同时补 NPS 没有、NAI Launcher 有的 `usage_count` / `last_used_at`。

## 2. NAI 与 ComfyUI 的格式差异

### 2.1 NAI 权重语法
| 语法 | 含义 | 代码证据 |
|---|---|---|
| `{tag}` / `{{tag}}` | 增强，每层 ×1.05 | `Aaalice_NAI_Launcher/lib/data/models/prompt/prompt_tag.dart:92-102,133-137` |
| `[tag]` / `[[tag]]` | 减弱，每层 ÷1.05 | 同上 138-143 |
| `1.2::tag::` | 数值权重，可负 | `NovelAIPromptStudio/src/lib/prompt.js:209-229`（`^([+-]?(?:\d+(?:\.\d*)?|\.\d+))::`，递归解析内部） |
| `\|\|` | 双竖线语法，成对出现；内部逗号不切分，须作为整体 token 保护 | `Aaalice_NAI_Launcher/lib/core/utils/nai_prompt_parser.dart:31,111-125` |

NPS 额外把括号层数落库 `brace_depth`/`brace_group`/`brace_trailing_comma`（`database.js:47-49`），因此 `{{a, b}, c}` 这类嵌套组能原样还原；`syntax_issue` 记录 `control_only`（孤立 `::`）与 `emphasis_closer`（`prompt.js:283-305`）。

### 2.2 V4 多角色 caption（`promptStructure.js:64-97`）
```
raw.v4_prompt.caption.base_caption                     -> base_prompt_raw
raw.v4_prompt.caption.char_captions[i].char_caption    -> characters[i].prompt_raw
raw.v4_prompt.caption.char_captions[i].centers[0].{x,y}-> characters[i].center (clamp 0..1)
raw.v4_prompt.use_coords / use_order                   -> 布尔
raw.v4_negative_prompt.caption.base_caption            -> base_undesired_raw
raw.v4_negative_prompt.caption.char_captions[i].char_caption -> characters[i].undesired_raw
```
NAI Launcher 同构实现：`lib/data/models/gallery/nai_image_metadata_raw_decoder.dart:435-484`（`char['position']`、`centers`），`use_coords` 在 487-496。

### 2.3 NAI 参数键名（PNG Comment JSON）
`nai_image_metadata_raw_decoder.dart`：`uc`（负面，105）、`seed`（168）、`sampler`（169）、`steps`（170）、`scale`（171，兼容 `cfg_scale`/`guidance`，915-920）、`width`/`height`（172-173）、`sm`（175）、`sm_dyn`（176）、`noise_schedule`（182）、`cfg_rescale`（183）、`ucPreset`/`qualityToggle`（184-185）。NPS 同名兜底：`electron/metadata.js:150-162`（`prompt|description`、`uc|negative_prompt|negativePrompt`、`model|source`、`scale|cfg_scale|guidance`）。

### 2.4 ComfyUI API 格式（PNG `prompt` 字段）
结构 `{ "<node_id>": { "class_type": "...", "inputs": {...}, "_meta": {"title": "..."} } }`，连线值为 `[源node_id, 输出槽位]`。`ComfyUI-Lora-Manager/py/recipes/parsers/comfy.py` 的定位规则：

| 目标 | 规则 | 行号 |
|---|---|---|
| 判定格式 | 任一 value 含 `class_type` | 16-25 |
| Checkpoint | `class_type == 'CheckpointLoaderSimple'` → `inputs.ckpt_name` | 35-42 |
| LoRA | `class_type == 'LoraLoader'` → `inputs.lora_name` + `strength_model` | 83-87 |
| 正向 CLIP | `class_type.endswith('CLIPTextEncode')` 且 `_meta.title == 'Positive'` → `inputs.text` | 199-206 |
| 负向 CLIP | 同上，`_meta.title == 'Negative'` | 209-216 |
| 采样器 | `class_type == 'KSampler'` → `sampler_name/steps/cfg/seed` | 219-232 |
| 尺寸 | `EmptyLatentImage` → `ImageSizeExtractor` 的 `inputs.width/height`（默认 512） | `node_extractors.py:945-961,1447` |

**关键教训：** 不能像 `Aaalice_NAI_Launcher/lib/data/services/metadata/metadata_text_decoder.dart:539-549` 那样「第一个 CLIPTextEncode 当正向、第二个当负向」——遍历顺序不保证，且存在 `CLIPTextEncodeFlux`、`AdvancedCLIPTextEncode` 等变体。CLM 的做法是「先找 sampler，再顺着 `positive`/`negative` 连线回溯到 CLIPTextEncode」（`py/metadata_collector/metadata_processor.py:239-315` `trace_node_input`、408+ `match_conditioning_to_prompts`），并用注册表分派 30+ 变体（`node_extractors.py:1386-1457` 的 `NODE_EXTRACTORS`，含 `KSamplerAdvanced`/`SamplerCustomAdvanced`/`LoraLoaderLM`/`RgthreePowerLoraLoader`）。

## 3. 图片元数据解析

### 3.1 NPS 读 NAI PNG（`NovelAIPromptStudio/electron/metadata.js`）
1. `parsePngText`（13-54）：逐 chunk 解析 `tEXt`（`key\0value`）、`zTXt`（`inflateSync`）、`iTXt`（压缩标志 + 语言标签），遇 `IEND` 停。
2. `parseStealthPngText`（67-112）：`sharp().ensureAlpha().raw()` 取像素，按 `x = floor(bitIndex / height)`、`y = bitIndex % height` 读 **alpha 通道最低位**；头部 15 字节 magic 必须为 `stealth_pngcomp`/`stealth_pnginfo`，随后 4 字节大端是 bit 长度；`stealth_pngcomp` 走 `zlib.gunzipSync`（上限 16MB）。
3. `readNovelAIMetadata`（137-169）：收集所有可 `JSON.parse` 的 chunk 合并为 `raw`，再用 `first()` 多键兜底；尺寸直接读 IHDR（114-119）；输出 `prompt_raw`/`negative_prompt`/`prompt_structure_raw`/`model/seed/steps/sampler/guidance/generation_mode/embedded_vibes`，原始数据全塞 `extra_json = {pngText, parsed}`。

NAI 官方把参数放在 `Comment` chunk（fixture 见 `electron/metadata.test.js:174`）；NAI Launcher 写回时同时写 `Comment` tEXt 与 alpha stealth（`lib/data/services/metadata/image_metadata_container_codec.dart:12,78,85-86`）。

### 3.2 ComfyUI-Lora-Manager 读 ComfyUI 图片
- `py/utils/exif_utils.py:165-221` `_load_structured_metadata`：Pillow 读 `img.info` 的 **`parameters`（A1111 文本）、`prompt`（API 图 JSON）、`workflow`（UI 图 JSON）** 与 EXIF `UserComment`；`ImageDescription` 若以 `Workflow:` 开头则截为 workflow，否则当 prompt。入口 `283` `extract_image_metadata`。
- `py/recipes/parsers/comfy.py` 把 `prompt` JSON 解析为 `gen_params`。
- `py/metadata_collector/` 是「运行时采集」而非「事后解析」：`metadata_hook.py` 在节点执行时记录，`node_extractors.py` 按 class_type 抽取，`metadata_processor.py:67` `find_primary_sampler`、`374` `find_primary_checkpoint`、`408` `match_conditioning_to_prompts` 做拓扑归因，比事后猜节点顺序可靠。

### 3.3 嵌套差异
| | NAI | ComfyUI |
|---|---|---|
| 容器 | PNG tEXt `Comment`（JSON 字符串）或 alpha LSB stealth | PNG tEXt `prompt` + `workflow`（两个独立 JSON） |
| 正向 | `prompt` / `v4_prompt.caption.base_caption` | `prompt[node].inputs.text`（需拓扑定位） |
| 负面 | `uc` / `v4_negative_prompt.caption.base_caption` | 另一个 CLIPTextEncode |
| 角色 | `v4_prompt.caption.char_captions[]` | 无原生概念，靠 regional prompt 节点或 `COUPLE` 语法 |
| 参数 | 平铺在 Comment 顶层 | 分散在 KSampler / EmptyLatentImage / Loader 节点 |

## 4. 界面信息架构

### 4.1 NPS：标题栏 + 两页 + 三栏
- `src/shell/Titlebar.tsx:20-58`：44px 高，左 logo，主导航仅「工作台 / 图片库」，右侧设置；`shell.css:4` 整条 `-webkit-app-region: drag`。
- `src/library/library.css:1-4`：`.library-page` 为 flex，左 `--side-w:196px` 固定，中间自适应网格，右 `--detail-w:340px` 由 `ResizablePanel` 拖宽；宽度写 `localStorage`（`LibraryPage.tsx:54-60`）。
- 左栏 `src/library/Sidebar.tsx:21-99`：全部图片 / 收藏集（manual 与 smart 分组）/ 回收站，当前项 `.on`。
- 顶栏 `src/library/Toolbar.tsx:202-254`：搜索 + 筛选（带条件计数）+ 视图 + 导入 split button；条件以可删 chip 回显（78-132）。
- 网格 `src/library/layout.ts:8-45`：贪心等高行，末行不拉伸；`adjacentRowIndex`（47-80）让上下键跳到下一行**水平中心最近**的图。
- 工作台 `src/workbench/WorkbenchPage.tsx:35-70`：多标签并行，右栏 Prompt 可拖宽，每个 tab 独立记忆滚动位置。

### 4.2 NAI Launcher：collection workspace 骨架
`lib/presentation/widgets/gallery/gallery_sidebar.dart`：`GalleryCollectionWorkspace`（154-206）为 `Column[ toolbar, Expanded(Row[ optional sidebar, Expanded(Column[body, optional footer]) ]) ]`；`GalleryCollectionToolbarSurface`（33-51）全宽无边框、`sectionSurfaceColor`、最小高 72；`GallerySidebarSurface`（208+）`controlSurfaceColor`、默认宽 250 可拖。本地画廊、Vibe 库、精准参考库、词库四页复用同一骨架（`local_gallery_screen.dart`、`vibe_library_workspace.dart`、`tag_library_page_screen.dart`）。

### 4.3 ComfyUI-Lora-Manager：模板 + 页面控制器
`templates/base.html` 是唯一壳（全局 CSS、主题预加载、i18n），每页一个 `templates/{loras,checkpoints,recipes,statistics}.html`。`static/js/` 分层：`api/`（每资源一个 client，如 `recipeApi.js`）、`state/`、`managers/`（Loading/Modal/Settings/Bulk/Import）、`components/`（含 `ContextMenu/`、`controls/`、`shared/`）、`utils/`、`i18n/`。每页一个入口（`recipes.js`）实例化 `RecipeManager`，组合 `ImportManager`/`BatchImportManager`/`RecipeModal`/`SidebarManager`，页面状态走 `getCurrentPageState()`。后端按资源拆 route registrar（`py/routes/recipe_route_registrar.py:18-40` 声明式 `ROUTE_DEFINITIONS`），handler 与 service 分离。

### 4.4 值得借鉴的 5 条
1. **一体式工具栏 + 独立侧栏色面**（NAI Launcher）：工具栏横跨内容区、页面名固定左端，不把侧栏顶进标题栏，窄窗更稳。
2. **三栏可拖宽 + 宽度本地记忆**（NPS `LibraryPage.tsx:54-60`）：左导航/中网格/右详情，详情 340px 起，按页面分别持久化。
3. **等高行网格 + 几何键盘导航**（NPS `library/layout.ts`）：尊重原图比例，上下键落点可预测。
4. **手动集合与智能集合同表**（NPS `gallery_collections.kind`）：`manual` 存成员、`smart` 存 `filter_json`，同一层级，避免「文件夹 vs 筛选器」两套心智。
5. **工作台多标签 + 每标签独立滚动/宽度**（NPS `WorkbenchPage.tsx:35-70`）：解析图片是「打开一张看一张」，标签页比路由跳转更贴合动作。

## 5. 视觉语言

### 5.1 NPS：纸、墨、朱砂
`design/tokens.css` 是唯一来源，文件头写明「产品代码直接引用，不复制」。
- **排版**：三字体分工——`--font-ui` MiSans、`--font-prose` Newsreader（成段自然语言）、`--font-mono` IBM Plex Mono（Tag/数字）；字号仅 15/13/12/11，正文行高 20，字重最多 500（11-34）。
- **色彩**：浅色 `--bg #fbfbfa` / `--pane #f5f5f3` / `--surface #fff` / `--text #1c1c1c`；朱砂 `#d4351c` **只用于三处**：标志方块、当前图标记、生成按钮（`design/identity/README.md`）；焦点环用墨色，因为「朱砂焦点环像报错」。
- **圆角**：面板 10 / 控件 7 / Tag 5 / 缩略图 4（41-44,162）。
- **图片网格**：`--thumb-row:180px`（120–360 可调、每档 20）、`--thumb-gap:14px`、比例钳制 0.5–2.5、`--r-thumb:4px`、当前/选中 2px 外框（156-165）。
- **动效**：120ms 状态 / 180ms 进入 / 240ms 位移，`cubic-bezier(0.2,0.8,0.2,1)`，退出只淡出不位移（178-183）。
- **阴影**：`--shadow-print` 只给图片（像放在纸上的照片），`--shadow-pop` 只给浮层（269）。

### 5.2 NAI Launcher：Grunge Collage / tonal layered
`DESIGN.md` frontmatter（1-120）+ 正文：主色旧纸奶油 `#F0EAD6`、画布炭黑 `#1A1A1A`、信号猩红 `#DC143C`；字体 Oswald（标题）+ Courier Prime（正文），比 NPS 更「海报」。圆角 4/6/8/12/24/pill，4px 网格，间距 4–32（201）。三条硬规则：**Content Before Container**（141，去掉边框层级仍清楚就不加边框）、**Flat-at-Rest**（246，静态 Card 无阴影，阴影只给浮层/图片 hover）、动效 100–200ms 且禁止弹簧/回弹/过冲/缩放弹出（353）。另明确「主题可换色/字体/形状，但不能改信息架构、密度、命中区」。

### 5.3 沿用与避免
| 直接沿用 | 理由 |
|---|---|
| NPS 纸/墨/单朱砂 + 三字体分工 | 内容就是文字与图片，界面越无色越凸显内容 |
| NPS 圆角梯度 10/7/5 | 密集列表里比 12–24px 更稳，不会「卡片化过度」 |
| NPS 120/180/240ms + 只淡出不位移 | 匹配检索/复制这类高频低戏剧性操作 |
| NAI Launcher tonal layered + Flat-at-Rest | 用色面而非边框/阴影分层，长列表更干净 |
| NAI Launcher 4px 网格 + 72px 工具栏基线 | 触屏 48px 命中区与桌面密度可共存 |

| 应避免 | 理由 |
|---|---|
| NAI Launcher 的 Grunge Collage 暗色 + 猩红大色块 | 个性强、可读性依赖主题，不宜作唯一默认皮肤 |
| NAI Launcher 的 `panel:24px` 大圆角 | 只适合 bottom sheet/dialog，下放到卡片会挤压内容 |
| NPS 的 11px caption 作为正文下限 | 中文 11px 在高 DPI/多语言下偏小；正文保 12–13px |
| NPS「朱砂只三处」被扩展成多品牌色 | 一旦破例就退回彩色控制台；应写成评审/lint 项 |
| CLM 的 FontAwesome + 手写 CSS 变量混用 | 图标与令牌不统一，长期难维护 |

## 6. 工程约定

### 6.1 三家分层
| 项目 | 分层 | 测试 | API |
|---|---|---|---|
| NPS | `electron/`（主进程 db/importer/metadata/preload）+ `src/{shell,library,workbench,state,lib,shared,ui,settings}`；`src/lib` 纯函数、`src/state` hook | `vitest run`；测试与源码同目录 `*.test.js/ts(x)`（`electron/database.test.js`、`src/lib/prompt.test.js`）；另有 `typecheck`(tsc)+`check-js-names`+`verify:app` 截图验收（`package.json:12-36`） | `src/shared/ipc.ts` 定义 `StudioApi` 与 `Result<T> = ({ok:true}&T) \| {ok:false,error}`；`electron/preload.cjs` 用 `contextBridge.exposeInMainWorld('studio', ...)` 一一映射 channel |
| NAI Launcher | `lib/core`（db/utils/services）+ `lib/data`（models/repositories/services/datasources）+ `lib/domain`（entities）+ `lib/presentation`（screens/widgets/providers/themes）；Riverpod 注入 | `test/` 镜像 `lib/` + `integration_test/`；`dart_test.yaml` 30s 超时、并发 4；fixtures 在 `test/fixtures` | 无 HTTP；repository + provider 直连 SQLite/Hive |
| CLM | `py/{routes,services,models,metadata_collector,recipes/parsers,nodes,utils}`；前端 `templates/` + `static/js/{api,state,managers,components,utils,i18n}` | `pytest`（`pytest.ini`：`testpaths=tests`、`asyncio_mode=auto`、markers `integration/performance`）；前端 `tests/frontend/{api,components,core,managers,pages,state,utils}` | aiohttp + 每资源一个 `*_route_registrar.py` 的 `ROUTE_DEFINITIONS`，`/api/lm/...` 前缀；前端 `static/js/api/*.js` 一一对应 |

### 6.2 对新项目的建议
1. **解析器做成可注册策略表**：`server/parsers/{nai,comfyui,a1111}.py`，每个实现 `match(text_chunks) -> bool` + `parse() -> PromptDoc`，按优先级尝试，新增格式不改调用方；形状照抄 CLM 的 `NODE_EXTRACTORS`（`node_extractors.py:1386`）与 `ComfyMetadataParser.is_metadata_matching`（`comfy.py:18-25`）。
2. **正/负面与角色统一为 `PromptDoc`**：`{base:{positive:[Tag],negative:[Tag]}, characters:[{positive,negative,center}], params:{...}, format:'nai'|'comfyui'}`。NPS 的 `PromptStructureRaw`（`types.ts:64-79`）已验证该形状能同时承载 V4 与单段 prompt，ComfyUI 只是 `characters=[]`。
3. **落库用「主表 + 行级标签 + 原文快照」三件套**：`prompts`（原文、format、params_json、usage_count、last_used_at）+ `prompt_tags`（tag/weight/position/brace_*/raw_segment）+ `prompt_revisions`（可选）。行级标签让检索/替换/统计可行，原文快照保证 round-trip 不漂移（`promptDocument.ts` 的核心价值）。
4. **测试以「解析→回写→逐字节比对」为主**：每格式一组 fixture（NAI Comment JSON、ComfyUI `prompt`/`workflow` JSON、对应 PNG），断言 `format(parse(x)) == x`；再补权重边界（`{{a,b},c}`、`1.2::x::`、`||`、孤立 `::`）。这比 UI 测试更能防回归，也是 NPS/NAI Launcher 测试量最大的部分。
5. **令牌与 API 契约各只有一处**：`web/src/styles/tokens.css` 单文件（照 NPS 注释密度写清「用在哪、不能用在哪」）；`server` 响应统一 `{ok:true,...} | {ok:false,error}`（照 `shared/ipc.ts`），前端只经 `web/src/api/client.ts`，禁止组件散落 `fetch`。目录对齐现有骨架：`server/{routes,services,parsers,db}`、`web/src/{shell,library,workbench,state,ui}`。
