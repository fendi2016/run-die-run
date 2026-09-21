// Shared DOM lookup helpers for the client's DOM-overlay UI pieces
// (RunResultOverlay, the editor toolbar). Throwing instead of returning
// null/undefined avoids an `as` cast at every call site (AGENTS.md: never
// cast TypeScript types) — callers get a typed element or a clear error.
export function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id} element`);
  }
  return el;
}

export function requireButton(id: string): HTMLButtonElement {
  const el = requireElement(id);
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error(`#${id} is not a button element`);
  }
  return el;
}

export function requireInput(id: string): HTMLInputElement {
  const el = requireElement(id);
  if (!(el instanceof HTMLInputElement)) {
    throw new Error(`#${id} is not an input element`);
  }
  return el;
}

export function requireTextArea(id: string): HTMLTextAreaElement {
  const el = requireElement(id);
  if (!(el instanceof HTMLTextAreaElement)) {
    throw new Error(`#${id} is not a textarea element`);
  }
  return el;
}
