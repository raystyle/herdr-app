// Notify,同 herdr-winapp(shared/alerts.ts):space 的 Assistant 哪些内容会送达用户。
// All       它的每条新消息也发出提醒
// Needs me  它的问题和提醒(默认)
// Off       它的任何消息都不提醒;其 sidebar 行为静音:变暗,铃铛划叉,永不加粗
// (红绿计数仍会显示)
// task 照常提醒,不受其影响。设置 s = { everywhere, machines: { [machine]: value },
// spaces: { [space id]: value } }(machine:本机为 “local”,否则为其名):最具体者
// 的设置生效。这些规则以 s 为参数,因此窗口(lib/notify.js,共享 “notify”)和 service
// 和 web app 以同一方式读取。
// 共享核心:源为 core/notify.js;bin/sync-shared 会把它复制到 lib/COPIES 里的各 mod。

export const NOTIFY = ["All", "需要我", "Off"];
export const NOTIFY_DEFAULT = "需要我";
export const NOTIFY_HINT = {
  All: "来自它 Assistant 的每条新消息。",
  "需要我": "它 Assistant 的提问和提醒。",
  Off: "它的 Assistant 没有动静。这一行保持安静。",
};

const valid = (v) => (NOTIFY.includes(v) ? v : null);
export const machineOfSpace = (space) => (String(space).includes("/") ? String(space).split("/")[0] : "local");

export const everywhereOf = (s) => valid(s?.everywhere) ?? NOTIFY_DEFAULT;
// 机器的 Notify(“local” 或其机器名),以及它是否自行设置。
export const machineLevel = (s, m) => valid(s?.machines?.[m]) ?? everywhereOf(s);
export const machineOwn = (s, m) => Boolean(valid(s?.machines?.[m]));
// space 的 Notify(app space id,其他机器上为 “vm/sp3”),以及它是否自行设置。
export const spaceLevel = (s, space) => valid(s?.spaces?.[space]) ?? machineLevel(s, machineOfSpace(space));
export const spaceOwn = (s, space) => Boolean(valid(s?.spaces?.[space]));

// 先变更,再丢弃那些与默认所得相同的项:机器设为与 Everywhere 相同、space 设
// 回退到其机器的设置。
export function tidy(s) {
  const everywhere = valid(s.everywhere) ?? NOTIFY_DEFAULT;
  const machines = Object.fromEntries(Object.entries(s.machines ?? {}).filter(([, v]) => valid(v) && v !== everywhere));
  const spaces = Object.fromEntries(Object.entries(s.spaces ?? {})
    .filter(([id, v]) => valid(v) && v !== (machines[machineOfSpace(id)] ?? everywhere)));
  return { ...s, everywhere, machines, spaces };
}
export const withSpace = (s, space, value) => tidy({ ...s, spaces: { ...(s?.spaces ?? {}), [space]: valid(value) } });
export const withMachine = (s, m, value) => tidy({ ...s, machines: { ...(s?.machines ?? {}), [m]: valid(value) } });
export const withEverywhere = (s, value) => tidy({ ...(s ?? {}), everywhere: valid(value) ?? NOTIFY_DEFAULT });

// terminal 所属的 app space id:其 label 保存的是其自身机器的 id。
export function spaceOfTerminal(k) {
  const l = k?.labels ?? {};
  const id = l["herdr.coordinator.space"] ?? l["herdr.space"] ?? l["herdr.task.space"];
  if (!id) return null;
  const m = String(k.address ?? "").includes("/") ? k.address.split("/")[0] : null;
  return m ? `${m}/${id}` : id;
}

// 该 agent 的消息是否会传到用户:task 的总是;其余按其 space 的 Notify。
// kind:“message”(新回复:仅 All)或 “need”(问题、权限请求、提醒)。
export function notifiesBy(s, k, kind) {
  if (k?.labels?.["herdr.task"]) return true;
  const space = spaceOfTerminal(k);
  const n = space ? spaceLevel(s, space) : everywhereOf(s);
  return n === "All" || (n === "Needs me" && kind !== "message");
}
