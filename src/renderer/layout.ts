export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TuiLayout {
  readonly header: Rect;
  readonly attention: Rect;
  /** The primary spatial surface; `list` is retained as a compatibility alias. */
  readonly map: Rect;
  readonly list: Rect;
  readonly inspector: Rect | undefined;
  readonly footer: Rect;
  readonly compact: boolean;
}

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width: Math.max(0, width),
  height: Math.max(0, height),
});

export const layoutFor = (width: number, height: number): TuiLayout => {
  const headerHeight = Math.min(2, Math.max(0, height));
  const attentionHeight = Math.min(2, Math.max(0, height - headerHeight));
  const footerHeight = Math.min(3, Math.max(0, height - headerHeight - attentionHeight));
  const contentY = headerHeight + attentionHeight;
  const contentHeight = Math.max(0, height - contentY - footerHeight);
  const compact = width < 100 || height < 26;
  const footer = rect(0, Math.max(0, height - footerHeight), width, footerHeight);
  const header = rect(0, 0, width, headerHeight);
  const attention = rect(0, headerHeight, width, attentionHeight);

  return {
    header,
    attention,
    // Inspection is a renderer overlay now. Keep the spatial surface full
    // width so the map remains the dominant experience at every terminal
    // size; the projection and inspector are not coupled to this geometry.
    map: rect(0, contentY, width, contentHeight),
    list: rect(0, contentY, width, contentHeight),
    inspector: undefined,
    footer,
    compact,
  };
};
