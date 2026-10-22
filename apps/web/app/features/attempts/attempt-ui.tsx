import type { AttemptAnswer } from '@giaokhoa/shared/attempts';
import { RichDocument } from '#features/workspace/question-preview.js';
import { parseQuestionContent } from './attempt-data.js';
export { RichDocument } from '#features/workspace/question-preview.js';

export function SavedAnswer({ answer, content }: { answer: AttemptAnswer; content?: unknown }) {
  const document = content ? parseQuestionContent(answer.type, content) : null;
  const last = document?.content?.at(-1);
  switch (answer.type) {
    case 'multiple_choice':
      if (last?.type === 'choiceList') {
        const index = last.content.findIndex((choice) => choice.attrs.id === answer.choiceId);
        const choice = last.content[index];
        if (choice)
          return (
            <div>
              <p>Phương án {String.fromCharCode(65 + index)}</p>
              <RichDocument value={{ type: 'doc', content: choice.content }} />
            </div>
          );
      }
      return (
        <p>
          Mã lựa chọn: <code>{answer.choiceId}</code>
        </p>
      );
    case 'true_false':
      return (
        <ul className="flex flex-col gap-2">
          {answer.answers.map((item) => (
            <li key={item.statementId}>
              {last?.type === 'statementList' ? (
                <RichDocument
                  value={{
                    type: 'doc',
                    content: last.content.find(
                      (statement) => statement.attrs.id === item.statementId,
                    )?.content,
                  }}
                />
              ) : (
                <code>{item.statementId}</code>
              )}
              : {item.value ? 'Đúng' : 'Sai'}
            </li>
          ))}
        </ul>
      );
    case 'short_answer':
      return <p>{answer.answer}</p>;
    case 'essay':
      return 'answer' in answer ? (
        <RichDocument value={answer.answer} />
      ) : (
        <div className="flex flex-col gap-4">
          {answer.answers.map((part) => (
            <section key={part.partId}>
              <h3>
                Mã phần: <code>{part.partId}</code>
              </h3>
              <RichDocument value={part.content} />
            </section>
          ))}
        </div>
      );
  }
}
