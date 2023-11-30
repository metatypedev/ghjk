FROM docker.io/denoland/deno:debian-1.38.0

RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt update; \
    apt install --yes \
    git curl xz-utils unzip \
    ;\
    apt clean autoclean; apt autoremove --yes; rm -rf /var/lib/{apt,dpkg,cache,log}/;

# activate ghjk for each bash shell
ENV BASH_ENV=/root/.local/share/ghjk/hooks/hook.sh
# explicitly set the shell var as detection fails otherwise
# because ps program is not present in this image
ENV SHELL=/bin/bash
# BASH_ENV behavior is only avail in bash, not sh
SHELL [ "/bin/bash", "-c"] 

WORKDIR /ghjk

COPY deno.lock ./
COPY deps/* ./deps/
RUN deno cache deps/*
COPY . ./
RUN deno run -A /ghjk/install.ts

WORKDIR /app

RUN cat > ghjk.ts <<EOT
#{{CMD_ADD_CONFIG}}
EOT

RUN ghjk sync

CMD ['false']
