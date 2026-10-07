import { AbsoluteFill, useVideoConfig } from 'remotion';
import { content } from './content';
import { theme } from './theme';

export default function Cover() {
  const { width, height } = useVideoConfig();
  const compact = width / height < 1.5;

  return (
    <AbsoluteFill
      style={{
        background: theme.background,
        color: theme.ink,
        fontFamily: theme.fontFamily,
        padding: compact ? 100 : 120,
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: compact ? 100 : 160,
          height: 12,
          background: theme.accent,
          marginBottom: compact ? 60 : 50,
        }}
      />
      <h1
        style={{
          fontSize: compact ? 105 : 115,
          lineHeight: 1.3,
          margin: 0,
          maxWidth: compact ? 1250 : 1600,
        }}
      >
        {content.title}
      </h1>
      <p
        style={{
          fontSize: compact ? 44 : 42,
          lineHeight: 1.6,
          maxWidth: compact ? 1050 : 1450,
          color: theme.muted,
          marginTop: compact ? 70 : 50,
        }}
      >
        {content.subtitle}
      </p>
    </AbsoluteFill>
  );
}
