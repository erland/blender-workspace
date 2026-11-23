# DEV-053 – Uploaded image textures in Blender Workspace

The owner-private uploaded asset library supports **PNG and JPEG** alongside
BLEND and GLB, with the existing 32 MiB per-file, 50 file, 512 MiB per-owner
limits. The API validates filename, file magic and conservative image dimensions
(up to 8192 pixels per side, max 16 million pixels) before storing bytes. This
does not replace Blender's image decoder; corrupt or unsupported images are
rejected by Blender inside the isolated Sandbox.

## Browser workflow

1. **Importera 3D-modell**: upload a PNG, JPG or JPEG image. This does not
   start a Modal job.
2. Under **Använd bildtextur på en modell**, select the uploaded image, an
   existing project, exact mesh-object name and PBR channel: Base Color,
   Roughness, Metallic or Normal.
3. Explicitly consent to **one owner-billed modeling job**, producing a new
   immutable revision based on the selected project's latest scene.

The job attaches the image to the target mesh's material (copying a shared
material to avoid modifying unrelated meshes) and links it into the Principled
BSDF node graph. Non-color maps use Non-Color space; Normal uses a Normal Map
node. The image is packed by the existing resource-packing step before the
new native `scene.blend` is saved. The GLB export remains best-effort and does
not promise high fidelity for advanced Blender materials.

## ChatGPT/MCP workflow

The existing `workspace_queue_python_script` tool accepts a texture asset
source in the same `assetSources` list as BLEND/GLB models:

```json
{
  "uploadId": "<owner-upload-uuid>",
  "texture": {"objectName": "Body", "channel": "baseColor"}
}
```

The exact asset ID must be taken from the owner's own uploaded asset listing;
do not invent one. The caller must still provide valid `projectId`,
`expectedRevision`, and modeling code. The texture assignment happens before
the custom Python script, allowing additional Blender-specific adjustments.
The format is verified when reserving and immediately before running, while
the image bytes are checksum-verified by the upload store.

## Safety and constraints

- No remote images, URLs, network access, user paths or uploaded executables.
- Owner/CSRF/origin checks for browser uploads and changes.
- Image assets cannot be accidentally used as BLEND/GLB model sources.
- Strict staging manifest + magic validation before owner-paid Modal creation.
- One target mesh and one PBR channel per texture source; up to four sources
  per job. Images are not automatically assigned to unrelated objects.
- First version requires the **exact mesh object name** from scene inspection
  and supports JPEG/PNG, not EXR or UDIM, and does not automatically UV-unwrap
  complex geometry. More advanced texture baking and UV authoring remain
  future work.
- No independent image-upload cost; creating the textured revision uses Modal.

## Verification

Node tests validate owner-scoped upload, CSRF/confirmation, image headers,
dimensions, extension spoofing and typed source references. Blender CI creates
a real PNG, assigns it to one target mesh, packs the BLEND, removes the
original image, reopens the BLEND and checks the material has a packed image.
