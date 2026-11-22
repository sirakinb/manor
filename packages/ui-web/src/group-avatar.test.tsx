import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GroupAvatar } from "./group-avatar.js";

describe("GroupAvatar", () => {
  it("renders fallback squad icon when no members provided", () => {
    const html = renderToString(<GroupAvatar members={[]} />);
    expect(html).toContain("<svg");
  });

  it("renders a single member on a non-sprite colour with upstream's avatar", () => {
    const html = renderToString(<GroupAvatar members={[{ name: "Harry", color: "#6366F1" }]} />);
    expect(html).toContain("rakazo-organic-avatar");
    expect(html).not.toContain("rakazo-bot-avatar-sprite");
  });

  it("renders a single member on a Manor sprite colour as the sprite", () => {
    const html = renderToString(<GroupAvatar members={[{ name: "Harry", color: "#8B5CF6" }]} />);
    expect(html).toContain('class="rakazo-bot-avatar-sprite"');
    expect(html).toContain("/sprites/sprite-purple.png");
    expect(html).not.toContain("rakazo-organic-avatar");
  });

  it("draws each member by the same rule in a mixed group", () => {
    const html = renderToString(
      <GroupAvatar
        members={[
          { name: "Sherlock", color: "#F5C542" },
          { name: "Elon", color: "#06B6D4" },
        ]}
      />,
    );
    expect(html).toContain("/sprites/sprite-yellow.png");
    expect(html).toContain("rakazo-organic-avatar");
  });

  it("renders 2 overlapping bot avatars for 2 members", () => {
    const html = renderToString(
      <GroupAvatar
        members={[
          { name: "Sherlock", color: "#6366F1" },
          { name: "Elon", color: "#06B6D4" },
        ]}
      />,
    );
    const count = (html.match(/data-working=/g) || []).length;
    expect(count).toBe(2);
    expect(html).toContain('data-working="false"');
  });

  it("renders a working member inside a group avatar", () => {
    const html = renderToString(
      <GroupAvatar
        members={[
          { name: "Sherlock", color: "#6366F1", status: "running" },
          { name: "Elon", color: "#06B6D4", status: "idle" },
        ]}
      />,
    );
    expect(html).toContain('data-working="true"');
    expect(html).toContain("rakazo-organic-avatar");
  });

  it("renders 3 mini bot avatars for 3 members", () => {
    const html = renderToString(
      <GroupAvatar
        members={[
          { name: "Sherlock", color: "#6366F1" },
          { name: "Elon", color: "#06B6D4" },
          { name: "Penny", color: "#EC4899" },
        ]}
      />,
    );
    const count = (html.match(/data-working=/g) || []).length;
    expect(count).toBe(3);
  });

  it("renders 2 mini avatars + overflow count for 4+ members", () => {
    const html = renderToString(
      <GroupAvatar
        members={[
          { name: "Sherlock", color: "#6366F1" },
          { name: "Elon", color: "#06B6D4" },
          { name: "Penny", color: "#EC4899" },
          { name: "Harry", color: "#10B981" },
        ]}
      />,
    );
    expect(html).toContain("+2");
    expect(html).toMatch(/<div\b[^>]*\baria-hidden="true"[^>]*>\+2<\/div>/);
  });
});
