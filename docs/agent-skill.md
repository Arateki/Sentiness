# Agent Skill Integration

Sentiness can install a managed instruction block for AI coding agents. The block tells the agent
which Sentiness commands to run, which files are protected, and how to handle background feedback.

## Supported Agents

| Agent | Target file |
|---|---|
| Claude Code (managed section) | `CLAUDE.md` |
| Claude Code (discoverable skill) | `.claude/skills/sentiness/SKILL.md` |
| Codex | `AGENTS.md` |
| Gemini | `GEMINI.md` |

The `claude-code-skill` target writes a self-contained Claude Code skill (YAML frontmatter plus the
shared instruction template) instead of a managed section. Prefer it over the `CLAUDE.md` managed
section when you want the instructions loaded on demand rather than in every session's context.

Install one target:

```sh
sentiness install-skill --agent=codex
```

Install every supported target:

```sh
sentiness install-skill --agent=all
```

The command loads the current Sentiness config, renders the shared template, and writes only the
managed block between Sentiness markers. Re-running the command is idempotent.

## Managed Section

The adapters write content between:

```html
<!-- sentiness:start -->
<!-- sentiness:end -->
```

Content outside those markers is left intact. If the file does not exist, Sentiness creates it. If
the file exists without a managed section, Sentiness appends the section.

> **Warning:** the writer replaces everything between the *first* occurrence of each marker in the
> target file, including marker text quoted inside documentation or code fences. Do not write the
> literal marker comments anywhere else in a managed file.

The `claude-code-skill` adapter is the exception: it owns the whole `SKILL.md` file and does not use
markers.

## What The Installed Instructions Cover

The generated block includes:

- The Sentiness version and template version.
- The config path, baseline path, and pending feedback path.
- Required commands for fast checks, final verification, background checks, pending feedback, and
  doctor diagnostics.
- Rules for not editing protected config/baseline/pending files just to make checks pass.
- Guidance for treating platform errors as invalid verification runs.

## Recommended Agent Workflow

For small edits:

```sh
sentiness check --tier=fast --compact
```

Before declaring work complete:

```sh
sentiness check --trigger=pre-done --compact
```

For slow checks:

```sh
sentiness check --tier=slow --background
sentiness status <jobId>
sentiness pending --all
```

If a background job creates pending feedback, the next agent session should inspect it and either
fix the issue or acknowledge it after the work is no longer relevant:

```sh
sentiness pending ack <pendingId>
```

## When To Reinstall

Re-run `install-skill` when:

- `sentiness.config.json` changes baseline or pending paths.
- The project switches the primary agent file.
- Sentiness is upgraded and the adapter template changes.
- A repo copied old instructions without the Sentiness managed markers.

## Troubleshooting

If `install-skill` exits with usage text, pass one of:

```sh
sentiness install-skill --agent=claude-code
sentiness install-skill --agent=claude-code-skill
sentiness install-skill --agent=codex
sentiness install-skill --agent=gemini
sentiness install-skill --agent=all
```

If the command cannot load config, run it from the repository root or create
`sentiness.config.json` with `sentiness init`.
