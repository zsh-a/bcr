import { describe, expect, it } from "vitest";
import {
  attachmentDisplayWidth,
  attachmentId,
  attachmentReferences,
  attachmentUrl,
  rewriteAttachmentUrls,
} from "../src/knowledge/attachments/attachmentModel";
import { imageReferenceMarkdown } from "../src/knowledge/attachments/imageReference";

describe("image presentation", () => {
  it("indexes bounded reference widths without changing asset identity or export retention", () => {
    for (const width of [32, 320, 4096]) {
      const url = attachmentUrl("picture", width);
      expect(attachmentId(url)).toBe("picture");
      expect(attachmentDisplayWidth(url)).toBe(width);
      expect(attachmentReferences(`![图](${url})`)[0]?.width).toBe(width);
      expect(rewriteAttachmentUrls(`![图](${url})`, (id) => `assets/${id}.png`)).toBe(
        "![图](assets/picture.png)",
      );
    }
    for (const url of [
      "attachment:picture?width=0",
      "attachment:picture?width=31",
      "attachment:picture?width=4097",
      "attachment:picture?width=NaN",
      "attachment:picture?width=320&extra=true",
    ])
      expect(attachmentId(url)).toBeNull();
    expect(() => attachmentUrl("picture", Infinity)).toThrow();
    expect(() => attachmentUrl("picture", 320.5)).toThrow();
  });
  it("preserves title, angle brackets and formatted alt text when adjusting width", () => {
    const source = '前文 ![**图\\]片**](<attachment:picture> "原有标题") 后文';
    const ref = attachmentReferences(source)[0]!;
    expect(imageReferenceMarkdown(source, ref, ref.label, 320)).toBe(
      '![**图\\]片**](<attachment:picture?width=320> "原有标题")',
    );
    expect(imageReferenceMarkdown(source, ref, "新[说明]", 640)).toBe(
      '![新\\[说明\\]](<attachment:picture?width=640> "原有标题")',
    );
  });
  it("detaches only the edited image reference, keeping shared definitions and other occurrences", () => {
    const source = '![甲][pic]\n\n![乙][pic]\n\n[pic]: attachment:picture?width=320 "保留标题"';
    const refs = attachmentReferences(source);
    expect(imageReferenceMarkdown(source, refs[0]!, "新说明")).toBe(
      '![新说明](attachment:picture "保留标题")',
    );
    expect(refs[1]?.width).toBe(320);
    expect(() =>
      imageReferenceMarkdown(source.replace("![甲]", "![外部更改]"), refs[0]!, "旧值"),
    ).toThrow();
    expect(() => imageReferenceMarkdown(source, refs[0]!, "非法\n换行")).toThrow();
  });
});
