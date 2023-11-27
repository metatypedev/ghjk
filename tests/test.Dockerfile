FROM docker.io/denoland/deno:debian-1.38.0

RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt update; \
    apt install --yes \
    git curl xz-utils unzip \
    ;\
    apt clean autoclean; apt autoremove --yes; rm -rf /var/lib/{apt,dpkg,cache,log}/;

ENV SHELL=/bin/bash

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

SHELL [ "/bin/bash", "-c"] 

RUN <<EOT 
    source ~/.bashrc
    init_ghjk
    ghjk sync
EOT

CMD ['false']
