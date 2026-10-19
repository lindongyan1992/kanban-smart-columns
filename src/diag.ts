import { DataAdapter } from "obsidian";

/**
 * 插件诊断日志（独立模块）。
 *
 * 背景：这类「改了没生效 / 卡片内容异常」的问题涉及 Obsidian 运行时与另一个插件
 * （obsidian-kanban）的内部渲染时序，静态读代码、读磁盘都无法判定，必须靠运行时
 * 日志拿到事实，避免反复猜测。本模块即为此提供：把关键步骤写进插件目录下的
 * diag.txt，由设置项「调试模式」门控（关闭时完全静默，不产生任何磁盘写入）。
 *
 * 全程写进插件目录下的 diag.txt（超过体积上限时自动截断，只保留最近部分）。
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

/** 供插件初始化时注入 vault adapter。 */
export function initDiagAdapter(ad: DataAdapter | null) {
  DIAG_ADAPTER = ad;
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