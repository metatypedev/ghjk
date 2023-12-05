// TODO:

// SKETCH
/*
- Host runs ghjk.ts in a "./host/deno.ts" Worker sandbox to get serialized config
- Serialized config describes meta of all specified Tasks
- Host runs ghjk.ts in a Task specific Worker config instructing it to exec task Foo
    - When run in Task Worker, ghjk.ts will only execute the instructed Task
    - ghjk.ts task items are just mainly deno functions.
        - dax is provided by default to make shelling out ergonmic
        - We shim up Port installs in the environment/PATH to make tools avail

This is a pretty much deno agnostic design. Unix inspired.

Host program -> Config program
Host program -> Task program(s)

It just so happens our programs are Workers and the both the tasks
and configs are defined in a single file. The current design should
hopefully make it extensible if that's ever desired.
*/
