export type Profile = {
  firstBoot: boolean;
  aiKind: string | null;
  enabledTools: string[];
  systemPromptAdditions: string;
  updatedAt: number;
};

export type WsOut =
  | { type: "ready"; profile: Profile }
  | { type: "chunk"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };
