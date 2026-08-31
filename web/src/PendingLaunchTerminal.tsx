import type { WebPendingLaunch } from "../../src/web/protocol.ts";
import { TerminalSurface, type TerminalTheme } from "./TerminalSurface.tsx";

interface PendingLaunchTerminalProps {
  readonly launch: WebPendingLaunch;
  readonly onClose: () => void;
  readonly theme: TerminalTheme;
}

export const PendingLaunchTerminal = ({
  launch,
  onClose,
  theme,
}: PendingLaunchTerminalProps): React.JSX.Element => (
  <TerminalSurface active embedded={false} launch={launch} onClose={onClose} theme={theme} />
);
