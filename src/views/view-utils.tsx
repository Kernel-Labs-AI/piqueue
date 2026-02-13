export type MetaField = {
  label: string;
  value: string;
};

export function formatMeta(meta: MetaField[]) {
  return meta.map((entry) => (
    <div class="meta-item">
      <div class="meta-label">{entry.label}</div>
      <div class="meta-value">{entry.value}</div>
    </div>
  ));
}

export function joinMeta(inlineMeta: string[], separator: string = "\u00b7") {
  return inlineMeta.flatMap((value, index) => {
    const nodes: Array<string | unknown> = [];
    if (index > 0) {
      nodes.push(<span class="detail-divider">{separator}</span>);
    }
    nodes.push(<span>{value}</span>);
    return nodes;
  });
}
