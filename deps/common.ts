//! dependencies used by all
//! FIXME: move files in this module to files called deps.ts
//! and located close to their users

export { z as zod } from "https://deno.land/x/zod@v3.23.8/mod.ts";
export * as semver from "https://deno.land/std@0.213.0/semver/mod.ts";
export * as std_log from "https://deno.land/std@0.213.0/log/mod.ts";
export * as std_log_levels from "https://deno.land/std@0.213.0/log/levels.ts";
export * as std_fmt_colors from "https://deno.land/std@0.213.0/fmt/colors.ts";
export * as std_url from "https://deno.land/std@0.213.0/url/mod.ts";
export * as std_path from "https://deno.land/std@0.213.0/path/mod.ts";
export * as std_fs from "https://deno.land/std@0.213.0/fs/mod.ts";

// avoid using the following directly and go through the
// wrappers in ./utils/mod.ts
export * as dax from "jsr:@david/dax@0.41.0";
// class re-exports are tricky.
export { Path as _DaxPath } from "jsr:@david/dax@0.41.0";
// export * as dax from "jsr:@ghjk/dax@0.40.2-alpha-ghjk";

export { canonicalize as json_canonicalize } from "https://deno.land/x/json_hash@0.2.0/canon.ts";
export { default as deep_eql } from "https://deno.land/x/deep_eql@v5.0.1/index.js";
// export * as multibase16 from "npm:multiformats@13.1.0/bases/base16";
export * as multibase32 from "npm:multiformats@13.1.0/bases/base32";
export * as multibase64 from "npm:multiformats@13.1.0/bases/base64";
export * as multisha2 from "npm:multiformats@13.1.0/hashes/sha2";
export * as multihasher from "npm:multiformats@13.1.0/hashes/hasher";
export { sha256 as syncSha256 } from "npm:@noble/hashes@1.4.0/sha256";
