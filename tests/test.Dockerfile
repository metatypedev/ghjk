ARG DENO_VERSION=1.44.2

FROM denoland/deno:bin-$DENO_VERSION AS deno

FROM docker.io/library/debian:12-slim

COPY --from=deno /deno /usr/local/bin/deno
RUN set -eux; \
    apt-get update; \
    apt install --no-install-recommends --assume-yes \
    # ambient deps \
    # TODO: explicit libarchive \
    zstd \
    tar \
    # TODO: explicit cc \
    build-essential \
    # test deps \
    bash \
    fish \
    zsh \
    # asdf deps \
    git \
    curl \
    xz-utils \
    unzip \
    ca-certificates \
    ;

WORKDIR /ghjk

ENV DENO_DIR=/deno-dir

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
