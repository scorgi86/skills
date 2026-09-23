const { walk } = require("../parsing/walker.js");
const { evidenceFor } = require("./evidence.js");
const { expressionName, identifierName, inferExpression, memberInfo, parameterNames, shortName } = require("../helpers.js");

function createSymbolIndex(parsed, context) {
  const symbols = [];
  const variables = new Map();
  const aliases = new Map();
  const variablesByScope = new Map();
  const candidateVariablesByScope = new Map();
  const candidateProofsByScope = new Map();
  const aliasesByScope = new Map();
  const variableCandidates = new Map();
  const contexts = new Map();
  const methods = new Map();
  const methodsBySpan = new Map();
  const typeAliases = [];
  const lexicalTypeBindings = new Map();
  const domainTimelines = new Map();

  const index = {
    symbols, variables, aliases, variablesByScope, aliasesByScope, contexts, methods, methodsBySpan, typeAliases,
    resolve(name, scope, seen = new Set()) {
      const key = String(name || "");
      const seenKey = `${scope || "<any>"}|${key}`;
      if (!key || seen.has(seenKey)) return { type: "unknown", resolvedVia: [] };
      seen.add(seenKey);
      const scopedVariables = variablesByScope.get(scope);
      const scopedCandidates = candidateVariablesByScope.get(scope);
      const scopedAliases = aliasesByScope.get(scope);
      if (scopedVariables && scopedVariables.has(key)) return { type: scopedVariables.get(key), confidence: "exact", resolvedVia: [`${scope}:${key}`] };
      if (scopedCandidates && scopedCandidates.has(key)) return { type: scopedCandidates.get(key), confidence: "candidate", ownerProof: candidateProofsByScope.get(scope)?.get(key), resolvedVia: [`${scope}:${key}`] };
      if (scopedAliases && scopedAliases.has(key)) {
        const next = scopedAliases.get(key);
        const resolved = index.resolve(next, scope, seen);
        return { type: resolved.type, confidence: resolved.confidence, ownerProof: resolved.ownerProof, resolvedVia: [`${scope}:${key}`, ...resolved.resolvedVia] };
      }
      const candidates = variableCandidates.get(key);
      if (candidates && candidates.size === 1) return { type: [...candidates][0], resolvedVia: [key] };
      if (aliases.has(key)) {
        const next = aliases.get(key);
        const resolved = index.resolve(next, scope, seen);
        return { type: resolved.type, confidence: resolved.confidence, ownerProof: resolved.ownerProof, resolvedVia: [key, ...resolved.resolvedVia] };
      }
      return { type: "unknown", resolvedVia: [] };
    },
    resolveDiscriminatorDomain(node, scope, beforeOffset) {
      const timeline = domainTimelines.get(scope);
      if (!timeline || !timeline.directCalls.has(beforeOffset)) return null;
      return discriminatorDomain(node, timeline, beforeOffset);
    },
  };

  function activeScope(state) {
    const current = [...state.scopeStack].reverse().find((scope) => scope && scope.qualifiedName);
    return current ? current.qualifiedName : "<module>";
  }

  function activeLexicalScope(state) {
    return [...state.scopeStack].reverse().find((scope) => scope && scope.lexicalScope)?.lexicalScope || "<module>";
  }

  function setScoped(map, scope, name, value) {
    if (!map.has(scope)) map.set(scope, new Map());
    map.get(scope).set(name, value);
  }

  function addTypeBinding(scope, name) {
    if (!name) return;
    if (!lexicalTypeBindings.has(scope)) lexicalTypeBindings.set(scope, new Set());
    lexicalTypeBindings.get(scope).add(name);
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
    if (method && method !== "constructor") {
      const descriptor = { owner, method, params, writes: [], returns: [], functionNode: node };
      methods.set(`${owner}.${method}`, descriptor);
      methodsBySpan.set(node.span && node.span.start, descriptor);
    }
    return functionContext;
  }

  function sourceProof(first, last, type) {
    const start = first?.span?.start, end = last?.span?.end;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    const range = context.sourceMap.range({ start, end });
    if (!range) return null;
    return { type, proof: {
      file: context.filename,
      range: { start: range.start, end: range.end },
      snippet: range.text,
      confidence: "exact",
      sourceHash: context.sourceHash
    } };
  }

  function exactNew(node) {
    return node?.type === "NewExpression" ? expressionName(node.callee) || "" : "";
  }

  function staticMemberPath(node) {
    if (!node || node.type !== "MemberExpression") return "";
    const info = memberInfo(node);
    if (!info || info.computed || !identifierName(node.property)) return "";
    if (node.object?.type === "MemberExpression" && !staticMemberPath(node.object)) return "";
    return info.qualified.replace(/^window\./, "");
  }

  function recordTypeAlias(node, scope) {
    const aliasQualifiedName = staticMemberPath(node.left);
    const targetQualifiedName = node.right?.type === "Identifier" ? identifierName(node.right) : "";
    if (!aliasQualifiedName || !targetQualifiedName || !lexicalTypeBindings.get(scope)?.has(targetQualifiedName)) return;
    const proof = sourceProof(node, node, "type-alias")?.proof;
    if (proof) typeAliases.push({ aliasQualifiedName, targetQualifiedName, proof });
  }

  // Deliberately local and conservative: it recognises only linear statements.
  function collectPossibleReturns(method) {
    const found = [];
    const add = (type, first, last, selector) => {
      const member = type && sourceProof(first, last, type);
      if (member) found.push(selector ? { ...member, selector } : member);
    };

    function staticMember(node) {
      if (node?.type !== "MemberExpression" || node.object?.type !== "Identifier") return null;
      if (node.property?.type === "Computed") {
        if (node.property.expression?.type !== "StringLiteral") return null;
        return { object: node.object.value, property: String(node.property.expression.value) };
      }
      const property = identifierName(node.property);
      return property ? { object: node.object.value, property } : null;
    }

    function selectorContext(statement) {
      const member = staticMember(statement.discriminant);
      const parameterIndex = member ? method.params.indexOf(member.object) : -1;
      return parameterIndex < 0 ? null : { parameterIndex, discriminatorKey: member.property };
    }

    function selectorReturn(item, context) {
      if (!context || item.test?.type !== "StringLiteral") return null;
      const statements = item.consequent || [];
      const last = statements.at(-1);
      if (!last || last.type !== "ReturnStatement") return null;
      const values = new Map();
      for (const statement of statements.slice(0, -1)) {
        if (statement.type === "VariableDeclaration") {
          for (const declaration of statement.declarations || []) {
            const name = identifierName(declaration.id), type = exactNew(declaration.init);
            if (name) values.set(name, type || "");
          }
        } else if (statement.type === "ExpressionStatement") {
          const assignment = statement.expression;
          if (assignment?.type === "AssignmentExpression" && assignment.operator === "=") {
            const name = identifierName(assignment.left), type = exactNew(assignment.right);
            if (name) values.set(name, type || "");
          }
        } else return null;
      }
      const type = exactNew(last.argument) || (last.argument?.type === "Identifier" && values.get(last.argument.value));
      return type ? { type, selector: { ...context, caseValue: String(item.test.value) } } : null;
    }

    const scan = (statements, topLevel = false) => {
      const values = new Map();
      for (const statement of statements || []) {
        if (["ReturnStatement", "ThrowStatement", "BreakStatement", "ContinueStatement"].includes(statement.type)) {
          if (statement.type === "ReturnStatement") {
            const direct = exactNew(statement.argument);
            if (direct) add(direct, statement, statement);
            else if (statement.argument?.type === "Identifier") {
              const value = values.get(statement.argument.value);
              if (value) add(value.type, value.node, statement);
            }
          }
          break;
        }
        if (statement.type === "VariableDeclaration") for (const declaration of statement.declarations || []) {
          const name = identifierName(declaration.id), type = exactNew(declaration.init);
          if (name) values.set(name, type ? { type, node: declaration } : null);
        }
        if (statement.type === "ExpressionStatement" && statement.expression?.type === "AssignmentExpression" && statement.expression.operator === "=") {
          const name = identifierName(statement.expression.left), type = exactNew(statement.expression.right);
          if (name) values.set(name, type ? { type, node: statement } : null);
        }
        if (statement.type === "SwitchStatement") {
          const context = topLevel ? selectorContext(statement) : null;
          for (const item of statement.cases || []) {
            const selected = selectorReturn(item, context);
            if (selected) add(selected.type, item, item, selected.selector);
            else scan(item.consequent || []);
          }
        }
        // Any nested control-flow can alter a local value on only part of the path.
        // This compact extractor intentionally refuses to carry it past the boundary.
        if (["IfStatement", "ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement", "TryStatement"].includes(statement.type)) values.clear();
      }
    };
    scan(method.functionNode.body?.stmts || method.functionNode.body?.body || [], true);
    const unique = new Map();
    for (const item of found) {
      const selector = item.selector;
      const key = selector ? [selector.parameterIndex, selector.discriminatorKey, selector.caseValue, item.type].join("|") : item.type;
      if (!unique.has(key)) unique.set(key, item);
    }
    return [...unique.values()].sort((a, b) => `${a.type}|${a.selector?.caseValue || ""}`.localeCompare(`${b.type}|${b.selector?.caseValue || ""}`));
  }

  function staticPropertyName(property) {
    if (!property) return "";
    if (property.type === "Computed") return property.expression?.type === "StringLiteral" ? String(property.expression.value) : "";
    if (property.type === "Identifier" || property.type === "StringLiteral") return String(property.value);
    return "";
  }

  function rootIdentifier(node) {
    if (node?.type === "Identifier") return identifierName(node);
    if (node?.type === "MemberExpression") return rootIdentifier(node.object);
    return "";
  }

  function memberPath(node) {
    if (node?.type === "Identifier") return { root: identifierName(node), path: [] };
    if (node?.type !== "MemberExpression") return null;
    const parent = memberPath(node.object);
    const property = staticPropertyName(node.property);
    return parent && property ? { root: parent.root, path: [...parent.path, property] } : null;
  }

  function objectProperties(node) {
    if (node?.type !== "ObjectExpression") return null;
    const properties = new Map();
    for (const property of node.properties || []) {
      if (property.type !== "KeyValueProperty") return null;
      const name = property.key?.type === "Computed" ? "" : staticPropertyName(property.key);
      if (!name || properties.has(name)) return null;
      properties.set(name, property.value);
    }
    return properties;
  }

  function objectAtPath(node, path) {
    let current = node;
    for (const part of path) {
      const properties = objectProperties(current);
      if (!properties?.has(part)) return null;
      current = properties.get(part);
    }
    return current;
  }

  function latestBinding(timeline, name, beforeOffset) {
    const candidates = (timeline.bindings.get(name) || []).filter(item => item.end < beforeOffset);
    const binding = candidates.at(-1);
    if (!binding) return null;
    return (timeline.invalidations.get(name) || []).some(offset => offset > binding.end && offset < beforeOffset) ? null : binding;
  }

  function discriminatorDomain(node, timeline, beforeOffset) {
    const resolve = (expression, seen = new Set()) => {
      if (!expression) return null;
      if (expression.type === "ConditionalExpression") {
        const left = resolve(expression.consequent, seen), right = resolve(expression.alternate, seen);
        if (!left || !right || left.discriminatorKey !== right.discriminatorKey) return null;
        return { discriminatorKey: left.discriminatorKey, values: [...new Set([...left.values, ...right.values])].sort() };
      }
      if (expression.type === "Identifier") {
        const name = identifierName(expression);
        if (!name || seen.has(name)) return null;
        const binding = latestBinding(timeline, name, beforeOffset);
        if (!binding || ["Identifier", "MemberExpression"].includes(binding.expression?.type)) return null;
        return resolve(binding.expression, new Set([...seen, name]));
      }
      if (expression.type === "MemberExpression") {
        const member = memberPath(expression);
        if (!member?.root || seen.has(member.root)) return null;
        const binding = latestBinding(timeline, member.root, beforeOffset);
        const nested = binding && objectAtPath(binding.expression, member.path);
        return nested ? resolve(nested, new Set([...seen, member.root])) : null;
      }
      const properties = objectProperties(expression);
      const value = properties?.get("type");
      return value?.type === "StringLiteral" ? { discriminatorKey: "type", values: [String(value.value)] } : null;
    };
    return resolve(node);
  }

  function visitNodes(node, visit, seen = new Set()) {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (typeof node.type === "string") visit(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(item => visitNodes(item, visit, seen));
      else if (value && typeof value === "object") visitNodes(value, visit, seen);
    }
  }

  function collectDomainTimeline(method) {
    const timeline = { bindings: new Map(), invalidations: new Map(), directCalls: new Set() };
    const bind = (name, expression, end) => {
      if (!name || !expression || !Number.isFinite(end)) return;
      if (!timeline.bindings.has(name)) timeline.bindings.set(name, []);
      timeline.bindings.get(name).push({ expression, end });
    };
    const invalidate = (name, offset) => {
      if (!name || !Number.isFinite(offset)) return;
      if (!timeline.invalidations.has(name)) timeline.invalidations.set(name, []);
      timeline.invalidations.get(name).push(offset);
    };
    const scan = (node, directAssignment = null) => visitNodes(node, item => {
      if (item.type === "AssignmentExpression") {
        const root = rootIdentifier(item.left);
        if (item !== directAssignment) invalidate(root, item.span?.start);
      } else if (item.type === "UpdateExpression") {
        invalidate(rootIdentifier(item.argument), item.span?.start);
      } else if (item.type === "CallExpression") {
        invalidate(rootIdentifier(item.callee), item.span?.start);
        for (const argument of item.arguments || []) invalidate(rootIdentifier(argument.expression), item.span?.start);
      }
    });
    for (const statement of method.functionNode.body?.stmts || method.functionNode.body?.body || []) {
      if (statement.type === "VariableDeclaration") {
        for (const declaration of statement.declarations || []) bind(identifierName(declaration.id), declaration.init, statement.span?.end);
      }
      const assignment = statement.type === "ExpressionStatement" ? statement.expression : null;
      if (assignment?.type === "AssignmentExpression" && assignment.operator === "=" && assignment.left?.type === "Identifier") bind(identifierName(assignment.left), assignment.right, statement.span?.end);
      if (assignment?.type === "AssignmentExpression" && assignment.right?.type === "CallExpression") timeline.directCalls.add(assignment.right.span?.start);
      scan(statement, assignment?.type === "AssignmentExpression" && assignment.left?.type === "Identifier" ? assignment : null);
    }
    return timeline;
  }

  function recordVariable(node, name, scope, addDeclaration) {
    const inferred = inferExpression(node.init, index, scope);
    if (inferred.type !== "unknown") {
      setScoped(variablesByScope, scope, name, inferred.type);
      candidateVariablesByScope.get(scope)?.delete(name);
      if (!variableCandidates.has(name)) variableCandidates.set(name, new Set());
      variableCandidates.get(name).add(inferred.type);
      if (!variables.has(name)) variables.set(name, inferred.type);
    } else if (node.init?.type === "ConditionalExpression") {
      const candidates = [...new Set((inferred.candidateTypes || []).filter(type => type !== "unknown" && type !== "null"))];
      if (candidates.length === 1) {
        setScoped(candidateVariablesByScope, scope, name, candidates[0]);
        if (inferred.ownerProof) setScoped(candidateProofsByScope, scope, name, inferred.ownerProof);
      }
    }
    if (addDeclaration) addSymbol(node, name, "variable", { inferredType: inferred.type, candidateType: inferred.candidateType || "", scope });
  }

  walk(parsed.ast, {
    enter(node, state) {
      const knownContext = contexts.get(node.span && node.span.start);
      if (knownContext && (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression")) return { scope: knownContext, symbol: knownContext.qualifiedName };
      if (node.type === "BlockStatement") return { scope: { lexicalScope: `block:${node.span?.start}` } };
      if (node.type === "FunctionDeclaration") {
        const name = identifierName(node.identifier);
        addTypeBinding(activeLexicalScope(state), name);
        const functionContext = registerFunction(node, name, "constructor", "function");
        return { scope: functionContext, symbol: functionContext.qualifiedName };
      } else if (node.type === "ClassDeclaration") {
        const name = identifierName(node.identifier);
        addTypeBinding(activeLexicalScope(state), name);
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
        } else recordVariable(node, name, scope, true);
      } else if (node.type === "ImportDeclaration") {
        for (const specifier of node.specifiers || []) {
          const name = identifierName(specifier.local);
          addTypeBinding(activeLexicalScope(state), name);
          addSymbol(specifier, name, "import", { source: node.source && node.source.value });
        }
      } else if (node.type === "ExportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") {
        addSymbol(node, expressionName(node.declaration) || "<export>", "export");
      } else if (node.type === "AssignmentExpression" && node.operator === "=") {
        const left = memberInfo(node.left);
        if (!left) return null;
        recordTypeAlias(node, activeLexicalScope(state));
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
      } else if (node.type === "ReturnStatement") {
        const scope = activeScope(state), method = methods.get(scope);
        const nearestFunction = [...state.parentStack].reverse().find(parent => ["FunctionExpression", "ArrowFunctionExpression", "FunctionDeclaration", "ClassMethod", "PrivateMethod"].includes(parent.type));
        if (method && nearestFunction && nearestFunction.span?.start === method.functionNode.span?.start) {
          const inferred = inferExpression(node.argument, index, scope);
          method.returns.push({ type: inferred.type, confidence: inferred.confidence, bare: !node.argument,
            finalTopLevel: method.functionNode.body?.stmts?.at(-1) === node });
        }
      }
      return null;
    },
    leave(node) {
      const method = methodsBySpan.get(node.span && node.span.start);
      if (!method) return;
      method.possibleReturnTypes = collectPossibleReturns(method);
      const final = method.returns.find(item => item.finalTopLevel);
      if (!final || method.returns.some(item => item.bare || item.confidence !== "exact" || item.type !== final.type)) return;
      method.returnType = final.type;
      method.returnConfidence = "exact";
    },
  }, context);

  walk(parsed.ast, {
    enter(node, state) {
      const knownContext = contexts.get(node.span && node.span.start);
      if (knownContext && ["FunctionExpression", "ArrowFunctionExpression", "FunctionDeclaration", "ClassMethod", "PrivateMethod"].includes(node.type)) return { scope: knownContext, symbol: knownContext.qualifiedName };
      if (node.type !== "VariableDeclarator") return null;
      const name = identifierName(node.id);
      if (!name || !node.init || ["ArrowFunctionExpression", "FunctionExpression", "Identifier", "MemberExpression"].includes(node.init.type)) return null;
      recordVariable(node, name, activeScope(state), false);
      return null;
    },
  }, context);

  for (const method of methodsBySpan.values()) domainTimelines.set(method.owner + "." + method.method, collectDomainTimeline(method));

  return index;
}

module.exports = { createSymbolIndex };
