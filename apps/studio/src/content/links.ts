export const visualUrl = (project: string, index: number) => `content-visual:${project}:${index}`;
export function parseVisualUrl(url: string) {
  const m = /^content-visual:([a-zA-Z0-9][a-zA-Z0-9_-]{0,99}):([0-7])$/u.exec(url);
  return m ? { project: m[1]!, index: Number(m[2]) } : null;
}
