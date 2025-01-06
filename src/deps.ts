//! dependencies used by all
//! Repo uses a hierarchical deps.ts approach since there are multiple entry
//! points. Need to add a new dep? Create a new deps.ts next to your module.
//! Only add items here when they need to be re-exported by other two `deps.ts`
//! file

export { z as zod } from "npm:zod@3.23.8";
export * as semver from "https://deno.land/std@0.213.0/semver/mod.ts";
export * as std_url from "https://deno.land/std@0.213.0/url/mod.ts";
export * as std_path from "https://deno.land/std@0.213.0/path/mod.ts";
export * as std_fs from "https://deno.land/std@0.213.0/fs/mod.ts";

export { default as deep_eql } from "https://deno.land/x/deep_eql@v5.0.1/index.js";

export * as multibase32 from "npm:multiformats@13.1.0/bases/base32";
export * as multibase64 from "npm:multiformats@13.1.0/bases/base64";
