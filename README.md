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

- `available: boolean` — whether a supported Electron/Node runtime is present in
  this process.
- `hasNodeEnvironment: boolean` — whether this process hosts a Node
  environment, decided from its command line the way Electron decides it: the
  main process and non-sandboxed renderers do, `utilityProcess` children do,
  sandboxed renderers, the GPU process and other utility processes do not.
- `perform<T>(fn: (realm: Realm) => T): Promise<T>` — run `fn` on the JavaScript
  thread. Rejects right away where `hasNodeEnvironment` is `false`, and when the
  runtime lacks something the bridge needs.
- `evaluate(source: string): Promise<any>` — evaluate `source` and marshal the
  result.
- `dispose(): Promise<void>` — tear the bridge down; see [Teardown](#teardown).

### `Realm`

The handle passed to `perform()`.

- `global` — the target's global object, as a proxy.
- `require(id)` — resolve a module through the realm's `require`: the global
  one where there is one, else the app's main module's, else one created with
  `module.createRequire()` at the app's entry point (an app whose entry is an ES
  module has no main module).
- `evaluate(source)` — evaluate source in the target's context.
- `toJs(value, options?)` — deep-convert a target value into a plain agent-side
  value. Objects reached more than once, cycles included, become the same
  agent-side object, so the result mirrors the target's graph and may itself be
  cyclic. Conversion throws a `RangeError` naming the path where it stopped once
  objects nest deeper than `options.maxDepth` (default 100) or more than
  `options.maxValues` values (default 100000) have been converted. Functions and
  symbols are left as `JsValue`s.
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
which Electron does for non-sandboxed renderers, and which the bridge detects by
waiting for a context that has one. From there `realm.global` is the page's
global, so `location`, `document` and `navigator` are all in reach:

```ts
Electron.perform(realm => {
    send(realm.toJs(realm.global.document.title));
});
```

In a sandboxed renderer `Electron.hasNodeEnvironment` is `false` and `perform()`
rejects; reach such renderers over the DevTools Protocol from the main process.

## Teardown

The bridge tears itself down when the script unloads, and `Electron.dispose()`
does so on demand:

```ts
await Electron.dispose();
```

Agent functions the target still holds — callbacks passed into the app, `then`
handlers installed by `realm.await()` — keep existing as target functions, but
from then on they return `undefined` without calling into the agent, and the
target collecting them no longer reaches the agent either. `dispose()` also
releases the threadsafe function and every reference the bridge created,
`JsRef`s from `persist()` included, and rejects pending `realm.await()`s. Work
already queued with `perform()` runs first; `perform()` after `dispose()` starts
over with a fresh environment.

Unloading without `dispose()` is just as safe for the target, but cannot wait
for its JavaScript thread, so the references stay in place until Node tears its
environment down.

Some things stay in the target for its lifetime, holding nothing that leads
back into the agent: the `napi_env` the bridge minted (Node offers no way to
destroy one), the small object behind the wrapped functions until the app drops
the last of them, and any `Debugger` event listeners, which become no-ops.

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
- `session.addEventHandler(handler)` — receive protocol events. An exception
  thrown by `handler` is reported by the agent rather than raised inside the app.
- `session.detach()`.

## How it works

1. The Electron framework is located by its exported `napi_open_handle_scope`.
2. Both overloads of `v8::Function::Call` and `uv_run` are hooked, to land on the
   thread that owns the isolate while a Node context is entered. So that an idle
   app gets there too, the bridge wakes libuv's default loop through its
   internal work-queue handle, which makes Electron run the loop once.
3. From there `napi_module_register_by_symbol()` mints a `napi_env` — as if a
   native addon had been loaded — and the hooks are removed. Where that symbol
   is not exported (Electron 33 and 34, and Windows), the bridge reaches the same
   function through the one `napi_module_register()` hands to
   `node_module_register()`, intercepting that call so that Node never sees it.
4. A threadsafe function is created from that env, so later `perform()` calls
   are queued onto the app's event loop from Frida's thread without hooking
   anything.

Everything above step 4 happens on the first `perform()`, within a few
milliseconds even when the app is idle. If the runtime has not been loaded yet —
e.g. on a gated spawn — the bridge waits for it through a module observer, so
instrumenting from launch works.

## Requirements

- Electron 33 or newer, 64-bit — verified on macOS arm64 with Electron 33, 34,
  35, 40 and 45. The Windows symbol names and calling conventions are derived
  from a Windows Electron 45 build's exports, but have not been run. A build
  that lacks something the bridge needs reports `Electron.available` as `false`,
  and `perform()` rejects with the missing exports named.
- A Node environment in the process being instrumented. The main process always
  has one; a renderer has one unless the app sandboxes it. Without one there is
  no `napi_env` to mint, and `perform()` rejects — reach such renderers over the
  DevTools Protocol from the main process instead.
- `Debugger` is main-process only, since `webContents` lives there.

## Testing

The suite runs inside GumJS via [injest](https://github.com/frida-packages/injest),
against a minimal Electron app in `tests/fixture`, which sits idle once its
window has loaded:

```sh
npm install
npm test
npm run test:esm
npm run typecheck
```

`npm run test:esm` runs it against `tests/fixture-esm`, the same app behind an
ES module entry point. `tests/realm.test.ts` depends on the fixture;
`tests/runtime.test.ts` does not, so it runs against any Electron app.
`injest.config.json` defines a `discord` target for that:

```sh
npx injest runtime --target discord
```
