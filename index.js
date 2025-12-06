import { isClass } from "@tim-code/my-util"

/**
 * Returns an object that "captures" calls by translating them to a JSON format.
 * Example: `const $ = createCallCapturer({ Math }); return { a: $.Math.sqrt(2) }`
 * Returns: {a: {_path: ["Math", "sqrt"], _args: [2]}}
 *
 * Example with function reference, not call:
 * `const $ = createCallCapturer({ Math }); return JSON.parse(JSON.stringify({ a: $.Math.sqrt }))`
 * Returns: {a: {_path: ["Math", "sqrt"] }}
 * @param {Object} context
 * @param {Function} callback
 * @returns {Object}
 */
export function createCallCapturer(context, path = []) {
  return new Proxy(context, {
    get(target, key) {
      const value = target[key]
      if (typeof value === "function") {
        let capturer
        if (isClass(value)) {
          // require returned function to be used with "new" for syntactic parity
          // for example: `dehydrate({ Account }, ($) => new $.Account(100))`
          // eslint-disable-next-line func-names
          capturer = function (..._args) {
            if (!new.target) {
              throw new Error("captured class instantiations should also use 'new'")
            }
            return { _path: path.concat([key]), _class: true, _args }
          }
        } else {
          capturer = (..._args) => {
            return { _path: path.concat([key]), _args }
          }
        }
        // allow functions in context to be referenced without being executed
        // don't care if a class is referenced this way
        capturer.toJSON = () => {
          return { _path: path.concat([key]) }
        }
        return capturer
      }
      if (value && typeof value === "object") {
        return createCallCapturer(value, path.concat([key]))
      }
      throw new Error(
        `context does not have function for path: ${path.concat([key]).join(".")}`
      )
    },
  })
}

/**
 * Allows including "dehydrated" function calls in a JSON object.
 * Example: `dehydrate({ Math }, ($) => ({ a: $.Math.sqrt(2) }))`
 * Returns: {a: {_path: ["Math", "sqrt"], _args: [2]}}
 * @param {Object} context
 * @param {Function} callback
 * @returns {Object}
 */
export function dehydrate(context, callback) {
  const result = callback(createCallCapturer(context))
  return result
}

export function executeDehydrated(context, { _path, _args, _class }) {
  let pathContext = context
  for (const key of _path) {
    pathContext = pathContext?.[key]
  }
  if (typeof pathContext === "function") {
    if (_args) {
      // eslint-disable-next-line no-use-before-define
      const args = hydrate(_args, context)
      if (_class) {
        if (isClass(pathContext)) {
          return new pathContext(...args)
        }
        throw new Error(`context does not have a class at path: ${_path.join(".")}`)
      }
      return pathContext(...args)
    }
    return pathContext
  }
  throw new Error(`context does not have a function at path: ${_path.join(".")}`)
}

/**
 * Allows executing "dehydrated" function calls.
 * Example: `hydrate({a: {_path: ["Math", "sqrt"], _args: [2]}}, { Math })`
 * Returns: {a: 1.414...}
 * @param {Object} json
 * @param {Object} context
 * @returns {Object}
 */
export function hydrate(json, context) {
  // iterate through object and rehydrate values
  if (json && typeof json === "object") {
    if (Array.isArray(json)) {
      const results = []
      for (const element of json) {
        results.push(hydrate(element, context))
      }
      return results
    }
    if (json._path) {
      const result = executeDehydrated(context, json)
      return result
    }
    const result = Object.create(null)
    for (const key of Object.keys(json)) {
      result[key] = hydrate(json[key], context)
    }
    return result
  }
  return json
}
