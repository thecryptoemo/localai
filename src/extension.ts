import * as vscode from 'vscode';
const MODEL = 'qwen2.5-coder:3b';
const OLLAMA_URL = 'http://localhost:11434/api/generate';
const PROMPTS: Record<string, (code: string) => string> = {
  explain: (code) =>
    `You are a coding assistant. Explain this code clearly.\n
    Break it down line by line if needed.\n\nCode:\n${code}`,

  fix: (code) =>
    `You are a coding assistant. Find and fix all bugs in this code.\n
    Show the complete fixed version first, then explain what was wrong.\n\nCode:\n${code}`,

  tests: (code) =>
    `You are a coding assistant. Write comprehensive unit tests for this code.\n
    Use the same programming language as the code provided.\n\nCode:\n${code}`,
};
async function askOllama(task: string, code: string): Promise<string> {
  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: PROMPTS[task](code),
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}`);
  }

  const data = await response.json() as { response: string };
  return data.response;
}
function showResult(title: string, result: string) {
  const panel = vscode.window.createWebviewPanel(
    'localai',
    `LocalAI — ${title}`,
    vscode.ViewColumn.Beside,
    {}
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
        h2 { color: #4ec9b0; margin-bottom: 16px; }
        pre {
          background: #2d2d2d;
          padding: 16px;
          border-radius: 8px;
          white-space: pre-wrap;
          font-size: 13px;
          font-family: 'Menlo', monospace;
          border-left: 3px solid #4ec9b0;
        }
      </style>
    </head>
    <body>
      <h2>${title}</h2>
      <pre>${result}</pre>
    </body>
    </html>
  `;
}
async function handleCommand(task: string, label: string) {
  // Step 1 — get the active editor
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a code file first.');
    return;
  }

  // Step 2 — get selected text
  const selected = editor.document.getText(editor.selection);
  if (!selected) {
    vscode.window.showWarningMessage(
      'Select some code first, then run LocalAI.'
    );
    return;
  }

  // Step 3 — call Ollama with a loading indicator
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `LocalAI: ${label}...`,
      cancellable: false,
    },
    async () => {
      try {
        const result = await askOllama(task, selected);
        showResult(label, result);
      } catch (err) {
        vscode.window.showErrorMessage(
          'Could not reach Ollama. Make sure it is running: ollama serve'
        );
      }
    }
  );
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
    )
  );
}

export function deactivate() {}
