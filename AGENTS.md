This file captures tribal knowledge-the nuanced, non-obvious patterns that make the difference between a quick fix and hours of debugging.
When to add to this file:
- User had to intervene, correct, or hand-hold
- Multiple back-and-forth attempts were needed to get something working
- You discovered something that required reading many files to understand
- A change touched files you wouldn't have guessed
- Something worked differently than you expected
- User explicitly asks to add something
Proactively suggest additions when any of the above happen-don't wait to be asked.
What NOT to add: Stuff you can figure out from reading a few files, obvious patterns, or standard practices. This file should be high-signal, not comprehensive.

---

TypeScript guardrails
- No any types unless absolutely necessary.
- Check node_modules for external API type definitions instead of guessing.
- NEVER use inline imports. No await import("./foo.js"), no import("pkg").Type in type positions, and no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies. Upgrade the dependency instead.

Git guardrails
- NEVER commit unless user asks.

GitHub issues
When reading issues:
- Always read all comments on the issue.
- Use this command to get everything in one call:
  gh issue view <number> --json title,body,comments,labels,state

When closing issues via commit:
- Include fixes #<number> or closes #<number> in the commit message. This automatically closes the issue when the commit is merged.

---

- ACP (Agent Client Protocol) is a protocol that lets us interface with CLI agents like codex. When working on anything ACP related, you can use:
  - @.plan/docs/ACP_docs.md for all of ACP's documentation
  - @.plan/docs/ACP_SDK_notes.md for a reference to how the ACP SDK is implemented
  - @.plan/docs/ACP_reference_project.md for notes on ~/Repositories/kanbanana/vscode-acp, a client that implements ACP