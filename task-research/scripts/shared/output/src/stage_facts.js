"use strict";
const { normalizeCapabilities } = require("../../dto/src/capability_contract.js");
const { byteLength, measureValue } = require("./measure_context.js");
function createStageFacts({ stage, status, transition, ast, sourceEvidence, quality, budgets, capabilities = [] }) {
    return {
        schemaVersion: "2.0.0",
        stage,
        status,
        runtime: {
            contract: "stage-facts",
            contractVersion: "1.0.0",
            planId: ast && ast.plan ? ast.plan.id : null,
            budgets
        },
        transition,
        ast,
        sourceEvidence,
        quality,
        capabilities: normalizeCapabilities(capabilities),
        measurements: {
            transition: measureValue(transition),
            ast: measureValue(ast),
            sourceEvidence: measureValue(sourceEvidence)
        }
    };
}
module.exports = {
    createStageFacts
};
