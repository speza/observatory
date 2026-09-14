import { describe, expect, test } from "bun:test";
import { agentsInMarquee, isMarqueeDrag, marqueeBounds } from "./atlasGeometry.ts";

const card = (id: string, x: number, y: number) => ({ id, x, y });

describe("marquee bounds", () => {
  test("normalises a drag in any direction", () => {
    expect(marqueeBounds({ x: 40, y: 90 }, { x: 10, y: 20 })).toEqual({
      left: 10,
      top: 20,
      right: 40,
      bottom: 90,
    });
  });

  test("treats a stray click as no drag", () => {
    const still = marqueeBounds({ x: 12, y: 12 }, { x: 13, y: 13 });
    expect(isMarqueeDrag(still)).toBe(false);
    const dragged = marqueeBounds({ x: 12, y: 12 }, { x: 30, y: 12 });
    expect(isMarqueeDrag(dragged)).toBe(true);
  });
});

describe("agents in marquee", () => {
  const cards = [card("a", 0, 0), card("b", 400, 0), card("c", 0, 400)];

  test("selects only cards whose rectangle intersects the marquee", () => {
    const bounds = marqueeBounds({ x: -300, y: -300 }, { x: 200, y: 200 });
    expect(agentsInMarquee(bounds, cards)).toEqual(["a"]);
  });

  test("selects every card the marquee covers", () => {
    const bounds = marqueeBounds({ x: -300, y: -300 }, { x: 700, y: 500 });
    expect(agentsInMarquee(bounds, cards)).toEqual(["a", "b", "c"]);
  });

  test("counts a card the marquee only clips at the edge", () => {
    // Card `c` spans x -110..110, so a marquee starting exactly on that edge clips it.
    const touching = marqueeBounds({ x: 110, y: 400 }, { x: 240, y: 460 });
    expect(agentsInMarquee(touching, [card("c", 0, 400)])).toEqual(["c"]);
    const missing = marqueeBounds({ x: 111, y: 400 }, { x: 240, y: 460 });
    expect(agentsInMarquee(missing, [card("c", 0, 400)])).toEqual([]);
  });

  test("keeps projection order rather than drag direction", () => {
    const bounds = marqueeBounds({ x: 700, y: 500 }, { x: -300, y: -300 });
    expect(agentsInMarquee(bounds, cards)).toEqual(["a", "b", "c"]);
  });

  test("a zero-area marquee is geometrically a point, not a selection", () => {
    const point = marqueeBounds({ x: 0, y: 0 }, { x: 0, y: 0 });
    expect(isMarqueeDrag(point)).toBe(false);
    expect(agentsInMarquee(point, cards)).toEqual(["a"]);
  });
});
