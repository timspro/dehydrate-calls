# dehydrate-calls

Allows sending JSON that encodes function calls.

## First Time Setup

`npm install @tim-code/my-util`

## What??

There are times when we want to send a JSON object to the server, but there are aspects to the JSON object that do not automatically serialize well to JSON. In general, in order to send this object we need to "dehydrate" it, meaning turn into well-formed JSON, and then on the server we can "rehydrate" it by turning the JSON back into what it was originally.

There are a lot of bespoke solutions to this problem such as implementing toJSON() for class instances and then writing a code on the server to call class constructors on certain properties. However, these patterns are more difficult to scale when adding additional "special" properties and require coordinating code changes on the client and the server.

The solution that this library supports is to write functions that when called with certain parameters, generate the non-serializable object (or function!). Then, instead of sending the output of these functions to the server, we send a record of what the function call was and the arguments were. The server can then hydrate the object and execute the function calls on its side.

Function calls are always applied from a "context", which is basically a whitelist of functions.

## Toy Example

Suppose we want to sent `{"a": Math.sqrt(2)}` to the server but are concerned with loss of precision from sending the decimal value.

Using this library, we can do:

```js
import { dehydrate } from "@tim-code/dehydrate-calls"
const request = dehydrate({ Math }, ($) => ({ a: $.Math.sqrt(2) }))
```

`request` is: `{a: {_path: ["Math", "sqrt"], _args: [2]}}`

and then on the server:

```js
const result = hydrate(request, { Math })
```

`result` is: `{a: 1.414...}`

### Client-Side Alternative

Instead of calling `dehydrate()`, we can instead create "fake" versions of the calls we want to do by using `createCallCapturer()`:

```js
const $ = createCallCapturer({ Math })
const request = { a: $.Math.sqrt(2) }
```

As before, `request` is: `{a: {_path: ["Math", "sqrt"], _args: [2]}}`.

This allows exporting fake versions of modules that can then be imported by code doing the requests:

```js
export default createCallCapturer({ Math, Date })
```

Then in another file:

```js
import $ from "..."
const request = { a: $.Math.sqrt(2) }
```

### Function References

It is also possible to include function names instead of calls: `{a: Math.sqrt}`.

However, the result of

```js
const request = dehydrate({ Math }, ($) => ({ a: $.Math.sqrt }))
```

is now: `{a: <function>}`, not a JSON object. This function though has a toJSON() method defined so after:

```js
const intermediate = JSON.parse(JSON.stringify(request))
```

`intermediate` is :`{a: {_path: ["Math", "sqrt"] }}`

In most cases, the result of dehydrate will be stringified, so this detail shouldn't be noticeable.

### Classes

This library also works with user-defined or third-party classes (not built-ins):

```js
class Person {
  constructor(name) {
    this.name = name
  }
}
const request = dehydrate({ Person }, ($) => ({ a: new $.Person("John Smith") }))
```

`request` is: `{a: {_path: ["Person"], _args: ["John Smith"], _class: true}}`.

Note that it is required to still use `new` when calling the fake constructor.
