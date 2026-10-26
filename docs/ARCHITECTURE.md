# Prompt Atelier — 架构

## 1. 产品边界

本地优先的 AI Prompt 管理工具，一个进程、一份数据目录、无账号、无云端。

**做**：Prompt 的保存 / 编辑 / 检索 / 分类 / 收藏 / 复制 / 导入导出；从 NAI 与 ComfyUI 的图片里解析出 Prompt 与参数；按目标格式分区管理图片。
**不做**：调用生成 API、启动 WebUI、模型下载、账号同步。参考项目里 Aaalice_NAI_Launcher 的生成链路只借鉴信息架构，不移植。

核心判断：**一个 Prompt 是独立实体**（参考项目都把 Prompt 依附在图片或生成记录上），因此可以脱离图片存在、被复用、被统计使用次数。

## 2. 技术选型

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 前端 | React 19 + TypeScript + Vite | 参考项目已验证；组件化便于后期扩展第三种格式 |
| 样式 | 原生 CSS + CSS 变量令牌（`web/src/styles/tokens.css`） | 不引入 UI 框架，避免千篇一律；令牌是唯一来源 |
| 图标 | lucide-react | 线性、统一、体积可控 |
| 后端 | Node.js 原生 `http`（ESM，零运行时依赖） | 本地单用户无需框架；减少安装体积与供应链风险 |
| 存储 | JSON 文档 + 原子写（`data/db.json`） | 零原生依赖、可直接备份/阅读；仓储层隔离，后续可替换 SQLite |
| 图片解析 | 自研 PNG chunk 读取 + `node:zlib` | NAI 与 ComfyUI 都把参数写在 PNG 文本块，无需第三方库 |
| 测试 | `node:test`（后端）+ Vitest（前端纯函数） | 与运行时一致，零额外配置 |

端口：后端 `8787`，Vite `5173`（`/api` 代理到后端）。

## 3. 目录与模块边界

```
prompt-atelier/
├─ server/
│  ├─ index.js                 启动、端口、优雅退出
│  ├─ app.js                   路由表装配（只做分发，不含业务）
│  ├─ config.js                路径解析、默认设置、版本号
│  ├─ lib/
│  │  ├─ http.js               请求体读取、JSON 响应、CORS、静态文件、SPA 回退
│  │  ├─ router.js             方法+路径匹配（含 :id 参数）
│  │  ├─ errors.js             ApiError（code/status）
│  │  ├─ ids.js                id 生成
│  │  ├─ fsx.js                原子写、安全路径、hash、递归遍历
│  │  └─ validate.js           字段清洗与类型断言
│  ├─ store/
│  │  ├─ db.js                 单文件 JSON 仓储：读缓存、串行写、事务快照
│  │  └─ schema.js             默认数据结构与迁移
│  ├─ modules/
│  │  ├─ prompts/              service + routes（查询、CRUD、导入导出、copy）
│  │  ├─ folders/              service + routes（树、环检测）
│  │  ├─ images/               service + routes（扫描、导入、去重、to-prompt）
│  │  ├─ settings/             service + routes
│  │  └─ tags/                 派生统计（不单独存储）
│  ├─ formats/
│  │  ├─ index.js              target → adapter 注册表
│  │  ├─ nai.js                默认参数、规范化、copy 序列化、语法解析辅助
│  │  └─ comfyui.js            默认参数、规范化、copy 序列化、workflow 提取
│  └─ media/
│     ├─ png.js                PNG chunk 解析（tEXt/zTXt/iTXt）
│     ├─ naiMetadata.js        Comment JSON → ImageMetadata
│     ├─ comfyMetadata.js      workflow/prompt JSON → ImageMetadata
│     └─ probe.js              图片尺寸嗅探（PNG/JPEG/WebP）+ 统一入口
├─ web/
│  ├─ index.html
│  ├─ vite.config.ts
│  └─ src/
│     ├─ main.tsx
│     ├─ app/                  App 外壳、路由、全局 Provider
│     ├─ styles/               tokens.css / base.css
│     ├─ lib/                  api 客户端、types、prompt 语法、格式化、剪贴板
│     ├─ components/ui/        通用原语（Button/Input/Modal/Tabs/Toast/…）
│     └─ features/
│        ├─ prompts/           列表、卡片、编辑器、参数表单、文件夹树
│        ├─ gallery/           双分区图片库、网格、查看器、导入
│        ├─ tags/
│        └─ settings/
└─ docs/                       本目录（架构 / API / 设计 / 参考笔记 / 审查记录）
```

**依赖方向**：`modules → formats / store / lib`，`formats → lib`，`media → lib`。`modules` 之间不互相 import（跨领域协作走 `store` 与 `service` 入参）。前端 `features` 只依赖 `lib` 与 `components/ui`，feature 之间不直接 import（共享状态放 `app` 层）。

## 4. 数据存储

`data/db.json`：

```json
{
  "version": 1,
  "settings": { "...": "见 API.md §5" },
  "folders": [],
  "prompts": [],
  "images": []
}
```

- 写入策略：全部变更在内存快照上完成 → 写 `db.json.tmp` → `fsync` → `rename` 覆盖；失败则回滚内存快照。
- 写操作串行化（单进程内 Promise 队列），避免并发覆盖。
- 图片二进制存 `data/images/<target>/<sha256>.<ext>`，索引里只存相对路径；`db.json` 可单独备份，图片目录可单独迁移。
- 首次启动若 `db.json` 不存在，写入默认设置与空集合。

## 5. 图片元数据管线

```
文件 → probe（尺寸/类型）
     → png.readTextChunks()  （tEXt / zTXt inflate / iTXt）
     → 若含 Comment 且 JSON 里有 NovelAI 字段 → naiMetadata
     → 若含 prompt 或 workflow          → comfyMetadata
     → 否则 format = unknown（按 fallbackTarget 归类）
     → 去重（sha256）→ 复制入库 → 写索引
```

**NAI**：`Comment` 是 JSON。优先读 `v4_prompt.caption.base_caption` / `v4_negative_prompt.caption.base_caption`（V4/V4.5 多角色），回退到 `prompt` / `uc`；参数取 `steps / scale / seed / sampler / width / height / model`，`noise_schedule` 映射 sampler。角色级 caption 保存在 `raw.v4_prompt.caption.char_captions`。

**ComfyUI**：`prompt` 是 API 格式图（`{nodeId: {class_type, inputs}}`）。定位策略：
1. 找 `KSampler` / `KSamplerAdvanced` 节点，读 `seed/noise_seed`、`steps`、`cfg`、`sampler_name`、`scheduler`、`denoise`。
2. 沿 `positive` / `negative` 输入链接回溯到 `CLIPTextEncode`（可穿过 `ControlNetApply`、`ConditioningCombine` 等中间节点，最多 8 跳）。
3. `CheckpointLoaderSimple.ckpt_name`；`LoraLoader.lora_name/strength_model/strength_clip`（可串联）。
4. `EmptyLatentImage` / `EmptySD3LatentImage` 的 `width/height/batch_size`。
5. 找不到 KSampler 时退化为扫描全部 `CLIPTextEncode`，取文本最长者为正向。
`workflow` 只作为原始数据保留，不解析。

解析失败不阻断导入：`format=unknown`，`positive` 为空，详情页提示"未识别到生成参数"。

## 6. 格式适配层

`formats/index.js` 暴露统一接口：

```js
getAdapter(target) → {
  target,
  defaults(),                    // 默认参数
  normalize(params),             // 白名单 + 类型 + 默认值
  serialize(prompt, options),    // copy 文本
  isValidParams(params),         // 轻校验
}
```

新增第三种格式（如 Midjourney / SD WebUI）时只加一个 adapter + 一个 metadata 解析器，Prompt 列表、存储、API 不变。前端参数表单按 `target` 注册组件（`features/prompts/params/`）。

## 7. 错误与一致性

- 所有 handler 包在 `try/catch`，已知错误转 `ApiError`，未知错误记录日志并返回 `INTERNAL`（不泄漏堆栈）。
- 输入校验集中在 `lib/validate.js`：字符串 trim + 长度上限（title 200、positive 20000、notes 10000、tags 单项 64 / 最多 50 个）。
- 删除文件夹不级联删除 Prompt；删除 Prompt 不删除图片；删除图片不回删 Prompt（`promptId` 置空）。
- 所有列表接口返回 `total`，前端分页与计数使用服务端结果。

## 8. 测试策略

- 后端：`formats/*` 规范化与序列化、`media/*` 用构造的 PNG 字节流做真实解析、prompts CRUD 与筛选、文件夹环检测、导入导出往返。
- 前端：Prompt 语法解析（权重/分隔符/LoRA）、格式化与截断、筛选排序等纯函数。
- 验收：`npm run build` + 启动服务，用浏览器实测首屏、CRUD、导入、复制、双分区切换。

## 10. v2 增量（图片双模块 / Tag 库 / 分类设置）

- **图片库拆成两个模块**：`#/gallery-nai` 与 `#/gallery-comfy` 各自渲染 `GalleryPage`（`target` prop），拥有独立文件夹树与筛选状态。`folders` 表新增 `scope: 'prompt' | 'image'`，图片文件夹按 `target` 隔离。
- **Tag 库成为独立领域**：`server/modules/tags/` 下分 `catalog.js`（写入与使用统计）、`danbooru.js`（分类同步）、`llm.js`（OpenAI 兼容翻译）、`service.js`（目录 / 修正 / 批量）。数据落在 `db.tags`，Prompt 与图片写入时通过 `ensureTagEntries` 增量收录。
- **分类是两套视图**：`shared/prompt/doc.js` 的语义块服务"写 Prompt"，`shared/tagCategories.js` 的 Tag 分类服务"查词与翻译"（人物 / 版权分开）。映射集中在 `SEGMENT_TO_TAG_CATEGORY`。
- **人工修正是硬边界**：`reviewed = true` 的条目默认跳过所有自动流程；迁移只重算规则来源的分类。
- **设置改为分类页**：导航固定在左下角，页面左侧分类、右侧表单；新增翻译配置与 Tag 批量处理入口。


## 11. v3 增量（相簿 / SQLite / 缩略图 / 后台任务）

- **相簿是独立组织层**：`db.albums` + `image.albumIds` 多对多；「收藏」是虚拟系统相簿（`favorites`），成员关系仍是 `image.favorite`。文件夹仍是唯一归属，移动文件夹不影响相簿。
- **存储换 SQLite**：`server/store/sqlite.js` 用 `node:sqlite` 持久化，集合按主键增量 upsert、写入走事务；接口与 JSON 仓储一致，`openDb` 在 SQLite 不可用时回退 `db.json`。首次启动自动迁移旧库并保留备份。
- **缩略图缓存**：浏览器首次渲染用 canvas 生成 480px WebP，`POST /api/images/:id/thumb` 落盘到 `<data>/thumbs/<hash>.webp`；之后直接读缓存。图片删除时同步清理。
- **后台导入任务**：`server/modules/jobs/` 逐文件导入并维护进度，前端轮询；失败只影响单张。
- **渲染优化**：图片网格按日期分组、分页加载，卡片使用 `content-visibility: auto` 跳过屏外渲染。
- **侧栏增强**：文件夹排序 / 折叠 / 隐藏；相簿区与文件夹区并列。
- **文件夹示例图**：`folder.coverImageId` 指向图片库里的图片，由 `PATCH /api/folders/:id` 校验与写入；图片删除时服务端清空引用。文件夹列表按 `scope` 返回 `imageTotal` / `promptTotal`，前端据此显示数量。
- **侧栏拖动**：`POST /api/folders/:id/move` 同时承担「同级排序」与「改父级」，服务端重编号两个父级的 `order` 并做环检测；`POST /api/albums/reorder` 按 id 顺序重排。文件夹 / 相簿用指针拖拽（`web/src/lib/useRowDrag.ts`），图片卡片拖到文件夹仍用 HTML5 + 自定义 MIME（`web/src/lib/dnd.ts`），两套互不干扰。


## 12. v5 增量（RP 角色卡）

- **新模块 `server/modules/characters/`**：角色卡 CRUD 与导入，数据落在 `db.characters`；图片按原图存 `images/rp/<sha256>.<ext>`。
- **卡片解析 `server/media/rpCard.js`**：PNG 的 `chara` / `ccv3` 文本块（base64 JSON）与 JSON 文件（V2 / 扁平）统一映射成四个字段。
- **存储约定**：NAI / ComfyUI / RP 三个模块的图片都按 `<module>/<sha256>.<ext>` 保存原始字节，扩展名跟随真实格式；删除角色卡时清理未被共享的原图。
- **文件夹**：`folders.scope` 增加 `rp`，与 prompt / image 共用同一套排序、父级与环检测；删除文件夹时角色卡回到未归档。
- **缩略图**：RP 复用 `<data>/thumbs/<sha256>.webp` 缓存（与图片库同目录），`ThumbImage` 支持传入自定义 URL 来源。
- **角色卡拖拽**：`lib/useDragToTarget.ts` 负责「条目 → 带 `data-card-target` 的目标」，落点后 PATCH `folderId`；与 `useRowDrag` 共用指针方案与点击抑制。
- **前端 `features/rp/`**：`RpPage`（文件夹 + 列表 + 详情）、`RpFolderTree`、`RpEditor`，不依赖 Prompt 或图片模块的状态。


## 13. v6 增量（整库备份）

- **新模块 `server/modules/backup/`**：导出为「data.json + images + thumbs」的文件夹；恢复走 `migrate` 后整体替换。
- **仓储新增 `replace(data)`**：SQLite 与 JSON 两种实现都按队列写入整份数据，供恢复使用。
- **安全策略**：恢复前把当前 `data.json` 另存到 `<data>/backups/pre-restore-*`；图片只覆盖不删除；备份不含 `translation.apiKey`。


## 14. v7 增量（Tag 库虚拟滚动）

- 行高固定 52px（`ROW_HEIGHT` 与 `.tag-virtual .tag-table__row` 必须同步），按 `scrollTop` 计算可见区间，绝对定位 + `translateY` 渲染。
- 列表区域独立滚动（`.tag-virtual`），表头与工具栏固定；接近底部时自动 `loadMore()`，保留「加载更多」兜底。
- 键盘 `Enter / Tab` 跳转时，如果目标行尚未渲染，会先滚动到目标位置再聚焦。


## 15. 桌面打包

- **electron-builder**：`npm run dist` 产出 NSIS 安装包与便携版，`npm run pack` 产出未安装目录；输出在 `release/`。
- **数据目录**（打包后）：`PROMPT_ATELIER_DATA_DIR` > 便携版 `exeDir/data`（`PORTABLE_EXECUTABLE_DIR`）> `app.getPath('userData')/data`。
- **打包内容**：`electron/`、`server/`、`shared/`、`web/dist/`、`package.json`（asar），排除测试与文档。
- **图标**：`scripts/make-icon.mjs` 纯代码绘制 256×256 PNG 并封装成 ICO，不引入图形依赖。
- **冒烟**：`ATELIER_SMOKE=1`（打包后的 exe 会把未知 `--flag` 交给 Chromium 报错，所以用环境变量）启动后截图到临时目录，8 秒兜底退出，用于验证打包产物能正常起服务。


## 16. 技术债清理（v8）

- **Prompt 字段 schema**：`shared/prompt/fields.js` 定义长度上限（`PROMPT_LIMITS`）、来源枚举（`PROMPT_ORIGINS`）、简单字段清洗规则（`PROMPT_SIMPLE_FIELDS`）与落库字段全集（`PROMPT_FIELD_KEYS`）。
  - `server/lib/validate.js` 的 `LIMITS` 直接引用 `PROMPT_LIMITS`；
  - `buildPrompt` / `applyPatch` 统一走 `cleanSimpleField`，不再各写一份 negative / notes / tags / favorite / origin；
  - `fields.test.js` 校验「实际落库字段 === `PROMPT_FIELD_KEYS`」，防止以后新增字段漏登记。
- **图片原始元数据拆表**：`db.imageRaw = [{ id, raw }]`，`images[].metadata` 不再包含 `raw`。
  - 迁移时自动把老数据的 `metadata.raw` 搬到 `imageRaw`；
  - 删除图片时同步清理；备份 `data.json` 一并导出；
  - 列表接口不再传输大 JSON，万级图片时内存与响应明显更稳。
- **to-prompt 编排上移**：新增 `server/modules/actions/service.js`，一个事务内完成「建 Prompt + 回填 image.promptId」；
  - `prompts.createInData` / `images.linkPromptInData` 暴露纯草稿操作，供跨模块复用；
  - `images` 模块不再 import `prompts`，路由只调用 actions。


## 17. 图片存储：镜像布局（v9）

- **磁盘结构**：`images/<target>/<文件夹链>/<原文件名>.<ext>`；角色卡为 `images/rp/<文件夹链>/<角色名>.<ext>`。未归档直接放分区根目录。
- **唯一实现 `server/modules/storage/layout.js`**：
  - `planLayout(data)` 纯函数计算每个图片 / 角色卡的目标相对路径，重名追加 ` (2)`；
  - `relayout(ctx)` 串行执行：先搬文件再写库，支持「文件已在目标、库还没更新」的自愈；
  - `ensureMirroredStorage(ctx)` 在 `createApp` 启动时调用，完成旧扁平布局迁移并打 `settings.storageLayout = 'mirrored'` 标记。
- **触发点**：图片导入 / 修改 / 批量移动、文件夹改名 / 移动 / 删除、角色卡增删改 / 批量移动、备份恢复之后都会 `await relayout(ctx)`。
- **为什么不镜像导入源目录**：上传文件没有源路径，且应用内文件夹才是用户可维护的「实际结构」；磁盘镜像应用文件夹可以保证「应用里看到的树 = 资源管理器里的树」。
- **代价**：文件夹改名 / 移动会触发文件搬移（幂等，可重试）；哈希去重仍然成立，不会因为改名产生副本。


## 18. Tag 分类可配置（v10）

- **数据**：`db.tagCategories = [{ id, label, order, builtin }]`，内置 12 个分类由 `shared/tagCategories.js` 提供基线，迁移时合并用户自建分类并保留 `order`。
- **服务**：`server/modules/tagCategories/` 提供 list / create / update / remove / reorder；删除自建分类时，其下 tag 回落到 `unsorted`。
- **校验**：Tag 的 `category` 不再用静态枚举，统一按当前 `tagCategories` 判断；自动分类（猜测 / 词典 / AI）仍只产出内置分类。
- **前端**：`store.tagCategories` 由 bootstrap 下发；Tag 库筛选、行内下拉、批量设置分类、图片详情分组全部按该顺序渲染；分类管理弹窗支持新增 / 改名 / 拖动排序 / 删除。
