use crate::interlude::*;
use std::fmt::Write;

use super::{types::WellKnownEnvRecipe, types::WellKnownProvision, EnvsCtx};

pub async fn cook(
    ecx: &EnvsCtx,
    recipe: &WellKnownEnvRecipe,
    env_key: &str,
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
    let (_, _, _) = tokio::join!(
        tokio::fs::create_dir_all(&bin_shim_dir),
        tokio::fs::create_dir_all(&lib_shim_dir),
        tokio::fs::create_dir_all(&include_shim_dir)
    );

    let mut bin_paths = vec![];
    let mut lib_paths = vec![];
    let mut include_paths = vec![];
    let mut vars: IndexMap<String, String> = IndexMap::new();
    vars.insert("GHJK_ENV".to_string(), env_key.to_string());
    let mut on_enter_hooks: Vec<(String, Vec<String>)> = vec![];
    let mut on_exit_hooks: Vec<(String, Vec<String>)> = vec![];
    let mut aliases: Vec<(String, Vec<String>, Option<String>, Option<Vec<String>>)> = vec![];

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
        }
    }

    tokio::try_join!(
        shim_link_paths(&bin_paths, &bin_shim_dir),
        shim_link_paths(&lib_paths, &lib_shim_dir),
        shim_link_paths(&include_paths, &include_shim_dir),
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

    let path_vars = indexmap::indexmap! {
        "PATH".to_string() => env_dir.join("shims/bin"),
        "LIBRARY_PATH".to_string() => env_dir.join("shims/lib"),
        ld_library_env.to_string() => env_dir.join("shims/lib"),
        "C_INCLUDE_PATH".to_string() => env_dir.join("shims/include"),
        "CPLUS_INCLUDE_PATH".to_string() => env_dir.join("shims/include"),
    };

    if create_shell_loaders {
        write_activators(
            ecx,
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
    env_vars.extend(
        path_vars
            .into_iter()
            .map(|(key, val)| (key, val.to_string_lossy().to_string())),
    );
    Ok(env_vars)
}

async fn shim_link_paths(target_paths: &[PathBuf], shim_dir: &Path) -> Res<()> {
    let mut shims: HashMap<String, PathBuf> = HashMap::new();

    for path in target_paths {
        let path_str = path.to_str().ok_or_else(|| ferr!("invalid path"))?;
        if path_str.contains('*') {
            for entry in glob::glob(path_str)? {
                let entry = entry?;
                let file_name = entry
                    .file_name()
                    .ok_or_else(|| ferr!("no file name"))?
                    .to_str()
                    .unwrap()
                    .to_string();
                if shims.contains_key(&file_name) {
                    eyre::bail!("duplicate shim found for file: {}", file_name);
                }
                let shim_path = shim_dir.join(&file_name);
                if tokio::fs::try_exists(&shim_path).await? {
                    tokio::fs::remove_file(&shim_path).await?;
                }
                tokio::fs::symlink(&entry, &shim_path).await?;
                shims.insert(file_name, shim_path);
            }
        } else {
            let file_name = path
                .file_name()
                .ok_or_else(|| ferr!("no file name"))?
                .to_str()
                .unwrap()
                .to_string();
            if shims.contains_key(&file_name) {
                eyre::bail!("duplicate shim found for file: {}", file_name);
            }
            let shim_path = shim_dir.join(&file_name);
            if tokio::fs::try_exists(&shim_path).await? {
                tokio::fs::remove_file(&shim_path).await?;
            }
            tokio::fs::symlink(path, &shim_path).await?;
            shims.insert(file_name, shim_path);
        }
    }

    Ok(())
}

    async fn write_activators(
    ecx: &EnvsCtx,
    env_dir: &Path,
    env_vars: &IndexMap<String, String>,
    path_vars: &IndexMap<String, PathBuf>,
    on_enter_hooks: &[(String, Vec<String>)],
    on_exit_hooks: &[(String, Vec<String>)],
        aliases: &[(String, Vec<String>, Option<String>, Option<Vec<String>>) ],
) -> Res<()> {
    let ghjk_dir_var = "_ghjk_dir";
    let data_dir_var = "_ghjk_data_dir";

    let ghjk_dir_str = ecx.ghjkdir_path.to_string_lossy();
    let data_dir_str = ecx.gcx.config.data_dir.to_string_lossy();
    let ghjk_exec_path = ecx.gcx.exec_path.to_string_lossy();

    let mut path_vars_replaced = IndexMap::new();
    for (k, v) in path_vars {
        path_vars_replaced.insert(
            k.clone(),
            v.to_string_lossy()
                .replace(&ghjk_dir_str[..], &format!("${ghjk_dir_var}"))
                .replace(&data_dir_str[..], &format!("${data_dir_var}")),
        );
    }

    let ghjk_shim_name = "__ghjk_shim";
    let on_enter_hooks_escaped: Vec<String> = on_enter_hooks
        .iter()
        .map(|(cmd, args)| {
            let cmd = if cmd == "ghjk" { ghjk_shim_name } else { cmd };
            let safe_args = args.join(" ");
            format!("{cmd} {safe_args}").replace('\'', "'\\''")
        })
        .collect();
    let on_exit_hooks_escaped: Vec<String> = on_exit_hooks
        .iter()
        .map(|(cmd, args)| {
            let cmd = if cmd == "ghjk" { ghjk_shim_name } else { cmd };
            let safe_args = args.join(" ");
            format!("{cmd} {safe_args}").replace('\'', "'\\''")
        })
        .collect();

    let posix_script = build_posix_script(
        &ghjk_dir_str,
        &data_dir_str,
        env_vars,
        &path_vars_replaced,
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
        &path_vars_replaced,
        &on_enter_hooks_escaped,
        &on_exit_hooks_escaped,
        aliases,
        ghjk_dir_var,
        data_dir_var,
        ghjk_shim_name,
        &ghjk_exec_path,
    )?;

    tokio::try_join!(
        tokio::fs::write(env_dir.join("activate.sh"), posix_script),
        tokio::fs::write(env_dir.join("activate.fish"), fish_script),
    )?;

    Ok(())
}

fn build_posix_script(
    ghjk_dir_str: &str,
    data_dir_str: &str,
    env_vars: &IndexMap<String, String>,
    path_vars: &IndexMap<String, String>,
    on_enter_hooks: &[String],
    on_exit_hooks: &[String],
    aliases: &[(String, Vec<String>, Option<String>, Option<Vec<String>>)],
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
# SC2016: disabled because single quoted expressions are used for the cleanup scripts

# this file must be sourced from an existing sh/bash/zsh session using the `source` command
# it should be executed directly

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
        // by defaulting to a value that's guranteed to
        // be differeint than the actual val
        // TODO: avoid invalid key values elsewhere
        let guranteed_different_val = &val.replace("'", "").replace("\"", "")[0..2];
        let safe_comp_key = format!("${{{key}:-_{guranteed_different_val}}}");
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
                // otherwise, capture the current (at time of acivation)
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

    for (key, val) in path_vars {
        let safe_val = val.replace("\\", "\\\\").replace("'", "'\\''");

        // double quote the path vars for expansion
        // single quote GHJK_CLEANUP additions to avoid expansion/exec before eval
        writeln!(
            buf,
            r#"GHJK_CLEANUP_POSIX=$GHJK_CLEANUP_POSIX'{key}=$(echo "${key}" | tr ":" "\n" | grep -vE '\'"^{safe_val}"\'' | tr "\n" ":");{key}="${{{key}%:}}";';"#
        )?;
        // FIXME: we're allowing expansion in the value to allow
        // readable $ghjkDirVar usage
        // (for now safe since all paths are created within ghjk)
        writeln!(buf, r#"export {key}="{safe_val}:${{{key}-}}";"#)?;
        writeln!(buf)?;
    }
    let ghjk_shim = ghjk_shim_posix(ghjk_dir_str, ghjk_exec_path, ghjk_shim_name);
    writeln!(
        buf,
        r#"

# hooks that want to invoke ghjk are made to rely
# on this shim to improve reliablity
{ghjk_shim}
"#
    )?;

    writeln!(buf, r#"# aliases"#)?;

    // POSIX reserved words and common builtins to avoid as function names
    fn is_reserved_posix(name: &str) -> bool {
        // From POSIX sh reserved words plus common builtins that would be confusing
        const RESERVED: &[&str] = &[
            "!","case","do","done","elif","else","esac","fi","for","if","in","then","until","while","{","}","time","function",
            // common builtins
            "test","[","echo","printf","read","cd","alias","unalias","type","hash","true","false","pwd","export","unset","shift","getopts","times","umask","ulimit",
            // high-risk external/common commands to avoid overshadowing
            "sudo",
        ];
        RESERVED.iter().any(|w| *w == name)
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

    for (alias_name, command, _desc, _wraps) in aliases {
        if is_reserved_posix(alias_name) {
            writeln!(buf, "# skipped alias '{alias_name}': reserved posix name")?;
            continue;
        }
        if !is_valid_posix_fn_name(alias_name) {
            writeln!(buf, "# skipped alias '{alias_name}': invalid posix function name")?;
            continue;
        }
        let mut cmd_vec = command.clone();
        if let Some(first) = cmd_vec.get_mut(0) {
            if first == "ghjk" { *first = ghjk_shim_name.to_string(); }
        }
        // Argument safety: build a snippet that preserves argv boundaries.
        // We export each token quoted and then eval "$@" style forwarding.
        // Since we cannot easily rehydrate arrays in POSIX from static text, we rely on "$@".
        let safe_command = cmd_vec
            .into_iter()
            .map(|t| t.replace("\\", "\\\\").replace("'", "'\\''"))
            .map(|t| format!("'{}'", t))
            .collect::<Vec<_>>()
            .join(" ");
        writeln!(
            buf,
            r#"
{alias_name}() {{
    eval {safe_command} "$@"
}}
        "#
        )?;
    }
    writeln!(buf, r#"# cleanup task alises"#)?;

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

fn build_fish_script(
    ghjk_dir_str: &str,
    data_dir_str: &str,
    env_vars: &IndexMap<String, String>,
    path_vars: &IndexMap<String, String>,
    on_enter_hooks: &[String],
    on_exit_hooks: &[String],
    aliases: &[(String, Vec<String>, Option<String>, Option<Vec<String>>)],
    ghjk_dir_var: &str,
    data_dir_var: &str,
    ghjk_shim_name: &str,
    ghjk_exec_path: &str,
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
            r#"(if set -q ${key}; echo 'set --global --export {key} \''"${key}""';"; else; echo 'set -e {key};'; end;);"#
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

    for (key, val) in path_vars {
        let safe_val = val.replace("\\", "\\\\").replace("'", "'\\''");
        writeln!(
            buf,
            r#"set --global --append GHJK_CLEANUP_FISH 'set --global --export --path {key} (string match --invert --regex \''"^{safe_val}"'\' ${key});';"#
        )?;
        writeln!(
            buf,
            r#"set --global --export --prepend {key} "{safe_val}";"#
        )?;
        writeln!(buf)?;
    }
    let ghjk_shim = ghjk_shim_fish(ghjk_dir_str, ghjk_exec_path, ghjk_shim_name);
    writeln!(
        buf,
        r#"

# hooks that want to invoke ghjk are made to rely
# on this shim to improve reliablity
{ghjk_shim}
"#
    )?;
    writeln!(buf, r#"# aliases"#)?;

    // Fish reserved words and common builtins to avoid as function names
    fn is_reserved_fish(name: &str) -> bool {
        const RESERVED: &[&str] = &[
            // Provided list
            "[","_","and","argparse","begin","break","builtin","case","command","continue","else","end","eval","exec","for","function","if","not","or","read","return","set","status","string","switch","test","time","while",
            // some additional builtins/keywords
            "source","alias","functions","set_color","commandline","emit",
            // avoid overshadowing common commands
            "sudo"
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

    for (alias_name, command, description, wraps) in aliases {
        if is_reserved_fish(alias_name) { 
            writeln!(buf, "# skipped alias '{alias_name}': reserved fish name")?;
            continue;
        }
        if !is_valid_fish_fn_name(alias_name) {
            writeln!(buf, "# skipped alias '{alias_name}': invalid fish function name")?;
            continue;
        }
        let mut cmd_vec = command.clone();
        if let Some(first) = cmd_vec.get_mut(0) {
            if first == "ghjk" { *first = ghjk_shim_name.to_string(); }
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
            Some(list) if !list.is_empty() => list.iter().map(|w| {
                let w = w.replace("\\", "\\\\").replace("'", "'\\''");
                format!(" --wraps={w}")
            }).collect::<String>(),
            _ => String::new(),
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
    writeln!(buf, r#"# cleanup task alises"#)?;

    for (alias_name, _, _, _) in aliases {
        if is_reserved_fish(alias_name) || !is_valid_fish_fn_name(alias_name) { continue; }
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
    writeln!(
        buf,
        r#"
end
    "#
    )?;
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
