import { logger, semver } from "../../port.ts";
import { ListAllArgs } from "./types.ts";

export type PackageMetadataSimple = {
  files: [{ filename: string; "requires-python"?: string }];
  versions: string[];
};

export function resolveCompatibleVersions(
  args: ListAllArgs,
  metadata: PackageMetadataSimple,
) {
  throw new Error("TODO: inject buildDepConfigs in ListAllargs");
  
  const pythonDep = args.config.buildDepConfigs!.cpy_bs_ghrel as {
    version: string;
  };
  const pythonVersion = semver.parseRange(pythonDep.version);
  const versions = [];

  for (const file of metadata.files) {
    const match = file.filename.match(/(\d+\.\d+\.\d+.*)\.tar\.gz/);

    if (
      match &&
      testPythonCompablity(pythonVersion, file["requires-python"])
    ) {
      versions.push(match[1]);
    }
  }

  return versions;
}

function testPythonCompablity(version: semver.Range, required?: string) {
  if (!required) return true;

  return required.split(",")
    .map((v) => v.replaceAll(" ", ""))
    .every((v) => testVersionSpecifier(version, v));
}

function testVersionSpecifier(version: semver.Range, specifier: string) {
  const negate = specifier.startsWith("!=");
  const specifierRange = semver.parseRange(
    negate ? specifier.slice(2) : specifier,
  );
  const result = semver.rangeIntersects(version, specifierRange);

  return negate ? !result : result;
}
