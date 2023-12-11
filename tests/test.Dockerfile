ARG DENO_V=1.38.4

FROM docker.io/denoland/deno:debian-${DENO_V}

ARG FISH_V=3.6.0-3.1
ARG ZSH_V=5.9-4+b2
ARG GIT_V=1:2.39.2-1.1
ARG CURL_V=7.88.1-10+deb12u4
ARG XZ_V=5.4.1-0.2
ARG UNZIP_V=6.0-28

RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt update; \
    apt install --yes --no-install-recommends \
    # test deps
    fish=$FISH_V \
    zsh=$ZSH_V \
    # asdf deps
    git=$GIT_V \
    curl=$CURL_V \
    xz-utils=$XZ_V \
    unzip=$UNZIP_V \
    ca-certificates \
    ;\
    apt clean autoclean; apt autoremove --yes; rm -rf /var/lib/{apt,dpkg,cache,log}/;

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
    ghjk config
    ghjk ports sync
EOT

# activate ghjk non-interactive shells execs
ENV BASH_ENV=/root/.local/share/ghjk/env.sh
ENV ZDOTDIR=/root/.local/share/ghjk/

# BASH_ENV behavior is only avail in bash, not sh
SHELL [ "/bin/bash", "-c"] 

CMD ['false']
