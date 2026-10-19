import { Extension, type Editor, type JSONContent } from '@tiptap/core';
import { isHistoryTransaction } from '@tiptap/pm/history';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from '@tiptap/pm/state';

const CONTINUATION_BLOCK_TYPES = new Set(['blockMath', 'image', 'table']);

type ContinuationStatus = 'active' | 'dormant';
type ContinuationState = ReadonlyMap<number, ContinuationStatus>;
type ContinuationMeta = { add: number };

const continuationPluginKey = new PluginKey<ContinuationState>('blockContinuation');

function isEmptyParagraph(state: EditorState, pos: number) {
  const node = state.doc.nodeAt(pos);
  return node?.type.name === 'paragraph' && node.content.size === 0;
}

function followsContinuationBlock(state: EditorState, pos: number) {
  return CONTINUATION_BLOCK_TYPES.has(state.doc.resolve(pos).nodeBefore?.type.name ?? '');
}

export const BlockContinuation = Extension.create({
  name: 'blockContinuation',

  addProseMirrorPlugins() {
    return [
      new Plugin<ContinuationState>({
        key: continuationPluginKey,
        state: {
          init: () => new Map<number, ContinuationStatus>(),
          apply: (transaction, continuations, _oldState, newState) => {
            const historyTransaction = isHistoryTransaction(transaction);
            const next = new Map<number, ContinuationStatus>();

            for (const [pos, status] of continuations) {
              const mapped = transaction.mapping.mapResult(pos, status === 'dormant' ? -1 : 1);
              const paragraph = newState.doc.nodeAt(mapped.pos)?.type.name === 'paragraph';

              if (status === 'active' && !mapped.deleted && paragraph) {
                next.set(mapped.pos, 'active');
                continue;
              }

              if (
                status === 'dormant' &&
                historyTransaction &&
                paragraph &&
                followsContinuationBlock(newState, mapped.pos)
              ) {
                next.set(mapped.pos, 'active');
                continue;
              }

              next.set(mapped.pos, 'dormant');
            }

            const meta = transaction.getMeta(continuationPluginKey) as ContinuationMeta | undefined;
            if (
              meta &&
              isEmptyParagraph(newState, meta.add) &&
              followsContinuationBlock(newState, meta.add)
            ) {
              next.set(meta.add, 'active');
            }

            return next;
          },
        },
      }),
    ];
  },
});

function continuationPositions(editor: Editor) {
  const continuations = continuationPluginKey.getState(editor.state);
  if (!continuations) return [];

  return [...continuations].filter(([, status]) => status === 'active').map(([pos]) => pos);
}

export function contentForSave(editor: Editor): JSONContent {
  const transaction = editor.state.tr;

  for (const pos of continuationPositions(editor).sort((left, right) => right - left)) {
    const node = transaction.doc.nodeAt(pos);
    if (node?.type.name === 'paragraph' && node.content.size === 0) {
      transaction.delete(pos, pos + node.nodeSize);
    }
  }

  return transaction.doc.toJSON();
}

function findBlock(editor: Editor, nodeName: string) {
  const { selection } = editor.state;

  if (selection instanceof NodeSelection && selection.node.type.name === nodeName) {
    return { pos: selection.from, node: selection.node };
  }

  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    const node = selection.$from.node(depth);
    if (node.type.name === nodeName) {
      return { pos: selection.$from.before(depth), node };
    }
  }

  return undefined;
}

function insertContinuation(
  editor: Editor,
  afterPos: number,
  moveSelection: boolean,
  addToHistory = false,
) {
  const paragraph = editor.state.schema.nodes.paragraph?.createAndFill();
  if (!paragraph) return false;

  const transaction = editor.state.tr.insert(afterPos, paragraph);
  transaction.setMeta(continuationPluginKey, { add: afterPos } satisfies ContinuationMeta);
  if (!addToHistory) transaction.setMeta('addToHistory', false);
  if (moveSelection) {
    transaction.setSelection(TextSelection.create(transaction.doc, afterPos + 1));
  }
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

export function ensureContinuationParagraph(
  editor: Editor,
  nodeName: 'blockMath' | 'image' | 'table',
  { moveSelection = true }: { moveSelection?: boolean } = {},
) {
  const block = findBlock(editor, nodeName);
  const paragraphType = editor.state.schema.nodes.paragraph;
  if (!block || !paragraphType) return false;

  const $pos = editor.state.doc.resolve(block.pos);
  const index = $pos.index();
  const nextNode = $pos.parent.maybeChild(index + 1);
  const afterPos = block.pos + block.node.nodeSize;

  if (nextNode?.type === paragraphType && nextNode.content.size === 0) {
    if (!moveSelection) return true;

    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, afterPos + 1))
        .scrollIntoView(),
    );
    return true;
  }

  if (!$pos.parent.canReplaceWith(index + 1, index + 1, paragraphType)) return false;
  return insertContinuation(editor, afterPos, moveSelection);
}

function terminalContinuation(editor: Editor) {
  let target: number | undefined;

  editor.state.doc.descendants((node, pos, parent, index) => {
    if (
      target === undefined &&
      parent &&
      index === parent.childCount - 1 &&
      CONTINUATION_BLOCK_TYPES.has(node.type.name)
    ) {
      target = pos + node.nodeSize;
    }
  });

  return target;
}

export function ensureTerminalContinuations(editor: Editor) {
  while (true) {
    const afterPos = terminalContinuation(editor);
    if (afterPos === undefined || !insertContinuation(editor, afterPos, false, false)) return;
  }
}
