"""Static guards for the supported Blender Python-first worker."""
import ast
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class StaticTests(unittest.TestCase):
    def test_python_syntax(self):
        for path in list((ROOT / 'blender_workspace_poc').glob('*.py')) + list((ROOT / 'tests').glob('*.py')):
            ast.parse(path.read_text(), filename=str(path))

    def test_pinned_blender_image(self):
        docker = (ROOT / 'Dockerfile').read_text()
        self.assertIn('BLENDER_VERSION=5.2.4', docker)

    def test_default_smoke_and_worker_are_python_first(self):
        script = (ROOT / 'scripts/run_smoke.sh').read_text()
        self.assertIn('apply_python.py', script)
        self.assertIn('BW_PYTHON_FIRST_SMOKE PASS', script)
        self.assertNotIn('create_monster.py', script)
        self.assertNotIn('revise_monster.py', script)
        self.assertNotIn('apply_operation.py', script)
        worker = (ROOT / 'blender_workspace_poc/apply_python.py').read_text()
        self.assertIn('BW_SANDBOX_PYTHON PASS', worker)
        self.assertIn('use_scripts=False', worker)

    def test_deleted_typed_workers_cannot_reappear(self):
        for name in ('create_monster.py','revise_monster.py','apply_operation.py',
                     'edit_scene.py','scene_operation_validation.py','scene_edit_validation.py'):
            self.assertFalse((ROOT / 'blender_workspace_poc' / name).exists(), name)


if __name__ == '__main__':
    unittest.main()
