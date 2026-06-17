export function buildCimeChannelUrl(handle?: string | null) {
  const normalizedHandle = handle?.trim().replace(/^@+/, "");
  if (!normalizedHandle) {
    return undefined;
  }
  return `https://ci.me/@${normalizedHandle}/live`;
}
