# DEV-054 – ChatGPT native MCP file upload for textures

## Source pattern

Implemented after inspecting the user-supplied Agent Workspace ZIP:
`src/mcp/schemas.ts`, `src/mcp/archive-source.ts`,
`src/mcp/server.ts` and `src/mcp/tool-service.ts`.

Agent Workspace accepts an MCP native file value (`file_id`,
`download_url`, optionally `mime_type` and `file_name`). The server
follows bounded, manually validated HTTPS downloads; a Base64 form is
available as a portability fallback. Unlike Base64 transport, the actual
binary file need not be sent inside the MCP JSON tool call.

## Blender Workspace workflow

Call `workspace_upload_texture` with:

```json
{
  "file": {
    "file_id": "<from MCP host>",
    "download_url": "https://<temporary-public-file-host>/<signed-path>",
    "file_name": "dinosaur-skin.png",
    "mime_type": "image/png"
  }
}
```

These example strings are placeholders – the MCP host must provide the
actual native file parameter. Do not paste signed URLs into source code,
logs, or public chat. The server downloads the bytes in one bounded
HTTPS request, validates the image using the existing DEV-053 image
validator, stores it in the owner-private upload library, and returns
`uploadId`, filename, type and size.

Then use `workspace_queue_python_script` with a separate, explicitly
approved model revision and:

```json
{"assetSources":[{"uploadId":"<returned-uuid>",
  "texture":{"objectName":"Body","channel":"baseColor"}}]}
```

Supported channels: `baseColor`, `roughness`, `metallic`, `normal`.
The Blender Sandbox binds and packs the texture in a new native BLEND.

### Small-client fallback

When the MCP host cannot supply a native file parameter, clients may
send `textureBase64` and `filename` instead. This fallback is capped
at 240,000 characters (approximately 180 KiB), deliberately respecting
the service's existing 256 KiB MCP JSON request limit. **Use the native
file parameter for larger files**, up to the existing 32 MiB per-file
upload limit.

### Transport/security boundaries

- Authenticated MCP WRITE scope; owner identity is resolved from the
  validated principal and never specified in the tool arguments.
- Separate server-side HTTPS fetch; 30s timeout per request, 3 redirects
  maximum, public DNS checks for every redirect, no private IP/localhost,
  no credentials in URL.
- Streaming response bounded to 32 MiB even if the remote host lies
  about Content-Length; no partial upload on oversized response.
- Existing image format/signature/dimension checks and owner quotas
  apply to native and Base64 uploads equally.
- No URL, authorization token, local path or upstream error body is
  returned to clients or persisted as artifact metadata.
- Uploading never starts a paid Blender/Modal job; the separate
  revision tool is the billable action.

DNS-only private-address filtering mirrors the Agent Workspace transport;
it is not a complete defense against DNS rebinding in every deployment.
To harden further, network-layer egress restrictions or a downloader
that pins validated resolved addresses should be used.

## Verification

`service/__tests__/mcp-native-texture-file.test.mjs` covers native binary
stream, redirect validation, address and size restrictions, and Base64
fallback. `service/__tests__/mcp-texture-tool.test.mjs` calls the MCP tool
over the authenticated HTTP transport and verifies owner-private storage
and no Modal reservation.
