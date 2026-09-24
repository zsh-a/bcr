import { decodeTarget } from "./model";

/** Accept repository identities, never arbitrary API endpoints. */
export function parseRepository(value: string) {
  const match = /^(?:https:\/\/github\.com\/)?([\w-]+)\/([\w.-]+)\/?$/iu.exec(value.trim());
  if (!match?.[1] || !match[2]) throw new Error("请输入 GitHub 仓库地址或 用户/仓库");
  const target = decodeTarget({
    owner: match[1],
    repo: match[2].replace(/\.git$/iu, ""),
    branch: "main",
  });
  return { owner: target.owner, repo: target.repo };
}
