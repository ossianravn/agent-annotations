import { withoutOrigin, withoutProject } from "../shared/projects.mjs";
import { replaceProjects } from "./projects.js";
import { $, closeIcon, state } from "./shared.js";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

async function removePage(project, origin) {
  await replaceProjects(withoutOrigin(state.projects, project.id, origin));
  renderProjectList();
}

async function removeProject(project) {
  const message = `Remove ${project.name}? Its pages stop routing to it. Annotations already in the repo are kept.`;
  if (!confirm(message)) return;
  await replaceProjects(withoutProject(state.projects, project.id));
  renderProjectList();
}

function projectRow(project) {
  const row = element("div", "project-row");
  const head = element("div", "project-head");
  const remove = element("button", "text-btn", "Remove");
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove project ${project.name}`);
  remove.addEventListener("click", () => removeProject(project));
  head.append(element("strong", "project-title", project.name), remove);

  const pages = element("ul", "project-pages");
  pages.setAttribute("aria-label", `Pages in ${project.name}`);
  for (const origin of project.origins) {
    const item = element("li", "project-page");
    const button = element("button", "icon-btn ghost");
    button.type = "button";
    button.title = "Remove page";
    button.setAttribute("aria-label", `Remove ${origin} from ${project.name}`);
    button.appendChild(closeIcon());
    button.addEventListener("click", () => removePage(project, origin));
    item.append(element("span", "project-origin", origin), button);
    pages.appendChild(item);
  }
  if (!project.origins.length) pages.appendChild(element("li", "help", "No pages"));
  row.append(head, element("p", "help", `Receiver ${project.receiverUrl}`), pages);
  return row;
}

export function renderProjectList() {
  const root = $("projectList");
  root.replaceChildren();
  if (!state.projects.length) {
    root.appendChild(element(
      "p",
      "help",
      "No projects yet. Choosing Add page on one of your app's pages adds its repo here."
    ));
    return;
  }
  root.append(...state.projects.map(projectRow));
}
