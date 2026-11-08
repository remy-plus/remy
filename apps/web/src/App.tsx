import { Header } from './components/Header.tsx';

export function App() {
  const path = '/';
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <Header path={path} />
      <main id="main" tabIndex={-1} className="outline-none" />
    </>
  );
}
