export const ORDER_ROW_HEIGHT = 44;
export const TABLE_WIDTH = 180 + 19 * 145;
// Fixed-height rows and spacer rows keep the table semantics while bounding DOM
// work independently of how many cursor batches have already been loaded.
export function virtualWindow(count: number, scrollTop: number, height: number, bodyOffset: number, overscan = 6) {
  const first = Math.max(0, Math.floor((scrollTop - bodyOffset) / ORDER_ROW_HEIGHT));
  const start = Math.min(count, Math.max(0, first - overscan));
  const end = Math.min(count, Math.max(start, first + Math.ceil(height / ORDER_ROW_HEIGHT) + overscan));
  return { start, end, top: start * ORDER_ROW_HEIGHT, bottom: (count - end) * ORDER_ROW_HEIGHT };
}
