#!/usr/bin/env python3
"""Resolve the installed skill credential and send it to Wrangler on stdin."""
import importlib.util
import os
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
installed = Path.home() / '.codex/skills/openrouter/scripts/openrouter.py'
default = installed if installed.is_file() else root / 'scripts/openrouter_client.py'
helper = Path(os.environ.get('OPENROUTER_HELPER', default))
spec = importlib.util.spec_from_file_location('openrouter_helper', helper)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
subprocess.run([str(root / 'node_modules/.bin/wrangler'), 'secret', 'put', 'OPENROUTER_API_KEY', '--config', str(root / 'cloud/wrangler.jsonc')], input=module.api_key() + '\n', text=True, check=True, cwd=root)
