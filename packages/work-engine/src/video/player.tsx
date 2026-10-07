import type { Parameter } from '@bcr/work-core';
import { Player, type PlayerRef } from '@remotion/player';
import { type ComponentType, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { connectPreview } from './bridge';

interface PreviewSettings<Props> {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  inputProps: Props;
  parameters?: readonly Parameter[];
}

/** A readable, type-checked browser entry shared by every generated preview page. */
export function mountPreview<Props extends Record<string, unknown>>(
  component: ComponentType<Props>,
  settings: PreviewSettings<Props>,
) {
  function Preview() {
    const ref = useRef<PlayerRef>(null);
    const [inputProps, setInputProps] = useState(settings.inputProps);
    useEffect(
      () =>
        connectPreview(
          ref,
          settings.parameters?.length
            ? (values) => {
                if (
                  values !== null &&
                  (!values || typeof values !== 'object' || Array.isArray(values))
                ) {
                  throw new Error('参数格式无效');
                }
                const next = { ...settings.inputProps };
                for (const [key, value] of Object.entries(values ?? {})) {
                  const spec = settings.parameters?.find((parameter) => parameter.key === key);
                  if (
                    !spec ||
                    typeof value !== spec.type ||
                    (typeof value === 'number' &&
                      (!Number.isFinite(value) ||
                        (spec.min !== undefined && value < spec.min) ||
                        (spec.max !== undefined && value > spec.max))) ||
                    (typeof value === 'string' && value.length > 4000)
                  ) {
                    throw new Error(`参数无效：${key}`);
                  }
                  Object.defineProperty(next, key, { value, enumerable: true });
                }
                flushSync(() => setInputProps(next));
              }
            : undefined,
        ),
      [],
    );
    const qa = new URLSearchParams(location.search).has('qa');
    return (
      <Player
        ref={ref}
        component={component}
        inputProps={inputProps}
        durationInFrames={settings.durationInFrames}
        fps={settings.fps}
        compositionWidth={settings.width}
        compositionHeight={settings.height}
        controls={!qa}
        initiallyMuted
        style={
          qa
            ? { width: settings.width, height: settings.height }
            : { width: '100%', maxHeight: '100vh' }
        }
      />
    );
  }
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('Preview mount element is missing');
  }
  createRoot(root).render(<Preview />);
}
