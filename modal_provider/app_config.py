"""Shared Modal app name for all owner-billed Blender Sandbox jobs.

This is a Modal App name within the owner's Modal workspace, not a workspace
rename. Validate before any billable SDK call; never echo arbitrary settings.
"""
import os
import re

DEFAULT_MODAL_APP_NAME = "blender-workspace"
_APP_NAME = re.compile(r"^[a-z][a-z0-9-]{0,62}[a-z0-9]$")


def modal_app_name(value=None):
    name = value if value is not None else os.environ.get(
        "MODAL_APP_NAME", DEFAULT_MODAL_APP_NAME
    )
    if not isinstance(name, str) or not _APP_NAME.fullmatch(name):
        raise ValueError("MODAL_APP_NAME must be a lowercase app name with 2-64 letters, digits or hyphens")
    return name
