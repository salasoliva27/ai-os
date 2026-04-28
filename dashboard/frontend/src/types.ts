export type Profile = {
  firstBoot: boolean;
  aiName: string | null;
  aiKind: string | null;
  enabledTools: string[];
  systemPromptAdditions: string;
  defaultEngine: "anthropic" | "openai" | null;
  updatedAt: number;
};

export type WsOut =
  | { type: "ready"; profile: Profile }
  | { type: "chunk"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };
