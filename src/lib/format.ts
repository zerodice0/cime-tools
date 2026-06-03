const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const relativeFormatter = new Intl.RelativeTimeFormat("ko-KR", {
  numeric: "auto",
});
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function formatDateTime(value?: number) {
  if (!value) {
    return "-";
  }
  return dateTimeFormatter.format(new Date(value));
}

export function formatMaybeDate(value?: string) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return dateTimeFormatter.format(date);
}

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

export function formatRelativeTime(value?: number) {
  if (!value) {
    return "-";
  }
  const deltaMs = value - Date.now();
  const absMs = Math.abs(deltaMs);

  if (absMs < 60 * 1000) {
    return relativeFormatter.format(Math.round(deltaMs / 1000), "second");
  }
  if (absMs < 60 * 60 * 1000) {
    return relativeFormatter.format(Math.round(deltaMs / (60 * 1000)), "minute");
  }
  if (absMs < 24 * 60 * 60 * 1000) {
    return relativeFormatter.format(
      Math.round(deltaMs / (60 * 60 * 1000)),
      "hour",
    );
  }
  return relativeFormatter.format(
    Math.round(deltaMs / (24 * 60 * 60 * 1000)),
    "day",
  );
}

export function formatDuration(valueMs: number) {
  if (valueMs % (60 * 60 * 1000) === 0) {
    return `${valueMs / (60 * 60 * 1000)}시간`;
  }
  if (valueMs % (60 * 1000) === 0) {
    return `${valueMs / (60 * 1000)}분`;
  }
  return `${Math.round(valueMs / 1000)}초`;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
