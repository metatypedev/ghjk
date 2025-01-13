import type {
  DownloadArgs,
  InstallArgs,
  InstallConfigSimple,
  ListAllArgs,
} from "../src/deno_ports/mod.ts";
import {
  $,
  ALL_ARCH,
  ALL_OS,
  depExecShimPath,
  osXarch,
  pathsWithDepArts,
  PortBase,
  std_fs,
  zod,
} from "../src/deno_ports/mod.ts";
import node from "./node.ts";
import * as std_ports from "../src/sys_deno/ports/std.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "npmi_npm",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  buildDeps: [
    std_ports.node_org,
  ],
  // NOTE: enable all platforms. Restrictions will apply based
  // node support this way
  platforms: osXarch([...ALL_OS], [...ALL_ARCH]),
};

const confValidator = zod.object({
  packageName: zod.string().regex(/[@/a-z0-9._-]*/),
}).passthrough();

export type NpmiInstallConf =
  & InstallConfigSimple
  & zod.input<typeof confValidator>;

const pkjJsonValidator = zod.object({
  bin: zod.union([zod.string(), zod.record(zod.string(), zod.string())])
    .nullish(),
  // TODO: man pages
  man: zod.union([zod.string(), zod.string().array()]).nullish(),
  directories: zod.object({
    bin: zod.string().nullish(),
    man: zod.string().nullish(),
  }).nullish(),
  // TODO: find a way to utilize these
  os: zod.string().nullish(),
  cpu: zod.string().nullish(),
});

type PackageJson = zod.infer<typeof pkjJsonValidator>;

export default function conf(config: NpmiInstallConf) {
  return [{
    ...config,
    port: manifest,
  }, node()];
}

export class Port extends PortBase {
  async listAll(args: ListAllArgs) {
    const conf = confValidator.parse(args.config);
    const metadataRequest = await $.request(
      `https://registry.npmjs.org/${conf.packageName}`,
    ).header(
      {
        // use abbreviated registry info which's still big
        "Accept": "application/vnd.npm.install-v1+json",
      },
    );
    const metadata = await metadataRequest.json() as {
      versions: Record<string, PackageJson>;
    };

    const versions = Object.keys(metadata.versions);
    return versions;
  }

  override async download(args: DownloadArgs) {
    const conf = confValidator.parse(args.config);
    await $.raw`${depExecShimPath(std_ports.node_org, "npm", args.depArts)
      // provide prefix flat to avoid looking at package.json in parent dirs
    } install --prefix ${args.tmpDirPath} --no-update-notifier --no-fund ${conf.packageName}@${args.installVersion}`
      .cwd(args.tmpDirPath)
      .env({
        ...pathsWithDepArts(args.depArts, args.platform.os),
        NO_UPDATE_NOTIFIER: "1",
      });
    await std_fs.move(args.tmpDirPath, args.downloadPath);
  }

  // FIXME: replace shebangs with the runtime dep node path
  // default shebangs just use #!/bin/env node
  override async install(args: InstallArgs) {
    const conf = confValidator.parse(args.config);
    await std_fs.copy(
      args.downloadPath,
      args.tmpDirPath,
      { overwrite: true },
    );

    const installPath = $.path(args.installPath);

    const tmpDirPath = $.path(args.tmpDirPath);
    const pkgDir = tmpDirPath.join("node_modules", conf.packageName);
    const pkgJson = pkjJsonValidator.parse(
      await pkgDir.join("package.json").readJson(),
    );
    const bins = [] as [string, string][];
    if (pkgJson.bin) {
      if (typeof pkgJson.bin == "string") {
        const split = conf.packageName.split("/");
        const pkgBaseName = split[split.length - 1];
        bins.push([pkgBaseName, pkgJson.bin]);
      } else {
        bins.push(...Object.entries(pkgJson.bin));
      }
    } else if (pkgJson.directories?.bin) {
      const pkgDirPathStrLen = pkgDir.toString().length;
      bins.push(
        ...(await Array.fromAsync(
          $.path(pkgDir.join(pkgJson.directories.bin)).walk({
            includeDirs: false,
          }),
        ))
          .map((ent) =>
            [
              ent.name,
              ent.path.toString().slice(pkgDirPathStrLen),
            ] as [string, string]
          ),
      );
    }
    if (bins.length == 0) {
      throw new Error("no artifacts to expose found", {
        cause: conf,
      });
    }
    await tmpDirPath.join("bin").ensureDir();
    await $.co(bins.map(([name]) =>
      tmpDirPath
        .join("bin", name)
        .symlinkTo(
          installPath
            .join("node_modules", ".bin", name)
            .toString(),
        )
    ));
    await $.removeIfExists(installPath);
    await std_fs.move(tmpDirPath.toString(), installPath.toString());
  }
}
