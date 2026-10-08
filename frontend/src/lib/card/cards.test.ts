import { describe, expect, it } from "vitest";
import { seal } from "@/lib/auth/seal";
import {
  CARD_TOKEN,
  MAX_CARDS,
  addCard,
  openCards,
  pickCard,
  removeCard,
  sealCards,
  type StoredCard,
} from "./cards";

const SECRET = "Zq8vN3tK1xW6pL9sD2fG5hJ7mB4cR0yU";
const card = (n: number, token = `token-number-${n}`): StoredCard => ({
  id: `id-${n}`,
  token,
  merchantEn: `Cafe ${n}`,
  merchantAm: null,
  brandColor: "#1b5e3a",
});

describe("stored cards", () => {
  it("round-trips through the sealed cookie value without exposing the token", async () => {
    const sealed = await sealCards([card(1)], SECRET);
    expect(sealed).not.toContain("token-number-1");
    expect(await openCards(sealed, SECRET)).toEqual([card(1)]);
  });

  it("treats a missing, forged, damaged or foreign cookie as no cards", async () => {
    expect(await openCards(undefined, SECRET)).toEqual([]);
    expect(await openCards("garbage", SECRET)).toEqual([]);
    const sealed = await sealCards([card(1)], SECRET);
    expect(await openCards(sealed, "another-secret-another-secret-123456")).toEqual([]);
    expect(await openCards(`${sealed}x`, SECRET)).toEqual([]);
  });

  it("refuses a value sealed for another purpose, such as a staff session", async () => {
    const session = await seal({ accessToken: "a", user: { id: "u" } }, SECRET);
    expect(await openCards(session, SECRET)).toEqual([]);
    const wrongPurpose = await seal({ purpose: "session", cards: [card(1)] }, SECRET);
    expect(await openCards(wrongPurpose, SECRET)).toEqual([]);
  });

  it("drops entries that are not well-formed cards", async () => {
    const sealed = await seal(
      {
        purpose: "cards",
        cards: [card(1), { id: "x", token: "short" }, 42, card(2, "has spaces in it")],
      },
      SECRET,
    );
    expect((await openCards(sealed, SECRET)).map((c) => c.id)).toEqual(["id-1"]);
  });
});

describe("addCard", () => {
  it("puts the newest card first", () => {
    expect(addCard([card(1)], card(2)).map((c) => c.id)).toEqual(["id-2", "id-1"]);
  });

  it("never lists the same card twice and keeps its id", () => {
    const again = { ...card(9, "token-number-1"), merchantEn: "Renamed" };
    const result = addCard([card(1), card(2)], again);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "id-1", merchantEn: "Renamed" });
  });

  it("keeps at most the limit, dropping the oldest", () => {
    let cards: StoredCard[] = [];
    for (let n = 1; n <= MAX_CARDS + 2; n++) cards = addCard(cards, card(n));
    expect(cards).toHaveLength(MAX_CARDS);
    expect(cards[0]!.id).toBe(`id-${MAX_CARDS + 2}`);
    expect(cards.some((c) => c.id === "id-1")).toBe(false);
  });
});

describe("removeCard and pickCard", () => {
  it("removes only the named card", () => {
    expect(removeCard([card(1), card(2)], "id-1").map((c) => c.id)).toEqual(["id-2"]);
  });

  it("picks the named card, otherwise the newest, and nothing when there are none", () => {
    const cards = [card(2), card(1)];
    expect(pickCard(cards, "id-1")?.id).toBe("id-1");
    expect(pickCard(cards, "unknown")?.id).toBe("id-2");
    expect(pickCard(cards, undefined)?.id).toBe("id-2");
    expect(pickCard([], "id-1")).toBeUndefined();
  });
});

describe("CARD_TOKEN", () => {
  it("accepts opaque tokens and rejects anything that could be markup or a path", () => {
    expect(CARD_TOKEN.test("mock-ok-1-4567")).toBe(true);
    expect(CARD_TOKEN.test("A".repeat(43))).toBe(true);
    for (const bad of [
      "short",
      "has space",
      "<script>alert(1)</script>",
      "a/b/c/d/e/f/g",
      "x".repeat(300),
    ]) {
      expect(CARD_TOKEN.test(bad)).toBe(false);
    }
  });
});
