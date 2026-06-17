import { v } from "convex/values";

export type WatchLink = {
  label: string;
  url: string;
};

export const watchLinksValidator = v.array(
  v.object({
    label: v.string(),
    url: v.string(),
  }),
);

const MAX_WATCH_LINKS = 8;
const MAX_WATCH_LINK_LABEL_LENGTH = 20;
const MAX_WATCH_LINK_URL_LENGTH = 512;

export function normalizeWatchLinks(value: WatchLink[] | undefined | null) {
  if (!value) {
    return [];
  }
  if (value.length > MAX_WATCH_LINKS) {
    throw new Error(`시청 링크는 ${MAX_WATCH_LINKS}개까지 저장할 수 있습니다.`);
  }

  const seenUrls = new Set<string>();
  const links: WatchLink[] = [];

  for (const link of value) {
    const label = link.label.trim();
    const rawUrl = link.url.trim();

    if (!label && !rawUrl) {
      continue;
    }
    if (!label || !rawUrl) {
      throw new Error("시청 링크는 플랫폼 명과 주소를 함께 입력해야 합니다.");
    }
    if (label.length > MAX_WATCH_LINK_LABEL_LENGTH) {
      throw new Error(
        `플랫폼 명은 ${MAX_WATCH_LINK_LABEL_LENGTH}자 이하여야 합니다.`,
      );
    }
    if (/[\r\n]/.test(label) || /\s/.test(rawUrl)) {
      throw new Error("시청 링크에 줄바꿈이나 공백을 포함할 수 없습니다.");
    }
    if (rawUrl.length > MAX_WATCH_LINK_URL_LENGTH) {
      throw new Error(
        `시청 링크 주소는 ${MAX_WATCH_LINK_URL_LENGTH}자 이하여야 합니다.`,
      );
    }

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error("시청 링크 주소 형식이 올바르지 않습니다.");
    }
    if (url.protocol !== "https:") {
      throw new Error("시청 링크 주소는 https://로 시작해야 합니다.");
    }

    url.hash = "";
    const normalizedUrl = url.toString();
    const duplicateKey = normalizedUrl.toLowerCase();
    if (seenUrls.has(duplicateKey)) {
      throw new Error("중복된 시청 링크 주소가 있습니다.");
    }
    seenUrls.add(duplicateKey);
    links.push({ label, url: normalizedUrl });
  }

  return links;
}

export function buildWatchLinksMarkdown(
  channelUrl: string | undefined,
  watchLinks: WatchLink[] | undefined,
) {
  const normalizedLinks = normalizeWatchLinks(watchLinks);
  if (normalizedLinks.length === 0) {
    return undefined;
  }

  const links = channelUrl
    ? [{ label: "씨미", url: channelUrl }, ...normalizedLinks]
    : normalizedLinks;

  return links.map(formatMarkdownLink).join(" · ");
}

function formatMarkdownLink(link: WatchLink) {
  return `[${escapeMarkdownLinkLabel(link.label)}](${escapeMarkdownLinkUrl(
    link.url,
  )})`;
}

function escapeMarkdownLinkLabel(value: string) {
  return value.replace(/[\\[\]]/g, "\\$&");
}

function escapeMarkdownLinkUrl(value: string) {
  return value.replace(/\(/g, "%28").replace(/\)/g, "%29");
}
