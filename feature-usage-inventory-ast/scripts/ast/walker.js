const SKIP_KEYS = new Set(["span", "ctxt", "typeAnnotation", "typeParameters", "returnType"]);

function isNode(value) {
  return Boolean(value && typeof value === "object" && typeof value.type === "string");
}

function walk(root, visitor, initial = {}) {
  const state = { filename: initial.filename || "", parentStack: [], scopeStack: [], currentSymbol: null, ...initial };

  function visit(value, key = "", index = -1) {
    if (Array.isArray(value)) {
      value.forEach((item, itemIndex) => visit(item, key, itemIndex));
      return;
    }
    if (!value || typeof value !== "object") return;

    const node = isNode(value);
    const parent = state.parentStack[state.parentStack.length - 1] || null;
    let scopePushed = false;
    const previousSymbol = state.currentSymbol;
    if (node) {
      const directive = visitor.enter ? visitor.enter(value, state, { node: value, parent, key, index }) : null;
      if (directive && directive.scope) {
        state.scopeStack.push(directive.scope);
        scopePushed = true;
      }
      if (directive && Object.prototype.hasOwnProperty.call(directive, "symbol")) state.currentSymbol = directive.symbol;
      state.parentStack.push(value);
    }

    for (const [childKey, child] of Object.entries(value)) {
      if (!SKIP_KEYS.has(childKey) && child && typeof child === "object") visit(child, childKey);
    }

    if (node) {
      state.parentStack.pop();
      if (visitor.leave) visitor.leave(value, state, { node: value, parent, key, index });
      if (scopePushed) state.scopeStack.pop();
      state.currentSymbol = previousSymbol;
    }
  }

  visit(root);
  return state;
}

module.exports = { isNode, walk };
