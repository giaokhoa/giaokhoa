import { Link } from 'react-router';

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="text-center">
        <h2 className="text-2xl font-semibold">Giáo khoa</h2>
        <div className="mt-5 flex flex-wrap justify-center gap-4 text-sm">
          <Link className="underline underline-offset-4" to="/login">
            Đăng nhập
          </Link>
          <Link className="underline underline-offset-4" to="/register">
            Đăng ký
          </Link>
          <Link className="underline underline-offset-4" to="/questions/new">
            Thêm câu hỏi
          </Link>
        </div>
      </div>
    </div>
  );
}
