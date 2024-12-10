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

    pub action_cb_key: Option<String>,
}

impl CliCommandDesc {
    #[tracing::instrument(skip(scx))]
    pub fn into_clap(self, scx: super::DenoSystemsContext) -> crate::systems::SystemCliCommand {
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

        if let Some(val) = self.args {
            for (id, desc) in val {
                let arg = desc.into_clap(id);
                cmd = cmd.arg(arg);
            }
        }
        let flag_ids = if let Some(val) = self.flags {
            let mut ids = ahash::HashSet::default();
            for (id, desc) in val {
                ids.insert(id.clone());
                let arg = desc.into_clap(id);
                cmd = cmd.arg(arg);
            }
            ids
        } else {
            default()
        };
        let sub_commands = if let Some(val) = self.sub_commands {
            let mut subcommands = IndexMap::new();
            for desc in val {
                let id = desc.name.clone();
                let scmd = desc.into_clap(scx.clone());
                subcommands.insert(id.into(), scmd);
            }
            subcommands
        } else {
            default()
        };

        let action: Option<CliCommandAction> = if let Some(val) = self.action_cb_key {
            let flag_ids = Arc::new(flag_ids);
            let cb_key = CHeapStr::from(val);
            Some(Box::new(move |matches| {
                let scx = scx.clone();
                let flag_ids = flag_ids.clone();
                let cb_key = cb_key.clone();
                deno_cb_action(matches, scx.clone(), cb_key, flag_ids).boxed()
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
    flag_ids: Arc<ahash::HashSet<String>>,
) -> Res<()> {
    let mut flags = IndexMap::new();
    let mut args = IndexMap::new();

    let match_ids = matches
        .ids()
        .map(|id| id.as_str().to_owned())
        .collect::<Vec<_>>()
        .into_iter();
    for id in match_ids {
        let Some(value) = matches
            .try_remove_occurrences::<String>(id.as_str())
            .wrap_err_with(|| format!("error extracting match occurunce for {id}"))?
        else {
            continue;
        };
        let value: Vec<Vec<String>> = value.map(Iterator::collect).collect();
        let value = if value.len() == 1 && value[0].len() < 2 {
            serde_json::json!(value.first())
        } else if value.len() == 1 {
            serde_json::json!(value[0])
        } else {
            serde_json::json!(value)
        };

        let bucket = if flag_ids.contains(id.as_str()) {
            &mut flags
        } else {
            &mut args
        };

        bucket.insert(id.as_str().to_owned(), value);
    }
    scx.callbacks
        .exec(
            cb_key.clone(),
            serde_json::json!({
                "flags": flags,
                "args": args
            }),
        )
        .await
        .wrap_err("callback error")?;
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
    pub fn into_clap(self, id: String) -> clap::Arg {
        let mut arg = clap::Arg::new(id);

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

        if let Some(val) = self.value_name {
            arg = arg.value_name(val)
        }

        if let Some(val) = self.value_hint {
            arg = arg.value_hint(clap::ValueHint::from(val))
        }

        if let Some(val) = self.long {
            arg = arg.long(val)
        }
        if let Some(val) = self.long_aliases {
            arg = arg.aliases(val)
        };
        if let Some(val) = self.visible_long_aliases {
            arg = arg.visible_aliases(val)
        };

        if let Some(val) = self.short {
            arg = arg.short(val)
        };
        if let Some(val) = self.short_aliases {
            arg = arg.short_aliases(val)
        };
        if let Some(val) = self.visible_short_aliases {
            arg = arg.short_aliases(val)
        };

        if let Some(val) = self.env {
            arg = arg.env(val)
        };

        if let Some(val) = self.help {
            arg = arg.help(val)
        };

        if let Some(val) = self.long_help {
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
    pub fn into_clap(self, id: String) -> clap::Arg {
        let mut arg = self.arg.into_clap(id);

        if let Some(val) = self.long {
            arg = arg.long(val)
        }
        if let Some(val) = self.long_aliases {
            arg = arg.aliases(val)
        };
        if let Some(val) = self.visible_long_aliases {
            arg = arg.visible_aliases(val)
        };

        if let Some(val) = self.short {
            arg = arg.short(val)
        };
        if let Some(val) = self.short_aliases {
            arg = arg.short_aliases(val)
        };
        if let Some(val) = self.visible_short_aliases {
            arg = arg.short_aliases(val)
        };

        arg
    }
}

#[derive(Deserialize, Debug)]
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

#[derive(Deserialize, Debug)]
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
