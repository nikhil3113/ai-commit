# ai-commit

Generate git commit messages from your staged diff using the AI provider of your choice.

## Install & build

```
npm install
npm run build
```

## First run — set up your provider

```
node dist/index.js config
```

This walks you through:
1. Choosing a provider: **OpenRouter**, **Groq**, **Gemini**, **Ollama** (local, no key needed), or a **custom** OpenAI-compatible endpoint
2. Entering your API key (skipped for Ollama)
3. Picking a model (defaults are pre-filled per provider)

Your choice is saved to `~/.ai-commit/config.json` (file permissions `0600`, readable only by you).

Free keys:
- OpenRouter: https://openrouter.ai/keys
- Groq: https://console.groq.com/keys
- Gemini: https://aistudio.google.com/apikey
- Ollama: no key — just have it running locally (`ollama serve`)

## Usage

```
git add <files>
node dist/index.js              # generate, review, then commit/edit/cancel
node dist/index.js -y           # auto-commit, no prompt
node dist/index.js -m <model>   # override the model for this run only
node dist/index.js config       # re-run setup / change provider
```

## Publish as `npx ai-commit`

```
npm publish        # then anywhere: npx @nikhil3113/ai-commit
```
or run locally without publishing:
```
npm link           # then `ai-commit` is available everywhere on this machine
```

Requires Node >= 18 (built-in `fetch`).
