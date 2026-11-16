FROM debian:bookworm-slim
ARG BLENDER_VERSION=5.2.4
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils python3 libx11-6 libxxf86vm1 libxfixes3 libxi6 libxrender1 libxkbcommon0 libsm6 libice6 libglib2.0-0 libgl1 libegl1 libopengl0 libdbus-1-3 libfontconfig1 libfreetype6 libxext6 libxrandr2 && rm -rf /var/lib/apt/lists/*
RUN (curl -fL --retry 4 --retry-all-errors --retry-delay 2 "https://mirror.blender.org/release/Blender5.2/blender-${BLENDER_VERSION}-linux-x64.tar.xz" -o /tmp/blender.tar.xz \
    || curl -fL --retry 4 --retry-all-errors --retry-delay 2 "https://download.blender.org/release/Blender5.2/blender-${BLENDER_VERSION}-linux-x64.tar.xz" -o /tmp/blender.tar.xz) \
    && mkdir -p /opt/blender && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 && rm /tmp/blender.tar.xz
ENV PATH="/opt/blender:${PATH}" BLENDER_USER_CONFIG=/tmp/blender-config PYTHONPATH=/workspace
WORKDIR /workspace
COPY blender_workspace_poc ./blender_workspace_poc
COPY tests ./tests
COPY scripts ./scripts
RUN chmod +x scripts/*.sh && useradd -m -u 10001 blender && mkdir -p /workspace/out && chown -R blender:blender /workspace
USER blender
ENTRYPOINT ["/workspace/scripts/run_smoke.sh"]
