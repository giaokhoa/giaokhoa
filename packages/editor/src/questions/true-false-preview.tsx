import type { JSONContent } from '@tiptap/core';
import { memo, useId } from 'react';
import { splitTrueFalseDocument } from './true-false.js';
import { TiptapContent } from './tiptap-content.js';

export const TrueFalsePreview = memo(function TrueFalsePreview({
  content,
}: {
  content: JSONContent;
}) {
  const groupPrefix = useId();
  const { question, statements } = splitTrueFalseDocument(content);

  return (
    <div>
      <TiptapContent content={question} />
      {statements.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-lg border">
          <table className="w-full border-collapse text-left">
            <thead className="bg-muted/40 text-sm">
              <tr className="border-b">
                <th className="w-12 px-3 py-2 text-center font-medium">Ý</th>
                <th className="px-3 py-2 font-medium">Nội dung</th>
                <th className="w-20 px-3 py-2 text-center font-medium">Đúng</th>
                <th className="w-20 px-3 py-2 text-center font-medium">Sai</th>
              </tr>
            </thead>
            <tbody>
              {statements.map((statement, index) => {
                const id =
                  typeof statement.attrs?.id === 'string' ? statement.attrs.id : String(index);
                const name = `${groupPrefix}-${id}`;

                return (
                  <tr key={id} className="border-b last:border-b-0">
                    <td className="px-3 py-2 text-center align-middle font-medium">
                      {String.fromCharCode(97 + index)})
                    </td>
                    <td className="px-3 py-2 leading-6">
                      <TiptapContent content={{ type: 'doc', content: statement.content }} />
                    </td>
                    {[true, false].map((value) => (
                      <td key={String(value)} className="px-3 py-2 text-center align-middle">
                        <label className="mx-auto flex size-8 cursor-pointer items-center justify-center rounded-full border text-sm font-medium has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground">
                          <input
                            className="sr-only"
                            type="radio"
                            name={name}
                            value={String(value)}
                          />
                          {value ? 'Đ' : 'S'}
                        </label>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});
