# Smart tasks-kanban

Turn any [Kanban](https://github.com/mgmeyers/obsidian-kanban) board into a **smart board** that is automatically filled with tasks pulled from across your vault by the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin. Mark a task as done simply by dragging its card into your done column.

## Requirements

- Obsidian `>= 1.4.0`
- The community plugins **Kanban** and **Tasks** must be installed and enabled.

## How it works

Add a `smart-columns` block to the frontmatter of a Kanban board note:

```yaml
---
kanban-plugin: board
smart-columns:
  - column: Due today
    source: due-today
  - column: Overdue
    source: due-overdue
done-column: Done
---
```

- **`column`** — the name of a smart column. It must match the `## heading` of that column in the board body exactly. You can add as many smart columns as you like.
- **`source`** — the filter rule for the column (see the table below, or a dynamic value `tag:<tag name>`).
- **`done-column`** — the name of your done column. Dragging a card into it completes the task; dragging it back out undoes the completion. Omit this line to disable drag-to-done.

After saving, reopen the note. Each smart column heading gets a `(智能列)` suffix and is filled automatically.

### `source` values

| source | meaning |
| --- | --- |
| `due-today` | due today |
| `due-overdue` | due before today |
| `due-soon` | due within 7 days |
| `due-later` | due after 7 days |
| `due-any` | any task with a due date |
| `due-none` | tasks without a due date |
| `scheduled-today` | scheduled today |
| `scheduled-overdue` | scheduled before today |
| `scheduled-soon` | scheduled within 7 days |
| `scheduled-later` | scheduled after 7 days |
| `scheduled-any` | any task with a scheduled date |
| `scheduled-none` | tasks without a scheduled date |
| `start-today` | start today |
| `start-overdue` | start before today |
| `start-soon` | start within 7 days |
| `start-later` | start after 7 days |
| `start-any` | any task with a start date |
| `start-none` | tasks without a start date |
| `created-today` | created today |
| `created-week` | created within 7 days |
| `created-any` | any task with a created date |
| `tag:<name>` | tasks carrying the given tag (dynamic) |

## Card operations

- **Auto-fill** — smart columns are rewritten by the plugin; do not edit cards inside them manually.
- **Check-off write-back** — checking a card that carries a `[[source]]` link also marks the task done in its source note and records the `✅ completion date`.
- **Drag into done** — completes the task and writes back to the source; a source-less card is only marked done on the board.
- **Drag out to undo** — flips the task back to `- [ ]` and removes the completion mark.
- **Recurring renewal** — completing a recurring task (`🔁`) generates the next instance in the source note and advances its due date.
- **Auto-archive** — on every refresh, cards completed on a day other than today are moved into Kanban's native archive area.

## How is this different from other plugins?

Smart tasks-kanban is **not a standalone kanban board**. It augments the [Kanban](https://github.com/mgmeyers/obsidian-kanban) plugin you may already use, turning selected columns into live views of your [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) queries. That single design choice is what separates it from most alternatives:

| Plugin | Board model | Columns organized by | Writes completion back to the source task | Notes |
| --- | --- | --- | --- | --- |
| **Smart tasks-kanban** (this plugin) | Enhances an existing Kanban board | Time buckets (`due-today`, `overdue`, `scheduled-*`, `tag:`) | ✅ Yes — `[x]` + `✅` date, drag out to undo | Recurring renewal (`🔁`), auto-archive to Kanban's native Archive |
| [Tasks Kanban](https://github.com/Djiit/obsidian-tasks-kanban) | Standalone board view | Task **status** (todo / in-progress / done), custom columns | ✅ Yes — writes done/cancelled dates in Tasks format | More feature-rich: saved boards, swimlane grouping, full Tasks query, sorting/filtering |
| [obsidian-kanban](https://github.com/mgmeyers/obsidian-kanban) (native) | Standalone board | Manual cards | n/a | No auto-filled columns by itself; a [Dynamic Query Lanes PR](https://github.com/mgmeyers/obsidian-kanban/pull/1165) proposes native query lanes |
| [Tickban](https://community.obsidian.md/plugins/tickban) | Standalone board | Fixed TODO / DOING / DONE from `- [ ]` / `[/]` / `[x]` | ✅ Yes (toggles the checkbox) | Simpler; folder/glob scoped, tag badges |
| [Task List Kanban](https://github.com/chrskerr/task-list-kanban) | Standalone board | `#column-tag` on the task line | ✅ Yes (rewrites tag + done date) | Archive, bulk ops, dashboard |
| [Property Kanban](https://obsidian.md/plugins?id=property-kanban) | Standalone board | Note **frontmatter** properties | ✅ Yes (updates frontmatter) | Cards are notes, not tasks; swimlanes, parent/child links |

**When to choose which:**

- Choose **Tasks Kanban** if you want a brand-new, query-driven board with rich grouping, sorting, and multiple saved views.
- Choose **Smart tasks-kanban** if you already live in a Kanban board and want it to *become* a time-aware Tasks dashboard (today / overdue / this week) that writes straight back to your task lines — including recurring renewal and native archiving — without replacing the board you already use.

## Commands

Open the command palette (`Ctrl/Cmd + P`):

- **Refresh current smart board** — refreshes only the open board.
- **Refresh all smart boards** — refreshes every board in the vault (also runs on the timer).

## Settings

- **Auto refresh / Refresh interval** — automatically refresh all smart boards on a fixed interval.
- **Write back source task on completion** — sync completion back to the source note.
- **Show source link on cards** — append a `[[source]]` link. Turning this off disables write-back and drag-out undo.
- **Show priority / due / scheduled / start / created / dataview / recurring** — toggle which metadata is kept on cards.
- **Recurring task auto-renewal** — generate the next instance for `🔁` tasks.
- **Auto-archive completed (non-today)** — archive cards completed on a previous day.
- **Debug mode** — write refresh/sync diagnostics to `diag.txt` for troubleshooting.

## Installation

### Option 1: BRAT (recommended)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. In BRAT settings, add this repository URL: `https://github.com/lindongyan1992/kanban-smart-columns`
3. Enable **Smart tasks-kanban** and configure it in its settings.

### Option 2: Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Put them in `<your vault>/.obsidian/plugins/kanban-smart-columns/`.
3. Enable the plugin in Obsidian settings.

## Note for maintainers

> A screenshot in this README is recommended before submitting to the Obsidian community directory (soft review item).

---

# 中文说明

将任意 [Kanban](https://github.com/mgmeyers/obsidian-kanban) 看板变成一块**智能看板**：由 [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) 插件从整个库自动拉取任务并填充。只需把卡片拖入"已完成"列，即可将任务标记为完成。

## 运行要求

- Obsidian `>= 1.4.0`
- 必须安装并启用社区插件 **Kanban** 与 **Tasks**。

## 工作原理

在 Kanban 看板笔记的 frontmatter 中加入 `smart-columns` 块：

```yaml
---
kanban-plugin: board
smart-columns:
  - column: Due today
    source: due-today
  - column: Overdue
    source: due-overdue
done-column: Done
---
```

- **`column`** — 智能列的名称，必须与看板正文中该列的 `## 标题` 完全一致。可以添加任意多个智能列。
- **`source`** — 该列的筛选规则（见下表，或动态值 `tag:<标签名>`）。
- **`done-column`** — 你的"已完成"列名称。把卡片拖入该列即完成任务；拖出则撤销完成。省略此行可禁用"拖入完成"。

保存后重新打开笔记。每个智能列标题会加上 `(智能列)` 后缀并自动填充。

### `source` 取值

| source | 含义 |
| --- | --- |
| `due-today` | 今天到期 |
| `due-overdue` | 今天之前到期 |
| `due-soon` | 7 天内到期 |
| `due-later` | 7 天之后到期 |
| `due-any` | 任意带到期日的任务 |
| `due-none` | 无到期日的任务 |
| `scheduled-today` | 今天计划 |
| `scheduled-overdue` | 今天之前计划 |
| `scheduled-soon` | 7 天内计划 |
| `scheduled-later` | 7 天之后计划 |
| `scheduled-any` | 任意带计划日的任务 |
| `scheduled-none` | 无计划日的任务 |
| `start-today` | 今天开始 |
| `start-overdue` | 今天之前开始 |
| `start-soon` | 7 天内开始 |
| `start-later` | 7 天之后开始 |
| `start-any` | 任意带开始日的任务 |
| `start-none` | 无开始日的任务 |
| `created-today` | 今天创建 |
| `created-week` | 7 天内创建 |
| `created-any` | 任意带创建日的任务 |
| `tag:<name>` | 带有指定标签的任务（动态） |

## 卡片操作

- **自动填充** — 智能列由插件自动重写，请勿手动编辑其中的卡片。
- **勾选写回** — 勾选带有 `[[来源]]` 链接的卡片时，也会在源笔记中将任务标记为完成，并记录 `✅ 完成日期`。
- **拖入完成** — 完成任务并写回源笔记；无来源链接的卡片仅在看板上标记完成。
- **拖出撤销** — 将任务翻回 `- [ ]` 并移除完成标记。
- **循环任务续期** — 完成带 `🔁` 的循环任务时，会在源笔记生成下一实例并推进其到期日。
- **自动归档** — 每次刷新时，非当天完成的卡片会被移入 Kanban 原生的归档区。

## 与其他插件的差异

Smart tasks-kanban **不是一块独立的看板**。它增强你可能已经在用的 [Kanban](https://github.com/mgmeyers/obsidian-kanban) 插件，把选定的列变成 [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) 查询的实时视图。这一设计取向正是它与多数替代方案的区别所在：

| 插件 | 看板形态 | 列的划分依据 | 是否回写源任务 | 备注 |
| --- | --- | --- | --- | --- |
| **Smart tasks-kanban**（本插件） | 增强既有 Kanban 板 | 时间分桶（`due-today`、`overdue`、`scheduled-*`、`tag:`） | ✅ 是 — `[x]` + `✅` 日期，拖出可撤销 | 循环续期（`🔁`）、自动归档到 Kanban 原生 Archive |
| [Tasks Kanban](https://github.com/Djiit/obsidian-tasks-kanban) | 独立看板视图 | 任务**状态**（todo / in-progress / done），可自定义列 | ✅ 是 — 以 Tasks 格式写入 done/cancelled 日期 | 功能更全：已保存看板、泳道分组、完整 Tasks 查询、排序/筛选 |
| [obsidian-kanban](https://github.com/mgmeyers/obsidian-kanban)（原生） | 独立看板 | 手动卡片 | 不适用 | 自身不带自动填充列；[动态查询泳道 PR](https://github.com/mgmeyers/obsidian-kanban/pull/1165) 提议原生查询泳道 |
| [Tickban](https://community.obsidian.md/plugins/tickban) | 独立看板 | 固定的 TODO / DOING / DONE（取自 `- [ ]` / `[/]` / `[x]`） | ✅ 是（切换勾选框） | 较简单；按文件夹/glob 范围，标签徽章 |
| [Task List Kanban](https://github.com/chrskerr/task-list-kanban) | 独立看板 | 任务行上的 `#列标签` | ✅ 是（改写标签 + 完成日期） | 归档、批量操作、仪表盘 |
| [Property Kanban](https://obsidian.md/plugins?id=property-kanban) | 独立看板 | 笔记 **frontmatter** 属性 | ✅ 是（更新 frontmatter） | 卡片是笔记而非任务；泳道、父子链接 |

**如何选型：**

- 若你想要一块全新的、查询驱动的看板，带有丰富的分组、排序与多个已保存视图，选 **Tasks Kanban**。
- 若你已在使用某块 Kanban 看板，并希望让它*变成*一块"时间感知"的 Tasks 仪表盘（今天 / 逾期 / 本周），直接写回你的任务行——包括循环续期与原生归档——同时不替换你正在用的看板，选 **Smart tasks-kanban**。

## 命令

打开命令面板（`Ctrl/Cmd + P`）：

- **Refresh current smart board**（刷新当前智能看板）— 仅刷新当前打开的看板。
- **Refresh all smart boards**（刷新所有智能看板）— 刷新库中所有看板（定时器也会触发）。

## 设置

- **Auto refresh / Refresh interval**（自动刷新 / 刷新间隔）— 按固定间隔自动刷新所有智能看板。
- **Write back source task on completion**（完成时写回源任务）— 将完成状态同步回源笔记。
- **Show source link on cards**（卡片上显示来源链接）— 追加 `[[source]]` 链接。关闭后将禁用写回与拖出撤销。
- **Show priority / due / scheduled / start / created / dataview / recurring**（显示优先级 / 到期 / 计划 / 开始 / 创建 / dataview / 循环）— 切换卡片上保留的元数据。
- **Recurring task auto-renewal**（循环任务自动续期）— 为 `🔁` 任务生成下一实例。
- **Auto-archive completed (non-today)**（自动归档已完成（非当天））— 归档前一天完成的卡片。
- **Debug mode**（调试模式）— 将刷新/同步诊断写入 `diag.txt` 以便排查。

## 安装

### 方式一：BRAT（推荐）

1. 安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat)。
2. 在 BRAT 设置中添加此仓库 URL：`https://github.com/lindongyan1992/kanban-smart-columns`
3. 启用 **Smart tasks-kanban** 并在其设置中配置。

### 方式二：手动安装

1. 从最新 Release 下载 `main.js`、`manifest.json`、`styles.css`。
2. 将它们放入 `<你的库>/.obsidian/plugins/kanban-smart-columns/`。
3. 在 Obsidian 设置中启用该插件。

## 维护者说明

> 提交到 Obsidian 社区目录前，建议在 README 中加入一张截图（软性审核项）。
