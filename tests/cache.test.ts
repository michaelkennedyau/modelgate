import { describe, expect, test } from "bun:test";
import { LRUCache } from "../src/utils/cache.js";

describe("LRUCache", () => {
  test("basic get/set works", () => {
    const cache = new LRUCache<string, number>(10);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
  });

  test("get returns undefined for missing key", () => {
    const cache = new LRUCache<string, number>(10);
    expect(cache.get("missing")).toBeUndefined();
  });

  test("eviction when at capacity — oldest entry removed", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    // Cache is full: [a, b, c]

    cache.set("d", 4);
    // "a" should be evicted: [b, c, d]

    expect(cache.has("a")).toBe(false);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
    expect(cache.size).toBe(3);
  });

  test("get() promotes entry — prevents eviction", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    // Cache: [a, b, c]

    // Access "a" to promote it to most recently used
    cache.get("a");
    // Cache: [b, c, a]

    // Add "d" — should evict "b" (now the oldest), not "a"
    cache.set("d", 4);
    // Cache: [c, a, d]

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });

  test("set() with existing key updates value and promotes", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // Update "a" — should promote it
    cache.set("a", 100);
    expect(cache.get("a")).toBe(100);
    expect(cache.size).toBe(3);

    // Add "d" — should evict "b" (oldest after "a" was promoted)
    cache.set("d", 4);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("a")).toBe(true);
  });

  test("has() works without promoting", () => {
    const cache = new LRUCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // has() should not promote "a"
    expect(cache.has("a")).toBe(true);
    expect(cache.has("missing")).toBe(false);

    // Add "d" — "a" should be evicted since has() did not promote it
    cache.set("d", 4);
    expect(cache.has("a")).toBe(false);
  });

  test("clear() removes all entries", () => {
    const cache = new LRUCache<string, number>(10);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.size).toBe(3);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBeUndefined();
  });

  test("size property reflects current entry count", () => {
    const cache = new LRUCache<string, number>(5);
    expect(cache.size).toBe(0);

    cache.set("a", 1);
    expect(cache.size).toBe(1);

    cache.set("b", 2);
    expect(cache.size).toBe(2);

    cache.set("a", 10); // update, not a new entry
    expect(cache.size).toBe(2);
  });

  test("cache with maxSize of 1 works correctly", () => {
    const cache = new LRUCache<string, number>(1);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.size).toBe(1);

    cache.set("b", 2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.size).toBe(1);
  });

  test("constructor rejects maxSize < 1", () => {
    expect(() => new LRUCache<string, number>(0)).toThrow();
    expect(() => new LRUCache<string, number>(-1)).toThrow();
  });
});
