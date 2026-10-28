# Project skills

pstack 0.15.36 is vendored at `pstack/` (MIT, Lauren Tan, https://github.com/cursor/plugins/tree/main/pstack).

Each skill directory is linked from `.grok/skills/<name>`, `.cursor/skills/<name>`, and `.agents/skills/<name>`. Those links point at `pstack/skills/<name>`.

When a task matches a skill description, read `pstack/skills/<name>/SKILL.md` and follow it. Use that path, not the link path, so sibling references such as `../<other>/SKILL.md` resolve. Agents live at `pstack/agents/`.

`poteto-mode` does not auto-invoke. Run it only when the user asks for poteto-mode or names that skill. Do not run setup-pstack unless the user asks to configure models.

# Decision log

Git exports from this workspace use the commit message "Export from Grok" and do not record why. Append each decision or behavior change to [decisions.tsv](decisions.tsv) at the repo root. Use `scripts/log.sh`. The file is append-only. Do not edit or delete a row. A wrong row gets a new row that supersedes it. Keep the file in the repo.

