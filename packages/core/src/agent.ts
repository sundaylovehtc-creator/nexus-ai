// Nexus Core Agent — Effect.ts based Agent Loop
// Inspired by OpenCode anomalyco/agent.ts (MIT licensed)

import { Effect, Context, Layer } from "effect";
import { TokenBudget, makeTokenBudget, DEFAULT_BUDGET, TokenBudgetError } from "./effects/nexus-context.js";

// Message types
export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  tokens?: number;
}

export interface Session {
  id: string;
  userId: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  contextTokens: number;
}

// Provider interface (from OpenCode)
export interface LLMResponse {
  content: string;
  usage: { input: number; output: number };
  model: string;
}

export interface ModelProvider {
  generate(messages: Message[], options?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  }): Effect.Effect<LLMResponse, Error>;
}

// Tool interface
export interface Tool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>): Effect.Effect<string, Error>;
}

// Agent config
export interface AgentConfig {
  model: string;
  compressionModel: string;
  maxContextTokens: number;
  temperature: number;
}

// Agent service
export interface NexusAgent {
  readonly run: (session: Session, input: string) => Effect.Effect<string, Error | TokenBudgetError>;
  readonly compress: (session: Session) => Effect.Effect<Session, Error>;
  readonly addMessage: (session: Session, message: Message) => Session;
}

export const NexusAgent = Context.GenericTag<NexusAgent>("NexusAgent");

// Permission rules (from OpenCode permission.ts)
export type PermissionLevel = "allow" | "deny" | "ask";

export interface PermissionRuleset {
  [key: string]: PermissionLevel | PermissionRuleset;
}

export const DEFAULT_PERMISSIONS: PermissionRuleset = {
  "browser.*": "allow",
  "http.*": "allow",
  "file.read": "ask",
  "file.write": "ask",
  "exec": "ask",
  "skill.create": "deny",
  "skill.delete": "deny",
  "memory.write": "allow",
  "memory.read": "allow",
};

// Main agent implementation
export function makeNexusAgent(
  provider: ModelProvider,
  tools: Tool[],
  config: AgentConfig,
  tokenBudget: TokenBudget
): NexusAgent {
  const permissionCheck = (
    action: string,
    rules: PermissionRuleset
  ): PermissionLevel => {
    for (const [pattern, level] of Object.entries(rules)) {
      if (pattern === action) return level as PermissionLevel;
    }
    return "deny";
  };

  return {
    run(session, input) {
      return Effect.gen(function* () {
        // Add user message
        const userMsg: Message = {
          id: crypto.randomUUID(),
          role: "user",
          content: input,
          timestamp: Date.now(),
        };

        const updatedSession = addMessageToSession(session, userMsg);

        // Check token budget before generation
        const usage = yield* tokenBudget.getUsage();
        const newUsage = estimateSessionTokens(updatedSession);
        const remaining = DEFAULT_BUDGET.conversation - (usage.conversation + newUsage);

        if (remaining < 0) {
          return yield* Effect.fail(
            new TokenBudgetError("conversation", DEFAULT_BUDGET.conversation, usage.conversation)
          );
        }

        // Build messages for provider
        const systemMsg: Message = {
          id: "system",
          role: "system",
          content: buildSystemPrompt(tools),
          timestamp: Date.now(),
        };

        const allMessages = [systemMsg, ...updatedSession.messages];

        // Generate response
        const response = yield* provider.generate(allMessages, {
          model: config.model,
          maxTokens: 4096,
          temperature: config.temperature,
        });

        // Deduct from budget
        yield* tokenBudget.deduct("conversation", response.usage.output);

        // Add assistant message
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: response.content,
          timestamp: Date.now(),
          tokens: response.usage.output,
        };

        return response.content;
      });
    },

    compress(session) {
      return Effect.gen(function* () {
        const usage = yield* tokenBudget.getUsage();
        if (usage.dreaming >= DEFAULT_BUDGET.dreaming) {
          return session; // Can't dream, budget exhausted
        }

        // Compress older messages, keep recent
        const keepCount = Math.ceil(session.messages.length * 0.2);
        const recentMessages = session.messages.slice(-keepCount);

        const compressed: Session = {
          ...session,
          messages: recentMessages,
          updatedAt: Date.now(),
        };

        yield* tokenBudget.deduct("dreaming", 500); // Rough estimate
        return compressed;
      });
    },

    addMessage(session, message) {
      return addMessageToSession(session, message);
    },
  };
}

function addMessageToSession(session: Session, message: Message): Session {
  return {
    ...session,
    messages: [...session.messages, message],
    updatedAt: Date.now(),
  };
}

function estimateSessionTokens(session: Session): number {
  return session.messages.reduce((sum, msg) => sum + (msg.tokens || estimateMsgTokens(msg.content)), 0);
}

function estimateMsgTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

function buildSystemPrompt(tools: Tool[]): string {
  const toolDescs = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  return `You are Nexus, an AI agent.

Available tools:
${toolDescs}

Rules:
- Use tools when appropriate
- Be concise and practical
- Respect token budget
- When uncertain, ask for clarification`;
}

// Create the full Layer for dependency injection
export function NexusAgentLayer(
  provider: ModelProvider,
  tools: Tool[],
  config: AgentConfig
): Layer.Layer<NexusAgent> {
  const budget = makeTokenBudget();

  return Layer.effect(
    NexusAgent,
    Effect.sync(() => makeNexusAgent(provider, tools, config, budget))
  );
}

type NXUSAgent = NexusAgent;
