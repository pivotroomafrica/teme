import { describe, expect, it } from "vitest";
import { fillPath, serializeQuery } from "./query";

describe("serializeQuery", () => {
  it("returns an empty string for nothing", () => {
    expect(serializeQuery(undefined)).toBe("");
    expect(serializeQuery({})).toBe("");
    expect(serializeQuery({ a: undefined, b: null })).toBe("");
  });

  it("skips empty values, sorts keys and keeps booleans and numbers", () => {
    expect(serializeQuery({ z: 1, a: "x", skip: undefined, flag: false })).toBe(
      "?a=x&flag=false&z=1",
    );
  });

  it("percent-encodes values so they cannot break out of the query", () => {
    expect(serializeQuery({ q: "a&b=c d#e", name: "አበበ" })).toBe(
      "?name=%E1%8A%A0%E1%89%A0%E1%89%A0&q=a%26b%3Dc+d%23e",
    );
  });

  it("repeats the key for arrays and formats dates as ISO 8601", () => {
    expect(serializeQuery({ id: ["a", "b", null, undefined] })).toBe("?id=a&id=b");
    expect(serializeQuery({ from: new Date("2026-10-01T00:00:00.000Z") })).toBe(
      "?from=2026-10-01T00%3A00%3A00.000Z",
    );
  });

  it("ignores prototype-polluting keys", () => {
    const query = JSON.parse('{"__proto__":"x","constructor":"y","ok":"1"}');
    expect(serializeQuery(query)).toBe("?ok=1");
  });
});

describe("fillPath", () => {
  it("encodes path parameters", () => {
    expect(fillPath("/join/{joinReference}", { joinReference: "a/b c" })).toBe("/join/a%2Fb%20c");
    expect(fillPath("/x/{a}/y/{b}", { a: 1, b: "two" })).toBe("/x/1/y/two");
  });

  it("refuses a missing parameter instead of calling a wrong URL", () => {
    expect(() => fillPath("/join/{joinReference}", {})).toThrow(/joinReference/);
    expect(() => fillPath("/join/{joinReference}", { joinReference: "" })).toThrow();
  });

  it("cannot be tricked into traversing paths", () => {
    expect(fillPath("/join/{r}", { r: "../admin" })).toBe("/join/..%2Fadmin");
  });
});
