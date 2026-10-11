# OpenCode npm interception

Dependency Zero can vet an agent's `npm install` **before the command runs**, so
an agent does not have to remember to invoke the firewall first.

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Installation and activation](#installation-and-activation)
- [Confirming the plugin is loaded](#confirming-the-plugin-is-loaded)
- [What is protected](#what-is-protected)
- [Outcomes](#outcomes)
- [Limitations and known bypasses](#limitations-and-known-bypasses)
- [Audit trail](#audit-trail)
- [Testing](#testing)

## What it does

OpenCode's agent shell tool receives a command like:

```
npm install axios@1.7.2
```

Before that command is handed to the shell, Dependency Zero:

1. Decides whether the command is an npm package installation.
2. Scans each named package with the **same** scanner the console and CLI use.
3. Applies the **same** `decide()` policy.
4. Writes an **audit event** to the same store.
5. Throws — refusing the command — unless the verdict is `ALLOW`.

On `ALLOW` the plugin does nothing at all. It does not rewrite, reorder or
re-issue the command. The agent's own shell runs the original string exactly
once. There is no second install and no command transformation to get wrong.

## How it works

```
agent -> OpenCode shell tool
          |
          v
   tool.execute.before  ---- plugin: classifyCommand()
          |                       |
          |                  not an install?  --> return, untouched
          |                       |
          |                  is an install
          v                       v
   runPreflight()  --> parseInstallCommand -> runScan -> decide -> audit
          |
          +-- ALLOW ----------------> return; shell runs the original command once
          |
          +-- BLOCK / REVIEW / SCANNER_UNAVAILABLE / COMMAND_REJECTED
                    --> throw; command never reaches the shell
```

There is **one** verdict engine. `lib/firewall/preflight.ts` is used by both this
plugin and `d0 guard`, and it calls the same `parseInstallCommand`, the same
`runScan` and the same `decide`. Nothing about the security policy is duplicated
or re-implemented for the plugin.

The plugin never spawns npm. `npmExecuted` is `false` on every audit event it
writes, even on `ALLOW`, because the install is performed by the agent's own
command — not by Dependency Zero.

## Installation and activation

The plugin lives at `.opencode/plugins/d0-npm-guard.ts`.

OpenCode discovers `.opencode/plugins/` **automatically** — there is no
`plugins` entry to add, and nothing to install:

```
.opencode/
└── plugins/
    └── d0-npm-guard.ts
```

No dependency is added. `@opencode/plugin` is not required: OpenCode V2 reads
the default export's `id` and `setup()`, and the small surface this file relies
on is declared locally with a comment pointing at the documentation.

Project-scoped by construction. It applies to this repository's working
directory, not globally.

### Options

Optional, via `opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": "./.opencode/plugins/d0-npm-guard.ts", "options": { "timeoutMs": 180000 } }
  ]
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `timeoutMs` | `120000` | Per-coordinate scan budget. On expiry the command is **held**, never permitted. |
| `disabled` | `false` | Turns interception off. Documented for emergencies; it disables the product. |

`disabled` exists because a guard that cannot be turned off during an incident
is its own outage. It is not a per-command bypass: there is no flag an agent can
pass to skip a single scan.

## Confirming the plugin is loaded

Three checks, strongest last.

**1. A command the plugin ignores must pass.**

```
npm test
```

If this is blocked, something is wrong — `npm test` is explicitly out of scope.

**2. A vulnerable install must be refused.**

```
npm install axios@1.7.2
```

Expected: a `DEPENDENCY ZERO — npm install was NOT run.` message naming the
package and the finding, and **no** install output. Confirm nothing was written:

```
npm ls axios --depth=0
```

Expected: empty.

**3. The server log.** Plugin loading is logged by the OpenCode server under
`role=server`:

```
~/.local/share/opencode/log/opencode.log
```

In TUI, `/` and then `plugins` lists loaded plugins; `dependency-zero.npm-guard`
should appear.

If changes are not picked up, restart the service:

```
opencode service restart
```

## What is protected

Enforced — scanned, decided, and refused unless `ALLOW`:

| Command | Behaviour |
| --- | --- |
| `npm install <pkg>[@ver]` | Scanned |
| `npm i <pkg>[@ver]` | Scanned |
| `npm add <pkg>[@ver]` | Scanned |
| Multiple packages in one command | All scanned; BLOCK on any wins |
| `--save-dev`, `--save-exact`, `--ignore-scripts`, … | Forwarded after scanning |
| Absolute/pathed npm: `/usr/bin/npm`, `C:\...\npm.cmd` | Scanned |
| Behind a separator: `cd x && npm install y` | Scanned |
| Behind env assignment: `NODE_ENV=prod npm install x` | Scanned |

Explicitly not intercepted — passed through untouched:

`git`, `ls`, `grep`, `node`, and every npm subcommand that cannot install:
`run`, `test`, `ls`, `view`, `why`, `audit`, `outdated`, `init`, `config`,
`publish`, `whoami`, and the rest of the allowlist in
`lib/firewall/agent-command.ts`.

That last point matters in the other direction: `grep "npm install" src/` and
`echo npm install` contain the text but start no npm process, and are left
alone. npm must be in **command position**.

## Outcomes

Only one outcome permits the command.

| Outcome | What happens | Agent sees |
| --- | --- | --- |
| `ALLOW` | Shell runs the original command, once | normal npm output |
| `BLOCK` | Command refused | package, score, critical/high findings |
| `REVIEW` | Command held | packages needing a human decision |
| `SCANNER_UNAVAILABLE` | Command held | registry/advisory outage; not a pass |
| `COMMAND_REJECTED` | Command refused | the specific parsing or scope failure |

`REVIEW` stays held. There is no `--force`, no `--no-guard`, no agent-side
override — a bypass flag would make the product decorative, since a malicious
agent would simply pass it. The way through is a human reviewing the Threat
Report and installing by hand.

**Fail-closed is absolute.** A scanner crash, a timeout, a store error, an
unexpected exception, or a malformed verdict all result in the command being
refused. There is no code path in which an in-scope command that D0 could not
evaluate is permitted.

## Limitations and known bypasses

This is **configured OpenCode bash-tool interception**. It is not universal agent
security, and it should not be described as such. Concretely, it does **not**
cover:

- **Shell aliases and functions.** `alias ni='npm install'` then `ni evil`
  contains no `npm` token in command position. The plugin never runs the alias
  table.
- **Wrapper and launcher commands.** `bash -c "npm install x"`,
  `xargs npm install`, `sudo npm install x` — the wrapper is in command
  position, not npm.
- **Other package managers.** `pnpm add`, `yarn add`, `bun add`, `npm ci`
  semantics via another tool. Only npm is intercepted.
- **`npm ci` and `npm update`.** These install code D0 cannot enumerate before
  running. They are **held** with an explanation rather than silently allowed —
  but they are not scanned.
- **Renamed or additional shell tools.** Only `shell` and `bash` are inspected.
  A different tool name would need adding to `SHELL_TOOL_NAMES`.
- **Other agents, other sessions, other machines.** The hook is per OpenCode
  server process for this project.
- **Quoted arguments.** `npm install "pkg"` is refused, not parsed. D0 does not
  implement shell quoting; refusing is the fail-closed choice, but it means some
  legitimate commands will be rejected.
- **Anything already installed.** The hook governs commands, not the contents of
  `node_modules`. Use `d0 guard` or the console for existing trees.

The mitigations that *do* apply: a refused command is logged, the refusal names
the reason, and the audit trail records every decision including the ones that
were permitted.

## Audit trail

Every intercepted command writes a `FirewallEvent`, newest first, visible in the
console and stored with the rest of the firewall history:

```jsonc
{
  "command": ["npm", "install", "axios@1.7.2"],   // argv array, never a raw shell string
  "coordinates": ["axios@1.7.2"],
  "scanIds": ["axios@1.7.2/ee0d6056e1ea34ae"],
  "verdicts": ["block"],
  "action": "BLOCKED_BEFORE_EXECUTION",
  "reason": "Blocked by security verdict: axios@1.7.2. npm was not started.",
  "npmExecuted": false,
  "source": "opencode-plugin"
}
```

`source` distinguishes an agent interception from a human running `d0 guard`, so
the trail does not present the two as the same event.

## Testing

`tests/opencode-guard.test.ts` — 40 tests, fully offline.

It exercises the **real** hook module, the real `runPreflight`, the real parser
and the real `decide` policy. Only the registry, the advisory API and the audit
sink are injected. No test spawns npm, and the malicious fixture is parsed as
bytes and never executed.

The "hook wiring" block drives the plugin's actual registered callback with a
tool-input object shaped like OpenCode's. That is a **simulated** OpenCode
runtime: it proves the wiring, the scope gate and that `ALLOW` leaves the input
byte-for-byte unmodified, but it does not prove how OpenCode itself reacts to a
thrown error.

End-to-end behaviour against a real agent was confirmed separately by running
live commands through an actual OpenCode session in this repository — a
vulnerable `npm install` was refused before npm started, `npm ci` was held,
chained and substituted commands were refused, and `npm test` / `git status`
passed through untouched. Those runs are manual verification, not part of the
automated suite.

See `docs/TRUST_MODEL.md` for how this relates to the rest of the trust model.