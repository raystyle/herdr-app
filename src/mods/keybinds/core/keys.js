// Keybinds 列表的文案(herdr-winapp 3.0 的 Keybinds 对话框,mods/keybinds):每个按键按人们习惯的写法,每个操作
// 以平实文字按组呈现(Tabs、Spaces、Panes、Agents、Terminal、mod 自有、App)。窗口实时读取其键
// (keys());web app 传入浏览器可用的那些(web/plugins/keyboard)。两端的命名都来自这里。
// Shared core:源文件为 core/keys.js;bin/sync-shared 会把它复制进 lib/COPIES 中的各 mod。

const DIRS = { left: "left", right: "right", up: "up", down: "down" };

// 为文字依赖参数的操作命名,也用于 mod 自有的命令(不在
// commands())。(arg) => name。
export const NAMES = {
  "tab.new": () => "新建标签页",
  "tab.close": () => "关闭标签页",
  "tab.rename": () => "重命名标签页",
  "tab.next": () => "下一个标签页",
  "tab.prev": () => "上一个标签页",
  "space.new": () => "新建空间",
  "space.rename": () => "重命名空间",
  "space.next": () => "下一个空间",
  "space.prev": () => "上一个空间",
  "pane.split": (d) => (d === "down" ? "Split down" : "Split right"),
  "pane.go": (d) => `Focus the pane ${DIRS[d] ?? d}`,
  "pane.swap": (d) => `Swap with the pane ${DIRS[d] ?? d}`,
  "pane.close": () => "关闭窗格",
  "pane.zoom": () => "缩放窗格,或显示全部",
  "layout.toggle": (id) => (id === "sidebar" ? "Show or hide the sidebar" : `Show or hide ${id}`),
  "layout.switch": () => "下一个布局",
  "mod.open": (name) => ({ jump: "跳转到空间、任务或工件", keybinds: "按键" })[name] ?? `Open ${name}`,
  "app.help": () => "按键",
  "app.palette": () => "命令面板",
  "app.settings": () => "设置",
  "app.zoom_in": () => "放大",
  "app.zoom_out": () => "缩小",
  "app.zoom_reset": () => "实际大小",
  "terminal.copy": () => "Copy",
  "terminal.paste": () => "Paste",
  "tabs-tasks.close": () => "关闭标签页",
  "tabs-tasks.newspace": () => "新建空间",
  "tabs-tasks.rename-tab": () => "重命名标签页",
  "tabs-tasks.rename-space": () => "重命名空间",
  "chat.dictate": () => "Dictate",
  "chat.call": () => "开始通话",
  "chat.find": () => "在对话中查找",
};

// 终端按键按其文字输入的内容。
const SENDS = { "\u0017": "删除前一个词", "\u001bb": "左移一词", "\u001bf": "右移一词" };

// 操作所属的分组,按此顺序(mod 自己的分组、"Chat",位于 Terminal 与 App 之间)。
export const ORDER = ["Tabs", "Spaces", "Panes", "Agent", "终端", "App"];
export function groupOf(section, action) {
  if (section === "terminal") return "Terminal";
  if (section.startsWith("mod:")) return section.slice(4).replace(/^./, (c) => c.toUpperCase()).replace(/-/g, " ");
  if (/^tab\.|^tabs-tasks\.(close|rename-tab)$/.test(action)) return "Tabs";
  if (/^space\.|^tabs-tasks\.(newspace|rename-space)$/.test(action)) return "Spaces";
  if (/^pane\./.test(action)) return "Panes";
  if (/^agent\./.test(action)) return "Agents";
  return "App";
}

// 用文字描述一个操作。about:命令名 -> 其描述(Herdr 的 commands())。
export function nameOf(action, about = new Map()) {
  if (action.startsWith("send:")) return SENDS[action.slice(5)] ?? "Type text";
  const [name, arg] = action.split(/:(.*)/s);
  if (NAMES[name]) return NAMES[name](arg);
  // 描述的第一个从句:"Show the next agent, in the order…" → "Show the next agent"。
  const said = (about.get(name) ?? "").split(/\s*[(:;,]|\.(\s|$)/)[0].trim();
  if (said) return said;
  const last = name.split(".").pop().replace(/[-_]/g, " ");
  return last[0].toUpperCase() + last.slice(1);
}

const SPECIAL = { pageup: "PageUp", pagedown: "PageDown", escape: "Esc", backspace: "Backspace" };

// keys.json 的 “ctrl-shift-t” 转为人读格式:“Ctrl+Shift+T”(macOS 为 ⌃⇧T),与菜单一致。
export function keyText(stroke, mac = false) {
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return stroke.trim().split(/\s+/).map((one) => {
    const parts = one.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map((m) => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = SPECIAL[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase());
    return [...Object.keys(names).filter((m) => held.has(m)).map((m) => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

// 分组后的行:[{ group, rows: [{ name, keys: [text] }] }]。list:[{ section, keys, action }](Herdr 的 keys());
// layout:当前显示 layout 的名称,其自身 section 的键覆盖全局键(其他 layout 的忽略)。
// 每个名字一行,列出其全部按键;"Show tab 1" … "Show tab 9" 合并为一行,显示 "Alt+1–9"。
export function grouped(list, { layout = "", about = new Map(), mac = false } = {}) {
  const shown = `layout:${layout ?? ""}`;
  const all = list.filter((k) => k.action && k.action !== "terminal" && !(k.section.startsWith("layout:") && k.section !== shown));
  const mine = new Set(all.filter((k) => k.section === shown).map((k) => k.keys));
  const live = all.filter((k) => !(k.section === "global" && mine.has(k.keys)));
  const groups = new Map();
  for (const k of live) {
    const group = groupOf(k.section, k.action);
    const series = /^(tab|space)\.select:([1-9])$/.exec(k.action);
    const lead = /^(.*-)?([1-9])$/.exec(k.keys.trim());
    const name = series && lead ? `Show ${series[1]} 1–9` : nameOf(k.action, about);
    if (!groups.has(group)) groups.set(group, new Map());
    const rows = groups.get(group);
    if (!rows.has(name)) rows.set(name, []);
    const text = series && lead ? `${keyText(`${lead[1] ?? ""}1`, mac)}–9` : keyText(k.keys, mac);
    if (!rows.get(name).includes(text)) rows.get(name).push(text);
  }
  const rank = (g) => (ORDER.includes(g) ? ORDER.indexOf(g) : ORDER.length - 1.5);
  return [...groups].sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([group, rows]) => ({ group, rows: [...rows].map(([name, keys]) => ({ name, keys })) }));
}

// 对话框的过滤:输入的每个词都须出现在 group、名称或按键中。
export function keyFound(filter, group, row) {
  const words = String(filter ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => `${group} ${row.name} ${row.keys.join(" ")}`.toLowerCase().includes(w));
}

// 对话框的文案。
export const KEYBINDS = { title: "按键", filter: "筛选按键", none: "没有匹配的按键。" };

// 窗口按键中在 web 端同样生效的(web/plugins/keyboard 逐个处理),依据 keys.json 与 Herdr 的
// 默认绑定排在 herdr-winapp layout 之下。其余是窗口的:pane、命令 palette、缩放,
// terminal 自身的按键,以及浏览器保留的(Ctrl+Tab、Ctrl+1–9、Ctrl+Shift+N、T、W)。
export const WEB_KEYS = {
  global: {
    "alt-1": "tab.select:1", "alt-2": "tab.select:2", "alt-3": "tab.select:3", "alt-4": "tab.select:4", "alt-5": "tab.select:5",
    "alt-6": "tab.select:6", "alt-7": "tab.select:7", "alt-8": "tab.select:8", "alt-9": "tab.select:9",
    "alt-left": "tab.prev", "alt-right": "tab.next", "alt-]": "tab.next", "alt-[": "tab.prev",
    "alt-down": "space.next", "alt-up": "space.prev",
    "ctrl-shift-/": "mod.open:keybinds", "ctrl-shift-?": "mod.open:keybinds",
    "ctrl-shift-b": "layout.toggle:sidebar",
    "ctrl-shift-k": "mod.open:jump", "ctrl-k": "mod.open:jump",
    "ctrl-,": "app.settings",
  },
  "mod:chat": { "ctrl-shift-d": "chat.dictate", "ctrl-shift-space": "chat.call", "ctrl-f": "chat.find" },
  "layout:herdr-winapp": { "shift-f2": "tabs-tasks.rename-space" },
};

// keys.json 的 section 转为 grouped() 所需列表:{ section: { keys: action } } -> [{ section, keys, action }]。
export const flatKeys = (json) => Object.entries(json ?? {}).flatMap(([section, map]) => Object.entries(map ?? {}).map(([keys, action]) => ({ section, keys, action })));
