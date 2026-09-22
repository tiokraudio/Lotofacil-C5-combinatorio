import { JSDOM } from "jsdom";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

const dom = new JSDOM("<!DOCTYPE html><html><body><div id=\"root\"></div></body></html>", {
  url: "http://localhost",
  pretendToBeVisual: true,
});

function defineGlobal(key: string, value: any) {
  try {
    Object.defineProperty(global, key, {
      value,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  } catch {
    (global as any)[key] = value;
  }
}

defineGlobal("window", dom.window);
defineGlobal("document", dom.window.document);
defineGlobal("navigator", dom.window.navigator);
defineGlobal("HTMLElement", dom.window.HTMLElement);
defineGlobal("HTMLInputElement", dom.window.HTMLInputElement);
defineGlobal("HTMLButtonElement", dom.window.HTMLButtonElement);
defineGlobal("HTMLFormElement", dom.window.HTMLFormElement);
defineGlobal("KeyboardEvent", dom.window.KeyboardEvent);
defineGlobal("MouseEvent", dom.window.MouseEvent);
defineGlobal("Event", dom.window.Event);
defineGlobal("CustomEvent", dom.window.CustomEvent);
defineGlobal("IS_REACT_ACT_ENVIRONMENT", true);
defineGlobal("indexedDB", indexedDB);
defineGlobal("IDBKeyRange", IDBKeyRange);

(dom.window as any).indexedDB = indexedDB;
(dom.window as any).IDBKeyRange = IDBKeyRange;

if (!dom.window.matchMedia) {
  (dom.window as any).matchMedia = () => ({
    matches: false,
    media: "",
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

export { dom };
