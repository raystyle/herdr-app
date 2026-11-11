// Shared core:源文件为 core/bg-jobs.js;聊天 mod 与 service 都用它(bin/sync-shared 复制进
// mods/chat/core/)。只在此处编辑,绝不改副本。
// agent 留在后台运行的内容,显示在聊天框上方:其 shell 与 watcher,实时,一旦
// 直到它们结束,每个都可单独停止(如 Claude Code 的 "1 shell · ↓ to manage")。
// Claude Code:其日志记录了它启动了什么(后台运行的 shell、运行中移入后台的 shell、Monitor),以及
// 各自何时结束(core/chat-log.js:Conversation.bg)。在其终端里被停掉的 job 或超时的 watcher
// 日志里不留一个字,所以最终以 agent 自己的进程为准:只要其中一个仍持有其
// 输出文件仍打开(<tmp>/claude-<uid>/<project>/<session>/tasks/<task>.output)。
// Codex:其日志从不记录命令超出了本轮,所以全靠其进程说明:它启动的、仍在运行并持有其
// 运行中(其终端里的 /ps 列出同样的内容),连续两次检查都见到后才显示。
// JOBS 在 agent 的 machine 上运行;`run(script, args)` -> Promise<{ stdout }> 在那边执行(sh -c script x args)。

import { cmdWords } from "./chat-log.js";

// jobs alive <kind> <pid>          "ok",然后是 agent 的进程树 "<pid> <ppid> <args>"(codex)或
// 其进程持有打开的输出文件,每个一行 "F <path>"(claude)
// jobs stop claude <pid> <task>    结束持有该任务输出文件的进程及其子进程
// jobs stop codex <pid> <child>    结束 agent 的那个 shell 及其自身进程
// jobs tail <path>                 任务输出文件的最后几行
export const JOBS = String.raw`
mode="$1"; kind="$2"; pid="$3"
# The processes under $1 (and $1 itself): "<pid> <ppid> <args>".
tree() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      # Windows 下 MSYS 的 ps 列不出进程的 ppid/args:用一次 PowerShell 遍历。
      TR="$1" powershell.exe -NoProfile -Command 'if (-not $env:TR) { exit 0 }; $a = Get-CimInstance Win32_Process; $m = @{}; foreach ($x in $a) { $m[[int]$x.ParentProcessId] += @($x) }; $q = New-Object System.Collections.Queue; $q.Enqueue([int]$env:TR); while ($q.Count) { $c = $q.Dequeue(); if (-not $m.ContainsKey($c)) { continue }; foreach ($k in $m[$c]) { $q.Enqueue([int]$k.ProcessId); Write-Output ($k.ProcessId.ToString() + " " + $k.ParentProcessId.ToString() + " " + $k.CommandLine) } }' 2>/dev/null | tr -d '\r'
      ;;
    *)
      ps -A -o pid= -o ppid= -o args= 2>/dev/null | awk -v root="$1" '
        { p[$1] = $2; line[$1] = $0 }
        END { for (k in p) { x = k; n = 0; while (x != root && (x in p) && n < 64) { x = p[x]; n++ } if (x == root) print line[k] } }'
      ;;
  esac
}
# The files those processes hold open: "<pid> <path>".
held() {
  pids=$(tree "$1" | awk '{ print $1 }')
  [ -n "$pids" ] || return 0
  if [ -d /proc/self/fd ]; then
    for p in $pids; do for d in /proc/$p/fd/*; do f=$(readlink "$d" 2>/dev/null) && echo "$p $f"; done; done
  else
    lsof -n -p "$(echo $pids | tr ' ' ',')" -Fpn 2>/dev/null | awk '/^p/ { p = substr($0, 2) } /^n/ { print p " " substr($0, 2) }'
  fi
}
case "$mode" in
alive)
  echo ok
  if [ "$kind" = codex ]; then tree "$pid"
  else held "$pid" | awk '$2 ~ /\/tasks\/[A-Za-z0-9_-]+\.output$/ { print "F " $2 }' | sort -u; fi
  ;;
stop)
  what="$4"
  case "$what" in ""|*[!A-Za-z0-9_-]*) exit 0 ;; esac
  if [ "$kind" = codex ]; then
    tree "$pid" | awk -v c="$what" '$1 == c { found = 1 } END { exit !found }' || exit 0
    kill -TERM $(tree "$what" | awk '{ print $1 }') 2>/dev/null
  else
    for h in $(held "$pid" | awk -v t="/tasks/$what.output" 'substr($2, length($2) - length(t) + 1) == t { print $1 }' | sort -u); do
      kill -TERM $(tree "$h" | awk '{ print $1 }') 2>/dev/null
    done
  fi
  ;;
tail)
  case "$2" in */tasks/*.output) tail -n 40 "$2" 2>/dev/null ;; esac
  ;;
esac
true`;

// 重查间隔(ms):Claude Code 仅当日志列有 job 时;Codex 则始终查看,频率更低。
const EVERY = { claude: 3000, codex: 5000 };
// 目前只执行其 agent 自身工作的 Codex shell:工具调用的 sh -c "<command>",而非 hook。
const SHELL = /(?:^|\s|\/)(?:ba|z|da)?sh\s+-l?c\s+(.*)$/;
const HOOK = /herdr-agent-state|session-note|ask-hook/;

export class BgJobs {
  constructor() {
    // 上次查看:{ at, files: Set of output paths }(claude)| { at, procs: [{ pid, cmd }] }(codex);无记录时为 null
    // 全部失败(另一台 machine 不可达):此时仅日志说明。
    this.seen = null;
    this.at = 0;
    this.busy = false;
    this.first = new Map(); // codex:pid → 首次观察到它的时间
  }

  // 现在该查看了吗?(kind:"claude" | "codex";conv:其 Conversation)
  due(kind, conv, now = Date.now()) {
    if (this.busy || !EVERY[kind]) return false;
    if (kind === "claude" && !conv?.bg?.length) { this.seen = null; return false; }
    return now - this.at >= EVERY[kind];
  }

  // 检查 agent 的进程(pid 为其 CLI 的)。显示内容有变化时返回 true。
  async look(run, kind, pid, conv) {
    const before = this.sig(kind, conv);
    this.busy = true;
    this.at = Date.now();
    let out = null;
    try { out = (await run(JOBS, ["jobs", "alive", kind, String(pid)]))?.stdout ?? null; } catch {}
    finally { this.busy = false; }
    this.read(kind, pid, out, Date.now());
    return this.sig(kind, conv) !== before;
  }

  // 一次查看所打印的内容(null:查看失败)。
  read(kind, pid, out, now) {
    const lines = String(out ?? "").split("\n");
    if (lines[0]?.trim() !== "ok") { this.seen = null; return; }
    if (kind === "codex") {
      const rows = lines.slice(1).map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean).map((m) => ({ pid: m[1], ppid: m[2], args: m[3] }));
      const shells = new Map(rows.filter((r) => r.pid !== String(pid) && SHELL.test(r.args) && !HOOK.test(r.args)).map((r) => [r.pid, r]));
      // 每条命令最顶层的 shell(shell 再启动的 shell 算作其中一部分)。
      const procs = [...shells.values()].filter((r) => !shells.has(r.ppid)).map((r) => ({ pid: r.pid, cmd: SHELL.exec(r.args)[1].replace(/^(['"])(.*)\1$/, "$2") }));
      for (const p of procs) if (!this.first.has(p.pid)) this.first.set(p.pid, now);
      for (const k of this.first.keys()) if (!procs.some((p) => p.pid === k)) this.first.delete(k);
      this.seen = { at: now, procs };
    } else {
      this.seen = { at: now, files: new Set(lines.slice(1).filter((l) => l.startsWith("F ")).map((l) => l.slice(2))) };
    }
  }

  // The jobs that run now, oldest first: { id, kind: "shell" | "monitor", label, cmd, at, task?, path?, pid? }.
  list(kind, conv) {
    const s = this.seen;
    if (kind === "codex") {
      if (!s?.procs) return [];
      return s.procs.filter((p) => this.first.get(p.pid) < s.at)
        .map((p) => ({ id: `p${p.pid}`, kind: "shell", label: cmdWords(p.cmd) || p.cmd, cmd: p.cmd, at: this.first.get(p.pid), pid: p.pid }));
    }
    const path = (task) => (s?.files ? [...s.files].find((f) => f.endsWith(`/tasks/${task}.output`)) : undefined);
    return (conv?.bg ?? []).filter((j) => {
      // No look (yet, or it failed), or started after the last look: the log says.
      if (!s?.files || (j.at ?? 0) > s.at - 2000) return true;
      // No task id yet: no output file vouches for it, so only for a minute (its call still waiting for an answer).
      if (!j.task) return (j.at ?? 0) > s.at - 60000;
      return Boolean(path(j.task));
    }).map((j) => ({ ...j, ...(j.task && path(j.task) ? { path: path(j.task) } : {}) }));
  }

  // What shows, to tell a change.
  sig(kind, conv) { return this.list(kind, conv).map((j) => j.id).join(" "); }

  // Stops a job (one of list()'s). Its CLI then tells the agent it ended, as when it stops one itself.
  async stop(run, kind, pid, job) {
    const what = kind === "codex" ? job?.pid : job?.task;
    if (!what) return false;
    await run(JOBS, ["jobs", "stop", kind, String(pid), String(what)]);
    // 稍后再看。
    this.at = 0;
    if (kind === "codex") this.seen = this.seen && { ...this.seen, procs: this.seen.procs.filter((p) => p.pid !== job.pid) };
    else if (this.seen?.files && job.path) { this.seen.files.delete(job.path); this.seen.at = Date.now(); }
    return true;
  }

  // job 最后打印的几行(Claude Code 保存在其输出文件里),无则 null。
  async output(run, job) {
    if (!job?.path) return null;
    const r = await run(JOBS, ["jobs", "tail", job.path]).catch(() => null);
    if (!r) return null;
    return String(r.stdout ?? "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "").replace(/\n+$/, "");
  }
}
