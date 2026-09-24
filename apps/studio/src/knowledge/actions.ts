import { contentHash } from "@bcr/core";
import type { ResearchLibrary, ResearchStore } from "../research/index";
import { contentOf, emptyContent, newNote } from "./model";
import type { KnowledgeStore } from "./store";
import { FILE_LIMIT, importMarkdown } from "./files";
import { writeKnowledgeBackup } from "./backup";
import { localDay } from "./workbench";

/** Stable source IDs make repeated imports idempotent without merging the two domain models. */
export function researchToKnowledge(library: ResearchLibrary) {
  const content = emptyContent();
  for (const group of library.collections) {
    const groupId = contentHash(new TextEncoder().encode(`research-collection:${group.id}`));
    content.collections[groupId] = { id: groupId, name: group.name };
    for (const excerpt of group.excerpts) {
      const id = contentHash(
        new TextEncoder().encode(JSON.stringify(["research", group.id, excerpt.id])),
      );
      content.notes[id] = {
        ...newNote(excerpt.title, groupId),
        id,
        body: `${excerpt.text
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")}\n\n${excerpt.note}`,
        citations: [excerpt],
      };
    }
  }
  return content;
}

/** Application operations; views supply a draft barrier and own navigation/download presentation. */
export function createKnowledgeActions(
  store: KnowledgeStore,
  research: ResearchStore,
  flush: () => Promise<void>,
) {
  return {
    async create(collection: string | null, title = "") {
      await flush();
      const note = newNote(title, collection);
      await store.saveNote(note, null);
      return note.id;
    },
    async daily(date = new Date()) {
      await flush();
      const day = localDay(date),
        id = `daily-${day}`;
      const note = {
        ...newNote(day),
        id,
        tags: ["日记"],
        body: `# ${day}\n\n## 今日计划\n\n- [ ] \n\n## 记录\n\n`,
      };
      await store.update((state) =>
        state.notes[id] ? state : { ...state, notes: { ...state.notes, [id]: note } },
      );
      return id;
    },
    async importMarkdown(file: Pick<File, "size" | "name" | "text">) {
      if (file.size > FILE_LIMIT) throw new Error("单篇导入上限为 2 MiB");
      const note = importMarkdown(await file.text(), file.name);
      await flush();
      await store.saveNote(note, null);
      return note.id;
    },
    async importResearch() {
      await flush();
      await research.ready;
      const content = researchToKnowledge(research.getSnapshot());
      await store.importContent(content);
      return Object.keys(content.notes).length;
    },
    async exportBackup() {
      await flush();
      return writeKnowledgeBackup(contentOf(store.getSnapshot()));
    },
  };
}
