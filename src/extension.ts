import * as vscode from 'vscode';

const MODEL = 'qwen2.5-coder:3b';
const OLLAMA_URL = 'http://localhost:11434/api/generate';

const PROMPTS: Record<string, (selected: string, context: string) => string> = {
  explain: (selected, context) => `
You are an expert coding assistant.
Here is the full file for context:
<file>
${context}
</file>

The user selected this specific part:
<selected>
${selected}
</selected>

Explain the selected code clearly.
Reference the surrounding code if it helps.
Be concise and structured.
Format your response as:
<explanation>
your explanation here
</explanation>
`,

  fix: (selected, context) => `
You are an expert coding assistant.
Here is the full file for context:
<file>
${context}
</file>

The user selected this specific part which may have bugs:
<selected>
${selected}
</selected>

Find and fix all bugs in the selected code.

Rules:
- Do NOT add any comments whatsoever — no inline comments, no block comments
- Do NOT add docstrings unless the original code already had them
- Do NOT change what the code does, only how it does it
- Keep type hints if the language uses them — they are not comments
- Write code a senior engineer would write, not code that explains itself

Respond ONLY in this exact format, nothing else:
<code>
the complete fixed code here, ready to paste
</code>

<explanation>
what was wrong and what you fixed
</explanation>
`,

  tests: (selected, context) => `
You are an expert coding assistant.
Here is the full file for context:
<file>
${context}
</file>

The user selected this specific part:
<selected>
${selected}
</selected>

Write comprehensive unit tests for the selected code.
Use the same language and style as the file.
Respond ONLY in this exact format:
<code>
all test code here, ready to paste into a test file
</code>

<explanation>
brief description of what the tests cover
</explanation>
`,

  refactor: (selected, context) => `
You are an expert software engineer specialising in Python and TypeScript.
Here is the full file to refactor:
<file>
${context}
</file>

Improve this code by:
- Better variable and function naming
- Removing redundancy and unnecessary loops
- Improving readability and structure
- Using idiomatic patterns for the language

Rules:
- Do NOT add any comments whatsoever — no inline comments, no block comments
- Do NOT add docstrings unless the original code already had them
- Do NOT change what the code does, only how it does it
- Do NOT add new features
- Keep type hints if the language uses them — they are not comments
- Write code a senior engineer would write, not code that explains itself

Respond ONLY in this exact format:
<code>
the complete refactored file here, ready to replace the original
</code>

<explanation>
bullet points of what you changed and why
</explanation>
`,
};

async function askOllama(
  task: string,
  selected: string,
  context: string
): Promise<string> {
  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: PROMPTS[task](selected, context),
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}`);
  }

  const data = await response.json() as { response: string };
  return data.response;
}

function parseResponse(raw: string): { code: string | null; explanation: string } {
  const xmlCodeMatch = raw.match(/<code>([\s\S]*?)<\/code>/);
  const xmlExplanationMatch = raw.match(/<explanation>([\s\S]*?)<\/explanation>/);

  if (xmlCodeMatch) {
    return {
      code: xmlCodeMatch[1].trim(),
      explanation: xmlExplanationMatch ? xmlExplanationMatch[1].trim() : raw,
    };
  }

  const markdownMatch = raw.match(/```(?:\w+)?\n([\s\S]*?)```/);
  if (markdownMatch) {
    const afterCode = raw.split(/```(?:\w+)?\n[\s\S]*?```/).pop()?.trim() || '';
    return {
      code: markdownMatch[1].trim(),
      explanation: afterCode || 'Refactored successfully.',
    };
  }

  return { code: null, explanation: raw };
}

function showResult(
  title: string,
  raw: string,
  editor: vscode.TextEditor,
  selection: vscode.Selection
) {
  const { code, explanation } = parseResponse(raw);

  const panel = vscode.window.createWebviewPanel(
    'localai',
    `LocalAI — ${title}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );

  panel.webview.html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: -apple-system, sans-serif;
          padding: 24px;
          line-height: 1.7;
          color: #d4d4d4;
          background: #1e1e1e;
        }
        h2 { color: #4ec9b0; margin-bottom: 8px; }
        h3 { color: #9cdcfe; margin: 16px 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; }
        pre {
          background: #2d2d2d;
          padding: 16px;
          border-radius: 8px;
          white-space: pre-wrap;
          font-size: 13px;
          font-family: 'Menlo', monospace;
          border-left: 3px solid #4ec9b0;
          margin: 0;
        }
        p { color: #cccccc; font-size: 14px; }
        button {
          margin-top: 16px;
          padding: 10px 20px;
          background: #4ec9b0;
          color: #1e1e1e;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: bold;
          cursor: pointer;
        }
        button:hover { background: #3aab94; }
        .section { margin-bottom: 24px; }
      </style>
    </head>
    <body>
      <h2>${title}</h2>

      ${code ? `
        <div class="section">
          <h3>Fixed Code</h3>
          <pre>${code}</pre>
          <button onclick="applyCode()">Apply to Editor</button>
        </div>
      ` : ''}

      <div class="section">
        <h3>Explanation</h3>
        <p>${explanation.replace(/\n/g, '<br>')}</p>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        function applyCode() {
          vscode.postMessage({ command: 'apply', code: ${JSON.stringify(code)} });
        }
      </script>
    </body>
    </html>
  `;

  panel.webview.onDidReceiveMessage(message => {
    if (message.command === 'apply' && message.code) {
      editor.edit(editBuilder => {
        editBuilder.replace(selection, message.code);
      });
      panel.dispose();
      vscode.window.showInformationMessage('LocalAI: Fix applied!');
    }
  });
}

async function handleCommand(task: string, label: string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a code file first.');
    return;
  }

  const selection = editor.selection;
  const selected = editor.document.getText(selection);
  if (!selected) {
    vscode.window.showWarningMessage('Select some code first, then run LocalAI.');
    return;
  }

  const context = editor.document.getText();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `LocalAI: ${label}...`,
      cancellable: false,
    },
    async () => {
      try {
        const result = await askOllama(task, selected, context);
        showResult(label, result, editor, selection);
      } catch (err) {
        vscode.window.showErrorMessage(
          'Could not reach Ollama. Make sure it is running: ollama serve'
        );
      }
    }
  );
}

async function handleRefactor() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a file to refactor.');
    return;
  }

  const originalText = editor.document.getText();
  if (!originalText.trim()) {
    vscode.window.showWarningMessage('File is empty.');
    return;
  }

  // Must be a saved file — not an untitled buffer
  if (editor.document.isUntitled) {
    vscode.window.showWarningMessage('Please save the file first (Cmd+S), then run Refactor.');
    return;
  }

  const uri = editor.document.uri;

  let raw: string;
  try {
    raw = await askOllama('refactor', originalText, originalText);
  } catch (err) {
    vscode.window.showErrorMessage('Could not reach Ollama. Run: ollama serve');
    return;
  }

  const { code, explanation } = parseResponse(raw);

  if (!code) {
    vscode.window.showErrorMessage('LocalAI: Could not parse refactored code. Try again.');
    return;
  }

  try {
    const tempUri = uri.with({ path: uri.path + '.refactored' });
    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(tempUri, encoder.encode(code));

    await vscode.commands.executeCommand(
      'vscode.diff',
      uri,
      tempUri,
      `LocalAI Refactor — ${uri.path.split('/').pop()}`
    );

    const choice = await vscode.window.showInformationMessage(
      'LocalAI refactored your file. Review the diff then decide.',
      { modal: false },
      'Accept',
      'Reject'
    );

    if (choice === 'Accept') {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(originalText.length)
      );
      edit.replace(uri, fullRange, code);
      await vscode.workspace.applyEdit(edit);
      await editor.document.save();
      // Ask if they want the summary after applying
      const showSummary = await vscode.window.showInformationMessage(
        'Refactor applied and saved!',
        'Show What Changed',
        'Done'
      );
      if (showSummary === 'Show What Changed' && explanation) {
        showResult('Refactor Summary', `<explanation>${explanation}</explanation>`, editor, editor.selection);
      }
    } else {
      vscode.window.showInformationMessage('LocalAI: Refactor rejected. Original unchanged.');
    }

    await vscode.workspace.fs.delete(tempUri);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

    if (explanation) {
      const showSummary = await vscode.window.showInformationMessage(
        'Refactor applied! Want to see what changed?',
        'Show Summary',
        'No Thanks'
      );
      if (showSummary === 'Show Summary') {
        showResult('Refactor Summary', `<explanation>${explanation}</explanation>`, editor, editor.selection);
      }
    }

  } catch (err) {
    vscode.window.showErrorMessage(`LocalAI Error: ${String(err)}`);
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('localai.explain', () =>
      handleCommand('explain', 'Explain Code')
    ),
    vscode.commands.registerCommand('localai.fix', () =>
      handleCommand('fix', 'Fix Bug')
    ),
    vscode.commands.registerCommand('localai.tests', () =>
      handleCommand('tests', 'Write Tests')
    ),
    vscode.commands.registerCommand('localai.refactor', () =>
      handleRefactor()
    )
  );
}

export function deactivate() {}