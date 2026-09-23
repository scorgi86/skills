const { walk } = require("../parsing/walker.js");
const { evidenceFor } = require("./evidence.js");
const { expressionName, inferExpression, memberInfo, shortName } = require("../helpers.js");

function createRelations(parsed, context, index) {
  const relations = [];

  function participant(node, role) {
    let target=node,kind;
    if(node?.type==="MemberExpression")target=node.property?.type==="Computed"?node.property.expression:node.property,kind="property";
    if(target?.type==="Identifier")kind=kind||"identifier";
    else if(target?.type==="StringLiteral")kind=kind||"string";
    else return null;
    const evidence=evidenceFor(target,context,`participant:${role}`,"exact");if(!evidence.range)return null;
    return {role,value:target.value,kind,file:context.filename,range:evidence.range,sourceHash:context.sourceHash};
  }

  function currentFunction(state) {
    for (let i = state.scopeStack.length - 1; i >= 0; i -= 1) if (state.scopeStack[i] && state.scopeStack[i].owner) return state.scopeStack[i];
    return null;
  }

  function add(node, data, extractor, confidence = "exact", participantNodes = []) {
    relations.push({ ...data, participants: participantNodes.map(({node,role})=>participant(node,role)).filter(Boolean), evidence: [evidenceFor(node, context, extractor, confidence)] });
  }

  function ownerForObject(objectName, state) {
    return ownerResolution(objectName, state).type;
  }

  function ownerResolution(objectName, state) {
    if (objectName === "this") {
      const owner = (currentFunction(state) || {}).owner;
      return { type: owner || "unknown", confidence: owner ? "exact" : "candidate" };
    }
    const resolved = index.resolve(objectName, (currentFunction(state) || {}).qualifiedName || "<module>");
    if (resolved.type !== "unknown") return { ...resolved, confidence: resolved.confidence || "candidate" };
    return { type: /^[A-Z_$]/.test(objectName) ? objectName : "unknown", confidence: "candidate" };
  }

  function sideEffectFree(node) {
    let safe = true;
    walk(node, { enter(item) {
      if (["CallExpression", "AssignmentExpression", "UpdateExpression"].includes(item.type)) safe = false;
      return null;
    } }, context);
    return safe;
  }

  function addAssignment(node, state) {
    const member = memberInfo(node.left);
    if (!member) return;
    if (member.property === "prototype" || member.qualified.includes(".prototype.")) return;
    const receiver = memberInfo(node.left.object);
    const ownerObject = receiver ? receiver.object : member.object;
    const ownerResolved = ownerResolution(ownerObject, state);
    const owner = ownerResolved.type;
    const fn = currentFunction(state);
    const ownerCandidate = ownerResolved.confidence !== "exact";
    const inferred = inferExpression(node.right, index, (fn || {}).qualifiedName || "<module>");
    let relation = "field-write";
    const field = receiver ? `${receiver.property}[${member.property}]` : member.property;
    if (member.computed || (receiver && receiver.computed)) relation = "computed-write";
    const parameterWrite = Boolean(fn && node.right && node.right.type === "Identifier" && fn.params.includes(node.right.value));
    if (parameterWrite) relation = "parameter-to-field";
    if (node.right && node.right.type === "CallExpression") relation = "call-result-to-field";
    const call = node.right?.type === "CallExpression" && memberInfo(node.right.callee);
    const callReceiver = call && (call.object === "this" ? { type: fn?.owner, confidence: fn?.owner ? "exact" : "candidate" } : ownerResolution(call.object, state));
    const callOwner = callReceiver?.type;
    const argumentDomains = node.right?.arguments && node.right.arguments.every(argument => sideEffectFree(argument.expression))
      ? node.right.arguments.flatMap((argument, argumentIndex) => {
        const domain = index.resolveDiscriminatorDomain(argument.expression, fn?.qualifiedName, node.right.span?.start);
        return domain ? [{ index: argumentIndex, ...domain }] : [];
      })
      : [];
    add(node, {
      ownerQualifiedName: owner,
      ownerCandidate,
      ownerConfidence: ownerResolved.confidence,
      ...(ownerResolved.ownerProof ? { ownerProof: ownerResolved.ownerProof } : {}),
      relation,
      field,
      targetQualifiedName: parameterWrite ? "unknown" : inferred.type,
      candidateTypes: parameterWrite ? [] : inferred.candidateTypes || (inferred.candidateType ? [inferred.candidateType] : []),
      dynamic: member.computed || Boolean(receiver && receiver.computed),
      sourceSymbol: fn ? fn.qualifiedName : member.object,
      resolvedVia: inferred.resolvedVia || [],
      ...(call && callOwner && callOwner !== "unknown" && callReceiver.confidence === "exact" && !call.computed ? { callableProof: { owner: callOwner, method: call.property, ...(argumentDomains.length ? { argumentDomains } : {}) } } : {}),
      analysisSourceHash: context.sourceHash,
    }, `relation:${relation}`, ownerCandidate || parameterWrite ? "candidate" : inferred.confidence === "exact" || inferred.confidence === "resolved" ? "exact" : "candidate",[{node:node.left,role:"target-field"},{node:node.right,role:"source-value"}]);
  }

  walk(parsed.ast, {
    enter(node, state, frame) {
      const fn = index.contexts.get(node.span && node.span.start);
      if (fn) return { scope: fn, symbol: fn.qualifiedName };
      if (node.type === "ImportDeclaration") {
        add(node, { ownerQualifiedName: "<module>", relation: "import", targetQualifiedName: node.source && node.source.value, sourceSymbol: context.filename }, "relation:import","exact",[{node:node.source,role:"module-source"}]);
      }
      if (node.type === "ExportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") {
        add(node, { ownerQualifiedName: "<module>", relation: "export", targetQualifiedName: expressionName(node.declaration) || "<export>", sourceSymbol: context.filename }, "relation:export","exact",[{node:node.declaration,role:"exported-value"}]);
      }
      if (node.type === "AssignmentExpression" && node.operator === "=") addAssignment(node, state);
      if (node.type === "MemberExpression") {
        const parent = frame.parent;
        const isAssignmentTarget = parent && parent.type === "AssignmentExpression" && parent.left === node;
        const isCallTarget = parent && parent.type === "CallExpression" && parent.callee === node;
        if (!isAssignmentTarget && !isCallTarget) {
          const member = memberInfo(node);
          if (member && !member.qualified.includes(".prototype")) {
            add(node, { ownerQualifiedName: ownerForObject(member.object, state), relation: "field-read", field: member.property, targetQualifiedName: "unknown", sourceSymbol: (currentFunction(state) || {}).qualifiedName || "<module>", dynamic: member.computed }, "relation:field-read", member.computed ? "candidate" : "exact",[{node,role:"source-field"}]);
          }
        }
      }
      if (node.type === "KeyValueProperty") {
        const parent = state.parentStack[state.parentStack.length - 1];
        const grandparent = state.parentStack[state.parentStack.length - 2];
        if (parent && parent.type === "ObjectExpression" && grandparent && grandparent.type === "VariableDeclarator") {
          const owner = expressionName(grandparent.id);
          const inferred = inferExpression(node.value, index, (currentFunction(state) || {}).qualifiedName || "<module>");
          add(node.value, { ownerQualifiedName: owner, relation: "object-field", field: expressionName(node.key), targetQualifiedName: inferred.type, candidateTypes: inferred.candidateType ? [inferred.candidateType] : [], sourceSymbol: owner }, "relation:object-field", inferred.type === "unknown" ? "candidate" : "exact",[{node:node.key,role:"target-field"},{node:node.value,role:"source-value"}]);
        }
      }
      if (node.type === "ReturnStatement" && node.argument && node.argument.type === "MemberExpression") {
        const member = memberInfo(node.argument);
        const active = currentFunction(state);
        if (member && active && member.object === "this") add(node, { ownerQualifiedName: active.owner, relation: "field-to-return", field: member.property, targetQualifiedName: active.qualifiedName, sourceSymbol: active.qualifiedName }, "relation:field-to-return","exact",[{node:node.argument,role:"source-field"}]);
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
          add(node, { ownerQualifiedName: active ? active.owner : "<module>", relation: "call", method: directCallee, targetQualifiedName: directCallee, sourceSymbol: active ? active.qualifiedName : "<module>", dynamic: false }, "relation:call", "exact",[{node:node.callee,role:"callee"}]);
        }
        return null;
      }
      const calleeReceiver = memberInfo(node.callee.object);
      const baseOwner = calleeReceiver ? ownerForObject(calleeReceiver.object, state) : ownerForObject(callee.object, state);
      const owner = calleeReceiver ? `${baseOwner}.${calleeReceiver.property}` : baseOwner;
      const targetMethod = `${owner}.${callee.property}`;
      add(node, { ownerQualifiedName: owner, relation: "call", method: callee.property, targetQualifiedName: targetMethod, sourceSymbol: (currentFunction(state) || {}).qualifiedName || "<module>", dynamic: callee.computed || Boolean(calleeReceiver) }, "relation:call", callee.computed || calleeReceiver ? "candidate" : "exact",[{node:node.callee,role:"callee"}]);

      for (const argument of args) {
        if (!argument || argument.type !== "MemberExpression") continue;
        const member = memberInfo(argument);
        if (!member) continue;
        add(argument, { ownerQualifiedName: ownerForObject(member.object, state), relation: "field-to-call-argument", field: member.property, targetQualifiedName: targetMethod, sourceSymbol: (currentFunction(state) || {}).qualifiedName || "<module>" }, "relation:field-to-call-argument", member.computed ? "candidate" : "exact",[{node:argument,role:"source-field"}]);
      }

      if (["push", "add", "set"].includes(callee.property)) {
        const receiver = memberInfo(node.callee.object);
        const ownerObject = receiver ? receiver.object : callee.object;
        const ownerResolved = ownerResolution(ownerObject, state);
        const valueNode = callee.property === "set" ? args[1] : args[0];
        const inferred = inferExpression(valueNode, index, (currentFunction(state) || {}).qualifiedName || "<module>");
        add(node, {
          ownerQualifiedName: ownerResolved.type,
          ownerCandidate: ownerResolved.confidence !== "exact",
          ownerConfidence: ownerResolved.confidence,
          relation: callee.property === "push" ? "collection-push" : `collection-${callee.property}`,
          field: receiver ? `${receiver.property}${callee.property === "push" ? "[]" : ""}` : callee.object,
          targetQualifiedName: inferred.type,
          candidateTypes: inferred.candidateType ? [inferred.candidateType] : [],
          sourceSymbol: (currentFunction(state) || {}).qualifiedName || "<module>",
          dynamic: callee.computed || Boolean(receiver && receiver.computed),
        }, `relation:collection-${callee.property}`, ownerResolved.confidence !== "exact" || inferred.type === "unknown" ? "candidate" : "exact",[{node:node.callee.object,role:"receiver-field"},{node:valueNode,role:"source-value"}]);
      }

      const method = index.methods.get(targetMethod) || [...index.methods.values()].find((item) => shortName(item.owner) === shortName(owner) && item.method === callee.property);
      if (method) {
        for (const write of method.writes) {
          const parameterIndex = method.params.indexOf(write.parameter);
          if (parameterIndex < 0 || !args[parameterIndex]) continue;
          const inferred = inferExpression(args[parameterIndex], index, (currentFunction(state) || {}).qualifiedName || "<module>");
          add(node, { ownerQualifiedName: owner, relation: "setter-argument-to-field", field: write.field, targetQualifiedName: inferred.type, candidateTypes: inferred.candidateType ? [inferred.candidateType] : [], sourceSymbol: targetMethod }, "relation:setter-argument-to-field", inferred.type === "unknown" ? "candidate" : "exact",[{node:args[parameterIndex],role:"source-value"}]);
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
      add(node, { ownerQualifiedName: active ? active.owner : "<module>", relation: "construct", method: "new", targetQualifiedName: target, sourceSymbol: active ? active.qualifiedName : "<module>", dynamic: false }, "relation:construct", target === "unknown" ? "candidate" : "exact",[{node:node.callee,role:"callee"}]);
      return null;
    },
  }, context);

  const unique = new Map();
  for (const relation of relations) {
    const key = [relation.ownerQualifiedName, relation.relation, relation.field || relation.method || "", relation.targetQualifiedName, relation.sourceSymbol, Boolean(relation.ownerCandidate), JSON.stringify(relation.callableProof?.argumentDomains || [])].join("|");
    if (unique.has(key)) { unique.get(key).evidence.push(...relation.evidence); unique.get(key).participants.push(...relation.participants); }
    else unique.set(key, relation);
  }
  return [...unique.values()].map(relation=>({...relation,participants:[...new Map(relation.participants.map(row=>[[row.role,row.file,row.range.start.offset,row.range.end.offset,row.value].join("|"),row])).values()]}));
}

module.exports = { createRelations };
