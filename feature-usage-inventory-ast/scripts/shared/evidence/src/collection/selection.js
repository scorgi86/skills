"use strict";
function selectRoundRobin(groups, limit) {
    const queues = groups.map((group)=>[
            ...group.candidates
        ]);
    const selected = [];
    const seen = new Set();
    while(selected.length < limit && queues.some((queue)=>queue.length)){
        for (const queue of queues){
            while(queue.length){
                const candidate = queue.shift();
                const identity = `${candidate.file}\u001f${candidate.line}`;
                if (seen.has(identity)) continue;
                seen.add(identity);
                selected.push(candidate);
                break;
            }
            if (selected.length >= limit) break;
        }
    }
    return selected;
}
function selectEvidenceGroups(groups, limit, requiredKeys = []) {
    const selected = [];
    const used = new Set();
    const add = (group)=>{
        if (!group || used.has(group.key) || selected.length >= limit) return;
        used.add(group.key);
        selected.push(group);
    };
    for (const key of requiredKeys)add(groups.find((group)=>group.key === key));
    const buckets = new Map();
    for (const group of groups){
        if (used.has(group.key)) continue;
        const bucket = group.identity.patternId || group.identity.file || group.label;
        if (!buckets.has(bucket)) buckets.set(bucket, []);
        buckets.get(bucket).push(group);
    }
    const queues = [
        ...buckets.entries()
    ].sort(([left], [right])=>left.localeCompare(right)).map(([, values])=>values);
    while(selected.length < limit && queues.some((queue)=>queue.length)){
        for (const queue of queues){
            add(queue.shift());
            if (selected.length >= limit) break;
        }
    }
    return selected;
}
module.exports = {
    selectEvidenceGroups,
    selectRoundRobin
};
