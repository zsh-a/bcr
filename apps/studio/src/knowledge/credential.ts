import type { GitTarget } from "./model";

export const knowledgeCredentialId = (target: Pick<GitTarget, "owner" | "repo"> | null) =>
  target
    ? `github:${target.owner.trim().toLowerCase()}/${target.repo.trim().toLowerCase()}`
    : "github:unconfigured";
