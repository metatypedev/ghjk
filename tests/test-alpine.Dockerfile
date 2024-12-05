ARG DENO_VERSION=2.1.2

FROM docker.io/denoland/deno:alpine-${DENO_VERSION}

ARG BASH_V=5.2.21-r0
ARG FISH_V=3.6.3-r0
ARG ZSH_V=5.9-r2
ARG GIT_V=2.43.0-r0
ARG CURL_V=8.5.0-r0
ARG XZ_V=5.4.5-r0
ARG GTAR_V=1.35-r2
ARG UNZIP_V=6.0-r14
ARG ZSTD_V=1.5.5-r8
ARG GCOMPAT_V=1.1.0-r4
ARG BUILD_BASE_V=0.5-r3

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
    build-base=$BUILD_BASE_V \
    # gcompat=$GCOMPAT_V \
    ca-certificates \
    ;

WORKDIR /ghjk

COPY deno.lock deno.jsonc ./
COPY deps/* ./deps/
RUN deno task cache

COPY . ./

RUN ln -s ./main.ts /bin/ghjk

WORKDIR /app

ENV GHJK_LOG=info
ENV GHJK_INSTALL_EXE_DIR=/usr/bin
ENV GHJK_INSTALL_HOOK_SHELLS=fish,bash,zsh 
# share the module cache of the image
ENV GHJK_INSTALL_DENO_DIR=$DENO_DIR
RUN deno run -A /ghjk/install.ts

ARG GITHUB_TOKEN
ENV GITHUB_TOKEN=$GITHUB_TOKEN

# avoid variable expansion in the contents of the
# here-document by quoting the tag
COPY <<"EOT" /app/ghjk.ts 
#{{CMD_ADD_CONFIG}}
EOT

RUN <<EOT
    set -eux
    cat $(which ghjk)
    export CLICOLOR_FORCE=1 
    ghjk print config
    ghjk envs cook
EOT

# activate ghjk non-interactive shells execs
ENV BASH_ENV=/root/.local/share/ghjk/env.bash
ENV ZDOTDIR=/root/.local/share/ghjk/

# BASH_ENV behavior is only avail in bash, not sh
SHELL [ "/bin/bash", "-c"] 

CMD ['false']
