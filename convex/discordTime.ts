const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function formatDiscordDateTime(value?: string) {
  if (!value) {
    return "확인 중";
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  const date = new Date(timestamp + KST_OFFSET_MS);
  const year = date.getUTCFullYear();
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());
  const hour = pad2(date.getUTCHours());
  const minute = pad2(date.getUTCMinutes());

  return `${year}-${month}-${day} ${hour}:${minute} KST`;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
