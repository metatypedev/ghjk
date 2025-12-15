//! Test port to produce duplicate exec basenames without env var conflicts

import type {
  DownloadArgs,
  InstallArgs,
  InstallConfigSimple,
} from "../src/deno_ports/mod.ts";
import {
  $,
  ALL_ARCH,
  ALL_OS,
  osXarch,
  PortBase,
  zod,
} from "../src/deno_ports/mod.ts";
import { std_fs } from "../src/deno_utils/mod.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "dup_test",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  platforms: osXarch([...ALL_OS], [...ALL_ARCH]),
};

const confValidator = zod.object({
  output: zod.string(),
});

export type DupTestInstallConf =
  & InstallConfigSimple
  & zod.infer<typeof confValidator>;

export default function conf(config: DupTestInstallConf) {
  return {
    ...config,
    port: manifest,
  };
}

export class Port extends PortBase {
  override execEnv() {
    // no env vars to avoid conflicts across multiple installs
    return {};
  }

  listAll() {
    return ["dup_test"];
  }

  override async download(args: DownloadArgs) {
    const conf = confValidator.parse(args.config);
    await $.path(args.downloadPath).join("bin", "dup").writeText(
      `#!/bin/sh\necho ${conf.output}`,
      { mode: 0o700 },
    );
  }

  override async install(args: InstallArgs) {
    const installPath = $.path(args.installPath);
    await $.removeIfExists(installPath);
    await std_fs.copy(args.downloadPath, args.installPath);
  }
}
