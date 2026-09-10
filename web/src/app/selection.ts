export interface Selection {
  readonly type: "goal" | "agent" | "discovered-execution";
  readonly id: string;
}
