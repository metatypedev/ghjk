import { zod } from "../../../deps/common.ts";

export const ALL_OS = [
  "linux",
  "darwin",
  "windows",
  "freebsd",
  "netbsd",
  "aix",
  "solaris",
  "illumos",
  "android",
] as const;

export const ALL_ARCH = [
  "x86_64",
  "aarch64",
] as const;

export const osEnum = zod.enum(ALL_OS);
export const archEnum = zod.enum(ALL_ARCH);

const platformObject = zod.object({
  os: osEnum,
  arch: archEnum,
});

export type Platform = zod.infer<typeof platformObject>;

const separator = "-";

export function serializePlatform({ os, arch }: Platform): string {
  return `${arch}${separator}${os}`;
}

export function parsePlatform(platform: string): Platform {
  const [arch, os] = platform.split(separator) as [
    Platform["arch"],
    Platform["os"],
  ];
  return platformObject.parse({ os, arch });
}
