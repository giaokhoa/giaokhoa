import { useEffect, useMemo, useState } from 'react';
import {
  Decoration,
  Extension,
  type Extensions,
  type JSONContent,
  type WidgetDecoration,
} from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { createEditorControlStore } from './editor-control-store.js';

/**
 * Phần chung của hai module soạn câu theo danh sách mục — trắc nghiệm
 * (`multiple-choice.ts`, mục là `choice` trong `choiceList`) và
 * đúng/sai chùm (`true-false.ts`, mục là `statement` trong
 * `statementList`).
 *
 * Hai loại câu hỏi làm cùng một việc (quản lý một danh sách mục trong
 * một tài liệu soạn thảo duy nhất) với hai node type khác nhau, nên mọi
 * thao tác dưới đây được tham số hoá theo node type thay vì sao chép:
 *
 * Flow tổng thể phía tài liệu (tài liệu vào là Tiptap JSON mà phần tử
 * cuối là đúng một node danh sách, tài liệu ra giữ nguyên hình dạng):
 *
 * 1. {@link newItemId} sinh id cho mục mới (theo tiền tố
 *    `choice`/`statement`); {@link createItemUniqueIdExtension} là
 *    plugin bảo đảm mọi mục trong tài liệu luôn có `attrs.id`.
 * 2. {@link splitItemListDocument} tách tài liệu thành phần thân và
 *    danh sách mục theo thứ tự; {@link itemFromBlocks} dựng một mục từ
 *    nội dung block; {@link completeItemList} chuẩn hoá danh sách về
 *    đúng số mục (cắt thừa, đệm mục rỗng khi thiếu);
 *    {@link createEmptyItemListDocument} dựng tài liệu rỗng.
 * 3. {@link jsonNodeHasContent} là vị ngữ "có nội dung" duy nhất cho
 *    JSON Tiptap ở tầng soạn, cùng ngữ nghĩa với
 *    `richTextBlocksHaveContent` của `@giaokhoa/contracts` (công thức
 *    LaTeX rỗng không tính là có nội dung).
 *
 * Flow phía component: {@link getItemIds} + {@link sameIds} đọc/so
 * sánh tập id mục trong tài liệu ProseMirror;
 * {@link createAnswerDecoration} là factory decoration vẽ widget đáp
 * án cạnh từng mục mà không ghi đáp án vào tài liệu;
 * {@link useAnswerEditorExtensions} là khung dùng chung của hai editor
 * chuyên biệt (giữ điều khiển đáp án trong store để decoration luôn
 * đọc giá trị mới nhất, dựng mảng extension một lần ổn định).
 *
 * Bất biến: mọi hàm ở đây chỉ tham số hoá theo node type — luật riêng
 * của từng loại (đáp án đúng duy nhất của trắc nghiệm, bản đồ Đ/S từng
 * mệnh đề của đúng/sai) vẫn nằm ở module của loại đó; chia sẻ không
 * được làm lệch hành vi của bất kỳ loại nào.
 */

/**
 * Sinh định danh cho một mục mới. Dùng `crypto.randomUUID` của nền
 * tảng; môi trường thiếu API đó (jsdom cũ) thì rơi về bộ đếm + thời
 * gian — id chỉ cần duy nhất trong vòng soạn, không phải định danh
 * bền xuyên phiên bản.
 *
 * @param prefix - Tiền tố phân biệt loại mục (`choice`/`statement`),
 *   để id rơi về vẫn đọc được loại mục dù bộ đếm dự phòng là chung.
 * @returns Chuỗi định danh mới cho mục.
 */
let fallbackIdCounter = 0;
export function newItemId(prefix: string): string {
  const cryptoRef = globalThis.crypto as Crypto | undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  fallbackIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackIdCounter}`;
}

/**
 * Một paragraph rỗng — block đệm chuẩn của tài liệu soạn.
 *
 * @returns Node paragraph rỗng.
 */
export function emptyParagraph(): JSONContent {
  return { type: 'paragraph' };
}

/**
 * Cấu hình tham số hoá theo node type cho các hàm tách/gộp tài liệu
 * danh sách mục.
 */
export interface ItemListConfig {
  /** Tên node danh sách chốt đuôi tài liệu (`choiceList`/`statementList`). */
  listNodeType: string;
  /** Tên node một mục trong danh sách (`choice`/`statement`). */
  itemNodeType: string;
}

/**
 * Tách tài liệu danh sách mục thành phần thân và danh sách mục theo
 * đúng thứ tự trong tài liệu — thứ tự này là thứ tự đáp án/mệnh đề
 * khi lưu và khi trình bày.
 *
 * @param content - Tài liệu soạn (phần tử cuối là node danh sách).
 * @param config - Bộ hằng node type của loại câu hỏi.
 * @param config.isItem - Vị ngữ thu hẹp một node JSON thành mục của
 *   loại câu hỏi (so khớp `type` với tên node mục).
 * @returns `body` là tài liệu thân (đã bỏ node danh sách, sẵn sàng ép
 *   về `RichTextDocument` của hợp đồng) và `items` là các mục theo
 *   đúng thứ tự trong tài liệu; tài liệu không có node danh sách thì
 *   `items` rỗng và `body` là chính tài liệu.
 */
export function splitItemListDocument<T extends JSONContent>(
  content: { type: 'doc'; content?: JSONContent[] },
  config: ItemListConfig & { isItem: (node: JSONContent) => node is T },
): { body: JSONContent; items: T[] } {
  const nodes = content.content ?? [];
  const listIndex = nodes.findIndex((node) => node.type === config.listNodeType);
  if (listIndex < 0) {
    return { body: content, items: [] };
  }
  const list = nodes[listIndex];
  return {
    body: { ...content, content: nodes.filter((_, index) => index !== listIndex) },
    items: (list?.content ?? []).filter(config.isItem),
  };
}

/**
 * Dựng một mục từ nội dung block cho trước.
 *
 * @param itemNodeType - Tên node mục của loại câu hỏi.
 * @param id - Định danh của mục (id dòng answers khi nạp câu có sẵn;
 *   id mới khi soạn thêm).
 * @param blocks - Các block rich text của nội dung mục; rỗng thì đệm
 *   một paragraph rỗng để mục luôn mở soạn được.
 * @returns Node mục hoàn chỉnh cho tài liệu thống nhất.
 */
export function itemFromBlocks(
  itemNodeType: string,
  id: string,
  blocks: readonly JSONContent[] | undefined,
): JSONContent {
  return {
    type: itemNodeType,
    attrs: { id },
    content: blocks && blocks.length > 0 ? [...blocks] : [emptyParagraph()],
  };
}

/**
 * Chuẩn hoá một danh sách mục về đúng số mục: thừa thì giữ các mục
 * đầu theo thứ tự, thiếu thì đệm mục rỗng bằng hàm tạo cho trước.
 *
 * @param items - Các mục hiện có theo thứ tự.
 * @param itemCount - Số mục đúng của loại câu hỏi.
 * @param createEmpty - Hàm tạo một mục rỗng (id mới).
 * @returns Danh sách đủ đúng `itemCount` mục.
 */
export function completeItemList<T>(
  items: readonly T[],
  itemCount: number,
  createEmpty: () => T,
): T[] {
  const result = items.slice(0, itemCount);
  while (result.length < itemCount) {
    result.push(createEmpty());
  }
  return result;
}

/**
 * Tài liệu danh sách mục rỗng cho một câu mới: một paragraph thân câu
 * + danh sách đúng `itemCount` mục rỗng, mỗi mục có id mới.
 *
 * @param config - Bộ hằng node type, số mục và hàm sinh id của loại
 *   câu hỏi.
 * @returns Tài liệu rỗng (chưa có đáp án).
 */
export function createEmptyItemListDocument(
  config: ItemListConfig & { itemCount: number; newId: () => string },
): {
  type: 'doc';
  content: JSONContent[];
} {
  return {
    type: 'doc',
    content: [
      emptyParagraph(),
      {
        type: config.listNodeType,
        content: Array.from({ length: config.itemCount }, () =>
          itemFromBlocks(config.itemNodeType, config.newId(), undefined),
        ),
      },
    ],
  };
}

/**
 * Một node JSON có nội dung thật hay không — vị ngữ "có nội dung"
 * duy nhất cho JSON Tiptap ở tầng soạn, cùng ngữ nghĩa với
 * `richTextBlocksHaveContent` của `@giaokhoa/contracts`: chữ khác
 * rỗng ở bất kỳ mức nào, hoặc node phi văn bản mang nội dung — ảnh
 * tự nó là nội dung, còn công thức chỉ tính khi mã LaTeX khác rỗng
 * (công thức LaTeX rỗng render ra rỗng ở phía xem nên không tính).
 *
 * @param node - Node JSON cần kiểm.
 * @returns `true` khi node mang nội dung thật.
 */
export function jsonNodeHasContent(node: JSONContent): boolean {
  if (node.type === 'text') {
    return typeof node.text === 'string' && node.text.trim() !== '';
  }
  if (node.type === 'inlineMath' || node.type === 'blockMath') {
    return typeof node.attrs?.latex === 'string' && node.attrs.latex.trim() !== '';
  }
  if (node.type === 'image') {
    return true;
  }
  return (node.content ?? []).some(jsonNodeHasContent);
}

/**
 * Cấu hình tham số hoá theo node type cho plugin gán id duy nhất.
 */
export interface ItemUniqueIdConfig {
  /**
   * Tên extension — cũng là khoá plugin ProseMirror (hai loại câu hỏi
   * dùng `choiceUniqueId`/`statementUniqueId`).
   */
  name: string;
  /** Tên node mục cần gán id (`choice`/`statement`). */
  itemNodeType: string;
  /** Sinh id mới cho một mục thiếu id. */
  newId: () => string;
}

/**
 * Plugin bảo đảm mọi node mục trong tài liệu luôn có `attrs.id`: sau
 * mỗi transaction, mục nào thiếu id (vừa được tạo khi người soạn
 * tách/gộp đoạn, hoặc tài liệu nạp vào chưa có) được gán một id mới
 * bằng `setNodeMarkup` trong một transaction nối tiếp.
 *
 * Đây là bản thay thế gọn cho `@tiptap/extension-unique-id` của
 * giaokhoa — package đó không có trong workspace của hệ mình, và nhu
 * cầu ở đây hẹp hơn (chỉ node mục). Id phải nằm TRONG tài liệu (không
 * giữ ở state ngoài) vì kéo-thả đổi thứ tự và tách/gộp đoạn đều đi qua
 * tài liệu: đáp án bám theo id này nên đi theo đúng mục qua mọi thao
 * tác.
 *
 * @param config - Tên extension/khoá plugin, tên node mục và hàm sinh
 *   id của loại câu hỏi.
 * @returns Extension Tiptap mang plugin gán id.
 */
export function createItemUniqueIdExtension(config: ItemUniqueIdConfig): Extension {
  return Extension.create({
    name: config.name,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey(config.name),
          appendTransaction: (_transactions, _oldState, newState) => {
            const missing: { pos: number }[] = [];
            newState.doc.descendants((node, pos) => {
              if (node.type.name === config.itemNodeType && typeof node.attrs.id !== 'string') {
                missing.push({ pos });
              }
              return true;
            });
            if (missing.length === 0) {
              return null;
            }
            const tr = newState.tr;
            // Gán id từ cuối tài liệu ngược về đầu để vị trí đã ghi
            // không bị lệch bởi các lần setNodeMarkup trước đó (dù
            // setNodeMarkup không đổi kích thước node, thứ tự ngược
            // giữ cho vòng lặp an toàn tuyệt đối).
            for (const { pos } of [...missing].reverse()) {
              const node = tr.doc.nodeAt(pos);
              if (node && node.type.name === config.itemNodeType) {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: config.newId() });
              }
            }
            return tr;
          },
        }),
      ];
    },
  });
}

/**
 * Các id mục theo thứ tự trong tài liệu hiện tại của editor.
 *
 * @param doc - Tài liệu ProseMirror hiện tại.
 * @param listNodeType - Tên node danh sách chốt đuôi tài liệu.
 * @param itemNodeType - Tên node mục trong danh sách.
 * @returns Mảng id của các node mục thuộc danh sách chốt đuôi.
 */
export function getItemIds(
  doc: ProseMirrorNode,
  listNodeType: string,
  itemNodeType: string,
): string[] {
  const list = doc.lastChild;
  if (list?.type.name !== listNodeType) {
    return [];
  }
  const ids: string[] = [];
  list.forEach((item) => {
    if (item.type.name === itemNodeType && typeof item.attrs.id === 'string') {
      ids.push(item.attrs.id);
    }
  });
  return ids;
}

/**
 * Hai danh sách id có giống hệt nhau (cả phần tử lẫn thứ tự) không.
 *
 * @param left - Danh sách id thứ nhất.
 * @param right - Danh sách id thứ hai.
 * @returns `true` khi hai danh sách giống hệt nhau.
 */
export function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * Cấu hình tham số hoá theo node type cho factory decoration đáp án.
 */
export interface AnswerDecorationConfig<C> {
  /** Tên extension decoration (duy nhất trong editor). */
  name: string;
  /** Tên node danh sách chốt đuôi tài liệu. */
  listNodeType: string;
  /** Tên node mục mà decoration gắn vào. */
  itemNodeType: string;
  /** Tiền tố khoá widget decoration (duy nhất cho mỗi mục). */
  widgetKeyPrefix: string;
  /** Class CSS của thẻ bọc widget. */
  wrapperClassName: string;
  /**
   * Dựng các phần tử con của widget cho một mục: đọc trạng thái đáp
   * án hiện tại từ `getControl` tại lúc tạo widget nên không cần dựng
   * lại decoration khi đáp án đổi — bản thân các radio trong cùng một
   * nhóm tự loại trừ nhau theo hành vi gốc của trình duyệt khi người
   * soạn bấm chọn.
   */
  buildWidget: (itemId: string, getControl: () => C) => HTMLElement[];
}

/**
 * Factory decoration hiển thị widget đáp án bên cạnh từng mục mà không
 * thay đổi nội dung tài liệu.
 *
 * Decoration chỉ dựng lại khi TẬP id mục thay đổi (mục mới sinh id,
 * mục bị xoá, thứ tự đổi) — đáp án hiện tại được đọc từ `getControl`
 * tại lúc tạo widget.
 *
 * @param config - Tên extension, bộ hằng node type, tiền tố khoá,
 *   class bọc và hàm dựng widget của loại câu hỏi.
 * @returns Hàm tạo extension Tiptap mang decoration đáp án từ điều
 *   khiển radio mới nhất.
 */
export function createAnswerDecoration<C>(
  config: AnswerDecorationConfig<C>,
): (getControl: () => C) => Extension {
  return (getControl) =>
    Extension.create({
      name: config.name,

      addDecorations() {
        return {
          shouldUpdate: ({ oldState, newState }) =>
            !sameIds(
              getItemIds(oldState.doc, config.listNodeType, config.itemNodeType),
              getItemIds(newState.doc, config.listNodeType, config.itemNodeType),
            ),
          create: ({ state }) => {
            const widgets: WidgetDecoration[] = [];

            state.doc.descendants((node, pos) => {
              if (node.type.name !== config.itemNodeType) {
                return;
              }
              const itemId = node.attrs.id;
              if (typeof itemId !== 'string') {
                return;
              }
              widgets.push(
                Decoration.Widget(
                  pos + 1,
                  () => {
                    const wrapper = document.createElement('span');
                    wrapper.className = config.wrapperClassName;
                    wrapper.append(...config.buildWidget(itemId, getControl));
                    return wrapper;
                  },
                  {
                    key: `${config.widgetKeyPrefix}-${itemId}`,
                    side: -1,
                    ignoreSelection: true,
                    stopEvent: () => true,
                  },
                ),
              );
            });

            return widgets;
          },
        };
      },
    });
}

/**
 * Cấu hình cho khung extension dùng chung của hai editor chuyên biệt.
 */
export interface AnswerEditorExtensionsConfig<C> {
  /** Bộ extension nền của loại câu hỏi (bộ hợp đồng trừ `doc` + các node mục + plugin id). */
  baseExtensions: Extensions;
  /** Factory decoration đáp án của loại câu hỏi (đã tham số hoá theo node type). */
  createDecoration: (getControl: () => C) => Extension;
  /** Điều khiển đáp án hiện tại (tên nhóm radio + trạng thái đáp án + callback báo ra ngoài). */
  controlValue: C;
}

/**
 * Khung dùng chung của hai editor chuyên biệt soạn theo danh sách mục:
 * giữ điều khiển đáp án trong một store để decoration luôn đọc được
 * giá trị mới nhất mà không phải dựng lại editor khi prop đổi, và dựng
 * mảng extension (bộ nền + decoration đáp án) một lần ổn định.
 *
 * @param config - Bộ extension nền, factory decoration và điều khiển
 *   đáp án hiện tại của loại câu hỏi.
 * @returns Mảng extension cho {@link RichTextEditor} — danh tính ổn
 *   định giữa các lần render khi bộ nền và factory không đổi.
 */
export function useAnswerEditorExtensions<C>(
  config: AnswerEditorExtensionsConfig<C>,
): Extensions {
  const [control] = useState(() => createEditorControlStore(config.controlValue));
  useEffect(() => {
    control.update(config.controlValue);
  }, [control, config.controlValue]);
  return useMemo(
    () => [...config.baseExtensions, config.createDecoration(control.get)],
    [config.baseExtensions, config.createDecoration, control.get],
  );
}
