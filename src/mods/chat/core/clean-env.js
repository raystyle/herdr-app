// agent 绝不继承父级 Claude Code session。herdr-core 的 holder 保存其所承载进程的环境
// 启动者,其运行的每个 terminal 都会带上:在 Claude Code 内启动的 holder 会给每个 agent
// CLAUDECODE、CLAUDE_PID、CLAUDE_CODE_CHILD_SESSION、SESSION_ID、MESSAGING_*… Claude Code 随后把 transcript
// 关闭以保存("inherited CLAUDE_CODE_CHILD_SESSION marker",web Chat 会找不到会话)并跳过
// 文件夹信任提示。hc 只能添加变量,不能移除,因此每次启动都以这行 shell 开头:
// 它会清除 CLAUDECODE、CLAUDE_PID 和 CLAUDE_CODE_*,保留用户自己的 Claude Code 配置
// (CLAUDE_CODE_USE_BEDROCK、_SKIP_*、_DISABLE_*、_OAUTH_TOKEN 等,以及从不匹配的 CLAUDE_CONFIG_DIR)。
// POSIX sh(sed -E 与 grep -E 在 GNU 和 macOS 上均可用)。同样的行也在 herdr-task(launch.py 的 CLEAN_ENV)和
// mods/coordinator/restart.sh;test/test_repo.py 保证两者一致。
export const CLEAN_ENV = `for v in $(env | sed -nE 's/^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_[A-Za-z0-9_]+)=.*/\\1/p' | grep -vE '^CLAUDE_CODE_(USE|SKIP|DISABLE|ENABLE|MAX|OAUTH|CLIENT|API)_'); do unset "$v"; done;`;

// agent CLI 的安装位置,排在 holder 自身 PATH 之后(保持其顺序):经 ssh 启动的 holder,如在
// 链接的 Mac 只有 /usr/bin:/bin:/usr/sbin:/sbin,claude 原生安装版、hc 和 herdr-task 位于
// ~/.local/bin,Homebrew 的在 /opt/homebrew/bin 或 /usr/local/bin(:"exec: claude: not found")。
export const AGENT_PATH = `PATH="\${PATH:+$PATH:}$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"; export PATH;`;

/*
 * 模板的 `command:`(由 hc 在 sh -c 下运行):先清掉这些,找到 agent 的安装位置,然后
 * exec 该命令(让终端的程序是 agent 而非 sh:否则在 dash 上 shell 会一直留着)。
 * 已有的 `exec` 只保留一次。
 */
export const cleanCommand = (cmd) => `${CLEAN_ENV} ${AGENT_PATH} exec ${String(cmd).trim().replace(/^exec\s+/, "")}`;
