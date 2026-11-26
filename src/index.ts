#!/usr/bin/env node
import { Config, conifPath, FallbackConfig, loadConfig, maskApiKey, saveConfig } from "./config.js"
import * as p from "@clack/prompts"
import { buildFallbackConfig, generateCommitMessage, ProviderName, PROVIDERS } from "./providers.js"
import { commit, getStagedDiff, isGitRepo } from "./git.js"


function parseArgs(argv:string[]){
  const args = {autoYes:false, model:undefined as string | undefined, command: undefined as string | undefined, fallbackSetup:false}

  for(let i=0; i<argv.length; i++){
    const a = argv[i]
    if(a =="-y" || a=="--yes") args.autoYes = true
    else if(a == "-m" || a == "--model") args.model = argv[++i]
    else if(a==="--fallback-model") args.fallbackSetup = true
    else if (a== "config" || a=="-h" || a=="--help") args.command = a

  }

  return args
} 

async function runConfigWizard(existing:Config | null): Promise<Config>{
  p.intro("Welcome to ai-commit configuration wizard!")
 
  if(existing){
    const lines:string[] = [
      `Provider: ${PROVIDERS[existing.provider].label}`,
      `Model: ${existing.model || PROVIDERS[existing.provider].defaultModel}`,
    ]
    if(existing.apiKey) lines.push(`API Key: ${maskApiKey(existing.apiKey)}`)
    if(existing.baseUrl) lines.push(`Base URL: ${existing.baseUrl}`)
    if(existing.fallback){
      const f = existing.fallback
      lines.push(`Fallback:  ${PROVIDERS[f.provider].label} \u2192 ${f.model}`)
    }
    p.note(lines.join("\n"), "Current Configuration")
    }
  
  const provider = (await p.select({
    message: "Which AI provider do you want to use?",
    initialValue: existing?.provider,
    options: (Object.keys(PROVIDERS) as ProviderName[]).map((key) => ({
      value: key,
      label: PROVIDERS[key].label,
      hint: PROVIDERS[key].hint,
    })),
  })) as ProviderName;

  if(p.isCancel(provider)){
    p.cancel("Configuration cancelled.")
    process.exit(1)
  }

  const info = PROVIDERS[provider]
  let apiKey:string | undefined;

  if (info.needsApiKey) {
    const hasExistingKey = !!existing?.apiKey
    if (hasExistingKey) {
      p.log.step(`Current API key: ${maskApiKey(existing.apiKey!)}`)
    }
    const keyHint = info.keyUrl ? `(get your key here: ${info.keyUrl})` : ""
    const key = await p.password({
      message: hasExistingKey
        ? `Enter API key (leave empty to keep current) ${keyHint}`
        : `Enter your API key ${keyHint}:`,
      validate: (v) => {
        if (!v?.trim() && !hasExistingKey) return "API key cannot be empty"
        return undefined
      },
    })
    if (p.isCancel(key)) {
      p.cancel("Configuration cancelled.")
      process.exit(1)
    }
    apiKey = key?.trim() || existing?.apiKey || undefined
  }

  const model = await p.text({
    message: `Enter model to use for ${info.label}`,
    placeholder: info.defaultModel || "e.g. llama-3.1-8b-instant",
    defaultValue: info.defaultModel,
    initialValue: existing?.provider === provider ? existing?.model : undefined,
  })
    if(p.isCancel(model)) {
      p.cancel("Configuration cancelled.")
      process.exit(1)
  }

  let baseUrl: string | undefined = info.defaultBaseUrl
    if (provider === "custom") {
    const url = await p.text({
      message: "Base URL for your OpenAI-compatible endpoint",
      placeholder: "https://api.example.com/v1",
      initialValue: existing?.provider === "custom" ? existing?.baseUrl: undefined,
      validate: (v) => (v?.trim().length === 0 ? "Base URL can't be empty" : undefined),
    });
    if (p.isCancel(url)) {
      p.cancel("Setup cancelled.");
      process.exit(1);
    }
    baseUrl = url;
  }

  let config: Config = {
    provider,
    apiKey,
    model: (model as string) || info.defaultModel,
    baseUrl,
    // Preserve any existing fallback unless the user explicitly changes/removes it
    ...(existing?.fallback ? { fallback: existing.fallback } : {}),
  }

  saveConfig(config)

  if (existing?.fallback) {
    const f = existing.fallback
    const action = await p.select({
      message: `Fallback is set to ${PROVIDERS[f.provider].label} → ${f.model}. What do you want to do?`,
      initialValue: "keep",
      options: [
        { value: "keep", label: "Keep current fallback" },
        { value: "change", label: "Reconfigure fallback" },
        { value: "remove", label: "Remove fallback" },
      ],
    })

    if (!p.isCancel(action)) {
      if (action === "change") {
        const fallback = await runFallbackWizard(config)
        if (fallback) {
          config = { ...config, fallback }
          saveConfig(config)
        }
      } else if (action === "remove") {
        const { fallback: _removed, ...rest } = config
        config = rest
        saveConfig(config)
      }
    }
  } else {
    const useFallback = await p.confirm({
      message: "Configure a fallback provider for when the primary fails?",
      initialValue: false,
    })

    if (!p.isCancel(useFallback) && useFallback) {
      const fallback = await runFallbackWizard(config)
      if (fallback) {
        config = { ...config, fallback }
        saveConfig(config)
      }
    }
  }
  p.outro("Configuration saved to " + conifPath())

  return config
}

async function runFallbackWizard(primary:Config): Promise<FallbackConfig|null>{
  const provider = (await p.select({
    message: "Which AI provider do you want to use for fallback?",
    initialValue: primary.provider,
    options: (Object.keys(PROVIDERS) as ProviderName[]).map((key) => ({
      value: key,
      label: PROVIDERS[key].label,
      hint: PROVIDERS[key].hint,
    })),
  })) as ProviderName

    if(p.isCancel(provider)) return null
    
    const info = PROVIDERS[provider]
  let apiKey:string | undefined;

  if(info.needsApiKey){
    const sameProvider = provider === primary.provider
    const existingKey = sameProvider ? primary.apiKey : undefined

    if(existingKey) {
      p.log.step(`Current API key for ${info.label}: ${maskApiKey(existingKey)}`)
    }
    const key = await p.password({
     message: existingKey
        ? `Enter API key (leave empty to keep current):`
        : `Enter your API key for fallback ${info.label}:`,
      validate: (v) => {
        if (!v?.trim() && !existingKey) return "API key cannot be empty for this provider"
        return undefined
      },    })
    if(p.isCancel(key)) return null
    apiKey = key?.trim() || existingKey || undefined

  }

  const model = await p.text({
    message: `Enter model to use for ${info.label}`,
    placeholder: info.defaultModel || "e.g. llama-3.1-8b-instant",
    defaultValue: info.defaultModel,
  })
    if(p.isCancel(model)) return null

  let baseUrl: string | undefined = info.defaultBaseUrl
  if(provider === "custom"){
    const url = await p.text({
      message: "Base URL for your OpenAI-compatible endpoint",
      placeholder: "https://api.example.com/v1",
      validate: (v) => (v?.trim().length === 0 ? "Base URL can't be empty" : undefined),
    })
    if(p.isCancel(url)) return null
    baseUrl = url as string
  }

  return {
    provider,
    apiKey,
    model: (model as string) || info.defaultModel,
    baseUrl
  }
}

async function main(){
  const {autoYes, model:modelOverride, command,fallbackSetup} = parseArgs(process.argv.slice(2))
  
  if (command === "-h" || command === "--help") {
    console.log(`Usage: ai-commit [-y] [-m <model>] [--fallback-model]
       ai-commit config     run the provider/API key setup wizard

  -y, --yes           commit automatically, no confirmation prompt
  -m, --model <name>  override the model for this run only
  --fallback-model    configure a fallback AI provider
`);    return
  }

  let config = loadConfig()

  if(command === "config" || !config){
    config = await runConfigWizard(config)
    if(command === "config") return
  }

  if(modelOverride) config = {...config, model:modelOverride}

  if(!isGitRepo()){
    p.log.error("Not a git repository. Please run this command inside a git repo.")
    process.exit(1)
  }
  
  if(fallbackSetup){
    p.intro("Setting up fallback provider...")
    const fallback = await runFallbackWizard(config)
    if(fallback){
      config = {...config, fallback}
      saveConfig(config)
      p.outro("Fallback configuration saved to " + conifPath())
    }else{
      p.outro("Fallback configuration cancelled.")
    }
    return
  }

  const diff = getStagedDiff()
  if(!diff.trim()){
    p.log.error("No staged changes found. Please stage your changes before running this command.")
    process.exit(1)
  }

  p.intro("Generating commit message using " + PROVIDERS[config.provider].label + "...")
  const s = p.spinner()
  s.start(`Generating commit message with ${config.provider}/${config.model}`);

  let message: string;
try {
  message = await generateCommitMessage(config, diff);
} catch (error) {
  if (config.fallback) {
    s.stop(`Primary provider ${PROVIDERS[config.provider].label} failed, trying fallback...`);
    message = await generateCommitMessage(buildFallbackConfig(config), diff);
    s.stop("Commit message generated using fallback provider.");
  } else {
    s.stop("Failed to generate commit message: " + (error as Error).message);
    p.log.error("Error details: " + (error as Error).stack);
    p.outro("You can run 'ai-commit config' to reconfigure your provider and API key.");
    process.exit(1);
  }
}

  s.stop("Commit message generated successfully.")

  p.note(message, "Generated commit message:")

  if(autoYes){
    commit(message)
    p.outro("Changes committed successfully.")
    return
  }

  const action = await p.select({
    message: "What do you want to do?",
    options:[
      {value:"commit", label:"Commit with this message"},
      {value:"edit", label:"Edit the message before committing"},
      {value:"cancel", label:"Cancel and do not commit"},
    ]
  })

  if(p.isCancel(action) || action === "cancel"){
    p.cancel("Commit cancelled.")
    process.exit(1)
  }

  if(action === "edit"){
    const edited = await p.multiline({
      message: "Edit the commit message:",
      initialValue: message,
      validate: (v) => (!v || v.trim().length === 0 ? "Message cannot be empty" : undefined),
    })
    if (p.isCancel(edited)) {
      p.cancel("Edit cancelled.")
      process.exit(1)
    }
    commit(edited)
  } else {
    commit(message);
  }

  p.outro("Changes committed successfully.")
}

main().catch((err) => {
  p.log.error("Unexpected error: " + err.message);
  process.exit(1);
})

