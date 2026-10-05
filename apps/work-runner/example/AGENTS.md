# Work authoring

This directory is an ordinary, standalone creative project. Edit these source files; BCR's application source is not part of the work.

- Read brief.md, work.json, data.json and reviews.json (if present). Preserve stable work/target IDs and review scene IDs when making local changes.
- Scene.tsx composes the work. src/scenes contains free-form React scenes; src/components, src/theme.ts and src/motion.ts are optional reusable code, not a required platform DSL. Extend or replace them for a new visual direction.
- Use the installed bcr-runner CLI or runner_* MCP tools. Start with inspect/runner_read to obtain the authorized directory and revision. Source edits change that revision; inspect again before rendering.
- Keep all remotion and @remotion/* dependencies at 4.0.532 and commit package.json plus bun.lock. Never use workspace/file dependencies. `bun install --frozen-lockfile --ignore-scripts` and `bun run typecheck` work outside the BCR repository.
- All motion comes from the frame. Use interpolation, spring or @remotion/gsap's useGsapTimeline. Do not use autonomous GSAP tickers, CSS transitions, wall-clock time or unseeded randomness. Monetary values must stay within their calculated range.
- Put fonts, images and audio in public/. Declare required project-relative paths in work.json's target.assets. Call staticFile without the public/ prefix. Wait for fonts/images to load; keep asset authorship and licenses with the source. Assets must work offline.
- First capture representative style frames; then export a short draft with audio. Check scene boundaries, text clipping, numeric truth and seek order. Full playback is required to check pacing and sound; stills alone do not establish video quality.
- `validate` renders frame 0 and returns diagnostics.json plus a PNG. Asset inventory is not a complete missing-glyph or all-scenes check. `capture --frames` selects additional frames.
- Use `render --profile draft --from 0 --to 449` for the first 15 seconds at 30 fps. Use `--profile final` for the final video. Explicit --scale overrides profile size. --crf changes video compression; --gl angle or swangle is optional for GPU work, not needed by this example.
- Long operations return job IDs. Poll job/runner_job, inspect images via runner_output(image: true), and download videos for playback. Do not treat job submission as successful rendering.
- Read timestamped reviews, make changes against their source revision, and mark a review resolved only after inspecting the relevant new frames. Archive the source snapshot used for final output.
