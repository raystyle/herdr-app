"""本目录在 PYTHONPATH 上时由 CPython 自动导入:加载 winpatch(os 层的
Unix API 替代)。fcntl 和 pwd 是同目录的普通模块,无需钩子。
"""

import winpatch  # noqa: F401
