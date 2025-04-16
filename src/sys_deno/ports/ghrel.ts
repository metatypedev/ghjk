import { $, downloadFile, DownloadFileArgs } from "../../deno_utils/mod.ts";
import { zod } from "./deps.ts";
import { PortBase } from "./base.ts";
import type { DownloadArgs, ListAllArgs } from "./types.ts";

export const ghConfValidator = zod.object({
  ghToken: zod.string().nullish(),
});

export type GithubReleasesInstConf = zod.infer<typeof ghConfValidator>;

/// Use this to add the read and add GithubReleasesInstConf values to
// an InstallConfig
export function readGhVars() {
  // TODO: extract token from `$HOME/.git-credentials` or `$HOME/.config/gh/hosts.yml`
  const ghToken = Deno.env.get("GITHUB_TOKEN") ?? Deno.env.get("GH_TOKEN");
  const out: GithubReleasesInstConf = {
    ghToken,
  };
  return ghToken ? out : {};
}

export function ghHeaders(conf: Record<string | number | symbol, unknown>) {
  const res = ghConfValidator.parse(conf);
  const headers: Record<string, string> = {};
  if (res.ghToken) {
    headers["Authorization"] = `Bearer ${res.ghToken}`;
  }
  return headers;
}

// TODO: convert this to an asdf/pipi kind of abstraction
export abstract class GithubReleasePort extends PortBase {
  abstract repoOwner: string;
  abstract repoName: string;

  repoAddress() {
    return `https://github.com/${this.repoOwner}/${this.repoName}`;
  }

  releaseArtifactUrl(version: string, fileName: string) {
    return `${this.repoAddress()}/releases/download/${version}/${fileName}`;
  }

  downloadUrls(
    _args: DownloadArgs,
  ):
    | Promise<Omit<DownloadFileArgs, keyof DownloadArgs>[]>
    | Omit<DownloadFileArgs, keyof DownloadArgs>[] {
    return [];
  }

  override async download(args: DownloadArgs): Promise<void> {
    const urls = await this.downloadUrls(args);
    if (urls.length == 0) {
      throw new Error(
        `"downloadUrls" returned empty array when using default download impl: ` +
          `override "download" to an empty function if your port has no download step`,
      );
    }
    await Promise.all(
      urls.map((item) =>
        downloadFile({ ...args, headers: ghHeaders(args.config), ...item })
      ),
    );
  }

  override async latestStable(args: ListAllArgs) {
    const metadata = await $.withRetries({
      count: 10,
      delay: $.exponentialBackoff(1000),
      action: async () =>
        (await $.request(
          `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`,
        )
          .header(ghHeaders(args.config))
          .json()) as { tag_name: string },
    });

    return metadata.tag_name;
  }

  async listAll(args: ListAllArgs) {
    const metadata: { tag_name: string }[] = [];

    for (let page = 1;; page++) {
      // deno-lint-ignore no-await-in-loop
      const pageMetadata = await $.withRetries({
        count: 10,
        delay: $.exponentialBackoff(1000),
        action: async () =>
          (await $.request(
            `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases?per_page=100&page=${page}`,
          )
            .header(ghHeaders(args.config))
            .json()) as { tag_name: string }[],
      });

      if (!pageMetadata || !pageMetadata.length) {
        break;
      }

      metadata.push(...pageMetadata);
    }

    return metadata.map((rel) => rel.tag_name).reverse();
  }
}
