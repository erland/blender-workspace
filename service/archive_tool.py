#!/usr/bin/env python3
"""Strict portable archive codec; no arbitrary code or Blender execution."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import zipfile

MAX_TOTAL = 128 * 1024 * 1024
MAX_FILES = 1200
MAX_FILE = 64 * 1024 * 1024
PATTERN = re.compile(r"^revisions/([0-9]{8})/([a-zA-Z0-9][a-zA-Z0-9_-]{0,80}\.(?:blend|glb|json))$")
UUID = re.compile(r"^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")
SHA = re.compile(r"^[0-9a-f]{64}$")


def validate_metadata(data):
    if not isinstance(data, dict) or data.get("formatVersion") != 1:
        raise ValueError("Unsupported archive version")
    p = data.get("project")
    revisions = data.get("revisions")
    if not isinstance(p, dict) or not isinstance(revisions, list) or len(revisions) > 99:
        raise ValueError("Invalid project metadata")
    if not UUID.fullmatch(str(p.get("originalId", ""))):
        raise ValueError("Invalid original project ID")
    if not isinstance(p.get("name"), str) or not 1 <= len(p["name"].strip()) <= 200:
        raise ValueError("Invalid project name")
    if not isinstance(p.get("description"), str) or len(p["description"]) > 5000:
        raise ValueError("Invalid project description")
    if p.get("currentRevision") != len(revisions):
        raise ValueError("Invalid revision count")
    paths = {}
    for index, r in enumerate(revisions, 1):
        if not isinstance(r, dict) or r.get("revision") != index:
            raise ValueError("Revision sequence must be contiguous")
        if not isinstance(r.get("note"), str) or len(r["note"]) > 5000:
            raise ValueError("Invalid revision note")
        if not isinstance(r.get("createdAt"), str) or len(r["createdAt"]) > 60:
            raise ValueError("Invalid revision timestamp")
        files = r.get("artifacts")
        if not isinstance(files, list) or not 1 <= len(files) <= 12:
            raise ValueError("Invalid artifact count")
        for file in files:
            if not isinstance(file, dict):
                raise ValueError("Invalid artifact entry")
            name, length, digest = file.get("name"), file.get("sizeBytes"), file.get("sha256")
            prefix = f"revisions/{index:08d}/"
            if not isinstance(name, str) or not PATTERN.fullmatch(prefix + name):
                raise ValueError("Invalid artifact filename")
            if type(length) is not int or not 1 <= length <= MAX_FILE:
                raise ValueError("Invalid artifact length")
            if not isinstance(digest, str) or not SHA.fullmatch(digest):
                raise ValueError("Invalid artifact digest")
            full = prefix + name
            if full in paths:
                raise ValueError("Duplicate artifact")
            paths[full] = file
    if len(paths) > MAX_FILES or sum(f["sizeBytes"] for f in paths.values()) > MAX_TOTAL:
        raise ValueError("Archive exceeds resource limits")
    return paths


def copy_with_hash(source, target, expected):
    digest = hashlib.sha256()
    written = 0
    while True:
        chunk = source.read(1024 * 1024)
        if not chunk:
            break
        written += len(chunk)
        if written > expected["sizeBytes"]:
            raise ValueError("Artifact larger than advertised")
        digest.update(chunk)
        target.write(chunk)
    if written != expected["sizeBytes"] or digest.hexdigest() != expected["sha256"]:
        raise ValueError("Artifact checksum or length mismatch")


def export_zip(meta_path, project_dir, output_zip):
    data = json.loads(Path(meta_path).read_text(encoding="utf-8"))
    paths = validate_metadata(data)
    with zipfile.ZipFile(output_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=5,
                         allowZip64=True) as out:
        out.writestr("project.json", json.dumps(data, ensure_ascii=False, separators=(",", ":")))
        for entry, expected in paths.items():
            source = Path(project_dir) / entry.removeprefix("revisions/")
            info = source.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_size != expected["sizeBytes"]:
                raise ValueError("Unsafe or changed artifact")
            # A custom destination prevents loading complete models into RAM.
            with source.open("rb") as inp, out.open(entry, "w", force_zip64=True) as dest:
                copy_with_hash(inp, dest, expected)


def import_zip(input_zip, output_dir):
    archive = Path(input_zip)
    if archive.stat().st_size > MAX_TOTAL:
        raise ValueError("Compressed archive is too large")
    with zipfile.ZipFile(archive, "r") as inp:
        entries = inp.infolist()
        if len(entries) > MAX_FILES + 1:
            raise ValueError("Too many archive entries")
        names = [v.filename for v in entries]
        if len(names) != len(set(names)) or "project.json" not in names:
            raise ValueError("Duplicate or missing metadata entries")
        for info in entries:
            if info.is_dir() or info.flag_bits & 1 or info.file_size > MAX_FILE:
                raise ValueError("Invalid entry type or size")
            if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError("Unsupported compression")
            # External UNIX symlinks and other special files are disallowed.
            mode = (info.external_attr >> 16) & 0o170000
            if mode not in (0, stat.S_IFREG):
                raise ValueError("Archive contains unsafe file types")
            if info.file_size and info.file_size > max(1, info.compress_size) * 300:
                raise ValueError("Suspicious compression ratio")
        meta_info = inp.getinfo("project.json")
        if meta_info.file_size > 2 * 1024 * 1024:
            raise ValueError("Metadata too large")
        data = json.loads(inp.read(meta_info).decode("utf-8"))
        paths = validate_metadata(data)
        if set(names) != set(paths) | {"project.json"}:
            raise ValueError("Unexpected or missing archive entries")
        if sum(info.file_size for info in entries) > MAX_TOTAL:
            raise ValueError("Expanded archive too large")
        for name, expected in paths.items():
            info = inp.getinfo(name)
            if info.file_size != expected["sizeBytes"]:
                raise ValueError("Artifact byte length mismatch")
            # Never extract using arbitrary ZIP entry names.
            target = Path(output_dir) / name.removeprefix("revisions/")
            target.parent.mkdir(parents=True, exist_ok=True)
            with inp.open(info, "r") as source, target.open("xb") as dest:
                copy_with_hash(source, dest, expected)
        Path(output_dir, "project.json").write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    try:
        if len(sys.argv) != 5:
            raise ValueError("Usage: archive_tool.py [export|import] metadata_or_zip project_dir output")
        if sys.argv[1] == "export":
            export_zip(sys.argv[2], sys.argv[3], sys.argv[4])
        elif sys.argv[1] == "import":
            # The fourth argument is a required output directory in import mode.
            import_zip(sys.argv[2], sys.argv[4])
        else:
            raise ValueError("Invalid mode")
    except Exception:
        # Do not return exception text, paths, or metadata that may be sensitive.
        print("Archive validation or transfer failed", file=sys.stderr)
        sys.exit(1)
