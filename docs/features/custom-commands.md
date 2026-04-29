---
title: "Custom Commands"
description: "Define reusable AI prompts as markdown files with parameters and auto-injection"
sidebar_order: 2
---

# Custom Commands

If you find yourself typing the same kind of prompt repeatedly — "review this file for bugs", "write tests following our conventions", "check for security issues" — custom commands let you save those prompts as markdown files and invoke them as slash commands.

Each command becomes a `/command` you can run during any session, with support for parameters, aliases, auto-injection based on keywords, and namespace organization.

## Quick Start

```bash
# Create a command with AI assistance
/commands create review-code

# Or create the file manually
mkdir -p .nanocoder/commands
```

`.nanocoder/commands/review-code.md`:

```markdown
---
description: Review code for issues and improvements
aliases: [review]
parameters: [filename]
---

Review {{filename}} for:
- Bugs and edge cases
- Performance issues
- Code style and readability
```

Then invoke it:

```bash
/review-code src/app.ts
```

## File Structure

Commands live in `.nanocoder/commands/` in your project root. Each `.md` file becomes a command named after the file.

```
.nanocoder/commands/
  test.md              -> /test
  review.md            -> /review
  refactor/
    dry.md             -> /refactor:dry
    solid.md           -> /refactor:solid
```

Subdirectories create namespaced commands using colon syntax (e.g., `refactor/dry.md` becomes `/refactor:dry`).

## Frontmatter Reference

All fields are optional except that every command should have a `description`. Frontmatter uses standard YAML between `---` delimiters.

```yaml
---
description: What this command does
aliases: [alt-name, shortcut]
parameters: [filename, target]
tags: [testing, quality]
triggers: [write tests, unit test]
estimated-tokens: 2000
category: testing
version: 1.0.0
author: your-name
examples:
  - /my-command src/utils.ts
  - /my-command lib/parser.ts
references: [docs/guide.md]
dependencies: [other-command]
---
```

### Field Details

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Shown in `/commands` list and `/commands show` |
| `aliases` | string[] | Alternative names to invoke the command |
| `parameters` | string[] | Named placeholders, usable as `{{param}}` in the body |
| `tags` | string[] | Keywords for auto-injection when the user's message matches |
| `triggers` | string[] | Phrases that auto-inject this command into context |
| `estimated-tokens` | number | Token budget hint, shown in `/commands` list for auto-injectable commands |
| `category` | string | Organizational grouping, shown in `/commands show` |
| `version` | string | Version string, shown in `/commands show` |
| `author` | string | Author name, shown in `/commands show` |
| `examples` | string[] | Usage examples, shown in `/commands show` |
| `references` | string[] | Related files or URLs, shown in `/commands show` |
| `dependencies` | string[] | Other commands this one depends on |

### Array Syntax

Arrays can be written in either JSON-style or YAML dash syntax:

```yaml
# JSON-style (inline)
aliases: [review, code-review]

# YAML dash syntax (multiline)
aliases:
  - review
  - code-review
```

## Parameters

Parameters defined in frontmatter become `{{param}}` placeholders in the command body. When the user invokes the command, positional arguments fill in the placeholders. You can define parameters as simple strings or as objects with additional metadata.

### String Syntax (Simple)

```yaml
---
parameters: [filename, style]
---

Review {{filename}} using {{style}} conventions.
```

### Object Syntax (Advanced)

Use object-style definitions when you need type hints, requirement flags, or descriptions that surface in `/help`.

```yaml
---
parameters:
  - name: filename
    type: path
    required: true
    description: File to review
  - name: style
    required: false
    description: Style guide (e.g., "airbnb", "google")
---

Review {{filename}} using {{style}} conventions.
```

### How Arguments Map to Parameters

When a user runs a command, their input is tokenized (respecting quoted strings), then mapped positionally to your declared parameters:

```bash
/review src/app.ts airbnb
# Maps: filename = "src/app.ts", style = "airbnb"
```

**Key behaviors:**

- **Exact match**: The Nth argument maps to the Nth parameter by position.
- **Extra args are ignored**: If the command declares 2 parameters but the user provides 3 arguments, only the first 2 are used. The third is silently discarded.
- **Missing args leave placeholders unsubstituted**: If a user provides fewer arguments than defined parameters, the missing `{{param}}` tokens remain as literal text in the prompt. Write your commands defensively — include fallback instructions for when optional params aren't provided.
- **Quoted strings preserve spaces**: `/review "my project/src" airbnb` correctly passes `my project/src` as a single token.
- **No parameters declared?** All user-supplied tokens become available via `{{args}}`.

### What the LLM Sees

When a custom command executes, `{{param}}` placeholders are replaced with their actual values via template substitution. The LLM receives the resolved prompt directly — no separate context block is needed because the parameter values are already inline in the command text itself.

For example, `/review src/app.ts airbnb` results in the LLM seeing:

```
[Executing custom command: /review]

Review src/app.ts using airbnb conventions.
```

### Built-in Variables

These are always available regardless of parameter declarations:

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `{{cwd}}` | Current working directory | `/home/user/my-project` |
| `{{command}}` | The full command name | `refactor:dry` |
| `{{args}}` | All mapped arguments joined with spaces | `src/app.ts airbnb` |

### Defensive Command Writing Tips

1. **Handle missing params gracefully**: If a parameter is optional, provide fallback text in your prompt body.

   ```markdown
   Review {{filename}} for bugs.
   {% if filename %}Focus specifically on that file.{% endif %}
   If no file was specified, analyze the most recently modified files.
   ```

2. **Use parameters instead of hardcoding**: Never embed paths or config values directly — use `{{param}}` so users can customize at invocation time.

3. **Keep parameter count low**: Commands with 1–3 parameters work best. Complex workflows should be broken into smaller commands.

## Auto-Injection

Commands with `tags` or `triggers` can be automatically injected into the system prompt when the user's message matches. This lets you add context-specific instructions without the user needing to invoke the command explicitly.

- **tags**: Matched as keywords against the user's message
- **triggers**: Matched as phrases against the user's message

```yaml
---
description: Testing conventions for this project
tags: [testing, test, spec]
triggers: [write tests, add tests]
estimated-tokens: 1500
---

When writing tests for this project, follow these conventions:
- Use AVA as the test framework
- Place spec files alongside source files
- ...
```

## Resources

When using the directory-as-command pattern, files in a `resources/` subdirectory are automatically loaded and passed as additional context. This is useful for bundling templates, configs, or reference documents alongside the command.

```
.nanocoder/commands/
  api-gen/
    api-gen.md            -> The command (must match directory name)
    resources/
      template.yaml       -> Loaded as a resource
      examples.json       -> Loaded as a resource
```

## Commands

| Command | Description |
|---------|-------------|
| `/commands` | List all custom commands |
| `/commands show <name>` | Show detailed info about a command |
| `/commands refresh` | Reload commands from disk |
| `/commands create <name>` | Create a new command file with AI assistance |

### `/commands create`

Creates a new command file in `.nanocoder/commands/` and starts an AI-assisted session to write its content. The AI will ask what you want the command to do, then write the markdown file for you.

```bash
/commands create lint-fix
```

The `.md` extension is added automatically.

## Examples

### Test Generator

```markdown
---
description: Generate comprehensive unit tests
aliases: [unittest, test-gen]
parameters: [filename]
---

Generate comprehensive unit tests for the file {{filename}}.

Consider the following:

1. Test all public functions and methods
2. Include edge cases and error scenarios
3. Use appropriate mocking where needed
4. Follow the existing test framework conventions in this project
5. Ensure good test coverage

If {{filename}} is not provided, analyze the most recently modified files and suggest which ones need tests.
```

### DRY Refactoring

```markdown
---
description: Apply DRY principle to reduce code duplication
aliases: [dedupe]
parameters: [target]
---

Analyze {{target}} for code duplication and apply the DRY (Don't Repeat Yourself) principle.

Steps:

1. Identify repeated code patterns
2. Extract common functionality into reusable functions/components
3. Update all instances to use the new abstraction
4. Ensure no functionality is broken
5. Run tests if available
```

### Git Issue Checker

```markdown
---
description: Fetch and list open GitHub issues
aliases: [issues, open-issues]
category: git
---

List all open GitHub issues for this repository. Show the issue number, title, labels, and assignee for each.
```

## Tips

- **Start with `/commands create`**: Let the AI help you write your first commands
- **Keep prompts focused**: Commands work best with clear, specific instructions
- **Use parameters for flexibility**: Instead of hardcoding paths, use `{{filename}}` or `{{target}}`
- **Organize with directories**: Group related commands under a namespace (e.g., `refactor/`)
- **Use aliases for convenience**: Add short aliases for commands you use frequently
