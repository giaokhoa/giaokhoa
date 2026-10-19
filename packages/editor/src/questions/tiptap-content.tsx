import {
  getAttributesFromExtensions,
  getSchema,
  resolveExtensions,
  splitExtensions,
  type JSONContent,
} from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';
import type { Mark as ProseMirrorMark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { MarkProps, NodeProps } from '@tiptap/static-renderer/json/react';
import { renderToString } from 'katex';
import {
  domOutputSpecToReactElement,
  mapMarkExtensionToReactNode,
  mapNodeExtensionToReactNode,
} from '@tiptap/static-renderer/pm/react';
import {
  cloneElement,
  Fragment,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { plainQuestionExtensions } from './plain-question.js';

type NodeRenderer = (props: NodeProps<ProseMirrorNode, ReactNode | ReactNode[]>) => ReactNode;

type MarkRenderer = (
  props: MarkProps<ProseMirrorMark, ReactNode | ReactNode[], ProseMirrorNode>,
) => ReactNode;

/**
 * Tiptap's high-level React static renderer is ideal for one-shot rendering, but this
 * component updates on every keystroke. Precompute the public pm/react mappings once
 * so their React identities stay stable, then render schema-validated ProseMirror nodes.
 */
function createLiveContentRenderer() {
  const extensions = resolveExtensions(plainQuestionExtensions);
  const schema = getSchema(plainQuestionExtensions);
  const extensionAttributes = getAttributesFromExtensions(extensions);
  const { nodeExtensions, markExtensions } = splitExtensions(extensions);

  const nodes: Record<string, NodeRenderer> = {
    doc: ({ children }) => <>{children}</>,
    text: ({ node }) => node.text ?? null,
  };

  for (const extension of nodeExtensions) {
    if (extension.name in nodes) continue;

    const [name, renderer] = mapNodeExtensionToReactNode<ReactNode>(
      domOutputSpecToReactElement,
      extension,
      extensionAttributes,
    );
    nodes[name] = renderer;
  }

  for (const type of ['inlineMath', 'blockMath'] as const) {
    nodes[type] = ({ node }) => {
      const block = type === 'blockMath';
      const Tag = block ? 'div' : 'span';
      const latex = typeof node.attrs.latex === 'string' ? node.attrs.latex : '';
      const html = renderToString(latex, {
        displayMode: block,
        throwOnError: false,
        trust: false,
      });

      return <Tag data-type={type} dangerouslySetInnerHTML={{ __html: html }} />;
    };
  }

  const paragraphRenderer = nodes[Paragraph.name];
  if (paragraphRenderer) {
    // ProseMirror's trailing <br> is EditorView-only; static output stays an empty <p>.

    nodes[Paragraph.name] = (props) => {
      const rendered = paragraphRenderer(props);
      if (props.node.childCount > 0 || !isValidElement(rendered)) return rendered;

      const paragraph = rendered as ReactElement<{ style?: CSSProperties }>;
      return cloneElement(paragraph, {
        style: { ...paragraph.props.style, minHeight: '1lh' },
      });
    };
  }

  const marks: Record<string, MarkRenderer> = {};
  for (const extension of markExtensions) {
    const [name, renderer] = mapMarkExtensionToReactNode<ReactNode>(
      domOutputSpecToReactElement,
      extension,
      extensionAttributes,
    );
    marks[name] = renderer;
  }

  return { schema, nodes, marks };
}

const liveContentRenderer = createLiveContentRenderer();

function nodeKey(node: ProseMirrorNode, index: number) {
  return typeof node.attrs.id === 'string' ? node.attrs.id : index;
}

function renderNode(node: ProseMirrorNode, parent?: ProseMirrorNode): ReactNode {
  const renderer = liveContentRenderer.nodes[node.type.name];
  if (!renderer) throw new Error(`Missing Tiptap renderer for node type "${node.type.name}"`);

  const children: ReactNode[] = [];
  node.forEach((child, _offset, index) => {
    children.push(<Fragment key={nodeKey(child, index)}>{renderNode(child, node)}</Fragment>);
  });

  let result = renderer({
    node,
    parent,
    children,
    renderElement: ({ content, parent: elementParent }) => renderNode(content, elementParent),
  });

  for (const mark of node.marks) {
    const markRenderer = liveContentRenderer.marks[mark.type.name];
    if (!markRenderer) {
      throw new Error(`Missing Tiptap renderer for mark type "${mark.type.name}"`);
    }
    result = markRenderer({ mark, parent, node, children: result });
  }

  return result;
}

export function TiptapContent({ content }: { content: JSONContent }) {
  return <>{renderNode(liveContentRenderer.schema.nodeFromJSON(content))}</>;
}

export function getTextContent(content: JSONContent): string {
  if (content.type === 'text') return content.text ?? '';
  if (content.type === 'inlineMath' || content.type === 'blockMath') {
    return typeof content.attrs?.latex === 'string' ? content.attrs.latex : '';
  }
  if (content.type === 'image') return '\uFFFC';
  return content.content?.map(getTextContent).join('') ?? '';
}

export function hasTextContent(content: JSONContent): boolean {
  return getTextContent(content).trim().length > 0;
}
