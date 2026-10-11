// No half of a character left over: a high UTF-16 unit with no low one after it, or a low unit with no high one before.
export const isWhole = (text: string): boolean =>
  !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text)
