FROM docker.io/denoland/deno:debian-1.38.0

RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt update; \
    apt install --yes \
    # test deps
    fish zsh \
    # asdf deps
    git curl xz-utils unzip \
    ;\
    apt clean autoclean; apt autoremove --yes; rm -rf /var/lib/{apt,dpkg,cache,log}/;

WORKDIR /ghjk

COPY deno.lock ./
COPY deps/* ./deps/
RUN deno cache deps/*
COPY . ./

WORKDIR /app

# explicitly set the shell var as detection fails otherwise
# because ps program is not present in this image
RUN SHELL=/bin/bash deno run -A /ghjk/setup.ts
RUN SHELL=/bin/fish deno run -A /ghjk/setup.ts
RUN SHELL=/bin/zsh  deno run -A /ghjk/setup.ts

# activate ghjk non-interactive shells execs
ENV BASH_ENV=/root/.local/share/ghjk/hooks/hook.sh
ENV ZDOTDIR=/root/.local/share/ghjk/hooks/

# BASH_ENV behavior is only avail in bash, not sh
SHELL [ "/bin/bash", "-c"] 

RUN cat > ghjk.ts <<EOT
#{{CMD_ADD_CONFIG}}
EOT

RUN ghjk sync

CMD ['false']
