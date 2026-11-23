import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from modal_provider.resource_transfer import validated_resources, transfer_resources


class ResourceTransferTests(unittest.TestCase):
    def test_validates_known_resource_and_exact_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            texture=root/'texture.png'
            texture.write_bytes(b'png test bytes' * 12)
            data=texture.read_bytes()
            checksum=hashlib.sha256(data).hexdigest()
            manifest=root/'resources.json'
            entry={'name':'resources/'+checksum+'.png',
                   'path':str(texture),'sha256':checksum,'sizeBytes':len(data)}
            manifest.write_text(json.dumps([entry]))
            result=validated_resources(str(manifest))
            self.assertEqual(result,[('resources/'+checksum+'.png',texture)])
            texture.write_bytes(b'changed')
            with self.assertRaises(ValueError):
                validated_resources(str(manifest))

    def test_prevents_path_escape_and_duplicate_logical_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            texture=root/'texture.png'
            texture.write_bytes(b'good texture bytes'*2)
            data=texture.read_bytes()
            checksum=hashlib.sha256(data).hexdigest()
            base={'name':'resources/'+checksum+'.png',
                  'path':str(texture),'sha256':checksum,'sizeBytes':len(data)}
            manifest=root/'manifest.json'
            for name in ('../private.png','resources/../evil.png',
                         'resources/../../evil.png','/etc/passwd',
                         'resources/evil\\file.png','resources/test.png/next'):
                manifest.write_text(json.dumps([{**base,'name':name}]))
                with self.subTest(name=name),self.assertRaises(ValueError):
                    validated_resources(str(manifest))
            manifest.write_text(json.dumps([base,base]))
            with self.assertRaises(ValueError):
                validated_resources(str(manifest))

    def test_transfer_creates_sandbox_directory_and_copies_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'one.png'
            source.write_bytes(b'x'*80)
            class Exec:
                def wait(self): return 0
            class FS:
                def __init__(self): self.copies=[]
                def copy_from_local(self,src,dst): self.copies.append((src,dst))
            class Sandbox:
                def __init__(self): self.filesystem=FS();self.commands=[]
                def exec(self,*args): self.commands.append(args);return Exec()
            fake=Sandbox()
            transfer_resources(fake,[('resources/one.png',source)])
            self.assertEqual(fake.commands,[('mkdir','-p','/workspace/out/resources')])
            self.assertEqual(fake.filesystem.copies,[(str(source),'/workspace/out/resources/one.png')])


if __name__ == '__main__':
    unittest.main()
