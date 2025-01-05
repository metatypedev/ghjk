use crate::interlude::*;

use crate::config::Config;

#[derive(clap::Subcommand, Debug)]
pub enum PrintCommands {
    /// Print the path to the data dir used by ghjk
    DataDirPath,
    /// Print the path to the dir of the currently active ghjk context
    GhjkdirPath,
    /// Print the path of the ghjkfile used
    GhjkfilePath,
    /// Print the currently resolved configuration
    Config,
    /// Print the extracted and serialized config from the ghjkfile
    Serialized {
        /* /// Use json format when printing config
        #[arg(long)]
        json: bool, */
    },
}

impl PrintCommands {
    /// The return value specifies weather or not the CLI is done or
    /// weather it should continue on with serialization if this
    /// action was invoked as part of the quick cli
    pub fn action(
        self,
        cli_config: &Config,
        serialized_config: Option<&crate::host::SerializedConfig>,
    ) -> Res<bool> {
        Ok(match self {
            PrintCommands::DataDirPath => {
                println!("{}", cli_config.data_dir.display());
                true
            }
            PrintCommands::GhjkdirPath => {
                if let Some(path) = &cli_config.ghjkdir {
                    // TODO: graceful termination on SIGPIPE
                    println!("{}", path.display());
                    true
                } else {
                    eyre::bail!("no ghjkdir found.");
                }
            }
            PrintCommands::GhjkfilePath => {
                if let Some(path) = &cli_config.ghjkdir {
                    println!("{}", path.display());
                    true
                } else {
                    eyre::bail!("no ghjkfile found.");
                }
            }
            PrintCommands::Serialized { .. } => match serialized_config {
                Some(config) => {
                    let serialized_json = serde_json::to_string_pretty(&config)?;
                    println!("{serialized_json}");
                    true
                }
                None => false,
            },
            PrintCommands::Config {} => {
                let conf_json = serde_json::to_string_pretty(&cli_config)?;
                println!("{conf_json}");
                true
            }
        })
    }
}
