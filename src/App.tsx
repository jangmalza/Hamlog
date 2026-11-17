import { Suspense, lazy } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Link, createBrowserRouter, RouterProvider } from 'react-router-dom';
import LoadingSpinner from './components/LoadingSpinner';
import AdminGuard from './pages/AdminGuard';
import { PrerenderHandoff, RouteFallback } from './components/PrerenderHandoff';
import HomePage from './pages/HomePage';
import PublicAnalyticsTracker from './components/analytics/PublicAnalyticsTracker';
import { useRobots, useSeo } from './hooks/useSeo';
import { useSchema } from './hooks/useSchema';

// Helper to auto-reload page on chunk load error (deployment update)
type LazyImport = Promise<{ default: ComponentType<object> }>;

const isChunkLoadError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('Failed to fetch dynamically imported module')
    || error.message.includes('Importing a module script failed')
  );
};

const lazyWithRetry = (importFn: () => LazyImport) => {
  return lazy(async () => {
    try {
      return await importFn();
    } catch (error: unknown) {
      // If the error confirms a missing chunk (version mismatch), reload the page
      if (isChunkLoadError(error)) {
        window.location.reload();
      }
      throw error;
    }
  });
};

// Lazy load pages with retry
const PostPage = lazyWithRetry(() => import('./pages/PostPage'));
const AdminPage = lazyWithRetry(() => import('./pages/AdminPage'));

const LoadingFallback = () => (
  <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
    <LoadingSpinner message="페이지 불러오는 중..." />
  </div>
);

// Public routes keep showing the server-rendered page until the client page is ready.
const PublicRouteFallback = () => (
  <RouteFallback>
    <LoadingFallback />
  </RouteFallback>
);

const NoIndexRoute = ({ children }: { children: ReactNode }) => {
  useRobots('noindex, nofollow');
  useSchema({ post: undefined });
  return children;
};

const NotFoundPage = () => {
  useSeo({
    title: '페이지를 찾을 수 없습니다 | Hamlog',
    description: '요청한 페이지가 존재하지 않거나 이동되었습니다.',
    image: '/avatar.jpg',
    keywords: [],
    url: typeof window !== 'undefined' ? window.location.href : undefined,
    type: 'website',
    favicon: '/favicon.svg',
    robots: 'noindex, nofollow'
  });
  useSchema({ post: undefined });

  return (
    <main className="public-site flex min-h-screen items-center justify-center bg-[var(--bg)] px-4 text-[var(--text)]">
      <section aria-labelledby="not-found-title" className="w-full max-w-xl border border-[color:var(--border)] bg-[var(--surface)] p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
          404 · Not Found
        </p>
        <h1 id="not-found-title" className="mt-4 font-display text-3xl font-semibold">
          페이지를 찾을 수 없습니다
        </h1>
        <p className="mt-3 text-sm leading-7 text-[var(--text-muted)]">
          주소가 올바른지 확인하거나 홈에서 원하는 글을 다시 찾아보세요.
        </p>
        <Link
          to="/"
          className="mt-7 inline-flex min-h-11 items-center justify-center bg-[var(--text)] px-6 text-sm font-semibold text-[var(--bg)] transition hover:opacity-90"
        >
          홈으로 돌아가기
        </Link>
      </section>
    </main>
  );
};

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <PublicAnalyticsTracker>
        <HomePage />
        <PrerenderHandoff />
      </PublicAnalyticsTracker>
    )
  },
  {
    path: '/posts/:slug',
    element: (
      <PublicAnalyticsTracker>
        <Suspense fallback={<PublicRouteFallback />}>
          <PostPage />
          <PrerenderHandoff />
        </Suspense>
      </PublicAnalyticsTracker>
    )
  },
  {
    path: '/p/:slug',
    element: (
      <PublicAnalyticsTracker>
        <Suspense fallback={<PublicRouteFallback />}>
          <PostPage />
          <PrerenderHandoff />
        </Suspense>
      </PublicAnalyticsTracker>
    )
  },
  {
    path: '/admin',
    element: (
      <NoIndexRoute>
        <AdminGuard>
          <Suspense fallback={<LoadingFallback />}>
            <AdminPage />
          </Suspense>
        </AdminGuard>
      </NoIndexRoute>
    )
  },
  {
    path: '*',
    element: (
      <>
        <NotFoundPage />
        <PrerenderHandoff />
      </>
    )
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
