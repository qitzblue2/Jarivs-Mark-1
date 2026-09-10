/** A tool the model can call. Handlers run server-side, never in the browser. */
export interface Tool {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /**
   * Runs the tool. Whatever string comes back is fed to the model verbatim,
   * so make failures descriptive — the model can often recover from a clear
   * error, but not from a silent one.
   */
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
  /** Touches the network or the filesystem. Surfaced differently in the UI. */
  dangerous?: boolean;
}

export interface ToolContext {
  signal?: AbortSignal;
}

/** One tool call requested by the model, once its streamed fragments are whole. */
export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string as the model emitted it; may be malformed. */
  arguments: string;
}

/** The result of running one call, ready to send back as a `tool` message. */
export interface ToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError: boolean;
  /** Wall-clock duration, shown in the UI trace. */
  ms: number;
}

/** The wire shape providers expect in the `tools` array. */
export function toWireTool(tool: Tool) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
