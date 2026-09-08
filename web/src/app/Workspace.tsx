import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2, PanelLeft, PanelRight } from "lucide-react";
import { Schema } from "effect";
import "./workspace.css";

type Layout = { left: number; right: number; navigation: boolean };
const storageKey = "observatory.workspace-layout";
const decodeLayout = Schema.decodeUnknownSync(
  Schema.parseJson(
    Schema.Struct({
      left: Schema.Number.pipe(Schema.finite(), Schema.between(200, 400)),
      right: Schema.Number.pipe(Schema.finite(), Schema.between(300, 560)),
      navigation: Schema.Boolean,
    }),
  ),
);
const initialLayout = (): Layout => {
  try {
    return decodeLayout(localStorage.getItem(storageKey) ?? "null");
  } catch {
    return { left: 240, right: 360, navigation: true };
  }
};

export const Workspace = ({
  navigation,
  inspector,
  children,
  inspectorOpen,
  onInspectorOpenChange,
  revealInspector,
  revealNavigation,
}: {
  readonly navigation: ReactNode;
  readonly inspector: ReactNode;
  readonly children: (focusControl: ReactNode) => ReactNode;
  readonly inspectorOpen: boolean;
  readonly onInspectorOpenChange: (open: boolean) => void;
  readonly revealNavigation?: string;
  readonly revealInspector?: string;
}): React.JSX.Element => {
  const [layout, setLayout] = useState(initialLayout);
  const [focus, setFocus] = useState(false);
  const [width, setWidth] = useState(window.innerWidth);
  const [narrowPane, setNarrowPane] = useState<"navigation" | "inspector">();
  const drag = useRef<{ side: "left" | "right"; x: number; width: number } | undefined>(undefined);
  useEffect(() => {
    const resize = (): void => setWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      /* Layout remains usable when browser storage is unavailable. */
    }
  }, [layout]);
  useEffect(() => {
    if (!revealInspector) return;
    onInspectorOpenChange(true);
    setNarrowPane("inspector");
    setFocus(false);
  }, [revealInspector, onInspectorOpenChange]);
  useEffect(() => {
    if (!inspectorOpen && narrowPane === "inspector") setNarrowPane(undefined);
  }, [inspectorOpen, narrowPane]);
  useEffect(() => {
    if (!revealNavigation || revealNavigation === "all") return;
    setLayout((current) => ({ ...current, navigation: true }));
    setNarrowPane("navigation");
    setFocus(false);
  }, [revealNavigation]);
  const leftOpen = !focus && layout.navigation && (width >= 1200 || narrowPane === "navigation");
  const rightOpen =
    !focus &&
    inspectorOpen &&
    (width >= 700 || narrowPane === "inspector") &&
    !(width < 1200 && leftOpen);
  const resizeHandle = (side: "left" | "right"): React.JSX.Element => (
    <div
      className={`workspace__resize workspace__resize--${side}`}
      role="separator"
      aria-label={`Resize ${side === "left" ? "navigation" : "inspector"}`}
      aria-orientation="vertical"
      aria-valuemin={side === "left" ? 200 : 300}
      aria-valuemax={side === "left" ? 400 : 560}
      aria-valuenow={layout[side]}
      tabIndex={0}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const min = side === "left" ? 200 : 300;
        const max = side === "left" ? 400 : 560;
        const delta = (event.key === "ArrowRight" ? 16 : -16) * (side === "left" ? 1 : -1);
        setLayout((current) => ({
          ...current,
          [side]:
            event.key === "Home"
              ? min
              : event.key === "End"
                ? max
                : Math.max(min, Math.min(max, current[side] + delta)),
        }));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { side, x: event.clientX, width: layout[side] };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        const next = start.width + (event.clientX - start.x) * (side === "left" ? 1 : -1);
        setLayout((current) => ({
          ...current,
          [side]: Math.max(
            side === "left" ? 200 : 300,
            Math.min(side === "left" ? 400 : 560, next),
          ),
        }));
      }}
      onPointerUp={() => {
        drag.current = undefined;
      }}
      onLostPointerCapture={() => {
        drag.current = undefined;
      }}
    />
  );
  return (
    <div className="workspace">
      <div className="workspace__toolbar">
        <button
          type="button"
          aria-label="Toggle navigation"
          aria-expanded={leftOpen}
          onClick={() => {
            setFocus(false);
            if (width < 1200) {
              setNarrowPane(leftOpen ? undefined : "navigation");
              setLayout((current) => ({ ...current, navigation: true }));
            } else setLayout((current) => ({ ...current, navigation: !leftOpen }));
          }}
        >
          <PanelLeft size={16} /> Navigation
        </button>
        <button
          type="button"
          aria-label="Toggle inspector"
          aria-expanded={rightOpen}
          onClick={() => {
            setFocus(false);
            setNarrowPane(rightOpen ? undefined : "inspector");
            onInspectorOpenChange(!rightOpen);
          }}
        >
          <PanelRight size={16} /> Inspector
        </button>
      </div>
      <div className="workspace__body">
        {leftOpen ? (
          <div className="workspace__navigation" style={{ width: layout.left }}>
            <div className="workspace__navigation-scroll">{navigation}</div>
            {resizeHandle("left")}
          </div>
        ) : null}
        <div className="workspace__canvas">
          {children(
            <button
              className="workspace__focus"
              type="button"
              aria-pressed={focus}
              onClick={() => setFocus(!focus)}
            >
              {focus ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              {focus ? "Restore panels" : "Focus map"}
            </button>,
          )}
        </div>
        {rightOpen ? (
          <div className="workspace__inspector" style={{ width: layout.right }}>
            {resizeHandle("right")}
            {inspector}
          </div>
        ) : null}
      </div>
    </div>
  );
};
