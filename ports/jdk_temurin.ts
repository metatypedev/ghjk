import {
  $,
  defaultLatestStable,
  depExecShimPath,
  downloadFile,
  dwnUrlOut,
  osXarch,
  PortBase,
  std_fs,
  std_path,
} from "../src/deno_ports/mod.ts";
import type {
  DownloadArgs,
  ExecEnvArgs,
  InstallArgs,
  InstallConfigSimple,
  ListAllArgs,
} from "../src/deno_ports/mod.ts";
import {
  ghHeaders,
  GithubReleasesInstConf,
  readGhVars,
} from "../src/deno_ports/ghrel.ts";

const tar_aa_id = {
  name: "tar_aa",
};

const unzip_aa_id = {
  name: "unzip_aa",
};

export const manifest = {
  ty: "denoWorker@v1" as const,
  name: "jdk_temurin",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  buildDeps: [tar_aa_id, unzip_aa_id],
  platforms: osXarch(["linux", "darwin", "windows"], ["aarch64", "x86_64"]),
};

export type JdkTemurinInstallConf =
  & InstallConfigSimple
  & GithubReleasesInstConf;

export default function conf(config: JdkTemurinInstallConf = {}) {
  return {
    ...readGhVars(),
    ...config,
    port: manifest,
  };
}

export class Port extends PortBase {
  override execEnv(args: ExecEnvArgs) {
    return {
      JAVA_HOME: args.installPath,
    };
  }

  override latestStable(args: ListAllArgs): Promise<string> {
    return defaultLatestStable(this, args);
  }

  async listAll(args: ListAllArgs) {
    const version = args.config.version;

    // Use Adoptium API to get available releases
    const response = await $.request(
      "https://api.adoptium.net/v3/info/available_releases",
    ).json() as {
      available_releases: number[];
      available_lts_releases: number[];
      most_recent_feature_release: number;
      most_recent_lts: number;
    };

    // Start with major versions
    const versions = response.available_releases
      .map((v) => v.toString())
      .sort((a, b) => parseInt(a) - parseInt(b));

    // Also include specific versions for LTS releases (most commonly used)
    const ltsVersions = response.available_lts_releases;
    versions.push(
      ...(
        await $.co(
          ltsVersions.map(async (v) =>
            await this.listSpecificVersions(v.toString())
          ),
        )
      ).flat(),
    );

    // If user specified an explicit version, check if it's available and include it
    if (version && !versions.includes(version)) {
      try {
        // Check if the specific version exists by trying to get its info
        const majorVersion = version.split(".")[0];
        const versionCheck = await this.listSpecificVersions(majorVersion);
        if (versionCheck.includes(version)) {
          versions.push(version);
        }
      } catch (_error) {
        //
      }
    }

    return versions.sort((vA, vB) =>
      vA.localeCompare(vB, undefined, {
        numeric: true,
      })
    );
  }

  // Helper method to get specific versions for a major version
  async listSpecificVersions(majorVersion: string): Promise<string[]> {
    const response = await $.request(
      `https://api.adoptium.net/v3/assets/feature_releases/${majorVersion}/ga?image_type=jdk&vendor=eclipse&page_size=200`,
    ).json() as Array<{
      version_data: {
        semver: string;
        build: number;
        major: number;
        minor: number;
        security: number;
        openjdk_version: string;
      };
    }>;

    // Return semver versions (e.g., "21.0.8+9.0.LTS")
    return response.map((item) => item.version_data.semver);
  }

  async downloadUrls(args: DownloadArgs) {
    const { installVersion, platform } = args;

    let arch;
    switch (platform.arch) {
      case "x86_64":
        arch = "x64";
        break;
      case "aarch64":
        arch = "aarch64";
        break;
      default:
        throw new Error(`unsupported arch: ${platform.arch}`);
    }

    let os;
    switch (platform.os) {
      case "linux":
        os = "linux";
        break;
      case "darwin":
        os = "mac";
        break;
      case "windows":
        os = "windows";
        break;
      default:
        throw new Error(`unsupported os: ${platform.os}`);
    }

    // Check if this is a semver version (contains dots and plus signs)
    const isSemver = installVersion.includes(".") &&
      installVersion.includes("+");

    if (isSemver) {
      // For specific semver versions, get the download URL from the assets endpoint
      const majorVersion = installVersion.split(".")[0];

      // Query the assets endpoint to find the specific version
      const assetsResponse = await $.request(
        `https://api.adoptium.net/v3/assets/feature_releases/${majorVersion}/ga?image_type=jdk&vendor=eclipse&page_size=200`,
      ).json() as Array<{
        version_data: { semver: string };
        binaries: Array<{
          architecture: string;
          os: string;
          image_type: string;
          package: {
            name: string;
            link: string;
          };
        }>;
      }>;

      const foundVersion = assetsResponse.find((item) =>
        item.version_data.semver === installVersion
      );
      if (!foundVersion) {
        throw new Error(
          `Version ${installVersion} not found in available releases`,
        );
      }

      const matchingBinary = foundVersion.binaries.find((binary) =>
        binary.architecture === arch && binary.os === os &&
        binary.image_type === "jdk"
      );

      if (!matchingBinary) {
        throw new Error(
          `No binary found for ${platform.os}/${platform.arch} for version ${installVersion}`,
        );
      }

      // Return the direct GitHub release URL
      return [{
        url: matchingBinary.package.link,
        name: matchingBinary.package.name,
      }];
    } else {
      // For major versions like "21", use the latest endpoint
      const baseUrl =
        `https://api.adoptium.net/v3/binary/latest/${installVersion}/ga/${os}/${arch}/jdk/hotspot/normal/eclipse`;

      return [baseUrl].map((url) => dwnUrlOut(url + `?project=jdk`));
    }
  }

  override async download(args: DownloadArgs) {
    const urls = await this.downloadUrls(args);

    await Promise.all(
      urls.map(async (obj) => {
        await downloadFile({
          ...args,
          url: obj.url,
          name: obj.name,
          headers: ghHeaders(args.config),
        });
      }),
    );
  }

  override async install(args: InstallArgs) {
    // Find the actual downloaded file
    const files = [];
    for await (
      const entry of std_fs.expandGlob(
        std_path.joinGlobs([args.downloadPath, "*"]),
      )
    ) {
      files.push(entry.path);
    }

    if (files.length !== 1) {
      throw new Error(
        `Expected exactly one downloaded file, found ${files.length}`,
      );
    }

    const fileDwnPath = files[0];
    const fileName = std_path.basename(fileDwnPath);

    // Extract based on file extension
    if (fileName.endsWith(".tar.gz")) {
      await $`${
        depExecShimPath(tar_aa_id, "tar", args.depArts)
      } xf ${fileDwnPath} --directory=${args.tmpDirPath}`;
    } else if (fileName.endsWith(".zip")) {
      await $`${
        depExecShimPath(unzip_aa_id, "unzip", args.depArts)
      } ${fileDwnPath} -d ${args.tmpDirPath}`;
    } else {
      throw new Error(`Unsupported file format: ${fileName}`);
    }

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }

    const dirs = [];
    for await (
      const entry of std_fs.expandGlob(
        std_path.joinGlobs([args.tmpDirPath, "*"]),
      )
    ) {
      dirs.push(entry);
    }
    if (dirs.length != 1 || !dirs[0].isDirectory) {
      throw new Error("unexpected archive contents");
    }

    // Handle macOS JDK structure - JDK is typically in Contents/Home subdirectory
    let sourcePath = dirs[0].path;
    const contentsHome = std_path.join(sourcePath, "Contents", "Home");
    if (await std_fs.exists(contentsHome)) {
      sourcePath = contentsHome;
    }

    await std_fs.copy(
      sourcePath,
      args.installPath,
    );
  }
}
