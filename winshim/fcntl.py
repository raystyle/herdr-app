"""Windows 下 fcntl 的替代实现(经 msvcrt 锁定)。

herdr-secret 等 Python 工具用 fcntl.flock 做协作式文件锁。Windows 上把
flock 映射到 msvcrt.locking:锁文件开头的一个字节(所有锁都经过本模块,
在字节 0 上互斥即可)。只用 LOCK_EX / LOCK_UN / LOCK_SH 这几个常量。

把这个目录放到 PYTHONPATH 即可生效(.cmd 启动器已自动设置)。
"""

import msvcrt
import os


LOCK_SH = 1   # 对应 msvcrt.LK_LOCK(阻塞式)
LOCK_EX = 2   # 对应 msvcrt.LK_LOCK(阻塞式)
LOCK_NB = 4   # 非阻塞标志,按位或
LOCK_UN = 8   # 解锁


def _size(fd):
    try:
        return os.fstat(fd).st_size
    except OSError:
        return 0


def flock(fileobj_or_fd, op):
    op = int(op)
    fd = fileobj_or_fd if isinstance(fileobj_or_fd, int) else fileobj_or_fd.fileno()
    if op & LOCK_UN:
        try:
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        except OSError:
            pass  # already unlocked: matching fcntl's leniency on LOCK_UN
        return
    mode = msvcrt.LK_NBLCK if op & LOCK_NB else msvcrt.LK_LOCK
    # Lock the first byte (enough for cooperative locks: every Shepherdr
    # lock goes through this same shim, so they contend on byte 0).
    # msvcrt locks from the current file position: go to 0 first.
    import os as _os
    pos = _os.lseek(fd, 0, _os.SEEK_CUR)
    try:
        _os.lseek(fd, 0, _os.SEEK_SET)
        msvcrt.locking(fd, mode, 1)
    finally:
        _os.lseek(fd, pos, _os.SEEK_SET)



