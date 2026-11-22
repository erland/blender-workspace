"""Bounded per-owner Modal Sandbox memory reservation (MiB)."""

DEFAULT_MEMORY_MIB=2048
ALLOWED_MEMORY_MIB=(2048,4096,8192,16384)


def validate_memory_mib(memory_mib):
    if type(memory_mib) is not int or memory_mib not in ALLOWED_MEMORY_MIB:
        raise ValueError("memory_mib must be one of 2048,4096,8192,16384")
    return memory_mib
