FROM docker.io/denoland/deno:debian-1.38.0

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

# # use -i interactive flag to enable sourcing .bashrc
SHELL [ "/bin/bash", "-c", "-i" ] 

# RUN ["bash", "-i", "-c", "ghjk", "sync"]
RUN <<EOT 
    ghjk sync
EOT

CMD ['false']
