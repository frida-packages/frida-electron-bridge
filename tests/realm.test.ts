import { beforeEach, describe, expect, test } from "@frida/injest/agent";
import Electron, { unwrap, ValueType } from "../lib/index.js";
import { whenFixtureReady } from "./fixture-ready.js";

describe("realm", () => {
    beforeEach(whenFixtureReady);

    test("exposes the global object", () => Electron.perform(realm => {
        expect(realm.toJs(realm.global.fixture.greeting)).toBe("hello");
    }));

    test("resolves modules through require()", () => Electron.perform(realm => {
        const electron = realm.require("electron");
        expect(realm.toJs(electron.app.getName())).toBe("frida-electron-bridge-fixture");
    }));

    test("converts nested structures", () => Electron.perform(realm => {
        expect(realm.toJs(realm.global.fixture.profile)).toEqual({ name: "frida", tags: ["a", "b"] });
        expect(realm.toJs(realm.global.fixture.numbers)).toEqual([1, 2, 3]);
    }));

    test("calls methods with the right receiver", () => Electron.perform(realm => {
        const { fixture } = realm.global;
        expect(realm.toJs(fixture.add(40, 2))).toBe(42);
        expect(realm.toJs(fixture.bump())).toBe(1);
        expect(realm.toJs(fixture.bump())).toBe(2);
    }));

    test("propagates errors thrown by target functions", () => Electron.perform(realm => {
        expect(() => realm.global.fixture.fail()).toThrow("boom");
    }));

    test("constructs objects", () => Electron.perform(realm => {
        const point = new realm.global.fixture.Point(3, 4);
        expect(realm.toJs(point.magnitude)).toBe(5);
        expect(realm.toJs(point)).toEqual({ x: 3, y: 4 });
    }));

    test("writes properties back into the target", () => Electron.perform(realm => {
        realm.global.fixture.greeting = "goodbye";
        expect(realm.toJs(realm.evaluate("fixture.greeting"))).toBe("goodbye");
        realm.global.fixture.greeting = "hello";
    }));

    test("enumerates own property names", () => Electron.perform(realm => {
        const keys = Object.keys(realm.global.fixture.profile);
        expect(keys).toEqual(["name", "tags"]);
    }));

    test("reports value types", () => Electron.perform(realm => {
        expect(unwrap(realm.global.fixture).type).toBe(ValueType.Object);
        expect(unwrap(realm.global.fixture.add).type).toBe(ValueType.Function);
        expect(unwrap(realm.global.fixture.greeting).type).toBe(ValueType.String);
        expect(unwrap(realm.evaluate("undefined")).type).toBe(ValueType.Undefined);
    }));

    test("passes structured arguments into the target", () => Electron.perform(realm => {
        const stringify = realm.global.JSON.stringify;
        expect(realm.toJs(stringify({ a: [1, "two", true, null] }))).toBe('{"a":[1,"two",true,null]}');
    }));

    test("runs jobs on the JavaScript thread", () => Electron.perform(realm => {
        const jsThreadId = realm.toJs(realm.evaluate("process.pid"));
        expect(jsThreadId).toBe(Process.id);
    }));
});
