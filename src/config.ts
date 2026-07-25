
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProviderName } from "./providers.js";

export interface FallbackConfig{
  provider: ProviderName;
  apiKey?:string;
  model:string;
  baseUrl?:string
}
export interface Config{
  provider: ProviderName;
  apiKey?:string;
  model:string
  baseUrl?:string
  fallback?:FallbackConfig
}


const CONFIG_DIR = join(homedir(), ".ai-commit")
const CONFIG_FILE = join(CONFIG_DIR, "config.json")

export function loadConfig(): Config|null{
  if (!existsSync(CONFIG_FILE)) return null;
  try{
    const raw = readFileSync(
CONFIG_FILE, "utf-8"
    )
    return JSON.parse(raw) as Config
  }catch{
    return null
  }
}

export function saveConfig(config:Config):void{
  if(!existsSync(CONFIG_DIR)){
    mkdirSync((CONFIG_DIR), {recursive:true})
  }

  writeFileSync((CONFIG_FILE), JSON.stringify(config, null, 2), {mode: 0o600})
}

export function conifPath():string{
  return CONFIG_FILE
}
