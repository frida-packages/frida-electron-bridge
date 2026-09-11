const { app, BrowserWindow } = require("electron");

class Point {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    get magnitude() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }
}

globalThis.fixture = {
    greeting: "hello",
    counter: 0,
    numbers: [1, 2, 3],
    profile: { name: "frida", tags: ["a", "b"] },
    Point,
    add(a, b) {
        return a + b;
    },
    bump() {
        return ++this.counter;
    },
    fail() {
        throw new Error("boom");
    },
};

app.whenReady().then(() => {
    const window = new BrowserWindow({ show: false });
    window.loadURL("data:text/html,<title>fixture window</title><body>hi</body>");
});

setInterval(() => {}, 20);
