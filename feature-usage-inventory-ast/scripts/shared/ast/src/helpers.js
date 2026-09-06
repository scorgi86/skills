function identifierName(node) {
  if (!node) return "";
  if (node.type === "Identifier" || node.type === "PrivateName") return node.value || node.id || "";
  if (node.type === "StringLiteral" || node.type === "NumericLiteral") return String(node.value);
  return "";
}

function memberInfo(node) {
  if (!node || node.type !== "MemberExpression") return null;
  const object = expressionName(node.object);
  let property = identifierName(node.property);
  let computed = false;
  if (node.property && node.property.type === "Computed") {
    computed = true;
    property = expressionName(node.property.expression) || "<computed>";
  }
  return { object, property, computed, qualified: object ? `${object}.${property}` : property };
}

function expressionName(node) {
  if (!node) return "";
  const direct = identifierName(node);
  if (direct) return direct;
  if (node.type === "ThisExpression") return "this";
  if (node.type === "Super") return "super";
  if (node.type === "MemberExpression") return (memberInfo(node) || {}).qualified || "";
  if (node.type === "ParenthesisExpression") return expressionName(node.expression);
  return "";
}

function shortName(name) {
  const parts = String(name || "unknown").split(".");
  return parts[parts.length - 1];
}

function parameterNames(params) {
  return (params || []).map((param) => identifierName(param.pat || param)).filter(Boolean);
}

function inferExpression(node, index, scope) {
  if (!node) return { type: "unknown", confidence: "candidate" };
  if (node.type === "NewExpression") return { type: expressionName(node.callee) || "unknown", confidence: "exact" };
  if (node.type === "StringLiteral" || node.type === "TemplateLiteral") return { type: "string", confidence: "exact" };
  if (node.type === "NumericLiteral" || node.type === "BigIntLiteral") return { type: "number", confidence: "exact" };
  if (node.type === "BooleanLiteral") return { type: "boolean", confidence: "exact" };
  if (node.type === "NullLiteral") return { type: "null", confidence: "exact" };
  if (node.type === "ArrayExpression") return { type: "array", confidence: "exact" };
  if (node.type === "ObjectExpression") return { type: "object", confidence: "exact" };
  if (node.type === "Identifier") {
    const resolved = index.resolve(node.value, scope);
    return { type: resolved.type, confidence: resolved.type === "unknown" ? "candidate" : "resolved", resolvedVia: resolved.resolvedVia };
  }
  if (node.type === "ConditionalExpression") {
    const left = inferExpression(node.consequent, index, scope);
    const right = inferExpression(node.alternate, index, scope);
    return left.type === right.type ? left : { type: "unknown", candidateTypes: [...new Set([left.type, right.type].filter((x) => x !== "unknown"))], confidence: "ambiguous" };
  }
  if (node.type === "CallExpression") {
    const callee = expressionName(node.callee);
    const match = callee.match(/(?:^|\.)(?:Create|Read)([A-Z][A-Za-z0-9_$]*)$/);
    if (match) return { type: "unknown", candidateType: match[1], confidence: "name-inferred" };
    const receiver = callee.match(/^(.+)\.(?:clone|createDuplicate)$/);
    if (receiver) {
      const resolved = index.resolve(receiver[1], scope);
      return { type: resolved.type, candidateType: resolved.type, confidence: "name-inferred", resolvedVia: resolved.resolvedVia };
    }
  }
  return { type: "unknown", confidence: "candidate" };
}

module.exports = { expressionName, identifierName, inferExpression, memberInfo, parameterNames, shortName };
