# Snip CLI

A zero-dependency Node.js command-line client for the Snip URL shortener.
Requires Node.js 20 or newer.

```sh
node cli.js help
node cli.js add https://example.com
node cli.js ls
node cli.js open <code>
```

Set `SNIP_API` to the backend origin when it is not `http://localhost:3000`.
The `snip`, `snip.cmd`, and `snip.ps1` wrappers forward their arguments to
`cli.js` on POSIX shells, Windows Command Prompt, and PowerShell respectively.
