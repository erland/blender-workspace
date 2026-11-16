"""Static checks; runtime behavior must be proven by Blender CI."""
import ast
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class StaticTests(unittest.TestCase):
    def test_python_syntax(self):
        for path in list((ROOT/'blender_workspace_poc').glob('*.py'))+list((ROOT/'tests').glob('*.py')):
            ast.parse(path.read_text(),filename=str(path))
    def test_pinned_image(self):
        docker=(ROOT/'Dockerfile').read_text()
        self.assertIn('BLENDER_VERSION=5.2.4',docker)
    def test_two_independent_processes(self):
        script=(ROOT/'scripts/run_smoke.sh').read_text()
        self.assertIn('create_monster.py',script)
        self.assertIn('revise_monster.py',script)
        self.assertIn('inspect_blend.py',script)
    def test_animation_and_export_source_contract(self):
        text=(ROOT/'blender_workspace_poc/create_monster.py').read_text()
        self.assertIn('keyframe_insert',text)
        self.assertIn('export_glb',text)
        self.assertIn('WalkCycle',text)
    def test_glb_validator_rejects_invalid_input(self):
        from tempfile import TemporaryDirectory
        from tests.verify_glb import inspect_glb
        with TemporaryDirectory() as directory:
            p=Path(directory)/'bad.glb'
            p.write_bytes(b'wrong')
            with self.assertRaises(AssertionError):inspect_glb(p)
if __name__=='__main__': unittest.main()
