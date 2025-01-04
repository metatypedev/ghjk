import { zod } from "../../deps/common.ts";
import type { GhjkCtx } from "../../modules/types.ts";
import type { ModuleBase } from "../../modules/mod.ts";

const denoSystemsRoot = zod.object({
  systems: zod.record(zod.function()),
});

const charSchema = zod.string().length(1);

const cliArg = zod.object({
  value_name: zod.string().nullish(),
  value_hint: zod.enum([
    "Unknown",
    "Other",
    "AnyPath",
    "FilePath",
    "DirPath",
    "ExecutablePath",
    "CommandName",
    "CommandString",
    // "CommandWithArguments",
    "Username",
    "Hostname",
    "Url",
    "EmailAddress",
  ]).nullish(),

  action: zod.enum([
    "Set",
    "Append",
    "SetTrue",
    "SetFalse",
    "Count",
    "Help",
    "HelpShort",
    "HelpLong",
    "Version",
  ]).nullish(),

  required: zod.boolean().nullish(),
  global: zod.boolean().nullish(),
  hide: zod.boolean().nullish(),
  exclusive: zod.boolean().nullish(),
  trailing_var_arg: zod.boolean().nullish(),

  env: zod.string().nullish(),

  help: zod.string().nullish(),
  long_help: zod.string().nullish(),
});

const cliFlag = cliArg.extend({
  long: zod.string().nullish(),
  long_aliases: zod.string().array().nullish(),
  visible_long_aliases: zod.string().array().nullish(),

  short: charSchema.nullish(),
  short_aliases: charSchema.array().nullish(),
  visible_short_aliases: charSchema.array().nullish(),
});

const cliCommandBase = zod.object({
  name: zod.string(),

  aliases: zod.string().array().nullish(),
  visible_aliases: zod.string().array().nullish(),

  hide: zod.boolean().nullish(),
  disable_help_subcommand: zod.boolean().nullish(),

  about: zod.string().nullish(),
  before_help: zod.string().nullish(),
  before_long_help: zod.string().nullish(),

  args: zod.record(cliArg).nullish(),
  flags: zod.record(cliFlag).nullish(),
});

const flagsAndArgs = zod.record(
  zod.union([
    zod.string(),
    zod.string().array(),
    zod.number(),
    zod.boolean(),
  ]).nullish(),
);

const cliActionArgs = zod.object({
  flags: flagsAndArgs,
  args: flagsAndArgs,
});

const cliCommandActionBase = cliCommandBase.extend({
  action: zod.function()
    .args(cliActionArgs)
    .returns(zod.union([zod.promise(zod.void()), zod.void()])).nullish(),
});

const cliCommandBindedBase = cliCommandBase.extend({
  action_cb_key: zod.string().nullish(),
});

const cliCommand: zod.ZodType<CliCommandX> = cliCommandActionBase.extend({
  sub_commands: zod.lazy(() => zod.array(cliCommand).nullish()),
});

const cliCommandBinded: zod.ZodType<CliCommandBindedX> = cliCommandBindedBase
  .extend({
    sub_commands: zod.lazy(() => zod.array(cliCommandBinded).nullish()),
  });

type DenoSystemCtor = (gcx: GhjkCtx) => ModuleBase<unknown>;

export type DenoSystemsRoot = {
  systems: Record<string, DenoSystemCtor>;
};

export type CliCommand = zod.input<typeof cliCommandActionBase> & {
  sub_commands?: CliCommand[] | null;
};
export type CliCommandX = zod.infer<typeof cliCommandActionBase> & {
  sub_commands?: CliCommandX[] | null;
};

export type CliCommandBinded = zod.input<typeof cliCommandBindedBase> & {
  sub_commands?: CliCommandBinded[] | null;
};
export type CliCommandBindedX = zod.infer<typeof cliCommandBindedBase> & {
  sub_commands?: CliCommandBindedX[] | null;
};

export type CliFlag = zod.input<typeof cliFlag>;
export type CliFlagX = zod.infer<typeof cliFlag>;

export type CliArg = zod.input<typeof cliArg>;
export type CliArgX = zod.infer<typeof cliArg>;

export default {
  denoSystemsRoot,
  cliFlag,
  cliArg,
  cliCommand,
  cliActionArgs,
};
