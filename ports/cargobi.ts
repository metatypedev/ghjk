import {
  $,
  ALL_ARCH,
  ALL_OS,
  defaultLatestStable,
  depExecShimPath,
  DownloadArgs,
  type InstallArgs,
  InstallConfigFat,
  type InstallConfigSimple,
  type ListAllArgs,
  logger,
  osXarch,
  pathsWithDepArts,
  PortBase,
  std_fs,
  std_path,
  thinInstallConfig,
  zod,
} from "../port.ts";
import * as std_ports from "../modules/ports/std.ts";
import {
  ghConfValidator,
  GithubReleasesInstConf,
} from "../modules/ports/ghrel.ts";
import rust, { RustInstallConf } from "./rust.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "cargobi_cratesio",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  buildDeps: [std_ports.cbin_ghrel, std_ports.rust_rustup],
  // FIXME: we can't know crate platform support at this point
  platforms: osXarch([...ALL_OS], [...ALL_ARCH]),
};

const confValidator = zod.object({
  crateName: zod.string().regex(/[a-z0-9._-]*/),
  profile: zod.string().regex(/[a-zA-Z_-]+/).nullish(),
  noDefaultFeatures: zod.boolean().nullish(),
  features: zod.string().regex(/[a-zA-Z_-]+/).array().nullish(),
  locked: zod.boolean().nullish(),
  target: zod.string()
    .regex(/^[^-\s]+(-[^-\s]+){1,}?$/).nullish(),
  // TODO: expose more cargo install flags
}).passthrough();

export type CargobiInstallConf =
  & InstallConfigSimple
  & GithubReleasesInstConf
  & { rustConfOverride?: RustInstallConf }
  & zod.input<typeof confValidator>;

export default function conf(config: CargobiInstallConf) {
  const { rustConfOverride, ...thisConf } = config;
  const out: InstallConfigFat = {
    ...confValidator.parse(thisConf),
    buildDepConfigs: {
      [std_ports.rust_rustup.name]: thinInstallConfig(rust({
        profile: "minimal",
        ...rustConfOverride,
      })),
    },
    port: manifest,
  };
  return out;
}

export class Port extends PortBase {
  async listAll(args: ListAllArgs) {
    const conf = confValidator.parse(args.config);
    // https://doc.rust-lang.org/cargo/reference/registry-index.html#index-files
    const lowerCName = conf.crateName.toLowerCase();
    let indexPath;
    if (lowerCName.length == 1) {
      indexPath = `1/${lowerCName}`;
    } else if (lowerCName.length == 2) {
      indexPath = `2/${lowerCName}`;
    } else if (lowerCName.length == 3) {
      indexPath = `3/${conf.crateName[0]}/${lowerCName}`;
    } else {
      indexPath = `${conf.crateName.slice(0, 2)}/${
        conf.crateName.slice(2, 4)
      }/${lowerCName}`;
    }
    const metadataText = await $.request(
      `https://index.crates.io/${indexPath}`,
    ).text();
    const versions = metadataText
      .split("\n")
      .filter((str) => str.length > 0)
      .map((str) =>
        JSON.parse(str) as {
          vers: string;
        }
      );
    return versions.map((ver) => ver.vers);
  }

  latestStable(args: ListAllArgs): Promise<string> {
    return defaultLatestStable(this, args);
  }

  async download(args: DownloadArgs) {
    const conf = confValidator.parse(args.config);
    const fileName = conf.crateName;
    if (await std_fs.exists(std_path.resolve(args.downloadPath, fileName))) {
      logger().debug(
        `file ${fileName} already downloaded, skipping whole download`,
      );
      return;
    }
    const ghConf = ghConfValidator.parse(args.config);
    const target = conf.target ? `--target ${conf.target}` : "";
    const profile = conf.profile ? `--profile ${conf.profile}` : "";
    const noDefaultFeatures = conf.noDefaultFeatures
      ? "--no-default-features"
      : "";
    const features = conf.features ? `--features ${conf.features.join()}` : "";
    const locked = conf.locked ? `--locked` : "";

    const cargoBinstall = () => {
      return $.raw`${
        depExecShimPath(std_ports.cbin_ghrel, "cargo-binstall", args.depArts)
      } ${conf.crateName} --version ${args.installVersion} --disable-strategies compile --root ${args.tmpDirPath} --no-confirm --no-track ${
        [
          target,
          locked,
        ].filter((str) => str.length > 0)
      }`.env(
        {
          // cargo-binstall might want to access cargo
          ...pathsWithDepArts(args.depArts, args.platform.os),
          ...ghConf.ghToken ? { GITHUB_TOKEN: ghConf.ghToken } : {},
        },
      ).noThrow(true);
    };

    const cargoInstall = () => {
      return $.raw`${
        depExecShimPath(std_ports.rust_rustup, "cargo", args.depArts)
      } install ${conf.crateName} --version ${args.installVersion} --root ${args.tmpDirPath} --no-track ${
        [
          target,
          noDefaultFeatures,
          features,
          locked,
          profile,
        ].filter((str) => str.length > 0)
      }`.env(
        {
          // cargo will need to access rustc
          ...pathsWithDepArts(args.depArts, args.platform.os),
          ...ghConf.ghToken ? { GITHUB_TOKEN: ghConf.ghToken } : {},
        },
      );
    };

    // if any paramaters unsupported by cargo binstall are present
    if ([profile, noDefaultFeatures, features].some((str) => str.length > 0)) {
      // directly go to cargo install
      await cargoInstall();
    } else {
      const res = await cargoBinstall();
      // code 94 implies cargo binstall tried to fall back
      // to cargo install
      if (res.code == 94) {
        await cargoInstall();
      } else if (res.code != 0) {
        throw new Error(`error ${res.code} on cargo-binstall\n${res.combined}`);
      }
    }

    await std_fs.move(
      args.tmpDirPath,
      args.downloadPath,
    );
  }

  async install(args: InstallArgs) {
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
