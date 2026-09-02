interface KeyboardGuideProps {
  readonly onClose: () => void;
}

export const KeyboardGuide = ({ onClose }: KeyboardGuideProps): React.JSX.Element => (
  <aside aria-label="Keyboard shortcuts" className="keyboard-guide">
    <header>
      <div>
        <p className="overline">FIELD CONTROLS</p>
        <h2>Move through the work</h2>
      </div>
      <button aria-label="Close keyboard shortcuts" onClick={onClose} type="button">
        ×
      </button>
    </header>
    <dl>
      <div>
        <dt>↑ ↓ / j k</dt>
        <dd>Select the next goal or agent</dd>
      </div>
      <div>
        <dt>Enter / Space</dt>
        <dd>Focus the selection or open its terminal</dd>
      </div>
      <div>
        <dt>Double-click</dt>
        <dd>Focus a map item directly</dd>
      </div>
      <div>
        <dt>Drag / wheel</dt>
        <dd>Pan and zoom the atlas</dd>
      </div>
      <div>
        <dt>+ − / 0</dt>
        <dd>Zoom in, zoom out, or reset the map</dd>
      </div>
      <div>
        <dt>f</dt>
        <dd>Focus the current selection</dd>
      </div>
      <div>
        <dt>/ or ⌘/Ctrl+k</dt>
        <dd>Find a Goal or Agent in the Atlas, Inspector, or Inbox</dd>
      </div>
      <div>
        <dt>a / b / v / n / N</dt>
        <dd>Needs you, inbox, view, new goal, new agent</dd>
      </div>
      <div>
        <dt>i / ? / Esc</dt>
        <dd>Inspector, shortcuts, close or clear</dd>
      </div>
      <div>
        <dt>⌘/Ctrl+Tab / 1–9</dt>
        <dd>Switch terminal tabs when a terminal deck is open</dd>
      </div>
    </dl>
  </aside>
);
