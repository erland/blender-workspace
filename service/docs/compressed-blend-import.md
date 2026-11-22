# Compressed native BLEND uploads

## Reproduction (iPad / Chrome / Safari)

The user-provided `hair_nodes-animal_fur_examples(1).blend` is **2.60 MiB**
and starts with bytes `28 B5 2F FD`, the Zstandard frame magic.
Decompressing locally with `zstd -dc` reveals `BLENDER-v305`;
`zstd -t` verifies the compression stream. The decompressed file is
approximately 13.2 MiB. This is a valid Blender-native compressed file,
not a GLB and not a ZIP.

The previous browser uploader accepted the filename/size but the server
rejected the file because `validateUpload` required the literal
`BLENDER` header. The trusted Modal controller also rejected the same
compressed magic when a source asset was staged.

## Correction

- Accept normal uncompressed BLEND magic **or** Zstandard frame magic
  for `.blend` uploads. Preserve the 32 MiB compressed-file limit,
  filename/owner protections and SHA-256 verification.
- Accept the same magic in the Modal controller's trusted source-file
  preflight. Blender itself loads/decompresses the source inside the
  network-blocked, resource-limited Sandbox.
- **Do not decompress arbitrary untrusted BLEND files in the web service**.
  A Zstandard magic prefix is a lightweight format hint, not proof of a
  healthy Blender scene. Malformed/unsupported compressed data is rejected
  by Blender when the owner explicitly authorizes the import job.
- Return a bounded validation-error code from the server. The upload
  browser script translates it into actionable Swedish feedback without
  exposing server exceptions or credentials.

## Acceptance

After deployment, upload the previously failing file via iPad Files and
confirm it appears in the list of saved models **without starting Modal**.
Then, if authorized, import to a new scene using the existing explicit paid
import action; inspect curves/materials via scene tools. No paid acceptance
test is part of this PR.
