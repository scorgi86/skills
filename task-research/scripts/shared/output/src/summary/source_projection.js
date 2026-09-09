"use strict";
function projectSourceCheck(check, options = {}) {
    const configured = options.maxGroupsByCheck && options.maxGroupsByCheck[check.id] !== undefined ? options.maxGroupsByCheck[check.id] : options.maxGroupsPerCheck;
    const limit = configured === undefined ? Number.MAX_SAFE_INTEGER : Math.max(1, Number(configured) || 1);
    const requiredKeys = options.requiredGroupKeys && options.requiredGroupKeys[check.id] || [];
    const allGroups = check.groups || [];
    const required = requiredKeys.map((key)=>allGroups.find((group)=>group.key === key)).filter(Boolean);
    const selectedKeys = new Set(required.map((group)=>group.key));
    const effectiveLimit = Math.max(limit, required.length);
    const selected = [
        ...required,
        ...allGroups.filter((group)=>!selectedKeys.has(group.key))
    ].slice(0, effectiveLimit);
    const groupsTotal = check.groupsTotal || allGroups.length;
    return {
        id: check.id,
        status: check.status,
        filesScanned: check.filesScanned,
        totalMatches: check.totalMatches,
        returned: check.returned,
        truncated: check.truncated,
        groupDigest: check.groupDigest || null,
        groupsTotal,
        groupsAvailable: allGroups.length,
        groupsReturned: selected.length,
        groupsOmitted: Math.max(0, groupsTotal - selected.length),
        groupsTruncated: selected.length < groupsTotal,
        groups: selected.map((group)=>({
                key: group.key,
                label: group.label,
                totalMatches: group.totalMatches,
                returned: group.returned,
                truncated: group.truncated,
                firstAnchor: group.firstAnchor
            }))
    };
}
function sourceProjection(sourceEvidence, options = {}) {
    return (sourceEvidence && Array.isArray(sourceEvidence.checks) ? sourceEvidence.checks : []).map((check)=>projectSourceCheck(check, options));
}
module.exports = {
    projectSourceCheck,
    sourceProjection
};
