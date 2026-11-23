"""Internal pre-Modal validation and upload of revision-bound resource files.

Never trust a public hash alone. The Node orchestrator has already resolved
these descriptors from an immutable, owned revision. The controller still
rechecks every byte before billing and transfers only safe paths.
"""
import hashlib
import json
import re
from pathlib import Path

HASH = re.compile(r'^[0-9a-f]{64}$')
SEGMENT = re.compile(r'^[A-Za-z0-9_-]{1,80}$')
EXTENSION = re.compile(r'^[A-Za-z0-9]{1,12}$')
MAX_COUNT = 128
MAX_SIZE = 256 * 1024 * 1024
MAX_TOTAL = 1024 * 1024 * 1024


def validated_resources(manifest_filename):
    if not manifest_filename:
        return []
    file = Path(manifest_filename)
    if file.is_symlink() or not file.is_file() or file.stat().st_size > 65536:
        raise ValueError('Invalid resource manifest')
    entries = json.loads(file.read_text(encoding='utf8'))
    if not isinstance(entries, list) or len(entries) > MAX_COUNT:
        raise ValueError('Invalid resource entries')
    selected = []
    names = set()
    total = 0
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {'name', 'path', 'sha256', 'sizeBytes'}:
            raise ValueError('Invalid resource entry')
        name, raw_path, checksum, size = (
            entry['name'], entry['path'], entry['sha256'], entry['sizeBytes'])
        if not isinstance(name, str) or len(name) > 220 or chr(92) in name:
            raise ValueError('Invalid logical name')
        parts = name.split('/')
        if (len(parts) not in (2, 3, 4) or parts[0] != 'resources' or
                any(not SEGMENT.fullmatch(p) for p in parts[1:-1]) or
                '.' not in parts[-1]):
            raise ValueError('Invalid logical name')
        stem, extension = parts[-1].rsplit('.', 1)
        if not SEGMENT.fullmatch(stem) or not EXTENSION.fullmatch(extension):
            raise ValueError('Invalid logical name')
        if name.lower() in names:
            raise ValueError('Duplicate resource path')
        names.add(name.lower())
        if (not isinstance(raw_path, str) or not Path(raw_path).is_absolute() or
                not isinstance(checksum, str) or not HASH.fullmatch(checksum) or
                type(size) is not int or not 1 <= size <= MAX_SIZE):
            raise ValueError('Invalid resource descriptor')
        source = Path(raw_path)
        if source.is_symlink() or not source.is_file() or source.stat().st_size != size:
            raise ValueError('Missing resource')
        digest = hashlib.sha256()
        with source.open('rb') as reader:
            for chunk in iter(lambda: reader.read(1024 * 1024), b''):
                digest.update(chunk)
        if digest.hexdigest() != checksum:
            raise ValueError('Resource checksum mismatch')
        total += size
        if total > MAX_TOTAL:
            raise ValueError('Resource budget exceeded')
        selected.append((name, source))
    return selected


def transfer_resources(sandbox, resources):
    for name, source in resources:
        destination = '/workspace/out/' + name
        # The sandbox starts with /workspace/out and no existing 'resources'.
        # Files are transferred using safe fixed relative destination names.
        sandbox.filesystem.copy_from_local(str(source), destination)
