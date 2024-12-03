import { zod } from "../../deps/common.ts";
import type { GhjkCtx } from "../../modules/types.ts";
import type { ModuleBase } from "../../modules/mod.ts";

const denoSystemsRoot = zod.object({
  systems: zod.record(zod.function()),
});

const charSchema = zod.string().length(1);

const cliArg = zod.object({
  value_name: zod.string().optional(),
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
  ]).optional(),

  required: zod.boolean().optional(),
  global: zod.boolean().optional(),
  hide: zod.boolean().optional(),
  exclusive: zod.boolean().optional(),

  env: zod.string().optional(),

  help: zod.string().optional(),
  long_help: zod.string().optional(),
});

const cliFlag = cliArg.extend({
  long: zod.string().optional(),
  long_aliases: zod.string().array().optional(),
  visible_long_aliases: zod.string().array().optional(),

  short: charSchema.optional(),
  short_aliases: charSchema.array().optional(),
  visible_short_aliases: charSchema.array().optional(),
});

const cliCommandBase = zod.object({
  name: zod.string(),

  short_flag: charSchema.optional(),
  aliases: zod.string().array().optional(),
  visible_aliases: zod.string().array().optional(),

  hide: zod.boolean().optional(),

  about: zod.string().optional(),
  before_help: zod.string().optional(),
  before_long_help: zod.string().optional(),

  args: zod.record(cliArg).optional().optional(),
  flags: zod.record(cliFlag).optional().optional(),
});

const cliActionArgs = zod.object({
  flags: zod.record(zod.string().optional()),
  args: zod.record(zod.string().optional()),
});

const cliCommandActionBase = cliCommandBase.extend({
  action: zod.function()
    .args(cliActionArgs)
    .returns(zod.union([zod.promise(zod.void()), zod.void()])).optional(),
});

const cliCommandBindedBase = cliCommandBase.extend({
  action_cb_key: zod.string().optional(),
});

const cliCommand: zod.ZodType<CliCommandX> = cliCommandActionBase.extend({
  sub_commands: zod.lazy(() => zod.array(cliCommand).optional()),
});

const cliCommandBinded: zod.ZodType<CliCommandBindedX> = cliCommandBindedBase
  .extend({
    sub_commands: zod.lazy(() => zod.array(cliCommandBinded).optional()),
  });

type DenoSystemCtor = (gcx: GhjkCtx) => ModuleBase<unknown>;

export type DenoSystemsRoot = {
  systems: Record<string, DenoSystemCtor>;
};

export type CommandAction = (
  args: {
    flags: Record<string, string | undefined>;
    args: Record<string, string | undefined>;
  },
) => Promise<void> | void;

export type CliCommand = zod.input<typeof cliCommandActionBase> & {
  sub_commands?: CliCommand[];
};
export type CliCommandX = zod.infer<typeof cliCommandActionBase> & {
  sub_commands?: CliCommandX[];
};

export type CliCommandBinded = zod.input<typeof cliCommandBindedBase> & {
  sub_commands?: CliCommandBinded[];
};
export type CliCommandBindedX = zod.infer<typeof cliCommandBindedBase> & {
  sub_commands?: CliCommandBindedX[];
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
