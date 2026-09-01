import type { MangaSource, TextRegion } from "./model";

/**
 * Self-authored demo page.  It deliberately lives in source instead of an
 * external image so the first vertical slice works offline and has no
 * copyrighted fixture dependency.
 */
const fixtureSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="880" height="1240" viewBox="0 0 880 1240">
  <rect width="880" height="1240" fill="#efe9dc"/>
  <rect x="34" y="34" width="812" height="1172" rx="10" fill="#f7f3eb" stroke="#1b2424" stroke-width="5"/>
  <path d="M52 340H828M52 772H828M440 52V326M440 790V1188" stroke="#1b2424" stroke-width="5" fill="none"/>
  <path d="M82 294C135 164 310 142 390 248C327 238 254 258 180 326Z" fill="#d6e7e1" stroke="#1b2424" stroke-width="4"/>
  <path d="M504 144C610 80 760 124 802 252C702 212 610 220 520 274Z" fill="#ddd7ef" stroke="#1b2424" stroke-width="4"/>
  <path d="M82 646C158 488 344 470 418 596C318 566 214 594 116 688Z" fill="#e4e9d0" stroke="#1b2424" stroke-width="4"/>
  <path d="M500 612C586 482 760 486 802 650C712 604 620 610 532 700Z" fill="#f0d7cf" stroke="#1b2424" stroke-width="4"/>
  <path d="M86 1012C180 858 344 864 414 1000C302 960 208 986 112 1064Z" fill="#cfe1ea" stroke="#1b2424" stroke-width="4"/>
  <path d="M500 1050C588 904 744 902 802 1056C704 1018 614 1028 520 1104Z" fill="#e7ddc8" stroke="#1b2424" stroke-width="4"/>
  <g fill="#1b2424" font-family="IBM Plex Sans, Noto Sans JP, sans-serif" text-anchor="middle">
    <text x="440" y="92" font-size="20" letter-spacing="5">BCR / DEMO PAGE 01</text>
    <text x="220" y="222" font-size="32" font-weight="600">ここから、始めよう。</text>
    <text x="664" y="202" font-size="30" font-weight="600">もうすぐ春だね</text>
    <text x="244" y="570" font-size="34" font-weight="600">見つけた！</text>
    <text x="652" y="588" font-size="28" font-weight="600">静かな午後</text>
    <text x="228" y="948" font-size="27" font-weight="600">ページをめくる</text>
    <text x="650" y="1010" font-size="26" font-weight="600">また明日。</text>
  </g>
  <g fill="none" stroke="#1b2424" stroke-width="4">
    <ellipse cx="220" cy="182" rx="154" ry="54" fill="#fffdf8"/>
    <ellipse cx="664" cy="170" rx="136" ry="52" fill="#fffdf8"/>
    <ellipse cx="244" cy="536" rx="118" ry="52" fill="#fffdf8"/>
    <ellipse cx="652" cy="558" rx="132" ry="52" fill="#fffdf8"/>
    <ellipse cx="228" cy="922" rx="142" ry="52" fill="#fffdf8"/>
    <ellipse cx="650" cy="984" rx="114" ry="50" fill="#fffdf8"/>
  </g>
  <g fill="#1b2424">
    <circle cx="162" cy="282" r="11"/><circle cx="190" cy="299" r="7"/>
    <circle cx="746" cy="254" r="11"/><circle cx="722" cy="270" r="7"/>
    <circle cx="292" cy="588" r="11"/><circle cx="314" cy="604" r="7"/>
  </g>
</svg>`;

export const FIXTURE_PAGE_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fixtureSvg)}`;

export const fixtureSource: MangaSource = {
  id: "fixture-page-01",
  kind: "fixture",
  name: "demo-page-01.svg",
  size: new Blob([fixtureSvg], { type: "image/svg+xml" }).size,
  objectUrl: FIXTURE_PAGE_URL,
  width: 880,
  height: 1240,
  pageCount: 1,
};

export const fixtureRegions: ReadonlyArray<TextRegion> = [
  {
    id: "region-01",
    label: "BUBBLE 01",
    x: 7.5,
    y: 10.1,
    width: 27.5,
    height: 8.6,
    rotation: 0,
    writingMode: "horizontal-tb",
    sourceText: "ここから、始めよう。",
    translatedText: "就从这里开始吧。",
    confidence: 0.98,
    status: "reviewed",
  },
  {
    id: "region-02",
    label: "BUBBLE 02",
    x: 60.1,
    y: 9.2,
    width: 26.2,
    height: 8.4,
    rotation: 0,
    writingMode: "horizontal-tb",
    sourceText: "もうすぐ春だね",
    translatedText: "春天快到了呢",
    confidence: 0.94,
    status: "reviewed",
  },
  {
    id: "region-03",
    label: "BUBBLE 03",
    x: 14.8,
    y: 39.1,
    width: 24.8,
    height: 8.6,
    rotation: 0,
    writingMode: "horizontal-tb",
    sourceText: "見つけた！",
    translatedText: "找到了！",
    confidence: 0.91,
    status: "needs-review",
  },
  {
    id: "region-04",
    label: "BUBBLE 04",
    x: 58.4,
    y: 40.9,
    width: 29.5,
    height: 8.4,
    rotation: 0,
    writingMode: "horizontal-tb",
    sourceText: "静かな午後",
    translatedText: "安静的午后",
    confidence: 0.87,
    status: "needs-review",
  },
  {
    id: "region-05",
    label: "BUBBLE 05",
    x: 7.3,
    y: 69.1,
    width: 31.5,
    height: 8.4,
    rotation: 0,
    writingMode: "horizontal-tb",
    sourceText: "ページをめくる",
    translatedText: "翻开下一页",
    confidence: 0.89,
    status: "needs-review",
  },
  {
    id: "region-06",
    label: "BUBBLE 06",
    x: 59.1,
    y: 74.3,
    width: 26.2,
    height: 8.4,
    rotation: 0,
    writingMode: "horizontal-tb",
    sourceText: "また明日。",
    translatedText: "明天见。",
    confidence: 0.96,
    status: "reviewed",
  },
];

export function createImportedRegion(width: number, height: number): TextRegion {
  const ratio = height > 0 ? width / height : 0.7;
  const regionWidth = Math.min(34, Math.max(24, ratio * 40));
  return {
    id: "region-manual-01",
    label: "REVIEW 01",
    x: 50 - regionWidth / 2,
    y: 44,
    width: regionWidth,
    height: 10,
    rotation: 0,
    writingMode: "horizontal-tb",
    sourceText: "待识别文本",
    translatedText: "请编辑译文",
    confidence: 0.42,
    status: "needs-review",
  };
}
