#!/usr/bin/env node
import { Config, conifPath, loadConfig, saveConfig } from "./config.js"
import * as p from "@clack/prompts"
import { generateCommitMessage, ProviderName, PROVIDERS } from "./providers.js"
import { mkdtempDisposable } from "node:fs/promises"
import { commit, getStagedDiff, isGitRepo } from "./git.js"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"

function parseArgs(argv:string[]){
  const args = {autoYes:false, model:undefined as string | undefined, command: undefined as string | undefined}

  for(let i=0; i<argv.length; i++){
    const a = argv[i]
    if(a =="-y" || a=="--yes") args.autoYes = true
    else if(a == "-m" || a == "--model") args.model = argv[++i]
    else if (a== "config" || a=="-h" || a=="--help") args.command = a
  }

  return args
} 

async function runConfigWizard(existing:Config | null): Promise<Config>{
  p.intro("Welcome to ai-commit configuration wizard!")

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

  if(info.needsApiKey){
    const keyHint = info.keyUrl? `(get your key here: ${info.keyUrl})` : ""
    const key = await p.password({
      message: `Enter your API key ${keyHint}:`,
      validate: (v) => (v?.trim().length === 0?"API key cannot be empty":""),
    })

    if(p.isCancel(key)){
      p.cancel("Configuration cancelled.")
      process.exit(1)
    }
    apiKey = key
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
      validate: (v) => (v?.trim().length === 0 ? "Base URL can't be empty" : undefined),
    });
    if (p.isCancel(url)) {
      p.cancel("Setup cancelled.");
      process.exit(1);
    }
    baseUrl = url;
  }

  const config: Config = {
    provider,
    apiKey,
    model: (model as string) || info.defaultModel,
    baseUrl
  }

  saveConfig(config)
  p.outro("Configuration saved to " + conifPath())

  return config
}

async function main(){
  const {autoYes, model:modelOverride, command} = parseArgs(process.argv.slice(2))
  
  if (command === "-h" || command === "--help") {
    console.log(`Usage: ai-commit [-y] [-m <model>]
       ai-commit config     run the provider/API key setup wizard
 
  -y, --yes           commit automatically, no confirmation prompt
  -m, --model <name>  override the model for this run only
`);
    return
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

  const diff = getStagedDiff()
  if(!diff.trim()){
    p.log.error("No staged changes found. Please stage your changes before running this command.")
    process.exit(1)
  }

  p.intro("Generating commit message using " + PROVIDERS[config.provider].label + "...")
  const s = p.spinner()
  s.start(`Generating commit message with ${config.provider}/${config.model}`);

  let message:string
  try {
    message = await generateCommitMessage(config, diff)
  } catch (error) {
    s.stop("Failed to generate commit message: " + (error as Error).message)
    p.log.error("Error details: " + (error as Error).stack)
    p.outro("You can run 'ai-commit config' to reconfigure your provider and API key.")
    process.exit(1)
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
    const tmpFile = join(tmpdir(), `ai-commit-msg-${Date.now()}.txt`);
    writeFileSync(tmpFile, message);
    const editor = process.env.EDITOR || "nano";
    execSync(`${editor} ${tmpFile}`, { stdio: "inherit" });
    const edited = readFileSync(tmpFile, "utf8");
    unlinkSync(tmpFile);
    commit(edited);
  } else {
    commit(message);
  }

  p.outro("Changes committed successfully.")
}

main().catch((err) => {
  p.log.error("Unexpected error: " + err.message);
  process.exit(1);
})

