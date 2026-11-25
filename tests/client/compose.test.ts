import { describe, expect, it } from "vitest";
import { fallbackBots, parseMessage, type Bot } from "../../client/src/compose";

const bots: Bot[] = [
  { handle: "walter", name: "Walter", primary: true },
  { handle: "email_bot", name: "email_bot" },
];

describe("parseMessage", () => {
  it("sends plain text to the primary bot", () => {
    expect(parseMessage("  call the plumber ", bots)).toMatchObject({ bot: bots[0], body: "call the plumber", tagged: false });
  });

  it("routes a leading @handle and strips the tag", () => {
    expect(parseMessage("@Email_Bot draft a reply", bots)).toMatchObject({ bot: bots[1], body: "draft a reply", tagged: true });
  });

  it("only counts a tag at the very start", () => {
    expect(parseMessage("ask @email_bot later", bots)).toMatchObject({ bot: bots[0], tagged: false });
  });

  it("reports an unknown tag", () => {
    expect(parseMessage("@nobody hi", bots)).toMatchObject({ bot: null, handle: "nobody", typingTag: false });
  });

  it("knows when the tag is still being typed", () => {
    expect(parseMessage("@em", bots)).toMatchObject({ typingTag: true, handle: "em" });
    expect(parseMessage("@walter ", bots)).toMatchObject({ typingTag: false, bot: bots[0], body: "" });
  });
});

describe("fallbackBots", () => {
  it("makes the assistant the only, primary bot", () => {
    expect(fallbackBots("Walter")).toEqual([{ handle: "walter", name: "Walter", primary: true }]);
    expect(fallbackBots("Dr. Who 2")).toEqual([{ handle: "drwho2", name: "Dr. Who 2", primary: true }]);
    expect(fallbackBots("!!!")[0]?.handle).toBe("assistant");
  });
});
