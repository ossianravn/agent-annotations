// Listens to the receiver's /events stream and calls onChange when cards
// change. fetch (not EventSource) so the token can go in a header. Reconnects
// with backoff, so a receiver restart or a sleeping laptop heals by itself.

const MAX_DELAY_MS = 30000;

export function connectEvents(target, onChange) {
  let closed = false;
  let controller = null;
  let delay = 1000;
  let pending = 0;

  // Several writes in a row (a claim, then a note) become one refresh.
  const notify = () => {
    clearTimeout(pending);
    pending = setTimeout(onChange, 150);
  };

  async function listen() {
    controller = new AbortController();
    const response = await fetch(`${target.receiverUrl}/events`, {
      headers: { "X-Annotation-Token": target.token },
      signal: controller.signal
    });
    if (!response.ok || !response.body) throw new Error(`Events unavailable (${response.status}).`);
    delay = 1000;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const messages = buffer.split("\n\n");
      buffer = messages.pop();
      if (messages.some((message) => message.split("\n").includes("event: cards"))) notify();
    }
  }

  (async () => {
    while (!closed) {
      try {
        await listen();
      } catch {
        // Offline, restarting or rejected: wait and try again.
      }
      if (closed) return;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    }
  })();

  return {
    close() {
      closed = true;
      clearTimeout(pending);
      controller?.abort();
    }
  };
}
