import { beforeEach, describe, expect, test } from "@frida/injest/agent";
import Electron, { Realm } from "../lib/index.js";
import { whenFixtureReady } from "./fixture-ready.js";

describe("callbacks", () => {
    beforeEach(whenFixtureReady);

    test("passes agent functions into the target", () => Electron.perform(realm => {
        const doubled = realm.global.fixture.numbers.map((n: any) => realm.toJs(n) * 2);
        expect(realm.toJs(doubled)).toEqual([2, 4, 6]);
    }));

    test("propagates agent exceptions back into the target", () => Electron.perform(realm => {
        const thrower = () => { throw new Error("from the agent"); };
        expect(() => realm.global.fixture.numbers.map(thrower)).toThrow("from the agent");
    }));
});

describe("promises", () => {
    test("awaits a resolved target promise", async () => {
        const value = await Electron.perform(realm => realm.await(realm.evaluate("Promise.resolve({ ok: 42 })")));
        expect(value).toEqual({ ok: 42 });
    });

    test("awaits a rejected target promise", async () => {
        const settled = Electron.perform(realm => realm.await(realm.evaluate("Promise.reject(new Error('nope'))")));
        await expect(settled).rejects.toThrow("nope");
    });
});

describe("callback lifetime", () => {
    test("releases agent callbacks once the target collects them", async () => {
        const baseline = await Electron.perform(realm => realm.liveCallbacks);

        const live = await Electron.perform(realm => {
            for (let i = 0; i !== 100; i++) {
                realm.fromJs(() => i);
            }
            return realm.liveCallbacks;
        });
        expect(live).toBe(baseline + 100);

        let remaining = live;
        while (remaining > baseline) {
            await new Promise(resolve => { setTimeout(resolve, 50); });
            remaining = await Electron.perform(collectGarbageAndCount);
        }
        expect(remaining).toBeLessThanOrEqual(baseline);
    });
});

function collectGarbageAndCount(realm: Realm): number {
    const v8 = realm.require("v8");
    v8.setFlagsFromString("--expose-gc");
    realm.require("vm").runInNewContext("gc")();
    v8.setFlagsFromString("--no-expose-gc");
    return realm.liveCallbacks;
}
