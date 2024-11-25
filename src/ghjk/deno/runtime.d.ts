type JsonLiteral = string | number | boolean | null;

export type JsonObject = { [key: string]: Json };
export type JsonArray = Json[];
export type Json = JsonLiteral | JsonObject | JsonArray;

type GhjkNs = {
  blackboard: {
    get: (key: string) => Json | undefined;
    set: (key: string, value: Json) => Json | undefined;
  };
};
export const Ghjk: GhjkNs;
