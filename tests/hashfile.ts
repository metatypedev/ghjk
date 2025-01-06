import "../src/deno_utils/setup_logger.ts";
import { E2eTestCase, harness } from "./utils.ts";

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints" | "fs"> & {
  stdin: string;
};

const cases: CustomE2eTestCase[] = [
  {
    name: "invalidated_control",
    stdin: `
__ghjk_get_mtime_ts .ghjk/hash.json > tstamp
ghjk sync
test (cat tstamp) = (__ghjk_get_mtime_ts .ghjk/hash.json); or exit 101
ghjk sync
test (cat tstamp) = (__ghjk_get_mtime_ts .ghjk/hash.json); or exit 101
`,
  },
  {
    name: "invalidated_ghjk_modified",
    stdin: `
__ghjk_get_mtime_ts .ghjk/hash.json > tstamp
echo '// hey' >> ghjk.ts
ghjk sync
test (cat tstamp) -lt (__ghjk_get_mtime_ts .ghjk/hash.json); or exit 101
`,
  },
  {
    name: "invalidated_dep_script_modified",
    stdin: `
__ghjk_get_mtime_ts .ghjk/hash.json > tstamp
echo '// hey' >> extra.ts
ghjk sync
test (cat tstamp) -lt (__ghjk_get_mtime_ts .ghjk/hash.json); or exit 101
`,
  },
  {
    name: "invalidated_env_modified",
    stdin: `
__ghjk_get_mtime_ts .ghjk/hash.json > tstamp
MY_ENV=changed ghjk sync
test (cat tstamp) -lt (__ghjk_get_mtime_ts .ghjk/hash.json); or exit 101
`,
  },
  {
    name: "invalidated_listed_file_removed",
    stdin: `
__ghjk_get_mtime_ts .ghjk/hash.json > tstamp
rm dir/one
ghjk sync
test (cat tstamp) -lt (__ghjk_get_mtime_ts .ghjk/hash.json); or exit 101
`,
  },
  {
    name: "invalidated_cli_config_changed",
    stdin: `
__ghjk_get_mtime_ts .ghjk/hash.json > tstamp
GHJK_DENO_LOCKFILE=deno.lock ghjk sync
test (cat tstamp) -lt (__ghjk_get_mtime_ts .ghjk/hash.json); or exit 101
`,
  },
];

harness(cases.map((testCase) => ({
  ...testCase,
  fs: {
    "ghjk.ts": `
export { sophon } from "@ghjk/ts/hack.ts";
import { task, env } from "@ghjk/ts/hack.ts";
import {stuff} from "./extra.ts"

await Array.fromAsync(Deno.readDir("dir"))

env("main")
  .vars({ hello: Deno.env.get("MY_ENV") ?? "world" })
`,
    "extra.ts": `export const stuff = "hello"`,
    "dir/one": "1",
    "dir/two": "2",
  },
  ePoints: [{ cmd: "fish", stdin: testCase.stdin }],
  name: `hashfile/${testCase.name}`,
})));
