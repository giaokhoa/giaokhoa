/**
 * Vùng dữ liệu dành riêng cho widget ProseMirror: extension ổn định vẫn đọc được prop mới khi React đã commit mà không cần dựng lại editor. Giá trị này không được dùng làm dữ liệu render của React.
 */
export function createEditorControlStore<T>(initialValue: T): {
  get: () => T;
  update: (nextValue: T) => void;
} {
  let value = initialValue;
  return {
    get: () => value,
    update: (nextValue) => {
      value = nextValue;
    },
  };
}
