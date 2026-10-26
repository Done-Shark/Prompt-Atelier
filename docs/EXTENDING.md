# 扩展指南

这份文档写给"三个月后回来改代码的人"。改之前先看这里的顺序，能避免同时动前后端时漏改。

## 1. 先认清三条单一来源

| 关注点 | 唯一来源 | 改动后必须同步 |
| --- | --- | --- |
| 接口字段与行为 | `docs/API.md` | `web/src/lib/types.ts` → 后端 service → 前端 api/页面 |
| Prompt 分词与语义分类 | `shared/prompt/doc.js` | 前后端自动生效，只补测试 |
| 目标格式的展示信息 | `shared/targets.js` | 前后端自动生效 |
| 视觉令牌 | `web/src/styles/tokens.css` | 组件只引用变量，不写数值 |

**不要**在页面里复制一套分类规则、格式名称或颜色。

## 2. 新增第三种格式（例如 SD WebUI）

按顺序改 5 处，其余层不动：

1. `shared/targets.js`：加一项 `{ id, label, short, badge, dot, pathHint }`。
2. `server/formats/<id>.js`：实现 `defaults() / normalize(params) / serialize(prompt, options)`，并在 `server/formats/index.js` 注册。
3. `server/media/<id>Metadata.js`：把该工具写进图片的元数据转成 `ImageMetadata`；在 `server/modules/images/service.js` 的 `analyzeBuffer` 里加一个分支（注意先判 NAI，再判 ComfyUI 一类）。
4. `web/src/features/prompts/ParamsForm.tsx`：加一个参数表单组件，并在 `ParamsForm` 的 `target` 分支里路由。
5. `web/src/styles/ui.css`：加 `.badge--<id>` 的两个颜色变量（`--<id>-text` / `--<id>-wash` 在 `tokens.css` 里定义）。

还要顺手处理：

- `server/store/schema.js` 的 `scanPaths` 目前固定 `nai/comfyui` 两个键，新增格式时改成按 `TARGET_IDS` 生成，并写迁移。
- `web/src/lib/types.ts` 的 `Target` 联合类型加新值（TS 会强制你处理所有分支，这是好事）。
- `docs/API.md` §6 补默认参数。
- 测试：`server/formats/formats.test.js` 加 normalize/serialize 用例；`server/media/metadata.test.js` 加解析用例。

## 3. 给 Prompt 加字段

当前字段白名单分散在两处：`server/modules/prompts/service.js` 的 `buildPrompt` 与 `applyPatch`；前端 `PromptEditor.tsx` 的 `Draft / emptyDraft / fromPrompt / save`。

改一个字段的最小清单：

1. `docs/API.md` 的 Prompt 字段表。
2. `web/src/lib/types.ts` 的 `Prompt` 与 `PromptInput`。
3. 后端 `buildPrompt`（创建）与 `applyPatch`（更新）各加一行清洗。
4. 前端 `Draft`、`emptyDraft`、`fromPrompt`、`save` 各加一处。
5. 详情页需要展示时加 `PromptDetail` 的 section。
6. 测试：创建 + PATCH 各一条。

> 字段的长度、枚举与清洗规则已集中到 `shared/prompt/fields.js`：新增字段时先加进 `PROMPT_SIMPLE_FIELDS` / `PROMPT_FIELD_KEYS`，再改前端，`fields.test.js` 会校验落库字段是否与 schema 一致。

## 4. 改语义分类规则

只改 `shared/prompt/doc.js` 的 `KEYWORDS` / `classifyTag`：

- 分类是**前缀优先**：先匹配整词短语，再匹配单词；顺序决定"looking at viewer"落在动作而不是表情。
- 改完必须跑 `node --test shared/prompt/doc.test.js`。
- 已保存的 Prompt 不会自动重分类；用户可以在编辑器里点「重新分类」。
- 新增一个块类型：在 `SEGMENT_KINDS` 加一项，并确认 `normalizeSegments` 的白名单会接受它（`isSegmentKind` 自动生效）。

## 5. 新增页面

1. `web/src/app/pages.ts` 加页面 id。
2. `web/src/app/App.tsx` 的 `NAV` 与 `page-host` 加渲染分支。
3. 新建 `web/src/features/<name>/`，页面组件 + 独立 CSS。
4. 数据走 `lib/api.ts`，不要直接 `fetch`；跨页面状态放 `app/store.tsx`。

页面之间**不要互相 import**。需要复用的 UI 放 `components/`（`ImportDialog` 就是这样从 gallery 下沉出来的）。

## 6. 契约变更顺序

```
docs/API.md → web/src/lib/types.ts → server 实现 + 测试 → web/src/lib/api.ts → 页面
```

反过来的话，前端会先于契约产生隐式字段，Reviewer 无法用文档判断对错。

## 7. 已知技术债（改动前先读）

| 位置 | 问题 | 建议 |
| --- | --- | --- |
| `electron/main.cjs` | 安装包未签名 | 对外分发前配置代码签名，减少 SmartScreen 提示 |
| `server/modules/storage/layout.js` | 磁盘结构由数据库驱动 | 不要在资源管理器里手动改名/移动图片，结构请在应用内调整 |
| `web/src/components/ThumbImage.tsx` | 缩略图首次浏览才生成 | 图片量大时可加批量预生成 |
| `server/store/db.js` | 每次写全库重写 | 数据量继续增长时可改增量写 |

## 8. Tag 库与翻译

### 加一条内置翻译
只改 `shared/tagTranslations.js` 的 `ENTRIES`：键是规范化 tag（小写、空格转下划线），值是 `[中文, 分类?]`。分类省略时由 `guessTagCategory` 推断。改完跑 `node --test shared/prompt/doc.test.js`。

### 加一个分类
1. `shared/tagCategories.js` 的 `TAG_CATEGORIES` 加一项（同时补 `TagCategoryId` 类型）。
2. 如果它需要从语义块映射，补 `SEGMENT_TO_TAG_CATEGORY`。
3. Tag 库表格与图片详情分组会自动出现；Prompt 语义块不受影响（两套视图故意分开）。

### 接新的翻译来源
1. 在 `server/modules/tags/` 新建 provider（参考 `llm.js` / `gemini.js`：输入 tag 数组，输出 `Map<tag, {translation, category}>`；提示词、JSON 解析、结果归一化复用 `aiShared.js`）。
2. `service.js` 的 `PROVIDERS` 与 `translate()` 分支加一项，`schema.js` 的 `TRANSLATION_SOURCES` 加同名来源。
3. 设置页「Tag 与翻译」加配置项与说明。
4. 批量操作默认跳过 `reviewed === true` 与已有翻译，除非显式 `force` —— 这是"修正过的 tag 不再处理"的实现点，改动时不要绕过。

### 导入外部词典
- `server/modules/tags/dictionaryImport.js`：`parseDictionaryJson` 识别通用映射 / 导出包 / NAI Launcher / DSO；`readFfdkjSqlite` 用 `node:sqlite` 只读打开 ffdkj 的 `tag.sqlite`。
- 命令行 `npm run import:dict [源]`：源可以是 `ffdkj`（默认，带缓存）、本地 sqlite / json 或 URL；`--overwrite` 覆盖已有翻译、`--all` 把库里没有的 tag 也写进去、`--dry-run` 只统计。
- HTTP `POST /api/tags/import-dictionary` 只接受 JSON 文本（sqlite 太大不适合走接口）。
- 合并策略集中在 `mergeDictionary`：只补空、跳过 reviewed、分类只在原分类为 guess/空时更新。改策略只改这一处。

### 内置词典的来源
`shared/tagTranslations.js` 是仓库内手写的起点词典（约 400 条中英对照），**不是 Danbooru 数据集**；Danbooru 只用于 `sync` 分类与热度。要换成大规模词典，按导入包格式（`POST /api/tags/import`）导入，或替换 `lookupBuiltinTag` 的数据源。

### 自动处理边界
- `reviewed` 只能由人工修改翻译 / 分类、或显式切换产生；
- 自动翻译只填空，不覆盖；
- 迁移时只会重算 `categorySource === 'guess'` 的分类，人工 / Danbooru / 模型结果保留。

## 9. 文件夹作用域

`folders` 一张表服务两种用途，用 `scope` 区分：

- `scope: 'prompt'`：提示词库的文件夹树；
- `scope: 'image'`：图片文件夹，`target` 固定为 `nai` 或 `comfyui`，两个图库各自一棵树。

新增页面若要用文件夹，必须显式传 `scope`（`api.folders.list({ scope, target })`），不要复用全部文件夹列表。图片的 `folderId` 只能指向同目标的图片文件夹，服务端会校验并回落到未归档。


## 10. 相簿、存储与缩略图

### 相簿
- `db.albums` 只存相簿本身；成员关系在 `image.albumIds`，多对多。
- 「收藏」是虚拟相簿 `favorites`，不要往 `db.albums` 里写；它映射到 `image.favorite`。
- 删除相簿只清 `albumIds`，不要动图片文件或 `folderId`。

### 存储
- 业务层只依赖 `snapshot()` / `mutate(fn)`，不要直接读 SQLite。
- 新增集合：在 `server/store/sqlite.js` 的 `COLLECTIONS` 加一项并在 `schema.js` 补默认值；SQLite 表结构会自动创建。
- 旧数据迁移：`migrate(raw, dataDir)` 必须保持幂等；SQLite 首次启动会把 `db.json` 迁入并备份。
- 没有 `node:sqlite` 的运行环境会自动回退 `db.json`，新功能不要假设一定有 SQLite。

### 缩略图与后台任务
- 缩略图只接受 WebP（≤1MB），文件名用图片 `hash`，内容不可变；换图必然换 hash。
- 删除图片时必须调用 `dropThumb`，否则缓存会残留。
- 目录导入任务在内存里保存进度，重启即丢失；需要持久化时再加 `jobs` 表。
