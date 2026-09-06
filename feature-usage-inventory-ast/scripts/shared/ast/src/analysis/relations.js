const { walk } = require("../parsing/walker.js");
const { evidenceFor } = require("./evidence.js");
const { expressionName, inferExpression, memberInfo, shortName } = require("../helpers.js");

function createRelations(parsed, context, index) {
  const relations = [];

  function currentFunction(state) {
    for (let i = state.scopeStack.length - 1; i >= 0; i -= 1) if (state.scopeStack[i] && state.scopeStack[i].owner) return state.scopeStack[i];
    return null;
  }

  function add(node, data, extractor, confidence = "exact") {
    relations.push({ ...data, evidence: [evidenceFor(node, context, extractor, confidence)] });
  }

  function ownerForObject(objectName, state) {
    if (objectName === "this") return (currentFunction(state) || {}).owner || "unknown";
    const resolved = index.resolve(objectName, (currentFunction(state) || {}).qualifiedName || "<module>").type;
    if (resolved !== "unknown") return resolved;
    return /^[A-Z_$]/.test(objectName) ? objectName : "unknown";
  }

  function addAssignment(node, state) {
    const member = memberInfo(node.left);
    if (!member) return;
    if (member.property === "prototype" || member.qualified.includes(".prototype.")) return;
    const receiver = memberInfo(node.left.object);
    const owner = receiver ? ownerForObject(receiver.object, state) : ownerForObject(member.object, state);
    const fn = currentFunction(state);
    const inferred = inferExpression(node.right, index, (fn || {}).qualifiedName || "<module>");
    let relation = "field-write";
    const field = receiver ? `${receiver.property}[${member.property}]` : member.property;
    if (member.computed || (receiver && receiver.computed)) relation = "computed-write";
    const parameterWrite = Boolean(fn && node.right && node.right.type === "Identifier" && fn.params.includes(node.right.value));
    if (parameterWrite) relation = "parameter-to-field";
    if (node.right && node.right.type === "CallExpression") relation = "call-result-to-field";
    add(node, {
      ownerQualifiedName: owner,
      relation,
      field,
      targetQualifiedName: parameterWrite ? "unknown" : inferred.type,
      candidateTypes: parameterWrite ? [] : inferred.candidateTypes || (inferred.candidateType ? [inferred.candidateType] : []),
      dynamic: member.computed || Boolean(receiver && receiver.computed),
      sourceSymbol: fn ? fn.qualifiedName : member.object,
      resolvedVia: inferred.resolvedVia || [],
    }, `relation:${relation}`, parameterWrite ? "candidate" : inferred.confidence === "exact" || inferred.confidence === "resolved" ? "exact" : "candidate");
  }

  walk(parsed.ast, {
    enter(node, state, frame) {
      const fn = index.contexts.get(node.span && node.span.start);
      if (fn) return { scope: fn, symbol: fn.qualifiedName };
      if (node.type === "ImportDeclaration") {
        add(node, { ownerQualifiedName: "<module>", relation: "import", targetQualifiedName: node.source && node.source.value, sourceSymbol: context.filename }, "relation:import");
      }
      if (node.type === "ExportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") {
        add(node, { ownerQualifiedName: "<module>", relation: "export", targetQualifiedName: expressionName(node.declaration) || "<export>", sourceSymbol: context.filename }, "relation:export");
      }
      if (node.type === "AssignmentExpression" && node.operator === "=") addAssignment(node, state);
      if (node.type === "MemberExpression") {
        const parent = frame.parent;
        const isAssignmentTarget = parent && parent.type === "AssignmentExpression" && parent.left === node;
        const isCallTarget = parent && parent.type === "CallExpression" && parent.callee === node;
        if (!isAssignmentTarget && !isCallTarget) {
          const member = memberInfo(node);
          if (member && !member.qualified.includes(".prototype")) {
            add(node, { ownerQualifiedName: ownerForObject(member.object, state), relation: "field-read", field: member.property, targetQualifiedName: "unknown", sourceSymbol: (currentFunction(state) || {}).qualifiedName || "<module>", dynamic: member.computed }, "relation:field-read", member.computed ? "candidate" : "exact");
          }
        }
      }
      if (node.type === "KeyValueProperty") {
        const parent = state.parentStack[state.parentStack.length - 1];
        const grandparent = state.parentStack[state.parentStack.length - 2];
        if (parent && parent.type === "ObjectExpression" && grandparent && grandparent.type === "VariableDeclarator") {
          const owner = expressionName(grandparent.id);
          const inferred = inferExpression(node.value, index, (currentFunction(state) || {}).qualifiedName || "<module>");
          add(node.value, { ownerQualifiedName: owner, relation: "object-field", field: expressionName(node.key), targetQualifiedName: inferred.type, candidateTypes: inferred.candidateType ? [inferred.candidateType] : [], sourceSymbol: owner }, "relation:object-field", inferred.type === "unknown" ? "candidate" : "exact");
        }
      }
      if (node.type === "ReturnStatement" && node.argument && node.argument.type === "MemberExpression") {
        const member = memberInfo(node.argument);
        const active = currentFunction(state);
        if (member && active && member.object === "this") add(node, { ownerQualifiedName: active.owner, relation: "field-to-return", field: member.property, targetQualifiedName: active.qualifiedName, sourceSymbol: active.qualifiedName }, "relation:field-to-return");
      }
      return null;
    },
  }, context);

  for (const relation of relations) {
    if (relation.relation !== "parameter-to-field") continue;
    const method = index.methods.get(relation.sourceSymbol);
    if (method) method.writes.push({ field: relation.field, parameter: relation.evidence[0].snippet.match(/=\s*([A-Za-z_$][\w$]*)/)?.[1] || "" });
  }

  walk(parsed.ast, {
    enter(node, state, frame) {
      const fn = index.contexts.get(node.span && node.span.start);
      if (fn) return { scope: fn, symbol: fn.qualifiedName };
      if (node.type !== "CallExpression") return null;
      const args = (node.arguments || []).map((item) => item.expression);
      const directCallee = expressionName(node.callee);
      const callee = memberInfo(node.callee);
      if (!callee) {
        if (directCallee) {
          const active = currentFunction(state);
          add(node, { ownerQualifiedName: active ? active.owner : "<module>", relation: "call", method: directCallee, targetQualifiedName: directCallee, sourceSymbol: active ? active.qualifiedName : "<module>", dynamic: false }, "relation:call", "exact");
        }
        return null;
      }
      const calleeReceiver = memberInfo(node.callee.object);
      const baseOwner = calleeReceiver ? ownerForObject(calleeReceiver.object, state) : ownerForObject(callee.object, state);
      const owner = calleeReceiver ? `${baseOwner}.${calleeReceiver.property}` : baseOwner;
      const targetMethod = `${owner}.${callee.property}`;
      add(node, { ownerQualifiedName: owner, relation: "call", method: callee.property, targetQualifiedName: targetMethod, sourceSymbol: (currentFunction(state) || {}).qualifiedName || "<module>", dynamic: callee.computed || Boolean(calleeReceiver) }, "relation:call", callee.computed || calleeReceiver ? "candidate" : "exact");

      for (const argument of args) {
        if (!argument || argument.type !== "MemberExpression") continue;
        const member = memberInfo(argument);
        if (!member) continue;
        add(argument, { ownerQualifiedName: ownerForObject(member.object, state), relation: "field-to-call-argument", field: member.property, targetQualifiedName: targetMethod, sourceSymbol: (currentFunction(state) || {}).qualifiedName || "<module>" }, "relation:field-to-call-argument", member.computed ? "candidate" : "exact");
      }

      if (["push", "add", "set"].includes(callee.property)) {
        const receiver = memberInfo(node.callee.object);
        const valueNode = callee.property === "set" ? args[1] : args[0];
        const inferred = inferExpression(valueNode, index, (currentFunction(state) || {}).qualifiedName || "<module>");
        add(node, {
          ownerQualifiedName: receiver ? ownerForObject(receiver.object, state) : owner,
          relation: callee.property === "push" ? "collection-push" : `collection-${callee.property}`,
          field: receiver ? `${receiver.property}${callee.property === "push" ? "[]" : ""}` : callee.object,
          targetQualifiedName: inferred.type,
          candidateTypes: inferred.candidateType ? [inferred.candidateType] : [],
          sourceSymbol: (currentFunction(state) || {}).qualifiedName || "<module>",
        }, `relation:collection-${callee.property}`, inferred.type === "unknown" ? "candidate" : "exact");
      }

      const method = index.methods.get(targetMethod) || [...index.methods.values()].find((item) => shortName(item.owner) === shortName(owner) && item.method === callee.property);
      if (method) {
        for (const write of method.writes) {
          const parameterIndex = method.params.indexOf(write.parameter);
          if (parameterIndex < 0 || !args[parameterIndex]) continue;
          const inferred = inferExpression(args[parameterIndex], index, (currentFunction(state) || {}).qualifiedName || "<module>");
          add(node, { ownerQualifiedName: owner, relation: "setter-argument-to-field", field: write.field, targetQualifiedName: inferred.type, candidateTypes: inferred.candidateType ? [inferred.candidateType] : [], sourceSymbol: targetMethod }, "relation:setter-argument-to-field", inferred.type === "unknown" ? "candidate" : "exact");
        }
      }
      return null;
    },
  }, context);

  walk(parsed.ast, {
    enter(node, state) {
      const fn = index.contexts.get(node.span && node.span.start);
      if (fn) return { scope: fn, symbol: fn.qualifiedName };
      if (node.type !== "NewExpression") return null;
      const active = currentFunction(state);
      const target = expressionName(node.callee) || "unknown";
      add(node, { ownerQualifiedName: active ? active.owner : "<module>", relation: "construct", method: "new", targetQualifiedName: target, sourceSymbol: active ? active.qualifiedName : "<module>", dynamic: false }, "relation:construct", target === "unknown" ? "candidate" : "exact");
      return null;
    },
  }, context);

  const unique = new Map();
  for (const relation of relations) {
    const key = [relation.ownerQualifiedName, relation.relation, relation.field || relation.method || "", relation.targetQualifiedName, relation.sourceSymbol].join("|");
    if (unique.has(key)) unique.get(key).evidence.push(...relation.evidence);
    else unique.set(key, relation);
  }
  return [...unique.values()];
}

module.exports = { createRelations };
