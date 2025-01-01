export type JsonLiteral = string | number | boolean | null;
export type JsonObject = { [key: string]: Json };
export type JsonArray = Json[];
export type Json = JsonLiteral | JsonObject | JsonArray;

type GhjkNs = {
  blackboard: {
    get: (key: string) => Json | undefined;
    set: (key: string, value: Json) => Json | undefined;
  };
  callbacks: {
    set: (key: string, fn: (arg: Json) => Json | Promise<Json>) => string;
  };
  hostcall: (key: string, args: Json) => Promise<Json>;
  dispatchException: (exception: any) => boolean;
};
export const Ghjk: GhjkNs;
