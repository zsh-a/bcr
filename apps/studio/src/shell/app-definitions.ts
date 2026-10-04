import { definition as markets } from "@bcr/market-board/app-definition";
import { definition as quant } from "@bcr/quant-lab/app-definition";
import { definition as reader } from "@bcr/reader-studio/app-definition";
import { definition as media } from "@bcr/media-studio/app-definition";
import { definition as data } from "@bcr/data-studio/app-definition";
import { definition as manga } from "@bcr/manga-studio/app-definition";
import { definition as documents } from "@bcr/document-studio/app-definition";
import { definition as docgen } from "@bcr/docgen-studio/app-definition";
import { hostDefinitions } from "./host-definitions";
/** Ordered pure-data catalog; UI registration resolves implementations by these identities. */
export const APP_DEFINITIONS = [
  markets,
  quant,
  reader,
  hostDefinitions.knowledge,
  hostDefinitions.diagram,
  hostDefinitions.works,
  media,
  data,
  manga,
  documents,
  hostDefinitions.studio,
  docgen,
] as const;
export const INSTALLABLE_APPS = [hostDefinitions.workspace, ...APP_DEFINITIONS] as const;
