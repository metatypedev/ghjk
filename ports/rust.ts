import {
  $,
  ALL_ARCH,
  ALL_OS,
  depExecShimPath,
  osXarch,
  PortBase,
  std_fs,
  zod,
} from "../src/deno_ports/mod.ts";
import type {
  DownloadArgs,
  InstallArgs,
  InstallConfigSimple,
  ListAllArgs,
} from "../src/deno_ports/mod.ts";

const rustup_rustlang_id = {
  name: "rustup_rustlang",
};

// TODO: sanity check exports of all ports
export const manifest = {
  ty: "denoWorker@v1" as const,
  name: "rust_rustup",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  buildDeps: [rustup_rustlang_id],
  // NOTE: indirectly limited by rustup instead
  platforms: osXarch([...ALL_OS], [...ALL_ARCH]),
};

const confValidator = zod.object({
  host: zod.string()
    .regex(/^[^-\s]+(-[^-\s]+){1,}?$/)
    .nullish(),
  targets: zod.string()
    .regex(/^[^-\s]+(-[^-\s]+){1,}?$/)
    .array()
    .nullish(),
  profile: zod.enum([
    "default",
    "complete",
    "minimal",
  ]).nullish(),
  components: zod.enum([
    "reproducible-artifacts",
    "cargo",
    "rustc",
    "rustc-codegen-cranelift",
    "rust-analysis",
    "rust-src",
    "rls",
    "rust",
    "llvm-tools",
    "clippy",
    "rust-docs-json",
    "rust-docs",
    "rust-mingw",
    "miri",
    "rustc-docs",
    "rustfmt",
    "rustc-dev",
    "rust-analyzer",
    "rust-std",
  ]).array().nullish(),
}).passthrough();

export type RustInstallConf =
  & InstallConfigSimple
  & zod.input<typeof confValidator>;

/**
 * Uses {@link import("./rustup.ts").conf} to install a rust toolchain.
 *
 * Defaults to the minimal profile installation of
 */
export default function conf(config: RustInstallConf = {}) {
  return {
    profile: "minimal",
    ...config,
    port: manifest,
  };
}

/*
   * <channel>[-<date>][-<host>]

      <channel>       = stable|beta|nightly|<major.minor>|<major.minor.patch>
      <date>          = YYYY-MM-DD
      <host>          = <target-triple>
  */
// const toolchainRegex =
//   /^(?:stable|beta|nightly|(?:\d+\.\d+\.\d*))(?:-\d{4}-\d{2}-\d{2})?(?:(?:-[^-\s]+){2,}?)?$/;

export class Port extends PortBase {
  // TODO: find a way to use https://rust-lang.github.io/rustup-components-history
  async listAll(_args: ListAllArgs) {
    const manifests = await $.request(
      `https://static.rust-lang.org/manifests.txt`,
    ).text();
    const versions = manifests
      .split("\n")
      .filter((str) => str.length > 0)
      .map((line) => {
        const matches = line.match(
          /dist\/(?<date>\d{4}-\d{2}-\d{2})\/channel-rust-(?<toml>.+)$/,
        )!;
        const { date, toml } = matches.groups!;
        const channel = toml.replace(".toml", "");
        if (channel == "nightly") {
          return `nightly-${date}`;
        } else if (channel.match(/beta$/)) {
          return `nightly-${date}`;
        } else if (channel == "stable") {
          return `stable-${date}`;
        }
        return channel;
      });
    // const out = [
    //   "nightly",
    //   "beta",
    //   "stable",
    // ];
    // if (args.config.version && toolchainRegex.test(args.config.version)) {
    //   out.push(args.config.version);
    // }
    return versions;
  }

  override async latestStable(args: ListAllArgs) {
    const versions = await this.listAll(args);
    // stable releases are just version numbers, no
    return versions.findLast((ver) => !ver.match(/[a-zA-Z]/))!;
  }

  override async download(args: DownloadArgs) {
    const conf = confValidator.parse(args.config);

    const tmpPath = $.path(args.tmpDirPath);
    const host = conf.host ? `--default-host ${conf.host}` : "";
    const profile = conf.profile ? `--profile ${conf.profile}` : "";
    const components = conf.components ? `-c ${conf.components.join(" ")}` : "";
    const targets = conf.targets ? `-t ${conf.targets.join(" ")}` : "";
    await $.raw`${
      depExecShimPath(rustup_rustlang_id, "rustup-init", args.depArts)
    } -y --no-modify-path --default-toolchain ${args.installVersion} ${host} ${profile} ${targets} ${components}`
      .env({
        RUSTUP_INIT_SKIP_PATH_CHECK: "yes",
        RUSTUP_HOME: tmpPath.join("rustup").toString(),
        CARGO_HOME: tmpPath.join("cargo").toString(),
      });
    const toolchainDir = await tmpPath.join("rustup", "toolchains").expandGlob(
      "*",
    ).next();
    await std_fs.move(
      toolchainDir.value!.path.toString(),
      args.downloadPath,
    );
  }

  override async install(args: InstallArgs) {
    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await std_fs.copy(
      args.downloadPath,
      args.installPath,
    );
  }
}
