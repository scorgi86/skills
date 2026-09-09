const { walk } = require("../parsing/walker.js");
const { evidenceFor } = require("./evidence.js");
const { expressionName, identifierName, inferExpression, memberInfo, parameterNames, shortName } = require("../helpers.js");

function createSymbolIndex(parsed, context) {
  const symbols = [];
  const variables = new Map();
  const aliases = new Map();
  const variablesByScope = new Map();
  const aliasesByScope = new Map();
  const variableCandidates = new Map();
  const contexts = new Map();
  const methods = new Map();

  const index = {
    symbols, variables, aliases, variablesByScope, aliasesByScope, contexts, methods,
    resolve(name, scope, seen = new Set()) {
      const key = String(name || "");
      const seenKey = `${scope || "<any>"}|${key}`;
      if (!key || seen.has(seenKey)) return { type: "unknown", resolvedVia: [] };
      seen.add(seenKey);
      const scopedVariables = variablesByScope.get(scope);
      const scopedAliases = aliasesByScope.get(scope);
      if (scopedVariables && scopedVariables.has(key)) return { type: scopedVariables.get(key), resolvedVia: [`${scope}:${key}`] };
      if (scopedAliases && scopedAliases.has(key)) {
        const next = scopedAliases.get(key);
        const resolved = index.resolve(next, scope, seen);
        return { type: resolved.type, resolvedVia: [`${scope}:${key}`, ...resolved.resolvedVia] };
      }
      const candidates = variableCandidates.get(key);
      if (candidates && candidates.size === 1) return { type: [...candidates][0], resolvedVia: [key] };
      if (aliases.has(key)) {
        const next = aliases.get(key);
        const resolved = index.resolve(next, scope, seen);
        return { type: resolved.type, resolvedVia: [key, ...resolved.resolvedVia] };
      }
      return { type: "unknown", resolvedVia: [] };
    },
  };

  function activeScope(state) {
    const current = [...state.scopeStack].reverse().find((scope) => scope && scope.qualifiedName);
    return current ? current.qualifiedName : "<module>";
  }

  function setScoped(map, scope, name, value) {
    if (!map.has(scope)) map.set(scope, new Map());
    map.get(scope).set(name, value);
  }

  function addSymbol(node, qualifiedName, kind, extra = {}) {
    if (!qualifiedName) return;
    symbols.push({ qualifiedName, name: shortName(qualifiedName), kind, ...extra, evidence: [evidenceFor(node, context, `symbol:${kind}`, "exact")] });
  }

  function registerFunction(node, owner, method, kind) {
    const params = parameterNames(node.params);
    const qualifiedName = method && method !== "constructor" ? `${owner}.${method}` : owner;
    const functionContext = { owner, method, qualifiedName, params, kind };
    contexts.set(node.span && node.span.start, functionContext);
    addSymbol(node, qualifiedName, kind, { owner, method, params });
    if (method && method !== "constructor") methods.set(`${owner}.${method}`, { owner, method, params, writes: [] });
    return functionContext;
  }

  walk(parsed.ast, {
    enter(node, state) {
      const knownContext = contexts.get(node.span && node.span.start);
      if (knownContext && (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression")) return { scope: knownContext, symbol: knownContext.qualifiedName };
      if (node.type === "FunctionDeclaration") {
        const name = identifierName(node.identifier);
        const functionContext = registerFunction(node, name, "constructor", "function");
        return { scope: functionContext, symbol: functionContext.qualifiedName };
      } else if (node.type === "ClassDeclaration") {
        const name = identifierName(node.identifier);
        addSymbol(node, name, "class");
        return { scope: { className: name }, symbol: name };
      } else if (node.type === "ClassMethod" || node.type === "PrivateMethod") {
        const method = identifierName(node.key);
        const classScope = [...state.scopeStack].reverse().find((scope) => scope && scope.className);
        const owner = classScope ? classScope.className : "<class>";
        const functionContext = registerFunction(node.function || node, owner, method, "class-method");
        return { scope: functionContext, symbol: functionContext.qualifiedName };
      } else if (node.type === "VariableDeclarator") {
        const name = identifierName(node.id);
        if (!name) return null;
        const scope = activeScope(state);
        if (node.init && (node.init.type === "ArrowFunctionExpression" || node.init.type === "FunctionExpression")) {
          registerFunction(node.init, name, "function", "variable-function");
          return null;
        }
        if (node.init && (node.init.type === "Identifier" || node.init.type === "MemberExpression")) {
          const target = expressionName(node.init);
          setScoped(aliasesByScope, scope, name, target);
          if (!aliases.has(name)) aliases.set(name, target);
          addSymbol(node, name, "alias", { target, scope });
        } else {
          const inferred = inferExpression(node.init, index, scope);
          if (inferred.type !== "unknown") {
            setScoped(variablesByScope, scope, name, inferred.type);
            if (!variableCandidates.has(name)) variableCandidates.set(name, new Set());
            variableCandidates.get(name).add(inferred.type);
            if (!variables.has(name)) variables.set(name, inferred.type);
          }
          addSymbol(node, name, "variable", { inferredType: inferred.type, candidateType: inferred.candidateType || "", scope });
        }
      } else if (node.type === "ImportDeclaration") {
        for (const specifier of node.specifiers || []) addSymbol(specifier, identifierName(specifier.local), "import", { source: node.source && node.source.value });
      } else if (node.type === "ExportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") {
        addSymbol(node, expressionName(node.declaration) || "<export>", "export");
      } else if (node.type === "AssignmentExpression" && node.operator === "=") {
        const left = memberInfo(node.left);
        if (!left) return null;
        if (node.right && node.right.type === "FunctionExpression") {
          const prototypeMethod = left.qualified.match(/^(.+)\.prototype\.([^.]+)$/);
          if (prototypeMethod) registerFunction(node.right, prototypeMethod[1], prototypeMethod[2], "prototype-method");
          else {
            const aliasTarget = aliases.get(left.object);
            if (aliasTarget && aliasTarget.endsWith(".prototype")) registerFunction(node.right, aliasTarget.slice(0, -".prototype".length), left.property, "prototype-alias-method");
            else registerFunction(node.right, left.qualified, "constructor", "assignment-function");
          }
        } else if (left.property === "prototype" && node.right && node.right.type === "ObjectExpression") {
          for (const property of node.right.properties || []) {
            if (property.type !== "KeyValueProperty" || !property.value || property.value.type !== "FunctionExpression") continue;
            registerFunction(property.value, left.object, identifierName(property.key), "prototype-object-method");
          }
        }
      }
      return null;
    },
  }, context);

  return index;
}

module.exports = { createSymbolIndex };
