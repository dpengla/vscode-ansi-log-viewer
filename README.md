# ANSI Log Viewer

Convert ANSI-colored logs and JSON-wrapped command output directly in the current editor.

## What It Does

- Decodes escaped log content such as `\\n`, `\\u001b`, and `\\x1b`.
- Strips ANSI escape sequences from the text and reapplies their colors and bold styling as editor decorations.
- Understands JSON payloads like Ansible task results and separates `stderr` / `stderr_lines` and `stdout` / `stdout_lines`.
- Adds:
  - `ANSI Log Viewer: Process In Place` for the active editor or current selection
  - `ANSI Log Viewer: Process File In Place...`
  - Explorer context menu support for local files

## Typical Workflow

1. Open a log file or paste the JSON payload into an editor.
2. Run `ANSI Log Viewer: Process In Place`.
3. The document is rewritten into readable sections and ANSI-colored content is highlighted directly in the editor.

## Example Input

This extension is designed for content shaped like:

```json
{
  "changed": true,
  "stderr": "\u001b[0;90m19:05:31.541 \u001b[0m\u001b[0;32mINFO   \u001b[0mDownloading Terraform configurations...",
  "stderr_lines": [
    "\u001b[0;90m19:05:31.541 \u001b[0m\u001b[0;32mINFO   \u001b[0mDownloading Terraform configurations..."
  ],
  "stdout": "plain stdout text"
}
```

## Packaging

If you want to package and install it locally:

```bash
npm install -g @vscode/vsce
vsce package
```
