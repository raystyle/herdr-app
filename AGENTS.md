# herdr-winapp

herdr-app(Windows)的中文定制界面:chat 对话 + 终端模式。

## 布局

- 布局文件:`~/.config/herdr-app/layouts/herdr-winapp.json`(Ctrl+Shift+L 切换)
- mod 列表(17 个,都在 `~/.config/herdr-app/mods/`):
  - spaces-chat — 侧栏空间列表
  - tabs-tasks — 标签栏(标签页、+ 菜单、Files/Changes 面板按钮、窗口按钮)
  - pane-chat — agent 窗格头,Chat|Terminal 切换
  - chat — 对话(读 Claude Code / Codex 会话日志渲染成聊天气泡、问答卡片)
  - chat-models / chat-image — 模型选择、图片查看
  - sidebar — 侧栏头部(搜索/折叠)与底栏(设置)
  - workspace-status-chat — 底部状态栏
  - toasts / confirm-chat / prompt-chat — 通知、确认框、输入框
  - menu-tasks / new-menu-tasks — 右键菜单、+ 菜单
  - newspace — 新建空间
  - jump(Ctrl+K)/ keybinds — 快速跳转、按键列表
  - chat-call — 空 stub(勿删,旧点击状态引用)
- 设置:只用 Herdr 自带的 `app.settings`(Ctrl+,)
- 面板:Files / Changes(Herdr 自带)

## 本仓库

| 路径 | 用途 |
|---|---|
| `src/mods/` | 17 个 mod 的源码(单一事实源,每个 mod 自包含) |
| `src/layouts/herdr-winapp.json` | 布局 |
| `src/templates/assistant.md` | Assistant 角色指令模板 |
| `winshim/` | Python shims(fcntl/pwd/sitecustomize+winpatch),部署副本在 `~/.config/herdr-app/.winshim/`,被 .cmd 启动器引用 |


## 部署

`src/mods` 和 `~/.config/herdr-app/mods` 保持一致:直接改安装侧(热重载)后拷回 `src/`,
或改 `src/` 后整个目录拷过去(删掉目标里多余的 mod 再拷)。布局:`src/layouts/herdr-winapp.json`
→ `~/.config/herdr-app/layouts/`。

## 界面维护

改界面 = 直接改 `~/.config/herdr-app/mods/<mod>/` 下的文件,保存即热重载。改完跑 `herdr-app check <mod目录>`,必须通过。

- herdr-app 的 `exec`:裸名只查 app 进程 PATH;`.cmd` 可执行;无扩展名 shebang 脚本报 os error 193。改用户 PATH 后要广播 WM_SETTINGCHANGE 并重启 herdr-app 才生效(终端由 herdr-core 持有,重启不受影响)
- agent 的 pid 是外层 pwsh.exe,claude.exe 是子进程;会话日志 `~/.claude/projects/*/<sessionId>.jsonl`,经 `~/.claude/sessions/<子进程pid>.json` 定位。Git Bash 无 pgrep,查子进程用 PowerShell `Win32_Process` 遍历,输出 CRLF 要 `tr -d '\r'`(两字符,不是真实 CR 字节——真实字节会静默破坏 FIND 管道)
- Windows 无符号链接特权:junction(`_winapi.CreateJunction`)免特权;CPython 3.12 的 `os.path.islink` 不认 junction
- powershell.exe 传参用环境变量(`$args[0]` 会挂起)
- 改对象字面量时注释别放 `});` 前面;SVG 引用有模板串,按文件名搜会误报

## 诊断

- `herdr-app status` — errors / overlays;`herdr-app check <mod>` — 必须过;`herdr-app ls`、`hc get <t> --json` — agent/pid
- 界面内 exec 疑难:一次性探针 mod(exec + setShared 写 shared.json),别猜
