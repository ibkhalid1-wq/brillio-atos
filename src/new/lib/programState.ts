export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function getProgramState(rawData: Record<string, unknown>) {
  const wrapper = asRecord(rawData);
  const nested = asRecord(wrapper.data);
  const usesNestedData = Object.keys(nested).length > 0;
  const inner = usesNestedData ? nested : wrapper;
  return {
    wrapper,
    inner,
    usesNestedData,
  };
}

export function wrapProgramState(
  wrapper: Record<string, unknown>,
  inner: Record<string, unknown>,
  usesNestedData: boolean,
) {
  return usesNestedData
    ? {
        ...wrapper,
        data: inner,
      }
    : inner;
}
