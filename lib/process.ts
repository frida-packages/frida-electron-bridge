export interface ProcessRole {
    type: string;
    sandboxed: boolean;
    hasNodeEnvironment: boolean;
}

export function getProcessRole(): ProcessRole {
    if (cachedRole === null) {
        cachedRole = classifyProcess(readCommandLine());
    }
    return cachedRole;
}

let cachedRole: ProcessRole | null = null;

export function classifyProcess(args: string[]): ProcessRole {
    const type = switchValue(args, "type") ?? "browser";
    const sandboxed = args.includes("--enable-sandbox") || !args.includes("--no-sandbox");
    return {
        type,
        sandboxed,
        hasNodeEnvironment: hostsNode(type, sandboxed, args),
    };
}

function switchValue(args: string[], name: string): string | null {
    const prefix = `--${name}=`;
    const arg = args.find(candidate => candidate.startsWith(prefix));
    return (arg !== undefined) ? arg.substring(prefix.length) : null;
}

function hostsNode(type: string, sandboxed: boolean, args: string[]): boolean {
    switch (type) {
        case "browser":
            return true;
        case "renderer":
            return !sandboxed;
        case "utility":
            return switchValue(args, "utility-sub-type") === NODE_SERVICE;
        default:
            return false;
    }
}

const NODE_SERVICE = "node.mojom.NodeService";

function readCommandLine(): string[] {
    switch (Process.platform) {
        case "darwin":
            return readDarwinArguments();
        case "windows":
            return readWindowsCommandLine();
        default:
            return readProcCommandLine();
    }
}

function readDarwinArguments(): string[] {
    const libsystem = Process.getModuleByName("libSystem.B.dylib");
    const getArgc = new NativeFunction(libsystem.getExportByName("_NSGetArgc"), "pointer", []);
    const getArgv = new NativeFunction(libsystem.getExportByName("_NSGetArgv"), "pointer", []);

    const argc = getArgc().readInt();
    const argv = getArgv().readPointer();

    const args: string[] = [];
    for (let i = 0; i !== argc; i++) {
        args.push(argv.add(i * Process.pointerSize).readPointer().readUtf8String()!);
    }
    return args;
}

function readWindowsCommandLine(): string[] {
    const kernel32 = Process.getModuleByName("kernel32.dll");
    const getCommandLine = new NativeFunction(kernel32.getExportByName("GetCommandLineW"), "pointer", []);
    return getCommandLine().readUtf16String()!.split(/\s+/);
}

function readProcCommandLine(): string[] {
    return File.readAllText("/proc/self/cmdline").split("\0");
}
