import {
  App,
  Plugin,
  TFile,
  WorkspaceLeaf,
  DataAdapter,
  debounce,
  PluginSettingTab,
  Setting,
  MarkdownRenderer,
  Notice,
} from "obsidian";
import {
  getSmartColumns,
  isKanbanFile,
  applySmartColumns,
  syncBackCompletions,
  autoCompleteInDoneColumn,
  revertMovedFromDone,
  archiveOldDone,
} from "./smartColumns";
import type { CardTextOpts } from "./tasks";

type Lang = "zh" | "en";

/**
 * obsidian-kanban 注册的视图类型（其 `registerView(qr, …)` 中 qr === "kanban"）。
 * 用于在改写看板文件后，把新内容推送给打开着的看板视图——因为 kanban 会忽略
 * 自身文件的外部修改（详见 syncKanbanView 的注释）。
 */
const KANBAN_VIEW_TYPE = "kanban";

/**
 * 诊断日志：把「设置落盘 / 是否改写文件 / 找到几个看板视图 / 视图数据是否一致 / 报错」
 * 全程写进插件目录下的 diag.txt（超过体积上限时自动截断，只保留最近部分）。
 * 用途：这类「改了没生效」的问题涉及 Obsidian 运行时与另一个插件的视图状态，
 * 静态读代码/读磁盘都无法判定，必须靠运行时日志拿到事实，避免反复猜测。
 */
const DIAG_MAX_BYTES = 120 * 1024;
const DIAG_PATH = ".obsidian/plugins/kanban-smart-columns/diag.txt";
let DIAG_ADAPTER: DataAdapter | null = null;
let DIAG_ENABLED = false;
let diagQueue: Promise<void> = Promise.resolve();

/** 由设置项「调试模式」控制是否写诊断日志（关闭时完全静默，不产生任何磁盘写入）。 */
export function setDiagEnabled(v: boolean) {
  DIAG_ENABLED = v;
}

/** 清空诊断日志文件。 */
export async function clearDiag() {
  const ad = DIAG_ADAPTER;
  if (!ad) return;
  try {
    await ad.write(DIAG_PATH, "");
  } catch {
    /* 忽略 */
  }
}

export function diag(msg: string) {
  const ad = DIAG_ADAPTER;
  if (!ad || !DIAG_ENABLED) return;
  const line = `${new Date().toISOString().slice(11, 23)} ${msg}\n`;
  // 串行写入，避免并发 read-modify-write 互相覆盖
  diagQueue = diagQueue
    .then(async () => {
      let prev = "";
      try {
        prev = await ad.read(DIAG_PATH);
      } catch {
        prev = "";
      }
      if (prev.length > DIAG_MAX_BYTES) {
        prev = prev.slice(Math.floor(prev.length / 2));
      }
      await ad.write(DIAG_PATH, prev + line);
    })
    .catch(() => {
      // 诊断日志失败不影响功能
    });
}

interface SmartColumnsSettings {
  autoRefresh: boolean;
  refreshIntervalMinutes: number;
  syncBack: boolean;
  showSourceLink: boolean;
  showPriority: boolean;
  showDue: boolean;
  showScheduled: boolean;
  showStart: boolean;
  showCreated: boolean;
  showDataview: boolean;
  showRecurring: boolean;
  recurring: boolean;
  archiveEnabled: boolean;
  debugMode: boolean;
  language: Lang;
  excludePaths: string[];
}

const DEFAULT_SETTINGS: SmartColumnsSettings = {
  autoRefresh: true,
  refreshIntervalMinutes: 30,
  syncBack: true,
  showSourceLink: true,
  showPriority: false,
  showDue: false,
  showScheduled: false,
  showStart: false,
  showCreated: false,
  showDataview: false,
  showRecurring: false,
  recurring: true,
  archiveEnabled: true,
  debugMode: false,
  language: "zh",
  excludePaths: [],
};

/**
 * source 取值表（分组）。中英文分别提供，切换语言时整体替换。
 */
interface SourceGroup {
  title: string;
  rows: [string, string][];
}

/**
 * 设置页全部文案（中 / 英）。切换语言时整页按所选语言重渲染。
 * 内含 backtick 的代码片段以双引号字符串承载，英文里出现的双引号用 \" 转义。
 */
interface I18nText {
  languageName: string;
  languageDesc: string;
  guideHead: string;
  sourceHeader: [string, string];
  sourceGroups: SourceGroup[];
  guideTail: string;
  /** 设置项分类标题 */
  categories: {
    card: string;
    sync: string;
    refresh: string;
    debug: string;
    scope: string;
  };
  settings: {
    autoRefresh: { name: string; desc: string };
    refreshInterval: { name: string; desc: string };
    syncBack: { name: string; desc: string };
    showSourceLink: { name: string; desc: string };
    showPriority: { name: string; desc: string };
    showDue: { name: string; desc: string };
    showScheduled: { name: string; desc: string };
    showStart: { name: string; desc: string };
    showCreated: { name: string; desc: string };
    showDataview: { name: string; desc: string };
    showRecurring: { name: string; desc: string };
    recurring: { name: string; desc: string };
    archiveEnabled: { name: string; desc: string };
    debugMode: { name: string; desc: string };
    excludePaths: { name: string; desc: string };
  };
}

const I18N: Record<Lang, I18nText> = {
  zh: {
    languageName: "界面语言",
    languageDesc: "设置页面显示语言（中文 / English）",
    guideHead: [
      "## 使用方法",
      "",
      "### 一、配置智能看板",
      "在看板笔记最开头加入 frontmatter（含上下两条 `---` 分隔线）：",
      "",
      "```yaml",
      "---",
      "kanban-plugin: board",
      "smart-columns:",
      "  - column: 到期",
      "    source: due-today",
      "  - column: 逾期",
      "    source: due-overdue",
      "done-column: 已完成",
      "---",
      "```",
      "",
      "- `smart-columns` 列出各智能列：`column` 为列名，`source` 为筛选规则（见下表或 `tag:<标签>`）。",
      "- `done-column` 可省略：配置了才启用「拖入完成列即完成 / 拖出即撤销」。",
      "- 列名须与看板正文里的 `## 列标题` 完全一致。",
      "",
      "保存后重新打开笔记，智能列标题会自动加 `(智能列)` 后缀并按规则填充。",
      "",
      "### 二、source 可选值",
      "",
    ].join("\n"),
    sourceHeader: ["source", "筛选内容"],
    sourceGroups: [
      {
        title: "到期日类（依赖 📅 到期日）",
        rows: [
          ["due-today", "今天到期"],
          ["due-overdue", "已逾期（到期日早于今天）"],
          ["due-tomorrow", "明天到期"],
          ["overdue-or-today", "逾期 + 今天到期（马上要做的事）"],
          ["due-this-week", "本周（周一~周日）到期"],
          ["due-next-week", "下周（周一~周日）到期"],
          ["due-next-7-days", "今天起 7 天内到期"],
          ["due-next-30-days", "今天起 30 天内到期"],
          ["no-due", "无到期日的任务"],
          ["all-open", "有到期日的全部未完成任务"],
          ["all-undone", "全部未完成任务（含无到期日）"],
        ],
      },
      {
        title: "计划 / 开始 / 创建类",
        rows: [
          ["scheduled-today", "今天计划开始（⏳）"],
          ["scheduled-overdue", "计划开始日已过、仍未完成（⏳）"],
          ["start-today", "今天开始（🛫）"],
          ["created-today", "今天新建（➕）"],
          ["created-7-days", "最近 7 天（含今天）新建（➕）"],
        ],
      },
      {
        title: "优先级类",
        rows: [
          ["priority-top", "最高优先级 ⏫"],
          ["priority-high", "高优先级 ⏫ / 🔺"],
        ],
      },
      {
        title: "动态取值（可自由组合）",
        rows: [["tag:<标签名>", "含该标签的未完成任务，如 tag:育儿、tag:#读书"]],
      },
    ],
    guideTail: [
      "任务取自全库所有笔记中符合 Tasks 插件语法的 `- [ ]` 未完成任务（看板文件自身的卡片会被自动排除）。",
      "",
      "### 三、卡片操作",
      "- 智能列由本插件整体重写，请勿在其中手动添加或编辑卡片。",
      "- 勾选带 `[[来源]]` 的卡片：同步把来源笔记里的任务标为完成并记录 ✅ 完成日期。",
      "- 把卡片拖入 `done-column`：自动完成并回写来源；无来源的手写卡仅看板内标记完成。",
      "- 把卡片从完成列拖回其它列：自动翻回未完成并撤销来源笔记的完成标记（或清除卡片行 ✅）。",
      "- 完成带 `🔁` 的循环任务：自动生成下一条实例并推进到期日。",
      "- 每次刷新把完成列中**非当天完成**的卡片移入 Kanban 原生的「归档」区。",
      "",
      "### 四、手动刷新",
      "命令面板（Ctrl / Cmd + P）执行：",
      "- 刷新当前智能看板：只刷新当前打开的看板。",
      "- 刷新所有智能看板：刷新全库所有看板。",
    ].join("\n"),
    categories: {
      card: "卡片显示",
      scope: "扫描范围",
      sync: "完成与同步",
      refresh: "刷新",
      debug: "问题排查",
    },
    settings: {
      autoRefresh: {
        name: "自动刷新",
        desc: "按设定间隔自动刷新全库所有智能看板",
      },
      refreshInterval: {
        name: "刷新间隔（分钟）",
        desc: "自动刷新的间隔分钟数（需开启自动刷新）",
      },
      syncBack: {
        name: "完成后回写源任务",
        desc:
          "勾选带来源链接的卡片时，同步把来源笔记里的任务标记完成并记录 ✅ 完成日期。依赖「卡片显示来源链接」",
      },
      showSourceLink: {
        name: "卡片显示来源链接",
        desc:
          "卡片末尾显示 [[来源]] 链接；关闭后将无法完成回写与拖出撤销",
      },
      showPriority: {
        name: "卡片显示优先级标识",
        desc: "保留 Tasks 优先级 emoji（⏫🔺🔼🔽⏬）；关闭则隐藏",
      },
      showDue: {
        name: "卡片显示截止日期",
        desc: "保留截止日期 📅 YYYY-MM-DD；关闭则隐藏",
      },
      showScheduled: {
        name: "卡片显示计划日期",
        desc: "保留计划日期 ⏳ YYYY-MM-DD；关闭则隐藏",
      },
      showStart: {
        name: "卡片显示开始日期",
        desc: "保留开始日期 🛫 YYYY-MM-DD；关闭则隐藏",
      },
      showCreated: {
        name: "卡片显示添加日期",
        desc: "保留添加日期 ➕ YYYY-MM-DD；关闭则隐藏",
      },
      showDataview: {
        name: "卡片显示 dataview 字段",
        desc: "保留 dataview 行内字段（如 [用时:: 5]）；关闭则隐藏",
      },
      showRecurring: {
        name: "卡片显示循环规则",
        desc:
          "保留循环规则（如 🔁 every day）；关闭则隐藏。when done 修饰语自动去除",
      },
      recurring: {
        name: "循环任务自动续期",
        desc: "完成循环任务时自动生成下一条实例并推进到期日",
      },
      archiveEnabled: {
        name: "已完成自动归档（非当天）",
        desc:
          "把完成列中非当天完成的卡片移入归档区（需配置 done-column）。带来源的卡 ✅ 记在来源笔记，无来源的卡 ✅ 记在卡片行；读不到日期的带来源卡保留不归档",
      },
      debugMode: {
        name: "调试模式",
        desc:
          "将刷新与看板同步过程写入 diag.txt，用于排查问题；排查完请关闭（关闭时不做任何磁盘写入）",
      },
      excludePaths: {
        name: "排除路径",
        desc:
          "每行一个，排除指定文件夹或笔记中的未完成任务。文件夹以 / 结尾（如 40资料/01原始资料/），笔记写完整路径（如 40资料/某笔记.md）",
      },
    },
  },
  en: {
    languageName: "Interface language",
    languageDesc: "Display language of this settings page (中文 / English)",
    guideHead: [
      "## How to use",
      "",
      "### 1. Configure a smart board",
      "Add a frontmatter block at the very top of your Kanban board note (surrounded by the two `---` delimiters):",
      "",
      "```yaml",
      "---",
      "kanban-plugin: board",
      "smart-columns:",
      "  - column: Due",
      "    source: due-today",
      "  - column: Overdue",
      "    source: due-overdue",
      "done-column: Done",
      "---",
      "```",
      "",
      "- `smart-columns` lists each smart column: `column` is the name, `source` is the filter rule (see table or `tag:<tag>`).",
      "- `done-column` is optional: only when set does \"drag into done = complete / drag out = undo\" apply.",
      "- The column name must exactly match the `## heading` in the board body.",
      "",
      "After saving, reopen the note. Each smart column heading gets a `(智能列)` suffix and is filled by its rule.",
      "",
      "### 2. source values",
      "",
    ].join("\n"),
    sourceHeader: ["source", "Filter content"],
    sourceGroups: [
      {
        title: "Due-date based (depends on 📅 due date)",
        rows: [
          ["due-today", "Due today"],
          ["due-overdue", "Overdue (due date earlier than today)"],
          ["due-tomorrow", "Due tomorrow"],
          ["overdue-or-today", "Overdue + due today (things to do right now)"],
          ["due-this-week", "Due this week (Mon–Sun)"],
          ["due-next-week", "Due next week (Mon–Sun)"],
          ["due-next-7-days", "Due within 7 days from today"],
          ["due-next-30-days", "Due within 30 days from today"],
          ["no-due", "Tasks without a due date"],
          ["all-open", "All open tasks that have a due date"],
          ["all-undone", "All incomplete tasks (including those without a due date)"],
        ],
      },
      {
        title: "Scheduled / Started / Created",
        rows: [
          ["scheduled-today", "Scheduled to start today (⏳)"],
          ["scheduled-overdue", "Scheduled start date passed but still incomplete (⏳)"],
          ["start-today", "Started today (🛫)"],
          ["created-today", "Created today (➕)"],
          ["created-7-days", "Created in the last 7 days (incl. today) (➕)"],
        ],
      },
      {
        title: "Priority based",
        rows: [
          ["priority-top", "Highest priority ⏫"],
          ["priority-high", "High priority ⏫ / 🔺"],
        ],
      },
      {
        title: "Dynamic values (freely combinable)",
        rows: [["tag:<tag name>", "Incomplete tasks carrying this tag, e.g. tag:parenting, tag:#reading"]],
      },
    ],
    guideTail: [
      "Tasks are pulled from every incomplete `- [ ]` task across the vault following Tasks syntax (cards in the board file itself are excluded).",
      "",
      "### 3. Card operations",
      "- Smart columns are entirely rewritten by this plugin — do not manually add or edit cards inside them.",
      "- Checking a card with a `[[source]]` link marks the matching task in the source note done and records the ✅ date.",
      "- Dragging a card into `done-column` completes it and writes back to the source; a source-less card is only marked done within the board.",
      "- Dragging a card from the done column back to another column reverts it to incomplete and undoes the source note's completion (or clears the card-line ✅).",
      "- Completing a recurring task with `🔁` generates the next instance and advances its due date.",
      "- On every refresh, cards in the done column completed on a day other than today are moved into kanban's native archive area.",
      "",
      "### 4. Manual refresh",
      "Open the command palette (Ctrl / Cmd + P) and run:",
      "- Refresh current smart board: refreshes only the currently open board.",
      "- Refresh all smart boards: refreshes every board in the vault.",
    ].join("\n"),
    categories: {
      card: "Card display",
      scope: "Scan scope",
      sync: "Completion & sync",
      refresh: "Refresh",
      debug: "Troubleshooting",
    },
    settings: {
      autoRefresh: {
        name: "Auto refresh",
        desc: "Automatically refresh every smart board in the vault at the interval below",
      },
      refreshInterval: {
        name: "Refresh interval (minutes)",
        desc: "Minutes between automatic refreshes (requires Auto refresh on)",
      },
      syncBack: {
        name: "Write back source task on completion",
        desc:
          "When you check a card with a [[source]] link, mark the matching task in the source note done and record the ✅ date. Depends on 'Show source link on cards'",
      },
      showSourceLink: {
        name: "Show source link on cards",
        desc:
          "Append a [[source]] link to each card; with it off, completion write-back and drag-out undo stop working",
      },
      showPriority: {
        name: "Show priority markers on cards",
        desc: "Keep the Tasks priority emoji (⏫🔺🔼🔽⏬); when off they are hidden",
      },
      showDue: {
        name: "Show due date on cards",
        desc: "Keep the due date 📅 YYYY-MM-DD; when off it is hidden",
      },
      showScheduled: {
        name: "Show scheduled date on cards",
        desc: "Keep the scheduled date ⏳ YYYY-MM-DD; when off it is hidden",
      },
      showStart: {
        name: "Show start date on cards",
        desc: "Keep the start date 🛫 YYYY-MM-DD; when off it is hidden",
      },
      showCreated: {
        name: "Show created date on cards",
        desc: "Keep the created date ➕ YYYY-MM-DD; when off it is hidden",
      },
      showDataview: {
        name: "Show dataview fields on cards",
        desc: "Keep dataview inline fields (e.g. [用时:: 5]); when off they are hidden",
      },
      showRecurring: {
        name: "Show recurring rules on cards",
        desc:
          "Keep the recurrence rule (e.g. 🔁 every day); when off it is hidden. 'when done' is stripped automatically",
      },
      recurring: {
        name: "Recurring task auto-renewal",
        desc: "When completing a recurring task, generate the next instance and advance its due date",
      },
      archiveEnabled: {
        name: "Auto-archive completed (non-today)",
        desc:
          "Move cards in the done column completed on a day other than today into the archive area (requires done-column). A linked card records ✅ in the source note, a source-less card on the card line; a linked card whose date cannot be read is kept",
      },
      debugMode: {
        name: "Debug mode",
        desc:
          "Write the plugin's refresh and board-sync steps to diag.txt for troubleshooting; turn off when done (while off, nothing is written)",
      },
      excludePaths: {
        name: "Excluded paths",
        desc:
          "One per line. Exclude unfinished tasks from these folders or notes. Folder ends with / (e.g. 40资料/01原始资料/); note uses full path (e.g. 40资料/某笔记.md)",
      },
    },
  },
};

/**
 * 等待指定源笔记的元数据缓存刷新完成（Obsidian 在文件被修改后会异步重解析）。
 * 用于「撤销完成」后确保 scanTasks 能看到源笔记已被翻回未完成，
 * 从而让智能列立即重新生成该任务卡片。带超时兜底，避免极端情况下挂起。
 */
function awaitCacheForFiles(app: App, files: TFile[], timeoutMs = 800): Promise<void> {
  if (files.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const pending = new Set(files.map((f) => f.path));
    const handler = (f: TFile) => {
      if (pending.has(f.path)) {
        pending.delete(f.path);
        if (pending.size === 0) {
          app.metadataCache.off("changed", handler);
          resolve();
        }
      }
    };
    app.metadataCache.on("changed", handler);
    window.setTimeout(() => {
      app.metadataCache.off("changed", handler);
      resolve();
    }, timeoutMs);
  });
}

export default class KanbanSmartColumns extends Plugin {
  settings: SmartColumnsSettings = { ...DEFAULT_SETTINGS };
  private timer: number | null = null;
  private processing = false;
  // 记录每个看板文件上一次处理完成后的内容，用于检测「卡片从完成列被拖出」以触发撤销
  private fileSnapshots: Map<string, string> = new Map();
  // 设置写盘队列：把多次 saveSettings 串行化，避免并发写盘乱序覆盖（见 saveSettings）
  private writeQueue: Promise<void> = Promise.resolve();
  // 每个看板文件「我们上次推送给视图的内容」，用于视图同步的判重（见 syncKanbanView）
  private lastPushed: Map<string, string> = new Map();
  // 刷新串行队列：refreshFile 会被多个事件源并发触发（file-open 去抖、modify 去抖、
  // 定时 refreshAll、设置变更去抖、手动命令）。旧实现无互斥，且 processing=true 只覆盖
  // 写盘阶段——syncKanbanView 里的 await newBoard(...)（kanban prerender 异步渲染全部
  // 卡片，数百毫秒）期间 processing 已复位为 false，写盘触发的 modify（去抖 1s 后到）
  // 会穿透保护、并发跑第二轮刷新：它先清掉 previewCache，再为同一批卡片各创建一个
  // preview widget，两轮的 widget 都挂到卡片 DOM 上 → 「同一张卡片文本重复两遍」的
  // 偶发 bug（markdown 视图正常，切走再切回视图重建 DOM 后恢复正常）。
  // 故把整个刷新流程（含视图推送）串行化：同一时刻只有一轮在跑，后续请求排队；
  // 同时 processing 覆盖到推送完成，堵住 modify 事件穿透窗口。
  private refreshQueue: Promise<void> = Promise.resolve();

  /**
   * 由设置项构造「卡片保留开关」对象，贯穿建卡 / 回写 / 撤销 / 归档整条链路。
   * 必须保证显示与匹配逻辑用同一份 opts，否则开开关会破坏完成回写或拖出撤销的文本匹配。
   */
  private cardOpts(): CardTextOpts {
    return {
      keepPriority: this.settings.showPriority,
      keepDue: this.settings.showDue,
      keepScheduled: this.settings.showScheduled,
      keepStart: this.settings.showStart,
      keepCreated: this.settings.showCreated,
      keepDataview: this.settings.showDataview,
      keepRecurring: this.settings.showRecurring,
    };
  }

  async onload() {
    await this.loadSettings();
    // 初始化诊断日志（写到插件目录，不经过 vault 内容，不会触发看板刷新）
    try {
      DIAG_ADAPTER = this.app.vault.adapter;
      setDiagEnabled(this.settings.debugMode);
      diag(
        `=== onload v${this.manifest.version} settings=${JSON.stringify(
          this.settings
        )}`
      );
    } catch {
      DIAG_ADAPTER = null;
    }
    this.addSettingTab(new SettingsTab(this));

    this.addCommand({
      id: "refresh-active",
      name: "刷新当前智能看板",
      callback: () => this.refreshActive(),
    });
    this.addCommand({
      id: "refresh-all",
      name: "刷新所有智能看板",
      callback: () => this.refreshAll(),
    });

    // 打开文件时，若是智能看板则立即刷新一次
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file instanceof TFile && isKanbanFile(this.app, file)) {
          this.debouncedRefresh(file);
        }
      })
    );

    // 看板文件被修改（含用户在看板里勾选卡片）时：先回写完成，再刷新。
    // ⚠ 不再因 processing 直接丢弃：刷新全程（含视图推送的异步窗口）都持有 processing，
    // 若在此丢弃，用户恰好在刷新期间勾选/拖动卡片的操作会丢失。onModify 各步均为幂等
    // 设计（快照比对无 diff 则不动、完成列 [x] 不会重复处理、智能列卡片恒为 [ ]），
    // 插件自写盘触发的 modify 最多多跑一轮空刷新后自然收敛，不会形成回环。
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && isKanbanFile(this.app, file)) {
          this.debouncedModify(file);
        }
      })
    );

    this.setupTimer();
  }

  onunload() {
    if (this.timer !== null) window.clearInterval(this.timer);
  }

  private setupTimer() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.settings.autoRefresh && this.settings.refreshIntervalMinutes > 0) {
      this.timer = window.setInterval(
        () => this.refreshAll(),
        this.settings.refreshIntervalMinutes * 60 * 1000
      );
    }
  }

  private debouncedRefresh = debounce(
    (file: TFile) => this.refreshFile(file),
    800,
    true
  );
  private debouncedModify = debounce(
    (file: TFile) => this.onModify(file),
    1000,
    true
  );
  // 设置项变更后重刷全库看板（去抖，避免连续拨动多个开关时反复全量扫描）。
  // 少了这一步，用户改完显示开关看到的仍是「按旧设置渲染」的旧卡片，
  // 表现为「最后关掉的那一项怎么关都不生效」。
  private debouncedRefreshAll = debounce(
    () => this.refreshAllAfterSettings(),
    600,
    true
  );

  private async onModify(file: TFile) {
    this.processing = true;
    const prevContent = this.fileSnapshots.get(file.path) ?? null;
    let undoResult: { changed: boolean; revertedSources: TFile[] } = {
      changed: false,
      revertedSources: [],
    };
    try {
      const opts = this.cardOpts();
      // 1) 撤销：把「从完成列拖出」到其它列的卡片还原为未完成（需在其它逻辑前，避免被当作手动勾选回写）
      undoResult = await revertMovedFromDone(
        this.app,
        file,
        prevContent,
        opts
      );
      // 2) 全局勾选回写（扫描非完成列的 [x] 卡片）——受「完成后回写」开关控制
      if (this.settings.syncBack) {
        await syncBackCompletions(
          this.app,
          file,
          this.settings.recurring,
          opts
        );
      }
      // 3) 完成列投递即完成：把完成列里未勾选的卡片自动标 [x]，并回写来源
      // （注意：此路径不受 syncBack 开关约束——拖入完成列始终会回写来源笔记）
      await autoCompleteInDoneColumn(
        this.app,
        file,
        this.settings.recurring,
        opts
      );
    } catch (e) {
      console.error("Smart tasks-kanban: modify handling failed", e);
    } finally {
      this.processing = false;
    }
    await this.refreshFile(file);
    // 撤销完成状态后，源笔记的完成标记虽已回写，但 Obsidian 元数据缓存可能尚未刷新，
    // 导致 scanTasks 仍认为该任务「已完成」、无法立即在智能列重现。
    // 等待源笔记缓存更新后再刷新一次看板，使撤销后的任务立即回到（逾期 / 到期等）智能列，免去手动刷新。
    if (undoResult.revertedSources.length > 0) {
      await this.refreshAfterUndo(file, undoResult.revertedSources);
    }
  }

  /**
   * 等待被撤销的源笔记元数据缓存刷新完成（Obsidian 修改文件后会异步重解析），
   * 随后再刷新一次看板，使撤销的任务立即重现于对应智能列。带超时兜底，避免极端情况下挂起。
   */
  private async refreshAfterUndo(file: TFile, sources: TFile[]): Promise<void> {
    await awaitCacheForFiles(this.app, sources);
    // 刷新已入串行队列（refreshQueue），无需再看 processing：它为 true 只表示
    // 队列当前在跑别的任务，本请求排队等轮即可；条件跳过反而会漏掉这次刷新，
    // 导致「撤销后任务没有立即重现于智能列」。
    await this.refreshFile(file);
  }

  /**
   * 刷新入口：把实际刷新任务排入串行队列（见 refreshQueue 注释），避免多事件源
   * 并发交错导致卡片重复渲染。返回队列尾部 Promise，调用方 await 即等本轮（及
   * 之前排队的）刷新全部完成。
   */
  private refreshFile(file: TFile): Promise<void> {
    const run = () => this.doRefreshFile(file);
    this.refreshQueue = this.refreshQueue.then(run, run);
    return this.refreshQueue;
  }

  private async doRefreshFile(file: TFile) {
    const defs = getSmartColumns(this.app, file);
    if (defs.length === 0) return;
    diag(
      `refreshFile START ${file.path} processing=${this.processing} opts=${JSON.stringify(
        this.cardOpts()
      )}`
    );
    // processing 覆盖全程（写盘 + 视图推送）：syncKanbanView 的 await newBoard
    // 期间也应挡住 modify 事件，防止第二轮刷新在 prerender 异步窗口内交错
    // （这是「卡片文本重复两遍」偶发 bug 的根因，见 refreshQueue 注释）。
    this.processing = true;
    try {
      const opts = this.cardOpts();
      await applySmartColumns(
        this.app,
        file,
        defs,
        this.settings.showSourceLink,
        opts,
        this.settings.excludePaths
      );
      // 归档：把完成列中非当天完成的卡片移到归档列（受开关控制）
      if (this.settings.archiveEnabled) {
        await archiveOldDone(this.app, file, opts);
      }
      // 记录本次处理后的最终内容，作为下次「拖出撤销」比对的基准
      const finalContent = await this.app.vault.read(file);
      this.fileSnapshots.set(file.path, finalContent);
      // 每次都尝试把磁盘内容推给看板视图（内部会比对 view.data，内容一致时直接跳过）。
      // 注意不能只在本插件「改写了文件」时才同步：磁盘可能早已是正确内容（例如上一次
      // 刷新已写好、或内容本就无需变化），此时 applySmartColumns 不产生改动，
      // 但视图仍可能是陈旧的（kanban 不会自动重读自身文件）——手动刷新就常落在这个分支，
      // 导致「命令刷新了却毫无变化」。故此处无条件调用，交给 syncKanbanView 自行判重。
      await this.syncKanbanView(file, finalContent);
    } catch (e) {
      diag(`refreshFile ERROR ${file.path} ${String(e)}`);
      console.error("Smart tasks-kanban: refresh failed", e);
    } finally {
      this.processing = false;
    }
    diag(`refreshFile END ${file.path}`);
    this.logRenderedCards(file, "afterRefresh");
  }

  /**
   * 延迟读取看板 DOM 上**真正渲染出来的**卡片文本，写进诊断日志。
   * `view.data` 只是 markdown 文本（且会被 Obsidian 自动同步），完全反映不出
   * kanban 解析后的渲染状态——只有 DOM 才能证明「用户眼睛看到的是什么」。
   */
  private logRenderedCards(file: TFile, tag: string) {
    window.setTimeout(() => {
      try {
        const leaves = this.app.workspace.getLeavesOfType(KANBAN_VIEW_TYPE);
        for (const leaf of leaves) {
          const view = leaf.view as unknown as {
            file?: TFile | null;
            contentEl?: HTMLElement;
          };
          if (view?.file?.path !== file.path) continue;
          const items = view.contentEl?.querySelectorAll(
            ".kanban-plugin__item"
          );
          const texts: string[] = [];
          items?.forEach((el) => {
            const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
            if (t) texts.push(t);
          });
          const withEmoji = texts.filter((t) =>
            /[\u{1F300}-\u{1FAFF}\u{2B00}-\u{2BFF}]/u.test(t)
          ).length;
          diag(
            `RENDERED[${tag}] cards=${texts.length} withEmoji=${withEmoji} sample="${(
              texts[0] ?? ""
            ).slice(0, 60)}"`
          );
          // 按列分组统计带 emoji 的卡片——用于判断残留是否只集中在「折叠列的计数气泡」
          // （折叠列的 DOM 会保留隐藏的卡片，只显示计数），而智能列其实是干净的。
          view.contentEl
            ?.querySelectorAll(".kanban-plugin__lane-wrapper")
            .forEach((lane) => {
              const titleEl = lane.querySelector(".kanban-plugin__lane-title");
              const title = (titleEl?.textContent ?? "?")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 24);
              const laneItems = lane.querySelectorAll(".kanban-plugin__item");
              let laneEmoji = 0;
              const laneTexts: string[] = [];
              laneItems.forEach((el) => {
                const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
                laneTexts.push(t);
                if (/[\u{1F300}-\u{1FAFF}\u{2B00}-\u{2BFF}]/u.test(t)) laneEmoji++;
              });
              diag(
                `  lane "${title}" items=${laneItems.length} emoji=${laneEmoji} first="${(
                  laneTexts[0] ?? ""
                ).slice(0, 45)}"`
              );
            });
        }
      } catch (e) {
        diag(`logRenderedCards THREW ${String(e)}`);
      }
    }, 500);
  }

  /**
   * 把新内容推送给打开着的 Kanban 视图（非破坏性）。
   *
   * 背景：obsidian-kanban 在 `vault.on("modify")` 里用 `i.file !== n` 过滤，
   * 即**故意忽略「自己那个文件」的外部修改**（它假定自己是该文件内容的唯一所有者）。
   * 所以本插件改写看板 markdown 后，打开着的看板视图不会重新读取，
   * 表现为「改了显示开关 / 手动刷新都看不到变化，必须关掉标签页重开才生效」。
   *
   * 做法：调用 TextFileView 的 `setViewData(content, false)`——Kanban 已实现它，
   * 内部走 `addView` → `registerView` → `newBoard`（getParsedBoard → prerender →
   * setState(state, false)）重新解析并渲染新内容，且**不会反向回存**，
   * 因此不会与本插件形成写盘循环。同时同步 `view.data`，否则 kanban 之后用陈旧的
   * data 判断「内容有变」并回写，会把我刚刷新的智能列覆盖回去。
   *
   * ⚠ 曾试过用 `leaf.setViewState()` 强制重建视图（等价于手动重开标签页），
   * **实测会让看板渲染成空白**（视图重建过程中被打断），已废弃。
   * 宁可退化为「需重开标签页」，也不能把用户的看板搞坏。
   *
   * 全部特性探测 + try/catch：kanban 升级改了内部结构时最多退化为原「需重开标签页」行为，
   * 不会报错影响看板。
   */
  private async syncKanbanView(file: TFile, content: string) {
    // 内容必须仍是看板；否则 kanban 会把视图切成 markdown 模式（破坏性副作用）
    if (!/kanban-plugin:\s*board/.test(content)) {
      diag(`sync SKIP (content not a board) ${file.path}`);
      return;
    }
    // ⚠ 判重必须用「我们上次推送过的内容」，**不能**用 `view.data === content`：
    // 本插件写盘后 Obsidian 会自动把新内容同步进 TextFileView.data，两者必然相等，
    // 会永远误判「已同步」而从不真正刷新渲染。
    if (this.lastPushed.get(file.path) === content) {
      diag("  already pushed identical content (skip)");
      return;
    }
    // ⚠ 二级判重：看板视图自己保存过（拖拽 / 看板内勾选等 kanban 自身操作）时，
    // 磁盘内容与视图当前 state 的序列化结果（parser.boardToMd(state)）完全一致——
    // 视图渲染必然已是最新，直接跳过推送。
    // 背景（拖拽卡片内容重复 bug 的根因，v0.6.10）：kanban 卡片组件 effect 重跑时
    // 走 previewCache 命中分支 → migrate() 把新 preview「追加」进 wrapper 而不清空旧
    // DOM；我们全量清缓存重建 preview 后，旧 preview 成孤儿仍挂在 wrapper 里，拖拽
    // 改变了落点周围卡片的父实体（effect 依赖变化）→ effect 重跑 → 新旧两个 preview
    // 叠在同一张卡片上 → 文本重复两遍。跳过无谓推送可从源头消除绝大多数重复场景；
    // 剩余场景（推送后仍可能产生的孤儿叠加）由 dedupePreviewDOM 兜底清理。
    try {
      const smEarly = this.kanbanStateManager(file);
      const parser = smEarly?.parser as
        | { boardToMd?: (st: unknown) => string }
        | undefined;
      if (
        parser &&
        typeof parser.boardToMd === "function" &&
        smEarly?.state
      ) {
        const viewMd = parser.boardToMd(smEarly.state);
        if (viewMd === content) {
          this.lastPushed.set(file.path, content);
          diag("  skip: view state serializes to identical content (kanban saved it itself)");
          return;
        }
        diag(`  view state differs from disk (viewMdLen=${viewMd.length} diskLen=${content.length}) -> push`);
      }
    } catch (e) {
      diag(`  boardToMd check THREW ${String(e)}`);
    }
    let leaves: WorkspaceLeaf[] = [];
    try {
      leaves = this.app.workspace.getLeavesOfType(KANBAN_VIEW_TYPE);
    } catch (e) {
      diag(`sync getLeavesOfType THREW ${String(e)}`);
      return;
    }
    diag(`sync leaves=${leaves.length} target=${file.path}`);
    for (const leaf of leaves) {
      const view = leaf.view as unknown as {
        file?: TFile | null;
        data?: string;
        isPrimary?: boolean;
        prerender?: (state: unknown) => Promise<void> | void;
        setViewData?: (data: string, clear: boolean) => void;
      };
      if (!view || !view.file || view.file.path !== file.path) {
        diag(`  skip leaf: viewFile=${view?.file?.path ?? "null"} (no match)`);
        continue;
      }
      diag(`  push: isPrimary=${view.isPrimary} diskLen=${content.length}`);

      // 清缓存前快照旧 preview 组件：推送后用于卸载孤儿组件 + DOM 去重扫尾
      const oldPreviews = this.snapshotPreviewCache(view);

      // ⚠⚠ 关键：必须清掉 kanban 的卡片渲染缓存，否则「隐藏」类改动不会生效。
      // kanban 的 view.prerender() 按**卡片 ID** 查 previewCache 决定是否重渲染：
      //   `this.previewCache.has(i.id) || this.previewQueue.add(...)` —— 命中就复用旧 DOM。
      // 卡片 ID 不随内容变化，故「显示 emoji」是新卡片渲染（看起来生效），
      // 而「隐藏 emoji」命中缓存被跳过 → 界面不变。这正是「显示立刻生效、隐藏没反应」的真因。
      // kanban 自己的 setViewData(content, **true**) 就是靠这个 clear 分支清缓存；
      // 我们此前一直传 false，等于从不清理。
      this.clearKanbanCardCache(view);

      // 首选：直接调用 kanban stateManager.newBoard(view, content)——
      // 它会用我们的内容重新解析并 setState，绕过 registerView 的 isPrimary 降级分支。
      const sm = this.kanbanStateManager(file);
      if (sm && typeof sm.newBoard === "function") {
        try {
          await sm.newBoard(view, content);
          view.data = content;
          this.lastPushed.set(file.path, content);
          diag(`  newBoard OK (viewSetSize=${sm.viewSet?.size ?? "?"})`);
          this.logKanbanState(sm, "afterNewBoard");
          // ⚠ 再调 forceRefresh()：setState 内部会 `viewSet.forEach(s => s.validatePreviewCache(a))`
          // 按**卡片 ID** 修剪缓存，而卡片 ID 不随内容变化 → 旧 widget 被原样保留、DOM 不更新。
          // forceRefresh() 会 `reparseBoard()` + `stateReceivers.forEach(...)` 强制全量重画。
          if (typeof sm.forceRefresh === "function") {
            try {
              sm.forceRefresh();
              diag("  forceRefresh OK");
            } catch (e) {
              diag(`  forceRefresh THREW ${String(e)}`);
            }
          } else {
            diag("  forceRefresh unavailable");
          }
          this.logKanbanState(sm, "afterForceRefresh");
          // 兜底去重：清缓存全量重建后，旧 preview 组件的 DOM 可能仍挂在卡片
          // wrapper 里，与 migrate 进来的新 preview 叠加成「文本重复两遍」
          // （拖拽场景高发，见 syncKanbanView 开头注释）。立即清一次 +
          // 800ms 后再清一次（覆盖迟到的异步渲染完成）。
          this.dedupePreviewDOM(view, oldPreviews);
          window.setTimeout(() => this.dedupePreviewDOM(view, oldPreviews), 800);
          continue;
        } catch (e) {
          diag(`  newBoard THREW ${String(e)} -> fallback setViewData`);
        }
      } else {
        diag("  stateManager/newBoard unavailable -> fallback setViewData");
      }

      // 回退路径：注意第二个参数必须是 true（= 清空渲染缓存）
      try {
        view.setViewData?.(content, true);
        view.data = content;
        this.lastPushed.set(file.path, content);
        diag("  setViewData(clear=true) OK (fallback)");
      } catch (e) {
        diag(`  setViewData THREW ${String(e)}`);
        console.error("Smart tasks-kanban: sync kanban view failed", e);
      }
    }
  }

  /**
 * 打印 kanban stateManager 内部 state 里各列的卡片标题。
 * 用于区分两种情况：
 *  - state 里**还有 emoji** → 说明 setState/newBoard 没把新内容写进 state；
 *  - state 里**已干净**但 DOM 仍有 → 说明是渲染层（缓存/prerender）没重画。
 */
private logKanbanState(
    sm: { state?: unknown; [k: string]: unknown },
    tag: string
  ) {
    try {
      // kanban 的 parsed board 是树形：state.children = 列(lane)，
      // lane.children = 卡片(item)，item.data.title = 卡片文本
      // （与 view.prerender 的 r.children.forEach(n=>n.children.forEach(i=>…i.data.title)) 一致）
      const st = sm?.state as {
        children?: {
          data?: { title?: string };
          children?: {
            data?: { title?: string };
          }[];
        }[];
      };
      const lanes = st?.children;
      if (!Array.isArray(lanes)) {
        diag(`  STATE[${tag}] no children (keys=${Object.keys(sm?.state ?? {}).join(",")})`);
        return;
      }
      diag(`  STATE[${tag}] lanes=${lanes.length}`);
      lanes.slice(0, 4).forEach((lane, i) => {
        const items = lane.children ?? [];
        const first = items[0]?.data?.title ?? "";
        const withEmoji = items.filter((it) =>
          /[\u{1F300}-\u{1FAFF}\u{2B00}-\u{2BFF}]/u.test(it?.data?.title ?? "")
        ).length;
        diag(
          `    lane[${i}] "${lane.data?.title ?? "?"}" items=${items.length} emoji=${withEmoji} first="${String(first).slice(0, 45)}"`
        );
      });
    } catch (e) {
      diag(`  STATE[${tag}] THREW ${String(e)}`);
    }
  }

  /**
   * 快照 kanban 视图 previewCache 里现存的所有 preview 组件（清缓存前调用）。
   * 用途：推送后卸载孤儿组件、以及 DOM 去重扫尾时定位被移除容器的属主组件。
   */
  private snapshotPreviewCache(
    view: unknown
  ): { containerEl?: HTMLElement }[] {
    try {
      const cache = (
        view as {
          previewCache?: Map<string, { containerEl?: HTMLElement }>;
        }
      ).previewCache;
      if (!cache || typeof cache.forEach !== "function") return [];
      const out: { containerEl?: HTMLElement }[] = [];
      cache.forEach((comp) => {
        if (comp) out.push(comp);
      });
      return out;
    } catch {
      return [];
    }
  }

  /**
   * 清空 kanban 视图的卡片渲染缓存（previewCache / previewQueue）。
   * v0.6.10 增强：清缓存会把旧 preview 组件从缓存里摘掉、成为无人管理的孤儿——
   * 其中「已脱离 DOM」的组件再也不会被任何卡片引用，仅泄漏不显示，此处直接从视图
   * 卸载（removeChild 触发 unload）；「仍挂载在卡片 wrapper 里」的组件不动（贸然
   * detach 会让 effect 未重跑的卡片变成空白），其残留叠加交给 dedupePreviewDOM 清理。
   * 全特性探测 + try/catch：字段名若在 kanban 升级后变化，最多退化为旧行为。
   */
  private clearKanbanCardCache(view: unknown) {
    try {
      const v = view as {
        previewCache?: Map<string, { containerEl?: HTMLElement }>;
        previewQueue?: { clear?: () => void };
        removeChild?: (c: unknown) => void;
      };
      const before = v.previewCache?.size;
      v.previewQueue?.clear?.();
      const orphans: unknown[] = [];
      const cache = v.previewCache;
      if (cache && typeof cache.forEach === "function") {
        cache.forEach((comp) => {
          const ce = comp?.containerEl;
          if (ce && ce.isConnected) return; // 仍挂载，不碰
          orphans.push(comp);
        });
        cache.clear();
      } else {
        v.previewCache?.clear?.();
      }
      for (const comp of orphans) {
        try {
          v.removeChild?.(comp);
        } catch {
          /* ignore */
        }
      }
      diag(
        `  cleared card cache (was size=${before ?? "?"}, unloadedOrphans=${orphans.length})`
      );
    } catch (e) {
      diag(`  clearCardCache THREW ${String(e)}`);
    }
  }

  /**
   * 卡片文本去重扫尾（兜底）：扫描视图 DOM，若同一父容器下挂了多个
   * markdown preview 容器（「同一张卡片文本重复两遍」的直接症状），保留最后一个
   * （本插件推送后 migrate 进来的新 preview），其余 detach；被 detach 的容器若属于
   * 清缓存前快照里的旧组件，一并从视图卸载防泄漏。幂等，可反复调用。
   */
  private dedupePreviewDOM(
    view: unknown,
    oldComps: { containerEl?: HTMLElement }[]
  ) {
    try {
      const v = view as {
        contentEl?: HTMLElement;
        containerEl?: HTMLElement;
        removeChild?: (c: unknown) => void;
      };
      const root = v.contentEl ?? v.containerEl;
      if (!root) return;
      // 按直接父容器分组统计 preview 容器（.markdown-preview-view.markdown-rendered
      // 是 kanban Ll 组件 containerEl 的固定类名，嵌套 transclusion 渲染不会以它作直接子级重复出现）
      const groups = new Map<HTMLElement, HTMLElement[]>();
      root
        .querySelectorAll(".markdown-preview-view.markdown-rendered")
        .forEach((el) => {
          const p = el.parentElement;
          if (!p) return;
          const arr = groups.get(p);
          if (arr) arr.push(el as HTMLElement);
          else groups.set(p, [el as HTMLElement]);
        });
      let removed = 0;
      groups.forEach((els) => {
        if (els.length < 2) return;
        for (let i = 0; i < els.length - 1; i++) {
          const el = els[i];
          el.detach();
          removed++;
          const owner = oldComps.find((c) => c.containerEl === el);
          if (owner) {
            try {
              v.removeChild?.(owner);
            } catch {
              /* ignore */
            }
          }
        }
      });
      if (removed > 0) diag(`  dedupePreviewDOM removed=${removed}`);
    } catch (e) {
      diag(`  dedupePreviewDOM THREW ${String(e)}`);
    }
  }

  /** 取 obsidian-kanban 插件实例的 stateManager（内部 API，取不到就返回 null）。 */
  private kanbanStateManager(file: TFile): {
    newBoard?: (view: unknown, content: string) => Promise<void>;
    forceRefresh?: () => void;
    viewSet?: Set<unknown>;
    state?: unknown;
    [k: string]: unknown;
  } | null {
    try {
      const plugins = (
        this.app as unknown as {
          plugins?: { plugins?: Record<string, unknown> };
        }
      ).plugins;
      const kp = plugins?.plugins?.["obsidian-kanban"] as {
        getStateManager?: (f: TFile) => unknown;
      };
      const sm = kp?.getStateManager?.(file) as {
        newBoard?: (view: unknown, content: string) => Promise<void>;
        forceRefresh?: () => void;
        viewSet?: Set<unknown>;
        state?: unknown;
        [k: string]: unknown;
      } | null;
      return sm ?? null;
    } catch {
      return null;
    }
  }

  private async refreshActive() {
    const file = this.app.workspace.getActiveFile();
    if (file instanceof TFile) await this.refreshFile(file);
  }

  private async refreshAll() {
    // 不再因 processing 直接 return：刷新已串行排队，重入只会把任务追加到队列尾部
    // （幂等、lastPushed 判重后多为空跑），丢弃反而会漏刷。旧的重入闸门是
    // 「processing 为真时 refreshAll 与 refreshFile 并发会交错渲染」时代的防重入手段，
    // 队列化后已无此风险。
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (isKanbanFile(this.app, file)) {
        await this.refreshFile(file);
      }
    }
  }

  /**
   * 设置项变更后的重刷：与 refreshAll 的历史差异在于不因 processing 放弃——
   * 否则「恰好在某次刷新进行中改开关」会被静默丢弃，看板停留在旧渲染，
   * 表现为「最后关掉的那一项怎么关都不生效」。刷新已串行排队，本调用只会
   * 追加到队列尾部（最多等之前排队的任务跑完），无需再轮询等锁。
   */
  private async refreshAllAfterSettings() {
    await this.refreshAll();
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }
  async saveSettings() {
    // 串行化写盘：连续快速拨动多个开关时会并发触发多次 saveData()，
    // Obsidian 的写盘是异步的，多个写入可能乱序完成，导致「最后改的那一项」
    // 被更早的旧快照覆盖（表现为最后关掉的那一项怎么关都不生效、刷新后还原）。
    // 用一条 Promise 链把每次保存排队，保证严格按调用顺序落盘、最终状态必为最新。
    // 注意先做浅拷贝快照：saveData 内部才做序列化，若直接传 this.settings，
    // 排队期间的后续修改会被更早的那次写入「顺带」带上，破坏顺序语义。
    const snapshot = { ...this.settings };
    diag(`saveSettings ${JSON.stringify(snapshot)}`);    this.writeQueue = this.writeQueue.then(() =>
      this.saveData(snapshot)
        .then(() => diag("  saveData OK"))
        .catch((e) => {
          diag(`  saveData FAILED ${String(e)}`);
          console.error("Smart tasks-kanban: save settings failed", e);
        })
    );
    await this.writeQueue;
    diag("  writeQueue drained -> setupTimer + debouncedRefreshAll");
    this.setupTimer();    // 设置变更会影响卡片渲染（如各「显示」开关），立即重刷全库看板使其生效。
    this.debouncedRefreshAll();
  }
}

class SettingsTab extends PluginSettingTab {
  plugin: KanbanSmartColumns;
  constructor(plugin: KanbanSmartColumns) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const T = I18N[this.plugin.settings.language];

    // 语言切换：改完即重渲染整页，使下方所有文案即时切换到所选语言
    new Setting(containerEl)
      .setName(T.languageName)
      .setDesc(T.languageDesc)
      .addDropdown((d) =>
        d
          .addOption("zh", "中文")
          .addOption("en", "English")
          .setValue(this.plugin.settings.language)
          .onChange(async (v) => {
            this.plugin.settings.language = v as Lang;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    // 加 markdown-rendered class：Obsidian 的表格/引用/列表样式依赖该 class，
    // 否则表格虽渲染成 <table> 结构却没有边框与表头底色，看起来像普通文本。
    const guide = containerEl.createEl("div", {
      cls: "kanban-smart-columns-guide markdown-rendered",
    });
    void MarkdownRenderer.render(this.plugin.app, T.guideHead, guide, "", this.plugin);

    // source 取值表：手动构建 HTML 表格（不依赖 markdown 表格语法是否被解析）
    for (const group of T.sourceGroups) {
      guide.createEl("p", { text: group.title, cls: "guide-table-title" });
      const table = guide.createEl("table");
      const thead = table.createEl("thead");
      const htr = thead.createEl("tr");
      htr.createEl("th", { text: T.sourceHeader[0] });
      htr.createEl("th", { text: T.sourceHeader[1] });
      const tbody = table.createEl("tbody");
      for (const [k, v] of group.rows) {
        const tr = tbody.createEl("tr");
        tr.createEl("td").createEl("code", { text: k });
        tr.createEl("td", { text: v });
      }
    }

    void MarkdownRenderer.render(this.plugin.app, T.guideTail, guide, "", this.plugin);

    // 分类标题：把设置项分组，让设置页更有条理（用 Obsidian 原生 setHeading 而非手写 h4，满足社区审核规范）
    const cat = (title: string) =>
      new Setting(containerEl).setName(title).setHeading();

    // 布尔开关行：统一「读取当前值 → 改动 → 落盘」的写法
    const boolToggle = (
      name: string,
      desc: string,
      get: () => boolean,
      set: (v: boolean) => void
    ) => {
      new Setting(containerEl).setName(name).setDesc(desc).addToggle((t) =>
        t.setValue(get()).onChange(async (v) => {
          set(v);
          await this.plugin.saveSettings();
        })
      );
    };

    // ---- 卡片显示 ----
    cat(T.categories.card);
    boolToggle(
      T.settings.showSourceLink.name,
      T.settings.showSourceLink.desc,
      () => this.plugin.settings.showSourceLink,
      (v) => {
        this.plugin.settings.showSourceLink = v;
      }
    );
    boolToggle(
      T.settings.showPriority.name,
      T.settings.showPriority.desc,
      () => this.plugin.settings.showPriority,
      (v) => {
        this.plugin.settings.showPriority = v;
      }
    );
    boolToggle(
      T.settings.showDue.name,
      T.settings.showDue.desc,
      () => this.plugin.settings.showDue,
      (v) => {
        this.plugin.settings.showDue = v;
      }
    );
    boolToggle(
      T.settings.showScheduled.name,
      T.settings.showScheduled.desc,
      () => this.plugin.settings.showScheduled,
      (v) => {
        this.plugin.settings.showScheduled = v;
      }
    );
    boolToggle(
      T.settings.showStart.name,
      T.settings.showStart.desc,
      () => this.plugin.settings.showStart,
      (v) => {
        this.plugin.settings.showStart = v;
      }
    );
    boolToggle(
      T.settings.showCreated.name,
      T.settings.showCreated.desc,
      () => this.plugin.settings.showCreated,
      (v) => {
        this.plugin.settings.showCreated = v;
      }
    );
    boolToggle(
      T.settings.showDataview.name,
      T.settings.showDataview.desc,
      () => this.plugin.settings.showDataview,
      (v) => {
        this.plugin.settings.showDataview = v;
      }
    );
    boolToggle(
      T.settings.showRecurring.name,
      T.settings.showRecurring.desc,
      () => this.plugin.settings.showRecurring,
      (v) => {
        this.plugin.settings.showRecurring = v;
      }
    );

    // ---- 扫描范围 ----
    cat(T.categories.scope);
    new Setting(containerEl)
      .setName(T.settings.excludePaths.name)
      .setDesc(T.settings.excludePaths.desc)
      .addTextArea((t) => {
        t.inputEl.addClass("kanban-smart-columns-exclude");
        t.setValue(this.plugin.settings.excludePaths.join("\n"));
        t.onChange(async (v) => {
          this.plugin.settings.excludePaths = v
            .split("\n")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          await this.plugin.saveSettings();
        });
      });

    // ---- 完成与同步 ----
    cat(T.categories.sync);
    boolToggle(
      T.settings.syncBack.name,
      T.settings.syncBack.desc,
      () => this.plugin.settings.syncBack,
      (v) => {
        this.plugin.settings.syncBack = v;
      }
    );
    boolToggle(
      T.settings.recurring.name,
      T.settings.recurring.desc,
      () => this.plugin.settings.recurring,
      (v) => {
        this.plugin.settings.recurring = v;
      }
    );
    boolToggle(
      T.settings.archiveEnabled.name,
      T.settings.archiveEnabled.desc,
      () => this.plugin.settings.archiveEnabled,
      (v) => {
        this.plugin.settings.archiveEnabled = v;
      }
    );

    // ---- 刷新 ----
    cat(T.categories.refresh);
    boolToggle(
      T.settings.autoRefresh.name,
      T.settings.autoRefresh.desc,
      () => this.plugin.settings.autoRefresh,
      (v) => {
        this.plugin.settings.autoRefresh = v;
      }
    );
    new Setting(containerEl)
      .setName(T.settings.refreshInterval.name)
      .setDesc(T.settings.refreshInterval.desc)
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.refreshIntervalMinutes))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.refreshIntervalMinutes = n;
              await this.plugin.saveSettings();
            }
          })
      );

    // ---- 问题排查 ----
    cat(T.categories.debug);
    boolToggle(
      T.settings.debugMode.name,
      T.settings.debugMode.desc,
      () => this.plugin.settings.debugMode,
      async (v) => {
        this.plugin.settings.debugMode = v;
        // 切换时先清空旧日志，避免残留上一次的记录干扰排查
        await clearDiag();
        setDiagEnabled(v);
        await this.plugin.saveSettings();
        if (v) {
          diag(
            `=== debug mode ON, settings=${JSON.stringify(
              this.plugin.settings
            )}`
          );
          new Notice("调试模式已开启，诊断日志写入 diag.txt");
        } else {
          new Notice("调试模式已关闭，诊断日志已清空");
        }
        // 重渲染整页，使下方的「清空诊断日志」按钮随开关显隐
        this.display();
      }
    );

    // 仅在调试模式开启时显示「清空诊断日志」按钮
    if (this.plugin.settings.debugMode) {
      new Setting(containerEl)
        .setName("清空诊断日志")
        .setDesc("立即清空插件目录下的 diag.txt")
        .addButton((b) =>
          b.setButtonText("清空").onClick(async () => {
            await clearDiag();
            new Notice("诊断日志已清空");
          })
        );
    }
  }
}