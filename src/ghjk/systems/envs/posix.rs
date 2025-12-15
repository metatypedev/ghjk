use crate::interlude::*;
use std::fmt::Write;

use super::{types::WellKnownEnvRecipe, types::WellKnownProvision, EnvsCtx};

type AliasSpec = (String, Vec<String>, Option<String>, Option<Vec<String>>);

pub async fn cook(
    ecx: &EnvsCtx,
    recipe: &WellKnownEnvRecipe,
    env_key: &str,
    env_name: Option<&str>,
    env_dir: &Path,
    create_shell_loaders: bool,
) -> Res<IndexMap<String, String>> {
    if env_dir.exists() {
        tokio::fs::remove_dir_all(env_dir).await?;
    }
    tokio::fs::create_dir_all(env_dir).await?;

    let shim_dir = env_dir.join("shims");
    let bin_shim_dir = shim_dir.join("bin");
    let lib_shim_dir = shim_dir.join("lib");
    let include_shim_dir = shim_dir.join("include");

    // Create all shim directories concurrently
    let (_, _, _) = tokio::try_join!(
        tokio::fs::create_dir_all(&bin_shim_dir),
        tokio::fs::create_dir_all(&lib_shim_dir),
        tokio::fs::create_dir_all(&include_shim_dir)
    )?;

    let mut bin_paths = vec![];
    let mut lib_paths = vec![];
    let mut include_paths = vec![];
    let mut vars: IndexMap<String, String> = IndexMap::new();
    // Prefer env_name for GHJK_ENV if provided, else use env_key
    let ghjk_env_val = env_name.unwrap_or(env_key).to_string();
    vars.insert("GHJK_ENV".to_string(), ghjk_env_val);
    let mut on_enter_hooks: Vec<(String, Vec<String>)> = vec![];
    let mut on_exit_hooks: Vec<(String, Vec<String>)> = vec![];
    let mut aliases: Vec<AliasSpec> = vec![];

    for item in &recipe.provides {
        match item {
            WellKnownProvision::PosixExec { absolute_path } => {
                bin_paths.push(absolute_path.clone());
            }
            WellKnownProvision::PosixSharedLib { absolute_path } => {
                lib_paths.push(absolute_path.clone());
            }
            WellKnownProvision::PosixHeaderFile { absolute_path } => {
                include_paths.push(absolute_path.clone());
            }
            WellKnownProvision::PosixEnvVar { key, val } => {
                if vars.contains_key(key) {
                    eyre::bail!("env var conflict cooking unix env: key \"{}\" has entries \"{}\" and \"{}\"", key, vars[key], val);
                }
                vars.insert(key.clone(), val.clone());
            }
            WellKnownProvision::HookOnEnterPosixExec { program, arguments } => {
                on_enter_hooks.push((program.clone(), arguments.clone()));
            }
            WellKnownProvision::HookOnExitPosixExec { program, arguments } => {
                on_exit_hooks.push((program.clone(), arguments.clone()));
            }
            WellKnownProvision::GhjkPortsInstall { .. } => {
                // do nothing
            }
            WellKnownProvision::GhjkShellAlias {
                alias_name,
                command,
                description,
                wraps,
            } => {
                aliases.push((
                    alias_name.clone(),
                    command.clone(),
                    description.clone(),
                    wraps.clone(),
                ));
            }
            WellKnownProvision::PosixShellCompletionBash { .. }
            | WellKnownProvision::PosixShellCompletionZsh { .. }
            | WellKnownProvision::PosixShellCompletionFish { .. } => {}
        }
    }

    // Build alias label for execs: prefer env_name, else truncated env_key (first 6 chars)
    fn sanitize_label(s: &str) -> String {
        s.chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect()
    }
    let short_key: String = env_key.chars().take(6).collect();
    let env_label = sanitize_label(env_name.unwrap_or(&short_key));

    let (bin_levels, lib_levels, include_levels, _) = tokio::try_join!(
        shim_link_paths(&bin_paths, &bin_shim_dir, Some(env_label.as_str())),
        shim_link_paths(&lib_paths, &lib_shim_dir, None),
        shim_link_paths(&include_paths, &include_shim_dir, None),
        async {
            tokio::fs::write(
                env_dir.join("recipe.json"),
                serde_json::to_string_pretty(&recipe)?,
            )
            .await
            .wrap_err("failed to write recipe.json")
        }
    )?;

    let ld_library_env = match std::env::consts::OS {
        "macos" => "DYLD_LIBRARY_PATH",
        "linux" => "LD_LIBRARY_PATH",
        _ => eyre::bail!("unsupported os {}", std::env::consts::OS),
    };

    // Build path_vars including spillover directories for each category
    let mut path_vars: IndexMap<String, Vec<PathBuf>> = IndexMap::new();
    let dirs_for = |base: &str, levels: usize| -> Vec<PathBuf> {
        let mut v = Vec::new();
        let mut i = 1;
        while i <= levels.max(1) {
            let name = if i == 1 {
                base.to_string()
            } else {
                format!("{}{}", base, i)
            };
            v.push(env_dir.join("shims").join(name));
            i += 1;
        }
        v
    };
    path_vars.insert("PATH".to_string(), dirs_for("bin", bin_levels));
    let lib_dirs = dirs_for("lib", lib_levels);
    path_vars.insert("LIBRARY_PATH".to_string(), lib_dirs.clone());
    path_vars.insert(ld_library_env.to_string(), lib_dirs);
    let include_dirs = dirs_for("include", include_levels);
    path_vars.insert("C_INCLUDE_PATH".to_string(), include_dirs.clone());
    path_vars.insert("CPLUS_INCLUDE_PATH".to_string(), include_dirs);

    if create_shell_loaders {
        write_activators(
            ecx,
            recipe,
            env_dir,
            &vars,
            &path_vars,
            &on_enter_hooks,
            &on_exit_hooks,
            &aliases,
        )
        .await?;
    }

    // Combine vars and path_vars to return all environment variables
    let mut env_vars = vars;
    for (k, vals) in path_vars.into_iter() {
        let joined = vals
            .into_iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(":");
        env_vars.insert(k, joined);
    }
    Ok(env_vars)
}

async fn shim_link_paths(
    target_paths: &[PathBuf],
    shim_dir: &Path,
    alias_env_label: Option<&str>,
) -> Res<usize> {
    // Expand globs
    let mut expanded: Vec<PathBuf> = Vec::new();
    for path in target_paths {
        let path_str = path.to_str().ok_or_else(|| ferr!("invalid path"))?;
        if path_str.contains('*') {
            for entry in glob::glob(path_str)? {
                expanded.push(entry?);
            }
        } else {
            expanded.push(path.clone());
        }
    }

    // Group by basename
    let mut by_name: HashMap<String, Vec<PathBuf>> = HashMap::new();
    for entry in expanded {
        let file_name = entry
            .file_name()
            .ok_or_else(|| ferr!("no file name"))?
            .to_string_lossy()
            .to_string();
        by_name.entry(file_name).or_default().push(entry);
    }

    // Determine category from shim_dir name and shims root
    let cat = shim_dir
        .file_name()
        .ok_or_else(|| ferr!("invalid shim dir"))?
        .to_string_lossy()
        .to_string();
    let shims_root = shim_dir
        .parent()
        .ok_or_else(|| ferr!("invalid shims root"))?;

    let mut max_level = 1usize;

    for (name, entries) in by_name {
        for (i, entry) in entries.iter().enumerate() {
            let level = i + 1; // 1-based
            if level > max_level {
                max_level = level;
            }
            let target_dir = if level == 1 {
                shim_dir.to_path_buf()
            } else {
                let dname = format!("{}{}", &cat, level);
                let dpath = shims_root.join(dname);
                if !tokio::fs::try_exists(&dpath).await? {
                    tokio::fs::create_dir_all(&dpath).await?;
                }
                dpath
            };
            let shim_path = target_dir.join(&name);
            if tokio::fs::try_exists(&shim_path).await? {
                tokio::fs::remove_file(&shim_path).await?;
            }
            tokio::fs::symlink(entry, &shim_path).await?;

            // Always create alias symlink in base bin dir if requested
            if cat == "bin" {
                if let Some(label) = alias_env_label {
                    let alias_name = format!("{}-{}-{}", &name, label, level);
                    let alias_path = shim_dir.join(alias_name);
                    if tokio::fs::try_exists(&alias_path).await? {
                        tokio::fs::remove_file(&alias_path).await?;
                    }
                    tokio::fs::symlink(entry, &alias_path).await?;
                }
            }
        }
    }

    Ok(max_level)
}

#[allow(clippy::too_many_arguments)]
async fn write_activators(
    ecx: &EnvsCtx,
    reduced_recipe: &WellKnownEnvRecipe,
    env_dir: &Path,
    env_vars: &IndexMap<String, String>,
    path_vars: &IndexMap<String, Vec<PathBuf>>,
    on_enter_hooks: &[(String, Vec<String>)],
    on_exit_hooks: &[(String, Vec<String>)],
    aliases: &[AliasSpec],
) -> Res<()> {
    let ghjk_dir_var = "_ghjk_dir";
    let data_dir_var = "_ghjk_data_dir";

    let ghjk_dir_str = ecx.ghjkdir_path.to_string_lossy();
    let data_dir_str = ecx.gcx.config.data_dir.to_string_lossy();
    let ghjk_exec_path = ecx.gcx.exec_path.to_string_lossy();

    // Build separate replacements for POSIX and fish to match their var syntaxes
    let mut path_vars_replaced_posix: IndexMap<String, Vec<String>> = IndexMap::new();
    let mut path_vars_replaced_fish: IndexMap<String, Vec<String>> = IndexMap::new();
    for (k, vals) in path_vars {
        let posix_vals = vals
            .iter()
            .map(|v| v.to_string_lossy().to_string())
            .map(|s| {
                s.replace(&ghjk_dir_str[..], &format!("${{{}}}", ghjk_dir_var))
                    .replace(&data_dir_str[..], &format!("${{{}}}", data_dir_var))
            })
            .collect::<Vec<_>>();
        // For fish, avoid variable references inside regex cleanup strings.
        // Use fully resolved absolute paths instead to prevent parse errors.
        let fish_vals = vals
            .iter()
            .map(|v| v.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        path_vars_replaced_posix.insert(k.clone(), posix_vals);
        path_vars_replaced_fish.insert(k.clone(), fish_vals);
    }

    let ghjk_shim_name = "__ghjk_shim";
    let on_enter_hooks_escaped: Vec<String> = on_enter_hooks
        .iter()
        .map(|(cmd, args)| {
            let mut parts = std::iter::once(cmd.clone())
                .chain(args.clone())
                .collect::<Vec<_>>();
            if let Some(first) = parts.get_mut(0) {
                if first == "ghjk" {
                    *first = ghjk_shim_name.to_string();
                }
            }
            parts
                .into_iter()
                .map(|t| t.replace("\\", "\\\\").replace("'", "'\\''"))
                .map(|t| format!("'{}'", t))
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect();
    let on_exit_hooks_escaped: Vec<String> = on_exit_hooks
        .iter()
        .map(|(cmd, args)| {
            let mut parts = std::iter::once(cmd.clone())
                .chain(args.clone())
                .collect::<Vec<_>>();
            if let Some(first) = parts.get_mut(0) {
                if first == "ghjk" {
                    *first = ghjk_shim_name.to_string();
                }
            }
            parts
                .into_iter()
                .map(|t| t.replace("\\", "\\\\").replace("'", "'\\''"))
                .map(|t| format!("'{}'", t))
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect();

    // Collect completion scripts and write them next to activators
    let mut bash_comp = String::new();
    let mut zsh_comp = String::new();
    let mut fish_comp = String::new();
    for prov in &reduced_recipe.provides {
        match prov {
            WellKnownProvision::PosixShellCompletionBash { script } => {
                bash_comp.push('\n');
                bash_comp.push_str(script);
            }
            WellKnownProvision::PosixShellCompletionZsh { script } => {
                zsh_comp.push('\n');
                zsh_comp.push_str(script);
            }
            WellKnownProvision::PosixShellCompletionFish { script } => {
                fish_comp.push_str(script);
            }
            _ => {}
        }
    }
    let bash_comp_path = if !bash_comp.is_empty() {
        let p = env_dir.join("completions.bash");
        tokio::fs::write(&p, bash_comp).await?;
        Some(p)
    } else {
        None
    };
    let zsh_comp_path = if !zsh_comp.is_empty() {
        let p = env_dir.join("completions.zsh");
        tokio::fs::write(&p, zsh_comp).await?;
        Some(p)
    } else {
        None
    };
    let fish_comp_path = if !fish_comp.is_empty() {
        let p = env_dir.join("completions.fish");
        tokio::fs::write(&p, fish_comp).await?;
        Some(p)
    } else {
        None
    };

    let posix_script = build_posix_script(
        &ghjk_dir_str,
        &data_dir_str,
        bash_comp_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string()),
        zsh_comp_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string()),
        env_vars,
        &path_vars_replaced_posix,
        &on_enter_hooks_escaped,
        &on_exit_hooks_escaped,
        aliases,
        ghjk_dir_var,
        data_dir_var,
        ghjk_shim_name,
        &ghjk_exec_path,
    )?;
    let fish_script = build_fish_script(
        &ghjk_dir_str,
        &data_dir_str,
        env_vars,
        &path_vars_replaced_fish,
        &on_enter_hooks_escaped,
        &on_exit_hooks_escaped,
        aliases,
        ghjk_dir_var,
        data_dir_var,
        ghjk_shim_name,
        &ghjk_exec_path,
        fish_comp_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string()),
    )?;

    tokio::try_join!(
        tokio::fs::write(env_dir.join("activate.sh"), posix_script),
        tokio::fs::write(env_dir.join("activate.fish"), fish_script),
    )?;

    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn build_posix_script(
    ghjk_dir_str: &str,
    data_dir_str: &str,
    bash_comp_path: Option<String>,
    zsh_comp_path: Option<String>,
    env_vars: &IndexMap<String, String>,
    path_vars: &IndexMap<String, Vec<String>>,
    on_enter_hooks: &[String],
    on_exit_hooks: &[String],
    aliases: &[AliasSpec],
    ghjk_dir_var: &str,
    data_dir_var: &str,
    ghjk_shim_name: &str,
    ghjk_exec_path: &str,
) -> Res<String> {
    let mut posix_script = String::new();
    let buf = &mut posix_script;
    // posix shell version
    writeln!(
        buf,
        r#"
# shellcheck shell=sh
# shellcheck disable=SC2016
# shellcheck disable=SC1003
# SC2016: disabled because single quoted expressions are used for the cleanup scripts
# SC1003: disabled because we sometimes double escape single quotes strings
#         like '\''\\'\'''\'' which trigger the lint

# this file must be sourced from an existing sh/bash/zsh session using the `source` command
# it should not be executed directly

ghjk_deactivate () {{
    if [ -n "${{GHJK_CLEANUP_POSIX+x}}" ]; then
        eval "$GHJK_CLEANUP_POSIX"
        unset GHJK_CLEANUP_POSIX
    fi
}}

ghjk_deactivate

# the following variables are used to make the script more human readable
{ghjk_dir_var}="{ghjk_dir_str}"
{data_dir_var}="{data_dir_str}"

export GHJK_CLEANUP_POSIX="";

# env vars
# we keep track of old values before this script is run
# so that we can restore them on cleanup
"#
    )?;
    for (key, val) in env_vars {
        let safe_val = val.replace("\\", "\\\\").replace("'", "'\\''");
        // this avoids triggering unbound variable if -e is set
        // by defaulting to a value that's guaranteed to
        // be differeint than the actual val
        // TODO: avoid invalid key values elsewhere
        let guaranteed_different_val: String = val
            .replace("'", "")
            .replace("\"", "")
            .chars()
            .take(2)
            .collect();
        let safe_comp_key = format!("${{{key}:-_{guaranteed_different_val}}}");
        // single quote the supplied values to avoid
        // any embedded expansion/execution
        // also, single quote the entire test section to avoid
        // expansion when creating the cleanup
        // string (that's why we "escaped single quote" the value)
        // NOTE: no new line
        write!(
            buf,
            // we only restore the old $KEY value at cleanup if value of $KEY
            // is the one set by the activate script.
            // This avoids overwriting any values set post-activation
            r#"GHJK_CLEANUP_POSIX=$GHJK_CLEANUP_POSIX'[ "{safe_comp_key}" = '\''{safe_val}'\'' ] && '"#
        )?;
        {
            write!(
                buf,
                // if key is currently unset
                r#"$([ -z "${{{key}+x}}" ] "#
            )?;
            write!(
                buf,
                // just unset what we'd set
                r#"&& echo 'unset {key};' "#
            )?;
            writeln!(
                buf,
                // otherwise, capture the current (at time of activation)
                // $key value and recover it on cleanup
                // that needs to be wrapped wwith double quotes unlike the rest
                // i.e. export KEY='OLD $VALUE OF KEY'
                // but $VALUE won't be expanded when the cleanup actually runs
                // but during activation
                r#"|| echo 'export {key}='\'"${{{key}:-unreachable}}""';");"#
            )?;
        }

        writeln!(buf, r#"export {key}='{safe_val}';"#)?;
        writeln!(buf)?;
    }
    writeln!(
        buf,
        r#"

# path vars
"#
    )?;

    for (key, values) in path_vars {
        // cleanup each entry individually (exact match)
        for val in values {
            let safe_val = val.replace("\\", "\\\\").replace("'", "'\\''");
            writeln!(
                buf,
                r#"GHJK_CLEANUP_POSIX=$GHJK_CLEANUP_POSIX'{key}=$(echo "${key}" | tr ":" "\n" | grep -vE '\''"^{safe_val}$"'\'' | tr "\n" ":");{key}="${{{key}%:}}";';"#
            )?;
        }
        // prepend entries in order (bin first, then bin2, ...)
        for val in values.iter().rev() {
            let safe_val = val.replace("\\", "\\\\").replace("'", "'\\''");
            writeln!(buf, r#"export {key}="{safe_val}:${{{key}-}}";"#)?;
        }
        writeln!(buf)?;
    }
    let ghjk_shim = ghjk_shim_posix(ghjk_dir_str, ghjk_exec_path, ghjk_shim_name);
    writeln!(
        buf,
        r#"

# hooks that want to invoke ghjk are made to rely
# on this shim to improve reliability
{ghjk_shim}

"#
    )?;

    // aliases are available in both interactive and non-interactive shells
    writeln!(
        buf,
        r#"

# aliases
"#
    )?;

    for (alias_name, command, _desc, _wraps) in aliases {
        if is_reserved_posix(alias_name) {
            writeln!(
                buf,
                "        # skipped alias '{alias_name}': reserved posix name"
            )?;
            continue;
        }
        if !is_valid_posix_fn_name(alias_name) {
            writeln!(
                buf,
                "        # skipped alias '{alias_name}': invalid posix function name"
            )?;
            continue;
        }
        let mut cmd_vec = command.clone();
        if let Some(first) = cmd_vec.get_mut(0) {
            if first == "ghjk" {
                *first = ghjk_shim_name.to_string();
            }
        }
        let safe_command = cmd_vec
            .into_iter()
            .map(|t| t.replace("\\", "\\\\").replace("'", "'\\''"))
            .map(|t| format!("'{}'", t))
            .collect::<Vec<_>>()
            .join(" ");
        writeln!(buf, "{alias_name}() {{")?;
        writeln!(buf, "    {safe_command} \"$@\"")?;
        writeln!(buf, "}}")?;
    }

    // ensure aliases are cleaned up by ghjk_deactivate
    for (alias_name, _, _, _) in aliases {
        if is_reserved_posix(alias_name) || !is_valid_posix_fn_name(alias_name) {
            continue;
        }
        writeln!(
            buf,
            r#"GHJK_CLEANUP_POSIX=$GHJK_CLEANUP_POSIX'unset -f {alias_name};';"#
        )?;
    }
    writeln!(
        buf,
        r#"

# only run the hooks in interactive mode
case "$-" in
    *i*) # if the shell variables contain "i"

"#
    )?;

    writeln!(
        buf,
        r#"
    # on enter hooks
"#
    )?;
    for line in on_enter_hooks {
        writeln!(buf, "        {line}")?;
    }
    writeln!(
        buf,
        r#"
    # on exit hooks
"#
    )?;
    for line in on_exit_hooks {
        writeln!(
            buf,
            "        GHJK_CLEANUP_POSIX=$GHJK_CLEANUP_POSIX'{line};';"
        )?;
    }
    // completions: only in interactive mode, gate by detected shell, source external files
    writeln!(buf, "        # completions")?;
    writeln!(
        buf,
        "        if [ \"${{GHJK_COMPLETIONS:-activators}}\" != \"off\" ]; then"
    )?;
    writeln!(buf, "            if [ -n \"${{BASH_VERSION-}}\" ]; then")?;
    writeln!(
        buf,
        "                if command -v complete >/dev/null 2>&1; then"
    )?;
    if let Some(path) = &bash_comp_path {
        let safe_path = path.replace("\\", "\\\\").replace("'", "'\\''");
        writeln!(
            buf,
            "                    [ -s '{safe_path}' ] && . '{safe_path}'"
        )?;
    }
    writeln!(buf, "                fi")?;
    writeln!(buf, "            elif [ -n \"${{ZSH_VERSION-}}\" ]; then")?;
    writeln!(
        buf,
        "                if typeset -p _comps >/dev/null 2>&1; then"
    )?;
    if let Some(path) = &zsh_comp_path {
        let safe_path = path.replace("\\", "\\\\").replace("'", "'\\''");
        writeln!(
            buf,
            "                    [ -s '{safe_path}' ] && . '{safe_path}'"
        )?;
    }
    writeln!(buf, "                fi")?;
    writeln!(buf, "            fi")?;
    writeln!(buf, "        fi")?;
    writeln!(
        buf,
        r#"
        :
    ;;
    *)
        :
    ;;
esac

    "#
    )?;
    Ok(posix_script)
}

#[allow(clippy::too_many_arguments)]
fn build_fish_script(
    ghjk_dir_str: &str,
    data_dir_str: &str,
    env_vars: &IndexMap<String, String>,
    path_vars: &IndexMap<String, Vec<String>>,
    on_enter_hooks: &[String],
    on_exit_hooks: &[String],
    aliases: &[AliasSpec],
    ghjk_dir_var: &str,
    data_dir_var: &str,
    ghjk_shim_name: &str,
    ghjk_exec_path: &str,
    fish_comp_path: Option<String>,
) -> Res<String> {
    let mut fish_script = String::new();
    let buf = &mut fish_script;
    writeln!(
        buf,
        r#"
# this file must be sourced from an existing fish session using the `source` command
# it should be executed directly

function ghjk_deactivate
    if set --query GHJK_CLEANUP_FISH
        eval $GHJK_CLEANUP_FISH
        set --erase GHJK_CLEANUP_FISH
    end
end
ghjk_deactivate


# the following variables are used to make the script more human readable
set {ghjk_dir_var} "{ghjk_dir_str}"
set {data_dir_var} "{data_dir_str}"

# env vars
# we keep track of old values before this script is run
# so that we can restore them on cleanup
"#
    )?;
    for (key, val) in env_vars {
        let safe_val = val.replace("\\", "\\\\").replace("'", "'\\''");
        // read the comments from the posix version of this section
        // the fish version is notably simpler since
        // - we can escape single quotes within single quotes
        // - we don't have to deal with 'set -o nounset'
        write!(
            // NOTE: no new line
            buf,
            r#"set --global --append GHJK_CLEANUP_FISH 'test "${key}" = \'{safe_val}\'; and '"#
        )?;
        writeln!(
            buf,
            r#"(if set -q {key}; echo 'set --global --export {key} \''"${key}""';"; else; echo 'set -e {key};'; end;);"#
        )?;
        writeln!(buf, r#"set --global --export {key} '{safe_val}';"#)?;
        writeln!(buf)?;
    }
    writeln!(
        buf,
        r#"

# path vars
"#
    )?;

    for (key, values) in path_vars {
        // prepend all entries in order (bin, bin2, ...)
        for val in values.iter().rev() {
            let safe_val = val.replace("\\", "\\\\").replace("'", "'\\''");
            writeln!(
                buf,
                r#"set --global --export --prepend {key} "{safe_val}";"#
            )?;
        }
        writeln!(buf)?;
    }
    let ghjk_shim = ghjk_shim_fish(ghjk_dir_str, ghjk_exec_path, ghjk_shim_name);
    writeln!(
        buf,
        r#"

# hooks that want to invoke ghjk are made to rely
# on this shim to improve reliability
{ghjk_shim}
"#
    )?;
    writeln!(buf, r#"# aliases"#)?;

    for (alias_name, command, description, wraps) in aliases {
        if is_reserved_fish(alias_name) {
            writeln!(buf, "# skipped alias '{alias_name}': reserved fish name")?;
            continue;
        }
        if !is_valid_fish_fn_name(alias_name) {
            writeln!(
                buf,
                "# skipped alias '{alias_name}': invalid fish function name"
            )?;
            continue;
        }
        let mut cmd_vec = command.clone();
        if let Some(first) = cmd_vec.get_mut(0) {
            if first == "ghjk" {
                *first = ghjk_shim_name.to_string();
            }
        }
        let safe_command = cmd_vec
            .join(" ")
            .replace("\\", "\\\\")
            .replace("'", "'\\''");
        let desc_flag = match description {
            Some(d) if !d.is_empty() => {
                let d = d.replace("\\", "\\\\").replace("'", "'\\''");
                format!(" --description '{d}'")
            }
            _ => String::new(),
        };
        let wraps_flags = match wraps {
            None => String::new(),
            Some(list) if !list.is_empty() => {
                format!(
                    " --wraps='{}'",
                    list.iter()
                        .map(|w| w.replace("\\", "\\\\").replace("'", "'\\''"))
                        .collect::<Vec<_>>()
                        .join(" ")
                )
            }
            Some(_) => eyre::bail!("wraps has empty array for alias {alias_name}"),
        };
        writeln!(
            buf,
            r#"
function {alias_name}{wraps_flags}{desc_flag}
    {safe_command} $argv
end
        "#
        )?;
    }
    writeln!(buf, r#"# cleanup task aliases"#)?;

    for (alias_name, _, _, _) in aliases {
        if is_reserved_fish(alias_name) || !is_valid_fish_fn_name(alias_name) {
            continue;
        }
        writeln!(
            buf,
            r#"set --global --append GHJK_CLEANUP_FISH 'functions -e {alias_name};'"#
        )?;
    }

    writeln!(
        buf,
        r#"
# only run the hooks in interactive mode
if status is-interactive;
    # on enter hooks
"#
    )?;
    for line in on_enter_hooks {
        writeln!(buf, "    {line}")?;
    }
    writeln!(
        buf,
        r#"
    # on exit hooks
"#
    )?;
    for line in on_exit_hooks {
        writeln!(
            buf,
            "    set --global --append GHJK_CLEANUP_FISH '{line};';"
        )?;
    }
    // source fish completion script only for interactive sessions
    // and only when GHJK_COMPLETIONS is not set to "off"
    writeln!(buf, "    # ghjk fish completions")?;
    writeln!(buf, "    if test \"$GHJK_COMPLETIONS\" != \"off\";")?;
    if let Some(path) = &fish_comp_path {
        let safe_path = path.replace("\\", "\\\\").replace("'", "'\\''");
        writeln!(buf, "        if test -s '{safe_path}';")?;
        writeln!(buf, "            source '{safe_path}'")?;
        writeln!(buf, "        end")?;
    }
    writeln!(buf, "    end")?;
    writeln!(
        buf,
        r#"
end
    "#
    )?;
    // (completions were embedded above inside the interactive block)
    Ok(fish_script)
}

/// Returns a simple POSIX shell function to invoke the ghjk CLI.
/// This shim assumes it's running inside the ghjk embedded deno runtime.
fn ghjk_shim_posix(ghjk_dir: &str, ghjk_exec_path: &str, function_name: &str) -> String {
    format!(
        r#"
{function_name} () {{
    GHJKDIR="{ghjk_dir}" \
    {ghjk_exec_path} "$@"
}}"#,
    )
}

/// Returns a simple fish function to invoke the ghjk CLI.
/// This shim assumes it's running inside the ghjk embedded deno runtime.
fn ghjk_shim_fish(ghjk_dir: &str, ghjk_exec_path: &str, function_name: &str) -> String {
    format!(
        r#"
function {function_name}
    GHJKDIR="{ghjk_dir}" \
    {ghjk_exec_path} $argv
end"#,
    )
}

// Validate that alias names are valid POSIX function names
fn is_valid_posix_fn_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if (c == '_' || c.is_ascii_alphabetic()) => {}
        _ => return false,
    }
    chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}

// POSIX reserved words and common builtins to avoid as function names
fn is_reserved_posix(name: &str) -> bool {
    // From POSIX sh reserved words plus common builtins that would be confusing
    const RESERVED: &[&str] = &[
        "!", "case", "do", "done", "elif", "else", "esac", "fi", "for", "if", "in", "then",
        "until", "while", "{", "}", "time", "function", //
        // common builtins
        "test", "[", "echo", "printf", "read", "cd", "alias", "unalias", "type", "hash", "true",
        "false", "pwd", "export", "unset", "shift", "getopts", "times", "umask", "ulimit",
        // high-risk external/common commands to avoid overshadowing
        "sudo",
    ];
    RESERVED.iter().any(|w| *w == name)
}

// Basic validation for fish function names
// - must start with a letter or underscore
// - subsequent characters may be letters, digits, underscores or hyphens
// - dots are disallowed here to avoid ambiguity
fn is_valid_fish_fn_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c == '_' || c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|c| c == '_' || c == '-' || c.is_ascii_alphanumeric())
}

// Fish reserved words and common builtins to avoid as function names
fn is_reserved_fish(name: &str) -> bool {
    const RESERVED: &[&str] = &[
        // Provided list
        "[",
        "_",
        "and",
        "argparse",
        "begin",
        "break",
        "builtin",
        "case",
        "command",
        "continue",
        "else",
        "end",
        "eval",
        "exec",
        "for",
        "function",
        "if",
        "not",
        "or",
        "read",
        "return",
        "set",
        "status",
        "string",
        "switch",
        "test",
        "time",
        "while",
        // some additional builtins/keywords
        "source",
        "alias",
        "functions",
        "set_color",
        "commandline",
        "emit",
        // avoid overshadowing common commands
        "sudo",
    ];
    RESERVED.iter().any(|w| *w == name)
}
