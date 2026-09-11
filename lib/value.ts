import { ValueType } from "./api.js";
import type { Realm } from "./realm.js";

export const unwrapSymbol = Symbol.for("frida-electron-bridge.value");

export type JsProxy = any;

export class JsValue {
    readonly realm: Realm;
    readonly handle: NativePointer;

    constructor(realm: Realm, handle: NativePointer) {
        this.realm = realm;
        this.handle = handle;
    }

    get type(): ValueType {
        return this.realm.typeOf(this);
    }

    get isArray(): boolean {
        return this.realm.isArray(this);
    }

    get isNullish(): boolean {
        const { type } = this;
        return type === ValueType.Undefined || type === ValueType.Null;
    }

    get length(): number {
        return this.realm.arrayLength(this);
    }

    toJs(): any {
        switch (this.type) {
            case ValueType.Undefined:
                return undefined;
            case ValueType.Null:
                return null;
            case ValueType.Boolean:
                return this.toBoolean();
            case ValueType.Number:
                return this.toNumber();
            case ValueType.String:
                return this.toString();
            case ValueType.Bigint:
                return this.toBigInt();
            case ValueType.Object:
                return this.isArray ? this.#toJsArray() : this.#toJsObject();
            default:
                return this;
        }
    }

    toString(): string {
        return this.realm.readString(this);
    }

    toNumber(): number {
        return this.realm.readNumber(this);
    }

    toBoolean(): boolean {
        return this.realm.readBoolean(this);
    }

    toBigInt(): bigint {
        return this.realm.readBigInt(this);
    }

    get(key: string | number): JsValue {
        return (typeof key === "number") ? this.realm.getElement(this, key) : this.realm.getProperty(this, key);
    }

    set(key: string | number, value: any): void {
        if (typeof key === "number") {
            this.realm.setElement(this, key, value);
        } else {
            this.realm.setProperty(this, key, value);
        }
    }

    has(key: string): boolean {
        return this.realm.hasProperty(this, key);
    }

    delete(key: string): boolean {
        return this.realm.deleteProperty(this, key);
    }

    keys(): string[] {
        return this.realm.propertyNames(this);
    }

    call(receiver: JsValue | null, args: any[]): JsValue {
        return this.realm.callFunction(this, receiver, args);
    }

    construct(args: any[]): JsValue {
        return this.realm.construct(this, args);
    }

    instanceOf(constructor: JsValue): boolean {
        return this.realm.instanceOf(this, constructor);
    }

    equals(other: JsValue): boolean {
        return this.realm.strictEquals(this, other);
    }

    wrap(): JsProxy {
        return makeProxy(this, null);
    }

    persist(): JsRef {
        return this.realm.persist(this);
    }

    #toJsArray(): any[] {
        const result: any[] = [];
        const n = this.length;
        for (let i = 0; i !== n; i++) {
            result.push(this.get(i).toJs());
        }
        return result;
    }

    #toJsObject(): Record<string, any> {
        const result: Record<string, any> = {};
        for (const key of this.keys()) {
            result[key] = this.get(key).toJs();
        }
        return result;
    }
}

export class JsRef {
    readonly realm: Realm;
    readonly handle: NativePointer;

    constructor(realm: Realm, handle: NativePointer) {
        this.realm = realm;
        this.handle = handle;
    }

    get(): JsValue {
        return this.realm.resolveRef(this);
    }

    wrap(): JsProxy {
        return this.get().wrap();
    }

    free(): void {
        this.realm.freeRef(this);
    }
}

export function makeProxy(value: JsValue, receiver: JsValue | null): JsProxy {
    return new Proxy(proxyTarget, {
        has(_target, key): boolean {
            return typeof key === "string" && value.has(key);
        },
        get(_target, key): any {
            if (key === unwrapSymbol) {
                return value;
            }
            if (typeof key === "symbol") {
                return undefined;
            }
            return makeProxy(value.get(propertyKey(key)), value);
        },
        set(_target, key, newValue): boolean {
            value.set(propertyKey(key as string), newValue);
            return true;
        },
        deleteProperty(_target, key): boolean {
            return value.delete(key as string);
        },
        ownKeys(target): (string | symbol)[] {
            const keys = value.keys();
            return keys.concat(Reflect.ownKeys(target).filter(key => !keys.includes(key as string)) as string[]);
        },
        getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
            if (typeof key !== "string" || !value.has(key)) {
                return Reflect.getOwnPropertyDescriptor(target, key);
            }
            return { value: makeProxy(value.get(key), value), writable: true, enumerable: true, configurable: true };
        },
        apply(_target, _thisArg, args): any {
            return makeProxy(value.call(receiver, args), null);
        },
        construct(_target, args): any {
            return makeProxy(value.construct(args), null);
        },
    });
}

export function unwrap(value: any): JsValue {
    if (value instanceof JsValue) {
        return value;
    }
    return value[unwrapSymbol];
}

function propertyKey(key: string): string | number {
    const index = parseInt(key, 10);
    return (index.toString() === key) ? index : key;
}

const proxyTarget = function () {};
