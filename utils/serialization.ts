import { zod } from "../deps/common.ts";
import { archEnum, osEnum } from "../port.ts";

const platformValidator = zod.object({
  os: osEnum,
  arch: archEnum,
});

export type Platform = zod.infer<typeof platformValidator>;

const separator = "-";

export function serializePlatform({ os, arch }: Platform): string {
  return `${arch}${separator}${os}`;
}

export function parsePlatform(platform: string): Platform {
  const [arch, os] = platform.split(separator) as [
    Platform["arch"],
    Platform["os"],
  ];
  return platformValidator.parse({ os, arch });
}
