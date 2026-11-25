import { describe, expect, test } from "@frida/injest/agent";
import Electron from "../lib/index.js";
import { classifyProcess } from "../lib/process.js";

describe("node environment probe", () => {
    test("finds one in the main process", () => {
        expect(Electron.hasNodeEnvironment).toBeTruthy();
    });

    test("recognizes processes that never host one", () => {
        expect(classifyProcess(["Electron Helper (Renderer)", "--type=renderer", "--enable-sandbox"]).hasNodeEnvironment).toBeFalsy();
        expect(classifyProcess(["Electron Helper (Renderer)", "--type=renderer"]).hasNodeEnvironment).toBeFalsy();
        expect(classifyProcess(["Electron Helper (GPU)", "--type=gpu-process"]).hasNodeEnvironment).toBeFalsy();
        expect(classifyProcess(["Electron Helper", "--type=utility", "--utility-sub-type=network.mojom.NetworkService"]).hasNodeEnvironment).toBeFalsy();
    });

    test("recognizes processes that host one", () => {
        expect(classifyProcess(["Electron", "app"]).hasNodeEnvironment).toBeTruthy();
        expect(classifyProcess(["Electron Helper (Renderer)", "--type=renderer", "--no-sandbox"]).hasNodeEnvironment).toBeTruthy();
        expect(classifyProcess(["Electron Helper", "--type=utility", "--utility-sub-type=node.mojom.NodeService"]).hasNodeEnvironment).toBeTruthy();
    });
});
