import { DenoTaskDefArgs, task$ } from "../../files/mod.ts";
import { zod } from "../../deps/common.ts";
import {
  findEntryRecursive,
  importRaw,
  Path,
  unwrapZodRes,
} from "../../utils/mod.ts";

// NOTE: only limited subset of task featutres are avail.
// no environments and deps
const tasks: Record<string, DenoTaskDefArgs> = {
  "init-ts": {
    desc: "Create a typescript ghjkfile in the current directory.",
    async fn($, args) {
      {
        const ghjkdir = $.env["GHJK_DIR"] ??
          await findEntryRecursive($.workingDir, ".ghjk");
        if (ghjkdir) {
          throw new Error(
            `already in a ghjkdir context located at: ${ghjkdir}`,
          );
        }
      }
      const ghjkFilePath = $.workingDir.join("ghjk.ts");
      if (!await ghjkFilePath.exists()) {
        const templatePath = import.meta.resolve("./template.ts");
        const ghjkRoot = import.meta.resolve("../../");
        const template = await importRaw(templatePath);
        const final = template.replaceAll(
          /from "..\/..\/(.*)"; \/\/ template-import/g,
          `from "${ghjkRoot}$1";`,
        );
        await ghjkFilePath.writeText(final);
        $.logger.info("written ghjk.ts to", ghjkFilePath);
        await tasks["init-ts-lsp"].fn!($, args);
      }
    },
  },
  "init-ts-lsp": {
    desc:
      "Interactively configure working directory for best LSP support of ghjk.ts. Pass --yes to confirm every choice.",
    async fn($) {
      const all = $.argv[0] == "--yes";
      const ghjkfile = $.env["GHJKFILE"] ?? "ghjk.ts";
      const changeVscodeSettings = all || await $.confirm(
        `Configure deno lsp to selectively enable on ${ghjkfile} through .vscode/settings.json?`,
        {
          default: true,
        },
      );
      if (changeVscodeSettings) {
        const vscodeSettingsRaw = await $.prompt(
          "Path to .vscode/settings.json ghjk working dir",
          {
            default: ".vscode/settings.json",
          },
        );
        await handleVscodeSettings(
          $,
          ghjkfile,
          $.workingDir.join(vscodeSettingsRaw),
        );
      }
      const ghjkfilePath = $.workingDir.join(ghjkfile);
      if (await ghjkfilePath.exists()) {
        const content = await ghjkfilePath.readText();
        if (/@ts-nocheck/.test(content)) {
          $.logger.info(`@ts-nocheck detected in ${ghjkfile}, skipping`);
          return;
        }
        const changeGhjkts = await $.confirm(
          `Mark ${ghjkfile} with @ts-nocheck`,
          {
            default: true,
          },
        );
        if (changeGhjkts) {
          await ghjkfilePath.writeText(`
// @ts-nocheck: Ghjkfile based on Deno

${content}`);
        }
      }
    },
  },
};

async function handleVscodeSettings(
  $: ReturnType<typeof task$>,
  ghjkfile: string,
  vscodeSettings: Path,
) {
  if (!await vscodeSettings.exists()) {
    $.logger.error(
      `No file detected at ${vscodeSettings}, creating a new one.`,
    );
    const config = {
      "deno.enablePaths": [
        ghjkfile,
      ],
    };
    vscodeSettings.writeJsonPretty(config);
    $.logger.info(`Wrote config to ${vscodeSettings}`, config);
    return;
  }

  const schema = zod.object({
    "deno.enablePaths": zod.string().array().optional(),
    "deno.disablePaths": zod.string().array().optional(),
    deno: zod.object({
      enablePaths: zod.string().array().optional(),
      disablePaths: zod.string().array().optional(),
    }).passthrough().optional(),
  }).passthrough();

  const originalConfig = await vscodeSettings.readJson()
    .catch((err) => {
      throw new Error(`error parsing JSON at ${vscodeSettings}`, {
        cause: err,
      });
    });
  const parsedConfig = unwrapZodRes(schema.safeParse(originalConfig), {
    originalConfig,
  }, "unexpected JSON discovored at .vscode/settings.json");

  let writeOut = false;

  if (parsedConfig["deno.enablePaths"]) {
    if (!parsedConfig["deno.enablePaths"].includes(ghjkfile)) {
      $.logger.info(
        `Adding ${ghjkfile} to "deno.enablePaths"`,
      );
      parsedConfig["deno.enablePaths"].push(ghjkfile);
      writeOut = true;
    } else {
      $.logger.info(
        `Detected ${ghjkfile} in "deno.enablePaths", skipping`,
      );
    }
  } else if (parsedConfig.deno?.enablePaths) {
    if (!parsedConfig.deno.enablePaths.includes(ghjkfile)) {
      $.logger.info(
        `Adding ${ghjkfile} to deno.enablePaths`,
      );
      parsedConfig.deno.enablePaths.push(ghjkfile);
      writeOut = true;
    } else {
      $.logger.info(
        `Detected ${ghjkfile} in deno.enablePaths, skipping`,
      );
    }
  } else if (parsedConfig["deno.disablePaths"]) {
    if (parsedConfig["deno.disablePaths"].includes(ghjkfile)) {
      throw new Error(
        `${ghjkfile} detected in "deno.disablePaths". Confused :/`,
      );
    } else {
      $.logger.info(
        `No ${ghjkfile} in "deno.disablePaths", skipping`,
      );
    }
  } else if (parsedConfig.deno?.disablePaths) {
    if (parsedConfig.deno.disablePaths.includes(ghjkfile)) {
      throw new Error(
        `${ghjkfile} detected in deno.disablePaths. Confused :/`,
      );
    } else {
      $.logger.info(
        `No ${ghjkfile} in deno.disablePaths, skipping`,
      );
    }
  } else {
    parsedConfig["deno.enablePaths"] = [ghjkfile];
    writeOut = true;
    $.logger.info(
      `Adding ${ghjkfile} to "deno.enablePaths"`,
    );
  }
  if (writeOut) {
    vscodeSettings.writeJsonPretty(parsedConfig);
    $.logger.info(`Wrote config to ${vscodeSettings}`, parsedConfig);
  }
}
export default tasks;
