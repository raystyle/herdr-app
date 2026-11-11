// 从 agent 自身的 session log 跟随其对话,与窗口聊天相同(mods/chat:找到
// 日志,先读最新一页,再读增量;更早的页按需读取;至多保留 KEEP 条):
// service 用它服务 web 应用。io.sh(script, args, machine) -> Promise<{ code, stdout }> 在 shell 中运行
// agent 所在 machine 上的脚本(null:本机)。
// Shared core:源文件为 core/chat-reader.js。

import { FIND, LOG, Conversation, records, resultText } from "./chat-log.js";
import { BgJobs } from "./bg-jobs.js";

export const PAGE = 200;
export const KEEP = 2000;
export const KINDS = { "claude-code": "claude", claude: "claude", codex: "codex" };

// terminal 运行的 CLI,以聊天所知的名称("claude"、"codex"),否则为 null。
export const kindOf = (t) => KINDS[t?.status?.app] ?? KINDS[t?.foreground?.name] ?? null;

export class ChatReader {
  constructor(io, addr) {
    this.io = io;
    this.addr = addr;
    this.machine = addr.includes("/") ? addr.split("/")[0] : null;
    this.reset();
  }

  reset() {
    this.pinned = false;
    this.path = null;
    this.kind = null;
    this.pid = null;
    this.start = null;   // 首次读取的字节(0:日志最开头)
    this.end = 0;
    this.records = [];
    this.conv = null;
    this.bg = new BgJobs(); // 它在后台留下的仍在运行的内容
    this.state = "finding"; // finding | pending(尚无日志)| ready | none(非聊天 agent)| missing
  }

  log(args) { return this.io.sh(LOG, ["log", ...args], this.machine); }

  // 已结束 agent 自己的日志(已完成 task 的最后一个 agent,由 Tasks panel 打开):按原样读取,绝不
  // 再次查找。-> 该读取器。
  fixed(path, kind) {
    this.reset();
    this.path = path;
    this.kind = kind;
    this.pinned = true;
    return this;
  }

  // 查找此 terminal 当前运行的 agent 的日志(t 为其 herdr-core record)。变化时返回 true。
  async locate(t) {
    if (this.pinned) return false;
    const kind = kindOf(t);
    const pid = t?.foreground?.pid;
    if (!kind || !pid) { const was = this.state; if (was !== "none") { this.reset(); this.state = "none"; } return was !== "none"; }
    if (this.path && this.kind === kind && this.pid === pid) return false;
    const f = await this.io.sh(FIND, ["chat", kind, String(pid)], this.machine);
    const path = String(f.stdout ?? "").trim().split("\n").pop() ?? "";
    if (path === "pending" || !path) {
      const was = this.state;
      this.reset();
      this.kind = kind;
      this.pid = pid;
      this.state = path === "pending" ? "pending" : "none";
      if (this.state === "pending") { this.conv = new Conversation(kind); this.start = 0; }
      return was !== this.state;
    }
    if (path === this.path && kind === this.kind) { this.pid = pid; return false; }
    this.reset();
    this.path = path;
    this.kind = kind;
    this.pid = pid;
    return true;
  }

  // // ---- 留在后台运行的东西(core/bg-jobs.js)----

  run(script, args) { return this.io.sh(script, args, this.machine); }

  // 到期时查看 agent 的进程。-> 显示内容有变化时返回 true。
  async lookJobs() {
    if (this.pinned || !this.pid || !this.conv || !this.bg.due(this.kind, this.conv)) return false;
    return this.bg.look((s, a) => this.run(s, a), this.kind, this.pid, this.conv);
  }

  // 它现在的 shell 与 watcher(原样读取日志时没有)。
  jobs() { return this.pinned || !this.conv ? [] : this.bg.list(this.kind, this.conv); }

  // 其中一个已停止。若已不在则返回 false。
  async stopJob(id) {
    const job = this.jobs().find((j) => j.id === id);
    return job ? this.bg.stop((s, a) => this.run(s, a), this.kind, this.pid, job) : false;
  }

  // 其中一个最后打印的内容(Claude Code 的),无则 null。
  async jobOutput(id) {
    const job = this.jobs().find((j) => j.id === id);
    return job ? this.bg.output((s, a) => this.run(s, a), job) : null;
  }

  rebuild() {
    this.conv = new Conversation(this.kind);
    this.conv.feed(this.records);
  }

  // 先给最新一页;之后只补日志新增的部分。→ 有新内容时返回 true。
  async pull() {
    if (!this.path) return false;
    const path = this.path;
    if (this.start === null) {
      const r = await this.log(["page", path, "999999999999999", String(PAGE)]);
      if (path !== this.path) return false;
      if (String(r.stdout).startsWith("missing")) { this.path = null; this.state = "missing"; return true; }
      const { head, records: recs } = records(r.stdout);
      if (head[0] !== "P") return false;
      this.start = Number(head[1]);
      this.end = Number(head[2]);
      this.records = recs;
      this.rebuild();
      this.state = "ready";
      return true;
    }
    const r = await this.log(["tail", path, String(this.end)]);
    if (path !== this.path) return false;
    if (String(r.stdout).startsWith("missing")) { this.path = null; this.state = "missing"; return true; }
    const { head, records: recs } = records(r.stdout);
    if (head[0] !== "T") return false;
    // 读到的比之前短:文件被替换了。从末尾重新开始。
    if (Number(head[2]) < this.end) { const p = this.path, k = this.kind, pid = this.pid; this.reset(); Object.assign(this, { path: p, kind: k, pid }); return this.pull(); }
    this.end = Number(head[3]);
    if (!recs.length) return false;
    this.records.push(...recs);
    if (this.records.length > KEEP) {
      // 降到四分之三,这样只在偶尔时重建,而不是每条消息都重建。
      this.records = this.records.slice(-Math.floor(KEEP * 0.75));
      this.start = this.records[0].off;
      this.rebuild();
    } else this.conv.feed(recs);
    return true;
  }

  // 工具行各调用打印的内容,仅在行展开时才从日志读取(同窗口端聊天
  // loadResults()):返回 Map,step id -> 其开头几行(无则为 "")。
  async results(steps) {
    const out = new Map();
    const want = (steps ?? []).filter((s) => s.out !== undefined);
    if (!want.length || !this.path) return out;
    const offs = [...new Set(want.map((s) => s.out))].slice(0, 40);
    const r = await this.log(["results", this.path, ...offs.map(String)]);
    for (const part of String(r.stdout ?? "").split("\x1e").slice(1)) {
      const nl = part.indexOf("\n");
      const off = Number(part.slice(0, nl));
      const line = part.slice(nl + 1).replace(/\n$/, "");
      for (const s of want) if (s.out === off) out.set(s.id, resultText(line, s.id) ?? "");
    }
    return out;
  }

  // 读取内容之前的上一页。→ 存在上一页时返回 true。
  async earlier() {
    if (!this.start || !this.path) return false;
    const path = this.path, before = this.start;
    const r = await this.log(["page", path, String(before), String(PAGE)]);
    const { head, records: recs } = records(r.stdout);
    if (path !== this.path || this.start !== before || head[0] !== "P") return false;
    this.start = Number(head[1]);
    this.records = [...recs, ...this.records];
    this.rebuild();
    return true;
  }
}
