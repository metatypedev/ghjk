{
  description = "Flake-based dev shell for ghjk with Rust, Deno, libclang, libX, JDK, and multi‑shell support";

  inputs = {
    nixpkgs.url       = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url   = "github:numtide/flake-utils";
    rust-overlay.url  = "github:oxalica/rust-overlay";
  };

  outputs = { self, nixpkgs, flake-utils, rust-overlay, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default ];
        };

        rustVersion = "1.85.0";   

        rustChannel = pkgs.rust-bin.stable.${rustVersion}.minimal.override {
          extensions = [ "rust-src" ];
        };

        ghjkDev = pkgs.writeShellScriptBin "ghjk-dev" ''
          # Use the Nix-provided deno explicitly
          exec ${pkgs.deno}/bin/deno run -A ./tools/dev.ts "$@"
        '';

        # Base shell with just the development environment setup
        baseShell = pkgs.mkShell {
          name = "ghjk-devshell-base";
          buildInputs = with pkgs; [
            rustChannel
            clang
            llvmPackages.libclang
            pkg-config
            sqlite
            deno
            bashInteractive
            zsh
            fish
            ghjkDev
          ];

          shellHook = ''
            export LIBCLANG_PATH=${pkgs.llvmPackages.libclang.lib}/lib
            export LD_LIBRARY_PATH=$LIBCLANG_PATH:${pkgs.lib.makeLibraryPath [ pkgs.pkg-config ]}
          '';
        };

      in {
        devShells = {
          # Default shell that doesn't exec into interactive shell
          default = baseShell;

          fish = baseShell.overrideAttrs (old: {
            name = "ghjk-devshell-fish";
            shellHook = old.shellHook + ''
              exec ghjk-dev fish
            '';
          });

          bash = baseShell.overrideAttrs (old: {
            name = "ghjk-devshell-bash"; 
            shellHook = old.shellHook + ''
              exec ghjk-dev bash
            '';
          });

          zsh = baseShell.overrideAttrs (old: {
            name = "ghjk-devshell-zsh";
            shellHook = old.shellHook + ''
              exec ghjk-dev zsh
            '';
          });
        };
      }
    );
}

