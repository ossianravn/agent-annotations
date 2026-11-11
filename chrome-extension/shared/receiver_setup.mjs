// What to run in a repo when no receiver answers, or an old one does.
// The side panel and the board show the same commands.
export const SETUP_COMMAND = "pnpm dlx agent-annotations@latest setup";
export const UPDATE_COMMAND = "pnpm dlx agent-annotations@latest setup --force";

// Receivers before 0.4.4 report only their folder, not a project.
export function repoNameOf(health) {
  const root = String(health?.repoRoot || "").replace(/[\\/]+$/, "");
  return root.split(/[\\/]/).pop() || null;
}

// A project's identity is what makes Add page possible.
export function isOutdated(health) {
  return Boolean(health) && !health.projectId;
}

// The command as text plus a Copy button; styled by .prompt-command.
export function commandBlock(command) {
  const block = document.createElement("div");
  block.className = "prompt-command";
  const code = document.createElement("code");
  // Lines break between words only, never inside "agent-annotations".
  command.split(" ").forEach((word, index) => {
    if (index) code.append(" ");
    code.append(Object.assign(document.createElement("span"), { textContent: word }));
  });
  const copy = document.createElement("button");
  Object.assign(copy, { type: "button", className: "btn", textContent: "Copy", title: "Copy command" });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(command);
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy"; }, 1500);
    } catch {
      // Leave it selected so Ctrl+C works.
      getSelection().selectAllChildren(code);
    }
  });
  block.append(code, copy);
  return block;
}

export function receiverHost(receiverUrl) {
  try {
    return new URL(receiverUrl).host;
  } catch {
    return String(receiverUrl || "");
  }
}
