export function localName(element: Element): string {
  return element.localName ?? element.tagName.split(":").pop() ?? element.tagName;
}

export function metadataValue(document: Document, name: string): string | undefined {
  const element = [...document.getElementsByTagName("*")].find(
    (candidate) => localName(candidate) === name,
  );
  return element?.textContent?.trim() || undefined;
}

export function firstLocalElement(root: Document | Element, name: string): Element | undefined {
  return [...root.getElementsByTagName("*")].find((candidate) => localName(candidate) === name);
}
