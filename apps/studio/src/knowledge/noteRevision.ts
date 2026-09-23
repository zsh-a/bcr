import { textVersion } from "@bcr/core";
import { decodeNote, type KnowledgeNote } from "./model";

/** Covers metadata and citations as well as the body; body version still serves pagination. */
export const noteRevision = (note: KnowledgeNote) => textVersion(JSON.stringify(decodeNote(note)));
