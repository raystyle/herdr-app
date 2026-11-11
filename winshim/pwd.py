"""Windows 下 pwd 模块的替代实现。

调用方用 pwd.getpwuid(os.getuid()) 取用户名与主目录。Windows 的 os 没有
getuid(),由 winpatch.py 补上;本模块提供记录结构。
"""

import getpass
import os


class _Pw:
    def __init__(self):
        self.pw_name = getpass.getuser() or "user"
        self.pw_dir = os.path.expanduser("~")
        self.pw_gecos = self.pw_name
        self.pw_uid = 0
        self.pw_gid = 0


def getpwuid(uid):
    return _Pw()


def getpwnam(name):
    return _Pw()


def getuid():
    return 0
