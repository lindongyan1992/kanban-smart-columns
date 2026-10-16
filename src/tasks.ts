import { App, TFile } from "obsidian";

export interface ScannedTask {
  file: TFile;
  line: number;
  text: string; // 任务正文（含可能的 📅 日期）
  done: boolean;
  due?: string; // 📅 到期日 YYYY-MM-DD
  scheduled?: string; // ⏳ 计划开始日 YYYY-MM-DD
  start?: string; // 🛫 开始日 YYYY-MM-DD
  created?: string; // ➕ 创建日 YYYY-MM-DD
  priority?: string; // 优先级 emoji（⏫🔺🔼🔽⏬ 中的最高者）
  tags: string[]; // # 标签（不含 #）
}

// 匹配 Markdown 任务行：- [ ] / - [x] / * [ ]
export const TASK_RE = /^(\s*[-*]\s+)\[([^\]])\]\s+(.*)$/;
// 匹配 Tasks 插件的到期日 emoji（📅📆🗓 后跟 YYYY-MM-DD）
// 注意：这些 emoji 属于辅助平面（>U+FFFF），正则必须带 u 标志，否则 V8 会按代理项错误拆分。
// 全部用 \u{...} 码点转义书写，避免 emoji 在工具链中被误拆成孤立代理项。
export const DATE_RE =
  /[\u{1F4C5}\u{1F4C6}\u{1F5D3}]\s*(\d{4}-\d{2}-\d{2})/u;
// 计划开始日 ⏳ / 开始日 🛫 / 创建日 ➕（同样用码点转义书写）
export const SCHEDULED_RE = /\u{23F3}\s*(\d{4}-\d{2}-\d{2})/u;
export const START_RE = /\u{1F6EB}\s*(\d{4}-\d{2}-\d{2})/u;
export const CREATED_RE = /\u{2795}\s*(\d{4}-\d{2}-\d{2})/u;
// 优先级 emoji：⏫ 最高、🔺 高、🔼 中、🔽 低、⏬ 最低。
// 关键修正：Tasks 实际用的「高优先级」是「小三角」U+1F53A（非大三角 U+1F532），二者视觉几乎一致、仅字号有别；
// 早期只用 U+1F532 会导致高优先级标识漏剥（用户反馈「有的优先级标识仍显示」即此因）。
// 故优先级集合把大小两种三角、以及低优先级的小倒三角 U+1F53B 都纳入，覆盖平台 / 字体差异造成的近邻变体。
export const PRIORITY_CLASS = "\u{23EB}\u{1F53A}\u{1F53C}\u{1F53D}\u{23EC}\u{1F532}\u{1F53B}";
const PRIORITY_RE = new RegExp("[" + PRIORITY_CLASS + "]", "u");
const PRIORITY_ORDER = [
  "\u{23EB}", // ⏫ 最高
  "\u{1F53A}", // 🔺 高（小三角，Tasks 实际用这个）
  "\u{1F532}", // 🔺 高（大三角变体，兼容）
  "\u{1F53C}", // 🔼 中
  "\u{1F53D}", // 🔽 低
  "\u{1F53B}", // 🔻 低（小倒三角变体，兼容）
  "\u{23EC}", // ⏬ 最低
];
// # 标签：位于行首或空白之后，避免误抓 URL 片段 / 正文中的普通 #号
const TAG_RE = /(?:^|\s)#([^\s#]+)/g;

/** 取任务行中出现的最高优先级（⏫ > 🔺 > 🔼 > 🔽 > ⏬）；无则 undefined。 */
function parsePriority(raw: string): string | undefined {
  const found: string[] = raw.match(new RegExp(PRIORITY_RE.source, "gu")) ?? [];
  for (const p of PRIORITY_ORDER) if (found.includes(p)) return p;
  return undefined;
}

/** 提取任务行中的全部 # 标签（不含 # 号）。 */
function parseTags(raw: string): string[] {
  const re = new RegExp(TAG_RE.source, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) out.push(m[1]);
  return out;
}

// 循环规则文本截取时，遇到以下任一 emoji 或 # 即停止；
// 含全部优先级变体（见 PRIORITY_CLASS），确保「保留优先级」开关开启时，
// 🔁 规则文本不会把紧随其后的优先级 emoji 一并吞掉。
export const RECUR_STOP =
  PRIORITY_CLASS +
  "\\u{1F4C5}\\u{1F4C6}\\u{1F5D3}\\u{23F3}\\u{1F6EB}\\u{2795}\\u{2705}#";

// 看板卡片显示 / 匹配用的「保留开关」：默认全部剥掉（清爽显示「任务名 + 标签」），
// 各开关可单独保留某项元数据：
//  - keepPriority：保留 Tasks 优先级 emoji（⏫🔺🔼🔽⏬ 及其近邻变体）
//  - keepDue：保留截止日期 📅 YYYY-MM-DD
//  - keepScheduled：保留计划日期 ⏳ YYYY-MM-DD
//  - keepStart：保留开始日期 🛫 YYYY-MM-DD
//  - keepCreated：保留添加日期 ➕ YYYY-MM-DD
//  - keepDataview：保留 dataview 行内字段 `[key:: value]`（如 `[用时:: 5]`）
//  - keepRecurring：保留循环规则 `🔁 ...`（如 `🔁 every day`）
// 注意：优先级集合见 PRIORITY_CLASS，已覆盖大小三角等近邻变体，避免高优先级 U+1F53A 漏剥。
// 完成日期 ✅ 属于「完成状态」而非任务元数据，任何情况下都剥离，不受开关控制。
// 全程用 \u{...} 码点转义 + u 标志，规避辅助平面 emoji 的代理项拆分问题。
export interface CardTextOpts {
  keepPriority?: boolean;
  keepDue?: boolean;
  keepScheduled?: boolean;
  keepStart?: boolean;
  keepCreated?: boolean;
  keepDataview?: boolean;
  keepRecurring?: boolean;
}

// 卡片上「可能被保留」的各类 emoji（优先级 + 四类日期 + 循环规则），
// 末尾剥除其它元数据后用于修补被粘住的间距（见 cardText 末尾）。
const SHOWN_EMOJI_CLASS =
  PRIORITY_CLASS +
  "\\u{1F4C5}\\u{1F4C6}\\u{1F5D3}\\u{23F3}\\u{1F6EB}\\u{2795}\\u{1F501}";

export function cardText(raw: string, opts: CardTextOpts = {}): string {
  const {
    keepPriority = false,
    keepDue = false,
    keepScheduled = false,
    keepStart = false,
    keepCreated = false,
    keepDataview = false,
    keepRecurring = false,
  } = opts;
  let s = raw
    .replace(/\[\[[^\]]+\]\]/g, " ") // 去掉所有 wiki 链接（含卡片末尾的来源链接、任务正文自带的链接），只保留任务名与标签
    // 完成日期 ✅：无条件剥离（它是完成状态而非任务元数据，开启任何开关都不应显示）
    .replace(/\u{2705}\s*\d{4}-\d{2}-\d{2}/gu, "");
  // 四类日期各自独立控制（原先是一个正则一并剥除，现拆开以便分别开关）
  if (!keepDue) {
    s = s.replace(
      /[\u{1F4C5}\u{1F4C6}\u{1F5D3}]\s*\d{4}-\d{2}-\d{2}/gu,
      "" // 截止日期 📅
    );
  }
  if (!keepScheduled) {
    s = s.replace(/\u{23F3}\s*\d{4}-\d{2}-\d{2}/gu, ""); // 计划日期 ⏳
  }
  if (!keepStart) {
    s = s.replace(/\u{1F6EB}\s*\d{4}-\d{2}-\d{2}/gu, ""); // 开始日期 🛫
  }
  if (!keepCreated) {
    s = s.replace(/\u{2795}\s*\d{4}-\d{2}-\d{2}/gu, ""); // 添加日期 ➕
  }
  if (!keepPriority) {
    // 优先级 emoji（覆盖大小三角等近邻变体，见 PRIORITY_CLASS）
    s = s.replace(new RegExp("[" + PRIORITY_CLASS + "]", "gu"), "");
  }
  if (!keepRecurring) {
    // 循环周期（截到下一个已知 emoji 或标签 # 为止；优先级 emoji 必须在停止集合内，
    // 否则「保留优先级」时会把优先级一并删掉）
    s = s.replace(
      new RegExp(
        "\\s*\\u{1F501}[^" + RECUR_STOP + "]*",
        "u"
      ),
      ""
    );
  }
  if (!keepDataview) {
    s = s.replace(/\[[^\]]+::[^\]]*\]/g, ""); // dataview 行内字段 [key:: value]
  }
  if (keepRecurring && /\u{1F501}/u.test(s)) {
    // ⚠ obsidian-kanban 把 🔁 登记为自己的「循环」卡片元数据字段（itemFields.recurrenceSymbol），
    // 渲染时会把「🔁 every week」整段抽到卡片底部的循环字段里，
    // 其后的修饰语（如 Tasks 的 "when done"）会被留在任务名中，看起来像任务名的一部分。
    // 故显示循环规则时去掉这类修饰语，避免它脱离 🔁 变成孤儿文本。
    s = s.replace(/\s*\bwhen\s+done\b/giu, "");
  }
  s = s
    .replace(/[\u0000-\u001F\u007F]/gu, "") // 杂散控制字符
    .replace(/\s+/g, " ")
    // 剥除其它元数据后，被保留的标签/优先级/日期可能「粘」在任务名或相邻文字旁
    // （如 "任务名 📅 … ⏫" → "任务名⏫"），补回空格。
    // 这里只规范间距，不删除任何字符——保留与否由上面的各开关决定。
    .replace(
      new RegExp("([^\\s#])([" + SHOWN_EMOJI_CLASS + "#])", "gu"),
      "$1 $2"
    )
    .replace(
      new RegExp("([" + SHOWN_EMOJI_CLASS + "])([^\\s])", "gu"),
      "$1 $2"
    )
    .trim();
  return s;
}

/**
 * 扫描全库所有 Markdown 文件，返回带到期日的任务列表。
 * 借助 Obsidian 的元数据缓存（listItems）只读取真正包含任务的文件，
 * 再用 cachedRead 取正文，避免在无关文件上做全量 IO。
 */
export async function scanTasks(app: App): Promise<ScannedTask[]> {
  const result: ScannedTask[] = [];
  const files = app.vault.getMarkdownFiles();

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const items = cache?.listItems;
    if (!items || !items.some((i) => i.task !== undefined)) continue;
    // 看板文件里的 - [ ] 是卡片而非源任务；若不排除，自动列生成的卡片会被再次扫到，
    // 导致与源笔记中的同一条任务重复显示。
    const fm = cache?.frontmatter;
    if (fm && fm["kanban-plugin"] === "board") continue;

    let content: string;
    try {
      content = await app.vault.cachedRead(file);
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (const item of items) {
      if (item.task === undefined) continue;
      const idx = item.position.start.line;
      const raw = lines[idx] ?? "";
      const m = TASK_RE.exec(raw);
      if (!m) continue;
      const done = item.task !== " "; // 未勾选时 task 为空格
      const dm = DATE_RE.exec(raw);
      const sm = SCHEDULED_RE.exec(raw);
      const stm = START_RE.exec(raw);
      const cm = CREATED_RE.exec(raw);
      result.push({
        file,
        line: idx,
        text: m[3],
        done,
        due: dm ? dm[1] : undefined,
        scheduled: sm ? sm[1] : undefined,
        start: stm ? stm[1] : undefined,
        created: cm ? cm[1] : undefined,
        priority: parsePriority(raw),
        tags: parseTags(raw),
      });
    }
  }

  return result;
}
