import * as vscode from 'vscode';
const MODEL = 'qwen2.5-coder:3b';
const OLLAMA_URL = 'http://localhost:11434/api/generate';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// ── Chat View Provider ────────────────────────────────────────────────────────

export class LocalAIChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'localai.chatView';
  private _view?: vscode.WebviewView;
  private _history: Message[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  // VS Code calls this when the sidebar panel first opens
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    console.log('LocalAI: resolveWebviewView called');
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // Render the initial HTML
    webviewView.webview.html = this._getHtml();

    // Listen for messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'chat') {
        await this._handleChat(message.text);
      }
      if (message.command === 'clear') {
        this._history = [];
        this._view?.webview.postMessage({ command: 'cleared' });
      }
    });
  }

  // ── Handle incoming chat message ───────────────────────────────────────────

  private async _handleChat(userText: string) {
    if (!this._view) { return; }

    // Add user message to history
    this._history.push({ role: 'user', content: userText });

    // Send user message to webview immediately so it appears
    this._view.webview.postMessage({
      command: 'addMessage',
      role: 'user',
      content: userText,
    });

    // Show typing indicator
    this._view.webview.postMessage({ command: 'typing' });

    // Get current file context
    const editor = vscode.window.activeTextEditor;
    const fileContext = editor
      ? `The user has this file open (${editor.document.fileName.split('/').pop()}):\n\`\`\`\n${editor.document.getText()}\n\`\`\``
      : 'No file is currently open.';

    // Build the full prompt with history
    const historyText = this._history
      .slice(0, -1) // exclude the message we just added
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const prompt = `You are LocalAI, an expert coding assistant running locally on the user's machine.
You are private, fast, and helpful. Never mention that you are an AI model or reference your training.

${fileContext}

${historyText ? `Conversation so far:\n${historyText}\n` : ''}
User: ${userText}
Assistant:`;

    try {
      // Stream the response
      const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          prompt,
          stream: true,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Ollama returned ${response.status}`);
      }

      // Read the stream chunk by chunk
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      // Tell webview to start a new assistant message
      this._view.webview.postMessage({ command: 'startAssistant' });

      while (true) {
        const { done, value } = await reader.read();
        if (done) { break; }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as { response: string; done: boolean };
            if (parsed.response) {
              fullResponse += parsed.response;
              // Send each token to the webview as it arrives
              this._view?.webview.postMessage({
                command: 'appendToken',
                token: parsed.response,
              });
            }
          } catch {
            // Incomplete JSON chunk — skip
          }
        }
      }

      // Save full response to history
      this._history.push({ role: 'assistant', content: fullResponse });
      this._view.webview.postMessage({ command: 'doneStreaming' });

    } catch (err) {
      this._view.webview.postMessage({
        command: 'error',
        content: 'Could not reach Ollama. Make sure it is running: ollama serve',
      });
    }
  }

  // ── HTML ───────────────────────────────────────────────────────────────────

  private _getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, sans-serif;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-foreground);
    }

    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .message {
      padding: 10px 12px;
      border-radius: 8px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .user {
      background: var(--vscode-input-background);
      border-left: 3px solid #4ec9b0;
      align-self: flex-end;
      max-width: 85%;
    }

    .assistant {
      background: var(--vscode-editor-background);
      border-left: 3px solid #569cd6;
      align-self: flex-start;
      max-width: 95%;
    }

    .typing {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      font-size: 12px;
      padding: 4px 12px;
    }

    .error {
      background: #3a1515;
      border-left: 3px solid #f44747;
      padding: 10px 12px;
      border-radius: 8px;
      color: #f44747;
    }

    code {
      font-family: 'Menlo', monospace;
      background: var(--vscode-textCodeBlock-background);
      padding: 2px 5px;
      border-radius: 3px;
      font-size: 12px;
    }

    pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      font-family: 'Menlo', monospace;
      font-size: 12px;
      margin: 6px 0;
    }

    #input-area {
      padding: 10px;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    #input {
      width: 100%;
      padding: 8px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 6px;
      font-size: 13px;
      font-family: inherit;
      resize: none;
      min-height: 60px;
      max-height: 120px;
    }

    #input:focus { outline: 1px solid #4ec9b0; border-color: #4ec9b0; }

    #actions {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }

    button {
      padding: 5px 14px;
      border: none;
      border-radius: 5px;
      font-size: 12px;
      cursor: pointer;
    }

    #send {
      background: #4ec9b0;
      color: #1e1e1e;
      font-weight: bold;
    }

    #send:hover { background: #3aab94; }
    #send:disabled { opacity: 0.5; cursor: not-allowed; }

    #clear {
      background: transparent;
      color: var(--vscode-descriptionForeground);
      border: 1px solid var(--vscode-panel-border);
    }

    #clear:hover { color: var(--vscode-foreground); }

    .welcome {
      color: var(--vscode-descriptionForeground);
      text-align: center;
      padding: 24px 12px;
      line-height: 1.8;
    }

    .welcome strong { color: #4ec9b0; }
  </style>
</head>
<body>
  <div id="messages">
    <div class="welcome">
      <strong>LocalAI Chat</strong><br>
      Ask anything about your code.<br>
      I can see the file you have open.
    </div>
  </div>

  <div id="input-area">
    <textarea
      id="input"
      placeholder="Ask about your code... (Shift+Enter for new line, Enter to send)"
    ></textarea>
    <div id="actions">
      <button id="clear">Clear</button>
      <button id="send">Send</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const clearBtn = document.getElementById('clear');
    let currentAssistantEl = null;
    let isStreaming = false;

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function addMessage(role, content) {
      // Remove welcome message if present
      const welcome = messagesEl.querySelector('.welcome');
      if (welcome) { welcome.remove(); }

      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.textContent = content;
      messagesEl.appendChild(div);
      scrollToBottom();
      return div;
    }

    function removeTyping() {
      const typing = messagesEl.querySelector('.typing');
      if (typing) { typing.remove(); }
    }

    // Handle messages from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;

      if (msg.command === 'addMessage') {
        addMessage(msg.role, msg.content);
      }

      if (msg.command === 'typing') {
        const div = document.createElement('div');
        div.className = 'typing';
        div.textContent = 'LocalAI is thinking...';
        messagesEl.appendChild(div);
        scrollToBottom();
      }

      if (msg.command === 'startAssistant') {
        removeTyping();
        currentAssistantEl = document.createElement('div');
        currentAssistantEl.className = 'message assistant';
        currentAssistantEl.textContent = '';
        messagesEl.appendChild(currentAssistantEl);
        scrollToBottom();
      }

      if (msg.command === 'appendToken') {
        if (currentAssistantEl) {
          currentAssistantEl.textContent += msg.token;
          scrollToBottom();
        }
      }

      if (msg.command === 'doneStreaming') {
        currentAssistantEl = null;
        isStreaming = false;
        sendBtn.disabled = false;
        inputEl.focus();
      }

      if (msg.command === 'error') {
        removeTyping();
        const div = document.createElement('div');
        div.className = 'error';
        div.textContent = msg.content;
        messagesEl.appendChild(div);
        isStreaming = false;
        sendBtn.disabled = false;
        scrollToBottom();
      }

      if (msg.command === 'cleared') {
        messagesEl.innerHTML = '<div class="welcome"><strong>LocalAI Chat</strong><br>Ask anything about your code.<br>I can see the file you have open.</div>';
        currentAssistantEl = null;
      }
    });

    // Send on Enter, new line on Shift+Enter
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    sendBtn.addEventListener('click', sendMessage);
    clearBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'clear' });
    });

    function sendMessage() {
      const text = inputEl.value.trim();
      if (!text || isStreaming) { return; }
      isStreaming = true;
      sendBtn.disabled = true;
      inputEl.value = '';
      vscode.postMessage({ command: 'chat', text });
    }
  </script>
</body>
</html>`;
  }
}