import {
  $,
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

export class Port extends PipiPort {
  listAll(args: ListAllArgs) {
    return super.listAll({
      ...args,
      config: { ...args.config, packageName: "poetry" },
    });
  }

  latestStable(args: ListAllArgs) {
    return defaultLatestStable(this, {
      ...args,
      config: { ...args.config, packageName: "poetry" },
    });
  }

  download(args: DownloadArgs) {
    return super.download({
      ...args,
      config: { ...args.config, packageName: "poetry" },
    });
  }

  // FIXME: Plugins should be installed using pip for a true standalone install
  // Poetry stores data about the plugins somewhere when using self add
  async install(args: InstallArgs) {
    await super.install({
      ...args,
      config: { ...args.config, packageName: "poetry" },
    });

    const conf = confValidator.parse(args.config);

    const plugins = conf.plugins?.map((p) =>
      p.version ? [p.name, p.version].join("@") : p.name
    ).join(" ");

    if (plugins) {
      const execPath = $.path(args.installPath).join("bin", "poetry");
      await $`${execPath} self add ${plugins}`;
    }
  }
}
