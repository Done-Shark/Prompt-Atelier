# Prompt Atelier — API 契约 v1

本地单用户服务，默认监听 `127.0.0.1:8787`。所有接口前缀 `/api`，请求与响应均为 `application/json; charset=utf-8`（图片文件除外）。

- 成功：HTTP 200 + 资源 JSON（列表为 `{ items, total }`）
- 失败：HTTP 4xx/5xx + `{ "error": { "message": "人类可读", "code": "MACHINE_CODE" } }`
- 时间统一 ISO 8601 字符串（`new Date().toISOString()`）
- 未知字段一律忽略；写入前做白名单清洗

## 错误码

| code | HTTP | 含义 |
| --- | --- | --- |
| `VALIDATION` | 400 | 字段缺失或类型错误 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `CONFLICT` | 409 | 名称重复 / 已存在 |
| `PATH_INVALID` | 400 | 扫描目录不存在或不可读 |
| `UNSUPPORTED` | 415 | 不支持的文件类型 |
| `INTERNAL` | 500 | 未预期错误（响应不含堆栈） |

## 1. 基础

### `GET /api/health`
```json
{ "ok": true, "version": "0.1.0", "uptime": 12.4 }
```

### `GET /api/bootstrap`
首屏一次性拉取：设置、文件夹树、全部标签、统计。
```json
{
  "settings": { ...AppSettings },
  "folders": [ { "id": "f_xxx", "name": "角色", "parentId": null, "target": "all", "order": 0, "createdAt": "...", "updatedAt": "..." } ],
  "tags": ["1girl", "solo"],
  "stats": { "prompts": 12, "naiPrompts": 7, "comfyPrompts": 5, "images": 40, "naiImages": 24, "comfyImages": 16, "favorites": 3, "folders": 4, "tags": 18 },
  "version": "0.1.0",
  "formats": {
    "nai": { "model": "nai-diffusion-4-5-full", "sampler": "k_euler_ancestral", "steps": 28 },
    "comfyui": { "checkpoint": "", "loras": [], "sampler": "euler", "steps": 20 }
  }
}
```
`formats` 是后端适配器给出的完整默认参数，前端表单用它初始化，避免两处维护默认值。

## 2. Prompt

### `GET /api/prompts`
Query：`q`（标题/正向/负向/标签模糊匹配，大小写不敏感）、`target`（`nai|comfyui|all`）、`folderId`（`root` 表示未归档，缺省为全部）、`tag`、`favorite`（`1`）、`sort`（`updated|created|title|usage`，默认 `updated`）、`limit`（默认 200，上限 500）、`offset`。
```json
{ "items": [ Prompt ], "total": 12 }
```

### `POST /api/prompts`
Body = `PromptInput`：
```json
{
  "title": "黄昏电车",
  "target": "nai",
  "positive": "1girl, solo, {sunset}, ...",
  "negative": "lowres, bad anatomy",
  "tags": ["场景", "黄昏"],
  "folderId": "f_xxx",
  "favorite": false,
  "notes": "",
  "params": { "model": "nai-diffusion-4-5-full", "steps": 28 },
  "segments": [
    {
      "id": "seg_1",
      "kind": "artist",
      "label": "画师 / 风格来源",
      "tags": [{ "id": "tag_1", "text": "artist:ciloranko", "enabled": true }]
    }
  ],
  "origin": "manual",
  "imageId": null
}
```
规则：
- `target` 必填且只能是 `nai|comfyui`；`positive` 必填（允许空字符串但必须存在）。
- **文本与分块的关系**：`positive` 是最终输出的事实来源。
  - 传入**非空且能序列化出文本**的 `segments`：`positive = serializeSegments(segments)`，以分块为准；
  - 传入 `segments: []`（或所有块为空/所有 tag 停用）：`positive` 原样保留，仅记录分块状态；
  - 不传 `segments`：`positive` 原样保留，后端用 `buildSegments(positive)` 生成结构化视图（自动分块会按语义重排，但**不会**反向改写 `positive`）。
- `title` 为空时自动取正向 Prompt 前 24 个字符；仍为空则 `未命名 Prompt`。
- `params` 会与目标格式默认参数合并（见 §6），未知键丢弃。
- 返回 201 + 完整 `Prompt`（含 `segments`）。

### `GET /api/prompts/:id` → `Prompt`

### `PATCH /api/prompts/:id`
接受 `PromptInput` 的任意子集；`target` 变更时按新目标重新规范化 `params`。
- 只改 `segments` → 重新生成 `positive`；只改 `positive` → 重新生成 `segments`；同时出现以 `segments` 为准。
- 返回更新后的 `Prompt`。

### `DELETE /api/prompts/:id` → `{ "ok": true }`（幂等）

### `POST /api/prompts/:id/duplicate` → 201 + 新 `Prompt`（标题追加 ` 副本`）

### `POST /api/prompts/:id/use`
记录一次使用：`usageCount += 1`，`lastUsedAt = now`。返回 `Prompt`。

### `GET /api/prompts/:id/copy?format=nai|comfyui`
始终序列化 `positive`（分块编辑保存时已由后端重算），停用的 tag 不会出现在结果里。返回可直接粘贴到目标工具的文本：
```json
{ "text": "1girl, solo, ...\nNegative prompt: lowres, ...\nSteps: 28, Sampler: Euler a, CFG scale: 5, Seed: 123, Size: 832x1216, Model: nai-diffusion-4-5-full", "format": "nai" }
```
- NAI：正向 → 空行 → `Negative prompt: ...` → 参数行（`Steps / Sampler / CFG scale / Seed / Size / Model`）。若 `settings.copyWithParams === false` 只返回正向（有负向时附 `Negative prompt:` 段）。
- ComfyUI：正向文本 + `\nNegative: ...` + LoRA 提示行 `<lora:name:weight>` 追加在正向末尾；若保存了 `params.workflow` 且 `format=comfyui&mode=workflow`，直接返回 workflow JSON 字符串。

### `POST /api/prompts/import`
Body：`{ "data": <导出包或 Prompt 数组>, "folderId": null }`
- 支持 `{ "version": 1, "prompts": [...] }`、裸数组、单对象。
- 逐条校验，非法条目跳过；同名不合并。
```json
{ "imported": 3, "skipped": [ { "index": 1, "reason": "target 无效" } ] }
```

### `GET /api/prompts/export?ids=a,b,c&target=all&folderId=`
缺省导出全部（受筛选条件限制）。
```json
{ "version": 1, "exportedAt": "...", "app": "prompt-atelier", "prompts": [ Prompt ] }
```
响应头 `Content-Disposition: attachment; filename="prompt-atelier-YYYYMMDD.json"`。

### `GET /api/tags` → 见 §5 Tag 库

## 3. 文件夹

文件夹同时服务 Prompt 与图片，用 `scope` 区分；图片文件夹按 `target` 隔离（NAI 与 ComfyUI 各自一棵树）。

```json
{ "id": "f_x", "name": "场景", "parentId": null, "scope": "image", "target": "nai", "order": 0 }
```

- `scope = "prompt"`：`target` 只是归属提示（`all` / `nai` / `comfyui`）。
- `scope = "image"`：`target` 必须是 `nai` 或 `comfyui`，创建后不可修改。
- 同级重名检查只在同一 `scope`（根级图片文件夹再加 `target`）内进行，所以 NAI 与 ComfyUI 可以都有「场景」。
- 删除文件夹时子文件夹上移一层；其中的 Prompt / 图片 `folderId` 置 `null`。

### `GET /api/folders?scope=prompt|image|rp&target=nai|comfyui` → `{ "items": [Folder], "total": n }`
图片文件夹会附带 `imageCount`（直属）与 `imageTotal`（含子文件夹）；Prompt 文件夹附带 `promptCount` / `promptTotal`；
RP 文件夹（`scope=rp`，无 target）附带 `characterCount` / `characterTotal`。
### `POST /api/folders` — body `{ name, parentId?, target?, scope?, coverImageId? }` → 201 `Folder`
- 同级同名 → 409 `CONFLICT`；`name` 去空白后为空 → 400。
### `PATCH /api/folders/:id` — `{ name?, parentId?, target?, order?, coverImageId? }`
- 禁止把自身设为父级或形成环 → 400 `VALIDATION`；不能修改 `scope`，图片文件夹不能改 `target`。
- `coverImageId` 是文件夹示例图（封面），必须指向图片库里已有的图片，`null` 表示移除；图片被删除时服务端会自动清空该引用。
### `POST /api/folders/:id/move` — 拖动排序 / 拖动改父级
```json
{ "parentId": null, "beforeId": "f_a" }
```
- `parentId` 为目标父级（`null` = 根级）；省略则保持原父级；
- `beforeId` 为插入位置的前一个兄弟，`null` 表示放到同级末尾；
- 同一父级内即「排序」，跨父级即「移动」（可拖进另一个文件夹成为子级）；
- 旧父级与目标父级的 `order` 都会重新编号为 0..n-1；
- 禁止拖进自身或子级 → 400；目标父级下重名 → 409；跨目标格式 → 400。
返回 `{ "ok": true, "folder": Folder }`。

### `DELETE /api/folders/:id` → `{ "ok": true, "movedPrompts": 4, "movedImages": 2 }`

## 4. 图片库

图片库按 `target` 分为 NAI / ComfyUI 两个分区。`target` 在导入时由元数据自动判定：
- PNG 含 `tEXt/zTXt/iTXt` 键 `Comment` 且可解析出 NovelAI 结构 → `nai`
- PNG 含键 `prompt` 或 `workflow`（ComfyUI API 格式）→ `comfyui`
- 都识别不到时使用导入时指定的 `fallbackTarget`（缺省取 `settings.defaultTarget`），并标记 `metadata.format = "unknown"`
- 只有 ComfyUI `workflow`（UI 格式）而没有 `prompt` 时，仍归入 `comfyui`，保留原始 workflow，`positive` 为空

### `GET /api/images`
Query：`target`（`nai|comfyui|all`）、`q`（文件名/正向/模型）、`favorite=1`、`sort`（`imported|name`，默认 `imported` 倒序）、`limit`（默认 120，上限 500）、`offset`。
```json
{ "items": [ LibraryImage ], "total": 40 }
```

### `GET /api/images/:id` → `LibraryImage`
### `GET /api/images/:id/file` → 原始图片二进制（`Cache-Control: public, max-age=31536000, immutable`）
### `GET /api/images/:id/thumb` → 480px WebP 缩略图
缓存位于 `<data>/thumbs/<hash>.webp`；未生成时返回 404。

### `POST /api/images/:id/thumb` — `{ data: "<base64 webp>" }`
前端首次渲染时用 canvas 生成并回传；只接受 WebP，上限 1MB。图片删除时缓存一并清理。
### `DELETE /api/images/:id` → `{ "ok": true }`（只删索引与库内副本，不碰源目录）
### `PATCH /api/images/:id` — `{ favorite?, tags?, folderId?, target? }`

### `POST /api/images/scan`
扫描配置中的目录（不导入），用于导入前预览。`target` 可为 `auto`（按元数据识别）或强制指定。
```json
{ "target": "auto", "path": "D:/NovelAI/outputs", "recursive": true }
```
识别不到时使用 `settings.defaultTarget` 归类。
```json
{ "entries": [ { "path": "D:/.../image_1.png", "fileName": "image_1.png", "target": "nai", "alreadyImported": false } ], "total": 12 }
```

### `POST /api/images/import`
```json
{ "target": "auto", "path": "D:/NovelAI/outputs", "recursive": true, "fallbackTarget": "nai" }
```
或上传：
```json
{ "target": "auto", "fallbackTarget": "comfyui", "folderId": "f_image_nai", "files": [ { "name": "a.png", "data": "<base64>" } ] }
```
```json
{ "imported": [ LibraryImage ], "skipped": [ { "path": "x.txt", "reason": "不支持的文件类型" } ], "scanned": 12 }
```
- 支持 `png`（解析元数据）、`jpg/jpeg/webp`（无元数据，按 fallback 归类）。
- 去重键：文件内容 sha256；同 hash 已存在则跳过，`reason: "已存在"`。
- 库内副本路径：`<dataDir>/images/<target>/<hash>.<ext>`，原子写入。

### `POST /api/images/batch` — 批量操作
```json
{ "ids": ["i_a", "i_b"], "action": "move", "folderId": "f_x" }
```
- `action = "move"`：移动到目标文件夹（`folderId: null` 表示未归档），跨目标图片跳过；
- `action = "favorite"`：`favorite: true|false`；
- `action = "delete"`：删除索引与库内副本，并清掉 Prompt 的 `imageId` 引用。

返回 `{ "ok": true, "updated": 2, "skipped": 0, "deleted": 0 }`。

### `POST /api/images/reorder` — 手动排序
```json
{ "target": "nai", "folderId": "f_x", "ids": ["i_b"], "beforeId": "i_a" }
```
把 `ids` 插到 `beforeId` 之前（`beforeId: null` 放到末尾），只影响同目标、同文件夹内的图片。返回 `{ "ok": true, "updated": 3 }`。

### `POST /api/images/:id/to-prompt`
用图片元数据创建 Prompt（`origin = "image"`，`imageId` 回填），并把 `promptId` 写回图片。
```json
{ "folderId": null, "tags": [] }
```
→ 201 + `Prompt`

### `POST /api/jobs/import-folder` — 后台目录导入
```json
{ "path": "D:/NovelAI/outputs", "target": "nai", "recursive": true, "folderId": "f_x" }
```
立即返回 202 + 任务快照；实际导入在后台逐文件执行，已存在的图片自动跳过。

### `GET /api/jobs/:id` → 任务进度
```json
{ "status": "running", "total": 120, "done": 36, "imported": 30, "skipped": 6, "errors": [], "importedItems": [] }
```
`status` 为 `running` / `done` / `error`；前端每 350ms 轮询一次。

## 5. 相簿

相簿与文件夹互补：文件夹是图片的唯一归属，相簿是多对多集合；「收藏」是系统相簿（`id = favorites`），成员关系由 `image.favorite` 表示。

```json
{ "id": "a_x", "name": "精选", "order": 0, "count": 3, "system": false }
```

### `GET /api/albums` → `{ "items": [Album], "total": n }`
第一项固定是收藏系统相簿，`count` 为收藏图片数。

### `POST /api/albums` — `{ name }` → 201 `Album`
同名（不区分大小写）→ 409 `CONFLICT`。

### `PATCH /api/albums/:id` — `{ name?, order? }`
系统相簿不可修改。

### `POST /api/albums/reorder` — 拖动排序
```json
{ "ids": ["a_c", "a_a", "a_b"] }
```
按 `ids` 顺序重排 `order`；未列出的相簿按原顺序追加到末尾。系统相簿「收藏」不参与。
返回 `{ "ok": true, "updated": 3 }`。

### `DELETE /api/albums/:id`
删除相簿，并从所有图片的 `albumIds` 中移除；图片本身与文件夹归属不变。

### `POST /api/albums/:id/images` — `{ ids: [], action: "add"|"remove" }`
批量加入/移出相簿；`id = favorites` 时等价于设置 `favorite`。
返回 `{ "ok": true, "updated": 2, "skipped": 0 }`。

## 6. Tag 库

Tag 库是独立的词典集合，收录 Prompt 分块里的内容 tag（以及图片自动提取的 tag）。每条记录：

```json
{
  "tag": "long_hair",
  "category": "appearance",
  "categorySource": "guess",
  "translation": "长发",
  "translationSource": "dictionary",
  "reviewed": false,
  "postCount": null,
  "updatedAt": "2026-10-19T00:00:00.000Z",
  "usage": 4,
  "targets": ["nai"]
}
```

- `category`：`character` 人物 / `copyright` 版权 / `artist` 画师 / `appearance` 外貌 / `clothing` 服装 / `pose` 动作 / `expression` 表情 / `scene` 背景 / `composition` 构图 / `style` 质量风格 / `meta` 元信息 / `unsorted` 未分类。
- `categorySource`：`guess`（规则）/ `danbooru` / `llm` / `manual`。
- `translationSource`：`none` / `dictionary`（内置词典）/ `llm`（OpenAI 兼容）/ `gemini` / `manual`。
- `reviewed = true` 表示人工修正过；所有自动翻译 / 分类默认跳过该条，除非显式 `force`。
- `usage` 是它在 Prompt 分块里出现的次数（派生，不落库）。

### `GET /api/tags?q=&category=&status=all|translated|pending|reviewed|unused&source=all|none|dictionary|llm|gemini|manual&sort=usage|tag|updated&limit=&offset=`
返回 `{ items, total, stats }`，`stats` 为全量统计（不受筛选影响）：
```json
{ "total": 49, "translated": 44, "pending": 5, "reviewed": 2, "byCategory": { "scene": 11 }, "builtin": 395 }
```

### `GET /api/tags/history?limit=20` → `{ items: [{ id, label, createdAt }] }`
最近 20 次可撤销操作（新 → 旧）。覆盖改名 / 合并、查找替换、批量修改、删除别名。

### `POST /api/tags/undo` → `{ ok: true, id, label }`
撤销最近一次操作：按记录还原 Tag 条目、别名、受影响的 Prompt（正负向 / 分块 / tags）与图片 tags。
只保留 20 步，且不含单条单元格编辑。

### `GET /api/tags/aliases` → `{ items: [{ alias, canonical, createdAt }] }`

### `POST /api/tags/aliases/delete` — `{ alias }`
删除一条别名（可撤销），之后旧写法可以重新独立存在。

### `POST /api/tags/rename` — 重命名 / 合并
```json
{ "from": "long hair", "to": "long_hair", "dryRun": true }
```
- 同步改写 Prompt 的 `positive` / `negative` / `segments` / `tags`，以及图片的 `tags` 与元数据正负向；
- 只做按 tag 精确替换（保留括号、权重、顺序），不重新序列化分块；
- 目标已存在 → 合并（人工译文 / 人工分类优先，`reviewed` 取或）；否则重命名条目；
- 旧写法写入 `tagAliases`，之后从 Prompt / 图片再次出现会自动归并；
- `dryRun` 返回影响面：`{ prompts, images, segments, positive, negative, tagAction }`，`tagAction` 为 `renamed` / `merged` / `alias-only`；
- 目标恰好是源的旧别名时，视为「改回去」，会撤销该别名。

### `POST /api/tags/find-replace` — 查找替换
```json
{ "pattern": "^artist:", "replacement": "", "regex": true, "caseSensitive": false, "dryRun": true, "scope": { "status": "all" } }
```
- `scope` 与 `GET /api/tags` 的筛选参数一致，替换只作用于这批 tag；
- `dryRun` 返回 `{ total, matches: [{ from, to, usage }], skipped }`（最多 200 条预览）；
- 执行时逐条走 rename 的同一套逻辑，返回 `{ renamed, prompts, images, total, skipped }`。

### `POST /api/tags/batch` — 批量修改
```json
{ "tags": ["long_hair", "city_lights"], "patch": { "category": "appearance" } }
```
- `patch` 支持 `translation` / `category` / `reviewed`，可组合；
- 语义与单条 PATCH 一致：改翻译或分类会自动 `reviewed = true`（除非显式传 `reviewed`）；
- 服务端一个事务内完成，返回 `{ "ok": true, "updated": 2, "skipped": 0 }`（`skipped` 是不存在的 tag）。

### `PATCH /api/tags`
body `{ tag, translation?, category?, reviewed? }`。用 body 传 tag，避免括号 / 斜杠破坏路径。
- 改翻译或分类 → 自动置 `reviewed = true`、来源记为 `manual`；
- 只传 `reviewed` 可以取消锁定（`false`），之后会重新参与自动流程。

### `POST /api/tags/lookup` — `{ tags: ["long_hair", "city lights"] }`
批量查询分类与翻译，未收录的 tag 用规则推断并返回 `known: false`。图片详情页用它渲染分类分组。

### `POST /api/tags/translate` — `{ provider?: "dictionary"|"llm"|"gemini", tags?: string[], force?: boolean }`
- `dictionary`：内置词典（离线，约 400 条），只补空；
- `llm`：调用设置里的 OpenAI 兼容接口（`POST {baseUrl}/chat/completions`），批量返回翻译与分类；
- `gemini`：调用 Gemini 原生 `POST {baseUrl}/models/{model}:generateContent`，鉴权用 `x-goog-api-key`，默认地址 `https://generativelanguage.googleapis.com/v1beta`、默认模型 `gemini-2.5-flash`；
- 默认只处理"没有翻译且未修正"的条目，`force` 才会覆盖。

### `POST /api/tags/sync` — `{ tags?: string[], force?: boolean }`
从 Danbooru 同步分类与热度（只改分类，不动翻译）。`settings.translation.danbooruEnabled = false` 时返回 400。

### `POST /api/tags/sync-catalog` → `{ "added": 3, "total": 52 }`
把当前所有 Prompt 分块里的 tag 补进目录（幂等）。

### `POST /api/tags/import-dictionary` — 导入外部词典
```json
{ "text": "<JSON 文本>", "overwrite": false }
```
自动识别四种 JSON 结构：`{tag: 中文}` 映射、本项目导出包、NAI Launcher `zh_translations`、DSO `dso-dictionary`（含分类编号/名称）。
- 只补空：已有翻译不覆盖，`reviewed` 的条目跳过（`overwrite: true` 才覆盖，人工分类仍保留）；
- 默认只更新 Tag 库里已存在的 tag，返回里的 `missing` 表示词典有、库里没有的条数；
- 分类按 Danbooru 编号（1 画师 / 3 版权 / 4 人物 / 5 元信息）或 DSO 名称映射到本项目分类。
返回 `{ "format": "map", "total": 3, "updated": 2, "added": 0, "skipped": 0, "missing": 1 }`。

ffdkj 的 `tag.sqlite`（约 22 MB / 31 万条）体积大，走命令行：`npm run import:dict`。

### `POST /api/tags/import` / `GET /api/tags/export`
导入导出格式：`{ "version": 1, "tags": [TagEntry] }`；导入时带翻译或分类的条目会标记 `reviewed`。

## 7. 设置

### `GET /api/settings` → `AppSettings`
### `PATCH /api/settings`
接受子集。`theme` ∈ `dark|light|system`；`scanPaths.nai/comfyui` 为绝对路径数组（不校验存在性，扫描时校验）。→ 更新后的 `AppSettings`

```json
{
  "theme": "dark",
  "defaultTarget": "nai",
  "scanPaths": { "nai": ["D:/NovelAI/outputs"], "comfyui": ["D:/ComfyUI/output"] },
  "dataDir": "<数据目录>",
  "copyWithParams": true,
  "autoTagOnImport": true,
  "reduceMotion": false,
  "translation": {
    "provider": "dictionary",
    "baseUrl": "",
    "model": "",
    "apiKey": "",
    "autoTranslateOnImport": false,
    "danbooruEnabled": true
  }
}
```

- `translation.provider`：`dictionary`（内置词典，离线）/ `llm`（OpenAI 兼容接口）/ `gemini`（Gemini 原生接口）。
- `baseUrl` 留空时：`llm` 报错提示填写；`gemini` 用 `https://generativelanguage.googleapis.com/v1beta`。
- `model` 留空时：`gemini` 用 `gemini-2.5-flash`。
- `apiKey`：`gemini` 必填；本地 OpenAI 兼容服务通常留空。

### `GET /api/stats` → `Stats`

## 8. 目标格式默认参数

`params` 在写入时按 `target` 规范化，缺失键用默认值补齐：

**NAI**
```json
{
  "model": "nai-diffusion-4-5-full",
  "sampler": "k_euler_ancestral",
  "steps": 28,
  "scale": 5,
  "cfgRescale": 0,
  "seed": 0,
  "width": 832,
  "height": 1216,
  "ucPreset": 0,
  "qualityToggle": true,
  "variety": false
}
```

**ComfyUI**
```json
{
  "checkpoint": "",
  "loras": [],
  "sampler": "euler",
  "scheduler": "normal",
  "steps": 20,
  "cfg": 7,
  "seed": 0,
  "width": 1024,
  "height": 1024,
  "batch": 1,
  "workflow": null
}
```

## 9. Prompt 分块（segments）

`segments` 是正向 Prompt 的结构化视图，实现与分类规则在 `shared/prompt/doc.js`（前后端共用同一份）。块按数组顺序拼接，块内 tag 按数组顺序拼接，分隔符固定 `, `。

| kind | 含义 |
| --- | --- |
| `artist` | 画师 / 风格来源 |
| `subject` | 人物 / 版权 |
| `appearance` | 外貌特征 |
| `clothing` | 服装 |
| `pose` | 动作 / 姿势 |
| `expression` | 表情 / 视线 |
| `scene` | 背景 / 环境 |
| `composition` | 构图 / 镜头 |
| `style` | 质量 / 风格 |
| `lora` | LoRA / 触发词 |
| `custom` | 自定义 |
| `unsorted` | 未分类 |

- tag 保留原始权重语法（`{...}`、`(x:1.2)`、`<lora:...>`），不做归一化；复制单个 tag 时原样输出。
- `enabled=false` 的 tag 保留在数据中，但不参与序列化。
- 校验：最多 24 块；每块最多 300 个 tag；单个 tag 最长 500 字符；`kind` 非法落为 `unsorted`；块 `label` 最长 40 字符；空块保留（编辑器需要存下未填写的块），但不产生文本。
- 块顺序即输出顺序，前端可拖动调整。

## 10. 静态资源与回退

- `GET /`、`GET /assets/*`：服务 `web/dist` 构建产物。
- 非 `/api` 的未知路径回退到 `index.html`（SPA 路由）。
- `web/dist` 不存在时，`/` 返回 200 + 一段提示文案（提示先运行 `npm run build` 或 `npm run dev`），不返回 404。
- 开发期 Vite 在 `5173`，`/api` 代理到 `8787`；后端对 `/api/*` 允许 `http://localhost:5173` 与 `http://127.0.0.1:5173` 的 CORS。


## 11. RP 角色卡

角色卡 = 一张原图 + 标签 / 设定 / 简介 / Prompt。图片按原图保存：`<data>/images/rp/<sha256>.<ext>`，
与 NAI / ComfyUI 一样按模块分目录，扩展名跟随真实格式，不做解码或压缩。

```json
{
  "id": "c_x",
  "name": "银发骑士 · 塞拉",
  "tags": ["骑士", "银发"],
  "settings": "性格：冷静…\n场景：北境要塞",
  "description": "适合慢热剧情",
  "prompt": "塞拉，北境要塞的守夜骑士…",
  "imageFile": "rp/<sha256>.png",
  "imageHash": "<sha256>",
  "imageExt": "png",
  "imageWidth": 512,
  "imageHeight": 768,
  "imageBytes": 12929,
  "originalName": "sela.png",
  "source": "png",
  "createdAt": "2026-10-22T00:00:00.000Z",
  "updatedAt": "2026-10-22T00:00:00.000Z"
}
```

### `GET /api/characters?q=&folderId=&sort=updated|name&limit=&offset=` → `{ items, total }`
`q` 同时匹配名称、标签、设定、简介与 Prompt；`folderId` 取 `all` / `root` / 文件夹 id，选中父文件夹时包含子级。

### `POST /api/characters` — `{ name?, tags?, settings?, description?, prompt?, image?, originalName?, source? }` → 201 `CharacterCard`
`image` 是 base64（可带 `data:` 前缀），支持 PNG / JPG / WebP，上限 20MB。

### `PATCH /api/characters/:id` — 同上；传 `image` 才替换原图，旧图在未被其他卡共享时删除。

### `DELETE /api/characters/:id` → `{ "ok": true }`，同时清理未被共享的原图。

### `GET /api/characters/:id/image` → 原图字节（`Cache-Control: immutable`）

### `GET /api/characters/:id/thumb` / `POST /api/characters/:id/thumb` — `{ data }`
缩略图缓存在 `<data>/thumbs/<sha256>.webp`（与图片库共用同一目录）；前端首次渲染时生成并回传。

### `POST /api/characters/batch-delete` — `{ ids }` → `{ ok, deleted }`
一次事务删除多张；原图只在没有其它卡引用时移除。

### `POST /api/characters/batch-move` — `{ ids, folderId }` → `{ ok, moved, folderId }`
`folderId` 为 `null` 表示移回未归档。

### `POST /api/characters/import` — `{ files: [{ name, data }], allowDuplicateNames? }`
支持 SillyTavern PNG（`chara` / `ccv3` 文本块）与 JSON（V2 `{spec,data}` 或扁平对象）。
字段映射：`name ← name`、`tags ← tags`、`settings ← personality + scenario`、
`description ← creator_notes`（缺失时取描述前 300 字）、`prompt ← description`。
同一张图（sha256 相同）只导入一次；**同名角色卡默认跳过**（`allowDuplicateNames: true` 可放行）。
返回 `{ imported: [CharacterCard], skipped: [{ name, reason }] }`。


## 12. 整库备份 / 恢复

备份是**文件夹**形态（图片太大，不适合塞进单个 JSON）：

```
PromptAtelier-backup-YYYYMMDD-HHmmss/
├─ manifest.json   app / format / version / exportedAt / counts / secretsOmitted
├─ data.json       设置、Prompt、图片索引与原始元数据、文件夹、Tag、别名、相册、RP 角色卡
├─ images/         nai / comfyui / rp 原图
└─ thumbs/         缩略图缓存
```

### `POST /api/backup/export` — `{ targetDir }` → `{ path, bytes, manifest }`
- 在 `targetDir` 下新建 `PromptAtelier-backup-<时间>`；
- **不包含** `translation.apiKey`（`secretsOmitted` 会写明）；
- 备份目录不能位于数据目录内部。

### `POST /api/backup/inspect` — `{ sourceDir }` → `{ path, manifest, dataBytes }`
校验 `manifest.json` 的 `app` 与 `format`，并确认 `data.json` 存在。

### `POST /api/backup/restore` — `{ sourceDir }` → `{ ok, counts, exportedAt, safetyPath }`
- 先把当前 `data.json` 另存到 `<data>/backups/pre-restore-<时间>/`；
- 用备份的 `data.json` 经过 `migrate` 后整体替换仓储；
- `images/` 与 `thumbs/` 覆盖复制（不删除备份里没有的文件）；
- 备份里没有 API Key，恢复后沿用当前机器已配置的 Key。
