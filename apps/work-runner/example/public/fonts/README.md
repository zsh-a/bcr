# Bundled fonts

- SourceHanSansCN-Regular.woff2: complete Simplified Chinese regional font from Adobe Source Han Sans, converted from the installed SourceHanSansCN-Regular.otf using woff2_compress without glyph subsetting. Upstream: https://github.com/adobe-fonts/source-han-sans . License: Source-Han-Sans-LICENSE.txt (SIL OFL 1.1).
- IBMPlexMono-Regular.woff2: Latin regular font from @fontsource/ibm-plex-mono 5.3.0. Upstream: https://github.com/IBM/plex . License: IBM-Plex-OFL.txt (SIL OFL 1.1).

The source font bytes are included in every work snapshot. Runtime loading uses project-local URLs; the sample does not fetch a font service or depend on system-installed fonts. Preserve licenses when copying the work. Full Chinese glyph coverage allows agents to edit the script without regenerating a text-specific subset.
