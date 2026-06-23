import os


def batch_size(env_var: str, default: int) -> int:
    value = os.getenv(env_var)
    if value is None or value == '':
        return default
    return max(1, int(value))


DB_BATCH_SIZE = batch_size('DB_BATCH_SIZE', 500)
CATEGORIZE_BATCH_SIZE = batch_size('CATEGORIZE_BATCH_SIZE', 30)


def chunked(items: list, size: int):
    for index in range(0, len(items), size):
        yield items[index:index + size]
