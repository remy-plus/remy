# Remy

One calm assistant for real digital work. Describe a task in plain words; Remy reads, searches and acts in small steps, and asks before anything that matters.

```sh
npm install -g @koryei/remy
remy login      # pick a provider and paste its key, once
remy
```

`remy` opens the chat. `remy run "<task>"` runs one task for scripts; `remy help` lists every command. Works with OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Ollama and any OpenAI-compatible endpoint. Without a login, set `REMY_PROFILE`, `REMY_MODEL` and the provider's key variable.

What it can and cannot do yet: [CAPABILITIES.md](https://github.com/remy-plus/remy/blob/main/CAPABILITIES.md). Site: [remy.plus](https://remy.plus). Needs Node 22.18 or newer.
