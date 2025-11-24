import { describe, expect, it } from "@jest/globals"
import { createCallCapturer, dehydrate, executeDehydrated, hydrate } from "./index.js"

describe("createCallCapturer", () => {
  it("captures function calls with args and supports toJSON for function references", () => {
    const ctx = { Math: { sqrt: Math.sqrt } }
    const $ = createCallCapturer(ctx)

    const callSpec = $.Math.sqrt(9)
    expect(callSpec).toEqual({
      _path: ["Math", "sqrt"],
      _args: [9],
    })

    // function reference should serialize via toJSON to just a path
    const json = JSON.parse(JSON.stringify({ ref: $.Math.sqrt }))
    expect(json).toEqual({
      ref: { _path: ["Math", "sqrt"] },
    })
  })

  it("captures class constructor calls only when invoked with new and marks _class true", () => {
    class Box {
      constructor(v) {
        this.v = v
      }
    }
    const ctx = { C: { Box } }
    const $ = createCallCapturer(ctx)

    // must use "new" for classes
    const spec = new $.C.Box("value")
    expect(spec).toEqual({
      _path: ["C", "Box"],
      _args: ["value"],
      _class: true,
    })

    // calling without "new" should error
    expect(() => $.C.Box("value")).toThrow(
      "captured class instantiations should also use 'new'"
    )

    // referencing a class without calling should serialize to just a path
    const json = JSON.parse(JSON.stringify({ ref: $.C.Box }))
    expect(json).toEqual({ ref: { _path: ["C", "Box"] } })
  })

  it("navigates nested objects and throws on non-function properties", () => {
    const ctx = {
      a: { b: { c: (x) => x + 1 } },
      value: 42,
    }
    const $ = createCallCapturer(ctx)

    const spec = $.a.b.c(10)
    expect(spec).toEqual({
      _path: ["a", "b", "c"],
      _args: [10],
    })

    expect(() => $.value).toThrow(/context does not have function for path:/)
  })
})

describe("dehydrate", () => {
  it("returns callback result containing dehydrated call specs and function references", () => {
    const out = dehydrate({ Math }, ($) => ({
      a: $.Math.sqrt(16),
      ref: $.Math.sqrt, // uncalled, should serialize with only _path
      mixed: [$.Math.max(1, 7, 3), "x"],
    }))

    // Validate immediate structure (called functions produce objects)
    expect(out.a).toEqual({ _path: ["Math", "sqrt"], _args: [16] })
    expect(out.mixed[0]).toEqual({ _path: ["Math", "max"], _args: [1, 7, 3] })
    expect(out.mixed[1]).toBe("x")

    // Validate JSON serialization of uncalled function
    const roundTripped = JSON.parse(JSON.stringify(out))
    expect(roundTripped.ref).toEqual({ _path: ["Math", "sqrt"] })
  })

  it("can dehydrate a class constructor call (requires new) and set _class true", () => {
    class Person {
      constructor(name) {
        this.name = name
      }
    }
    const out = dehydrate({ NS: { Person } }, ($) => ({
      p: new $.NS.Person("Ada"),
    }))

    expect(out.p).toEqual({ _path: ["NS", "Person"], _args: ["Ada"], _class: true })
  })
})

describe("executeDehydrated", () => {
  it("executes a function at path with args", () => {
    const result = executeDehydrated({ Math }, { _path: ["Math", "sqrt"], _args: [9] })
    expect(result).toBe(3)
  })

  it("returns the function itself when args are undefined", () => {
    const fn = executeDehydrated({ Math }, { _path: ["Math", "sqrt"] })
    expect(typeof fn).toBe("function")
    expect(fn).toBe(Math.sqrt)
  })

  it("constructs when _class is true and target is a class", () => {
    class Person {
      constructor(name) {
        this.name = name
      }
    }
    const context = { NS: { Person } }
    const result = executeDehydrated(context, {
      _path: ["NS", "Person"],
      _args: ["Ada"],
      _class: true,
    })
    expect(result).toBeInstanceOf(Person)
    expect(result.name).toBe("Ada")
  })

  it("throws when _class is true but target is not a class", () => {
    const context = { f: (x) => x * 2 }
    expect(() =>
      executeDehydrated(context, { _path: ["f"], _args: [2], _class: true })
    ).toThrow("context does not have a class at path: f")
  })

  it("throws when path does not resolve to a function", () => {
    expect(() => executeDehydrated({ Math }, { _path: ["Math", "PI"] })).toThrow(
      "context does not have a function at path: Math.PI"
    )

    expect(() => executeDehydrated({}, { _path: ["Missing", "fn"] })).toThrow(
      "context does not have a function at path: Missing.fn"
    )
  })

  it("hydrates nested dehydrated args before invoking the target function", () => {
    const context = { Math }
    const result = executeDehydrated(context, {
      _path: ["Math", "max"],
      _args: [{ _path: ["Math", "sqrt"], _args: [16] }, 3],
    })
    expect(result).toBe(4)
  })

  it("hydrates constructor specs inside args before invocation", () => {
    class Box {
      constructor(v) {
        this.v = v
      }
    }
    const context = {
      NS: { Box },
      utils: { getV: (b) => b.v },
    }
    const result = executeDehydrated(context, {
      _path: ["utils", "getV"],
      _args: [{ _path: ["NS", "Box"], _args: [123], _class: true }],
    })
    expect(result).toBe(123)
  })

  it("passes function references (no _args) through when used as args", () => {
    const context = {
      Math,
      utils: { call: (fn, x) => fn(x) },
    }
    const result = executeDehydrated(context, {
      _path: ["utils", "call"],
      _args: [{ _path: ["Math", "sqrt"] }, 9],
    })
    expect(result).toBe(3)
  })
})

describe("hydrate", () => {
  it("hydrates objects, arrays, and primitives recursively", () => {
    const input = {
      x: { _path: ["Math", "max"], _args: [1, 7, 3] },
      y: [{ _path: ["Math", "min"], _args: [2, 5] }, 10, { nested: { k: "v" } }],
      f: { _path: ["Math", "sqrt"] }, // no args -> returns the function itself
      plain: { alpha: 1 },
      num: 42,
      str: "hello",
      bool: true,
      nil: null,
    }

    const out = hydrate(input, { Math })

    expect(out.x).toBe(7)
    expect(out.y[0]).toBe(2)
    expect(out.y[1]).toBe(10)
    expect(out.y[2]).toEqual({ nested: { k: "v" } })
    expect(out.f).toBe(Math.sqrt)
    expect(out.plain).toEqual({ alpha: 1 })
    expect(out.num).toBe(42)
    expect(out.str).toBe("hello")
    expect(out.bool).toBe(true)
    expect(out.nil).toBeNull()
  })

  it("hydrates a class constructor when _class is true", () => {
    class Box {
      constructor(v) {
        this.v = v
      }
    }
    const input = { item: { _path: ["NS", "Box"], _args: [123], _class: true } }
    const out = hydrate(input, { NS: { Box } })
    expect(out.item).toBeInstanceOf(Box)
    expect(out.item.v).toBe(123)
  })

  it("leaves primitives untouched", () => {
    expect(hydrate(5, { Math })).toBe(5)
    expect(hydrate("x", { Math })).toBe("x")
    expect(hydrate(null, { Math })).toBeNull()
  })
})
