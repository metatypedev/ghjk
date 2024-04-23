//! dependencies used by all
//! FIXME: move files in this module to files called deps.ts
//! and located close to their users

export { z as zod } from "https://deno.land/x/zod@v3.22.4/mod.ts";
export * as zod_val_err from "npm:zod-validation-error";
export * as semver from "https://deno.land/std@0.213.0/semver/mod.ts";
export * as std_log from "https://deno.land/std@0.213.0/log/mod.ts";
export * as std_log_levels from "https://deno.land/std@0.213.0/log/levels.ts";
export * as std_fmt_colors from "https://deno.land/std@0.213.0/fmt/colors.ts";
export * as std_url from "https://deno.land/std@0.213.0/url/mod.ts";
export * as std_path from "https://deno.land/std@0.213.0/path/mod.ts";
export * as std_fs from "https://deno.land/std@0.213.0/fs/mod.ts";
export * as dax from "jsr:@david/dax@0.40.1";
// export * as dax from "https://raw.githubusercontent.com/Yohe-Am/dax/feat/63/cmds-clear-env/mod.ts";
// export * as dax from "../../dax/mod.ts";
export * as jsonHash from "https://deno.land/x/json_hash@0.2.0/mod.ts";
export { default as objectHash } from "https://deno.land/x/object_hash@2.0.3/mod.ts";
export { default as deep_eql } from "https://deno.land/x/deep_eql@v5.0.1/index.js";
