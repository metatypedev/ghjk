function home_dir(): string | null {
  switch (Deno.build.os) {
    case "linux":
    case "darwin":
      return Deno.env.get("HOME") ?? null;
    case "windows":
      return Deno.env.get("USERPROFILE") ?? null;
    default:
      return null;
  }
}

export function dirs() {
  const home = home_dir();
  if (!home) {
    throw new Error("cannot find home dir");
  }
  return { homeDir: home, shareDir: `${home}/.local/share/ghjk` };
}

export const AVAIL_CONCURRENCY = Number.parseInt(
  Deno.env.get("DENO_JOBS") ?? "1",
);

if (Number.isNaN(AVAIL_CONCURRENCY)) {
  throw new Error(`Value of DENO_JOBS is NAN: ${Deno.env.get("DENO_JOBS")}`);
}


export async function importRaw(spec: string) {
  const url = new URL(spec);
  if (url.protocol == "file:") {
    return await Deno.readTextFile(url.pathname);
  }
  if (url.protocol.match(/^http/)) {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`error importing raw using fetch from ${spec}: ${resp.status} - ${resp.statusText}`);
    }
    return await resp.text();
  }
  throw new Error(`error importing raw from ${spec}: unrecognized protocol ${url.protocol}`);
}
