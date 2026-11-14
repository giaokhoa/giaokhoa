import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export function createMissingNodeIdExtension(
  extensionName: string,
  nodeType: string,
  newId: () => string,
) {
  return Extension.create({
    name: extensionName,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey(extensionName),
          appendTransaction: (_transactions, _oldState, newState) => {
            const missing: number[] = [];
            newState.doc.descendants((node, pos) => {
              if (node.type.name === nodeType && typeof node.attrs.id !== 'string') {
                missing.push(pos);
              }
              return true;
            });
            if (missing.length === 0) return null;
            const tr = newState.tr;
            for (const pos of missing.reverse()) {
              const node = tr.doc.nodeAt(pos);
              if (node && node.type.name === nodeType) {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: newId() });
              }
            }
            return tr;
          },
        }),
      ];
    },
  });
}
