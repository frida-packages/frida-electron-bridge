import { describe, expect, test } from "@frida/injest/agent";
import Electron from "../lib/index.js";

describe("conversion", () => {
    test("preserves cycles", () => Electron.perform(realm => {
        const ring = realm.toJs(realm.evaluate("(() => { const ring = { name: 'ring' }; ring.self = ring; return ring; })()"));
        expect(ring.name).toBe("ring");
        expect(ring.self === ring).toBeTruthy();
    }));

    test("preserves shared references", () => Electron.perform(realm => {
        const pair = realm.toJs(realm.evaluate("(() => { const shared = [1, 2]; return { a: shared, b: shared }; })()"));
        expect(pair.a).toEqual([1, 2]);
        expect(pair.a === pair.b).toBeTruthy();
    }));

    test("stops at maxDepth", () => Electron.perform(realm => {
        const chain = realm.evaluate(`(() => {
            const root = {};
            let node = root;
            for (let i = 0; i !== 150; i++) {
                node = node.next = {};
            }
            return root;
        })()`);
        expect(() => realm.toJs(chain)).toThrow(RangeError);
        expect(() => realm.toJs(chain)).toThrow("nested more than 100 levels deep");
        expect(() => realm.toJs(chain, { maxDepth: 3 })).toThrow("toJs() stopped at $.next.next.next.next: ");
        expect(measureChain(realm.toJs(chain, { maxDepth: 150 }))).toBe(150);
    }));

    test("stops at maxValues", () => Electron.perform(realm => {
        const numbers = realm.evaluate("Array.from({ length: 50 }, (_, i) => i)");
        expect(() => realm.toJs(numbers, { maxValues: 10 })).toThrow("more than 10 values; raise maxValues");
        expect(realm.toJs(numbers, { maxValues: 51 })).toHaveLength(50);
    }));

    test("terminates on the process object", () => Electron.perform(realm => {
        expect(["converted", "RangeError"]).toContain(describeConversionOf(() => realm.toJs(realm.global.process)));
    }));
});

function measureChain(node: any): number {
    let depth = 0;
    while (node.next !== undefined) {
        node = node.next;
        depth++;
    }
    return depth;
}

function describeConversionOf(convert: () => any): string {
    try {
        convert();
        return "converted";
    } catch (e) {
        return (e as Error).name;
    }
}
