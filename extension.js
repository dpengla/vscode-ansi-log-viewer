"use strict";

const vscode = require("vscode");

const ANSI_COLORS = {
  black: "#1f2428",
  red: "#f47067",
  green: "#7ee787",
  yellow: "#e3b341",
  blue: "#79c0ff",
  magenta: "#d2a8ff",
  cyan: "#56d4dd",
  white: "#c9d1d9",
  "bright-black": "#8b949e",
  "bright-red": "#ff938a",
  "bright-green": "#8ddb8c",
  "bright-yellow": "#f2cc60",
  "bright-blue": "#a5d6ff",
  "bright-magenta": "#e2b8ff",
  "bright-cyan": "#7ee6eb",
  "bright-white": "#f0f6fc"
};

function activate(context) {
  const decorationCache = new Map();

  context.subscriptions.push(
    vscode.commands.registerCommand("ansiLogViewer.openPreview", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("Open a log or JSON document first.");
        return;
      }

      await processEditorInPlace(editor, decorationCache);
    }),
    vscode.commands.registerCommand("ansiLogViewer.openFilePreview", async (resource) => {
      let uri = resource;
      if (!uri) {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          canSelectFiles: true,
          canSelectFolders: false,
          openLabel: "Process ANSI Log"
        });
        uri = picked && picked[0];
      }

      if (!uri) {
        return;
      }

      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document, { preview: false });
      await processEditorInPlace(editor, decorationCache);
    }),
    { dispose: () => disposeDecorationCache(decorationCache) }
  );
}

function deactivate() {}

async function processEditorInPlace(editor, decorationCache) {
  const selection = editor.selection;
  const targetRange = selection && !selection.isEmpty
    ? selection
    : fullDocumentRange(editor.document);

  const sourceText = editor.document.getText(targetRange);
  if (!sourceText.trim()) {
    vscode.window.showWarningMessage("The current document is empty.");
    return;
  }

  const output = buildProcessedOutput(sourceText);
  const startOffset = editor.document.offsetAt(targetRange.start);

  const edited = await editor.edit((editBuilder) => {
    editBuilder.replace(targetRange, output.text);
  });

  if (!edited) {
    vscode.window.showErrorMessage("Unable to update the current document.");
    return;
  }

  clearDecorations(editor, decorationCache);
  applyDecorations(editor, output.decorations, startOffset, decorationCache);
}

function fullDocumentRange(document) {
  const lastLine = document.lineAt(document.lineCount - 1);
  return new vscode.Range(0, 0, document.lineCount - 1, lastLine.text.length);
}

function buildProcessedOutput(sourceText) {
  const extracted = extractStructuredContent(sourceText);
  const sections = extracted.sections.length > 0
    ? extracted.sections
    : [{ label: "Log Output", kind: inferKind(sourceText, "plain"), text: sourceText }];

  let text = "";
  let offset = 0;
  const decorations = [];

  if (extracted.meta.length > 0) {
    for (const item of extracted.meta) {
      const line = `${item.key}: ${item.value}\n`;
      text += line;
      offset += line.length;
    }
    text += "\n";
    offset += 1;
  }

  sections.forEach((section, index) => {
    const prefix = `[${section.label}]`;
    text += `${prefix}\n`;
    offset += prefix.length + 1;

    const normalized = normalizeContent(section.text);
    if (section.kind === "ansi") {
      const rendered = renderAnsiForEditor(normalized, offset);
      text += rendered.text;
      decorations.push(...rendered.decorations);
      offset += rendered.text.length;
    } else {
      text += normalized;
      offset += normalized.length;
    }

    if (index < sections.length - 1) {
      text += "\n\n";
      offset += 2;
    }
  });

  return { text, decorations };
}

function extractStructuredContent(sourceText) {
  const trimmed = sourceText.trim();
  if (!trimmed) {
    return { meta: [], sections: [] };
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { meta: [], sections: [] };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { meta: [], sections: [] };
  }

  const meta = [];
  const sections = [];
  const metaKeys = ["changed", "cmd", "delta", "start", "end", "rc", "msg"];

  for (const key of metaKeys) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      meta.push({ key, value: stringifyValue(parsed[key]) });
    }
  }

  pushSectionIfPresent(sections, parsed, "stderr_lines", "stderr", "STDERR", "ansi");
  pushSectionIfPresent(sections, parsed, "stdout_lines", "stdout", "STDOUT", "plain");

  if (sections.length === 0) {
    sections.push({
      label: "JSON",
      kind: "plain",
      text: JSON.stringify(parsed, null, 2)
    });
  }

  return { meta, sections };
}

function pushSectionIfPresent(target, parsed, listKey, textKey, label, defaultKind) {
  if (Array.isArray(parsed[listKey]) && parsed[listKey].length > 0) {
    target.push({
      label,
      kind: inferKindFromLines(parsed[listKey], defaultKind),
      text: parsed[listKey].join("\n")
    });
    return;
  }

  if (typeof parsed[textKey] === "string" && parsed[textKey].length > 0) {
    target.push({
      label,
      kind: inferKind(parsed[textKey], defaultKind),
      text: parsed[textKey]
    });
  }
}

function inferKind(text, fallback) {
  return containsAnsi(text) ? "ansi" : fallback;
}

function inferKindFromLines(lines, fallback) {
  return lines.some((line) => containsAnsi(line)) ? "ansi" : fallback;
}

function containsAnsi(text) {
  const normalized = decodeEscapedControlSequences(String(text));
  return /\u001b\[[0-9;]*m/.test(normalized) || /\x1b\[[0-9;]*m/.test(normalized);
}

function normalizeContent(text) {
  const value = typeof text === "string" ? text : stringifyValue(text);
  return decodeEscapedControlSequences(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function stringifyValue(value) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function decodeEscapedControlSequences(text) {
  return text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\u001b/gi, "\u001b")
    .replace(/\\x1b/gi, "\u001b");
}

function renderAnsiForEditor(text, baseOffset) {
  const state = createAnsiState();
  const decorations = [];
  let plainText = "";
  let visibleStart = 0;
  const regex = /\u001b\[([0-9;]*)m|\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const chunk = text.slice(lastIndex, match.index);
      plainText += chunk;
      pushDecoration(decorations, state, chunk, baseOffset + visibleStart);
      visibleStart += chunk.length;
    }

    applyAnsiCodes(state, match[1] || match[2] || "");
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    const chunk = text.slice(lastIndex);
    plainText += chunk;
    pushDecoration(decorations, state, chunk, baseOffset + visibleStart);
  }

  return { text: plainText, decorations };
}

function pushDecoration(decorations, state, chunk, startOffset) {
  if (!chunk || isDefaultState(state)) {
    return;
  }

  const endOffset = startOffset + chunk.length;
  decorations.push({
    styleKey: styleKeyForState(state),
    startOffset,
    endOffset
  });
}

function createAnsiState() {
  return { bold: false, fg: null, bg: null };
}

function isDefaultState(state) {
  return !state.bold && !state.fg && !state.bg;
}

function applyAnsiCodes(state, codesText) {
  const codes = codesText === "" ? [0] : codesText.split(";").map((value) => Number.parseInt(value, 10) || 0);
  for (const code of codes) {
    if (code === 0) {
      state.bold = false;
      state.fg = null;
      state.bg = null;
      continue;
    }
    if (code === 1) {
      state.bold = true;
      continue;
    }
    if (code === 22) {
      state.bold = false;
      continue;
    }
    if (code === 39) {
      state.fg = null;
      continue;
    }
    if (code === 49) {
      state.bg = null;
      continue;
    }
    if (code >= 30 && code <= 37) {
      state.fg = colorName(code - 30, false);
      continue;
    }
    if (code >= 90 && code <= 97) {
      state.fg = colorName(code - 90, true);
      continue;
    }
    if (code >= 40 && code <= 47) {
      state.bg = colorName(code - 40, false);
      continue;
    }
    if (code >= 100 && code <= 107) {
      state.bg = colorName(code - 100, true);
    }
  }
}

function colorName(index, bright) {
  const names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
  return `${bright ? "bright-" : ""}${names[index]}`;
}

function styleKeyForState(state) {
  return JSON.stringify(state);
}

function clearDecorations(editor, decorationCache) {
  for (const decorationType of decorationCache.values()) {
    editor.setDecorations(decorationType, []);
  }
}

function applyDecorations(editor, decorations, startOffset, decorationCache) {
  const grouped = new Map();
  for (const item of decorations) {
    const ranges = grouped.get(item.styleKey) || [];
    ranges.push(
      new vscode.Range(
        editor.document.positionAt(startOffset + (item.startOffset - startOffset)),
        editor.document.positionAt(startOffset + (item.endOffset - startOffset))
      )
    );
    grouped.set(item.styleKey, ranges);
  }

  for (const [styleKey, ranges] of grouped.entries()) {
    const decorationType = getDecorationType(styleKey, decorationCache);
    editor.setDecorations(decorationType, ranges);
  }
}

function getDecorationType(styleKey, decorationCache) {
  let decorationType = decorationCache.get(styleKey);
  if (decorationType) {
    return decorationType;
  }

  const state = JSON.parse(styleKey);
  const options = {};
  if (state.fg && ANSI_COLORS[state.fg]) {
    options.color = ANSI_COLORS[state.fg];
  }
  if (state.bg && ANSI_COLORS[state.bg]) {
    options.backgroundColor = `${ANSI_COLORS[state.bg]}33`;
  }
  if (state.bold) {
    options.fontWeight = "700";
  }

  decorationType = vscode.window.createTextEditorDecorationType(options);
  decorationCache.set(styleKey, decorationType);
  return decorationType;
}

function disposeDecorationCache(decorationCache) {
  for (const decorationType of decorationCache.values()) {
    decorationType.dispose();
  }
  decorationCache.clear();
}

module.exports = {
  activate,
  deactivate
};
