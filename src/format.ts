export const sanitizeResponse = (
  raw: string,
  opts: { forMemoryDump: boolean; botUserId: string },
): string => {
  let response = raw.trim();
  response = response.replace(/<think>[\s\S]*?<\/think>/g, "");
  response = response.replace(
    new RegExp(`^(?:\\{${opts.botUserId}\\|[^}]+\\}|@?rob)\\s*:\\s*`, "m"),
    "",
  );
  response = opts.forMemoryDump
    ? response.replaceAll(/{[\w\.]+\|([^{}]+)}/mg, "$1")
    : response.replaceAll(/{([\w\.]+)\|[^{}]+}/mg, "<@$1>");
  return response;
};
