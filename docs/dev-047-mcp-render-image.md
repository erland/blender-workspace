# DEV-047 – Inspect existing render images through MCP

The read-only `workspace_get_render_image(renderJobId)` tool returns the
**actual original PNG pixels** as an MCP `image` content block, alongside
a small metadata text block. It does not provide a public, token-bearing
URL; the calling MCP client receives base64 image data with MIME type
`image/png`.

It works for both ordinary on-demand renders and inline DEV-045/046 renders,
which are now registered in the same `bw_render_jobs` table and stored
in the same `RenderArtifactStore`.

## Security and limits

- Requires `workspace:read` and current caller ownership. The render must
  have `completed` status and stored SHA-256/length.
- Uses the existing owner-filtered render query, followed by
  `RenderArtifactStore.verifiedPath` to reject missing, changed or tampered
  artifacts. No new filesystem traversal or network fetch.
- Additional exact PNG IHDR dimensions and signature check.
- This direct-image tool accepts only renders up to **1024 × 1024** and
  **4 MiB**; larger images remain available through the existing
  authenticated web gallery. It deliberately does not start another worker
  to resize images.
- No Blender process, additional Modal billing, job state change or
  other write effect. No private bearer or browser session credentials are
  included in the result.

## Acceptance

Unit tests and real MCP HTTP/SSE transport tests cover image block, byte
identity, scope/owner isolation, failed/pending renders, oversize metadata,
missing credentials and invalid checksum. CI needs no Modal.

The MCP protocol supports image content blocks, but whether a particular
ChatGPT client exposes this image to the visual analysis model requires
**live client acceptance**. After deployment, run the tool on an existing
DEV-045 test render and verify that the assistant can describe actual
pixels (hair visibility and camera framing), rather than merely reporting
that a PNG exists.
