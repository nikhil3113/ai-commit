import { Config } from "./config.js";

export type ProviderName = "openrouter" | "groq" | "gemini" | "ollama" | "custom";


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
  "conventional-commit-style commit message: a concise summary line (max 72 " +
  "chars, imperative mood, e.g. 'fix: handle null user on login'), then a " +
  "blank line, then 2-5 short bullet points of the key changes if helpful. " +
  "Do not include any preamble, explanation, or markdown code fences — output " +
  "only the raw commit message text.";
 
function userPrompt(diff: string): string {
  return `Here is the staged git diff:\n\n${diff.slice(0, 12000)}`;
}

async function callOpenAiCompatible(
  baseUrl:string,
  apiKey:string | undefined,
  model:string,
  diff:string
): Promise<string>{
  const headers: Record<string, string> = {"Content-Type": "application/json"};

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
      temparature: 0.3,
    })
  })

  const data = await res.json();
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

  const baseUrl= config.baseUrl || info.defaultModel
  if(!baseUrl) throw new Error(`Base URL is required for provider ${config.provider}`)

  return callOpenAiCompatible(baseUrl, config.apiKey, model, diff)
}







