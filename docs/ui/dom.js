/* The two DOM primitives, and nothing else.
 *
 * They lived in widgets.js, which imports the audio engine at module load --
 * so anything wanting `el` dragged the whole engine in with it. The control
 * layer above this file must stay engine-free to be testable without a
 * browser, and that is the only reason these moved. widgets.js re-exports
 * them, so every existing importer is untouched.
 */

/* el("div", {class: "x", onclick: fn}, [children...]) */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

/* Append children, skipping null/undefined. Node.append() would otherwise
 * render a null child as the text "null" -- seen live under the stopper
 * protocol note. Every view uses this for conditional children. */
export function append(parent, ...children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child);
  }
  return parent;
}
