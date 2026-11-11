// herdr-winapp 显示的菜单,以数据表示:按用途给出每项的 id 和文字及顺序。窗口的 mod 与
// web app 都从这些列表构建菜单(各自对某项有独特处理),因此两边提供的内容一致,按
// 相同文字。打开对话框的标签以 “…” 结尾。
// 共享核心:源为 core/menus.js。

const sep = { sep: true };

// sidebar:机器头部的 +、space 的菜单、机器头部自身的菜单、section 的菜单。
export const addMenu = () => [
  { id: "new-space", label: "新建空间", icon: "plus" },
  { id: "new-section", label: "新建分区", icon: "folder-plus" },
];

// git:null(非 repo)、“main”(repo 自身文件夹)或 “linked”(其 worktree 之一)。assistant:false 表示
// space 在任何机器上都还没有 Assistant 的 tab:Start Assistant 会打开它,并接管已在当地运行的一个。
export function spaceMenu({ unread = false } = {}) {
  return [
    { id: "agent", label: "启动 agent", icon: "network" },
    { id: "terminal", label: "新建终端", icon: "terminal" },
    ...(unread ? [{ id: "read", label: "标为已读", icon: "check-check" }] : []),
    { id: "rename", label: "重命名…", icon: "square-pen" },
    sep,
    { id: "close", label: "关闭…", icon: "x" },
  ];
}

// 机器的菜单:名称和 emoji,及其在机器中的位置。
export const machineMenu = ({ first = true, last = true } = {}) => [
  { id: "rename", label: "重命名…", icon: "square-pen" },
  ...(first && last ? [] : [{ sep: true }]),
  ...(first ? [] : [{ id: "up", label: "上移", icon: "arrow-up" }]),
  ...(last ? [] : [{ id: "down", label: "下移", icon: "arrow-down" }]),
];

export const sectionMenu = () => [
  { id: "rename", label: "重命名…", icon: "square-pen" },
  // 立即执行;其 toast 提供 Undo
  { id: "delete", label: "Delete", icon: "trash-2" },
];

// task 行的菜单(Tasks panel):其 pin;尚未开始的任务(status 为 todo、queued 或 scheduled,)还有
// 之后自行启动:几次用于选择(herdr-task edit 的 --in 或 --at 文字)、Other time…(输入用:web 的),以及
// scheduled 的任务 Start now 和 Unschedule。标题项没有 id。
export const SCHEDULE_PICKS = [
  { label: "1 小时后", in: "1h" }, { label: "3 小时后", in: "3h" },
  { label: "明天 9:00", at: "明天 9:00" }, { label: "周一 9:00", at: "周一 9:00" },
];
export const taskMenu = ({ pinned = false, status = null } = {}) => {
  const later = ["todo", "queued", "scheduled"].includes(status);
  return [
    ...(later ? [{ heading: status === "scheduled" ? "Reschedule" : "Start later" },
      ...SCHEDULE_PICKS.map((p) => ({ id: "schedule", icon: "clock", ...p })),
      { id: "schedule-other", label: "其他时间…", icon: "clock", typed: true }] : []),
    ...(status === "scheduled" ? [sep, { id: "start-now", label: "Start now", icon: "play" }, { id: "unschedule", label: "Unschedule", icon: "x" }] : []),
    ...(later ? [sep] : []),
    pinned ? { id: "unpin", label: "Unpin", icon: "pin-off" } : { id: "pin", label: "Pin", icon: "pin" },
  ];
};
// Other time… 询问的内容(选项下方的 web 字段):其文字、示例、按钮文字。
export const SCHEDULE_OTHER = { placeholder: "fri 8:15, 18:00 or 6h", label: "启动时", button: "Schedule" };

// tab 栏:tab 的菜单(右键点击 tab;web 的触屏也可从当前显示 tab 的 ⋯ 打开)。Rename…,
// Assistant tab 上的 Edit instructions…,以及 agent 运行时的 Switch agent(已安装 agent 的子菜单)
// 且已安装时,能重启则显示 Restart,其下以分隔线隔开 Close tab。
export const tabMenu = ({ assistant = false, switchable = false, restartable = false } = {}) => [
  { id: "rename", label: "重命名…", icon: "square-pen" },
  ...(assistant ? [{ id: "instructions", label: "编辑指令…", icon: "file-text" }] : []),
  ...(switchable ? [{ id: "switch", label: "切换 agent", icon: "arrow-left-right", submenu: true }] : []),
  ...(restartable ? [{ id: "restart", label: "Restart", icon: "rotate-ccw" }] : []),
  sep,
  { id: "close", label: "关闭标签页", icon: "x" },
];

// app 菜单(其下无 tab 或 pane 的窗口菜单):New space、Keybinds(我们自己的按键列表),然后是 Herdr 的
// 主题(窗口自身的外观:web 则跟随设备的浅色或深色)。
export const appMenu = () => [
  { id: "new-space", label: "新建空间", icon: "plus" },
  sep,
  { id: "keybinds", label: "按键", icon: "keyboard" },
  sep,
  ...[["graphite", "Graphite"], ["ink", "Ink"], ["moss", "Moss"], ["atom-one-dark", "Atom One Dark"]].map(([theme, name]) => ({ id: `theme:${theme}`, label: `Theme: ${name}`, icon: "settings", theme, window: true })),
];

// Switch agent 的子菜单:标题、查找已安装 agent 期间的提示,以及该 tab 当前运行的 agent。
export const SWITCH_AGENT = { title: "切换 agent", loading: "检查已安装的 agent…", current: "Current" };

// tab 栏的 + 菜单:固定行的文字、Assistant 行,以及它提供可启动的 agent。
export const NEW_MENU = {
  terminal: "终端", agents: "启动一个 agent", loading: "检查已安装的 agent…", failed: "无法加载 agent",
  notInstalled: "未安装", space: "新建空间", worktreeNew: "新建 worktree…", worktreeOpen: "打开 worktree…",
};
// 打开:该 space 有其 Assistant 的 tab(该行跳转到它)。其他机器的 space 同样如此:其 Assistant 运行
// 那里,用该机器的 assistant template。其快捷键为 C。
export const assistantRow = ({ open = false } = {}) => ({ label: open ? "显示 Assistant" : "Assistant", hint: open ? "" : "C", enabled: true });
// 已安装的 agent(按顺序对应按键 1 到 9),其后至多两个未安装的。
export const agentChoices = (agents) => [...agents.filter((a) => a.installed), ...agents.filter((a) => !a.installed).slice(0, 2)];
export const agentHint = (a, i) => (a.installed ? (i < 9 ? String(i + 1) : "") : NEW_MENU.notInstalled);

// tab 栏中 tab 的名称:优先给定名,否则(Herdr 自起的 “tb3” 或无名)按其中运行的程序,再否则 “Terminal”。
export const tabName = (name, program = null) => (!name || /^tb\d+$/.test(name) ? program || "Terminal" : name);

// agent chat 的 pane 头部 × 会先询问,代替其按钮。
export const endAgent = (program) => ({ ask: `End ${program}?`, tip: `End ${program}`, cancel: "Cancel", verb: "结束 agent" });

// 机器的称呼:用户起的名字(sidebar 里的),否则其自带名;本机为 “This computer”。
export const machineLabel = (machine, given = null) => given || machine || "本机";
