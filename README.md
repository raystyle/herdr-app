# herdr-winapp

herdr-app(Windows)的中文界面:agent 对话(chat)+ 终端。侧栏管理空间,agent 的对话以聊天气泡呈现,问题与权限请求以卡片直接回答,文件与变更面板在右侧。

## 界面结构

- **侧栏**:空间列表,支持分区、置顶、搜索,底部是设置入口
- **标签栏**:每个空间一组标签页,右侧有 + 菜单和 Files / Changes 面板按钮
- **主区**:agent 终端与 Chat 对话随时切换,每个 agent 窗格有 Chat | 终端 切换
- **侧面板**:Files 文件浏览、Changes 变更列表,跟随当前焦点
- **状态栏**:当前机器与用量信息

- Chat 读 Claude Code / Codex 自己的会话日志,渲染成对话;agent 的提问、权限请求、计划审批以卡片出现在对话里,点选即答
- `Ctrl+K` 快速跳转空间/会话;`Ctrl+,` 打开 Herdr 设置(主题、字体、外观)
- 布局文件:`~/.config/herdr-app/layouts/herdr-winapp.json`,`Ctrl+Shift+L` 切换

## 仓库结构

```
src/
  mods/          17 个界面 mod(每个自包含,单一事实源)
  layouts/       herdr-winapp.json 布局
  templates/     assistant.md(Assistant 角色指令)
winshim/         Windows 下 Python 的 fcntl/pwd 等替代实现
AGENTS.md        维护者手册:目录说明、部署方式、关键坑
```

界面 mod 一览:

| mod | 职责 |
|---|---|
| chat | 对话本体:会话日志读取、气泡、问答卡片、附件预览 |
| pane-chat | agent 窗格头,Chat 与终端的切换、停靠 |
| chat-models / chat-image | 模型选择、图片查看 |
| spaces-chat | 侧栏:空间列表、分区、置顶、搜索 |
| tabs-tasks | 标签栏:标签页、+ 菜单、Files/Changes 面板按钮 |
| sidebar | 侧栏头部与底部(搜索、折叠、设置入口) |
| workspace-status-chat | 状态栏 |
| menu-tasks / new-menu-tasks | 右键菜单、+ 菜单 |
| confirm-chat / prompt-chat | 确认框、输入提示 |
| newspace | 新建空间向导 |
| jump / keybinds | Ctrl+K 快速跳转、按键列表 |
| toasts | 通知浮层 |
| chat-call | 空 stub(占位,勿删) |

## 部署

安装侧在 `~/.config/herdr-app/`:

```sh
# mod 与布局:src 直接拷过去(herdr-app 热重载,保存即生效)
cp -r src/mods/* ~/.config/herdr-app/mods/
cp src/layouts/herdr-winapp.json ~/.config/herdr-app/layouts/
```

Herdr 自带的基础 mod(spaces、tabs、files、changes、menu 等)由 herdr-app 自己生成,不在本仓库。
## 运行要求

- herdr-app ≥ 0.1.12、herdr-core ≥ 0.1.17(Windows)
- agent:Claude Code 或 Codex(chat 读取它们的会话日志)
- `sh`(Git for Windows 的 usr/bin 需在 PATH)、Python 3.8+、jq
- 可选:gh(拉取请求相关按钮)

详见 [AGENTS.md](AGENTS.md)。
