#!/usr/bin/env python3
"""Verify that MCP scene authoring has a single Python entrypoint.

This static contract intentionally does not claim that legacy implementation
has been removed; it prevents an accidental re-exposure while cleanup proceeds.
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
MCP = ROOT / 'service/src/mcp/project-tools.ts'
SCHEMA = ROOT / 'service/src/jobs/python-script.ts'
EXPECTED = 'workspace_queue_python_script'
RETIRED = (
    'workspace_queue_scene_operation', 'workspace_queue_scene_edit',
    'workspace_queue_demo', 'workspace_queue_recolor_blue',
)


def audit(root=ROOT):
    errors = []
    mcp = (root / MCP.relative_to(ROOT)).read_text(encoding='utf-8')
    python_schema = (root / SCHEMA.relative_to(ROOT)).read_text(encoding='utf-8')
    tools = re.findall(r"server\.registerTool\(\s*['\"]([^'\"]+)['\"]", mcp)
    # Render and GLB refresh requests create derived assets, never scene-editing writers.
    writers = [name for name in tools if name.startswith('workspace_queue_')
               and name not in ('workspace_queue_render', 'workspace_queue_glb_preview_refresh')]
    if 'workspace_queue_render' in tools and 'workspace_queue_python_script' not in tools:
        errors.append('Rendering must not replace Python scene authoring')
    if writers != [EXPECTED]:
        errors.append(f'Expected exactly one Python writer; got {writers!r}')
    for name in RETIRED:
        if name in tools:
            errors.append(f'Retired MCP writer was registered: {name}')
    if "PythonScriptSchema.shape.code" not in mcp:
        errors.append('Python write tool must validate with PythonScriptSchema')
    if 'verifiedArtifactPath(projectId,expectedRevision' not in mcp:
        errors.append('Python edit must verify the saved predecessor')
    if "Buffer.byteLength(x,'utf8')<=65_536" not in python_schema:
        errors.append('Expected UTF-8 byte limit on Python source')
    return errors


if __name__ == '__main__':
    violations = audit()
    for violation in violations:
        print('FAIL:', violation, file=sys.stderr)
    if violations:
        raise SystemExit(1)
    print('PASS: Python is the only MCP scene authoring tool; owner/revision checks retained')
