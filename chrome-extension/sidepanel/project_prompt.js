import { $ } from "./shared.js";
import { commandBlock, receiverHost, SETUP_COMMAND, UPDATE_COMMAND } from "../shared/receiver_setup.mjs";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function sentence(parts) {
  const text = element("p", "prompt-text");
  for (const part of parts) {
    text.append(typeof part === "string" ? part : element("strong", "", part.strong));
  }
  return text;
}

function tokenField(name) {
  const field = element("div", "field");
  const label = element("label", "field-label", `Token for ${name}`);
  label.htmlFor = "projectToken";
  const input = element("input", "field-input field-token");
  Object.assign(input, { id: "projectToken", type: "password", autocomplete: "off", spellcheck: false });
  field.append(label, input);
  return { field, input };
}

function copyFor(prompt) {
  if (prompt.kind === "add") {
    return [
      "This page isn't in a project. Add it to ",
      { strong: prompt.running.name },
      ", the repo running now?"
    ];
  }
  if (prompt.kind === "mismatch") {
    return [
      "This page belongs to ", { strong: prompt.project.name }, ", but ",
      { strong: prompt.running.name },
      " is running. New annotations wait in the browser until ", { strong: prompt.project.name }, " is running."
    ];
  }
  if (prompt.kind === "token") {
    return [{ strong: prompt.project.name }, " rejected its saved token. Paste the token the receiver printed."];
  }
  const host = receiverHost(prompt.receiverUrl);
  if (prompt.kind === "start") {
    return [
      "No receiver is running at ", { strong: host },
      ". In a terminal, go to your project's folder, run this and leave it running:"
    ];
  }
  // "legacy": a receiver from before projects existed.
  const repo = prompt.repoName;
  return repo
    ? [{ strong: repo }, " is running an older receiver, which can't add pages. Stop it, then run this in ", { strong: repo }, ":"]
    : ["The receiver at ", { strong: host }, " is an older version, which can't add pages. Stop it, then run this in its repo:"];
}

function commandFor(prompt) {
  if (prompt.kind === "start") return SETUP_COMMAND;
  if (prompt.kind === "legacy") return UPDATE_COMMAND;
  return null;
}


// The question the prompt asks; a refresh that asks the same one keeps the prompt.
function promptKey(prompt) {
  if (!prompt) return null;
  const { kind, origin, needsToken, running, project, repoName, receiverUrl } = prompt;
  return JSON.stringify([
    kind, origin, Boolean(needsToken), running?.id, running?.name, running?.receiverUrl,
    project?.id, project?.name, repoName, receiverUrl
  ]);
}

let shown = { key: null, prompt: null };

export function renderProjectPrompt(prompt, handlers) {
  const root = $("projectPrompt");
  const key = promptKey(prompt);
  // The route refreshes on every page load and after Save settings. Rebuilding
  // an unchanged prompt would erase a token being typed and any error shown.
  if (key && key === shown.key && root.childElementCount) {
    shown.prompt = prompt;
    return;
  }
  shown = { key, prompt };
  root.replaceChildren();
  root.hidden = !prompt;
  if (!prompt) return;

  root.appendChild(sentence(copyFor(prompt)));
  const command = commandFor(prompt);
  if (command) root.appendChild(commandBlock(command));
  const tokenName = prompt.kind === "token" ? prompt.project.name : prompt.running?.name;
  const token = prompt.kind === "token" || prompt.needsToken ? tokenField(tokenName) : null;
  if (token) root.appendChild(token.field);
  const error = element("p", "help prompt-error");
  error.setAttribute("role", "alert");

  const actions = element("div", "prompt-actions");
  const run = (button, handler) => async () => {
    const buttons = actions.querySelectorAll("button");
    buttons.forEach((candidate) => { candidate.disabled = true; });
    error.textContent = "";
    // The latest refresh's prompt, which may carry a newer saved token.
    const current = shown.prompt;
    try {
      await handler({ ...current, token: token ? token.input.value.trim() : current.token });
    } catch (failure) {
      error.textContent = failure?.message || String(failure);
      button.focus();
    } finally {
      // A refresh that asks the same question keeps these buttons, so they
      // must work again whether the action failed or succeeded.
      buttons.forEach((candidate) => { candidate.disabled = false; });
    }
  };
  const addButton = (label, className, handler) => {
    const button = element("button", className, label);
    button.type = "button";
    button.addEventListener("click", run(button, handler));
    actions.appendChild(button);
  };

  if (prompt.kind === "add") {
    addButton("Add page", "btn btn-primary", handlers.addPage);
    addButton("Not now", "text-btn", handlers.dismiss);
  } else if (prompt.kind === "mismatch") {
    addButton(`Move page to ${prompt.running.name}`, "btn", handlers.addPage);
  } else if (prompt.kind === "token") {
    addButton("Save token", "btn btn-primary", handlers.saveToken);
  }
  if (actions.childElementCount) root.appendChild(actions);
  root.appendChild(error);
}
