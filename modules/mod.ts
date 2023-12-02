export * as std_modules from "./std.ts";
import { cliffy_cmd } from "../deps/cli.ts";

export abstract class ModuleBase {
  abstract command<C>(): cliffy_cmd.Command<any, any, any, any>;
}
