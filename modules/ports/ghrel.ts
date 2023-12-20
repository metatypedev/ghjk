import { $, exponentialBackoff } from "../../utils/mod.ts";
import { PortBase } from "./base.ts";

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

  async latestStable() {
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
      delay: exponentialBackoff(1000),
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
