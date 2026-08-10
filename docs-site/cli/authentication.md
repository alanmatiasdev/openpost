# Sign In From the CLI

The CLI signs in to a running OpenPost server over HTTPS. It never sees your password, TOTP code, passkey, or social account keys.

## Sign in with a browser

Browser login is the default:

```sh
openpost auth login http://localhost:8080
```

The CLI opens an OpenPost approval page and waits for you to approve or deny access. Before approval, choose one workspace or deliberate all-workspace access. A bound token can act only in the selected workspace and only while your account remains a member there.

After approval, the server creates an API token and returns it once. The CLI saves it for later commands. All-workspace access also applies to workspaces you join later, so use it only for account-wide automation.

## Sign in on a server

For SSH sessions or servers without a browser:

```sh
openpost auth login http://localhost:8080 --device
```

The CLI prints the verification URL and user code. Open that URL on another device, sign in, and approve the session.

## Sign in with a token

For automation, create an API token in **Settings → Developer access**, then pass it through stdin:

```sh
printf '%s\n' "$OPENPOST_TOKEN" | openpost auth login http://localhost:8080 --with-token
```

## Where the CLI saves tokens

By default, the CLI stores tokens in the operating system keyring through `github.com/zalando/go-keyring`.

If no keyring is available, `--insecure-storage` writes the token to an XDG `credentials.json` file with `0600` permissions. Anyone who can read that file can use the token.

## Token access

CLI tokens use `cli:full`. They can read and change workspaces, social accounts, posts, media, jobs, and API tokens. On the approval page or token form, limit the token to one workspace when it does not need access to all of them.

Use **Settings → Developer access** to see each token's status, expiration, last use, scope, and workspace boundary. Remove tokens you no longer use. See [API Tokens](/development/api-tokens) for the complete scope and lifetime contract.
