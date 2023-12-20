ARG DENO_V=1.39.0

FROM docker.io/denoland/deno:alpine-${DENO_V}

ARG BASH_V=5.2.15-r0
ARG FISH_V=3.5.1-r1
ARG ZSH_V=5.9-r0
ARG GIT_V=2.38.5-r0
ARG CURL_V=8.5.0-r0
ARG XZ_V=5.2.9-r0
ARG GTAR_V=1.34-r2
ARG UNZIP_V=6.0-r13
ARG ZSTD_V=1.5.5-r0
ARG GCOMPAT_V=1.1.0-r0

RUN set -eux; \
    apk update; \
    apk add \
    # ambient deps \
    zstd=$ZSTD_V \
    tar=$GTAR_V \
    # test deps \
    bash=$BASH_V \
    fish=$FISH_V \
    zsh=$ZSH_V \
    # asdf deps \
    git=$GIT_V \
    curl=$CURL_V \
    xz=$XZ_V \
    unzip=$UNZIP_V \
    ca-certificates \
    ;

WORKDIR /ghjk

COPY deno.lock ./
COPY deps/* ./deps/
RUN deno cache deps/*
COPY . ./
RUN ln -s ./main.ts /bin/ghjk

WORKDIR /app

ENV GHJK_INSTALL_EXE_DIR=/usr/bin
ENV GHJK_INSTALL_HOOK_SHELLS=fish,bash,zsh 
RUN deno run -A /ghjk/install.ts

RUN cat > ghjk.ts <<EOT
#{{CMD_ADD_CONFIG}}
EOT

RUN <<EOT
    export CLICOLOR_FORCE=1 
    ghjk print config
    ghjk ports sync
EOT

# activate ghjk non-interactive shells execs
ENV BASH_ENV=/root/.local/share/ghjk/env.bash
ENV ZDOTDIR=/root/.local/share/ghjk/

# BASH_ENV behavior is only avail in bash, not sh
SHELL [ "/bin/bash", "-c"] 

CMD ['false']
