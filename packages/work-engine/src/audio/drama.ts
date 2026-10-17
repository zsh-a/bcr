import { existsSync, openSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { type Subprocess, spawn } from 'bun';
import { hashFile, json, sha, stable } from '../lib/files';
import type { VoiceSettings } from './content';

interface DramaProfile {
  runtime: string;
  model: string;
  experts?: string;
  maxLength?: number;
}
export interface DramaRequest {
  text: string;
  options: Record<string, string | number | boolean | number[]>;
}

const runtimeHashes = new Map<string, string>();
// The binary is large; stat identity avoids rehashing it on every status query.
function runtimeRevision(path: string) {
  const { size, mtimeMs, ctimeMs } = statSync(path);
  const key = stable({ path, size, mtimeMs, ctimeMs });
  if (!runtimeHashes.has(key)) {
    runtimeHashes.set(key, hashFile(path));
  }
  return runtimeHashes.get(key)!;
}

function modelRevision(root: string) {
  const files: [string, number, number][] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        const { size, mtimeMs } = statSync(path);
        files.push([relative(root, path), size, mtimeMs]);
      }
    }
  };
  visit(root);
  if (!files.length) {
    throw new Error(`drama-rs 模型目录为空: ${root}`);
  }
  return `local-model-stat-v1:${sha(stable(files.sort()))}`;
}

export function dramaProfile() {
  const path = process.env.DRAMA_RS_PROFILE ?? join(homedir(), '.config/bcr/drama-rs.json');
  if (!existsSync(path)) {
    throw new Error(`请在 ${path} 配置 drama-rs 的 runtime 与 model`);
  }
  const profile = json<DramaProfile>(path);
  const runtime = resolve(profile.runtime);
  const model = resolve(profile.model);
  if (!existsSync(runtime) || !existsSync(model)) {
    throw new Error(`drama-rs 运行程序或模型不存在: ${path}`);
  }
  return { runtime, model, experts: profile.experts ?? 'q4', maxLength: profile.maxLength ?? 4096 };
}

/** Machine-independent generation identity; local paths stay out of cache keys. */
export function dramaSettings(voice: VoiceSettings) {
  const profile = dramaProfile();
  return {
    backend: 'drama-rs' as const,
    model: voice.model,
    experts: profile.experts,
    modelRevision: modelRevision(profile.model),
    runtimeRevision: runtimeRevision(profile.runtime),
    styleTag: voice.generation?.styleTag,
    options: voice.generation?.options ?? {},
  };
}

/** Direction tags may only add delivery hints; the spoken words must equal content.json. */
export function dramaRequest(voice: VoiceSettings, id: string, text: string): DramaRequest {
  const override = voice.generation?.paragraphs?.[id];
  const directed = override?.text ?? text;
  const spoken = directed.replace(/\[[^[\]\n]*\]|<\/?(?:emphasis|slow)>/g, '');
  if (spoken.trim() !== text.trim()) {
    throw new Error(`drama-rs 段落提示改变了口播文字: ${id}`);
  }
  if (/\[|\]|<|>/.test(spoken)) {
    throw new Error(`drama-rs 段落含不支持的标记: ${id}`);
  }
  const style = voice.generation?.styleTag?.trim();
  return {
    text: style && !directed.trimStart().startsWith('[') ? `${style} ${directed}` : directed,
    options: { ...voice.generation?.options, ...override?.options },
  };
}

function freePort() {
  return new Promise<number>((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? done(address.port) : fail()));
    });
  });
}

export function dramaWav(body: ArrayBuffer) {
  const wav = Buffer.from(body);
  if (
    wav.length < 44 ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('drama-rs 返回的音频不是 WAV');
  }
  return wav;
}

/** One local server per voiceover run; it stops before GPU alignment starts. */
export async function startDrama(reference: string, transcript: string, log: string) {
  const profile = dramaProfile();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const output = openSync(log, 'a');
  const server: Subprocess = spawn(
    [
      profile.runtime,
      'serve',
      '--model',
      profile.model,
      '--experts',
      profile.experts,
      '--addr',
      `127.0.0.1:${port}`,
      '--max-len',
      String(profile.maxLength),
    ],
    { stdout: output, stderr: output },
  );
  const call = async (path: string, init?: RequestInit, timeout = 30 * 60 * 1000) => {
    const response = await fetch(base + path, { ...init, signal: AbortSignal.timeout(timeout) });
    if (!response.ok) {
      throw new Error(
        `drama-rs ${path} 返回 ${response.status}: ${(await response.text()).slice(0, 2000)}`,
      );
    }
    return response;
  };
  const close = async () => {
    if (server.exitCode === null) {
      server.kill();
      await server.exited;
    }
  };
  try {
    for (let attempt = 0; ; attempt++) {
      if (server.exitCode !== null) {
        throw new Error(`drama-rs 服务启动失败，详见 ${log}`);
      }
      try {
        await call('/health', undefined, 1000);
        break;
      } catch (error) {
        if (attempt >= 240) {
          throw error;
        }
        await Bun.sleep(500);
      }
    }
    await call('/v1/voices'); // Wait for model load, not only the HTTP listener.
    const query = new URLSearchParams({ name: 'reference', text: transcript });
    await call(`/v1/voices?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: readFileSync(reference),
    });
  } catch (error) {
    await close();
    throw error;
  }
  return {
    async speak(request: DramaRequest) {
      const response = await call('/v1/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...request.options,
          text: request.text,
          voice: 'reference',
          split: false,
        }),
      });
      return dramaWav(await response.arrayBuffer());
    },
    close,
  };
}
