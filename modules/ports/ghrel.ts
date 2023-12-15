import { $ } from "../../utils/mod.ts";
import { PortBase } from "./types.ts";

export abstract class GithubReleasePort extends PortBase {
  abstract repoOwner: string;
  abstract repoName: string;

  async latestStable(): Promise<string> {
    const metadata = await $.withRetries({
      count: 10,
      delay: 100,
      action: async () =>
        await $.request(
          `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`,
        ).json() as {
          tag_name: string;
        },
    });

    return metadata.tag_name;
  }

  async listAll() {
    const metadata = await $.withRetries({
      count: 10,
      delay: 100,
      action: async () =>
        await $.request(
          `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases`,
        ).json() as [{
          tag_name: string;
        }],
    });

    return metadata.map((rel) => rel.tag_name).reverse();
  }
}
