import { AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame } from 'remotion';
import timeline from '../audio-timeline.json';
import { content } from './content';
import { theme } from './theme';

export default function Scene() {
  const frame = useCurrentFrame();
  const current =
    timeline.main.segments.findLast((segment) => segment.start <= frame) ??
    timeline.main.segments[0];
  const paragraph =
    content.paragraphs.find((item) => item.id === current?.group) ?? content.paragraphs[0];
  const caption = timeline.main.segments.find(
    (segment) => frame >= segment.start && frame < segment.end,
  );
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  // Draft previews have no fabricated voice track; audio appears after the measured pipeline.
  const draft = 'draft' in timeline && timeline.draft === true;

  return (
    <AbsoluteFill
      style={{
        background: theme.background,
        color: theme.ink,
        fontFamily: theme.fontFamily,
        padding: 100,
      }}
    >
      {!draft && <Audio src={staticFile(timeline.main.audioFile)} />}
      <div style={{ fontSize: 28, letterSpacing: 6, color: theme.muted }}>
        {draft ? '内容草稿 · 时序待配音校准' : '正文'}
      </div>
      <div style={{ marginTop: 90, opacity }}>
        <h1 style={{ fontSize: 90, lineHeight: 1.3, margin: 0, maxWidth: 1500 }}>
          {content.title}
        </h1>
        <p style={{ fontSize: 40, color: theme.muted }}>{content.subtitle}</p>
        <div
          style={{
            marginTop: 70,
            borderLeft: `8px solid ${theme.accent}`,
            paddingLeft: 32,
            fontSize: 42,
          }}
        >
          {paragraph.lines.map((line) => (
            <p key={line.id}>{line.text}</p>
          ))}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 70,
          left: 140,
          right: 140,
          textAlign: 'center',
          fontSize: 46,
          whiteSpace: 'pre-line',
          minHeight: 120,
        }}
      >
        {caption?.caption ?? ''}
      </div>
    </AbsoluteFill>
  );
}
