"use strict";
const { asArray, COLLECTIONS } = require("./rows.js");
function absenceClaims(model) {
    return [
        [
            "checkedNoUsage",
            asArray(model.checkedNoUsage)
        ],
        [
            "capabilities",
            asArray(model.capabilities).filter((row)=>row.status === "checked-no-usage")
        ],
        ...COLLECTIONS.filter((name)=>name !== "checkedNoUsage" && name !== "evidenceIndex").map((name)=>[
                name,
                asArray(model[name]).filter((row)=>row.status === "checked-no-usage")
            ])
    ].flatMap(([collection, rows])=>rows.map((row)=>({
                collection,
                row
            })));
}
function absenceProjection(model) {
    return absenceClaims(model).map(({ collection, row })=>[
            row.id,
            collection,
            asArray(row.expectedNames).join(", "),
            row.reason || "",
            row.repository || "",
            row.searchScope || "",
            asArray(row.performedChecks).join(", "),
            asArray(row.ordersChecked).join(", "),
            asArray(row.linkingMethodsChecked).join(", "),
            row.resultComplete === true ? "complete" : "incomplete",
            row.resultTruncated === false ? "untruncated" : "truncated",
            row.consequence || "",
            row.status || "",
            asArray(row.scenarioRefs).join(", "),
            asArray(row.recipientRefs).join(", "),
            asArray(row.pathRefs).join(", "),
            asArray(row.gapRefs).join(", "),
            asArray(row.capabilityRefs).join(", "),
            asArray(row.testSurfaceRefs).join(", "),
            asArray(row.evidenceRefs).join(", ")
        ]);
}
module.exports = {
    absenceClaims,
    absenceProjection
};
