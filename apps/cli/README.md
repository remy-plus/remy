# Remy

One calm assistant for real digital work. Describe a task in plain words; Remy reads, searches and acts in small steps, and asks before anything that matters.

```sh
npm install -g @koryei/remy
export REMY_PROFILE=openai REMY_MODEL=gpt-5-nano OPENAI_API_KEY=...
remy
```

`remy` opens the chat. `remy run "<task>"` runs one task for scripts; `remy help` lists every command. Any OpenAI-compatible provider works: OpenAI, OpenRouter, Ollama, vLLM or Groq.

What it can and cannot do yet: [CAPABILITIES.md](https://github.com/remy-plus/remy/blob/main/CAPABILITIES.md). Site: [remy.plus](https://remy.plus). Needs Node 22.18 or newer.
