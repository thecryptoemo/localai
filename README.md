# LocalAI

An offline AI coding assistant for VS Code. No API keys. No internet. No data leaving your machine.

Runs entirely on your laptop using [Ollama](https://ollama.com) and `qwen2.5-coder:3b`.

---

## What it does

| Command | Shortcut | What happens |
|---|---|---|
| Explain Code | `Cmd+Shift+E` | Explains selected code with full file context |
| Fix Bug | `Cmd+Shift+F` | Finds and fixes bugs, apply with one click |
| Write Tests | `Cmd+Shift+T` | Generates unit tests for selected code |
| Refactor File | `Cmd+Shift+R` | Refactors entire file, shows diff, accept or reject |

All commands also appear on right-click when code is selected.

---

## Setup

**1 — Install Ollama**
```bash
brew install ollama
```

**2 — Pull the model**
```bash
ollama pull qwen2.5-coder:3b
```

**3 — Clone and run**
```bash
git clone https://github.com/thecryptoemo/localai.git
cd localai
npm install
npm run compile
code --extensionDevelopmentPath=$(pwd)
```

---

## Why

Every AI coding tool today sends your code to an external server.
LocalAI doesn't. Your code stays on your machine — always.

Built in one weekend as part of the Activate Fellowship application.

---

## Stack

- TypeScript + VS Code Extension API
- Ollama (local model runner)
- qwen2.5-coder:3b (default model)
- esbuild
