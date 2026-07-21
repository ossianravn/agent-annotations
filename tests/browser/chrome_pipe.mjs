import { spawn } from "node:child_process";

export class ChromePipe {
  #browser;
  #nextId = 1;
  #pending = new Map();
  #readBuffer = "";
  #stderr = "";

  constructor(browser) {
    this.#browser = browser;
    browser.stdio[4].setEncoding("utf8");
    browser.stdio[4].on("data", (chunk) => this.#onData(chunk));
    browser.stderr.setEncoding("utf8");
    browser.stderr.on("data", (chunk) => {
      this.#stderr = `${this.#stderr}${chunk}`.slice(-8000);
    });
    browser.on("exit", (code) => {
      const error = new Error(`Chrome exited unexpectedly (${code}).\n${this.#stderr}`);
      for (const { reject } of this.#pending.values()) reject(error);
      this.#pending.clear();
    });
  }

  static launch({ executablePath, profilePath }) {
    const browser = spawn(executablePath, [
      "--headless=new",
      "--remote-debugging-pipe",
      "--enable-unsafe-extension-debugging",
      `--user-data-dir=${profilePath}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-features=OptimizationHints",
      "--metrics-recording-only",
      "--window-size=1200,900",
      "about:blank"
    ], {
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"]
    });
    return new ChromePipe(browser);
  }

  #onData(chunk) {
    this.#readBuffer += chunk;
    let boundary = this.#readBuffer.indexOf("\0");
    while (boundary !== -1) {
      const rawMessage = this.#readBuffer.slice(0, boundary);
      this.#readBuffer = this.#readBuffer.slice(boundary + 1);
      if (rawMessage) this.#onMessage(JSON.parse(rawMessage));
      boundary = this.#readBuffer.indexOf("\0");
    }
  }

  #onMessage(message) {
    if (!message.id) return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`${message.error.message} (${message.error.code})`));
    } else {
      pending.resolve(message.result || {});
    }
  }

  command(method, params = {}, sessionId) {
    const id = this.#nextId;
    this.#nextId += 1;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Chrome command timed out: ${method}`));
      }, 15000);
      this.#pending.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
      this.#browser.stdio[3].write(`${JSON.stringify(message)}\0`);
    });
  }

  async attach(targetId) {
    const result = await this.command("Target.attachToTarget", { targetId, flatten: true });
    return result.sessionId;
  }

  async targets() {
    const result = await this.command("Target.getTargets");
    return result.targetInfos;
  }

  async waitForTarget(predicate, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const target = (await this.targets()).find(predicate);
      if (target) return target;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Expected Chrome target did not appear.");
  }

  async close() {
    if (this.#browser.exitCode == null) {
      try {
        await this.command("Browser.close");
      } catch {
        this.#browser.kill("SIGTERM");
      }
    }
    if (this.#browser.exitCode != null) return;
    await new Promise((resolve) => {
      this.#browser.once("exit", resolve);
      setTimeout(() => {
        if (this.#browser.exitCode == null) this.#browser.kill("SIGKILL");
        resolve();
      }, 2000);
    });
  }
}
