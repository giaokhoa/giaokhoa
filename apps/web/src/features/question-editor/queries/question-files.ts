import { useQuery } from '@tanstack/react-query';
import { resolveFileDisplayUrl } from '../api/question-files';
import { questionFileIdFromSrc } from '../utils/question-files';
import { queryKeys } from './keys';


export function useResolvedFileSrc(src: string | undefined): string | undefined {
  const fileId = src ? questionFileIdFromSrc(src) : null;
  const query = useQuery({
    queryKey: queryKeys.questionFileSrc(fileId),
    queryFn: () => resolveFileDisplayUrl(fileId as string),
    enabled: fileId !== null,
    staleTime: 240_000,
  });
  if (!src || fileId === null) return src;
  return query.data ?? src;
}
