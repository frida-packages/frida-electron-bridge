import { isAvailable, perform, PerformCallback } from "./runtime.js";

export { ValueType } from "./api.js";
export { Debugger } from "./debugger.js";
export type { DebuggerEventHandler, WebContentsTarget } from "./debugger.js";
export { Realm } from "./realm.js";
export { JsRef, JsValue, unwrap } from "./value.js";
export type { JsProxy } from "./value.js";
export type { PerformCallback } from "./runtime.js";

export class Electron {
    static get available(): boolean {
        return isAvailable();
    }

    static get hasNodeEnvironment(): boolean {
        return hasNodeEnvironment();
    }

    static perform<T>(fn: PerformCallback<T>): Promise<T> {
        return perform(fn);
    }

    static evaluate(source: string): Promise<any> {
        return perform(realm => realm.toJs(realm.evaluate(source)));
    }
}

export default Electron;
