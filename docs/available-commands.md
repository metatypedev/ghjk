<!-- TODO: refine -->

| Command | Description | Subcommands/Flags |
|----------------|-------------|-------------------|
| ```ghjk sync``` | Synchronize your shell to what's in your config. |  |
| ```ghjk envs ls``` | List environments defined in the ghjkfile. |  |
| ```ghjk envs activate <env name>``` | Activate an environment. |  |
| ```ghjk ports resolve``` | Resolve all installs declared in config. |  |
| ```ghjk ports outdated``` | Show a version table for installs. | `--update-all`: update all installs which their versions is not specified in the config. <br> `--update-only <install name>`: update a selected install |
| ```ghjk print``` | Emit different discovered and built values to stdout. |  |
| ```ghjk deno``` | Access the deno cli. |  |
| ```ghjk completions``` | Generate shell completions. |  |

You can use the following flag to get help around the CLI.
`ghjk --help` or `ghjk -h`
