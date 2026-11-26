import { Config } from "./config.js";

import { randomUUID } from "node:crypto";

export type ProviderName = "openrouter" | "groq" | "gemini" | "opencode" | "opencode-go" | "ollama" | "custom";


export interface ProviderInfo {
  label: string;
  hint: string;
  needsApiKey: boolean;
  defaultModel: string;
  defaultBaseUrl?: string; // OpenAI-compatible chat/completions base, e.g. https://openrouter.ai/api/v1
  keyUrl?: string; // where to get a free key
}


export const PROVIDERS: Record<ProviderName, ProviderInfo> = {
  openrouter: {
    label: "OpenRouter",
    hint: "many free models, e.g. meta-llama/llama-3.1-8b-instruct:free",
    needsApiKey: true,
    defaultModel: "meta-llama/llama-3.1-8b-instruct:free",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
  },
  groq: {
    label: "Groq",
    hint: "free tier, very fast inference",
    needsApiKey: true,
    defaultModel: "llama-3.1-8b-instant",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    keyUrl: "https://console.groq.com/keys",
  },
  gemini: {
    label: "Google Gemini",
    hint: "free tier",
    needsApiKey: true,
    defaultModel: "gemini-1.5-flash",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  opencode: {
    label: "OpenCode Zen",
    // Only Zen models served via /chat/completions work here (e.g. deepseek, kimi, glm, minimax, qwen3.8-max).
    // gpt-*/claude-*/gemini-* models use other endpoints, and free-tier models only work inside OpenCode itself.
    hint: "pay-as-you-go gateway; use chat/completions models like deepseek-v4.1-flash, kimi-k2.6, glm-5.3",
    needsApiKey: true,
    defaultModel: "deepseek-v4.1-flash",
    defaultBaseUrl: "https://opencode.ai/inference/openai/v1",
    keyUrl: "https://opencode.ai/console",
  },
  "opencode-go": {
    label: "OpenCode Go (subscription)",
    // Only Go models served via chat-completions work here; minimax-m3, qwen*, claude-*, gpt-*, grok-*, gemini-* use other APIs.
    // List: curl https://opencode.ai/inference/go/v1/models
    hint: "Go subscription; chat-completions models like deepseek-v4.1-flash, kimi-k3, glm-5.3-flash",
    needsApiKey: true,
    defaultModel: "deepseek-v4.1-flash",
    defaultBaseUrl: "https://opencode.ai/inference/go/openai/v1",
    keyUrl: "https://opencode.ai/console",
  },
  ollama: {
    label: "Ollama (local, no API key)",
    hint: "runs fully on your machine, requires Ollama running locally",
    needsApiKey: false,
    defaultModel: "llama3.1",
    defaultBaseUrl: "http://localhost:11434/v1",
  },
  custom: {
    label: "Custom (OpenAI-compatible endpoint)",
    hint: "any provider that speaks the OpenAI chat/completions API",
    needsApiKey: true,
    defaultModel: "",
  },
};

const SYSTEM_PROMPT =
  "You are a git commit message generator. Given a git diff, output ONLY a " +
  "SINGLE-LINE conventional-commit-style message in the format " +
  "'<type>: <subject>', where <type> is one of: feat, fix, docs, style, " +
  "refactor, perf, test, build, ci, chore, or revert. The subject must be " +
  "concise (max 72 chars), in imperative mood, and lowercase (e.g. " +
  "'fix: handle null user on login'). Do not include a body, bullet points, " +
  "preamble, explanation, or markdown code fences — output only the single " +
  "raw commit message line.";
 
function userPrompt(diff: string): string {
  return `Here is the staged git diff:\n\n${diff.slice(0, 12000)}`;
}

async function callOpenAiCompatible(
  baseUrl:string,
  apiKey:string | undefined,
  model:string,
  diff:string,
  extraHeaders: Record<string, string> = {}
): Promise<string>{
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "ai-commit",
    ...extraHeaders,
  };

  if(apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages:[
        {role:"system", content:SYSTEM_PROMPT},
        {role:"user", content:userPrompt(diff)}
      ],
      temperature: 0.3,
    })
  })

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status} from ${baseUrl}: ${text.slice(0, 500)}`);
  }
  if (!res.ok && !data.error) {
    throw new Error(`HTTP ${res.status} from ${baseUrl}: ${text.slice(0, 500)}`);
  }
  if (data.error) {
    throw new Error(typeof data.error === "string" ? data.error : data.error.message || JSON.stringify(data.error));
    }
   const msg= data.choices?.[0]?.message?.content?.trim();
    if (!msg) throw new Error(`No message returned. Raw response: ${JSON.stringify(data).slice(0, 500)}`);
  return msg;
  }

async function callGemini(apiKey: string, model: string, diff: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt(diff)}` }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
    }),
  });
 
  const data: any = await res.json();
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }
  const msg = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!msg) throw new Error(`No message returned. Raw response: ${JSON.stringify(data).slice(0, 500)}`);
  return msg;
}


export async function generateCommitMessage(config: Config, diff:string): Promise<string>{
  const info = PROVIDERS[config.provider]
  const model = config.model || info.defaultModel

  if(config.provider === "gemini"){
    if(!config.apiKey) throw new Error("API key is required for Gemini provider")
    return callGemini(config.apiKey, model, diff)
  }

  const baseUrl= config.baseUrl || info.defaultBaseUrl
  if(!baseUrl) throw new Error(`Base URL is required for provider ${config.provider}`)

  // OpenCode Go requires a stable per-conversation session header from third-party clients
  const extraHeaders: Record<string, string> =
    config.provider === "opencode-go" ? { "x-opencode-session": randomUUID() } : {}

  return callOpenAiCompatible(baseUrl, config.apiKey, model, diff, extraHeaders)
}

export function buildFallbackConfig(primary:Config): Config{
  if(!primary.fallback) throw new Error("No fallback config defined")
  const info = PROVIDERS[primary.fallback.provider]
  return{
    provider: primary.fallback.provider,
    apiKey: primary.fallback.apiKey ?? primary.apiKey,
    model: primary.fallback.model || info.defaultModel,
    baseUrl: primary.fallback.baseUrl || info.defaultBaseUrl
  }
}






