FROM debian:bookworm-slim AS capture-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libx11-dev \
    libxdamage-dev \
    libxext-dev \
    libxfixes-dev \
    libxtst-dev \
    libpng-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY xcapture.c .
RUN cc -O3 -fPIC -shared -Wall -Wextra -Werror -o librakazo-xcapture.so xcapture.c \
    -lX11 -lXext -lXdamage -lXfixes -lXtst -lpng

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    fluxbox \
    xterm \
    xdotool \
    x11-utils \
    x11-xserver-utils \
    imagemagick \
    novnc \
    websockify \
    python3 \
    ca-certificates \
    procps \
    bash \
    chromium \
    fonts-liberation \
    fonts-dejavu-core \
    dbus-x11 \
    xdg-utils \
    git \
    curl \
    openssh-client \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 1000 rakazo \
  && useradd --uid 1000 --gid rakazo --create-home --shell /bin/bash rakazo \
  && mkdir -p /etc/rakazo/fluxbox \
  && printf '%s\n' '#!/bin/sh' 'exec xsetroot -solid "#111113" "$@"' > /usr/bin/fbsetbg \
  && chmod +x /usr/bin/fbsetbg \
  && ln -sfn /bin/true /usr/bin/xmessage
ENV DISPLAY=:1
ENV HOME=/home/rakazo
# Coding agents, installed system-wide so they survive the per-bot /home/rakazo bind
# mount. Each bot signs in once from its own home (~/.claude, ~/.codex, ~/.config/cursor).
# Node 22 for the npm-distributed CLIs; the Cursor CLI ships as a tarball that its
# installer unpacks under $HOME, so run it with a build-time HOME and symlink the binary.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g --no-fund --no-audit @anthropic-ai/claude-code @openai/codex \
  && npm cache clean --force \
  && mkdir -p /opt/cursor \
  && HOME=/opt/cursor bash -c "curl -fsSL https://cursor.com/install | bash" \
  && ln -sfn "$(ls -d /opt/cursor/.local/share/cursor-agent/versions/*/ | head -1)cursor-agent" /usr/local/bin/cursor-agent \
  && ln -sfn /usr/local/bin/cursor-agent /usr/local/bin/agent \
  && chmod -R a+rX /opt/cursor \
  && claude --version && codex --version && cursor-agent --version
WORKDIR /home/rakazo
# --chmod normalizes modes: a restrictive host umask (e.g. 077 on hardened hosts) would
# otherwise leave these files unreadable to USER 1000 at runtime.
COPY --chmod=755 start.sh /usr/local/bin/rakazo-computer
COPY --chmod=755 control.py /usr/local/bin/rakazo-computer-control
COPY --from=capture-builder /build/librakazo-xcapture.so /usr/local/lib/librakazo-xcapture.so
COPY --chmod=755 rakazo-browser /usr/local/bin/rakazo-browser
COPY --chmod=644 rakazo-browser.desktop /usr/share/applications/rakazo-browser.desktop
COPY --chmod=644 fluxbox.init /etc/rakazo/fluxbox/init
COPY --chmod=644 fluxbox.apps /etc/rakazo/fluxbox/apps
COPY --chmod=644 fluxbox.menu /etc/rakazo/fluxbox/menu
COPY --chmod=644 embed.html /usr/share/novnc/embed.html
COPY --chmod=644 clipboard-bridge.js /usr/share/novnc/clipboard-bridge.js
# Strip CR so shebangs work even if the build context came from a CRLF checkout.
RUN ldconfig \
  && sed -i 's/\r$//' /usr/local/bin/rakazo-computer /usr/local/bin/rakazo-computer-control /usr/local/bin/rakazo-browser \
    /etc/rakazo/fluxbox/init /etc/rakazo/fluxbox/apps /etc/rakazo/fluxbox/menu
EXPOSE 7070 6080 6081 6082 6083 6084 6085 6086 6087 6088 6089 6090 6091 6092 6093 6094 6095
USER 1000:1000
CMD ["/usr/local/bin/rakazo-computer"]
