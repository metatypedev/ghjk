import {
  $,
  ALL_ARCH,
  ALL_OS,
  defaultLatestStable,
  depExecShimPath,
  DownloadArgs,
  type InstallArgs,
  type InstallConfigSimple,
  type ListAllArgs,
  logger,
  osXarch,
  pathsWithDepArts,
  PortBase,
  std_fs,
  zod,
} from "../port.ts";
import cpy_bs from "./cpy_bs.ts";
import * as std_ports from "../modules/ports/std.ts";

export const manifest = {
  ty: "denoWorker@v1" as const,
  name: "pipi_pypi",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  buildDeps: [std_ports.cpy_bs_ghrel],
  // NOTE: enable all platforms. Restrictions will apply based
  // cpy_bs support this way
  platforms: osXarch([...ALL_OS], [...ALL_ARCH]),
};

const confValidator = zod.object({
  packageName: zod.string().regex(/[a-z0-9._-]*/),
  peerDeps: zod.array(zod.object({
    name: zod.string(),
    version: zod.string().nullish(),
  })).nullish(),
}).passthrough();

export type PipiInstallConf =
  & InstallConfigSimple
  & zod.input<typeof confValidator>;

export default function conf(config: PipiInstallConf) {
  return [{
    ...confValidator.parse(config),
    port: manifest,
  }, cpy_bs()];
}

export class Port extends PortBase {
  async listAll(args: ListAllArgs) {
    const conf = confValidator.parse(args.config);
    const metadata = await $.request(
      `https://pypi.org/simple/${conf.packageName}/`,
    )
      .header("Accept", "application/vnd.pypi.simple.v1+json")
      .json() as {
        versions: string[];
      };

    return metadata.versions;
  }

  latestStable(args: ListAllArgs): Promise<string> {
    return defaultLatestStable(this, args);
  }

  // this creates the venv and install the package into it
  async download(args: DownloadArgs) {
    const downloadPath = $.path(args.downloadPath);
    if (await downloadPath.exists()) {
      return;
    }

    const tmpPath = $.path(args.tmpDirPath);
    const conf = confValidator.parse(args.config);

    // generate PATH vars based on our deps
    const depPathEnvs = pathsWithDepArts(args.depArts, args.platform.os);

    logger().debug("creating new venv for package");
    const venvPath = tmpPath.join("venv");
    await $`${
      depExecShimPath(std_ports.cpy_bs_ghrel, "python3", args.depArts)
    } -m venv --without-pip ${venvPath.toString()}`
      .env(depPathEnvs);

    const PATH = `${venvPath.join("bin").toString()}:${depPathEnvs.PATH}`;
    const VIRTUAL_ENV = venvPath.toString();
    // PIP_PYTHON is the actual env var that makes pip
    // install into the venv (and not the root python installation)
    // the previous two are just here incase something
    // else needs them
    // it also determines what the shebangs of the scripts point to
    // (would have been great if there were two separate variables
    // for this)
    const PIP_PYTHON = venvPath.join("bin", "python3").toString();

    logger().debug(
      "installing package to venv",
      conf.packageName,
      args.installVersion,
    );

    const dependencies = conf.peerDeps?.map((dep) => (
      dep.version ? [dep.name, dep.version].join("==") : dep.name
    )) ?? [];

    await $`${
      depExecShimPath(std_ports.cpy_bs_ghrel, "python3", args.depArts)
    } -m pip -qq install ${conf.packageName}==${args.installVersion} ${dependencies}`
      .env(
        {
          ...depPathEnvs,
          PYTHONWARNINGS: "ignore",
          PIP_DISABLE_PIP_VERSION_CHECK: "1",
          VIRTUAL_ENV,
          PATH,
          PIP_PYTHON,
        },
      );

    // put the path of the PIP_PYTHON in a file
    // so that install step can properly sed it out of the scripts
    // with the real py executable
    await tmpPath.join("old-shebang").writeText(
      [
        // PIP_PYTHON
        venvPath.toString(),
        // paths in pyvenv.cfg and others were created before
        // we had access to PIP_PYTHON so we need to replace those
        // hardcoded bits
        $.path(depExecShimPath(std_ports.cpy_bs_ghrel, "python3", args.depArts))
          .parentOrThrow()
          .parentOrThrow()
          .toString(),
      ].join("\n"),
    );
    await std_fs.move(args.tmpDirPath, args.downloadPath);
  }

  // this modifies the venv so that it works with ghjk
  // and exposes the packages and only the package's console scripts
  async install(args: InstallArgs) {
    const tmpPath = $.path(args.tmpDirPath);
    const conf = confValidator.parse(args.config);

    await std_fs.copy(args.downloadPath, args.tmpDirPath, { overwrite: true });

    const venvPath = tmpPath.join("venv");

    // the python symlinks in the venv link to the dep shim (which is temporary)
    // replace them with a link to the real python exec
    // the cpy_bs port smuggles out the real path of it's python executable
    const realPyExecPath =
      args.depArts[std_ports.cpy_bs_ghrel.name].env.REAL_PYTHON_EXEC_PATH;
    (await venvPath.join("bin", "python3").remove()).symlinkTo(
      realPyExecPath,
    );

    // generate PATH vars based on our deps
    const depPathEnvs = pathsWithDepArts(args.depArts, args.platform.os);

    const venvBinDir = venvPath.join("bin").toString();
    const venvPYPATH = (
      await venvPath.join("lib").expandGlob("python*").next()
    ).value!.path.join("site-packages").toString();
    const PATH = `${venvBinDir}:${depPathEnvs.PATH}`;
    const VIRTUAL_ENV = venvPath.toString();

    // get a list of files owned by package from venv
    const pkgFiles = zod.string().array().parse(
      await $`${
        depExecShimPath(std_ports.cpy_bs_ghrel, "python3", args.depArts)
      } -c ${printPkgFiles} ${conf.packageName}`
        // NOTE: the python script is too much for debug logs
        .printCommand(false)
        .env(
          {
            ...depPathEnvs,
            VIRTUAL_ENV,
            PATH,
            // we need to set PYTHONPATH to the venv for the printPkgFiles script
            // to discover whatever we installed in the venv
            // this is necessary since we're not allowed to use the python bin in
            // the venv
            PYTHONPATH: venvPYPATH,
          },
        )
        .json(),
    );

    // we create shims to the bin files only owned by the package
    // this step is necessary as venv/bin otherwise contains bins
    // of deps
    await tmpPath.join("bin").ensureDir();
    await Promise.all(
      pkgFiles
        // only the pkg fies found in $venv/bin
        .filter((str) => str.startsWith(venvBinDir))
        .map((execPath) =>
          Deno.symlink(
            // create a relative symlink
            // TODO: open ticket on dsherret/tax about createSymlinkTo(relative) bug
            ".." + execPath.slice(tmpPath.toString().length),
            tmpPath
              .join("bin", $.path(execPath).basename()).toString(),
          )
        ),
    );

    const installPath = $.path(args.installPath);

    // we replace the shebangs and other hardcoded py exec paths in
    // venv/bin to the final resting path for the venv's python
    // exec (shebangs don't support relative paths)
    {
      const [oldVenv, shimPyHome] =
        (await tmpPath.join("old-shebang").readText()).split(
          "\n",
        );
      const [newVenv, realPyHome] = [
        // NOTE: installPath, not tmpPath
        installPath.join("venv").toString(),
        $.path(realPyExecPath)
          .parentOrThrow()
          .parentOrThrow()
          .toString(),
      ];
      await Promise.all(
        [
          // this file is the primary means venvs replace
          // PYTHONHOME so we need to fix it too
          venvPath.join("pyvenv.cfg"),
          ...(await Array.fromAsync($.path(venvBinDir).walk()))
            .filter((path) => path.isFile)
            .map((path) => path.path),
        ].map(
          async (path) => {
            // FIXME: this is super inefficient
            // - skip if we detect binary files
            // - consider only just replacing shebangs
            const file = await path.readText();
            const fixed = file
              .replaceAll(oldVenv, newVenv)
              .replaceAll(shimPyHome, realPyHome);
            if (file != fixed) {
              logger().debug("replacing shebangs", path.toString());
              await path.writeText(fixed);
            }
          },
        ),
      );
    }

    await $.removeIfExists(installPath);
    await std_fs.move(tmpPath.toString(), installPath.toString());
  }
}

// Modified from
// https://github.com/mitsuhiko/rye/blob/73e639eae83ebb48d9c8748ea79096f96ae52cf9/rye/src/installer.rs#L23
// MIT License
// Copyright (c) 2023, Armin Ronacher
const printPkgFiles = `import os
import sys
import json

if sys.version_info >= (3, 8):
    from importlib.metadata import distribution, PackageNotFoundError
else:
    from importlib_metadata import distribution, PackageNotFoundError

pkg = sys.argv[1]
dist = distribution(pkg)
print(json.dumps([os.path.normpath(dist.locate_file(file)) for file in dist.files ]))
`;
