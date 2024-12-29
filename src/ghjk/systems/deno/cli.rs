use crate::{interlude::*, systems::CliCommandAction};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CliCommandDesc {
    pub name: String,

    pub hide: Option<bool>,

    pub aliases: Option<Vec<String>>,
    pub visible_aliases: Option<Vec<String>>,

    pub about: Option<String>,
    pub before_help: Option<String>,
    pub before_long_help: Option<String>,

    pub args: Option<IndexMap<String, CliArgDesc>>,
    pub flags: Option<IndexMap<String, CliFlagDesc>>,
    pub sub_commands: Option<Vec<CliCommandDesc>>,

    pub disable_help_subcommand: Option<bool>,

    pub action_cb_key: Option<String>,
}

impl CliCommandDesc {
    #[tracing::instrument(skip(scx))]
    pub fn convert(self, scx: super::DenoSystemsContext) -> crate::systems::SystemCliCommand {
        let name = self.name;
        let mut cmd = clap::Command::new(name.clone()).name(name.clone());

        if let Some(val) = self.hide {
            cmd = cmd.hide(val)
        }
        if let Some(val) = self.aliases {
            cmd = cmd.aliases(val)
        }
        if let Some(val) = self.visible_aliases {
            cmd = cmd.visible_aliases(val)
        }
        if let Some(val) = &self.about {
            cmd = cmd.about(val)
        }
        if let Some(val) = self.before_help {
            cmd = cmd.before_help(val)
        }
        if let Some(val) = self.before_long_help {
            cmd = cmd.before_long_help(val)
        }
        if let Some(val) = self.disable_help_subcommand {
            cmd = cmd.disable_help_subcommand(val)
        }
        let flag_ids = if let Some(val) = &self.flags {
            let mut ids = ahash::HashSet::default();
            for (id, desc) in val {
                ids.insert(id.clone());
                let arg = desc.convert(id);
                cmd = cmd.arg(arg);
            }
            ids
        } else {
            default()
        };

        if let Some(val) = &self.args {
            for (id, desc) in val {
                if flag_ids.contains(id) {
                    panic!("flag and arg id clash at {id}");
                }
                let arg = desc.convert(id);
                cmd = cmd.arg(arg);
            }
        }
        let sub_commands = if let Some(val) = self.sub_commands {
            let mut subcommands = IndexMap::new();
            for desc in val {
                let id = desc.name.clone();
                let scmd = desc.convert(scx.clone());
                subcommands.insert(id.into(), scmd);
            }
            subcommands
        } else {
            default()
        };

        let action: Option<CliCommandAction> = if let Some(val) = self.action_cb_key {
            let cb_key = CHeapStr::from(val);
            let flags = self.flags.unwrap_or_default();
            let flags = Arc::new(flags);
            let args = self.args.unwrap_or_default();
            let args = Arc::new(args);
            Some(Box::new(move |matches| {
                let scx = scx.clone();
                let cb_key = cb_key.clone();
                let flags = flags.clone();
                let args = args.clone();
                deno_cb_action(matches, scx.clone(), cb_key, flags, args).boxed()
            }))
        } else {
            /* if sub_commands.is_empty() {
                error!("a system command has no action or subcommands attached");
            } */
            None
        };

        crate::systems::SystemCliCommand {
            name: name.into(),
            clap: cmd,
            sub_commands,
            action,
        }
    }
}

async fn deno_cb_action(
    mut matches: clap::ArgMatches,
    scx: super::DenoSystemsContext,
    cb_key: CHeapStr,
    flag_descs: Arc<IndexMap<String, CliFlagDesc>>,
    args_descs: Arc<IndexMap<String, CliArgDesc>>,
) -> Res<()> {
    let mut flags = IndexMap::new();
    let mut args = IndexMap::new();

    let match_ids = matches
        .ids()
        .map(|id| id.as_str().to_owned())
        .collect::<Vec<_>>()
        .into_iter();
    for id in match_ids {
        let Some(desc) = flag_descs
            .get(&id)
            .map(|flag| &flag.arg)
            .or_else(|| args_descs.get(&id))
        else {
            unreachable!("unspecified arg id found: {id}");
        };
        let value = match desc.action.unwrap_or(ArgActionSerde::Set) {
            ArgActionSerde::Set => matches
                .try_remove_one::<String>(id.as_str())
                .wrap_err_with(|| format!("error extracting match string for {id}"))?
                .map(|val| serde_json::json!(val)),
            ArgActionSerde::Append => matches
                .try_remove_many::<String>(id.as_str())
                .wrap_err_with(|| format!("error extracting match bool for {id}"))?
                .map(|vals| vals.collect::<Vec<_>>())
                .map(|val| serde_json::json!(val)),
            ArgActionSerde::SetTrue | ArgActionSerde::SetFalse => matches
                .try_remove_one::<bool>(id.as_str())
                .wrap_err_with(|| format!("error extracting match bool for {id}"))?
                .map(|val| serde_json::json!(val)),
            ArgActionSerde::Count => matches
                .try_remove_one::<i64>(id.as_str())
                .wrap_err_with(|| format!("error extracting match count for {id}"))?
                .map(|val| serde_json::json!(val)),
            ArgActionSerde::Help
            | ArgActionSerde::HelpShort
            | ArgActionSerde::HelpLong
            | ArgActionSerde::Version => unreachable!(),
        };
        let Some(value) = value else {
            continue;
        };

        let bucket = if flag_descs.contains_key(id.as_str()) {
            &mut flags
        } else {
            &mut args
        };

        bucket.insert(id.as_str().to_owned(), value);
    }
    let response = scx
        .callbacks
        .exec(
            cb_key.clone(),
            serde_json::json!({
                "flags": flags,
                "args": args
            }),
        )
        .await
        .wrap_err("callback error")?;
    debug!(?response, "system command action response");
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CliArgDesc {
    pub required: Option<bool>,
    pub global: Option<bool>,
    pub hide: Option<bool>,
    pub exclusive: Option<bool>,
    pub trailing_var_arg: Option<bool>,
    pub allow_hyphen_values: Option<bool>,

    pub action: Option<ArgActionSerde>,

    pub value_name: Option<String>,
    pub value_hint: Option<ValueHintSerde>,

    pub long: Option<String>,
    pub long_aliases: Option<Vec<String>>,
    pub visible_long_aliases: Option<Vec<String>>,

    pub short: Option<char>,
    pub short_aliases: Option<Vec<char>>,
    pub visible_short_aliases: Option<Vec<char>>,

    pub env: Option<String>,

    pub help: Option<String>,
    pub long_help: Option<String>,
}

impl CliArgDesc {
    pub fn convert(&self, id: &str) -> clap::Arg {
        let mut arg = clap::Arg::new(id.to_owned());

        if let Some(val) = self.required {
            arg = arg.required(val)
        }
        if let Some(val) = self.global {
            arg = arg.global(val)
        }
        if let Some(val) = self.hide {
            arg = arg.hide(val)
        }
        if let Some(val) = self.exclusive {
            arg = arg.exclusive(val)
        }
        if let Some(val) = self.trailing_var_arg {
            arg = arg.num_args(..).trailing_var_arg(val)
        }
        if let Some(val) = self.allow_hyphen_values {
            arg = arg.allow_hyphen_values(val)
        }

        if let Some(val) = self.action {
            arg = arg.action(clap::ArgAction::from(val))
        }

        if let Some(val) = &self.value_name {
            arg = arg.value_name(val)
        }

        if let Some(val) = self.value_hint {
            arg = arg.value_hint(clap::ValueHint::from(val))
        }

        if let Some(val) = &self.long {
            arg = arg.long(val)
        }
        if let Some(val) = &self.long_aliases {
            arg = arg.aliases(val)
        };
        if let Some(val) = &self.visible_long_aliases {
            arg = arg.visible_aliases(val)
        };

        if let Some(val) = self.short {
            arg = arg.short(val)
        };
        if let Some(val) = &self.short_aliases {
            arg = arg.short_aliases(val.clone())
        };
        if let Some(val) = &self.visible_short_aliases {
            arg = arg.short_aliases(val.clone())
        };

        if let Some(val) = &self.env {
            arg = arg.env(val)
        };

        if let Some(val) = &self.help {
            arg = arg.help(val)
        };

        if let Some(val) = &self.long_help {
            arg = arg.long_help(val)
        };

        arg
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CliFlagDesc {
    #[serde(flatten)]
    pub arg: CliArgDesc,

    pub long: Option<String>,
    pub long_aliases: Option<Vec<String>>,
    pub visible_long_aliases: Option<Vec<String>>,

    pub short: Option<char>,
    pub short_aliases: Option<Vec<char>>,
    pub visible_short_aliases: Option<Vec<char>>,
}

impl CliFlagDesc {
    pub fn convert(&self, id: &str) -> clap::Arg {
        let mut arg = self.arg.convert(id);

        if let Some(val) = &self.long {
            arg = arg.long(val)
        }
        if let Some(val) = &self.long_aliases {
            arg = arg.aliases(val)
        };
        if let Some(val) = &self.visible_long_aliases {
            arg = arg.visible_aliases(val)
        };

        if let Some(val) = self.short {
            arg = arg.short(val)
        };
        if let Some(val) = &self.short_aliases {
            arg = arg.short_aliases(val.clone())
        };
        if let Some(val) = &self.visible_short_aliases {
            arg = arg.short_aliases(val.clone())
        };

        arg
    }
}

#[derive(Deserialize, Debug, Clone, Copy)]
pub enum ValueHintSerde {
    Unknown,
    Other,
    AnyPath,
    FilePath,
    DirPath,
    ExecutablePath,
    CommandName,
    CommandString,
    CommandWithArguments,
    Username,
    Hostname,
    Url,
    EmailAddress,
}

impl From<ValueHintSerde> for clap::ValueHint {
    fn from(val: ValueHintSerde) -> Self {
        use ValueHintSerde::*;
        match val {
            Unknown => clap::ValueHint::Unknown,
            Other => clap::ValueHint::Unknown,
            AnyPath => clap::ValueHint::Unknown,
            FilePath => clap::ValueHint::Unknown,
            DirPath => clap::ValueHint::Unknown,
            ExecutablePath => clap::ValueHint::Unknown,
            CommandName => clap::ValueHint::Unknown,
            CommandString => clap::ValueHint::Unknown,
            CommandWithArguments => clap::ValueHint::Unknown,
            Username => clap::ValueHint::Unknown,
            Hostname => clap::ValueHint::Unknown,
            Url => clap::ValueHint::Unknown,
            EmailAddress => clap::ValueHint::Unknown,
        }
    }
}

#[derive(Deserialize, Debug, Clone, Copy)]
pub enum ArgActionSerde {
    Set,
    Append,
    SetTrue,
    SetFalse,
    Count,
    Help,
    HelpShort,
    HelpLong,
    Version,
}

impl From<ArgActionSerde> for clap::ArgAction {
    fn from(val: ArgActionSerde) -> Self {
        use ArgActionSerde::*;
        match val {
            Set => clap::ArgAction::Set,
            Append => clap::ArgAction::Append,
            SetTrue => clap::ArgAction::SetTrue,
            SetFalse => clap::ArgAction::SetFalse,
            Count => clap::ArgAction::Count,
            Help => clap::ArgAction::Help,
            HelpShort => clap::ArgAction::HelpShort,
            HelpLong => clap::ArgAction::HelpLong,
            Version => clap::ArgAction::Version,
        }
    }
}
