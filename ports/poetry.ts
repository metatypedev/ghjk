import {
  defaultLatestStable,
  InstallConfigSimple,
  osXarch,
  zod,
} from "../port.ts";
import { Port as PipiPort } from "./pipi.ts";
import {
  ALL_ARCH,
  ALL_OS,
  DownloadArgs,
  InstallArgs,
  InstallConfigLiteX,
  ListAllArgs,
} from "../modules/ports/types.ts";
import * as std_ports from "../modules/ports/std.ts";

export const manifest = {
  ty: "denoWorker@v1" as const,
  name: "poetry",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  buildDeps: [std_ports.cpy_bs_ghrel],
  platforms: osXarch([...ALL_OS], [...ALL_ARCH]),
};

const confValidator = zod.object({
  plugins: zod.array(zod.object({
    name: zod.string(),
    version: zod.string().nullish(),
  })).nullish(),
}).passthrough();

export type PoetryInstallConf =
  & InstallConfigSimple
  & zod.input<typeof confValidator>;

export default function conf(config: PoetryInstallConf = {}) {
  return {
    ...config,
    port: manifest,
  };
}

const toPipiConfig = (config: InstallConfigLiteX) => ({
  ...config,
  packageName: "poetry",
  peerDeps: config.plugins,
});

export class Port extends PipiPort {
  listAll(args: ListAllArgs) {
    return super.listAll({ ...args, config: toPipiConfig(args.config) });
  }

  override latestStable(args: ListAllArgs): Promise<string> {
    return defaultLatestStable(this, {
      ...args,
      config: toPipiConfig(args.config),
    });
  }

  override download(args: DownloadArgs) {
    return super.download({ ...args, config: toPipiConfig(args.config) });
  }

  install(args: InstallArgs) {
    return super.install({ ...args, config: toPipiConfig(args.config) });
  }
}
