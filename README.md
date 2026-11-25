# frida-electron-bridge

Electron/Node.js runtime interop from Frida.

Where [frida-objc-bridge](https://github.com/frida-packages/frida-objc-bridge) reaches
into the Objective-C runtime and
[frida-java-bridge](https://github.com/frida-packages/frida-java-bridge) into the JVM,
this bridge reaches into the V8 isolate that Electron runs its JavaScript on —
in the main process and in renderers alike. It attaches to the isolate through
Node's stable N-API C ABI, so your Frida agent can read globals, call functions,
construct objects and require() modules in the target app.

## Usage

```ts
import Electron from "frida-electron-bridge";

Electron.perform(realm => {
    const { app, BrowserWindow } = realm.require("electron");

    send({
        name: realm.toJs(app.getName()),
        electron: realm.toJs(realm.global.process.versions.electron),
        windows: realm.toJs(BrowserWindow.getAllWindows().length),
    });
});
```

`perform()` returns a `Promise`, and its callback runs on the target's
JavaScript thread. Values handed to that callback are live V8 handles, valid
only for the duration of the call — convert anything you want to keep with
`realm.toJs()` before returning.

For a one-off expression there is a shorthand that marshals the result back:

```ts
const versions = await Electron.evaluate("process.versions");
```

## API

### `Electron`

- `available: boolean` — whether an Electron/Node runtime is present in this
  process.
- `perform<T>(fn: (realm: Realm) => T): Promise<T>` — run `fn` on the JavaScript
  thread.
- `evaluate(source: string): Promise<any>` — evaluate `source` and marshal the
  result.

### `Realm`

The handle passed to `perform()`.

- `global` — the target's global object, as a proxy.
- `require(id)` — resolve a module through the realm's `require`.
- `evaluate(source)` — evaluate source in the target's context.
- `toJs(value)` — deep-convert a target value into a plain agent-side value.
- `fromJs(value)` — convert an agent-side value into a target value. Agent
  functions become callable target functions, so the app can call back into your
  agent; each one is released when the target garbage-collects it.
- `liveCallbacks` — how many agent functions the target still holds.
- `await(promise)` — settle a target promise into an agent-side one.
- `persist(value)` — pin a value past the current `perform()`, giving a `JsRef`
  you `get()` inside a later one and `free()` when done.

Proxies returned by `global`, `require()` and `evaluate()` behave like the
objects they stand for: property access, assignment, `Object.keys()`, calls with
the right receiver, and `new`. Every result is itself a proxy, so
`realm.global.process.versions.electron` walks the target's object graph.

Drop to `JsValue` for the untyped layer:

```ts
import { unwrap, ValueType } from "frida-electron-bridge";

const versions = unwrap(realm.global.process.versions);
versions.type === ValueType.Object;
versions.keys();
versions.get("electron").toString();
```

## Renderer processes

Renderers work the same way, as long as the app gives them a Node environment —
which Electron does for a non-sandboxed preload, and which the bridge detects by
waiting for a context that has one. From there `realm.global` is the page's
global, so `location`, `document` and `navigator` are all in reach:

```ts
Electron.perform(realm => {
    send(realm.toJs(realm.global.document.title));
});
```

## DevTools Protocol

From the main process you can drive the Chrome DevTools Protocol against any
renderer, via Electron's `webContents.debugger`. This inspects a renderer
without injecting into it at all, and reaches domains — `DOM`, `Network`,
`Debugger`, `Profiler` — that the value bridge alone does not cover.

```ts
import { Debugger } from "frida-electron-bridge";

const [page] = await Debugger.list();
const session = await Debugger.attach(page.id);

send(await session.evaluate("document.title"));

await session.send("Network.enable");
await session.addEventHandler((method, params) => {
    if (method === "Network.requestWillBeSent") {
        send(params.request.url);
    }
});
```

- `Debugger.list()` — the app's web contents, as `{ id, type, url, title }`.
- `Debugger.attach(webContentsId, protocolVersion?)` — attach, returning a
  session.
- `session.send(method, params?)` — issue a command, resolving with its result.
- `session.evaluate(expression)` — `Runtime.evaluate` shorthand, by value.
- `session.addEventHandler(handler)` — receive protocol events.
- `session.detach()`.

## How it works

1. The Electron framework is located by its exported `napi_open_handle_scope`.
2. `v8::Function::Call` is hooked once, to land on the thread that owns the
   isolate.
3. From there `napi_module_register_by_symbol()` mints a `napi_env` — as if a
   native addon had been loaded — and the hook is removed.
4. A threadsafe function is created from that env, so later `perform()` calls
   are queued onto the app's event loop from Frida's thread without hooking
   anything.

Everything above step 4 happens on the first `perform()`. If the runtime has not
been loaded yet — e.g. on a gated spawn — the bridge waits for it through a
module observer, so instrumenting from launch works.

## Requirements

- A build whose Node exports `napi_module_register_by_symbol` — verified on
  Electron 42 and 43. Older builds keep that symbol internal (Electron 33 does
  not export it), and `Electron.available` reports `false` there.
- A Node environment in the process being instrumented. The main process always
  has one; a renderer has one unless the app sandboxes it. Without one there is
  no `napi_env` to mint, and `perform()` waits rather than completing — reach
  such renderers over the DevTools Protocol from the main process instead.
- `Debugger` is main-process only, since `webContents` lives there.

## Testing

The suite runs inside GumJS via [injest](https://github.com/frida-packages/injest),
against a minimal Electron app in `tests/fixture`:

```sh
npm install
npm test
npm run typecheck
```

`tests/realm.test.ts` depends on that fixture; `tests/runtime.test.ts` does not,
so it runs against any Electron app. `injest.config.json` defines a `discord`
target for that:

```sh
npx injest runtime --target discord
```
