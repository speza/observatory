export type ModalKind =
  | "create-goal"
  | "text"
  | "goal-picker"
  | "agent-picker"
  | "related-agents"
  | "linked-execution-picker"
  | "agent-launch"
  | "workspace-picker"
  | "confirm";

export interface ModalFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly contentX: number;
  readonly footerY: number;
}

const baseHeight = (kind: ModalKind): number => {
  switch (kind) {
    case "create-goal":
      return 9;
    case "goal-picker":
      return 10;
    case "agent-picker":
      return 15;
    case "related-agents":
      return 20;
    case "linked-execution-picker":
      return 14;
    case "agent-launch":
      return 14;
    case "workspace-picker":
      return 18;
    case "confirm":
      return 7;
    case "text":
      return 7;
  }
};

const MAX_MODAL_WIDTH = 96;

/** Center a modal and reserve a distinct footer row below its content. */
export const modalFrameFor = (width: number, height: number, kind: ModalKind): ModalFrame => {
  const modalWidth = Math.min(width - 4, MAX_MODAL_WIDTH, Math.max(42, Math.floor(width * 0.76)));
  const modalHeight = Math.min(height - 4, baseHeight(kind));
  const x = Math.max(1, Math.floor((width - modalWidth) / 2));
  const y = Math.max(1, Math.floor((height - modalHeight) / 2));
  return {
    x,
    y,
    width: modalWidth,
    height: modalHeight,
    contentX: x + 2,
    footerY: y + modalHeight - 2,
  };
};
