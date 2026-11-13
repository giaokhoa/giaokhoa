import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { DataTable, type DataColumn } from '#components/data-table';


interface Row {
  id: string;
  name: string;
  score: number;
}

const ROWS: Row[] = Array.from({ length: 25 }, (_, i) => ({
  id: `r${i + 1}`,
  name: `Học viên ${String(i + 1).padStart(2, '0')}`,
  score: (i * 7) % 100,
}));

const COLUMNS: DataColumn<Row>[] = [
  {
    id: 'name',
    header: 'Họ tên',
    cell: (row) => row.name,
    sortValue: (row) => row.name,
    filterValue: (row) => row.name,
  },
  {
    id: 'score',
    header: 'Điểm',
    cell: (row) => row.score,
    sortValue: (row) => row.score,
  },
];

const LABELS = {
  columns: 'Cột',
  previous: 'Trước',
  next: 'Sau',
  empty: 'Chưa có dữ liệu.',
  pageInfo: (page: number, pages: number) => `Trang ${page} / ${pages}`,
  filterPlaceholder: 'Lọc trong bảng…',
};

const RANGE_LABELS = {
  ...LABELS,
  rangeInfo: (from: number, to: number, total: number) => `Hiển thị ${from}–${to} trong ${total} dòng`,
};

function renderTable() {
  return render(<DataTable title="Bảng điểm" data={ROWS} columns={COLUMNS} labels={LABELS} getRowId={(r) => r.id} />);
}

function bodyRows(container: HTMLElement) {
  return [...container.querySelectorAll('tbody tr')];
}

afterEach(() => {
  cleanup();
});

describe('Khối DataTable (TanStack Table)', () => {
  it('phân trang: trang đầu 10 hàng, nút Sau chuyển trang và cập nhật thông tin trang', async () => {
    const { container } = renderTable();
    expect(bodyRows(container)).toHaveLength(10);
    expect(screen.getByText('Trang 1 / 3')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Sau' })[0]!);

    expect(bodyRows(container)).toHaveLength(10);
    expect(screen.getByText('Trang 2 / 3')).toBeInTheDocument();
    expect(screen.getByText('Học viên 11')).toBeInTheDocument();
  });

  it('sắp xếp: bấm tiêu đề cột Điểm đổi thứ tự tăng/giảm', async () => {
    const { container } = renderTable();
    const firstCellText = () => bodyRows(container)[0]?.querySelectorAll('td')[1]?.textContent;

    await userEvent.click(screen.getByRole('button', { name: 'Điểm' }));
    expect(firstCellText()).toBe('0');

    await userEvent.click(screen.getByRole('button', { name: 'Điểm' }));
    expect(firstCellText()).toBe('98');
  });

  it('lọc toàn bảng: ô lọc thu hẹp hàng theo chuỗi khớp và tính lại số trang', async () => {
    const { container } = renderTable();
    await userEvent.type(screen.getByPlaceholderText('Lọc trong bảng…'), 'Học viên 2');

    const rows = bodyRows(container);
    expect(rows).toHaveLength(6);
    expect(screen.getByText('Trang 1 / 1')).toBeInTheDocument();
    expect(screen.getByText('Học viên 25')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: 'Sau' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: 'Trước' })).toHaveLength(0);
  });

  it('biến thể khoảng dòng: chỉ một trang vẫn hiện cụm nút kèm nút số trang ở trạng thái tắt', () => {
    render(
      <DataTable
        title="Bảng điểm"
        data={ROWS.slice(0, 5)}
        columns={COLUMNS}
        labels={RANGE_LABELS}
        getRowId={(r) => r.id}
      />,
    );
    expect(screen.getByText('Hiển thị 1–5 trong 5 dòng')).toBeInTheDocument();
    expect(screen.queryByText('Trang 1 / 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: 'Sau' })) {
      expect(button).toBeDisabled();
    }
    for (const button of screen.getAllByRole('button', { name: 'Trước' })) {
      expect(button).toBeDisabled();
    }
  });

  it('biến thể khoảng dòng: bấm nút số trang nhảy thẳng tới trang đó và khoảng dòng cập nhật theo', async () => {
    const { container } = render(
      <DataTable title="Bảng điểm" data={ROWS} columns={COLUMNS} labels={RANGE_LABELS} getRowId={(r) => r.id} />,
    );
    expect(screen.getByText('Hiển thị 1–10 trong 25 dòng')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '3' }));

    expect(bodyRows(container)).toHaveLength(5);
    expect(screen.getByText('Hiển thị 21–25 trong 25 dòng')).toBeInTheDocument();
    expect(screen.getByText('Học viên 21')).toBeInTheDocument();
  });

  it('biến thể khoảng dòng: 7 trang vẫn bày đủ nút số trang và hàng chân bảng cùng cụm nút mang class cho phép xuống dòng để không tràn ở màn hẹp', () => {
    const rows65: Row[] = Array.from({ length: 65 }, (_, i) => ({
      id: `r${i + 1}`,
      name: `Học viên ${String(i + 1).padStart(2, '0')}`,
      score: (i * 7) % 100,
    }));
    render(
      <DataTable
        title="Bảng điểm"
        data={rows65}
        columns={COLUMNS}
        labels={RANGE_LABELS}
        getRowId={(r) => r.id}
        totalRows={65}
      />,
    );
    expect(screen.getByText('Hiển thị 1–10 trong 65 dòng')).toBeInTheDocument();
    for (const page of ['1', '2', '3', '4', '5', '6', '7']) {
      expect(screen.getByRole('button', { name: page })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button', { name: 'Trước' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Sau' }).length).toBeGreaterThan(0);
    const footerRow = screen.getByText('Hiển thị 1–10 trong 65 dòng').parentElement;
    expect(footerRow?.className).toContain('flex-wrap');
    expect(footerRow?.className).toContain('gap-2');
    const paginationCluster = screen.getByRole('button', { name: '1' }).parentElement;
    expect(paginationCluster?.className).toContain('flex-wrap');
  });

  it('ẩn/hiện cột: bỏ chọn một cột trong menu Cột thì cột biến mất khỏi bảng', async () => {
    const { container } = renderTable();
    await userEvent.click(screen.getByRole('button', { name: /Cột/ }));
    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Điểm' }));

    expect(screen.queryByRole('button', { name: 'Điểm' })).not.toBeInTheDocument();
    expect(container.querySelectorAll('thead th')).toHaveLength(1);
  });
});
