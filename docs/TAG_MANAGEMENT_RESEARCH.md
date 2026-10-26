# Tag 管理方案调研

> 目的：为 Prompt Atelier 的 Tag 库找一套「成熟、可借鉴」的管理模型，而不是继续在现有表格上叠按钮。
> 调研对象：图像数据集标注工具、WebUI 扩展、素材管理器、Booru 体系。
> 结论只针对「词典 / 标签管理」，与生成、训练流程无关。

## 0. 一句话结论

成熟方案的分水岭不在「能不能改一条 tag」，而在三件事：

1. **跨对象改名**：改一次 tag，所有引用它的图片 / Prompt 一起改（TagGUI、BDTM、Dataset Tag Editor 都有）。
2. **别名与层级**：同一个概念的不同写法归并（Hydrus 的 siblings/parents、Danbooru 的 alias/implication）。
3. **批量作用于「当前筛选结果」**：先筛，再批量改（Dataset Tag Editor 的核心工作流）。

我们目前只做到了「逐条编辑 + 批量改字段」，缺的正是这三件。

## 1. 各方案的关键手段

### 1.1 BooruDatasetTagManager（BDTM）

面向 LoRA 数据集打标，C# 桌面端。

- 多选图片 → 共享 tag 编辑：选一批图，改一次等于改整批。
- 右侧「全部 tag / 公共 tag」面板：按出现频率看整个数据集里有哪些 tag。
- **翻译文件**：`Translations/<语言>.txt`，格式 `原文=译文`；人工译文用 `*` 前缀标记，**优先于自动翻译**。这和我们 `reviewed` 的思路一致，但它是「文件即数据」，可以直接用编辑器批量改。
- 权重编辑：括号 ↔ 权重滑杆，一键增减层级。
- 可加载 a1111 tagcomplete 的 CSV 词表。
- 快捷键可配置；菜单里按功能分组（View / Tools / Settings）。

参考：<https://github.com/starik222/BooruDatasetTagManager>

### 1.2 Dataset Tag Editor（WebUI 扩展 / 独立版）

- **先过滤，再批量**：按 tag 过滤图片（AND/OR、正向/负向），所有批量操作只作用于「当前显示的图片」。
- 批量替换 / 删除 / 追加 tag、批量排序 tag。
- **正则查找替换**：`1boy, 2boys…` → `1girl, 2girls…` 这类模式化改法。
- 单图精修 + 批量两套入口分开。

参考：<https://github.com/toshiaki1729/dataset-tag-editor-standalone>

### 1.3 TagGUI

目前最接近「成熟 tag 管理」的桌面工具。

- **All Tags 面板**：选中 tag 按 `Delete` 删除所有实例；双击或 `F2` **重命名所有实例**。
- 图片 tag 面板：`F2` 改名、`Delete` 删除、拖拽排序、多选。
- `Ctrl+R` 查找替换、`Ctrl+B` 批量重排 tag。
- **高级过滤语法**：`tag:` / `caption:` / `name:` / `path:`，数值条件（`tags:>=13`、`tokens:>75`），通配符 `*` `?`，`AND / OR / NOT` 与括号。
- 键盘优先：`Alt+F/A/I/S` 聚焦不同区域，`Ctrl+J` 跳到第一张未打标图。

参考：<https://github.com/jhc13/taggui>

### 1.4 a1111-sd-webui-tagcomplete

- CSV 词表：`name,type,postCount,aliases`；`aliases` 用引号包裹逗号分隔。
- **别名**：可「按别名搜索」，插入时替换为真实 tag（因为模型只认真实 tag）。
- **翻译文件**：`英文,译文`，可反向按中文搜英文 tag。
- 分类用 Danbooru 数字（0 general / 1 artist / 3 copyright / 4 character / 5 meta），用于着色。

参考：<https://github.com/DominikDoom/a1111-sd-webui-tagcomplete>

### 1.5 Hydrus Network（标签体系最完整）

- **Tag Siblings（兄弟 / 别名）**：把多个写法归并成一个「显示与搜索都用」的 tag，例如 `character:ayanami rei` → `character:rei`。归并后旧写法仍可搜到，但显示统一。
- **Tag Parents（父子 / 层级）**：`species:cat` 自动蕴含 `species:animal`，用于聚合搜索与浏览。
- 两者都有「petition（提交）→ 审核」流程，支持批量导入导出（HTA 归档），并可做大规模 tag migration（迁移、删除、改名）。
- 搜索语法：`system:`、`namespace:`、否定、OR。

参考：<https://hydrusnetwork.github.io/hydrus/>（tags → siblings / parents；tag migration 在 advanced）

### 1.6 Danbooru 体系（事实标准）

- **Alias**：`long hair` → `long_hair`，搜索旧词自动跳到新词。
- **Implication**：`hatsune_miku` 自动带出 `vocaloid`，用于保证标签闭包。
- **Category + Wiki**：每个 tag 有分类、说明、翻译来源。
- 这些关系由社区维护，是「标签不会越用越脏」的根本原因。

## 2. 横向对比

| 能力 | BDTM | Dataset Tag Editor | TagGUI | tagcomplete | Hydrus | 我们现状 |
| --- | --- | --- | --- | --- | --- | --- |
| 逐条改译文 / 分类 | ✅ | 部分 | ✅ | 只读词表 | ✅ | ✅ |
| 跨对象批量改名 | ✅（多图共享） | ✅（批量替换） | ✅（F2 全部实例） | — | ✅（migration） | ❌ |
| 删除 tag 的全部引用 | ✅ | ✅ | ✅ | — | ✅ | ❌ |
| 查找替换 / 正则 | ❌ | ✅ | ✅ | — | 部分 | ❌ |
| 先筛选再批量 | 部分（多选图） | ✅ | ✅（强过滤语法） | — | ✅ | 仅按分类/状态筛 |
| 别名（同义词归并） | ❌ | ❌ | ❌ | ✅（只影响补全） | ✅ | ❌ |
| 层级（父子） | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| 人工译文优先 | ✅（`*` 前缀） | — | — | — | — | ✅（reviewed） |
| 撤销 / 重做 | ❌ | 部分 | ✅ | 浏览器撤销 | ✅ | ❌ |
| 键盘流 | 可配置 | 一般 | ✅（强） | ✅ | ✅ | 部分（Enter/Tab） |
| 虚拟滚动 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌（200/页） |

## 3. 提炼出的共性模型

1. **Tag 是「有引用的实体」，不是一行文本**。改名 / 删除必须级联到引用方，否则数据会分裂。
2. **人工结果必须可标记、可优先**。BDTM 用 `*`，Hydrus 用 petition 审核，我们用 `reviewed`，本质相同。
3. **批量操作的作用域 = 当前筛选结果**，而不是「全部」或「勾选」。Dataset Tag Editor 把这当成核心交互。
4. **筛选语法要能表达「包含 / 不包含 / 数量 / 来源」**，TagGUI 的 `tag:` / `tokens:>=75` 是最实用的形态。
5. **别名是低成本的去重手段**，不必真改数据就能统一显示与搜索；真合并留给显式操作。
6. **危险操作要有 diff 与确认**。Hydrus 的 migration 反复强调「先小范围试验、先备份」。
7. **键盘优先**是「管理几十条」和「管理几千条」的分界线。

## 4. 对我们的适配判断

### 直接可用

- **重命名 / 合并 tag（含别名）**：我们的 tag 同时被 `prompt.segments[].tags[].text`、`prompt.positive`（序列化结果）、`prompt.tags`、`image.tags` 引用，改名必须一次性改完并重算 positive。这是当前最大的缺口。
- **查找替换（普通 + 正则）**：作用域为「当前筛选结果」，先预览再执行。
- **筛选增强**：`未使用`、`有译文/无译文`、`来源`、`使用次数区间`，以及按分类多选。
- **撤销**：至少支持「撤销上一次批量操作」，用操作日志实现，不需要全量快照。
- **虚拟滚动**：Tag 库上千条后必须做，否则 200/页 + 加载更多会很累。

### 需要改造后可用

- **别名表**：新增 `tagAliases` 集合（`alias → canonical`）。查询与展示时归并，写入时统一落到 canonical；合并时把 alias 记录保留下来，后续再出现旧写法自动归并。
- **层级（父子）**：对「按主题浏览 Prompt」有价值，但对当前以「翻译/分类」为主的 Tag 库收益有限，建议放到 P2。

### 不建议照搬

- BDTM 的「翻译文件即数据」：我们已经有 SQLite + reviewed，再引入文件会造成双写。
- Hydrus 的 petition 审核流程：单人本地使用，成本过高。
- Danbooru 的 implication 闭包：会把「1girl → solo」这类推断写进数据，容易污染 Prompt。

## 5. 建议路线

### P0（下一步就做）

1. **重命名 / 合并 tag**
   - 入口：行菜单「重命名…」、批量「合并到…」。
   - 服务端一个事务：改 `segments` 文本 → 重新 `serializeSegments` 写回 `positive` → 同步 `prompt.tags`、`image.tags` → 合并 tag 条目（译文取人工优先，分类人工优先）→ 旧名写入 `tagAliases`。
   - 先给 diff 预览：影响 N 条 Prompt、M 张图片、译文/分类如何取舍。
2. **查找替换**（含正则），作用域 = 当前筛选结果，先预览后执行。
3. **筛选补齐**：未使用 / 无译文 / 来源 / 使用次数区间。

### P1

4. **撤销上一次批量操作**（操作日志，保留 20 步）。
5. **虚拟滚动** + 全量选中（跨分页）。
6. **别名归并**：输入旧写法时自动落到 canonical。

### P2

7. 层级 / 父子标签、按主题聚合浏览。
8. 标签使用趋势（近 30 天新增、长期未用）。

## 6. 交互细节（可直接照抄的部分）

- 改名用 `F2` / 双击；删除全部引用用 `Delete` + 二次确认，确认框里写明「影响 N 条 Prompt / M 张图片」。
- 批量操作前显示 diff：`long hair → long_hair（32 条 Prompt，8 张图片）`。
- 查找替换支持「仅当前筛选」「区分大小写」「正则」三个开关。
- 撤销入口固定在工具栏，显示「撤销：合并 long hair → long_hair」。

## 7. 落地记录

- P0-1 重命名 / 合并：`POST /api/tags/rename`（dryRun 预览 + `tagAliases`），前端 `RenameTagDialog`。
- P0-2 查找替换：`POST /api/tags/find-replace`（正则 / 捕获组 / 作用域 = 当前筛选），前端 `FindReplaceDialog`。
- P0-3 筛选补齐：状态新增 `unused`，来源筛选已上线。
- P1 撤销：`db.tagHistory` 记录 before/after，`POST /api/tags/undo`，覆盖改名 / 查找替换 / 批量修改 / 删除别名（20 步）。
- P1 别名管理：`GET /api/tags/aliases` + 删除接口，前端 `AliasDialog`。
- P1 虚拟滚动：固定 52px 行高 + 视口渲染 + 滚动到底自动加载（1249 条实测只渲染 20 行）。
- 未做：别名自动归并提示、父子层级。

## 8. 参考链接

- BooruDatasetTagManager：<https://github.com/starik222/BooruDatasetTagManager>
- Dataset Tag Editor：<https://github.com/toshiaki1729/dataset-tag-editor-standalone>
- TagGUI：<https://github.com/jhc13/taggui>
- a1111 tagcomplete：<https://github.com/DominikDoom/a1111-sd-webui-tagcomplete>
- Hydrus Network：<https://hydrusnetwork.github.io/hydrus/>
- Danbooru tag aliases / implications：<https://danbooru.donmai.us/wiki_pages/help:tags>
