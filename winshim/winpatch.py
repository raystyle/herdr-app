"""Windows 下对 os 的补充(sitecustomize 自动导入)。

给 Unix 独有的 os API 提供替代或指向调用方自己的降级路径:

- os.getuid/getgid/geteuid:返回 0(Windows 单用户)。
- os.statvfs:抛 OSError,调用方按路径逐个捕获。
- os.getloadavg:返回全零,机器繁忙的挂起判断永不触发。
- os.path.islink:把目录联接(junction)也算作链接——CPython 3.12 对
  junction 返回 False,会破坏对链接的检查。
- os.symlink:目录降级为 junction(免特权);存在的文件复制;悬空目标
  写一个占位文件(Unix 允许悬空链接,Windows 副本做不到)。
"""

import os
import shutil
import sys


def _patch():
    if sys.platform != "win32":
        return

    if not hasattr(os, "getuid"):
        os.getuid = lambda: 0
        os.getgid = lambda: 0

    if not hasattr(os, "statvfs"):
        def statvfs(path):
            raise OSError("statvfs is not available on Windows")
        os.statvfs = statvfs

    # junction 是目录链接的替代;CPython 3.12 的 islink 对它返回 False。
    _islink = os.path.islink
    if hasattr(os.path, "isjunction"):
        def islink(path):
            return _islink(path) or os.path.isjunction(path)
        os.path.islink = islink

    if not hasattr(os, "geteuid"):
        os.geteuid = lambda: 0

    if not hasattr(os, "getloadavg"):
        os.getloadavg = lambda: (0.0, 0.0, 0.0)   # Windows 无负载均值概念

    _symlink = os.symlink

    def symlink(src, dst, *a, **kw):
        try:
            return _symlink(src, dst, *a, **kw)
        except OSError:
            if os.path.isdir(src):
                import _winapi
                _winapi.CreateJunction(os.fspath(src), os.fspath(dst))
            elif os.path.lexists(src):
                shutil.copy2(src, dst)
            else:
                # A dangling link target (Unix allows this; Windows copies can't).
                # Write a tombstone: after the move completes, readers use the new
                # paths directly (LAYOUT file), and the old path only served older
                # code / other machines, which this Windows port doesn't have.
                with open(dst, "w") as f:
                    f.write("winport: placeholder for a dangling symlink to " + str(src) + "\n")

    os.symlink = symlink


_patch()
