# OpenInsight

> Open Business Insights Agent

> [!WARNING]
> **Lot of the code was written by AI**, this is an experiment.

## TUI Mode

<img width="3610" height="2452" alt="CleanShot 2026-07-26 at 14 48 18@2x" src="https://github.com/user-attachments/assets/33d79612-6290-4b81-8500-66633c3916ff" />

## Web Mode

<img width="3984" height="2696" alt="CleanShot 2026-07-26 at 14 49 50@2x" src="https://github.com/user-attachments/assets/159b74d9-4517-4449-8bd3-371dc90b941e" />

### Agent-built dashboards

The web UI includes a Dashboards tab. Ask the configured agent to build a
dashboard or revise the selected dashboard in natural language. The agent owns
the widget queries, visualization types, column mappings, order, and layout;
changes remain a draft until you save them.

Dashboards support tables and line, bar, and pie charts. Every widget uses the
dashboard's shared time range, which can be rerun with a relative or custom
range. Saved dashboard configurations are scoped to their data source and stored
in the project's `.openinsight/config.json`; query results are not persisted.

## Quick Start

Install with Homebrew:

```bash
brew install arjunkomath/tap/openinsight
```

Or install from npm (a prebuilt binary is downloaded for your platform, no Bun
required):

```bash
# 1. Install
npm install -g openinsight

# Set your OpenRouter API key
export OPENROUTER_KEY=sk-...

# Run
openinsight
```

### Use Claude Code

OpenInsight can use an existing [Claude Code](https://code.claude.com/docs/en/setup)
login instead of OpenRouter. Install Claude Code 2.1.205 or newer, authenticate it,
and opt in with `--claude`:

```bash
claude auth login
openinsight --claude

# Claude also works with the web UI
openinsight --claude --web
```

OpenInsight verifies that the `claude` executable is in `PATH` before starting.
It runs each inference in non-interactive plan mode with all built-in and MCP tools
disabled; the database schema and query context are sent over stdin. The default
model is `opus` and can be changed with `OPENINSIGHT_CLAUDE_MODEL`:

```bash
OPENINSIGHT_CLAUDE_MODEL=sonnet openinsight --claude
```

For a persistent provider choice, set `OPENINSIGHT_AI_PROVIDER=claude` instead
of passing `--claude`. OpenRouter remains the default provider.

### Summarize query results

Run a one-shot, non-interactive query by selecting a configured source by name or
ID and providing a natural-language question:

```bash
openinsight --source production --query "Show monthly revenue"
```

Add `--summary` to make a second AI call that summarizes the results. An optional
instruction can be provided with `--summary=<instruction>`:

```bash
openinsight --source production --query "Show monthly revenue" --summary
openinsight --source production --query "Show monthly revenue" --summary="Focus on unusual trends"
```

The command prints the generated SQL and query results, followed by the summary,
then exits. It does not start the TUI or web UI.

One-shot queries support the existing provider and diagnostics options. For
example, this uses Claude Code, prints verbose diagnostics to stderr, and writes
the same diagnostics to the normal log file:

```bash
openinsight --claude --verbose --log --source production --query "Show monthly revenue" --summary
```

### Verbose diagnostics

Pass `--verbose` to show detailed diagnostics in the TUI transcript, the web
UI's expanded Activity panel, or stderr for a one-shot query:

```bash
openinsight --claude --verbose
openinsight --web --verbose
```

Verbose output includes complete AI prompts, schemas, conversation history,
provider responses and metadata, subprocess stdout/stderr, generated and repaired
SQL, database timing, result columns, and result data. Connection credentials and
the resolved Claude executable path are not logged. Because prompts and query
results can contain sensitive application data, enable verbose mode only while
diagnosing a problem.

To write the same detailed diagnostics to a file without expanding the UI
activity, pass `--log`:

```bash
openinsight --log
openinsight --web --log
```

Use `--verbose --log` to send detailed diagnostics to both the UI and the log.
Log entries are timestamped and appended to `openinsight.log` in the platform's
standard log or state directory:

- Linux: `${XDG_STATE_HOME:-~/.local/state}/openinsight`
- macOS: `~/Library/Logs/OpenInsight`
- Windows: `%LOCALAPPDATA%\OpenInsight\Logs`

Each file entry is capped at 20,000 characters. The log rotates at 5 MiB and
retains one archive as `openinsight.log.1`.

Run `openinsight paths` to print the log directory and, when it exists, the
project-local `.openinsight` config directory. Log files can contain prompts,
schemas, SQL, and query results, so handle them as sensitive data.

---

Made with ❤️ for data exploration
