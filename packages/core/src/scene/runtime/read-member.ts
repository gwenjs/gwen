/**
 * Read `target[key]` for a value of unknown shape, without a cast and without `in`.
 *
 * An object, a function, `null` and `undefined` go through `Reflect.get`, so a Proxy whose `get`
 * trap serves the key is read like any other object. A primitive is boxed and reads `undefined`
 * for a key it lacks. `null` and `undefined` throw the native `TypeError` of `Reflect.get`: the
 * type is the one of a direct read, the message text differs (`Reflect.get called on non-object`
 * instead of `Cannot read properties of null (reading '...')`).
 *
 * @internal
 */
export function readMember(target: unknown, key: string): unknown {
  if (target === undefined || typeof target === "object" || typeof target === "function") {
    return Reflect.apply(Reflect.get, Reflect, [target, key]);
  }
  return Reflect.get(Object(target), key);
}
