import { App, TFile } from "obsidian";
import {
  ScannedTask,
  scanTasks,
  cardText,
  RECUR_STOP,
  CardTextOpts,
} from "./tasks";

/**
 * 智能列的数据来源。除内置取值（due-today / due-overdue / due-tomorrow / overdue-or-today /
 * due-this-week / due-next-week / due-next-7-days / due-next-30-days / no-due / all-open /
 * all-undone / scheduled-today / scheduled-overdue / start-today / created-today /
 * created-7-days / priority-top / priority-high）外，还支持动态形式
 * `tag:<标签名>`（如 `tag:育儿`）——筛选带该标签的未完成任务。
 * 故此处用 string 而非字面量联合类型。
 */
export type SmartSource = string;

export interface SmartColumnDef {
  column: string; // 看板中列（## 标题）的名称
  source: SmartSource; // 该列的数据来源
}

/** 从文件的 frontmatter 读取智能列定义；非看板文件或无定义则返回空数组。 */
export function getSmartColumns(app: App, file: TFile): SmartColumnDef[] {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm || fm["kanban-plugin"] !== "board") return [];
  const raw = fm["smart-columns"];
  if (!Array.isArray(raw)) return [];
  const out: SmartColumnDef[] = [];
  for (const d of raw) {
    if (d && typeof d.column === "string" && typeof d.source === "string") {
      out.push({ column: d.column, source: d.source as SmartSource });
    }
  }
  return out;
}

export function isKanbanFile(app: App, file: TFile): boolean {
  return getSmartColumns(app, file).length > 0;
}

/** 读取 frontmatter 中声明的「完成列」名称（拖入该列的卡片会被自动标记完成）。无则返回 undefined。 */
export function getDoneColumn(app: App, file: TFile): string | undefined {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm || fm["kanban-plugin"] !== "board") return undefined;
  const raw = fm["done-column"];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

// 智能列标题后缀：在看板里明确标注哪些列是插件自动生成的（用英文括号，列名更窄、避免换行）
export const SMART_SUFFIX = "(智能列)";
// 旧版用中文括号，刷新时一并兼容剥离，避免叠加成双重后缀
const LEGACY_SUFFIX = "（智能列）";

/** 去掉列标题末尾可能的「(智能列)」或旧版「（智能列）」后缀，用于把显示标题与 frontmatter 中的列名对齐匹配。 */
export function stripSmartSuffix(s: string): string {
  const t = s.trim();
  if (t.endsWith(SMART_SUFFIX)) return t.slice(0, -SMART_SUFFIX.length).trim();
  if (t.endsWith(LEGACY_SUFFIX)) return t.slice(0, -LEGACY_SUFFIX.length).trim();
  return s.trim();
}

// kanban 原生归档区（markdown 模式）：kanban 把通过「Archive card」菜单归档的卡片写入
// `## Archive` 区块（前接 `***` 分隔符），它并非一个普通列，在 UI 中以归档视图呈现、不显示为列。
// 自动归档应落到此处，与 kanban 原生归档行为保持一致；不要另起一个「归档列」。
export const ARCHIVE_HEADING = "Archive";

// 循环规则文本截取用的「停止集合」已上移到 tasks.ts 并导出为 RECUR_STOP（含全部优先级变体，
// 确保「保留优先级」开关开启时 🔁 规则文本不会把紧随其后的优先级 emoji 一并吞掉）。

// ---------- 日期工具（使用本地时区，避免 moment 依赖） ----------
function pad(n: number): string {
  return String(n).padStart(2, "0");
}
export function todayISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function shiftISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return todayISO(d);
}
function tomorrowISO(): string {
  return shiftISO(1);
}
function weekRange(): { start: string; end: string } {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // 周一=0
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: todayISO(monday), end: todayISO(sunday) };
}
/** 下周（周一~周日）的日期区间。 */
function nextWeekRange(): { start: string; end: string } {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // 周一=0
  const nextMon = new Date(d);
  nextMon.setDate(d.getDate() - day + 7);
  const nextSun = new Date(nextMon);
  nextSun.setDate(nextMon.getDate() + 6);
  return { start: todayISO(nextMon), end: todayISO(nextSun) };
}

function filterTasks(
  tasks: ScannedTask[],
  source: SmartSource,
  today: string
): ScannedTask[] {
  // 动态取值：tag:<标签名> —— 筛选带该标签的未完成任务（标签比较忽略大小写，可写 #标签 或 标签）
  if (source.startsWith("tag:")) {
    const tag = source
      .slice(4)
      .trim()
      .replace(/^#/, "");
    if (!tag) return [];
    const key = tag.toLowerCase();
    return tasks.filter(
      (t) => !t.done && t.tags.some((x) => x.toLowerCase() === key)
    );
  }

  const open = tasks.filter((t) => !t.done);
  switch (source) {
    // ---- 到期日 📅 ----
    case "due-today":
      return open.filter((t) => t.due === today);
    case "due-overdue":
      return open.filter((t) => t.due !== undefined && t.due < today);
    case "due-tomorrow":
      return open.filter((t) => t.due === tomorrowISO());
    case "overdue-or-today": // 逾期 + 今天到期（马上要做的事）
      return open.filter((t) => t.due !== undefined && t.due <= today);
    case "due-this-week": {
      const { start, end } = weekRange();
      return open.filter(
        (t) => t.due !== undefined && t.due >= start && t.due <= end
      );
    }
    case "due-next-week": {
      const { start, end } = nextWeekRange();
      return open.filter(
        (t) => t.due !== undefined && t.due >= start && t.due <= end
      );
    }
    case "due-next-7-days":
      return open.filter(
        (t) => t.due !== undefined && t.due >= today && t.due <= shiftISO(7)
      );
    case "due-next-30-days":
      return open.filter(
        (t) => t.due !== undefined && t.due >= today && t.due <= shiftISO(30)
      );
    case "no-due": // 无到期日的未完成任务
      return open.filter((t) => t.due === undefined);
    case "all-open": // 有到期日的全部未完成（保持既有语义）
      return open.filter((t) => t.due !== undefined);
    case "all-undone": // 全部未完成任务（含无到期日）
      return open;
    // ---- 计划开始日 ⏳ ----
    case "scheduled-today":
      return open.filter((t) => t.scheduled === today);
    case "scheduled-overdue": // 计划开始日已过仍未完成
      return open.filter((t) => t.scheduled !== undefined && t.scheduled < today);
    // ---- 开始日 🛫 ----
    case "start-today":
      return open.filter((t) => t.start === today);
    // ---- 创建日 ➕ ----
    case "created-today":
      return open.filter((t) => t.created === today);
    case "created-7-days": // 最近 7 天（含今天）新建
      return open.filter(
        (t) =>
          t.created !== undefined && t.created >= shiftISO(-6) && t.created <= today
      );
    // ---- 优先级 ----
    case "priority-top": // ⏫ 最高优先级
      return open.filter((t) => t.priority === "\u{23EB}");
    case "priority-high": // ⏫ 最高 + 🔺 高（含大三角 U+1F532 变体）
      return open.filter(
        (t) =>
          t.priority === "\u{23EB}" ||
          t.priority === "\u{1F53A}" ||
          t.priority === "\u{1F532}"
      );
    default:
      return [];
  }
}

/** 把一条任务渲染成看板卡片：仅「任务名 + 标签」，可选附带 [[来源]] 链接（用于跳转与完成回写）。
 *  opts 控制卡片上是否保留优先级 / dataview 字段 / 循环规则（见设置页开关）。 */
function cardFor(
  t: ScannedTask,
  showLink: boolean,
  opts: CardTextOpts
): string {
  const text = cardText(t.text, opts);
  const link = showLink ? ` [[${t.file.basename}]]` : "";
  return `- [ ] ${text}${link}`;
}

function cardsFor(
  tasks: ScannedTask[],
  showLink: boolean,
  opts: CardTextOpts
): string[] {
  return tasks.map((t) => cardFor(t, showLink, opts));
}

/**
 * 把某个智能列的正文整体替换为生成的卡片。
 * 直接替换「## 列标题」到下一个「##」之间的全部内容，
 * 因此自动列不应再混入手写卡片（手写请放到其它列）。
 */
function replaceColumnRegion(
  content: string,
  column: string,
  cards: string[],
  addSmartSuffix: boolean
): string {
  const lines = content.split("\n");
  const startIdx = lines.findIndex((l) => {
    const t = l.trim();
    return t.startsWith("## ") && stripSmartSuffix(t.slice(3).trim()) === column;
  });
  if (startIdx === -1) return content;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      endIdx = i;
      break;
    }
  }

  const cardLines = cards.length ? cards : ["- [ ] （暂无匹配任务）"];
  // 智能列：把列标题补上「（智能列）」后缀，便于肉眼区分自动列与手写列；
  // 匹配时用 stripSmartSuffix 兼容「已带后缀」与「未带后缀」两种形态。
  let headerLine = lines[startIdx];
  if (addSmartSuffix) {
    const desired = `## ${column}${SMART_SUFFIX}`;
    if (headerLine.trim() !== desired) headerLine = desired;
  }
  return [
    ...lines.slice(0, startIdx),
    headerLine,
    ...cardLines,
    ...lines.slice(endIdx),
  ].join("\n");
}

/** 重写一个看板文件的所有智能列。返回是否发生了改动。
 *  opts 控制卡片是否保留优先级 / dataview 字段 / 循环规则（与设置页开关一致）。 */
export async function applySmartColumns(
  app: App,
  file: TFile,
  defs: SmartColumnDef[],
  showLink: boolean,
  opts: CardTextOpts,
  excludePaths: string[] = []
): Promise<boolean> {
  const today = todayISO();
  const tasks = await scanTasks(app, excludePaths);
  const content = await app.vault.read(file);
  let newContent = content;
  for (const def of defs) {
    const matched = filterTasks(tasks, def.source, today);
    newContent = replaceColumnRegion(
      newContent,
      def.column,
      cardsFor(matched, showLink, opts),
      true
    );
  }
  if (newContent !== content) {
    await app.vault.process(file, () => newContent);
    return true;
  }
  return false;
}

// ---------- 完成回写：在看板勾选带 [[来源]] 的卡片 → 标记源任务完成 + 记录完成日期 ----------
const CARD_DONE_RE = /^- \[[xX]\]\s+(.*)$/;
const LINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/;

/**
 * 取卡片正文中「最后一个」[[链接]] —— 即本插件生成的来源链接（始终追加在末尾）。
 * 任务原文本中可能自带 wikilink，因此不能用第一个匹配，必须用最后一个，否则会定位错源文件。
 */
function lastLink(body: string): RegExpExecArray | null {
  const re = new RegExp(LINK_RE.source, "g");
  let m: RegExpExecArray | null = null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(body)) !== null) last = m;
  return last;
}

/**
 * 扫描看板文件中所有带 [[来源]] 链接的已勾选卡片（- [x]），
 * 把对应源笔记中的任务标记为完成，并补上完成日期 ✅ YYYY-MM-DD（Tasks 格式）。
 * 不限于智能列 —— 用户把卡片拖到「已完成」等手写列后再勾选，同样会回写。
 * 匹配依据：卡片里的 [[来源]] 链接 + 「任务名 + 标签」（cardText 规范化后比对）。
 * 不再依赖 📅 日期 —— 源笔记里同名的循环任务只会有「一条未完成」行，
 * 已完成行被跳过，因此按文本即可唯一定位。
 */
export async function syncBackCompletions(
  app: App,
  file: TFile,
  recurring: boolean,
  opts: CardTextOpts
): Promise<void> {
  const content = await app.vault.read(file);
  const lines = content.split("\n");
  // 完成列里的 [x] 卡片由 autoCompleteInDoneColumn 负责（并在那里完成循环续期），
  // 此处排除完成列，避免循环任务被重复处理 / 重复推进下一周期。
  const doneCol = getDoneColumn(app, file);
  const doneRange =
    doneCol !== undefined ? columnRange(lines, doneCol) : null;
  // 归档区（## Archive）内的卡片是已归档的，无需再回写完成标记
  const archiveRange = columnRange(lines, ARCHIVE_HEADING);

  for (let i = 0; i < lines.length; i++) {
    if (
      doneRange &&
      doneRange.startIdx !== -1 &&
      i >= doneRange.startIdx &&
      i < doneRange.endIdx
    )
      continue;
    if (
      archiveRange.startIdx !== -1 &&
      i >= archiveRange.startIdx &&
      i < archiveRange.endIdx
    )
      continue;
    const cm = CARD_DONE_RE.exec(lines[i]);
    if (!cm) continue;
    const body = cm[1];
    const lm = lastLink(body);
    if (!lm) continue; // 卡片无来源链接则无法回写
    const basename = lm[1].trim();
    const text = cardText(body, opts);
    const target = app.metadataCache.getFirstLinkpathDest(basename, file.path);
    if (!(target instanceof TFile)) continue;
    await markTaskDone(app, target, text, recurring, opts);
  }
}

async function markTaskDone(
  app: App,
  file: TFile,
  text: string,
  recurring: boolean,
  opts: CardTextOpts
): Promise<void> {
  await app.vault.process(file, (content) => {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const tm = /^(\s*[-*]\s+)\[([ xX])\]\s+(.*)$/.exec(raw);
      if (!tm) continue;
      if (tm[2] !== " ") continue; // 已完成则跳过
      if (cardText(tm[3], opts) !== text) continue;
      let updated = raw.replace("[ ]", "[x]");
      // 补上完成日期 ✅ YYYY-MM-DD（Tasks 格式）；行内已有则不再重复添加
      if (!/\u{2705}/u.test(updated)) {
        updated += ` \u{2705} ${todayISO()}`;
      }
      lines[i] = updated;
      // 循环连续性：源任务含 🔁 时，在其下方插入下一条循环实例
      // （重置为未完成、推进 📅 到期日、去掉 ✅）。用原始未完成行 raw 构造，保留全部元数据。
      if (recurring && /\u{1F501}/u.test(raw)) {
        const newLine = makeNextRecurring(raw);
        if (newLine) lines.splice(i + 1, 0, newLine);
      }
      break;
    }
    return lines.join("\n");
  });
}

/**
 * 把「完成列」（frontmatter 的 done-column）中带 [[来源]] 链接、但尚未勾选的卡片
 * （- [ ]）自动标记为完成（- [x]），并同步回写来源笔记（markTaskDone 会在源任务追加 ✅ 完成日期）。
 * 这样用户只需把卡片拖入完成列，无需再手动勾选复选框。
 * 不带 [[来源]] 链接的卡片（如用户手写待办）不会被自动处理。
 * 返回是否修改了看板文件。
 */
export async function autoCompleteInDoneColumn(
  app: App,
  file: TFile,
  recurring: boolean,
  opts: CardTextOpts
): Promise<boolean> {
  const doneCol = getDoneColumn(app, file);
  if (!doneCol) return false;

  const content = await app.vault.read(file);
  const lines = content.split("\n");
  const { startIdx, endIdx } = columnRange(lines, doneCol);
  if (startIdx === -1) return false;

  const pending: { basename: string | null; text: string }[] = [];
  let changed = false;
  for (let i = startIdx + 1; i < endIdx; i++) {
    const cm = /^- \[ \]\s+(.*)$/.exec(lines[i]);
    if (!cm) continue;
    const body = cm[1];
    const lm = lastLink(body);
    const basename = lm ? lm[1].trim() : null;
    const text = cardText(body, opts);
    // 自动勾选完成，并保留在完成列作为「完成记录」（不再依赖用户手动勾选复选框）
    let updated = lines[i].replace("[ ]", "[x]");
    // 无来源的手写卡片：在完成列标记完成后，于卡片行记录完成日期 ✅，
    // 以便「自动归档（非当天）」能据此判定（带来源卡完成日期记录在源笔记）。幂等：已有 ✅ 则不重复添加。
    if (!basename && !/\u{2705}/u.test(updated)) {
      updated += ` \u{2705} ${todayISO()}`;
    }
    lines[i] = updated;
    changed = true;
    pending.push({ basename, text });
  }

  if (!changed) return false;

  // 写回看板（把完成列里的卡片标记为完成）
  await app.vault.process(file, () => lines.join("\n"));

  // 回写来源笔记（源任务标记为完成 + 补 ✅ 完成日期；循环任务自动续期）
  for (const p of pending) {
    if (!p.basename) continue; // 手写卡片（无来源链接）仅看板内标记完成，不回写源笔记
    const target = app.metadataCache.getFirstLinkpathDest(p.basename, file.path);
    if (target instanceof TFile) {
      await markTaskDone(app, target, p.text, recurring, opts);
    }
  }
  return true;
}

// ---------- 撤销：把「从完成列拖出」的卡片还原为未完成 ----------

/** 提取某列内的卡片（不含列标题），返回 {hasLink, basename, text}。 */
function cardsInColumn(
  content: string,
  column: string,
  opts: CardTextOpts
): { hasLink: boolean; basename: string | null; text: string }[] {
  const lines = content.split("\n");
  const { startIdx, endIdx } = columnRange(lines, column);
  if (startIdx === -1) return [];
  const out: { hasLink: boolean; basename: string | null; text: string }[] = [];
  for (let i = startIdx + 1; i < endIdx; i++) {
    const cm = /^- \[[ xX]\]\s+(.*)$/.exec(lines[i]);
    if (!cm) continue;
    const body = cm[1];
    const lm = lastLink(body);
    out.push({ hasLink: !!lm, basename: lm ? lm[1].trim() : null, text: cardText(body, opts) });
  }
  return out;
}

/** 同一张卡片的匹配：两边都有来源链接时按 basename+text；都是无来源手写卡片时按 text。 */
function sameCard(
  a: { hasLink: boolean; basename: string | null; text: string },
  b: { hasLink: boolean; basename: string | null; text: string }
): boolean {
  if (a.hasLink !== b.hasLink) return false;
  if (a.hasLink) return a.basename === b.basename && a.text === b.text;
  return a.text === b.text;
}

/**
 * 撤销「从完成列拖出」的卡片：
 * 若某卡片在 prev 快照中位于完成列、在当前内容中被移到任意其它列（含智能列、归档列）且为 [x]，
 * 则把它翻回 [ ]，并（若带 [[来源]]）撤销源笔记的完成标记与循环续期行。
 * 这样「拖入完成列 = 完成 / 拖出 = 撤销」形成对称操作，误操作可一键还原。
 * 返回 { changed: 是否改动了看板；revertedSources: 被撤销完成标记的源笔记列表 }。
 * revertedSources 用于让调用方在元数据缓存刷新后再刷新一次看板，使撤销的任务立即重现于智能列。
 */
export async function revertMovedFromDone(
  app: App,
  file: TFile,
  prevContent: string | null,
  opts: CardTextOpts
): Promise<{ changed: boolean; revertedSources: TFile[] }> {
  if (!prevContent) return { changed: false, revertedSources: [] };
  const doneCol = getDoneColumn(app, file);
  if (!doneCol) return { changed: false, revertedSources: [] };
  const prevDone = cardsInColumn(prevContent, doneCol, opts);
  if (prevDone.length === 0) return { changed: false, revertedSources: [] };

  const cur = await app.vault.read(file);
  const lines = cur.split("\n");

  // 仅「完成列」与 kanban 原生「归档区」不参与撤销判定；其它任何列（含智能列）都允许「拖出即撤销」，
  // 即把卡片从完成列拖到任意其它列，都会翻回未完成并还原来源（形成「拖入=完成 / 拖出=撤销」对称）。
  // 归档区（## Archive）内的卡片是已归档的，不应再被当成「拖出完成列」而撤销。
  const skipRanges: { s: number; e: number }[] = [];
  const dr = columnRange(lines, doneCol);
  if (dr.startIdx !== -1) skipRanges.push({ s: dr.startIdx, e: dr.endIdx });
  const ar = columnRange(lines, ARCHIVE_HEADING);
  if (ar.startIdx !== -1) skipRanges.push({ s: ar.startIdx, e: ar.endIdx });
  const inSkip = (i: number) => skipRanges.some((r) => i >= r.s && i < r.e);

  let changed = false;
  const revertedSources: TFile[] = [];
  const pendingUndone: { basename: string | null; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (inSkip(i)) continue;
    const cm = /^- \[[xX]\]\s+(.*)$/.exec(lines[i]);
    if (!cm) continue;
    const body = cm[1];
    const lm = lastLink(body);
    const curCard = {
      hasLink: !!lm,
      basename: lm ? lm[1].trim() : null,
      text: cardText(body, opts),
    };
    if (prevDone.some((p) => sameCard(p, curCard))) {
      let updated = lines[i].replace(/\[[xX]\]/, "[ ]");
      // 无来源卡撤销时，清掉卡片行上记录的完成日期（若有），避免残留 ✅
      if (!lm) updated = updated.replace(/\s*\u{2705}\s*\d{4}-\d{2}-\d{2}/gu, "");
      lines[i] = updated;
      changed = true;
      pendingUndone.push({ basename: curCard.basename, text: curCard.text });
    }
  }
  if (!changed) return { changed: false, revertedSources: [] };

  await app.vault.process(file, () => lines.join("\n"));

  for (const p of pendingUndone) {
    if (!p.basename) continue; // 无来源的手写卡片仅在看板内翻回，无需动源笔记
    const target = app.metadataCache.getFirstLinkpathDest(p.basename, file.path);
    if (target instanceof TFile) {
      await markTaskUndone(app, target, p.text, opts);
      revertedSources.push(target);
    }
  }
  return { changed, revertedSources };
}

/** 把源笔记中「已完成」的对应任务翻回未完成，并删除 ✅ 完成日期与（若有）紧邻下方的循环续期行。 */
async function markTaskUndone(
  app: App,
  file: TFile,
  text: string,
  opts: CardTextOpts
): Promise<void> {
  await app.vault.process(file, (content) => {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const tm = /^(\s*[-*]\s+)\[([ xX])\]\s+(.*)$/.exec(lines[i]);
      if (!tm) continue;
      if (tm[2] === " ") continue; // 仅撤销已完成的
      if (cardText(tm[3], opts) !== text) continue;
      // 翻回未完成 + 去掉 ✅ 完成日期
      let updated = lines[i].replace(/\[[xX]\]/, "[ ]");
      updated = updated.replace(/\s*\u{2705}\s*\d{4}-\d{2}-\d{2}/gu, "");
      lines[i] = updated;
      // 撤销循环续期：删除紧邻下方、由本插件插入的下一实例行
      const dueM = /\u{1F4C5}\s*(\d{4}-\d{2}-\d{2})/u.exec(updated);
      const ruleM = new RegExp("\\u{1F501}\\s*([^" + RECUR_STOP + "]*)", "u").exec(updated);
      if (dueM && ruleM) {
        const nd = nextDate(dueM[1], ruleM[1].trim());
        if (nd) {
          const nxt = lines[i + 1];
          if (nxt) {
            const nm = /^(\s*[-*]\s+)\[ \]\s+(.*)$/.exec(nxt);
            if (nm) {
              const nDue = /\u{1F4C5}\s*(\d{4}-\d{2}-\d{2})/u.exec(nm[2]);
              // 下一实例的到期日是按规则「推进」过的，与原任务本就不同；
              // 到期日已由 nDue === nd 单独校验，故此处比对文本时必须排除到期日，
              // 否则开启「卡片显示截止日期」后，续期行永远匹配不上、撤销时会留下残余行。
              const cmpOpts: CardTextOpts = { ...opts, keepDue: false };
              if (
                nDue &&
                nDue[1] === nd &&
                cardText(nm[2], cmpOpts) === cardText(text, cmpOpts)
              ) {
                lines.splice(i + 1, 1);
              }
            }
          }
        }
      }
      break;
    }
    return lines.join("\n");
  });
}

// ---------- 归档：把完成列中「非当天完成」的任务移到归档列 ----------

/** 读取源笔记中某已完成任务的 ✅ 完成日期；找不到或该行非完成则返回 null。 */
async function getDoneDate(
  app: App,
  file: TFile,
  text: string,
  opts: CardTextOpts
): Promise<string | null> {
  const content = await app.vault.cachedRead(file);
  const lines = content.split("\n");
  for (const raw of lines) {
    const tm = /^(\s*[-*]\s+)\[([ xX])\]\s+(.*)$/.exec(raw);
    if (!tm) continue;
    if (tm[2] === " ") continue; // 仅看已完成
    if (cardText(tm[3], opts) !== text) continue;
    const m = /\u{2705}\s*(\d{4}-\d{2}-\d{2})/u.exec(raw);
    return m ? m[1] : null;
  }
  return null;
}

/**
 * 把「完成列」中「非当天完成」的卡片移动到 kanban 原生归档区（## Archive）。
 * 判定依据：
 *   - 带来源卡片：去源笔记读取其 ✅ 完成日期；仅当明确知道日期且 ≠ 今天才归档；
 *     日期未知（来源缺失 / 源笔记无 ✅）保留，避免误删。
 *   - 无来源卡片：完成日期记录在卡片行（autoCompleteInDoneColumn 写入 ✅）；
 *     完成日期 ≠ 今天（含从未记录日期的旧卡）即归档；仅当天完成的保留。
 * 归档区不存在时，按 kanban 原生格式（*** 分隔符 + ## Archive）创建于设置块之前。
 * 返回是否修改了看板文件。
 */
export async function archiveOldDone(
  app: App,
  file: TFile,
  opts: CardTextOpts
): Promise<boolean> {
  const doneCol = getDoneColumn(app, file);
  if (!doneCol) return false;
  const archiveCol = ARCHIVE_HEADING;
  const today = todayISO();

  const content = await app.vault.read(file);
  const lines = content.split("\n");
  const doneRange = columnRange(lines, doneCol);
  if (doneRange.startIdx === -1) return false;

  const archived: string[] = [];
  const kept: string[] = []; // 完成列里保留的行（不含标题行）
  let changed = false;

  for (let i = doneRange.startIdx + 1; i < doneRange.endIdx; i++) {
    const line = lines[i];
    const cm = /^- \[[xX]\]\s+(.*)$/.exec(line);
    if (!cm) {
      kept.push(line); // 非卡片行（空行等）原样保留
      continue;
    }
    const body = cm[1];
    const lm = lastLink(body);
    let doneDate: string | null = null;
    if (lm) {
      // 带来源：从源笔记读取 ✅ 完成日期
      const basename = lm[1].trim();
      const text = cardText(body, opts);
      const target = app.metadataCache.getFirstLinkpathDest(basename, file.path);
      if (target instanceof TFile) doneDate = await getDoneDate(app, target, text, opts);
    } else {
      // 无来源：从卡片行读取完成日期（autoCompleteInDoneColumn 已写入 ✅）
      const m = /\u{2705}\s*(\d{4}-\d{2}-\d{2})/u.exec(body);
      doneDate = m ? m[1] : null;
    }
    // 归档判定：
    // - 带来源卡：仅当「明确知道完成日期且 ≠ 今天」才归档；日期未知（来源缺失 / 无 ✅）保留，避免误删。
    // - 无来源卡：完成日期 ≠ 今天（含无日期的旧卡）即归档；仅当天完成的保留。
    const shouldArchive = lm
      ? doneDate !== null && doneDate !== today
      : doneDate !== today;
    if (shouldArchive) {
      archived.push(line); // 非当天完成 → 归档
      changed = true;
    } else {
      kept.push(line); // 当天完成 → 保留
    }
  }

  if (!changed) return false;

  // 重组：完成列标题 + 保留行 + 原完成列之后的内容
  const before = lines.slice(0, doneRange.startIdx + 1); // 含标题
  const after = lines.slice(doneRange.endIdx);
  let newLines = [...before, ...kept, ...after];

  // 把 archived 卡片塞进归档列（存在则追加到列首之后，不存在则创建）
  if (archived.length) {
    const ar = columnRange(newLines, archiveCol);
    if (ar.startIdx !== -1) {
      newLines.splice(ar.startIdx + 1, 0, ...archived);
    } else {
      const settingsIdx = newLines.findIndex((l) =>
        l.trim().startsWith("%% kanban:settings")
      );
      // 复刻 kanban 原生归档区块格式：*** 分隔符 + 空白 + ## Archive + 卡片
      const block = ["", "***", "", `## ${archiveCol}`, ...archived, ""];
      if (settingsIdx !== -1) {
        newLines.splice(settingsIdx, 0, ...block);
      } else {
        newLines.push(...block);
      }
    }
  }

  await app.vault.process(file, () => newLines.join("\n"));
  return true;
}

// ---------- 列范围 / 循环连续性辅助 ----------

/** 返回某列（## 标题）在行数组中的 [startIdx, endIdx) 区间；找不到 startIdx 返回 -1。
 *  标题匹配时去掉末尾的「（智能列）」后缀，以兼容智能列加后缀后的形态。 */
function columnRange(
  lines: string[],
  column: string
): { startIdx: number; endIdx: number } {
  const startIdx = lines.findIndex((l) => {
    const t = l.trim();
    return t.startsWith("## ") && stripSmartSuffix(t.slice(3).trim()) === column;
  });
  let endIdx = lines.length;
  if (startIdx !== -1) {
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) {
        endIdx = i;
        break;
      }
    }
  }
  return { startIdx, endIdx };
}

/**
 * 依据循环规则（🔁 every <N> <unit>）与基准到期日，计算下一条循环实例的到期日。
 * 若基准日早于今天，则以今天为基准推进，避免历史欠账无限堆叠在过去。
 * 仅支持 day/week/month/year 及其复数 / 带数量形式；其它（如 every weekday）返回 null 不维护。
 */
function nextDate(oldDue: string, rule: string): string | null {
  const base = new Date(oldDue + "T00:00:00");
  const todayD = new Date(todayISO() + "T00:00:00");
  if (base.getTime() < todayD.getTime()) base.setTime(todayD.getTime());

  // 「every weekday」= 每个工作日（周一~周五）：从基准日之后严格向后找下一个工作日。
  // 必须放在通用正则之前——`weekday` 会被 `week` 前缀匹配，但后面的 `(?![a-z])`
  // 会因紧跟的 "d" 而失败，故通用分支处理不了这种规则。
  if (/every\s+weekdays?\b/i.test(rule)) {
    do {
      base.setDate(base.getDate() + 1);
    } while (base.getDay() === 0 || base.getDay() === 6); // 0=周日, 6=周六
    return todayISO(base);
  }

  const m = /every\s+(\d+)?\s*(day|week|month|year)s?(?![a-z])/i.exec(rule);
  if (!m) return null;
  const n = m[1] ? parseInt(m[1], 10) : 1;
  const unit = m[2].toLowerCase();
  if (unit === "day") base.setDate(base.getDate() + n);
  else if (unit === "week") base.setDate(base.getDate() + n * 7);
  else if (unit === "month") base.setMonth(base.getMonth() + n);
  else if (unit === "year") base.setFullYear(base.getFullYear() + n);
  else return null;
  return todayISO(base);
}

/**
 * 基于一条「未完成的循环任务」原始行，构造其下一条循环实例：
 * 重置为 - [ ]、推进 📅 到期日到下个周期、去掉 ✅ 完成日期，其它元数据（优先级、用时、责任人、🔁 规则等）原样保留。
 * 返回 null 表示无法构造（无到期日 / 无可用循环规则）。
 */
function makeNextRecurring(rawLine: string): string | null {
  const dueM = /\u{1F4C5}\s*(\d{4}-\d{2}-\d{2})/u.exec(rawLine);
  if (!dueM) return null; // 无到期日则不维护循环
  const oldDue = dueM[1];
  // 取 🔁 后的规则文本，截到下一个已知 emoji 或标签 # 为止
  const ruleM = new RegExp("\\u{1F501}\\s*([^" + RECUR_STOP + "]*)", "u").exec(
    rawLine
  );
  if (!ruleM) return null;
  const rule = ruleM[1].trim();
  const newDue = nextDate(oldDue, rule);
  if (!newDue) return null;
  let body = rawLine.replace(/^(\s*[-*]\s+)\[ \]\s+/, ""); // 去掉任务前缀
  body = body.replace(dueM[0], "\u{1F4C5} " + newDue); // 推进到期日
  body = body.replace(/\s*\u{2705}\s*\d{4}-\d{2}-\d{2}/gu, ""); // 去掉完成日期（若有）
  return `- [ ] ${body.trim()}`;
}
