# Known issues

## Cache invalidation of imported scripts

Currently, ghjk is unable to track changes to local typescript files imported by the ghjk.ts file.
You can fore re-serialization of the ghjkfile by deleting the `.ghjk/hash.json` file.

## Github API rate-limit

The Github API is rate-limited to 60 calls per hour for un-authenticated requests. 
Since many of the ports get their files from github releases, its easy to get past this limit especially in CI contexts.
This will manifest in failed 403 responses from ports trying to access the Github API.

The best solution to this problem is to provide Github authentication tokens using the `GITHUB_TOKEN` environment variable. 
Authenticated requests have a rate-limit of 5000 calls per hour.
Most of the ports will make use of this in their API calls if this environment variable is detected.

If you're using Github CI runners, this environment variable is [automatically](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication) provided for you.
Otherwise, you'll need to generate [personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) which can be used for this purpose.
More information on the Github rate limits can be found [here](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28).

## Leaking secure Github tokens

Currently, any values captured by ports have to be persisted in the lockfile.
As most ports today make use of the `GITHUB_TOKEN` environment variable, it's easy to leak these tokens into the ghjk lockfile which is intended to be committed.
Until a better solution can be devised for this, it's recommended to avoid using `GITHUB_TOKEN`s on the development machine where commits are authored.
If the token ends up in your lockfile, be sure to clean it out before a commit is made.

```bash
rm .ghjk/lock.json
# this command will re-resolve all ports
ghjk p resolve
```
