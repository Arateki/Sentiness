# @sentiness/adapters

Agent adapters install Sentiness instructions for AI coding agents: either a managed section in
the agent's root file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) or a self-contained discoverable
skill (`.claude/skills/sentiness/SKILL.md` for Claude Code, `.agents/skills/sentiness/SKILL.md`
for Codex). The package owns the shared skill template, the idempotent marker replacement, and the
whole-file skill writer used by `sentiness install-skill`.
