import type { AgentTool, ToolExecutionContext } from "./runtime";
import { requiresApproval } from "./tools";

/** An execution boundary usable by chat, browser bridges and future local hosts. */
export async function executeAgentTool(
  tool: AgentTool,
  input: string,
  context: ToolExecutionContext,
  policy: {
    authorize: () => void;
    approve: (
      preview: Awaited<ReturnType<NonNullable<AgentTool["preview"]>>> | undefined,
    ) => Promise<boolean>;
    execute?: () => Promise<unknown>;
  },
): Promise<unknown> {
  context.signal?.throwIfAborted();
  policy.authorize();
  if (requiresApproval(tool.spec)) {
    const preview = await tool.preview?.(input);
    context.signal?.throwIfAborted();
    if (!(await policy.approve(preview))) throw new Error("用户未批准这次操作");
  }
  context.signal?.throwIfAborted();
  policy.authorize();
  if (policy.execute) return policy.execute();
  const result = await tool.call(input, context);
  try {
    return JSON.parse(result) as unknown;
  } catch {
    return result;
  }
}
