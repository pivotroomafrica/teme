import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePaged } from "./use-paged";

const items = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("usePaged", () => {
  it("shows the first page and says which items it is showing", () => {
    const { result } = renderHook(() => usePaged(items(25), 10));
    expect(result.current.slice).toEqual(items(10));
    expect([result.current.from, result.current.to, result.current.total]).toEqual([1, 10, 25]);
    expect(result.current.hasPrevious).toBe(false);
    expect(result.current.hasNext).toBe(true);
  });

  it("moves forward and back, and the last page is short", () => {
    const { result } = renderHook(() => usePaged(items(25), 10));
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.slice).toEqual([21, 22, 23, 24, 25]);
    expect([result.current.from, result.current.to]).toEqual([21, 25]);
    expect(result.current.hasNext).toBe(false);
    act(() => result.current.next()); // cannot go past the end
    expect(result.current.page).toBe(3);
    act(() => result.current.previous());
    expect(result.current.page).toBe(2);
  });

  it("steps back when the list shrinks, instead of showing an empty page", () => {
    const { result, rerender } = renderHook(({ n }) => usePaged(items(n), 10), {
      initialProps: { n: 25 },
    });
    act(() => result.current.next());
    act(() => result.current.next());
    rerender({ n: 12 });
    expect(result.current.page).toBe(2);
    expect(result.current.slice).toEqual([11, 12]);
    rerender({ n: 0 });
    expect(result.current.page).toBe(1);
    expect([result.current.from, result.current.to, result.current.total]).toEqual([0, 0, 0]);
  });

  it("goes back to page one on request", () => {
    const { result } = renderHook(() => usePaged(items(25), 10));
    act(() => result.current.next());
    act(() => result.current.reset());
    expect(result.current.page).toBe(1);
  });
});
