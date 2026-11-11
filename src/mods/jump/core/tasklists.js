// machine 的 ~/.herdr/tasks 里每个文件夹的任务列表,与 Tasks 和 Jump panel 读取的一致。
// Shared core:源文件为 core/tasklists.js(窗口的 mod、service 与 web app 都在用);
// bin/sync-shared 会把它复制进 lib/COPIES 中的每个 mod。请编辑 core/tasklists.js,不要改副本,然后运行 bin/sync-shared。
//
// 判定规则(herdr-task 的 is_task_list,位于 mods/tasks/bin/herdr_task/store.py;两边须保持一致):一
// 该文件是任务列表,当且仅当它是含字符串 "folder" 与列表的 JSON 对象
// "tasks"。其余一切(herdr-task 自己的 .news.json、.seen.json、.newslog.json 等;有些是
// 列表)会跳过。隐藏目录下的文件夹用带点 slug(~/.config/x 对应 .config-x.json),因此
// 文件名无法区分二者。

// 先打印文件名一行,再打印文件内容,文件之间以一行分隔(输出
// 遇到 NUL 会截断,故不采用)。以 exec("sh", ["-c", READ_LISTS], { on }) 运行。
import { SH } from "./paths.js";
export const READ_LISTS = SH + 'cd "$SHEP_TASKS" 2>/dev/null || exit 0; for f in *.json .*.json; do [ -f "$f" ] && printf "%s\\n" "$f" && cat "$f" && printf "\\n@@herdr-task-list@@\\n"; done; true';

export const isTaskList = (d) => !!d && typeof d === "object" && !Array.isArray(d) && typeof d.folder === "string" && Array.isArray(d.tasks);

// 按名称对应 READ_LISTS 的某个文件(".autopilot.json":那台 machine 的 Autopilot),已解析;不存在则为 null。
export function fileIn(stdout, name) {
  for (const x of (stdout ?? "").split("\n@@herdr-task-list@@\n")) {
    const nl = x.indexOf("\n");
    if (x.slice(0, nl) !== name) continue;
    try { return JSON.parse(x.slice(nl + 1)); } catch { return null; }
  }
  return null;
}

// READ_LISTS 的输出 -> [{ slug, ...list }],仅任务列表。
export function taskLists(stdout) {
  const out = [];
  for (const x of (stdout ?? "").split("\n@@herdr-task-list@@\n")) {
    if (!x.trim()) continue;
    const nl = x.indexOf("\n");
    let d = null;
    try { d = JSON.parse(x.slice(nl + 1)); } catch {}
    const slug = x.slice(0, nl).replace(/\.json$/, "");
    if (slug && isTaskList(d)) out.push({ slug, ...d });
  }
  return out;
}
