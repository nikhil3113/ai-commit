import { execSync } from "node:child_process"

export function isGitRepo():boolean{
  try {
    execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
  return true;
  } catch (error) {
   return false 
  }
}

export function getStagedDiff(): string {
  return execSync("git diff --cached", { encoding: "utf8", maxBuffer: 1024 * 1024 * 20 });
}
 
export function commit(message: string): void {
  execSync("git commit -F -", { input: message, stdio: ["pipe", "inherit", "inherit"] });
}


