function buildSourceMap(source) {
  const buffer = Buffer.from(source, "utf8");
  const lineStarts = [0];
  for (let i = 0; i < buffer.length; i += 1) if (buffer[i] === 10) lineStarts.push(i + 1);

  function byteToPosition(byteOffset) {
    const offset = Math.max(0, Math.min(buffer.length, byteOffset));
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (lineStarts[middle] <= offset) low = middle + 1;
      else high = middle - 1;
    }
    const lineIndex = Math.max(0, high);
    const lineByteStart = lineStarts[lineIndex];
    const column = buffer.subarray(lineByteStart, offset).toString("utf8").length + 1;
    return { offset, line: lineIndex + 1, column };
  }

  function range(span) {
    if (!span || !Number.isFinite(span.start) || !Number.isFinite(span.end)) return null;
    const startByte = Math.max(0, span.start - 1);
    const endByte = Math.max(startByte, span.end - 1);
    return { start: byteToPosition(startByte), end: byteToPosition(endByte), text: buffer.subarray(startByte, endByte).toString("utf8") };
  }

  return { buffer, lineStarts, byteToPosition, range };
}

function compactSnippet(text, maxLength = 240) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`;
}

function evidenceFor(node, context, extractor, confidence = "candidate") {
  const mapped = context.sourceMap.range(node && node.span);
  return {
    file: context.filename,
    range: mapped ? { start: mapped.start, end: mapped.end } : null,
    snippet: mapped ? compactSnippet(mapped.text) : "",
    extractor,
    confidence,
    status: "не проверено",
  };
}

module.exports = { buildSourceMap, compactSnippet, evidenceFor };
