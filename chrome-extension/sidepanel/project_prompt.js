import { $ } from "./shared.js";

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
      " is running. Saving is paused so annotations don't land in the wrong repo."
    ];
  }
  if (prompt.kind === "token") {
    return [{ strong: prompt.project.name }, " rejected its saved token. Paste the token the receiver printed."];
  }
  return [
    "The running receiver is too old to confirm it serves ", { strong: prompt.project.name },
    ". Run setup --force in that repo, then Refresh."
  ];
}

export function renderProjectPrompt(prompt, handlers) {
  const root = $("projectPrompt");
  root.replaceChildren();
  root.hidden = !prompt;
  if (!prompt) return;

  root.appendChild(sentence(copyFor(prompt)));
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
    try {
      await handler({ ...prompt, token: token ? token.input.value.trim() : prompt.token });
    } catch (failure) {
      error.textContent = failure?.message || String(failure);
      buttons.forEach((candidate) => { candidate.disabled = false; });
      button.focus();
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
