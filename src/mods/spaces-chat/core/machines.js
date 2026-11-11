// 用户视角的 machine 健康(CPU、内存、磁盘,各为 ok、busy 或 over)、machine 的启动限额,以及
// 读取失败时保留上一次的好数据:窗口侧栏(lib/machines.js)与 web 应用共享的规则。
// 数据来自 mods/tasks/bin/herdr_task/machine.py,在每台机器上运行。
// Shared core:源文件为 core/machines.js;bin/sync-shared 会把它复制进 lib/COPIES 中的各 mod。

export const HOLD = { start_load: 1, start_memory: 80, start_disk: 90 };
export const ALERT = { load: 1.5, memory: 90, disk: 90 };
// 机器的启动上限:先 Everywhere 的,再是其自身的(同 herdr-task 的 machine_limits)。Settings
// 以名称为 machine 建键,本机用 “local”。
export const settingsKey = (machine) => machine ?? "local";
export function holdOf(cfg, machine) {
  return { ...HOLD, ...(cfg?.everywhere?.machine ?? {}), ...(cfg?.machines?.[settingsKey(machine)]?.machine ?? {}) };
}

// 读取失败时保留上一次的有效数值,并标记为失败:绝不猜测。
export function nextRead(prev, fresh) {
  if (fresh.state === "unknown" && prev?.state === "ok") return { ...prev, failed: fresh.why };
  return fresh;
}

export function healthMeters(s) {
  const h = s?.health;
  if (!h) return [];
  const hold = { ...HOLD, ...(s.hold ?? {}) };
  const lv = (v, start, alert) => (v > alert ? "over" : start !== null && start !== undefined && v > start ? "busy" : "ok");
  const gb = (b) => `${Math.round(b / 2 ** 30)} GB`;
  return [
    { name: "CPU", pct: h.cpu, level: lv(h.load, hold.start_load === null ? null : hold.start_load * h.cores, ALERT.load * h.cores),
      detail: `Load ${Number(h.load).toFixed(1)} on ${h.cores} cores` },
    { name: "Memory", pct: h.memory, level: lv(h.memory, hold.start_memory, ALERT.memory), detail: `${gb(h.mem_used)} of ${gb(h.mem_total)}` },
    ...(h.disks?.length ? [{ name: "Disk", pct: h.disk, level: lv(h.disk, hold.start_disk, ALERT.disk),
      detail: h.disks.map((d) => `${d.path} ${d.pct}% · ${d.free_gb} GB free`).join(" · ") }] : []),
  ];
}

// // ---- 数字的含义:机器详情的措辞(窗口弹层与设置 > 机器,网页弹层)--

// 正常:安静;busy:超过启动上限(新任务等待);over:超过告警上限。
const RANK = { ok: 0, busy: 1, over: 2 };
export const worst = (levels) => levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");
export const healthLevel = (s) => worst(healthMeters(s).map((m) => m.level));
// "CPU 12% · Memory 40% · Disk 22%"
export const healthWords = (s) => healthMeters(s).map((m) => `${m.name} ${m.pct}%`).join(" · ");
// meter 进度条下方的说明行:数值,以及其档位含义。
export const meterSub = (m) => m.detail + (m.level === "over" ? " · Over its alert limit" : m.level === "busy" ? " · New tasks wait" : "");

// 有用量来源的 CLI;其他已安装的 agent 一律显示 "No usage info"。
export const READS = { claude: "Claude Code", codex: "Codex", elevenlabs: "ElevenLabs" };
// 早于该数值的会注明其岁数。
export const OLD = 15 * 60000;
export const leftOf = (w) => Math.max(0, Math.round(100 - w.used));
export const liveWindow = (w, now) => !w.resets_at || w.resets_at > now;
// plan 余额:四分之一时琥珀色,十分之一时红色(同 herdr-winapp)。
export const planLevelOf = (pct) => (pct <= 10 ? "over" : pct <= 25 ? "busy" : "ok");

// 每个已安装的 agent CLI:{ cli, name, read, pct(当前剩余最少), level }。没有
// 用量来源:{ cli, name, none: true }。
export function planRows(s, now = Date.now()) {
  if (!s) return [];
  const rows = Object.entries(s.limits ?? {}).map(([cli, read]) => {
    const windows = read.state === "ok" ? (read.windows ?? []).filter((w) => liveWindow(w, now)) : [];
    const pct = windows.length ? Math.min(...windows.map(leftOf)) : null;
    return { cli, name: READS[cli] ?? cli, read, pct, level: pct === null ? "ok" : planLevelOf(pct) };
  });
  for (const a of s.agents ?? []) {
    if (!(a.key in READS) && !rows.some((r) => r.cli === a.key)) rows.push({ cli: a.key, name: a.name, none: true });
  }
  return rows;
}
export const planLevel = (s) => worst(planRows(s).filter((r) => typeof r.pct === "number").map((r) => r.level));
// 计量条的文案(web 端同款标签):先显示健康状况,再显示各 plan 的最少剩余。
export const meterWords = (s) => [healthWords(s), ...planRows(s).filter((r) => typeof r.pct === "number").map((r) => `${r.name} ${r.pct}% left`)].join(" · ");

// 2m、3h 10m、5d 4h
export function span(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${Math.floor(h / 24)}d`;
}
export const ago = (at, now) => (now - at < 60000 ? "刚刚" : `${span(now - at)} ago`);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// "Mon 3:05pm",按本机时钟时区。
export function when(at) {
  const d = new Date(at);
  const hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, "0");
  return `${DAYS[d.getDay()]} ${hh % 12 || 12}:${mm}${hh < 12 ? "am" : "pm"}`;
}

// 详情区的标题:说明数据的最新程度。
export const freshWords = (at, reading, now = Date.now()) =>
  reading ? "更新中…" : at ? (now - at < 60000 ? "刚刚更新" : `Updated ${span(now - at)} ago`) : "";
// 位于 Health 标题旁。
export const healthReadWords = (s, now = Date.now()) => (s.error ? "现在读不到" : s.at ? `Read ${ago(s.at, now)}` : "");
// 其下方,在没有计量条时显示。
export const noHealthWords = (s) => (s.error ? `Couldn't read it: ${s.error}` : "读取中…");
// 尚无 CLI 时显示的 plan 区块。
export const noPlanWords = (s) => (s.limitsAt ? "这里没有 agent CLI。" : "读取套餐用量…");
// CLI 的标题:名称和 plan("Claude Code · Max")。
export const cliTitle = (r) => r.name + (r.read?.plan ? ` · ${r.read.plan[0].toUpperCase()}${r.read.plan.slice(1)}` : "");
// 读取时间早于 OLD,或此后失败过的,显示琥珀色。
export const readOld = (read, now = Date.now()) => now - read.at > OLD || Boolean(read.failed);
// plan 的一个窗口:已失效(读取后已重置)则注明;否则显示数值与重置时间。
export function windowWords(w, now = Date.now()) {
  if (!liveWindow(w, now)) return { dead: `${w.name}: refilled ${when(w.resets_at)}, not read since.` };
  const pct = leftOf(w);
  const refill = w.resets_at ? `Refills ${when(w.resets_at)} · in ${span(w.resets_at - now)}` : w.resets ? `Refills ${w.resets}` : "没有上报恢复时间";
  return { name: w.name, pct, level: planLevelOf(pct), words: `${pct}% left · ${Math.round(w.used)}% used`, refill };
}
export const failedWords = (read) => `Last read failed: ${read.failed}`;
// 没有用量数据的 CLI:说明原因。
export const whyWords = (read) =>
  read.state === "signed-out" ? "Not signed in on this machine." : read.state === "no-access" ? read.why ?? "" : read.state === "no-plan" ? "No plan limits: not signed in to a subscription." : `Unknown. ${read.why ?? ""}`;
export const NO_USAGE = "没有用量信息。";
export const READING_MACHINE = "读取本机信息…";
// 机器 header 上的红点:其健康状况无法读取。
export const healthErrorWords = (error) => `Couldn't read its health: ${error}`;
