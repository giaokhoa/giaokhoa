export default function Home() {
  return (
    <main className="site-main">
      <section className="hero" aria-labelledby="site-title">
        <p className="eyebrow">Giáo Khoa</p>
        <h1 id="site-title">Một tài khoản, nhiều không gian học tập.</h1>
        <p className="introduction">
          Đăng nhập để tiếp tục học tập và quản lý lớp học trong không gian của bạn.
        </p>
        <a className="login-link" href="/oauth2/authorization/keycloak">
          Đăng nhập
        </a>
      </section>
    </main>
  );
}
