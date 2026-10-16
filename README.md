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
