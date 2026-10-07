import { inside, json, type Project, type Target } from '../core';
export function props(p: Project, t: Target) {
  return t.propsFile ? json<Record<string, unknown>>(inside(p.root, t.propsFile)) : {};
}
